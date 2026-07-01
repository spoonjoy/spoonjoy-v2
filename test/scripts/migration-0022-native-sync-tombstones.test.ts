import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "..",
  "migrations",
  "0022_native_sync_tombstones.sql",
);

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface ForeignKeyRow {
  table: string;
  from: string;
  on_delete: string;
}

interface IndexListRow {
  name: string;
  unique: number;
}

interface IndexInfoRow {
  name: string;
}

function freshDb(): DatabaseSyncType {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY
    );
  `);
  return db;
}

function tableColumns(db: DatabaseSyncType): Record<string, TableInfoRow> {
  const rows = db.prepare(`PRAGMA table_info("NativeSyncTombstone")`).all() as unknown as TableInfoRow[];
  return Object.fromEntries(rows.map((row) => [row.name, row]));
}

function indexColumns(db: DatabaseSyncType, indexName: string): string[] {
  return (db.prepare(`PRAGMA index_info("${indexName}")`).all() as unknown as IndexInfoRow[])
    .map((row) => row.name);
}

function hasIndex(db: DatabaseSyncType, columns: string[], unique = false): boolean {
  const indexes = db.prepare(`PRAGMA index_list("NativeSyncTombstone")`).all() as unknown as IndexListRow[];
  return indexes.some((index) => index.unique === (unique ? 1 : 0) && indexColumns(db, index.name).join("|") === columns.join("|"));
}

describe("migration 0022 — native sync tombstones", () => {
  let db: DatabaseSyncType;

  beforeAll(() => {
    db = freshDb();
    db.exec(readFileSync(MIGRATION_PATH, "utf8"));
  });

  it("creates durable delete fields for native offline sync", () => {
    const cols = tableColumns(db);

    expect(cols.id).toMatchObject({ type: "TEXT", notnull: 1, pk: 1 });
    expect(cols.accountId).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.resourceType).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.resourceId).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.parentResourceId).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.title).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.deletedAt).toMatchObject({ type: "DATETIME", notnull: 1 });
    expect(cols.updatedAt).toMatchObject({ type: "DATETIME", notnull: 1, dflt_value: "CURRENT_TIMESTAMP" });
    expect(cols.createdAt).toMatchObject({ type: "DATETIME", notnull: 1, dflt_value: "CURRENT_TIMESTAMP" });
  });

  it("links tombstones to the owning account with cascade cleanup", () => {
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list("NativeSyncTombstone")`).all() as unknown as ForeignKeyRow[];
    expect(foreignKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "User", from: "accountId", on_delete: "CASCADE" }),
    ]));

    db.exec(`INSERT INTO "User" ("id") VALUES ('user_1');`);
    db.exec(`
      INSERT INTO "NativeSyncTombstone"
        ("id", "accountId", "resourceType", "resourceId", "title", "deletedAt", "updatedAt")
      VALUES
        ('tomb_1', 'user_1', 'recipe', 'recipe_1', 'Deleted soup', '2026-07-01T10:00:00.000Z', '2026-07-01T10:00:00.000Z');
    `);
    db.exec(`DELETE FROM "User" WHERE "id" = 'user_1';`);

    const remaining = db.prepare(`SELECT COUNT(*) AS count FROM "NativeSyncTombstone"`).get() as { count: number };
    expect(remaining.count).toBe(0);
  });

  it("creates native sync lookup and replay indexes", () => {
    expect(hasIndex(db, ["accountId", "resourceType", "resourceId"], true)).toBe(true);
    expect(hasIndex(db, ["accountId", "updatedAt", "resourceId"])).toBe(true);
    expect(hasIndex(db, ["accountId", "resourceType", "updatedAt"])).toBe(true);
  });

  it("rejects duplicate resource tombstones for one account", () => {
    db.exec(`INSERT INTO "User" ("id") VALUES ('user_2');`);
    db.exec(`
      INSERT INTO "NativeSyncTombstone"
        ("id", "accountId", "resourceType", "resourceId", "deletedAt", "updatedAt")
      VALUES
        ('tomb_2', 'user_2', 'cookbook', 'cookbook_1', '2026-07-01T11:00:00.000Z', '2026-07-01T11:00:00.000Z');
    `);

    expect(() => db.exec(`
      INSERT INTO "NativeSyncTombstone"
        ("id", "accountId", "resourceType", "resourceId", "deletedAt", "updatedAt")
      VALUES
        ('tomb_3', 'user_2', 'cookbook', 'cookbook_1', '2026-07-01T11:01:00.000Z', '2026-07-01T11:01:00.000Z');
    `)).toThrow();
  });
});
