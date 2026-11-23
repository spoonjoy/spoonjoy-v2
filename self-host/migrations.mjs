// Database migrations on start. Reads migrations/*.sql in name order, splits each file into
// statements, and records each applied file in a d1_migrations table, as `wrangler d1 migrations
// apply` does, so a self-hosted database carries the same history as spoonjoy.app's.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const MIGRATIONS_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)";

/** Every `.sql` file in `dir`, in name order, split into statements. */
export function migrationFiles(dir) {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, statements: splitSql(readFileSync(path.join(dir, name), "utf8")) }));
}

/**
 * Applies the files not yet recorded in d1_migrations, each as one D1 batch with its record, so a
 * file either applies whole or not at all.
 */
export async function applyMigrations(db, files) {
  await db.exec(MIGRATIONS_TABLE_SQL);
  const applied = new Set((await db.prepare("SELECT name FROM d1_migrations").all()).results.map((row) => row.name));
  let ran = 0;
  for (const file of files) {
    if (applied.has(file.name)) continue;
    await db.batch([
      ...file.statements.map((statement) => db.prepare(statement)),
      db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(file.name),
    ]);
    ran += 1;
  }
  return { ran, total: files.length };
}

/**
 * Splits SQL into statements on `;`, outside comments, quoted strings and identifiers, keeping a
 * CREATE TRIGGER body whole until its END.
 */
export function splitSql(sql) {
  const out = [];
  let current = "";
  let i = 0;
  const flush = () => {
    const statement = current.trim();
    if (statement && statement !== ";") out.push(statement);
    current = "";
  };
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      const newline = sql.indexOf("\n", i);
      i = newline === -1 ? sql.length : newline + 1;
      current += "\n";
      continue;
    }
    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      current += " ";
      continue;
    }
    if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === close) {
          if (close !== "]" && sql[j + 1] === close) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      current += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    current += c;
    i++;
    if (c === ";") {
      const normalized = current.replace(/\s+/g, " ").trim().toUpperCase();
      const isTrigger = /^CREATE (TEMP |TEMPORARY )?TRIGGER\b/.test(normalized);
      if (!isTrigger || /\bEND ?;$/.test(normalized)) flush();
    }
  }
  flush();
  return out;
}
