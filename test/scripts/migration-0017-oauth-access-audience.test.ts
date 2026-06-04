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
  "0017_oauth_access_audience.sql",
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
    CREATE TABLE "OAuthClient" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "clientName" TEXT,
      "redirectUris" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "OAuthRefreshToken" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "tokenHash" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "clientId" TEXT NOT NULL,
      "scope" TEXT NOT NULL,
      "revokedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "OAuthRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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

describe("migration 0017 — OAuth access-token audience", () => {
  let db: DatabaseSyncType;

  beforeAll(() => {
    db = freshDb();
    db.exec(readFileSync(MIGRATION_PATH, "utf8"));
  });

  it("adds nullable OAuth audience columns to API credentials", () => {
    const cols = tableColumns(db, "ApiCredential");

    expect(cols.oauthClientId).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.oauthResource).toMatchObject({ type: "TEXT", notnull: 0 });
  });

  it("adds nullable resource indicators to refresh tokens", () => {
    const cols = tableColumns(db, "OAuthRefreshToken");

    expect(cols.resource).toMatchObject({ type: "TEXT", notnull: 0 });
  });

  it("creates the lookup indexes account settings and auth checks use", () => {
    expect(hasIndex(db, "ApiCredential", ["oauthClientId"])).toBe(true);
    expect(hasIndex(db, "ApiCredential", ["oauthResource"])).toBe(true);
    expect(hasIndex(db, "OAuthRefreshToken", ["clientId"])).toBe(true);
  });
});
