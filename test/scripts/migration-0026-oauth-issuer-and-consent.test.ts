import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";

type DatabaseSyncType = InstanceType<typeof DatabaseSync>;

const ROOT_D1_MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "..",
  "migrations",
  "0026_oauth_issuer_and_consent.sql",
);
const PRISMA_MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "..",
  "prisma",
  "migrations",
  "20260829220500_oauth_issuer_binding",
  "migration.sql",
);

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
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
  on_update: string;
}

function freshDb(): DatabaseSyncType {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY
    );
    CREATE TABLE "OAuthClient" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "clientName" TEXT,
      "redirectUris" TEXT NOT NULL,
      "revokedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "OAuthAuthCode" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "codeHash" TEXT NOT NULL,
      "clientId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "redirectUri" TEXT NOT NULL,
      "codeChallenge" TEXT NOT NULL,
      "scope" TEXT NOT NULL,
      "resource" TEXT,
      "expiresAt" DATETIME NOT NULL,
      "consumedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "OAuthRefreshToken" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "tokenHash" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "clientId" TEXT NOT NULL,
      "scope" TEXT NOT NULL,
      "resource" TEXT,
      "connectionKey" TEXT,
      "revokedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "ApiCredential" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "tokenHash" TEXT NOT NULL,
      "tokenPrefix" TEXT NOT NULL,
      "scopes" TEXT NOT NULL,
      "oauthClientId" TEXT,
      "oauthResource" TEXT,
      "lastUsedAt" DATETIME,
      "revokedAt" DATETIME,
      "expiresAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO "User" ("id") VALUES ('legacy-user'), ('consent-user');
    INSERT INTO "OAuthClient" ("id", "clientName", "redirectUris")
      VALUES ('legacy-client', 'Legacy client', '["https://client.example/callback"]');
    INSERT INTO "OAuthAuthCode" (
      "id", "codeHash", "clientId", "userId", "redirectUri", "codeChallenge", "scope", "expiresAt"
    ) VALUES (
      'legacy-code', 'code-hash', 'legacy-client', 'legacy-user',
      'https://client.example/callback', 'challenge', 'kitchen:read', '2026-08-30T00:00:00.000Z'
    );
    INSERT INTO "OAuthRefreshToken" ("id", "tokenHash", "userId", "clientId", "scope")
      VALUES ('legacy-refresh', 'refresh-hash', 'legacy-user', 'legacy-client', 'kitchen:read');
    INSERT INTO "ApiCredential" (
      "id", "userId", "name", "tokenHash", "tokenPrefix", "scopes", "oauthClientId"
    ) VALUES (
      'legacy-credential', 'legacy-user', 'Legacy credential', 'credential-hash', 'sj_legacy',
      'kitchen:read', 'legacy-client'
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
  return indexes.some((index) => (
    index.unique === 0 && indexColumns(db, index.name).join("|") === columns.join("|")
  ));
}

const MIGRATIONS = [
  ["root D1 migration", ROOT_D1_MIGRATION_PATH],
  ["Prisma migration", PRISMA_MIGRATION_PATH],
] as const;

describe("migration 0026 copies", () => {
  it("keeps the root D1 and Prisma SQL identical", () => {
    expect(readFileSync(ROOT_D1_MIGRATION_PATH, "utf8"))
      .toBe(readFileSync(PRISMA_MIGRATION_PATH, "utf8"));
  });
});

describe.each(MIGRATIONS)("migration 0026 — OAuth issuer and consent (%s)", (_label, migrationPath) => {
  let db: DatabaseSyncType;
  let migrationSql: string;

  beforeEach(() => {
    db = freshDb();
    migrationSql = readFileSync(migrationPath, "utf8");
    db.exec(migrationSql);
  });

  afterEach(() => {
    db.close();
  });

  it("adds nullable issuer and connection ownership fields without a hostname or default and preserves legacy rows", () => {
    expect(() => assertAdditiveMigrationSql("0026_oauth_issuer_and_consent.sql", migrationSql)).not.toThrow();
    expect(migrationSql.toLowerCase()).not.toContain("spoonjoy.app");
    expect(migrationSql).not.toMatch(/"(?:issuer|oauthIssuer)"\s+TEXT\s+DEFAULT\b/i);

    for (const [tableName, columnName] of [
      ["OAuthClient", "issuer"],
      ["OAuthAuthCode", "issuer"],
      ["OAuthRefreshToken", "issuer"],
      ["ApiCredential", "oauthIssuer"],
      ["ApiCredential", "oauthConnectionKey"],
    ] as const) {
      expect(tableColumns(db, tableName)[columnName]).toMatchObject({
        type: "TEXT",
        notnull: 0,
        dflt_value: null,
      });
    }

    expect(db.prepare(`SELECT "issuer" FROM "OAuthClient" WHERE "id" = 'legacy-client'`).get())
      .toEqual({ issuer: null });
    expect(db.prepare(`SELECT "issuer" FROM "OAuthAuthCode" WHERE "id" = 'legacy-code'`).get())
      .toEqual({ issuer: null });
    expect(db.prepare(`SELECT "issuer" FROM "OAuthRefreshToken" WHERE "id" = 'legacy-refresh'`).get())
      .toEqual({ issuer: null });
    expect(db.prepare(`SELECT "oauthIssuer", "oauthConnectionKey" FROM "ApiCredential" WHERE "id" = 'legacy-credential'`).get())
      .toEqual({ oauthIssuer: null, oauthConnectionKey: null });
  });

  it("creates a complete one-time consent snapshot with cascading user ownership", () => {
    const columns = tableColumns(db, "OAuthConsentTransaction");
    expect(Object.keys(columns)).toEqual([
      "tokenHash",
      "userId",
      "issuer",
      "clientId",
      "redirectUri",
      "state",
      "scope",
      "codeChallenge",
      "resource",
      "expiresAt",
    ]);
    expect(columns.tokenHash).toMatchObject({ type: "TEXT", notnull: 1, pk: 1 });
    for (const columnName of [
      "userId",
      "issuer",
      "clientId",
      "redirectUri",
      "state",
      "scope",
      "codeChallenge",
      "expiresAt",
    ]) {
      expect(columns[columnName].notnull).toBe(1);
    }
    expect(columns.resource).toMatchObject({ type: "TEXT", notnull: 0, dflt_value: null });

    const foreignKeys = db.prepare(`PRAGMA foreign_key_list("OAuthConsentTransaction")`)
      .all() as unknown as ForeignKeyRow[];
    expect(foreignKeys).toContainEqual(expect.objectContaining({
      from: "userId",
      table: "User",
      on_delete: "CASCADE",
      on_update: "CASCADE",
    }));

    db.prepare(`
      INSERT INTO "OAuthConsentTransaction" (
        "tokenHash", "userId", "issuer", "clientId", "redirectUri", "state", "scope",
        "codeChallenge", "resource", "expiresAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "consent-hash",
      "consent-user",
      "https://issuer.example",
      "legacy-client",
      "https://client.example/callback",
      "state-value",
      "kitchen:read",
      "challenge",
      "https://issuer.example/mcp",
      "2026-08-30T00:00:00.000Z",
    );
    db.prepare(`DELETE FROM "User" WHERE "id" = ?`).run("consent-user");

    expect(db.prepare(`SELECT COUNT(*) AS "count" FROM "OAuthConsentTransaction"`).get())
      .toEqual({ count: 0 });
  });

  it("creates the issuer and consent cleanup indexes", () => {
    expect(hasIndex(db, "OAuthConsentTransaction", ["expiresAt"])).toBe(true);
    expect(hasIndex(db, "OAuthConsentTransaction", ["userId", "expiresAt"])).toBe(true);
    expect(hasIndex(db, "ApiCredential", ["oauthConnectionKey"])).toBe(true);
  });

});
