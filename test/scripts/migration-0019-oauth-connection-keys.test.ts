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
  "0019_oauth_connection_keys.sql",
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

function freshDb(): DatabaseSyncType {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE "OAuthRefreshToken" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "tokenHash" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "clientId" TEXT NOT NULL,
      "scope" TEXT NOT NULL,
      "resource" TEXT,
      "revokedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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

function hasIndex(db: DatabaseSyncType, tableName: string, columns: string[]): boolean {
  const indexes = db.prepare(`PRAGMA index_list("${tableName}")`).all() as unknown as IndexListRow[];
  return indexes.some((index) => index.unique === 0 && indexColumns(db, index.name).join("|") === columns.join("|"));
}

describe("migration 0019 — OAuth connection keys", () => {
  let db: DatabaseSyncType;

  beforeAll(() => {
    db = freshDb();
    db.exec(readFileSync(MIGRATION_PATH, "utf8"));
  });

  it("adds nullable stable connection keys to refresh tokens", () => {
    const cols = tableColumns(db, "OAuthRefreshToken");

    expect(cols.connectionKey).toMatchObject({ type: "TEXT", notnull: 0 });
  });

  it("creates the connection-key lookup index", () => {
    expect(hasIndex(db, "OAuthRefreshToken", ["connectionKey"])).toBe(true);
  });
});
