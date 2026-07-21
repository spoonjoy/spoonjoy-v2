import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import DatabaseSync from "better-sqlite3";
type DatabaseSyncType = InstanceType<typeof DatabaseSync>;


const MIGRATIONS_DIR = resolve(__dirname, "..", "..", "migrations");
const MIGRATION_FILE = "0024_remove_legacy_demo_identities.sql";
const LEGACY_USER_IDS = ["demo_user_001", "user_demo", "user_julia", "user_marco", "user_sarah"];

function applyMigrationsBeforeCleanup(db: DatabaseSyncType) {
  for (const fileName of readdirSync(MIGRATIONS_DIR)
    .filter((fileName) => fileName.endsWith(".sql") && fileName < MIGRATION_FILE)
    .sort()) {
    db.exec(readFileSync(resolve(MIGRATIONS_DIR, fileName), "utf8"));
  }
}

function count(db: DatabaseSyncType, sql: string, ...params: string[]): number {
  return (db.prepare(sql).get(...params) as { count: number }).count;
}

describe("migration 0024 - remove legacy demo identities", () => {
  let db: DatabaseSyncType;
  let migrationSql: string;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    applyMigrationsBeforeCleanup(db);
    migrationSql = readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), "utf8");
  });

  it("removes every historical fixture identity from a freshly migrated database", () => {
    expect(count(db, `SELECT COUNT(*) AS count FROM "User" WHERE id IN (${LEGACY_USER_IDS.map(() => "?").join(", ")})`, ...LEGACY_USER_IDS)).toBe(4);
    db.exec(`
      INSERT INTO "UserCredential" ("id", "userId", "publicKey", "counter")
      VALUES ('fixture_passkey', 'user_demo', X'01', 0);
      INSERT INTO "OAuth" (
        "provider", "providerUserId", "providerUsername", "userId", "createdAt"
      ) VALUES ('google', 'fixture_provider_user', 'fixture_provider_username', 'user_demo', CURRENT_TIMESTAMP);
      INSERT INTO "ApiCredential" (
        "id", "userId", "name", "tokenHash", "tokenPrefix", "createdAt", "updatedAt"
      ) VALUES (
        'fixture_api_credential', 'user_demo', 'Fixture API credential', 'fixture_token_hash', 'fixture_',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
      INSERT INTO "AgentConnectionRequest" (
        "id", "deviceCodeHash", "userCode", "agentName", "status", "approvedById", "credentialId",
        "expiresAt", "createdAt", "updatedAt"
      ) VALUES (
        'fixture_agent_request', 'fixture_device_hash', 'FIXTURE1', 'Fixture agent', 'approved', 'user_demo',
        'fixture_api_credential', datetime('now', '+10 minutes'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
      INSERT INTO "SearchDocument" (
        "entityType", "entityId", "ownerId", "ownerUsername", "sortAt", "title", "subtitle", "body",
        "href", "imageUrl", "metadata"
      ) VALUES (
        'recipe', 'r_pizza', 'user_demo', 'fixture_user', CURRENT_TIMESTAMP, 'Fixture recipe', '', '',
        '/recipes/r_pizza', NULL, '{}'
      );
      INSERT INTO "SearchIndexMetadata" ("id", "sourceFingerprint", "documentCount", "rebuiltAt")
      VALUES ('global', 'stale-fixture-fingerprint', 1, CURRENT_TIMESTAMP);
    `);

    db.exec(migrationSql);

    expect(count(db, `SELECT COUNT(*) AS count FROM "User" WHERE id IN (${LEGACY_USER_IDS.map(() => "?").join(", ")})`, ...LEGACY_USER_IDS)).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS count FROM Recipe")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS count FROM Cookbook")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS count FROM ShoppingList")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS count FROM UserCredential WHERE id = 'fixture_passkey'")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS count FROM OAuth WHERE providerUserId = 'fixture_provider_user'")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS count FROM AgentConnectionRequest WHERE id = 'fixture_agent_request'")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS count FROM SearchDocument WHERE entityId = 'r_pizza'")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS count FROM SearchIndexMetadata")).toBe(0);
  });

  it("preserves real content while detaching references to fixture-owned content", () => {
    db.exec(`
      INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt")
      VALUES ('real_user', 'real@example.com', 'demo_chef_real', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO "Recipe" (
        "id", "title", "chefId", "sourceRecipeId", "coverMode", "createdAt", "updatedAt"
      ) VALUES ('real_recipe', 'Real recipe', 'real_user', 'r_pizza', 'auto', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO "Cookbook" ("id", "title", "authorId", "createdAt", "updatedAt")
      VALUES ('real_cookbook', 'Real cookbook', 'real_user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO "RecipeInCookbook" (
        "id", "cookbookId", "recipeId", "addedById", "createdAt", "updatedAt"
      ) VALUES ('fixture_membership', 'real_cookbook', 'r_pizza', 'real_user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO "RecipeCover" (
        "id", "recipeId", "imageUrl", "sourceType", "status", "createdById", "generationStatus", "createdAt"
      ) VALUES (
        'real_cover', 'real_recipe', '/photos/real-cover.jpg', 'chef-upload', 'ready', 'user_demo', 'none', CURRENT_TIMESTAMP
      );
      UPDATE "Recipe"
      SET "activeCoverId" = 'real_cover', "activeCoverVariant" = 'original'
      WHERE "id" = 'real_recipe';
    `);

    db.exec(migrationSql);

    expect(count(db, "SELECT COUNT(*) AS count FROM User WHERE id = 'real_user'")).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS count FROM Recipe WHERE id = 'real_recipe' AND sourceRecipeId IS NULL")).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS count FROM Cookbook WHERE id = 'real_cookbook'")).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS count FROM RecipeInCookbook WHERE id = 'fixture_membership'")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS count FROM RecipeCover WHERE id = 'real_cover' AND createdById IS NULL")).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS count FROM Recipe WHERE id = 'real_recipe' AND activeCoverId = 'real_cover'")).toBe(1);
  });

  it("is safe to reapply", () => {
    db.exec(migrationSql);
    expect(() => db.exec(migrationSql)).not.toThrow();
  });

  it("contains no broad user deletion or schema destruction", () => {
    expect(migrationSql).toContain("WHERE \"id\" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')");
    expect(migrationSql).not.toMatch(/DELETE FROM \"User\"\s*;/i);
    expect(migrationSql).not.toMatch(/DROP\s+TABLE/i);
  });
});
