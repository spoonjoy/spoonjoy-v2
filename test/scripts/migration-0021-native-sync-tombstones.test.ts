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
  "0021_native_sync_tombstones.sql",
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

describe("migration 0021 - native sync tombstones", () => {
  let db: DatabaseSyncType;

  beforeAll(() => {
    db = freshDb();
    db.exec(readFileSync(MIGRATION_PATH, "utf8"));
  });

  it("creates durable per-account tombstone fields for private native sync", () => {
    const cols = tableColumns(db);

    expect(cols.id).toMatchObject({ type: "TEXT", notnull: 1, pk: 1 });
    expect(cols.userId).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.resourceType).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.resourceId).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.parentResourceId).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.title).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.deletedAt).toMatchObject({ type: "DATETIME", notnull: 1 });
    expect(cols.updatedAt).toMatchObject({ type: "DATETIME", notnull: 1 });
    expect(cols.createdAt).toMatchObject({ type: "DATETIME", notnull: 1, dflt_value: "CURRENT_TIMESTAMP" });
  });

  it("links tombstones to the owning user without depending on idempotency rows", () => {
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list("NativeSyncTombstone")`).all() as unknown as ForeignKeyRow[];
    expect(foreignKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "User", from: "userId", on_delete: "CASCADE" }),
    ]));

    db.exec(`INSERT INTO "User" ("id") VALUES ('user_1');`);
    db.exec(`
      INSERT INTO "NativeSyncTombstone"
        ("id", "userId", "resourceType", "resourceId", "parentResourceId", "title", "deletedAt", "updatedAt")
      VALUES
        ('native_tomb_1', 'user_1', 'cookbook', 'cookbook_1', NULL, 'Weeknight', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z');
    `);
    db.exec(`DELETE FROM "User" WHERE "id" = 'user_1';`);

    const remaining = db.prepare(`SELECT COUNT(*) AS count FROM "NativeSyncTombstone"`).get() as { count: number };
    expect(remaining.count).toBe(0);
  });

  it("creates account uniqueness and incremental lookup indexes", () => {
    expect(hasIndex(db, ["userId", "resourceType", "resourceId"], true)).toBe(true);
    expect(hasIndex(db, ["userId", "updatedAt"])).toBe(true);
    expect(hasIndex(db, ["resourceType", "resourceId"])).toBe(true);
  });

  it("rejects duplicate tombstones for the same account resource", () => {
    db.exec(`INSERT INTO "User" ("id") VALUES ('user_2'), ('user_3');`);
    db.exec(`
      INSERT INTO "NativeSyncTombstone"
        ("id", "userId", "resourceType", "resourceId", "deletedAt", "updatedAt")
      VALUES
        ('native_tomb_2', 'user_2', 'cookbook', 'cookbook_2', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z');
    `);
    expect(() => db.exec(`
      INSERT INTO "NativeSyncTombstone"
        ("id", "userId", "resourceType", "resourceId", "deletedAt", "updatedAt")
      VALUES
        ('native_tomb_3', 'user_2', 'cookbook', 'cookbook_2', '2026-06-01T00:01:00.000Z', '2026-06-01T00:01:00.000Z');
    `)).toThrow();

    expect(() => db.exec(`
      INSERT INTO "NativeSyncTombstone"
        ("id", "userId", "resourceType", "resourceId", "deletedAt", "updatedAt")
      VALUES
        ('native_tomb_4', 'user_3', 'cookbook', 'cookbook_2', '2026-06-01T00:01:00.000Z', '2026-06-01T00:01:00.000Z');
    `)).not.toThrow();
  });
});
