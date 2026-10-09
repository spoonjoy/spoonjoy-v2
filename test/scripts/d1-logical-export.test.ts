// @vitest-environment node
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCHEMA_SQL,
  createsTable,
  exportDatabase,
  orderRows,
  parseExportArgs,
  parseWranglerJson,
  planExport,
  tableOrder,
  targetFlags,
} from "../../scripts/d1-logical-export.mjs";

// A database shaped like Spoonjoy's where it matters for an export: an FTS5 search table with
// its shadow tables, a foreign key whose parent columns are only unique through an index
// (StepOutputUse -> RecipeStep(recipeId, stepNum)), a trigger, and D1's internal _cf_KV table.
const SCHEMA = `
  CREATE TABLE "Ingredient" ("id" TEXT NOT NULL PRIMARY KEY, "unitId" TEXT NOT NULL REFERENCES "Unit" ("id"));
  CREATE TABLE "Unit" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT);
  CREATE TABLE "Recipe" ("id" TEXT NOT NULL PRIMARY KEY, "title" TEXT NOT NULL, "activeCoverId" TEXT);
  CREATE TABLE "RecipeStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipeId" TEXT NOT NULL REFERENCES "Recipe" ("id") ON DELETE CASCADE,
    "stepNum" INTEGER NOT NULL,
    "description" TEXT
  );
  CREATE UNIQUE INDEX "RecipeStep_recipeId_stepNum_key" ON "RecipeStep"("recipeId", "stepNum");
  CREATE TABLE "StepOutputUse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipeId" TEXT NOT NULL,
    "outputStepNum" INTEGER NOT NULL,
    "inputStepNum" INTEGER NOT NULL,
    FOREIGN KEY ("recipeId", "outputStepNum") REFERENCES "RecipeStep" ("recipeId", "stepNum") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE INDEX "StepOutputUse_recipeId_idx" ON "StepOutputUse"("recipeId");
  CREATE TABLE "RecipeCover" ("id" TEXT NOT NULL PRIMARY KEY, "recipeId" TEXT NOT NULL);
  CREATE TRIGGER "Recipe_activeCover_delete_set_null" AFTER DELETE ON "RecipeCover"
  BEGIN UPDATE "Recipe" SET "activeCoverId" = NULL WHERE "activeCoverId" = OLD."id"; END;
  CREATE VIRTUAL TABLE "SearchDocument" USING fts5(entityId UNINDEXED, title);
  CREATE TABLE "_cf_KV" ("key" TEXT PRIMARY KEY, "value" BLOB);
`;

function sqlLiteral(value: unknown) {
  if (value === null) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * A fake `pnpm exec wrangler ...` over a real SQLite database: `d1 execute --json --command`
 * runs the query; `d1 export --table ... [--no-data|--no-schema]` writes what wrangler writes for
 * those tables (CREATE TABLE statements and INSERT rows, no indexes or triggers), and refuses a
 * whole-database export when there is a virtual table, as wrangler does.
 */
function fakeWrangler(db: Database.Database, options: { afterExport?: () => void } = {}) {
  return vi.fn(async (_command: string, args: string[]) => {
    if (args.includes("execute")) {
      const sql = args[args.indexOf("--command") + 1];
      return { stdout: `noise before json\n${JSON.stringify([{ success: true, results: db.prepare(sql).all() }])}`, stderr: "" };
    }
    const requested = args.flatMap((arg, index) => (args[index - 1] === "--table" ? [arg] : []));
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY rowid`).all() as { name: string }[])
      .map(({ name }) => name)
      .filter((name) => requested.includes(name));
    if (requested.length === 0) throw new Error("D1 Export error: cannot export databases with virtual tables (like FTS5)");
    const output = args[args.indexOf("--output") + 1];
    const lines: string[] = [];
    for (const table of tables) {
      if (!args.includes("--no-schema")) {
        const { sql } = db.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(table) as { sql: string };
        lines.push(`${sql.replace(/^CREATE TABLE/, "CREATE TABLE IF NOT EXISTS")};`);
      }
      if (!args.includes("--no-data")) {
        for (const row of db.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[]) {
          const columns = Object.keys(row).map((column) => `"${column}"`).join(",");
          lines.push(`INSERT INTO "${table}" (${columns}) VALUES(${Object.values(row).map(sqlLiteral).join(",")});`);
        }
      }
    }
    await writeFile(output, lines.join("\n"));
    options.afterExport?.();
    return { stdout: "", stderr: "" };
  });
}

/** Imports an export the way D1 does: one database, foreign keys enforced. */
function importIntoFreshD1(sql: string) {
  const restored = new Database(":memory:");
  restored.pragma("foreign_keys = ON");
  restored.exec(sql);
  return restored;
}

const fs = { mkdtemp, readFile, rm, writeFile };

describe("d1-logical-export", () => {
  let source: Database.Database;
  let dir: string;

  beforeEach(async () => {
    source = new Database(":memory:");
    source.exec(SCHEMA);
    source.exec(`
      INSERT INTO "Unit" VALUES ('cup', 'cup');
      INSERT INTO "Ingredient" VALUES ('i1', 'cup');
      INSERT INTO "Recipe" VALUES ('r1', 'Grandma''s Stew', 'c1');
      INSERT INTO "RecipeStep" VALUES ('s1', 'r1', 1, 'Brown the beef' || char(10) || 'INSERT INTO "Recipe" it''s fine'), ('s2', 'r1', 2, NULL);
      INSERT INTO "StepOutputUse" VALUES ('o1', 'r1', 1, 2);
      INSERT INTO "RecipeCover" VALUES ('c1', 'r1');
      INSERT INTO "SearchDocument" VALUES ('r1', 'Grandma''s Stew');
    `);
    dir = await mkdtemp(join(tmpdir(), "d1-export-test-"));
  });

  afterEach(async () => {
    source.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("exports a database with an FTS5 table into SQL that restores the tables, rows, indexes and trigger", async () => {
    const output = join(dir, "export.sql");
    const log = vi.fn();
    const exec = fakeWrangler(source);

    const plan = await exportDatabase({ target: "qa", output, exec, fs, log });

    expect(plan.skipped).toEqual(["SearchDocument", "SearchDocument_config", "SearchDocument_content", "SearchDocument_data", "SearchDocument_docsize", "SearchDocument_idx", "_cf_KV"]);
    expect(exec.mock.calls.filter(([, args]) => args.includes("export")).map(([, args]) => args.slice(0, 8)))
      .toEqual([
        ["exec", "wrangler", "d1", "export", "DB", "--remote", "--env", "qa"],
        ["exec", "wrangler", "d1", "export", "DB", "--remote", "--env", "qa"],
      ]);

    expect((await stat(output)).mode & 0o777).toBe(0o600);
    const restored = importIntoFreshD1(await readFile(output, "utf8"));
    expect(restored.prepare(`SELECT * FROM "StepOutputUse"`).all()).toEqual([{ id: "o1", recipeId: "r1", outputStepNum: 1, inputStepNum: 2 }]);
    expect(restored.prepare(`SELECT "description" FROM "RecipeStep" ORDER BY "stepNum"`).all()).toEqual([{ description: 'Brown the beef\nINSERT INTO "Recipe" it\'s fine' }, { description: null }]);
    expect(restored.prepare(`SELECT "title" FROM "Recipe"`).get()).toEqual({ title: "Grandma's Stew" });
    expect(restored.prepare(`SELECT * FROM "Ingredient"`).all()).toEqual([{ id: "i1", unitId: "cup" }]);
    expect(restored.pragma("foreign_key_check")).toEqual([]);
    // The unique index and the trigger came back too.
    expect(() => restored.exec(`INSERT INTO "RecipeStep" VALUES ('s3', 'r1', 1, 'duplicate')`)).toThrow(/UNIQUE/);
    restored.exec(`DELETE FROM "RecipeCover" WHERE "id" = 'c1'`);
    expect(restored.prepare(`SELECT "activeCoverId" FROM "Recipe"`).get()).toEqual({ activeCoverId: null });
    // The search index is derived and is not in the export; the app rebuilds it.
    expect(restored.prepare(`SELECT name FROM sqlite_master WHERE name LIKE 'SearchDocument%' OR name = '_cf_KV'`).all()).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Exported 6 tables with 3 indexes and triggers"));
  });

  it("puts the indexes before the rows, because D1 refuses rows whose foreign key has no unique parent index yet", async () => {
    const output = join(dir, "export.sql");
    await exportDatabase({ target: "production", output, exec: fakeWrangler(source), fs, log: vi.fn() });
    const sql = await readFile(output, "utf8");

    expect(sql.indexOf("RecipeStep_recipeId_stepNum_key")).toBeLessThan(sql.indexOf(`INSERT INTO "StepOutputUse"`));

    // Rows first and indexes last, as appending to wrangler's own `--table` export would give.
    const tablesThenRows = sql.replace(/^CREATE (UNIQUE )?INDEX.*$/gm, "").replace(/^CREATE TRIGGER[\s\S]*?END;$/gm, "");
    expect(() => importIntoFreshD1(tablesThenRows)).toThrow(/foreign key mismatch/);
  });

  it("writes parent rows before child rows, though wrangler writes them in table-creation order", async () => {
    const output = join(dir, "export.sql");
    await exportDatabase({ target: "qa", output, exec: fakeWrangler(source), fs, log: vi.fn() });
    const sql = await readFile(output, "utf8");

    expect(sql.indexOf(`INSERT INTO "Unit"`)).toBeLessThan(sql.indexOf(`INSERT INTO "Ingredient"`));
    // Remote D1 checks foreign keys as rows arrive; SQLite with foreign keys on, without deferral,
    // refuses the same rows in wrangler's order.
    const restored = new Database(":memory:");
    restored.pragma("foreign_keys = ON");
    restored.exec(sql.replace(/^PRAGMA defer_foreign_keys.*$/gm, ""));
    expect(restored.prepare(`SELECT count(*) AS n FROM "Ingredient"`).get()).toEqual({ n: 1 });
    const wranglerOrder = `CREATE TABLE "Ingredient" ("id" TEXT PRIMARY KEY, "unitId" TEXT REFERENCES "Unit" ("id"));
      CREATE TABLE "Unit" ("id" TEXT PRIMARY KEY);
      INSERT INTO "Ingredient" VALUES ('i1', 'cup');
      INSERT INTO "Unit" VALUES ('cup');`;
    const strict = new Database(":memory:");
    strict.pragma("foreign_keys = ON");
    expect(() => strict.exec(wranglerOrder)).toThrow(/FOREIGN KEY/);
  });

  it("orders tables parents first, keeping creation order for cycles and ignoring self-references", () => {
    const table = (name: string, sql: string) => ({ type: "table", name, tbl_name: name, sql });
    const schema = [
      table("Child", `CREATE TABLE "Child" ("p" TEXT REFERENCES "Parent"("id"), "o" TEXT REFERENCES 'Outside'("id"))`),
      table("A", `CREATE TABLE "A" ("b" TEXT REFERENCES "B"("id"))`),
      table("B", `CREATE TABLE B ("a" TEXT REFERENCES A(id), "self" TEXT REFERENCES "B"("id"))`),
      table("Parent", `CREATE TABLE "Parent" ("id" TEXT PRIMARY KEY, "up" TEXT REFERENCES "Parent"("id"))`),
      table("NoSql", null as unknown as string),
    ];

    expect(tableOrder(schema, ["Child", "A", "B", "Parent", "NoSql"])).toEqual(["Parent", "Child", "NoSql", "A", "B"]);
  });

  it("regroups INSERT statements by table, keeping multi-line values and the preamble", () => {
    const rows = [
      "PRAGMA defer_foreign_keys=TRUE;",
      `INSERT INTO "Child" VALUES('c1','line one`,
      `line two');`,
      `INSERT INTO "Parent" VALUES('p1');`,
      `INSERT INTO "Child" VALUES('c2','x');`,
    ].join("\n");

    expect(orderRows(rows, ["Parent", "Child", "Empty"]).split("\n")).toEqual([
      "PRAGMA defer_foreign_keys=TRUE;",
      `INSERT INTO "Parent" VALUES('p1');`,
      `INSERT INTO "Child" VALUES('c1','line one`,
      `line two');`,
      `INSERT INTO "Child" VALUES('c2','x');`,
    ]);
    expect(() => orderRows(rows, ["Parent"])).toThrow("The export has rows for unexpected tables: Child.");

    // A value with a line that reads like a statement stays in its row.
    const tricky = [
      `INSERT INTO "Child" VALUES('c1','Step: it''s done`,
      `INSERT INTO "Parent" VALUES(''p9'');`,
      `still the same value');`,
      `INSERT INTO "Parent" VALUES('p1');`,
    ].join("\n");
    expect(orderRows(tricky, ["Parent", "Child"]).split("\n")).toEqual([
      `INSERT INTO "Parent" VALUES('p1');`,
      `INSERT INTO "Child" VALUES('c1','Step: it''s done`,
      `INSERT INTO "Parent" VALUES(''p9'');`,
      `still the same value');`,
    ]);
  });

  it("reads production from the default environment", async () => {
    const exec = fakeWrangler(source);
    await exportDatabase({ target: "production", output: join(dir, "p.sql"), exec, fs, log: vi.fn() });

    expect(exec.mock.calls[0]![1]).toEqual(["exec", "wrangler", "d1", "execute", "DB", "--remote", "--json", "--command", SCHEMA_SQL]);
  });

  it("refuses an export when the schema changed while it ran", async () => {
    const exec = fakeWrangler(source, { afterExport: () => source.exec(`CREATE TABLE IF NOT EXISTS "Added" ("id" TEXT)`) });

    await expect(exportDatabase({ target: "qa", output: join(dir, "x.sql"), exec, fs, log: vi.fn() }))
      .rejects.toThrow("The database schema changed during the export; run it again.");
  });

  it("refuses an export that is missing a table, or a database with no tables", async () => {
    const exec = vi.fn(async (_command: string, args: string[]) => {
      if (args.includes("execute")) return { stdout: JSON.stringify([{ success: true, results: source.prepare(SCHEMA_SQL).all() }]), stderr: "" };
      await writeFile(args[args.indexOf("--output") + 1]!, `CREATE TABLE "Recipe" ("id" TEXT);`);
      return { stdout: "", stderr: "" };
    });
    await expect(exportDatabase({ target: "qa", output: join(dir, "x.sql"), exec, fs, log: vi.fn() }))
      .rejects.toThrow("The export is missing tables: Ingredient, RecipeCover, RecipeStep, StepOutputUse, Unit.");

    const empty = new Database(":memory:");
    await expect(exportDatabase({ target: "qa", output: join(dir, "y.sql"), exec: fakeWrangler(empty), fs, log: vi.fn() }))
      .rejects.toThrow("The database has no tables to export.");
    const noResults = vi.fn(async () => ({ stdout: "[]", stderr: "" }));
    await expect(exportDatabase({ target: "qa", output: join(dir, "z.sql"), exec: noResults, fs, log: vi.fn() }))
      .rejects.toThrow("The database has no tables to export.");
  });

  it("plans a database without derived tables", () => {
    expect(planExport([
      { type: "table", name: "Unit", tbl_name: "Unit", sql: `CREATE TABLE "Unit" ("id" TEXT PRIMARY KEY)` },
      { type: "table", name: "Odd", tbl_name: "Odd", sql: null },
      { type: "index", name: "sqlite_autoindex_Unit_1", tbl_name: "Unit", sql: null },
      { type: "trigger", name: "Unit_t", tbl_name: "Unit", sql: "CREATE TRIGGER Unit_t AFTER INSERT ON Unit BEGIN SELECT 1; END;" },
      { type: "index", name: "Unit_a", tbl_name: "Unit", sql: `CREATE INDEX "Unit_a" ON "Unit"("id")` },
      { type: "index", name: "Unit_b", tbl_name: "Unit", sql: `CREATE INDEX "Unit_b" ON "Unit"("id")` },
    ])).toEqual({
      tables: ["Unit", "Odd"],
      skipped: [],
      extras: [`CREATE INDEX "Unit_a" ON "Unit"("id");`, `CREATE INDEX "Unit_b" ON "Unit"("id");`, "CREATE TRIGGER Unit_t AFTER INSERT ON Unit BEGIN SELECT 1; END;"],
    });
  });

  it("says when nothing was skipped", async () => {
    const plain = new Database(":memory:");
    plain.exec(`CREATE TABLE "Unit" ("id" TEXT PRIMARY KEY); INSERT INTO "Unit" VALUES ('cup');`);
    const log = vi.fn();
    const output = join(dir, "plain.sql");

    await exportDatabase({ target: "qa", output, exec: fakeWrangler(plain), fs, log });

    expect(await readFile(output, "utf8")).toContain("rebuilt by the app after a restore): none.");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("skipped nothing"));
  });

  it("recognizes a created table however wrangler quotes its name", () => {
    expect(createsTable(`CREATE TABLE d1_migrations(\n id INTEGER)`, "d1_migrations")).toBe(true);
    expect(createsTable(`CREATE TABLE IF NOT EXISTS "User" (`, "User")).toBe(true);
    expect(createsTable(`CREATE TABLE 'SearchDocument_data'(id)`, "SearchDocument_data")).toBe(true);
    expect(createsTable(`CREATE TABLE "UserCredential" (`, "User")).toBe(false);
    expect(createsTable(`CREATE TABLE "a.b" (`, "a.b")).toBe(true);
    expect(createsTable(`CREATE TABLE "axb" (`, "a.b")).toBe(false);
  });

  it("parses its arguments", () => {
    expect(parseExportArgs(["--target", "qa", "--output", "/tmp/x.sql"])).toEqual({ target: "qa", output: "/tmp/x.sql" });
    expect(parseExportArgs(["--output", "x.sql", "--target", "production"])).toEqual({ target: "production", output: "x.sql" });
    expect(() => parseExportArgs(["--target", "staging", "--output", "x.sql"])).toThrow("Usage: d1-logical-export.mjs");
    expect(() => parseExportArgs(["--target", "qa"])).toThrow("needs --output");
    expect(() => parseExportArgs(["--target", "qa", "--output", "--x"])).toThrow("needs --output");
    expect(targetFlags("qa")).toEqual(["--remote", "--env", "qa"]);
    expect(targetFlags("production")).toEqual(["--remote"]);
  });

  it("reads wrangler's JSON output and refuses a failed statement", () => {
    expect(parseWranglerJson(`log line\n[{"success":true,"results":[1]}]`)).toEqual([{ success: true, results: [1] }]);
    expect(() => parseWranglerJson("no json")).toThrow("wrangler returned no JSON results.");
    expect(() => parseWranglerJson(`[{"success":false}]`)).toThrow("wrangler reported a failed statement.");
  });
});
