import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";

type Database = InstanceType<typeof DatabaseSync>;

const ROOT_MIGRATION = resolve(__dirname, "../../migrations/0027_oauth_grants_and_lineage.sql");
const PRISMA_MIGRATION = resolve(
  __dirname,
  "../../prisma/migrations/20260830060000_oauth_grants_and_lineage/migration.sql",
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
  partial: number;
}

interface IndexInfoRow {
  name: string;
}

function columns(db: Database, table: string): Record<string, TableInfoRow> {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as unknown as TableInfoRow[];
  return Object.fromEntries(rows.map((row) => [row.name, row]));
}

function indexColumns(db: Database, index: string): string[] {
  return (db.prepare(`PRAGMA index_info("${index}")`).all() as unknown as IndexInfoRow[])
    .map((row) => row.name);
}

function indexes(db: Database, table: string): Array<IndexListRow & { columns: string[] }> {
  return (db.prepare(`PRAGMA index_list("${table}")`).all() as unknown as IndexListRow[])
    .map((row) => ({ ...row, columns: indexColumns(db, row.name) }));
}

function freshPreExpansionDb(): Database {
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
      "issuer" TEXT,
      "revokedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "OAuthAuthCode" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "codeHash" TEXT NOT NULL UNIQUE,
      "clientId" TEXT NOT NULL,
      "issuer" TEXT,
      "userId" TEXT NOT NULL,
      "redirectUri" TEXT NOT NULL,
      "codeChallenge" TEXT NOT NULL,
      "scope" TEXT NOT NULL,
      "resource" TEXT,
      "expiresAt" DATETIME NOT NULL,
      "consumedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "OAuthAuthCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE TABLE "OAuthRefreshToken" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "tokenHash" TEXT NOT NULL UNIQUE,
      "userId" TEXT NOT NULL,
      "clientId" TEXT NOT NULL,
      "issuer" TEXT,
      "scope" TEXT NOT NULL,
      "resource" TEXT,
      "connectionKey" TEXT,
      "revokedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "OAuthRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE TABLE "ApiCredential" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "tokenHash" TEXT NOT NULL UNIQUE,
      "tokenPrefix" TEXT NOT NULL,
      "scopes" TEXT NOT NULL,
      "oauthClientId" TEXT,
      "oauthIssuer" TEXT,
      "oauthResource" TEXT,
      "oauthConnectionKey" TEXT,
      "lastUsedAt" DATETIME,
      "revokedAt" DATETIME,
      "expiresAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ApiCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );

    INSERT INTO "User" ("id") VALUES ('legacy-user'), ('grant-user');
    INSERT INTO "OAuthClient" ("id", "redirectUris", "issuer")
      VALUES ('legacy-client', '["https://client.example/callback"]', 'https://issuer.example');
    INSERT INTO "OAuthAuthCode" (
      "id", "codeHash", "clientId", "issuer", "userId", "redirectUri",
      "codeChallenge", "scope", "resource", "expiresAt"
    ) VALUES (
      'legacy-code', 'legacy-code-hash', 'legacy-client', 'https://issuer.example',
      'legacy-user', 'https://client.example/callback', 'challenge', 'kitchen:read',
      'https://issuer.example/mcp', '2026-08-31T00:00:00.000Z'
    );
    INSERT INTO "OAuthRefreshToken" (
      "id", "tokenHash", "userId", "clientId", "issuer", "scope", "resource", "connectionKey"
    ) VALUES (
      'legacy-refresh', 'legacy-refresh-hash', 'legacy-user', 'legacy-client',
      'https://issuer.example', 'kitchen:read', 'https://issuer.example/mcp', 'legacy-connection'
    );
    INSERT INTO "ApiCredential" (
      "id", "userId", "name", "tokenHash", "tokenPrefix", "scopes", "oauthClientId",
      "oauthIssuer", "oauthResource", "oauthConnectionKey"
    ) VALUES (
      'legacy-access', 'legacy-user', 'Legacy access', 'legacy-access-hash', 'sj_legacy',
      'kitchen:read', 'legacy-client', 'https://issuer.example',
      'https://issuer.example/mcp', 'legacy-connection'
    );
  `);
  return db;
}

function insertGrant(db: Database, id = "grant-1"): void {
  db.prepare(`
    INSERT INTO "OAuthGrant" (
      "id", "userId", "clientId", "issuer", "resource", "scope", "connectionKey",
      "status", "statusReason", "statusChangedAt", "createdAt", "updatedAt"
    ) VALUES (?, 'grant-user', 'legacy-client', 'https://issuer.example',
      'https://issuer.example/mcp', 'kitchen:read', ?, 'active', NULL,
      '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z')
  `).run(id, `connection-${id}`);
}

function insertCredentialRows(db: Database, suffix: string): void {
  db.prepare(`
    INSERT INTO "OAuthAuthCode" (
      "id", "codeHash", "clientId", "issuer", "userId", "redirectUri", "codeChallenge",
      "scope", "resource", "expiresAt", "grantId"
    ) VALUES (?, ?, 'legacy-client', 'https://issuer.example', 'grant-user',
      'https://client.example/callback', 'challenge', 'kitchen:read',
      'https://issuer.example/mcp', '2026-08-31T00:00:00.000Z', 'grant-1')
  `).run(`code-${suffix}`, `code-hash-${suffix}`);
  db.prepare(`
    INSERT INTO "OAuthRefreshToken" (
      "id", "tokenHash", "userId", "clientId", "issuer", "scope", "resource",
      "connectionKey", "grantId"
    ) VALUES (?, ?, 'grant-user', 'legacy-client', 'https://issuer.example', 'kitchen:read',
      'https://issuer.example/mcp', 'connection-grant-1', 'grant-1')
  `).run(`refresh-${suffix}`, `refresh-hash-${suffix}`);
  db.prepare(`
    INSERT INTO "ApiCredential" (
      "id", "userId", "name", "tokenHash", "tokenPrefix", "scopes", "oauthClientId",
      "oauthIssuer", "oauthResource", "oauthConnectionKey", "oauthGrantId"
    ) VALUES (?, 'grant-user', 'Access', ?, 'sj_test', 'kitchen:read', 'legacy-client',
      'https://issuer.example', 'https://issuer.example/mcp', 'connection-grant-1', 'grant-1')
  `).run(`access-${suffix}`, `access-hash-${suffix}`);
}

const MIGRATIONS = [
  ["root D1 migration", ROOT_MIGRATION],
  ["Prisma migration", PRISMA_MIGRATION],
] as const;

describe("migration 0027 copies", () => {
  it("keeps root D1 and Prisma migration SQL byte-identical", () => {
    expect(readFileSync(ROOT_MIGRATION, "utf8")).toBe(readFileSync(PRISMA_MIGRATION, "utf8"));
  });
});

describe.each(MIGRATIONS)("migration 0027 — durable OAuth grants (%s)", (_label, path) => {
  let db: Database;
  let sql: string;

  beforeEach(() => {
    db = freshPreExpansionDb();
    sql = readFileSync(path, "utf8");
    db.exec(sql);
  });

  afterEach(() => db.close());

  it("is additive, preserves legacy rows, and adds only nullable bridge hints", () => {
    expect(() => assertAdditiveMigrationSql("0027_oauth_grants_and_lineage.sql", sql)).not.toThrow();
    for (const [table, field] of [
      ["OAuthAuthCode", "grantId"],
      ["OAuthRefreshToken", "grantId"],
      ["ApiCredential", "oauthGrantId"],
    ] as const) {
      expect(columns(db, table)[field]).toMatchObject({ type: "TEXT", notnull: 0, dflt_value: null });
    }
    expect(db.prepare(`SELECT "grantId" FROM "OAuthAuthCode" WHERE id = 'legacy-code'`).get())
      .toEqual({ grantId: null });
    expect(db.prepare(`SELECT "grantId" FROM "OAuthRefreshToken" WHERE id = 'legacy-refresh'`).get())
      .toEqual({ grantId: null });
    expect(db.prepare(`SELECT "oauthGrantId" FROM "ApiCredential" WHERE id = 'legacy-access'`).get())
      .toEqual({ oauthGrantId: null });

    db.prepare(`
      INSERT INTO "OAuthRefreshToken" (
        id, tokenHash, userId, clientId, issuer, scope, resource, connectionKey
      ) VALUES ('old-worker-refresh', 'old-worker-hash', 'legacy-user', 'legacy-client',
        'https://issuer.example', 'kitchen:read', 'https://issuer.example/mcp', 'old-worker-key')
    `).run();
    expect(db.prepare(`SELECT COUNT(*) AS count FROM "OAuthGrant"`).get()).toEqual({ count: 0 });
  });

  it("enforces grant identity, issuer, status/reason, lookup, expiry, and cleanup indexes", () => {
    const grantColumns = columns(db, "OAuthGrant");
    for (const field of [
      "id", "userId", "clientId", "issuer", "scope", "connectionKey", "status",
      "statusChangedAt", "createdAt", "updatedAt",
    ]) expect(grantColumns[field].notnull).toBe(1);
    expect(grantColumns.resource.notnull).toBe(0);
    expect(grantColumns.expiresAt.notnull).toBe(0);

    insertGrant(db);
    expect(() => insertGrant(db, "grant-2")).not.toThrow();
    expect(() => db.prepare(`UPDATE "OAuthGrant" SET connectionKey = 'connection-grant-1' WHERE id = 'grant-2'`).run())
      .toThrow(/unique/i);
    for (const [status, reason] of [
      ["unknown", null], ["active", "disconnect"], ["revoked", null],
      ["revoked", "refresh_reuse"], ["compromised", null], ["compromised", "disconnect"],
    ]) {
      expect(() => db.prepare(`UPDATE "OAuthGrant" SET status = ?, statusReason = ? WHERE id = 'grant-2'`)
        .run(status, reason)).toThrow(/check/i);
    }
    expect(() => db.prepare(`UPDATE "OAuthGrant" SET status = 'revoked', statusReason = 'disconnect' WHERE id = 'grant-2'`).run())
      .not.toThrow();
    expect(() => db.prepare(`UPDATE "OAuthGrant" SET status = 'compromised', statusReason = 'refresh_reuse' WHERE id = 'grant-2'`).run())
      .not.toThrow();

    const grantIndexes = indexes(db, "OAuthGrant");
    expect(grantIndexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "OAuthGrant_clientId_idx", columns: ["clientId"] }),
    ]));
    expect(grantIndexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ columns: ["userId", "clientId", "issuer", "status"] }),
      expect.objectContaining({ columns: ["status", "statusChangedAt"] }),
      expect.objectContaining({ columns: ["status", "expiresAt"] }),
    ]));
    expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  });

  it("enforces one exact issuance source and one set of grant-owned outputs", () => {
    insertGrant(db);
    insertCredentialRows(db, "one");
    insertCredentialRows(db, "two");
    const insert = db.prepare(`
      INSERT INTO "OAuthTokenIssuance" (
        id, grantId, kind, authorizationCodeId, parentRefreshTokenId,
        accessCredentialId, refreshTokenId, createdAt
      ) VALUES (?, 'grant-1', ?, ?, ?, ?, ?, '2026-08-30T00:00:00.000Z')
    `);
    insert.run("issuance-1", "authorization_code", "code-one", null, "access-one", "refresh-one");
    for (const args of [
      ["bad-both", "authorization_code", "code-two", "refresh-one", "access-two", "refresh-two"],
      ["bad-neither", "refresh_token", null, null, "access-two", "refresh-two"],
      ["bad-kind", "other", "code-two", null, "access-two", "refresh-two"],
    ]) expect(() => insert.run(...args)).toThrow(/check/i);
    expect(() => insert.run("duplicate-code", "authorization_code", "code-one", null, "access-two", "refresh-two"))
      .toThrow(/unique/i);
    expect(() => insert.run("duplicate-access", "authorization_code", "code-two", null, "access-one", "refresh-two"))
      .toThrow(/unique/i);
    expect(() => insert.run("duplicate-refresh", "authorization_code", "code-two", null, "access-two", "refresh-one"))
      .toThrow(/unique/i);
    expect(() => insert.run("missing-source", "authorization_code", "missing", null, "access-two", "refresh-two"))
      .toThrow(/foreign key/i);
  });

  it("enforces a single contiguous, non-branching refresh lineage per grant", () => {
    insertGrant(db);
    insertCredentialRows(db, "zero");
    insertCredentialRows(db, "one");
    insertCredentialRows(db, "two");
    const issuance = db.prepare(`
      INSERT INTO "OAuthTokenIssuance" (
        id, grantId, kind, authorizationCodeId, parentRefreshTokenId,
        accessCredentialId, refreshTokenId, createdAt
      ) VALUES (?, 'grant-1', ?, ?, ?, ?, ?, '2026-08-30T00:00:00.000Z')
    `);
    issuance.run("issue-zero", "authorization_code", "code-zero", null, "access-zero", "refresh-zero");
    issuance.run("issue-one", "refresh_token", null, "refresh-zero", "access-one", "refresh-one");
    issuance.run("issue-two", "refresh_token", null, "refresh-one", "access-two", "refresh-two");

    const lineage = db.prepare(`
      INSERT INTO "OAuthRefreshLineage" (
        refreshTokenId, grantId, issuanceId, issuanceKind, generation, parentRefreshTokenId,
        parentGeneration, retiredAt, retirementReason, expiresAt, createdAt
      ) VALUES (?, 'grant-1', ?, ?, ?, ?, ?, ?, ?, '2026-09-30T00:00:00.000Z',
        '2026-08-30T00:00:00.000Z')
    `);
    expect(() => lineage.run(
      "refresh-one",
      "issue-zero",
      "authorization_code",
      0,
      null,
      null,
      null,
      null,
    )).toThrow(/foreign key/i);
    lineage.run("refresh-zero", "issue-zero", "authorization_code", 0, null, null, null, null);
    expect(() => lineage.run("refresh-one", "issue-one", "refresh_token", 1, "refresh-zero", 0, null, null))
      .toThrow(/unique/i);
    expect(() => db.prepare(`UPDATE "OAuthRefreshLineage" SET retiredAt = '2026-08-30T01:00:00.000Z' WHERE refreshTokenId = 'refresh-zero'`).run())
      .toThrow(/check/i);
    db.prepare(`UPDATE "OAuthRefreshLineage" SET retiredAt = '2026-08-30T01:00:00.000Z', retirementReason = 'rotated' WHERE refreshTokenId = 'refresh-zero'`).run();
    lineage.run("refresh-one", "issue-one", "refresh_token", 1, "refresh-zero", 0, null, null);
    insertGrant(db, "grant-2");
    expect(() => db.prepare(`
      INSERT INTO "OAuthRefreshLineage" (
        refreshTokenId, grantId, issuanceId, issuanceKind, generation, parentRefreshTokenId,
        parentGeneration, expiresAt, createdAt
      ) VALUES ('refresh-two', 'grant-2', 'issue-two', 'refresh_token', 2, 'refresh-one', 1,
        '2026-09-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z')
    `).run()).toThrow(/foreign key/i);

    for (const args of [
      ["refresh-two", "issue-two", "refresh_token", 3, "refresh-one", 1, null, null],
      ["refresh-two", "issue-two", "refresh_token", 0, "refresh-one", 1, null, null],
      ["refresh-two", "issue-two", "refresh_token", 2, null, null, null, null],
      ["refresh-two", "issue-two", "refresh_token", 2, "refresh-one", 1, null, "rotated"],
      ["refresh-two", "issue-two", "authorization_code", 2, "refresh-one", 1, null, null],
    ]) expect(() => lineage.run(...args)).toThrow();
    db.prepare(`UPDATE "OAuthRefreshLineage" SET retiredAt = '2026-08-30T02:00:00.000Z', retirementReason = 'rotated' WHERE refreshTokenId = 'refresh-one'`).run();
    lineage.run("refresh-two", "issue-two", "refresh_token", 2, "refresh-one", 1, null, null);

    expect(() => db.prepare(`DELETE FROM "OAuthRefreshToken" WHERE id = 'refresh-one'`).run())
      .toThrow(/foreign key/i);
    expect(() => db.prepare(`DELETE FROM "ApiCredential" WHERE id = 'access-two'`).run())
      .toThrow(/foreign key/i);

    const lineageIndexes = indexes(db, "OAuthRefreshLineage");
    expect(lineageIndexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ unique: 1, columns: ["grantId", "generation"] }),
      expect.objectContaining({ unique: 1, columns: ["parentRefreshTokenId"] }),
      expect.objectContaining({ unique: 1, partial: 1, columns: ["grantId"] }),
      expect.objectContaining({ columns: ["expiresAt"] }),
      expect.objectContaining({ columns: ["retiredAt"] }),
    ]));
    expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  });

  it("cascades a grant graph when its owning user or client is deleted", () => {
    insertGrant(db);
    insertCredentialRows(db, "cascade");
    db.prepare(`
      INSERT INTO "OAuthTokenIssuance" (
        id, grantId, kind, authorizationCodeId, accessCredentialId, refreshTokenId, createdAt
      ) VALUES ('issue-cascade', 'grant-1', 'authorization_code', 'code-cascade',
        'access-cascade', 'refresh-cascade', '2026-08-30T00:00:00.000Z')
    `).run();
    db.prepare(`
      INSERT INTO "OAuthRefreshLineage" (
        refreshTokenId, grantId, issuanceId, issuanceKind, generation, expiresAt, createdAt
      ) VALUES ('refresh-cascade', 'grant-1', 'issue-cascade', 'authorization_code', 0,
        '2026-09-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z')
    `).run();
    db.prepare(`DELETE FROM "User" WHERE id = 'grant-user'`).run();
    expect(db.prepare(`SELECT COUNT(*) AS count FROM "OAuthGrant"`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM "OAuthTokenIssuance"`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM "OAuthRefreshLineage"`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM "OAuthRefreshToken" WHERE userId = 'grant-user'`).get())
      .toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM "ApiCredential" WHERE userId = 'grant-user'`).get())
      .toEqual({ count: 0 });
    expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  });

  it("cascades client-owned sidecars before legacy client cleanup", () => {
    insertGrant(db);
    insertCredentialRows(db, "client-cascade");
    db.prepare(`
      INSERT INTO "OAuthTokenIssuance" (
        id, grantId, kind, authorizationCodeId, accessCredentialId, refreshTokenId, createdAt
      ) VALUES ('issue-client-cascade', 'grant-1', 'authorization_code', 'code-client-cascade',
        'access-client-cascade', 'refresh-client-cascade', '2026-08-30T00:00:00.000Z')
    `).run();
    db.prepare(`
      INSERT INTO "OAuthRefreshLineage" (
        refreshTokenId, grantId, issuanceId, issuanceKind, generation, expiresAt, createdAt
      ) VALUES ('refresh-client-cascade', 'grant-1', 'issue-client-cascade',
        'authorization_code', 0, '2026-09-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z')
    `).run();
    db.prepare(`DELETE FROM "OAuthClient" WHERE id = 'legacy-client'`).run();
    expect(db.prepare(`SELECT COUNT(*) AS count FROM "OAuthGrant"`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM "OAuthTokenIssuance"`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM "OAuthRefreshLineage"`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM "OAuthRefreshToken" WHERE clientId = 'legacy-client'`).get())
      .toEqual({ count: 2 });
    expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  });
});
