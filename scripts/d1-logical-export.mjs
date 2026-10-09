#!/usr/bin/env node
// A logical (SQL) export of a Spoonjoy D1 database that works despite the full-text search tables.
//
// `wrangler d1 export` refuses any database with a virtual table ("cannot export databases with
// virtual tables (like FTS5)"), and Spoonjoy's search index, "SearchDocument", is an FTS5 table
// (migrations/0006). Exporting table by table (`--table`) works, but then wrangler writes only the
// tables: no indexes and no triggers, so a restore would lose every unique constraint. This script:
//
// 1. reads the schema from sqlite_master;
// 2. exports every table except the FTS virtual tables and their shadow tables (`<name>_data`,
//    `_idx`, `_content`, `_docsize`, `_config`) and D1's internal `_cf_` tables;
// 3. adds the indexes and triggers of the exported tables, before the rows, so the file restores
//    the full schema and imports into D1 with its foreign keys enforced.
//
// The search index is derived data. After a restore, the app recreates SearchDocument and rebuilds
// it on the first search (ensureSearchIndexFresh in app/lib/search.server.ts sees an index whose
// document count no longer matches SearchIndexMetadata). docs/d1-restore-runbook.md describes the
// restore.
//
// Usage: node scripts/d1-logical-export.mjs --target <qa|production> --output <file.sql>
// Credentials: wrangler's (an OAuth login, or CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID).
import { execFile as nodeExecFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

export const SCHEMA_SQL =
  'SELECT "type", "name", "tbl_name", "sql" FROM sqlite_master WHERE "name" NOT LIKE \'sqlite_%\' ORDER BY "type", "name";';

const FTS_SHADOW_SUFFIXES = ["_data", "_idx", "_content", "_docsize", "_config"];

export function parseExportArgs(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const target = value("--target");
  const output = value("--output");
  if (target !== "qa" && target !== "production") {
    throw new Error("Usage: d1-logical-export.mjs --target <qa|production> --output <file.sql>");
  }
  if (!output || output.startsWith("--")) {
    throw new Error("d1-logical-export needs --output <file.sql>.");
  }
  return { target, output };
}

/** Wrangler's flags for the target database: production is the default environment. */
export function targetFlags(target) {
  return target === "qa" ? ["--remote", "--env", "qa"] : ["--remote"];
}

function isVirtualTable(entry) {
  return entry.type === "table" && /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(entry.sql ?? "");
}

/**
 * Splits the schema into the tables to export (by name) and the index and trigger statements to
 * append, and names what was skipped.
 */
export function planExport(schema) {
  const virtualTables = schema.filter(isVirtualTable).map((entry) => entry.name);
  const isDerived = (name) =>
    virtualTables.includes(name) ||
    virtualTables.some((table) => FTS_SHADOW_SUFFIXES.some((suffix) => name === `${table}${suffix}`));
  const isInternal = (name) => name.startsWith("_cf_");

  const tables = schema
    .filter((entry) => entry.type === "table" && !isDerived(entry.name) && !isInternal(entry.name))
    .map((entry) => entry.name);
  const skipped = schema
    .filter((entry) => entry.type === "table" && (isDerived(entry.name) || isInternal(entry.name)))
    .map((entry) => entry.name);
  // Automatic indexes (for PRIMARY KEY and UNIQUE columns) have no SQL: the table definition
  // recreates them.
  const extras = schema
    .filter((entry) => (entry.type === "index" || entry.type === "trigger") && entry.sql && tables.includes(entry.tbl_name))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "index" ? -1 : 1))
    .map((entry) => `${entry.sql.trim().replace(/;$/, "")};`);
  return { tables, skipped, extras };
}

/**
 * Orders tables so every table comes after the tables its foreign keys reference. Remote D1
 * refuses an import whose rows reference a parent row that is not there yet (it fails with
 * `{"D1_RESET_DO":true}`, whatever `PRAGMA defer_foreign_keys` says), and wrangler writes rows in
 * table-creation order, which on Spoonjoy puts Ingredient before IngredientRef and Unit. Tables
 * in a reference cycle keep their creation order; a self-reference (a fork's sourceRecipeId) is
 * left to row order, which is creation order too.
 */
export function tableOrder(schema, tables) {
  const sqlByName = new Map(schema.filter((entry) => entry.type === "table").map((entry) => [entry.name, entry.sql ?? ""]));
  const parents = new Map(tables.map((table) => [table, new Set(
    [...sqlByName.get(table).matchAll(/REFERENCES\s+["'`]?([A-Za-z0-9_]+)["'`]?/gi)]
      .map((match) => match[1])
      .filter((parent) => parent !== table && tables.includes(parent)),
  )]));
  const ordered = [];
  while (ordered.length < tables.length) {
    const next = tables.find((table) => !ordered.includes(table) && [...parents.get(table)].every((parent) => ordered.includes(parent)))
      ?? tables.find((table) => !ordered.includes(table));
    ordered.push(next);
  }
  return ordered;
}

/** Regroups wrangler's INSERT statements by table, in the given table order. */
export function orderRows(rowsSql, order) {
  const groups = new Map();
  const preamble = [];
  let current;
  // A line starts a statement only outside a quoted value: recipe text can contain a line that
  // reads like `INSERT INTO "Recipe"`. SQL escapes a quote inside a value by doubling it, which
  // toggles twice, so counting quotes tracks whether a line ends inside a value.
  let inValue = false;
  for (const line of rowsSql.split("\n")) {
    const table = inValue ? undefined : /^INSERT INTO "([^"]+)"/.exec(line)?.[1];
    if ((line.match(/'/g) ?? []).length % 2 === 1) inValue = !inValue;
    if (table) {
      current = table;
      if (!groups.has(table)) groups.set(table, []);
    }
    if (current) groups.get(current).push(line);
    else preamble.push(line);
  }
  const unexpected = [...groups.keys()].filter((table) => !order.includes(table));
  if (unexpected.length > 0) throw new Error(`The export has rows for unexpected tables: ${unexpected.join(", ")}.`);
  return [...preamble, ...order.flatMap((table) => groups.get(table) ?? [])].join("\n");
}

/** Whether the SQL creates the table, however wrangler quoted its name. */
export function createsTable(sql, table) {
  const name = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?["'\`]?${name}["'\`]?\\s*\\(`, "i").test(sql);
}

/** Reads wrangler's `--json` output, which may follow other log lines. */
export function parseWranglerJson(stdout) {
  const start = stdout.indexOf("[");
  if (start === -1) throw new Error("wrangler returned no JSON results.");
  const results = JSON.parse(stdout.slice(start));
  if (results.some((result) => result?.success === false)) {
    throw new Error("wrangler reported a failed statement.");
  }
  return results;
}

/**
 * Writes the export in restore order: the tables' schema, then their indexes and triggers, then
 * the rows. D1 enforces foreign keys while it imports, and a foreign key whose parent columns
 * have no unique index yet fails ("foreign key mismatch"), so the indexes must come before the
 * rows. The rows come from one `wrangler d1 export`, which is a consistent snapshot; the schema is
 * read again afterwards and must not have changed in between (a migration landed mid-export).
 */
export async function exportDatabase({ target, output, exec, fs, log }) {
  const flags = targetFlags(target);
  const readSchema = async () => {
    const { stdout } = await exec("pnpm", ["exec", "wrangler", "d1", "execute", "DB", ...flags, "--json", "--command", SCHEMA_SQL]);
    return parseWranglerJson(stdout)[0]?.results ?? [];
  };
  const schema = await readSchema();
  const plan = planExport(schema);
  if (plan.tables.length === 0) throw new Error("The database has no tables to export.");

  const workDir = await fs.mkdtemp(join(tmpdir(), "spoonjoy-d1-export-"));
  try {
    const exportPart = async (file, flag) => {
      const path = join(workDir, file);
      await exec("pnpm", [
        "exec", "wrangler", "d1", "export", "DB", ...flags, "--output", path, "--skip-confirmation", flag,
        ...plan.tables.flatMap((table) => ["--table", table]),
      ]);
      return fs.readFile(path, "utf8");
    };
    const tableSchema = await exportPart("schema.sql", "--no-data");
    const rows = await exportPart("rows.sql", "--no-schema");

    const missing = plan.tables.filter((table) => !createsTable(tableSchema, table));
    if (missing.length > 0) throw new Error(`The export is missing tables: ${missing.join(", ")}.`);
    if (JSON.stringify(await readSchema()) !== JSON.stringify(schema)) {
      throw new Error("The database schema changed during the export; run it again.");
    }

    await fs.writeFile(output, [
      `-- Spoonjoy D1 logical export (${target}), written by scripts/d1-logical-export.mjs.`,
      `-- Not exported (derived search index, rebuilt by the app after a restore): ${plan.skipped.join(", ") || "none"}.`,
      "-- Tables:",
      tableSchema.trim(),
      "-- Indexes and triggers (`wrangler d1 export --table` leaves them out):",
      ...plan.extras,
      "-- Rows (parents before children):",
      orderRows(rows.trim(), tableOrder(schema, plan.tables)),
      "",
    ].join("\n"), { mode: 0o600 });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }

  log(`Exported ${plan.tables.length} tables with ${plan.extras.length} indexes and triggers to ${output}; skipped ${plan.skipped.join(", ") || "nothing"}.`);
  return plan;
}

/* istanbul ignore next -- @preserve the CLI entry point wires real process, fs and child_process. */
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exec = promisify(nodeExecFile);
  try {
    await exportDatabase({
      ...parseExportArgs(process.argv.slice(2)),
      exec: (command, args) => exec(command, args, { maxBuffer: 1024 * 1024 * 1024 }),
      fs: { mkdtemp, readFile, rm, writeFile },
      log: (message) => console.log(message),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
