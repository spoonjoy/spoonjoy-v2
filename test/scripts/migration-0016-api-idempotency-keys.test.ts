import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
type DatabaseSyncType = InstanceType<typeof DatabaseSync>;


const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "..",
  "migrations",
  "0016_api_idempotency_keys.sql",
);
const CLEANUP_PATH = resolve(__dirname, "..", "helpers", "cleanup.ts");
const SETUP_PATH = resolve(__dirname, "..", "setup.ts");

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
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL,
      "username" TEXT NOT NULL
    );
    CREATE TABLE "ApiCredential" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "tokenHash" TEXT NOT NULL,
      "tokenPrefix" TEXT NOT NULL,
      "scopes" TEXT NOT NULL DEFAULT 'kitchen:read kitchen:write',
      "lastUsedAt" DATETIME,
      "revokedAt" DATETIME,
      "expiresAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ApiCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);
  return db;
}

function tableColumns(db: DatabaseSyncType): Record<string, TableInfoRow> {
  const rows = db.prepare(`PRAGMA table_info("ApiIdempotencyKey")`).all() as unknown as TableInfoRow[];
  return Object.fromEntries(rows.map((row) => [row.name, row]));
}

function indexColumns(db: DatabaseSyncType, indexName: string): string[] {
  return (db.prepare(`PRAGMA index_info("${indexName}")`).all() as unknown as IndexInfoRow[])
    .map((row) => row.name);
}

function hasIndex(db: DatabaseSyncType, columns: string[], unique = false): boolean {
  const indexes = db.prepare(`PRAGMA index_list("ApiIdempotencyKey")`).all() as unknown as IndexListRow[];
  return indexes.some((index) => index.unique === (unique ? 1 : 0) && indexColumns(db, index.name).join("|") === columns.join("|"));
}

describe("migration 0016 — API idempotency keys", () => {
  let db: DatabaseSyncType;

  beforeAll(() => {
    db = freshDb();
    db.exec(readFileSync(MIGRATION_PATH, "utf8"));
  });

  it("creates the idempotency table with required and nullable fields", () => {
    const cols = tableColumns(db);

    expect(cols.id).toMatchObject({ type: "TEXT", notnull: 1, pk: 1 });
    expect(cols.userId).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.credentialId).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.clientKey).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.key).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.operation).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.requestHash).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.responseStatus).toMatchObject({ type: "INTEGER", notnull: 0 });
    expect(cols.responseBody).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.expiresAt).toMatchObject({ type: "DATETIME", notnull: 1 });
    expect(cols.createdAt).toMatchObject({ type: "DATETIME", notnull: 1, dflt_value: "CURRENT_TIMESTAMP" });
    expect(cols.updatedAt).toMatchObject({ type: "DATETIME", notnull: 1, dflt_value: "CURRENT_TIMESTAMP" });
  });

  it("sets cascade and set-null foreign key behavior", () => {
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list("ApiIdempotencyKey")`).all() as unknown as ForeignKeyRow[];

    expect(foreignKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "User", from: "userId", on_delete: "CASCADE" }),
      expect.objectContaining({ table: "ApiCredential", from: "credentialId", on_delete: "SET NULL" }),
    ]));
  });

  it("creates the replay unique tuple and query indexes", () => {
    expect(hasIndex(db, ["userId", "clientKey", "key"], true)).toBe(true);
    expect(hasIndex(db, ["userId", "createdAt"])).toBe(true);
    expect(hasIndex(db, ["credentialId"])).toBe(true);
    expect(hasIndex(db, ["expiresAt"])).toBe(true);
  });

  it("cleans idempotency rows before credentials in test setup hooks", () => {
    for (const path of [CLEANUP_PATH, SETUP_PATH]) {
      const source = readFileSync(path, "utf8");
      const idempotencyCleanup = source.indexOf("db.apiIdempotencyKey.deleteMany");
      const credentialCleanup = source.indexOf("db.apiCredential.deleteMany");

      expect(idempotencyCleanup).toBeGreaterThanOrEqual(0);
      expect(credentialCleanup).toBeGreaterThanOrEqual(0);
      expect(idempotencyCleanup).toBeLessThan(credentialCleanup);
    }
  });
});
