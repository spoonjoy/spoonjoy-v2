import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildApplySql,
  buildBlockerReportSql,
  buildExactOauthClientCleanupSql,
  buildScratchCleanupSql,
} from "../../scripts/cleanup-local-qa-data.mjs";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

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
      userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE
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

  it("leaves lookalike OAuth graphs untouched and no scratch schema after broad cleanup", () => {
    db = createCleanupDatabase();
    db.exec(`
      INSERT INTO User VALUES ('seed-user', 'demo@example.com', 'demo', NULL);
      INSERT INTO OAuthClient VALUES ('lookalike-client', 'E2E OAuth Client', 'http://localhost:5197/privacy');
      INSERT INTO ApiCredential VALUES ('lookalike-credential', 'seed-user', 'lookalike-client');
      INSERT INTO OAuthAuthCode VALUES ('lookalike-code', 'lookalike-client', 'seed-user');
      INSERT INTO OAuthRefreshToken VALUES ('lookalike-refresh', 'lookalike-client', 'seed-user');
    `);

    expect(blockerRows(db)).toEqual([]);
    db.exec(buildApplySql());

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(ids(db, "OAuthClient")).toEqual(["lookalike-client"]);
    expect(ids(db, "ApiCredential")).toEqual(["lookalike-credential"]);
    expect(ids(db, "OAuthAuthCode")).toEqual(["lookalike-code"]);
    expect(ids(db, "OAuthRefreshToken")).toEqual(["lookalike-refresh"]);
    expect(scratchSchemaRows(db)).toEqual([]);
  });

  it("deletes only captured OAuth client IDs, their credential support graph, and no principal", () => {
    db = createCleanupDatabase();
    db.exec(`
      INSERT INTO User VALUES ('seed-user', 'demo@example.com', 'demo', NULL);
      INSERT INTO OAuthClient VALUES ('captured-client', 'E2E OAuth Client [run-owned]', 'http://localhost:5197/privacy');
      INSERT INTO OAuthClient VALUES ('lookalike-client', 'E2E OAuth Client [run-owned]', 'http://localhost:5197/privacy');
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
      INSERT INTO OAuthRefreshToken VALUES ('captured-refresh', 'captured-client', 'seed-user');
      INSERT INTO OAuthRefreshToken VALUES ('lookalike-refresh', 'lookalike-client', 'seed-user');
    `);

    db.exec(buildExactOauthClientCleanupSql(["captured-client"]));

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(ids(db, "User")).toEqual(["seed-user"]);
    expect(ids(db, "OAuthClient")).toEqual(["lookalike-client"]);
    expect(ids(db, "ApiCredential")).toEqual(["lookalike-credential"]);
    expect(ids(db, "AgentConnectionRequest")).toEqual(["lookalike-connection"]);
    expect(ids(db, "ApiIdempotencyKey")).toEqual(["lookalike-idempotency"]);
    expect(ids(db, "ApiMutationTombstone")).toEqual(["lookalike-tombstone"]);
    expect(ids(db, "OAuthAuthCode")).toEqual(["lookalike-code"]);
    expect(ids(db, "OAuthRefreshToken")).toEqual(["lookalike-refresh"]);
    expect(scratchSchemaRows(db)).toEqual([]);
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
