import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import DatabaseSync from "better-sqlite3";
type DatabaseSyncType = InstanceType<typeof DatabaseSync>;
import { afterEach, describe, expect, it } from "vitest";

import {
  buildApplySql,
  buildBlockerReportSql,
  buildExactOauthClientCleanupSql,
  buildScratchCleanupSql,
} from "../../scripts/cleanup-local-qa-data.mjs";
import { buildMcpCanaryCleanupD1Args } from "../../scripts/smoke-live-helpers.mjs";


const SCRATCH_TABLES = [
  "cleanup_blockers",
  "disposable_cover_image_urls",
  "disposable_covers",
  "disposable_credentials",
  "disposable_spoons",
  "disposable_users",
  "hard_delete_recipes",
  "soft_delete_recipes",
] as const;

function createCleanupDatabase(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE User (id TEXT PRIMARY KEY, email TEXT NOT NULL, username TEXT NOT NULL, photoUrl TEXT);
    CREATE TABLE Recipe (id TEXT PRIMARY KEY, title TEXT NOT NULL, chefId TEXT NOT NULL, sourceRecipeId TEXT, activeCoverId TEXT, deletedAt TEXT);
    CREATE TABLE RecipeSpoon (id TEXT PRIMARY KEY, chefId TEXT NOT NULL, recipeId TEXT NOT NULL, note TEXT, photoUrl TEXT);
    CREATE TABLE OAuthClient (id TEXT PRIMARY KEY, clientName TEXT, redirectUris TEXT NOT NULL);
    CREATE TABLE OAuthGrant (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
      clientId TEXT NOT NULL REFERENCES OAuthClient(id) ON DELETE CASCADE,
      connectionKey TEXT NOT NULL
    );
    CREATE TABLE ApiCredential (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
      oauthClientId TEXT
    );
    CREATE TABLE RecipeCover (
      id TEXT PRIMARY KEY,
      recipeId TEXT NOT NULL,
      sourceSpoonId TEXT,
      createdById TEXT,
      imageUrl TEXT,
      stylizedImageUrl TEXT,
      sourceImageUrl TEXT
    );
    CREATE TABLE AgentConnectionRequest (
      id TEXT PRIMARY KEY,
      approvedById TEXT REFERENCES User(id) ON DELETE SET NULL,
      credentialId TEXT REFERENCES ApiCredential(id) ON DELETE SET NULL
    );
    CREATE TABLE ApiIdempotencyKey (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
      credentialId TEXT REFERENCES ApiCredential(id) ON DELETE SET NULL
    );
    CREATE TABLE ApiMutationTombstone (
      id TEXT PRIMARY KEY,
      idempotencyKeyId TEXT NOT NULL REFERENCES ApiIdempotencyKey(id) ON DELETE CASCADE
    );
    CREATE TABLE OAuthAuthCode (
      id TEXT PRIMARY KEY,
      clientId TEXT NOT NULL,
      userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE
    );
    CREATE TABLE OAuthRefreshToken (
      id TEXT PRIMARY KEY,
      clientId TEXT NOT NULL,
      userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
      connectionKey TEXT
    );
    CREATE TABLE OAuthTokenIssuance (
      id TEXT PRIMARY KEY,
      grantId TEXT NOT NULL REFERENCES OAuthGrant(id) ON DELETE CASCADE,
      authorizationCodeId TEXT REFERENCES OAuthAuthCode(id) ON DELETE NO ACTION,
      accessCredentialId TEXT NOT NULL REFERENCES ApiCredential(id) ON DELETE NO ACTION,
      refreshTokenId TEXT NOT NULL REFERENCES OAuthRefreshToken(id) ON DELETE NO ACTION
    );
    CREATE TABLE OAuthRefreshLineage (
      refreshTokenId TEXT PRIMARY KEY REFERENCES OAuthRefreshToken(id) ON DELETE NO ACTION,
      grantId TEXT NOT NULL REFERENCES OAuthGrant(id) ON DELETE CASCADE,
      issuanceId TEXT NOT NULL REFERENCES OAuthTokenIssuance(id) ON DELETE NO ACTION
    );
    CREATE TABLE NotificationEvent (id TEXT PRIMARY KEY, recipientId TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE Cookbook (id TEXT PRIMARY KEY, authorId TEXT NOT NULL);
    CREATE TABLE RecipeInCookbook (id TEXT PRIMARY KEY, recipeId TEXT NOT NULL, cookbookId TEXT NOT NULL, addedById TEXT NOT NULL);
    CREATE TABLE OAuth (userId TEXT NOT NULL);
    CREATE TABLE UserCredential (userId TEXT NOT NULL);
    CREATE TABLE NativePushDevice (userId TEXT NOT NULL);
    CREATE TABLE PushSubscription (userId TEXT NOT NULL);
    CREATE TABLE NotificationPreference (userId TEXT NOT NULL);
    CREATE TABLE ImageGenLedger (userId TEXT NOT NULL);
  `);
  return db;
}

function blockerRows(db: DatabaseSyncType) {
  return buildBlockerReportSql()
    .split("\n\n")
    .flatMap((statement) => db.prepare(statement).all() as Array<{ blocker: string; rowId: string }>);
}

function ids(db: DatabaseSyncType, table: string) {
  return (db.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as Array<{ id: string }>)
    .map((row) => row.id);
}

function rowCount(db: DatabaseSyncType, table: string) {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function scratchSchemaRows(db: DatabaseSyncType) {
  const placeholders = SCRATCH_TABLES.map(() => "?").join(", ");
  return db.prepare(`
    SELECT name, 'main' AS schemaName FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})
    UNION ALL
    SELECT name, 'temp' AS schemaName FROM sqlite_temp_master WHERE type = 'table' AND name IN (${placeholders})
    ORDER BY name
  `).all(...SCRATCH_TABLES, ...SCRATCH_TABLES);
}

describe("cleanup-local-qa-data executable ownership boundaries", () => {
  let db: DatabaseSyncType | undefined;
  let tempRoot: string | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  it("deletes populated disposable-user lineage while leaving lookalike OAuth graphs untouched", () => {
    db = createCleanupDatabase();
    db.exec(`
      INSERT INTO User VALUES ('seed-user', 'demo@example.com', 'demo', NULL);
      INSERT INTO User VALUES ('codex-user', 'codex-broad-cleanup@example.com', 'codex_broad_cleanup', NULL);
      INSERT INTO OAuthClient VALUES ('lookalike-client', 'E2E OAuth Client', 'http://localhost:5197/privacy');
      INSERT INTO OAuthClient VALUES ('disposable-client', 'E2E OAuth Client', 'http://localhost:5197/privacy');
      INSERT INTO OAuthGrant VALUES ('lookalike-grant', 'seed-user', 'lookalike-client', 'lookalike-connection');
      INSERT INTO OAuthGrant VALUES ('disposable-grant', 'codex-user', 'disposable-client', 'disposable-connection');
      INSERT INTO ApiCredential VALUES ('lookalike-credential', 'seed-user', 'lookalike-client');
      INSERT INTO ApiCredential VALUES ('disposable-credential', 'codex-user', 'disposable-client');
      INSERT INTO OAuthAuthCode VALUES ('lookalike-code', 'lookalike-client', 'seed-user');
      INSERT INTO OAuthAuthCode VALUES ('disposable-code', 'disposable-client', 'codex-user');
      INSERT INTO OAuthRefreshToken VALUES ('lookalike-refresh', 'lookalike-client', 'seed-user', 'lookalike-connection');
      INSERT INTO OAuthRefreshToken VALUES ('disposable-refresh', 'disposable-client', 'codex-user', 'disposable-connection');
      INSERT INTO OAuthTokenIssuance VALUES ('disposable-issuance', 'disposable-grant', 'disposable-code', 'disposable-credential', 'disposable-refresh');
      INSERT INTO OAuthRefreshLineage VALUES ('disposable-refresh', 'disposable-grant', 'disposable-issuance');
    `);

    expect(blockerRows(db)).toEqual([]);
    db.exec(buildApplySql());

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(ids(db, "User")).toEqual(["seed-user"]);
    expect(ids(db, "OAuthClient")).toEqual(["disposable-client", "lookalike-client"]);
    expect(ids(db, "OAuthGrant")).toEqual(["lookalike-grant"]);
    expect(ids(db, "ApiCredential")).toEqual(["lookalike-credential"]);
    expect(ids(db, "OAuthAuthCode")).toEqual(["lookalike-code"]);
    expect(ids(db, "OAuthRefreshToken")).toEqual(["lookalike-refresh"]);
    expect(rowCount(db, "OAuthTokenIssuance")).toBe(0);
    expect(rowCount(db, "OAuthRefreshLineage")).toBe(0);
    expect(scratchSchemaRows(db)).toEqual([]);
  });

  it("deletes only captured OAuth client IDs, their credential support graph, and no principal", () => {
    db = createCleanupDatabase();
    db.exec(`
      INSERT INTO User VALUES ('seed-user', 'demo@example.com', 'demo', NULL);
      INSERT INTO OAuthClient VALUES ('captured-client', 'E2E OAuth Client [run-owned]', 'http://localhost:5197/privacy');
      INSERT INTO OAuthClient VALUES ('lookalike-client', 'E2E OAuth Client [run-owned]', 'http://localhost:5197/privacy');
      INSERT INTO OAuthGrant VALUES ('captured-grant', 'seed-user', 'captured-client', 'captured-connection');
      INSERT INTO OAuthGrant VALUES ('lookalike-grant', 'seed-user', 'lookalike-client', 'lookalike-connection');
      INSERT INTO ApiCredential VALUES ('captured-credential', 'seed-user', 'captured-client');
      INSERT INTO ApiCredential VALUES ('lookalike-credential', 'seed-user', 'lookalike-client');
      INSERT INTO AgentConnectionRequest VALUES ('captured-connection', 'seed-user', 'captured-credential');
      INSERT INTO AgentConnectionRequest VALUES ('lookalike-connection', 'seed-user', 'lookalike-credential');
      INSERT INTO ApiIdempotencyKey VALUES ('captured-idempotency', 'seed-user', 'captured-credential');
      INSERT INTO ApiIdempotencyKey VALUES ('lookalike-idempotency', 'seed-user', 'lookalike-credential');
      INSERT INTO ApiMutationTombstone VALUES ('captured-tombstone', 'captured-idempotency');
      INSERT INTO ApiMutationTombstone VALUES ('lookalike-tombstone', 'lookalike-idempotency');
      INSERT INTO OAuthAuthCode VALUES ('captured-code', 'captured-client', 'seed-user');
      INSERT INTO OAuthAuthCode VALUES ('lookalike-code', 'lookalike-client', 'seed-user');
      INSERT INTO OAuthRefreshToken VALUES ('captured-refresh', 'captured-client', 'seed-user', 'captured-connection');
      INSERT INTO OAuthRefreshToken VALUES ('lookalike-refresh', 'lookalike-client', 'seed-user', 'lookalike-connection');
      INSERT INTO OAuthTokenIssuance VALUES ('captured-issuance', 'captured-grant', 'captured-code', 'captured-credential', 'captured-refresh');
      INSERT INTO OAuthTokenIssuance VALUES ('lookalike-issuance', 'lookalike-grant', 'lookalike-code', 'lookalike-credential', 'lookalike-refresh');
      INSERT INTO OAuthRefreshLineage VALUES ('captured-refresh', 'captured-grant', 'captured-issuance');
      INSERT INTO OAuthRefreshLineage VALUES ('lookalike-refresh', 'lookalike-grant', 'lookalike-issuance');
    `);

    db.exec(buildExactOauthClientCleanupSql(["captured-client"]));

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(ids(db, "User")).toEqual(["seed-user"]);
    expect(ids(db, "OAuthClient")).toEqual(["lookalike-client"]);
    expect(ids(db, "OAuthGrant")).toEqual(["lookalike-grant"]);
    expect(ids(db, "ApiCredential")).toEqual(["lookalike-credential"]);
    expect(ids(db, "AgentConnectionRequest")).toEqual(["lookalike-connection"]);
    expect(ids(db, "ApiIdempotencyKey")).toEqual(["lookalike-idempotency"]);
    expect(ids(db, "ApiMutationTombstone")).toEqual(["lookalike-tombstone"]);
    expect(ids(db, "OAuthAuthCode")).toEqual(["lookalike-code"]);
    expect(ids(db, "OAuthRefreshToken")).toEqual(["lookalike-refresh"]);
    expect(ids(db, "OAuthTokenIssuance")).toEqual(["lookalike-issuance"]);
    expect(rowCount(db, "OAuthRefreshLineage")).toBe(1);
    expect(scratchSchemaRows(db)).toEqual([]);
  });

  it("executes MCP canary cleanup against a populated issuance lineage", () => {
    db = createCleanupDatabase();
    db.exec(`
      INSERT INTO User VALUES ('canary-user', 'canary@example.com', 'canary', NULL);
      INSERT INTO OAuthClient VALUES ('canary-client', 'Claude', 'https://claude.ai/api/mcp/auth_callback');
      INSERT INTO OAuthGrant VALUES ('canary-grant', 'canary-user', 'canary-client', 'canary-connection');
      INSERT INTO ApiCredential VALUES ('canary-credential', 'canary-user', 'canary-client');
      INSERT INTO OAuthAuthCode VALUES ('canary-code', 'canary-client', 'canary-user');
      INSERT INTO OAuthRefreshToken VALUES ('canary-refresh', 'canary-client', 'canary-user', 'canary-connection');
      INSERT INTO OAuthTokenIssuance VALUES ('canary-issuance', 'canary-grant', 'canary-code', 'canary-credential', 'canary-refresh');
      INSERT INTO OAuthRefreshLineage VALUES ('canary-refresh', 'canary-grant', 'canary-issuance');
    `);

    const command = buildMcpCanaryCleanupD1Args({
      email: "canary@example.com",
      clientId: "canary-client",
      connectionKey: "canary-connection",
    }, { targetEnv: "production" }).at(-1);
    expect(typeof command).toBe("string");
    db.exec(command as string);

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    for (const table of [
      "User",
      "OAuthClient",
      "OAuthGrant",
      "ApiCredential",
      "OAuthAuthCode",
      "OAuthRefreshToken",
      "OAuthTokenIssuance",
      "OAuthRefreshLineage",
    ]) {
      expect(rowCount(db, table)).toBe(0);
    }
  });

  it("persists no scratch schema when a blocker aborts cleanup", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "spoonjoy-cleanup-abort-"));
    const databasePath = join(tempRoot, "cleanup.sqlite");
    db = createCleanupDatabase(databasePath);
    db.exec(`
      INSERT INTO User VALUES ('codex-user', 'codex-e2e@example.com', 'codex_e2e', NULL);
      INSERT INTO User VALUES ('seed-user', 'demo@example.com', 'demo', NULL);
      INSERT INTO Recipe VALUES ('disposable-recipe', 'E2E owned recipe', 'codex-user', NULL, NULL, NULL);
      INSERT INTO Recipe VALUES ('retained-recipe', 'Seed recipe', 'seed-user', 'disposable-recipe', NULL, NULL);
    `);

    db.exec(buildScratchCleanupSql());
    try {
      expect(() => db!.exec(buildApplySql())).toThrow(/malformed JSON/);
    } finally {
      db.exec(buildScratchCleanupSql());
    }
    db.close();
    db = new DatabaseSync(databasePath);

    expect(ids(db, "Recipe")).toEqual(["disposable-recipe", "retained-recipe"]);
    expect(scratchSchemaRows(db)).toEqual([]);
  });
});
