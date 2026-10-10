// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  AccountDeletionError,
  accountDeletionStatements,
  DELETE_RECIPES_STATEMENT,
  DELETED_CHEF_ID,
  deleteAccount,
  REASSIGN_STATEMENT,
} from "~/lib/account-deletion.server";
import { migratedSqliteD1, type MigratedSqlite } from "../helpers/migrated-sqlite";

const NOW = new Date("2026-10-09T12:00:00.000Z");

let database: MigratedSqlite;

function run(sql: string, ...values: unknown[]) {
  database.sqlite.prepare(sql).run(...values);
}

function all<T = Record<string, unknown>>(sql: string, ...values: unknown[]): T[] {
  return database.sqlite.prepare(sql).all(...values) as T[];
}

function ids(table: string, where = "1 = 1", ...values: unknown[]): string[] {
  return all<{ id: string }>(`SELECT "id" FROM "${table}" WHERE ${where} ORDER BY "id"`, ...values).map((row) => row.id);
}

function user(id: string, photoUrl: string | null = null) {
  run(`INSERT INTO "User" ("id", "email", "username", "photoUrl") VALUES (?, ?, ?, ?)`, id, `${id}@example.com`, id, photoUrl);
}

function recipe(id: string, chefId: string, sourceRecipeId: string | null = null) {
  run(`INSERT INTO "Recipe" ("id", "title", "chefId", "sourceRecipeId", "updatedAt") VALUES (?, ?, ?, ?, '2026-01-01T00:00:00.000Z')`, id, `Recipe ${id}`, chefId, sourceRecipeId);
}

function step(recipeId: string) {
  run(`INSERT INTO "Unit" ("id", "name") VALUES ('unit', 'test-unit') ON CONFLICT DO NOTHING`);
  run(`INSERT INTO "IngredientRef" ("id", "name") VALUES ('flour', 'test-flour') ON CONFLICT DO NOTHING`);
  run(`INSERT INTO "RecipeStep" ("id", "recipeId", "stepNum", "description") VALUES (?, ?, 1, 'Mix')`, `${recipeId}-s1`, recipeId);
  run(`INSERT INTO "Ingredient" ("id", "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId") VALUES (?, ?, 1, 1, 'unit', 'flour')`, `${recipeId}-i1`, recipeId);
}

function cover(id: string, recipeId: string, imageUrl: string, options: { sourceSpoonId?: string; sourceImageUrl?: string; createdById?: string; active?: boolean } = {}) {
  run(
    `INSERT INTO "RecipeCover" ("id", "recipeId", "imageUrl", "sourceImageUrl", "sourceType", "sourceSpoonId", "status", "createdById")
     VALUES (?, ?, ?, ?, 'upload', ?, 'ready', ?)`,
    id, recipeId, imageUrl, options.sourceImageUrl ?? null, options.sourceSpoonId ?? null, options.createdById ?? null,
  );
  if (options.active) run(`UPDATE "Recipe" SET "activeCoverId" = ?, "activeCoverVariant" = 'original', "coverMode" = 'manual' WHERE "id" = ?`, id, recipeId);
}

function spoon(id: string, chefId: string, recipeId: string, photoUrl: string | null = null) {
  run(`INSERT INTO "RecipeSpoon" ("id", "chefId", "recipeId", "photoUrl") VALUES (?, ?, ?, ?)`, id, chefId, recipeId, photoUrl);
}

function cookbook(id: string, authorId: string) {
  run(`INSERT INTO "Cookbook" ("id", "title", "authorId") VALUES (?, ?, ?)`, id, `Cookbook ${id}`, authorId);
}

function save(cookbookId: string, recipeId: string, addedById: string) {
  run(`INSERT INTO "RecipeInCookbook" ("id", "cookbookId", "recipeId", "addedById") VALUES (?, ?, ?, ?)`, `${cookbookId}-${recipeId}`, cookbookId, recipeId, addedById);
}

/** A complete OAuth connection for `userId`: grant, code, two token generations and their lineage. */
function oauthConnection(userId: string, prefix: string) {
  run(`INSERT INTO "OAuthClient" ("id", "redirectUris") VALUES (?, '[]') ON CONFLICT DO NOTHING`, "client");
  run(
    `INSERT INTO "OAuthGrant" ("id", "userId", "clientId", "issuer", "scope", "connectionKey", "status", "statusChangedAt")
     VALUES (?, ?, 'client', 'https://spoonjoy.app', 'kitchen:read', ?, 'active', '2026-01-01')`,
    `${prefix}-grant`, userId, `${prefix}-connection`,
  );
  run(
    `INSERT INTO "OAuthAuthCode" ("id", "codeHash", "clientId", "userId", "redirectUri", "codeChallenge", "scope", "expiresAt", "grantId")
     VALUES (?, ?, 'client', ?, 'https://example.com/cb', 'challenge', 'kitchen:read', '2026-01-01', ?)`,
    `${prefix}-code`, `${prefix}-code-hash`, userId, `${prefix}-grant`,
  );
  for (const generation of [0, 1]) {
    const token = `${prefix}-refresh-${generation}`;
    const access = `${prefix}-access-${generation}`;
    const issuance = `${prefix}-issuance-${generation}`;
    run(`INSERT INTO "OAuthRefreshToken" ("id", "tokenHash", "userId", "clientId", "scope", "grantId") VALUES (?, ?, ?, 'client', 'kitchen:read', ?)`, token, `${token}-hash`, userId, `${prefix}-grant`);
    run(`INSERT INTO "ApiCredential" ("id", "userId", "name", "tokenHash", "tokenPrefix", "oauthGrantId") VALUES (?, ?, 'OAuth', ?, 'sj_', ?)`, access, userId, `${access}-hash`, `${prefix}-grant`);
    const kind = generation === 0 ? "authorization_code" : "refresh_token";
    const parent = generation === 0 ? null : `${prefix}-refresh-0`;
    run(
      `INSERT INTO "OAuthTokenIssuance" ("id", "grantId", "kind", "authorizationCodeId", "parentRefreshTokenId", "accessCredentialId", "refreshTokenId")
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      issuance, `${prefix}-grant`, kind, generation === 0 ? `${prefix}-code` : null, parent, access, token,
    );
    run(
      `INSERT INTO "OAuthRefreshLineage" ("refreshTokenId", "grantId", "issuanceId", "issuanceKind", "generation", "parentRefreshTokenId", "parentGeneration", "expiresAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, '2027-01-01')`,
      token, `${prefix}-grant`, issuance, kind, generation, parent, generation === 0 ? null : 0,
    );
    // One generation is active at a time: generation 0 was rotated into generation 1.
    if (generation === 0) {
      run(`UPDATE "OAuthRefreshLineage" SET "retiredAt" = '2026-01-02', "retirementReason" = 'rotated' WHERE "refreshTokenId" = ?`, token);
    }
  }
}

function notification(id: string, recipientId: string, payload: string) {
  run(`INSERT INTO "NotificationEvent" ("id", "recipientId", "kind", "payload") VALUES (?, ?, 'spoon_on_my_recipe', ?)`, id, recipientId, payload);
}

/**
 * Ada is deleted. Grace is another cook who forked, saved and spooned some of Ada's recipes.
 *
 * - forked: Ada's recipe that Grace forked (grace-fork).
 * - saved: Ada's recipe in Grace's cookbook.
 * - spooned: Ada's recipe Grace logged a cook of.
 * - private: nobody else touched it.
 * - own-fork: Ada's fork of her own private recipe.
 * - chain-root <- chain-mid (Ada's fork) <- grace-chain (Grace's fork of chain-mid).
 * - grace-dish: Grace's recipe that Ada spooned and saved, with a cover from Ada's spoon photo.
 */
function arrangeKitchen() {
  user("ada", "/photos/profiles/ada/me.jpg");
  user("grace");
  for (const id of ["forked", "saved", "spooned", "private", "chain-root"]) recipe(id, "ada");
  recipe("own-fork", "ada", "private");
  recipe("chain-mid", "ada", "chain-root");
  recipe("grace-fork", "grace", "forked");
  recipe("grace-chain", "grace", "chain-mid");
  recipe("grace-dish", "grace");
  step("forked");
  step("private");
  cover("forked-cover", "forked", "/photos/recipes/forked/cover.jpg", { createdById: "ada", active: true });
  // The fork shares the source's R2 key and copies its creator.
  cover("grace-fork-cover", "grace-fork", "/photos/recipes/forked/cover.jpg", { createdById: "ada", active: true });
  cover("private-cover", "private", "/photos/recipes/private/cover.jpg", { createdById: "ada", active: true });

  cookbook("grace-book", "grace");
  save("grace-book", "saved", "grace");
  cookbook("ada-book", "ada");
  save("ada-book", "private", "ada");
  save("ada-book", "grace-dish", "ada");

  spoon("grace-spoon", "grace", "spooned", "/photos/spoons/grace/1.jpg");
  spoon("ada-spoon", "ada", "grace-dish", "/photos/spoons/ada/1.jpg");
  spoon("ada-own-spoon", "ada", "private", "/photos/spoons/ada/2.jpg");
  cover("grace-dish-cover", "grace-dish", "/photos/spoons/ada/1.jpg", { sourceSpoonId: "ada-spoon", createdById: "ada", active: true });
  // A stylized copy of Ada's spoon photo that kept only the source URL.
  cover("grace-dish-stylized", "grace-dish", "/photos/covers/stylized.jpg", { sourceImageUrl: "/photos/spoons/ada/1.jpg" });
  cover("grace-dish-own", "grace-dish", "/photos/recipes/grace-dish/own.jpg", { createdById: "grace" });

  run(`INSERT INTO "ShoppingList" ("id", "authorId") VALUES ('ada-list', 'ada')`);
  run(`INSERT INTO "UserCredential" ("id", "userId", "publicKey", "counter") VALUES ('passkey', 'ada', x'00', 0)`);
  run(`INSERT INTO "OAuth" ("provider", "providerUserId", "providerUsername", "userId") VALUES ('apple', 'apple-ada', 'ada', 'ada')`);
  run(`INSERT INTO "ApiCredential" ("id", "userId", "name", "tokenHash", "tokenPrefix") VALUES ('ada-token', 'ada', 'CLI', 'ada-token-hash', 'sj_')`);
  run(`INSERT INTO "PushSubscription" ("id", "userId", "endpoint", "p256dh", "authSecret") VALUES ('ada-push', 'ada', 'https://fcm.googleapis.com/x', 'k', 'a')`);
  run(
    `INSERT INTO "AgentConnectionRequest" ("id", "deviceCodeHash", "userCode", "agentName", "scopes", "status", "approvedById", "expiresAt")
     VALUES ('ada-agent', 'h', 'ABCD', 'Agent', 'kitchen:read', 'approved', 'ada', '2027-01-01')`,
  );
  oauthConnection("ada", "ada");
  oauthConnection("grace", "grace");

  notification("to-ada", "ada", JSON.stringify({ spoonerUsername: "grace" }));
  notification("names-ada", "grace", JSON.stringify({ spoonerUsername: "ada" }));
  notification("forker-ada", "grace", JSON.stringify({ forkerUsername: "ada" }));
  notification("names-grace", "grace", JSON.stringify({ actorUsername: "someone-else" }));
  notification("malformed", "grace", "not json");
}

beforeEach(() => {
  database = migratedSqliteD1();
});

describe("deleteAccount", () => {
  it("removes the account and everything only it used, and keeps what other cooks built on", async () => {
    arrangeKitchen();

    const result = await deleteAccount(database.binding as never, "ada", { now: NOW });

    // forked, saved, spooned are engaged; chain-mid is forked by Grace. The rest is deleted.
    expect(result).toEqual({ reassignedRecipes: 4, deletedRecipes: 3 });
    expect(ids("User")).toEqual([DELETED_CHEF_ID, "grace"]);
    expect(ids("Recipe", `"chefId" = ?`, DELETED_CHEF_ID)).toEqual(["chain-mid", "forked", "saved", "spooned"]);
    expect(ids("Recipe", `"chefId" = 'grace'`)).toEqual(["grace-chain", "grace-dish", "grace-fork"]);

    // Forks stay their forker's and keep their source; chain-mid's own source was deleted.
    expect(all(`SELECT "id", "sourceRecipeId" FROM "Recipe" WHERE "sourceRecipeId" IS NOT NULL ORDER BY "id"`)).toEqual([
      { id: "grace-chain", sourceRecipeId: "chain-mid" },
      { id: "grace-fork", sourceRecipeId: "forked" },
    ]);
    // The reassigned recipe keeps its steps and cover; the deleted one's are gone.
    expect(ids("RecipeStep")).toEqual(["forked-s1"]);
    expect(ids("Ingredient")).toEqual(["forked-i1"]);
    expect(ids("RecipeCover", `"status" != 'archived'`)).toEqual(["forked-cover", "grace-dish-own", "grace-fork-cover"]);
    expect(all(`SELECT "id" FROM "RecipeCover" WHERE "createdById" = 'ada'`)).toEqual([]);
    // Reassigned recipes changed, so the search index and native clients notice.
    expect(all(`SELECT DISTINCT "updatedAt" FROM "Recipe" WHERE "chefId" = ?`, DELETED_CHEF_ID)).toEqual([{ updatedAt: NOW.toISOString() }]);
    expect(all(`SELECT "updatedAt" FROM "Cookbook" WHERE "id" = 'grace-book'`)).toEqual([{ updatedAt: NOW.toISOString() }]);

    // Ada's spoon photo no longer covers Grace's recipe, in any copy.
    expect(ids("RecipeCover", `"status" = 'archived'`)).toEqual(["grace-dish-cover", "grace-dish-stylized"]);
    expect(all(`SELECT "activeCoverId", "coverMode" FROM "Recipe" WHERE "id" = 'grace-dish'`)).toEqual([{ activeCoverId: null, coverMode: "none" }]);

    // Grace's spoon on a reassigned recipe stays; Ada's spoons, cookbook and saves are gone.
    expect(ids("RecipeSpoon")).toEqual(["grace-spoon"]);
    expect(ids("Cookbook")).toEqual(["grace-book"]);
    expect(ids("RecipeInCookbook")).toEqual(["grace-book-saved"]);
    expect(ids("ShoppingList")).toEqual([]);

    // Every way to act as Ada is gone; Grace's connection is untouched.
    for (const table of ["UserCredential", "PushSubscription", "AgentConnectionRequest"]) expect(ids(table)).toEqual([]);
    expect(all(`SELECT "userId" FROM "OAuth"`)).toEqual([]);
    expect(ids("ApiCredential")).toEqual(["grace-access-0", "grace-access-1"]);
    expect(ids("OAuthGrant")).toEqual(["grace-grant"]);
    expect(ids("OAuthRefreshToken")).toEqual(["grace-refresh-0", "grace-refresh-1"]);
    expect(ids("OAuthAuthCode")).toEqual(["grace-code"]);
    expect(ids("OAuthTokenIssuance")).toEqual(["grace-issuance-0", "grace-issuance-1"]);
    expect(all(`SELECT "refreshTokenId" FROM "OAuthRefreshLineage" ORDER BY 1`)).toEqual([
      { refreshTokenId: "grace-refresh-0" },
      { refreshTokenId: "grace-refresh-1" },
    ]);

    // Notifications to Ada, and to others naming Ada, are gone; a malformed payload is skipped.
    expect(ids("NotificationEvent")).toEqual(["malformed", "names-grace"]);

    // Ada's photos are queued for the sweep, eligible now; it keeps any a live row still uses.
    expect(all(`SELECT "key", "reason", "eligibleAt" FROM "PhotoCleanup" ORDER BY "key"`)).toEqual([
      { key: "profiles/ada/me.jpg", reason: "account_deleted", eligibleAt: NOW.toISOString() },
      { key: "recipes/forked/cover.jpg", reason: "account_deleted", eligibleAt: NOW.toISOString() },
      { key: "recipes/private/cover.jpg", reason: "account_deleted", eligibleAt: NOW.toISOString() },
      { key: "spoons/ada/1.jpg", reason: "account_deleted", eligibleAt: NOW.toISOString() },
      { key: "spoons/ada/2.jpg", reason: "account_deleted", eligibleAt: NOW.toISOString() },
    ]);
    expect(database.sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("reuses the deleted-chef account for the next deleted account", async () => {
    user("ada");
    user("bob");
    user("grace");
    recipe("ada-dish", "ada");
    recipe("bob-dish", "bob");
    recipe("grace-fork-ada", "grace", "ada-dish");
    recipe("grace-fork-bob", "grace", "bob-dish");

    await deleteAccount(database.binding as never, "ada", { now: NOW });
    await deleteAccount(database.binding as never, "bob", { now: new Date(NOW.getTime() + 1000) });

    expect(ids("User")).toEqual([DELETED_CHEF_ID, "grace"]);
    expect(ids("Recipe", `"chefId" = ?`, DELETED_CHEF_ID)).toEqual(["ada-dish", "bob-dish"]);
  });

  it("deletes an account with nothing in it", async () => {
    user("ada");
    await expect(deleteAccount(database.binding as never, "ada", { now: NOW })).resolves.toEqual({ reassignedRecipes: 0, deletedRecipes: 0 });
    expect(ids("User")).toEqual([DELETED_CHEF_ID]);
  });

  it("refuses a missing account and the deleted-chef account", async () => {
    await expect(deleteAccount(database.binding as never, "nobody")).rejects.toMatchObject({ code: "account_not_found" });
    await expect(deleteAccount(database.binding as never, DELETED_CHEF_ID)).rejects.toMatchObject({ code: "account_not_deletable" });
    await expect(deleteAccount(database.binding as never, DELETED_CHEF_ID)).rejects.toBeInstanceOf(AccountDeletionError);
  });

  it("writes nothing for a missing account", async () => {
    user("grace");
    await expect(deleteAccount(database.binding as never, "ada", { now: NOW })).rejects.toMatchObject({ code: "account_not_found" });
    expect(ids("User")).toEqual(["grace"]);
  });

  it("rolls everything back when a statement fails", async () => {
    arrangeKitchen();
    // Someone already holds the deleted-chef username, so the reassignment cannot find its owner.
    run(`INSERT INTO "User" ("id", "email", "username") VALUES ('impostor', 'i@example.com', 'deleted-chef')`);

    await expect(deleteAccount(database.binding as never, "ada", { now: NOW })).rejects.toThrow(/FOREIGN KEY/);
    expect(ids("User")).toEqual(["ada", "grace", "impostor"]);
    expect(ids("Recipe", `"chefId" = 'ada'`)).toHaveLength(7);
    expect(all(`SELECT * FROM "PhotoCleanup"`)).toEqual([]);
  });

  it("uses the current time by default", async () => {
    user("ada");
    user("grace");
    recipe("dish", "ada");
    recipe("fork", "grace", "dish");
    const before = Date.now();
    await deleteAccount(database.binding as never, "ada");
    const [{ updatedAt }] = all<{ updatedAt: string }>(`SELECT "updatedAt" FROM "Recipe" WHERE "id" = 'dish'`);
    expect(Date.parse(updatedAt)).toBeGreaterThanOrEqual(before);
  });
});

describe("accountDeletionStatements", () => {
  it("names the reassignment and recipe deletion statements the result counts", () => {
    const statements = accountDeletionStatements("ada", NOW);
    expect(statements[REASSIGN_STATEMENT][0]).toContain(`UPDATE "Recipe" AS "r" SET "chefId"`);
    expect(statements[DELETE_RECIPES_STATEMENT][0]).toBe(`DELETE FROM "Recipe" WHERE "chefId" = ?`);
  });

  it("binds few enough values for D1 in every statement", () => {
    for (const [sql, ...values] of accountDeletionStatements("ada", NOW)) {
      expect(values.length, sql).toBeLessThanOrEqual(100);
      expect(values.length, sql).toBe((sql.match(/\?/g) ?? []).length);
    }
  });
});
