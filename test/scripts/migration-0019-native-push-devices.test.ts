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
  "0019_native_push_devices.sql",
);

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
}

interface IndexListRow {
  name: string;
  unique: number;
}

interface IndexInfoRow {
  name: string;
}

interface ForeignKeyRow {
  from: string;
  table: string;
  on_delete: string;
}

function freshDb(): DatabaseSyncType {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL,
      "username" TEXT NOT NULL
    );
  `);
  return db;
}

function tableColumns(db: DatabaseSyncType, tableName: string): Record<string, TableInfoRow> {
  const rows = db.prepare(`PRAGMA table_info("${tableName}")`).all() as unknown as TableInfoRow[];
  return Object.fromEntries(rows.map((row) => [row.name, row]));
}

function indexColumns(db: DatabaseSyncType, indexName: string): string[] {
  return (db.prepare(`PRAGMA index_info("${indexName}")`).all() as unknown as IndexInfoRow[])
    .map((row) => row.name);
}

function hasIndex(db: DatabaseSyncType, tableName: string, columns: string[], unique: boolean): boolean {
  const indexes = db.prepare(`PRAGMA index_list("${tableName}")`).all() as unknown as IndexListRow[];
  return indexes.some((index) => (
    index.unique === (unique ? 1 : 0) &&
    indexColumns(db, index.name).join("|") === columns.join("|")
  ));
}

describe("migration 0019 — native push devices", () => {
  let db: DatabaseSyncType;

  beforeAll(() => {
    db = freshDb();
    db.exec(readFileSync(MIGRATION_PATH, "utf8"));
  });

  it("creates the APNs-specific device columns without web-push key fields", () => {
    const cols = tableColumns(db, "NativePushDevice");

    expect(cols.userId).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.deviceId).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.platform).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.environment).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.tokenHash).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.tokenPrefix).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.enabledAt).toMatchObject({ type: "DATETIME", notnull: 1 });
    expect(cols.revokedAt).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.lastRegisteredAt).toMatchObject({ type: "DATETIME", notnull: 1 });
    expect(cols.endpoint).toBeUndefined();
    expect(cols.p256dh).toBeUndefined();
    expect(cols.authSecret).toBeUndefined();
  });

  it("creates uniqueness and lookup indexes used by native registration", () => {
    expect(hasIndex(db, "NativePushDevice", ["userId", "deviceId", "platform", "environment"], true)).toBe(true);
    expect(hasIndex(db, "NativePushDevice", ["userId"], false)).toBe(true);
    expect(hasIndex(db, "NativePushDevice", ["tokenHash"], false)).toBe(true);
    expect(hasIndex(db, "NativePushDevice", ["userId", "platform", "environment"], false)).toBe(true);
  });

  it("cascades native devices when the owning user is removed", () => {
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list("NativePushDevice")`).all() as unknown as ForeignKeyRow[];
    expect(foreignKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "userId", table: "User", on_delete: "CASCADE" }),
    ]));

    db.exec(`INSERT INTO "User" ("id", "email", "username") VALUES ('u1', 'a@example.com', 'chef');`);
    db.exec(`
      INSERT INTO "NativePushDevice"
        ("id", "userId", "deviceId", "platform", "environment", "tokenHash", "tokenPrefix")
      VALUES
        ('d1', 'u1', 'ios-device', 'ios', 'development', 'hash', 'apns-prefix');
    `);
    db.exec(`DELETE FROM "User" WHERE "id" = 'u1';`);

    const remaining = db.prepare(`SELECT COUNT(*) AS count FROM "NativePushDevice"`).get() as { count: number };
    expect(remaining.count).toBe(0);
  });
});
