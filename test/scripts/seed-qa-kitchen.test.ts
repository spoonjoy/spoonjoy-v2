import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { describe, expect, it, vi } from "vitest";
import {
  KITCHEN,
  buildKitchenResetSql,
  defaultCliErrorHandler,
  generatePersonaPasswords,
  isCliEntry,
  main,
  parseSeedKitchenArgs,
  runCliIfEntry,
} from "../../scripts/seed-qa-kitchen.mjs";

const MIGRATIONS = resolve(__dirname, "../../migrations");
function migratedDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(resolve(MIGRATIONS, file), "utf8"));
  }
  return db;
}
const fastHash = (p: string) => bcrypt.hashSync(p, 4);
const passwords = { chef: "chef-pw", friend: "friend-pw", newbie: "newbie-pw" };

describe("seed-qa-kitchen", () => {
  it("builds the kitchen on a database created from the real migrations", () => {
    const db = migratedDb();
    db.exec(buildKitchenResetSql({ passwords, hash: fastHash }));
    const chef = db.prepare('SELECT username, email, hashedPassword FROM "User" WHERE id = ?').get(KITCHEN.chef.id) as any;
    expect(chef.username).toBe("qa_kitchen_chef");
    expect(bcrypt.compareSync("chef-pw", chef.hashedPassword)).toBe(true);
    expect(db.prepare("SELECT COUNT(*) n FROM Recipe WHERE chefId = ?").get(KITCHEN.chef.id)).toEqual({ n: 2 });
    expect(db.prepare("SELECT COUNT(*) n FROM Recipe WHERE chefId = ?").get(KITCHEN.friend.id)).toEqual({ n: 2 });
    expect(db.prepare("SELECT COUNT(*) n FROM StepOutputUse WHERE recipeId = ?").get(KITCHEN.recipes.lemonRice.id)).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM RecipeInCookbook WHERE cookbookId = ?").get(KITCHEN.cookbooks.weeknight.id)).toEqual({ n: 2 });
    expect(db.prepare("SELECT COUNT(*) n FROM ShoppingListItem i JOIN ShoppingList l ON l.id = i.shoppingListId WHERE l.authorId = ? AND i.checked = 0").get(KITCHEN.chef.id)).toEqual({ n: 3 });
    expect(db.prepare("SELECT COUNT(*) n FROM RecipeSpoon WHERE chefId = ?").get(KITCHEN.chef.id)).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM Recipe WHERE chefId = ?").get(KITCHEN.newbie.id)).toEqual({ n: 0 });
  });

  it("is idempotent and resets drift, including forks and cookbook entries made by other users", () => {
    const db = migratedDb();
    db.exec(buildKitchenResetSql({ passwords, hash: fastHash }));
    db.exec(`INSERT INTO "User" (id, email, username, createdAt, updatedAt) VALUES ('codex-e2e-x', 'codex-e2e-x@example.com', 'codex_e2e_x', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`);
    db.exec(`INSERT INTO Recipe (id, title, chefId, sourceRecipeId, coverMode, createdAt, updatedAt) VALUES ('fork-1', 'Saffron Risotto', 'codex-e2e-x', '${KITCHEN.recipes.risotto.id}', 'auto', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`);
    db.exec(`INSERT INTO Cookbook (id, title, authorId, createdAt, updatedAt) VALUES ('cb-x', 'Mine', 'codex-e2e-x', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`);
    db.exec(`INSERT INTO RecipeInCookbook (id, cookbookId, recipeId, addedById, createdAt, updatedAt) VALUES ('ric-x', 'cb-x', '${KITCHEN.recipes.salmon.id}', 'codex-e2e-x', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`);
    db.exec(`UPDATE ShoppingListItem SET checked = 1 WHERE shoppingListId IN (SELECT id FROM ShoppingList WHERE authorId = '${KITCHEN.chef.id}');`);
    expect(() => db.exec(buildKitchenResetSql({ passwords: { chef: "new", friend: "new", newbie: "new" }, hash: fastHash }))).not.toThrow();
    expect(db.prepare("SELECT sourceRecipeId FROM Recipe WHERE id = 'fork-1'").get()).toEqual({ sourceRecipeId: null });
    expect(db.prepare("SELECT COUNT(*) n FROM ShoppingListItem i JOIN ShoppingList l ON l.id = i.shoppingListId WHERE l.authorId = ? AND i.checked = 0").get(KITCHEN.chef.id)).toEqual({ n: 3 });
    const chef = db.prepare('SELECT hashedPassword FROM "User" WHERE id = ?').get(KITCHEN.chef.id) as any;
    expect(bcrypt.compareSync("new", chef.hashedPassword)).toBe(true);
  });

  it("reuses existing shared units and ingredient refs by name", () => {
    // Note: the historical seed migrations (0002_seed.sql / 0004_reseed.sql, still
    // active — 0024_remove_legacy_demo_identities.sql only purges User-linked rows,
    // never the shared Unit/IngredientRef tables) already insert a Unit named "cup",
    // so pre-inserting a second "cup" row here would violate Unit's UNIQUE(name)
    // constraint before buildKitchenResetSql even runs. "fillet" is a unit this
    // seed's own content introduces (for Miso Glazed Salmon) and that the historical
    // seed does not, so it exercises the same "someone else already created this
    // shared row under another id" scenario without colliding with fixture data.
    const db = migratedDb();
    db.exec(`INSERT INTO Unit (id, name, updatedAt) VALUES ('someone-else-fillet', 'fillet', CURRENT_TIMESTAMP);`);
    db.exec(buildKitchenResetSql({ passwords, hash: fastHash }));
    expect(db.prepare("SELECT COUNT(*) n FROM Unit WHERE name = 'fillet'").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT i.id AS id FROM Ingredient i JOIN Unit u ON u.id = i.unitId WHERE u.name = 'fillet'").get()).toEqual({
      id: `${KITCHEN.recipes.salmon.id}-ingredient-2-salmon`,
    });
  });

  describe("journey drift: persona-owned rows with real (non-'qa-kitchen-%') ids", () => {
    // Journeys sign in as personas and drive the real app, which creates its own rows
    // with real UUID-shaped ids (Recipe.id, Cookbook.id) — not our fixed
    // 'qa-kitchen-recipe-*'/'qa-kitchen-cookbook-*' scheme. The reset must match those
    // rows by ownership (chefId/authorId), not by matching the row's own id against
    // 'qa-kitchen-%', or a second reset run after such drift fails with a foreign key
    // error instead of resetting cleanly.

    it("drift A: detaches a persona's (newbie's) fork of another persona's journey-created recipe", () => {
      const db = migratedDb();
      db.exec(buildKitchenResetSql({ passwords, hash: fastHash }));
      db.exec(
        `INSERT INTO Recipe (id, title, chefId, coverMode, createdAt, updatedAt) VALUES ('journey-recipe-a', 'Chef Weeknight Special', '${KITCHEN.chef.id}', 'auto', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      );
      db.exec(
        `INSERT INTO Recipe (id, title, chefId, sourceRecipeId, coverMode, createdAt, updatedAt) VALUES ('journey-fork-a', 'Newbie Fork', '${KITCHEN.newbie.id}', 'journey-recipe-a', 'auto', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      );
      expect(() => db.exec(buildKitchenResetSql({ passwords, hash: fastHash }))).not.toThrow();
      // Both rows are owned by personas being reset, so both are gone (via cascade),
      // not merely detached — the important thing is that resetting didn't throw.
      expect(db.prepare("SELECT COUNT(*) n FROM Recipe WHERE id IN ('journey-recipe-a', 'journey-fork-a')").get()).toEqual({ n: 0 });
    });

    it("drift B: detaches a throwaway user's fork of a persona's journey-created recipe", () => {
      const db = migratedDb();
      db.exec(buildKitchenResetSql({ passwords, hash: fastHash }));
      db.exec(
        `INSERT INTO Recipe (id, title, chefId, coverMode, createdAt, updatedAt) VALUES ('journey-recipe-b', 'Chef Another Special', '${KITCHEN.chef.id}', 'auto', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      );
      db.exec(
        `INSERT INTO "User" (id, email, username, createdAt, updatedAt) VALUES ('codex-e2e-fork', 'codex-e2e-fork@example.com', 'codex_e2e_fork', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      );
      db.exec(
        `INSERT INTO Recipe (id, title, chefId, sourceRecipeId, coverMode, createdAt, updatedAt) VALUES ('journey-fork-b', 'Throwaway Fork', 'codex-e2e-fork', 'journey-recipe-b', 'auto', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      );
      expect(() => db.exec(buildKitchenResetSql({ passwords, hash: fastHash }))).not.toThrow();
      expect(db.prepare("SELECT COUNT(*) n FROM Recipe WHERE id = 'journey-recipe-b'").get()).toEqual({ n: 0 });
      // The throwaway user and their fork are not part of the reset, so the fork
      // survives — but detached, since its source recipe is gone.
      expect(db.prepare("SELECT sourceRecipeId FROM Recipe WHERE id = 'journey-fork-b'").get()).toEqual({ sourceRecipeId: null });
    });

    it("drift C: clears a throwaway user's cookbook membership pointing at a persona's journey-created recipe", () => {
      const db = migratedDb();
      db.exec(buildKitchenResetSql({ passwords, hash: fastHash }));
      db.exec(
        `INSERT INTO Recipe (id, title, chefId, coverMode, createdAt, updatedAt) VALUES ('journey-recipe-c', 'Chef Third Special', '${KITCHEN.chef.id}', 'auto', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      );
      db.exec(
        `INSERT INTO "User" (id, email, username, createdAt, updatedAt) VALUES ('codex-e2e-cb', 'codex-e2e-cb@example.com', 'codex_e2e_cb', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      );
      db.exec(
        `INSERT INTO Cookbook (id, title, authorId, createdAt, updatedAt) VALUES ('throwaway-cookbook', 'Throwaway Cookbook', 'codex-e2e-cb', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      );
      db.exec(
        `INSERT INTO RecipeInCookbook (id, cookbookId, recipeId, addedById, createdAt, updatedAt) VALUES ('ric-throwaway', 'throwaway-cookbook', 'journey-recipe-c', 'codex-e2e-cb', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      );
      expect(() => db.exec(buildKitchenResetSql({ passwords, hash: fastHash }))).not.toThrow();
      expect(db.prepare("SELECT COUNT(*) n FROM Recipe WHERE id = 'journey-recipe-c'").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT COUNT(*) n FROM RecipeInCookbook WHERE id = 'ric-throwaway'").get()).toEqual({ n: 0 });
    });

    it("drift D: clears a stray cookbook membership pointing at a persona's own journey-created cookbook", () => {
      // Cookbook.authorId cascades and RecipeInCookbook.cookbookId cascades from
      // Cookbook, so this one is not FK-required the way A/B/C are — but the reset
      // should still match a persona's cookbook by ownership (authorId), not by the
      // cookbook's own id, for the same reason it matches recipes by ownership.
      const db = migratedDb();
      db.exec(buildKitchenResetSql({ passwords, hash: fastHash }));
      db.exec(
        `INSERT INTO Cookbook (id, title, authorId, createdAt, updatedAt) VALUES ('journey-cookbook-d', 'Chef Journey Cookbook', '${KITCHEN.chef.id}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      );
      db.exec(
        `INSERT INTO "User" (id, email, username, createdAt, updatedAt) VALUES ('codex-e2e-cb2', 'codex-e2e-cb2@example.com', 'codex_e2e_cb2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      );
      db.exec(
        `INSERT INTO Recipe (id, title, chefId, coverMode, createdAt, updatedAt) VALUES ('throwaway-recipe-d', 'Throwaway Recipe', 'codex-e2e-cb2', 'auto', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      );
      db.exec(
        `INSERT INTO RecipeInCookbook (id, cookbookId, recipeId, addedById, createdAt, updatedAt) VALUES ('ric-journey-cookbook', 'journey-cookbook-d', 'throwaway-recipe-d', 'codex-e2e-cb2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      );
      expect(() => db.exec(buildKitchenResetSql({ passwords, hash: fastHash }))).not.toThrow();
      expect(db.prepare("SELECT COUNT(*) n FROM Cookbook WHERE id = 'journey-cookbook-d'").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT COUNT(*) n FROM RecipeInCookbook WHERE id = 'ric-journey-cookbook'").get()).toEqual({ n: 0 });
    });
  });

  describe("FK-completeness: rows referencing a persona that ON DELETE CASCADE doesn't cover", () => {
    it("clears a persona's passkey (UserCredential) before deleting the user", () => {
      const db = migratedDb();
      db.exec(buildKitchenResetSql({ passwords, hash: fastHash }));
      db.exec(
        `INSERT INTO UserCredential (id, userId, publicKey, transports, counter) VALUES ('cred-1', '${KITCHEN.chef.id}', x'0102', 'usb', 0);`,
      );
      expect(() => db.exec(buildKitchenResetSql({ passwords, hash: fastHash }))).not.toThrow();
      expect(db.prepare("SELECT COUNT(*) n FROM UserCredential WHERE userId = ?").get(KITCHEN.chef.id)).toEqual({ n: 0 });
    });

    it("clears a persona's legacy OAuth provider link before deleting the user", () => {
      const db = migratedDb();
      db.exec(buildKitchenResetSql({ passwords, hash: fastHash }));
      db.exec(
        `INSERT INTO OAuth (provider, providerUserId, providerUsername, userId, createdAt) VALUES ('google', 'g-123', 'chefgoogle', '${KITCHEN.chef.id}', CURRENT_TIMESTAMP);`,
      );
      expect(() => db.exec(buildKitchenResetSql({ passwords, hash: fastHash }))).not.toThrow();
      expect(db.prepare("SELECT COUNT(*) n FROM OAuth WHERE userId = ?").get(KITCHEN.chef.id)).toEqual({ n: 0 });
    });

    it("cascades a persona's full OAuth grant chain (grant, auth code, access credential, refresh token, issuance, and lineage)", () => {
      // Every one of these tables' direct reference to "User" is ON DELETE CASCADE
      // (see migrations/0027_oauth_grants_and_lineage.sql and friends), so the reset
      // needs no extra explicit deletes for this chain — but the internal references
      // between these tables (OAuthTokenIssuance -> ApiCredential/OAuthRefreshToken/
      // OAuthAuthCode, OAuthRefreshLineage -> OAuthRefreshToken) are ON DELETE NO ACTION
      // (SQLite treats this like RESTRICT), so this only works because deleting
      // UserCredential/OAuth first, then "User", lets SQLite's cascade resolve the
      // whole graph in dependency order. This test proves that end-to-end.
      const db = migratedDb();
      db.exec(buildKitchenResetSql({ passwords, hash: fastHash }));
      const chef = KITCHEN.chef.id;

      db.exec(
        `INSERT INTO OAuthClient (id, clientName, redirectUris, createdAt) VALUES ('client-1', 'Test Client', '["https://example.com/cb"]', CURRENT_TIMESTAMP);`,
      );
      db.exec(`
        INSERT INTO OAuthGrant (id, userId, clientId, issuer, resource, scope, connectionKey, status, statusReason, statusChangedAt, expiresAt, createdAt, updatedAt)
        VALUES ('grant-1', '${chef}', 'client-1', 'https://issuer.example', 'https://issuer.example/mcp', 'kitchen:read', 'connection-1', 'active', NULL, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `);
      db.exec(`
        INSERT INTO OAuthAuthCode (id, codeHash, clientId, userId, redirectUri, codeChallenge, scope, resource, issuer, grantId, expiresAt, consumedAt, createdAt)
        VALUES ('code-1', 'code-hash-1', 'client-1', '${chef}', 'https://example.com/cb', 'challenge', 'kitchen:read', 'https://issuer.example/mcp', 'https://issuer.example', 'grant-1', datetime('now', '+1 hour'), NULL, CURRENT_TIMESTAMP);
      `);
      db.exec(`
        INSERT INTO ApiCredential (id, userId, name, tokenHash, tokenPrefix, scopes, oauthClientId, oauthResource, oauthIssuer, oauthConnectionKey, oauthGrantId, lastUsedAt, revokedAt, expiresAt, createdAt, updatedAt)
        VALUES ('access-1', '${chef}', 'Access', 'access-hash-1', 'sj_test', 'kitchen:read', 'client-1', 'https://issuer.example/mcp', 'https://issuer.example', 'connection-1', 'grant-1', NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `);
      db.exec(`
        INSERT INTO OAuthRefreshToken (id, tokenHash, userId, clientId, scope, resource, connectionKey, issuer, grantId, revokedAt, createdAt)
        VALUES ('refresh-1', 'refresh-hash-1', '${chef}', 'client-1', 'kitchen:read', 'https://issuer.example/mcp', 'connection-1', 'https://issuer.example', 'grant-1', NULL, CURRENT_TIMESTAMP);
      `);
      db.exec(`
        INSERT INTO OAuthTokenIssuance (id, grantId, kind, authorizationCodeId, parentRefreshTokenId, accessCredentialId, refreshTokenId, createdAt)
        VALUES ('issuance-1', 'grant-1', 'authorization_code', 'code-1', NULL, 'access-1', 'refresh-1', CURRENT_TIMESTAMP);
      `);
      db.exec(`
        INSERT INTO OAuthRefreshLineage (refreshTokenId, grantId, issuanceId, issuanceKind, generation, parentRefreshTokenId, parentGeneration, retiredAt, retirementReason, expiresAt, createdAt)
        VALUES ('refresh-1', 'grant-1', 'issuance-1', 'authorization_code', 0, NULL, NULL, NULL, NULL, datetime('now', '+30 days'), CURRENT_TIMESTAMP);
      `);

      expect(() => db.exec(buildKitchenResetSql({ passwords, hash: fastHash }))).not.toThrow();

      for (const table of ["OAuthGrant", "OAuthAuthCode", "ApiCredential", "OAuthRefreshToken", "OAuthTokenIssuance", "OAuthRefreshLineage"]) {
        expect(db.prepare(`SELECT COUNT(*) n FROM "${table}"`).get()).toEqual({ n: 0 });
      }
    });
  });

  it("generates distinct strong passwords per run", () => {
    const a = generatePersonaPasswords();
    const b = generatePersonaPasswords();
    expect(a.chef).not.toBe(b.chef);
    expect(a.chef).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("refuses any target but QA", () => {
    expect(() => parseSeedKitchenArgs([])).toThrow(/--target-env qa/);
    expect(() => parseSeedKitchenArgs(["--target-env", "production"])).toThrow(/--target-env qa/);
    expect(parseSeedKitchenArgs(["--target-env", "qa", "--credentials-out", "/tmp/c.json"])).toEqual({ targetEnv: "qa", dryRun: false, credentialsOut: "/tmp/c.json" });
  });

  it("defaults credentialsOut to null when --credentials-out is not given", () => {
    expect(parseSeedKitchenArgs(["--target-env", "qa"])).toEqual({ targetEnv: "qa", dryRun: false, credentialsOut: null });
  });

  it("throws when --credentials-out is the last argument with no value", () => {
    expect(() => parseSeedKitchenArgs(["--target-env", "qa", "--credentials-out"])).toThrow(
      /--credentials-out requires a path value/,
    );
  });

  it("throws when --credentials-out's value looks like another flag", () => {
    expect(() => parseSeedKitchenArgs(["--target-env", "qa", "--credentials-out", "--dry-run"])).toThrow(
      /--credentials-out requires a path value/,
    );
  });

  describe("main", () => {
    it("writes the reset SQL to a temp file, runs wrangler, removes the temp dir, and writes+restricts credentials", () => {
      const execFile = vi.fn();
      const writeFile = vi.fn();
      const rm = vi.fn();
      const chmod = vi.fn();
      const mkdtemp = vi.fn(() => "/tmp/spoonjoy-qa-kitchen-abc123");
      const io = { log: vi.fn() };
      const tmpFile = "/tmp/spoonjoy-qa-kitchen-abc123/kitchen-reset.sql";

      main(["--target-env", "qa", "--credentials-out", "/tmp/creds.json"], {
        execFile,
        writeFile,
        mkdtemp,
        rm,
        chmod,
        io,
      });

      expect(mkdtemp).toHaveBeenCalledTimes(1);
      expect(writeFile).toHaveBeenCalledTimes(2);
      expect(writeFile.mock.calls[0][0]).toBe(tmpFile);
      expect(writeFile.mock.calls[0][1]).toContain('INSERT INTO "User"');
      expect(writeFile.mock.calls[0][2]).toEqual({ encoding: "utf8", mode: 0o600 });

      expect(execFile).toHaveBeenCalledTimes(1);
      expect(execFile.mock.calls[0][0]).toBe("pnpm");
      expect(execFile.mock.calls[0][1]).toEqual([
        "exec",
        "wrangler",
        "d1",
        "execute",
        "DB",
        "--remote",
        "--env",
        "qa",
        "--file",
        tmpFile,
      ]);

      // The whole temp directory is removed, not just the file inside it.
      expect(rm).toHaveBeenCalledWith("/tmp/spoonjoy-qa-kitchen-abc123", { recursive: true, force: true });

      expect(writeFile.mock.calls[1][0]).toBe("/tmp/creds.json");
      const credentials = JSON.parse(writeFile.mock.calls[1][1] as string);
      expect(credentials).toEqual({
        chef: { username: "qa_kitchen_chef", email: "qa-kitchen-chef@example.com", password: expect.any(String) },
        friend: { username: "qa_kitchen_friend", email: "qa-kitchen-friend@example.com", password: expect.any(String) },
        newbie: { username: "qa_kitchen_newbie", email: "qa-kitchen-newbie@example.com", password: expect.any(String) },
      });
      expect(writeFile.mock.calls[1][2]).toEqual({ encoding: "utf8", mode: 0o600 });
      // chmod explicitly restricts the credentials file even if it already existed
      // (writeFile's mode option only applies to a newly created file).
      expect(chmod).toHaveBeenCalledWith("/tmp/creds.json", 0o600);
      expect(io.log).not.toHaveBeenCalled();
    });

    it("runs wrangler and writes no credentials file (and never calls chmod) when --credentials-out is not given", () => {
      const execFile = vi.fn();
      const writeFile = vi.fn();
      const rm = vi.fn();
      const chmod = vi.fn();
      const mkdtemp = vi.fn(() => "/tmp/spoonjoy-qa-kitchen-noout");
      const io = { log: vi.fn() };

      main(["--target-env", "qa"], { execFile, writeFile, mkdtemp, rm, chmod, io });

      expect(execFile).toHaveBeenCalledTimes(1);
      expect(rm).toHaveBeenCalledWith("/tmp/spoonjoy-qa-kitchen-noout", { recursive: true, force: true });
      expect(writeFile).toHaveBeenCalledTimes(1);
      expect(chmod).not.toHaveBeenCalled();
    });

    it("still removes the temp dir and rethrows when wrangler fails, writing no credentials", () => {
      const wranglerError = new Error("wrangler failed");
      const execFile = vi.fn(() => {
        throw wranglerError;
      });
      const writeFile = vi.fn();
      const rm = vi.fn();
      const chmod = vi.fn();
      const mkdtemp = vi.fn(() => "/tmp/spoonjoy-qa-kitchen-def456");
      const io = { log: vi.fn() };

      expect(() =>
        main(["--target-env", "qa", "--credentials-out", "/tmp/creds.json"], {
          execFile,
          writeFile,
          mkdtemp,
          rm,
          chmod,
          io,
        }),
      ).toThrow(wranglerError);

      expect(rm).toHaveBeenCalledWith("/tmp/spoonjoy-qa-kitchen-def456", { recursive: true, force: true });
      expect(writeFile).toHaveBeenCalledTimes(1);
      expect(chmod).not.toHaveBeenCalled();
    });

    it("rethrows a cleanup failure when wrangler itself succeeds", () => {
      const cleanupError = new Error("rm failed");
      const execFile = vi.fn();
      const writeFile = vi.fn();
      const rm = vi.fn(() => {
        throw cleanupError;
      });
      const chmod = vi.fn();
      const mkdtemp = vi.fn(() => "/tmp/spoonjoy-qa-kitchen-cleanupfail");
      const io = { log: vi.fn() };

      expect(() => main(["--target-env", "qa"], { execFile, writeFile, mkdtemp, rm, chmod, io })).toThrow(
        cleanupError,
      );
      expect(execFile).toHaveBeenCalledTimes(1);
      // No credentials write was reached (no --credentials-out here, and even if there
      // were, the thrown cleanup error would still stop execution before it).
      expect(writeFile).toHaveBeenCalledTimes(1);
    });

    it("does not let a cleanup failure hide a wrangler failure", () => {
      const wranglerError = new Error("wrangler failed");
      const cleanupError = new Error("rm also failed");
      const execFile = vi.fn(() => {
        throw wranglerError;
      });
      const writeFile = vi.fn();
      const rm = vi.fn(() => {
        throw cleanupError;
      });
      const chmod = vi.fn();
      const mkdtemp = vi.fn(() => "/tmp/spoonjoy-qa-kitchen-bothfail");
      const io = { log: vi.fn() };

      let thrown: unknown;
      try {
        main(["--target-env", "qa"], { execFile, writeFile, mkdtemp, rm, chmod, io });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(wranglerError);
      expect(thrown).not.toBe(cleanupError);
    });

    it("prints redacted SQL and performs no side effects in dry-run mode", () => {
      const execFile = vi.fn();
      const writeFile = vi.fn();
      const rm = vi.fn();
      const chmod = vi.fn();
      const mkdtemp = vi.fn();
      const log = vi.fn();

      main(["--target-env", "qa", "--dry-run", "--credentials-out", "/tmp/creds.json"], {
        execFile,
        writeFile,
        mkdtemp,
        rm,
        chmod,
        io: { log },
      });

      expect(execFile).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(mkdtemp).not.toHaveBeenCalled();
      expect(rm).not.toHaveBeenCalled();
      expect(chmod).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledTimes(1);
      const printed = log.mock.calls[0][0] as string;
      expect(printed).toContain('INSERT INTO "User"');
      expect(printed).toContain("<hash>");
      expect(printed).not.toMatch(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{22,53}/);
    });

    it("never prints the actual plaintext passwords in dry-run mode, via an injected password generator", () => {
      const knownPasswords = { chef: "chef-plaintext-pw", friend: "friend-plaintext-pw", newbie: "newbie-plaintext-pw" };
      const generatePasswords = vi.fn(() => knownPasswords);
      const log = vi.fn();

      main(["--target-env", "qa", "--dry-run"], { generatePasswords, io: { log } });

      expect(generatePasswords).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledTimes(1);
      const printed = log.mock.calls[0][0] as string;
      expect(printed).not.toContain(knownPasswords.chef);
      expect(printed).not.toContain(knownPasswords.friend);
      expect(printed).not.toContain(knownPasswords.newbie);
    });

    it("uses process.argv and real dependencies by default", () => {
      const originalArgv = process.argv;
      process.argv = [originalArgv[0], originalArgv[1], "--target-env", "qa", "--dry-run"];
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        main();
        expect(log).toHaveBeenCalledTimes(1);
      } finally {
        log.mockRestore();
        process.argv = originalArgv;
      }
    });
  });

  describe("CLI guard", () => {
    it("detects the CLI entrypoint from a module URL and argv[1]", () => {
      expect(isCliEntry("file:///tmp/seed-qa-kitchen.mjs", "/tmp/seed-qa-kitchen.mjs")).toBe(true);
      expect(isCliEntry("file:///tmp/seed-qa-kitchen.mjs", undefined)).toBe(false);
      expect(isCliEntry("file:///tmp/seed-qa-kitchen.mjs", "/tmp/other.mjs")).toBe(false);
    });

    it("runs the injected main only when the module URL matches argv[1], and reports errors via onError", () => {
      const runMain = vi.fn();
      const onError = vi.fn();

      expect(
        runCliIfEntry({
          moduleUrl: "file:///tmp/other.mjs",
          argv1: "/tmp/seed-qa-kitchen.mjs",
          runMain,
          onError,
        }),
      ).toBe(false);
      expect(runMain).not.toHaveBeenCalled();

      expect(
        runCliIfEntry({
          moduleUrl: "file:///tmp/seed-qa-kitchen.mjs",
          argv1: "/tmp/seed-qa-kitchen.mjs",
          runMain,
          onError,
        }),
      ).toBe(true);
      expect(runMain).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();

      const failure = new Error("boom");
      const failingMain = vi.fn(() => {
        throw failure;
      });
      expect(
        runCliIfEntry({
          moduleUrl: "file:///tmp/seed-qa-kitchen.mjs",
          argv1: "/tmp/seed-qa-kitchen.mjs",
          runMain: failingMain,
          onError,
        }),
      ).toBe(true);
      expect(onError).toHaveBeenCalledWith(failure);
    });

    it("uses import.meta.url and process.argv[1] by default, and never runs from a test module", () => {
      expect(runCliIfEntry()).toBe(false);
    });

    it("prints an Error message and sets a failing exit code by default", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const originalExitCode = process.exitCode;
      try {
        defaultCliErrorHandler(new Error("kaboom"));
        expect(errorSpy).toHaveBeenCalledWith("kaboom");
        expect(process.exitCode).toBe(1);
      } finally {
        errorSpy.mockRestore();
        process.exitCode = originalExitCode;
      }
    });

    it("stringifies a non-Error thrown value", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const originalExitCode = process.exitCode;
      try {
        defaultCliErrorHandler("plain string failure");
        expect(errorSpy).toHaveBeenCalledWith("plain string failure");
      } finally {
        errorSpy.mockRestore();
        process.exitCode = originalExitCode;
      }
    });
  });
});
