import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { sqliteD1, type SqliteD1 } from "./sqlite-d1";

const MIGRATIONS_DIRECTORY = resolve(__dirname, "../../migrations");

export interface MigratedSqlite extends SqliteD1 {
  /** Direct access for arranging rows and reading results. Foreign keys are enforced. */
  sqlite: Database.Database;
}

/**
 * A fresh in-memory SQLite database built by applying every file in `migrations/` in order, as
 * production D1 was, with foreign keys on (D1 enforces them). Unlike `prisma db push`, it has the
 * exact constraints, triggers and ON DELETE actions the migrations created.
 */
export function migratedSqliteD1(): MigratedSqlite {
  const sqlite = new Database(":memory:");
  for (const file of readdirSync(MIGRATIONS_DIRECTORY).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS_DIRECTORY, file), "utf8"));
  }
  sqlite.pragma("foreign_keys = ON");
  return { ...sqliteD1(sqlite), sqlite };
}
