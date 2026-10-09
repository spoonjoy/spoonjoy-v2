import { env } from "cloudflare:test";
import type { PrismaClient } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";

import { readAccountSettingsFromD1, readAccountSettingsWithPrisma } from "../../../app/lib/account-settings-reads.server";
import {
  readCookbookPageFromD1,
  readCookbookPageWithPrisma,
  type CookbookPageRows,
} from "../../../app/lib/cookbook-page-reads.server";
import { getDb } from "../../../app/lib/db.server";
import { readKitchenHomeFromD1, readKitchenHomeWithPrisma, type KitchenHomeRows } from "../../../app/lib/kitchen-home.server";
import { getRecipeCoverDisplay } from "../../../app/lib/recipe-cover.server";
import { readRecipeDetailFromD1, readRecipeDetailWithPrisma } from "../../../app/lib/recipe-detail-reads.server";
import {
  rebuildSearchIndex,
  searchSourceFingerprint,
  searchSourceFingerprintFromD1,
  searchSpoonjoy,
  searchSpoonjoyFromD1,
  type SearchOptions,
} from "../../../app/lib/search.server";
import {
  readCookbookListFromD1,
  readCookbookListWithPrisma,
  readPublicRecipesFromD1,
  readPublicRecipesWithPrisma,
  readSavedRecipesFromD1,
  readSavedRecipesWithPrisma,
} from "../../../app/lib/collection-reads.server";
import { searchMyRecipes, searchMyRecipesFromD1 } from "../../../app/lib/my-recipes-search.server";
import { applyRepositoryMigrations } from "./repository-migrations";

// The raw D1 read paths against Wrangler's real D1 (workerd), checked against the Prisma
// reads they replace on the same database. Rows are written both through Prisma (ISO
// timestamps with an offset) and through raw SQL (SQLite's zone-less CURRENT_TIMESTAMP
// form), so the date handling is exercised on both storage formats.

const OWNER = "hot-read-owner";
const FRIEND = "hot-read-friend";
const STRANGER = "hot-read-stranger";
const RECIPE = "hot-read-recipe";
const ISSUER = "https://spoonjoy.test";

let prisma: PrismaClient;

function database(): D1Database {
  return env.DB as D1Database;
}

async function run(sql: string, ...values: unknown[]) {
  await database().prepare(sql).bind(...values).run();
}

async function seed() {
  for (const [id, photoUrl] of [[OWNER, "https://example.com/owner.jpg"], [FRIEND, null], [STRANGER, null]] as const) {
    await run(
      `INSERT INTO "User" ("id", "email", "username", "hashedPassword", "photoUrl", "updatedAt")
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      id,
      `${id}@example.com`,
      id.replaceAll("-", "_"),
      id === STRANGER ? null : "$2a$04$hashhashhashhashhashhu",
      photoUrl,
    );
  }

  // Raw rows, stored in SQLite's zone-less timestamp form.
  await run(`INSERT INTO "Unit" ("id", "name", "updatedAt") VALUES ('hot-read-cup', 'hot read cup', CURRENT_TIMESTAMP)`);
  for (const name of ["rice", "lemon", "parsley"]) {
    await run(
      `INSERT INTO "IngredientRef" ("id", "name", "updatedAt") VALUES (?, ?, '2026-09-01 10:00:00')`,
      `hot-read-${name}`,
      `hot read ${name}`,
    );
  }
  await run(
    `INSERT INTO "Recipe" ("id", "title", "description", "servings", "chefId", "createdAt", "updatedAt")
     VALUES ('hot-read-source', 'Hot Read Source', NULL, NULL, ?, '2026-08-01 09:00:00', '2026-08-01 09:00:00')`,
    FRIEND,
  );

  // Prisma rows, stored as ISO timestamps with an offset.
  await prisma.recipe.create({
    data: {
      id: RECIPE,
      title: "Hot Read Lemon Rice",
      description: "Bright and quick",
      servings: "4",
      chefId: OWNER,
      sourceRecipeId: "hot-read-source",
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
    },
  });
  for (const [stepNum, stepTitle] of [[2, null], [1, "Cook"], [3, "Combine"]] as const) {
    await prisma.recipeStep.create({ data: { recipeId: RECIPE, stepNum, stepTitle, description: `Step ${stepNum}`, duration: stepNum * 5 } });
  }
  for (const [stepNum, ref, quantity] of [[2, "lemon", 1], [1, "rice", 1.5], [2, "parsley", 0.25], [2, "lemon", 2]] as const) {
    await prisma.ingredient.create({
      data: { recipeId: RECIPE, stepNum, quantity, unitId: "hot-read-cup", ingredientRefId: `hot-read-${ref}` },
    });
  }
  await prisma.stepOutputUse.create({ data: { recipeId: RECIPE, outputStepNum: 2, inputStepNum: 3 } });
  await prisma.stepOutputUse.create({ data: { recipeId: RECIPE, outputStepNum: 1, inputStepNum: 3 } });
  const cover = await prisma.recipeCover.create({
    data: {
      recipeId: RECIPE,
      imageUrl: "https://example.com/hot-read.jpg",
      stylizedImageUrl: "https://example.com/hot-read-editorial.jpg",
      sourceType: "spoon",
    },
  });
  await run(
    `INSERT INTO "RecipeCover" ("id", "recipeId", "imageUrl", "sourceType", "status", "archivedAt", "createdAt")
     VALUES ('hot-read-old-cover', ?, 'https://example.com/old.jpg', 'chef-upload', 'archived', '2026-08-02 00:00:00', '2026-08-01 00:00:00')`,
    RECIPE,
  );
  await prisma.recipe.update({ where: { id: RECIPE }, data: { activeCoverId: cover.id, activeCoverVariant: "stylized" } });
  await prisma.recipe.create({ data: { id: "hot-read-deleted", title: "Hot Read Deleted", chefId: OWNER, deletedAt: new Date() } });

  for (let index = 0; index < 4; index += 1) {
    await run(
      `INSERT INTO "RecipeSpoon" ("id", "chefId", "recipeId", "cookedAt", "photoUrl", "note", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      `hot-read-spoon-${index}`,
      index % 2 === 0 ? FRIEND : STRANGER,
      RECIPE,
      `2026-09-0${index + 2} 18:00:00`,
      index === 0 ? null : `https://example.com/spoon-${index}.jpg`,
      `Cook ${index}`,
    );
  }

  await prisma.cookbook.create({ data: { id: "hot-read-cookbook", title: "Hot Read Weeknights", authorId: OWNER } });
  await run(
    `INSERT INTO "Cookbook" ("id", "title", "authorId", "createdAt", "updatedAt")
     VALUES ('hot-read-friend-cookbook', 'Hot Read Friend Picks', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    FRIEND,
  );
  for (let index = 1; index <= 4; index += 1) {
    await run(
      `INSERT INTO "Recipe" ("id", "title", "chefId", "createdAt", "updatedAt")
       VALUES (?, ?, ?, '2026-08-10 09:00:00', '2026-08-10 09:00:00')`,
      `hot-read-extra-${index}`,
      `Hot Read Extra Stew ${index}`,
      FRIEND,
    );
  }
  // The owner's cookbook has seven entries: more than a card previews, two sharing a
  // timestamp, and a deleted recipe as the newest, which no card counts or shows.
  for (const [id, cookbookId, recipeId, addedById, createdAt] of [
    ["hot-read-entry-1", "hot-read-cookbook", RECIPE, OWNER, "2026-09-01 10:00:00"],
    ["hot-read-entry-2", "hot-read-cookbook", "hot-read-source", OWNER, "2026-09-01 10:01:00"],
    ["hot-read-entry-3", "hot-read-friend-cookbook", RECIPE, FRIEND, "2026-09-01 10:02:00"],
    ["hot-read-entry-4", "hot-read-cookbook", "hot-read-extra-1", OWNER, "2026-09-01 10:03:00"],
    ["hot-read-entry-5", "hot-read-cookbook", "hot-read-extra-2", OWNER, "2026-09-01 10:04:00"],
    ["hot-read-entry-6", "hot-read-cookbook", "hot-read-extra-3", OWNER, "2026-09-01 10:04:00"],
    ["hot-read-entry-7", "hot-read-cookbook", "hot-read-extra-4", OWNER, "2026-09-01 10:05:00"],
    ["hot-read-entry-8", "hot-read-cookbook", "hot-read-deleted", OWNER, "2026-09-01 10:06:00"],
  ]) {
    await run(
      `INSERT INTO "RecipeInCookbook" ("id", "cookbookId", "recipeId", "addedById", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?)`,
      id, cookbookId, recipeId, addedById, createdAt, createdAt,
    );
  }
  await run(
    `INSERT INTO "RecipeSpoon" ("id", "chefId", "recipeId", "cookedAt", "photoUrl", "note", "deletedAt", "updatedAt")
     VALUES ('hot-read-spoon-deleted', ?, ?, '2026-09-09 18:00:00', 'https://example.com/deleted.jpg', 'Deleted', '2026-09-10 00:00:00', CURRENT_TIMESTAMP)`,
    FRIEND,
    RECIPE,
  );

  const list = await prisma.shoppingList.create({ data: { authorId: FRIEND } });
  await prisma.shoppingListItem.create({
    data: { shoppingListId: list.id, ingredientRefId: "hot-read-lemon", unitId: "hot-read-cup", quantity: 1.5, categoryKey: "produce" },
  });
  await prisma.shoppingListItem.create({
    data: { shoppingListId: list.id, ingredientRefId: "hot-read-rice", unitId: null, quantity: null, checked: true, checkedAt: new Date() },
  });
  await prisma.shoppingListItem.create({
    data: { shoppingListId: list.id, ingredientRefId: "hot-read-parsley", unitId: "hot-read-cup", quantity: 1, deletedAt: new Date() },
  });

  await prisma.oAuth.create({ data: { provider: "google", providerUserId: "hot-read-g", providerUsername: "owner@gmail.com", userId: OWNER } });
  await prisma.notificationPreference.create({ data: { userId: OWNER, notifyForkOfMyRecipe: false } });
  const client = await prisma.oAuthClient.create({ data: { clientName: "Hot Read Helper", redirectUris: "[]", issuer: ISSUER } });
  await prisma.oAuthRefreshToken.create({
    data: { tokenHash: "hot-read-refresh", userId: OWNER, clientId: client.id, scope: "recipes:read", issuer: ISSUER, connectionKey: "hot-read-conn" },
  });
  await prisma.apiCredential.create({
    data: {
      userId: OWNER, name: "Hot Read Access", tokenHash: "hot-read-access", tokenPrefix: "sj_hotread",
      oauthClientId: client.id, oauthIssuer: ISSUER, oauthConnectionKey: "hot-read-conn",
    },
  });
  await prisma.apiCredential.create({
    data: { userId: OWNER, name: "Hot Read CLI", tokenHash: "hot-read-cli", tokenPrefix: "sj_hotcli", lastUsedAt: new Date() },
  });
  await prisma.apiCredential.create({
    data: { userId: OWNER, name: "Hot Read Revoked", tokenHash: "hot-read-revoked", tokenPrefix: "sj_hotrev", revokedAt: new Date() },
  });
  await prisma.oAuthRefreshToken.create({
    data: { tokenHash: "hot-read-refresh-revoked", userId: OWNER, clientId: client.id, scope: "recipes:read", issuer: ISSUER, revokedAt: new Date() },
  });
  // A legacy token whose client is bound to another issuer: promotion cannot change it.
  const foreign = await prisma.oAuthClient.create({ data: { clientName: "Elsewhere", redirectUris: "[]", issuer: "https://other.example" } });
  await prisma.oAuthRefreshToken.create({
    data: { tokenHash: "hot-read-refresh-foreign", userId: OWNER, clientId: foreign.id, scope: "recipes:read", issuer: null },
  });
}

function displayed(rows: KitchenHomeRows) {
  return {
    ...rows,
    recipes: rows.recipes.map(({ covers, ...recipe }) => ({ ...recipe, cover: getRecipeCoverDisplay(recipe, covers) })),
    cookbooks: rows.cookbooks.map((cookbook) => ({
      ...cookbook,
      recipes: cookbook.recipes.map(({ recipe: { covers, ...recipe }, ...entry }) => ({
        ...entry,
        recipe: { ...recipe, cover: getRecipeCoverDisplay(recipe, covers) },
      })),
    })),
  };
}

// The cookbook page's D1 reader returns only a recipe's active cover, the Prisma reader its
// whole history, so covers are compared by what the page shows.
function displayedCookbookPage(rows: CookbookPageRows) {
  if (!rows.cookbook) return rows;
  return {
    ...rows,
    cookbook: {
      ...rows.cookbook,
      recipes: rows.cookbook.recipes.map(({ recipe: { covers, ...recipe }, ...entry }) => ({
        ...entry,
        recipe: { ...recipe, cover: getRecipeCoverDisplay(recipe, covers) },
      })),
    },
  };
}

describe("hot read paths on Wrangler D1", () => {
  beforeAll(async () => {
    await applyRepositoryMigrations(database());
    prisma = await getDb({ DB: database() });
    await seed();
  });

  it("reads the kitchen home as Prisma does", async () => {
    for (const input of [
      { viewerId: OWNER, kitchenUserWhere: { id: OWNER } },
      { viewerId: FRIEND, kitchenUserWhere: { username: "hot_read_owner" } },
      { viewerId: null, kitchenUserWhere: { id: FRIEND } },
      { viewerId: null, kitchenUserWhere: { username: "nobody-here" } },
    ]) {
      const fromD1 = await readKitchenHomeFromD1(database(), input);
      expect(displayed(fromD1)).toEqual(displayed(await readKitchenHomeWithPrisma(prisma, input)));
    }
    const rows = await readKitchenHomeFromD1(database(), { viewerId: OWNER, kitchenUserWhere: { id: OWNER } });
    expect(rows.recipes.map((recipe) => recipe.id)).toEqual([RECIPE]);
    expect(getRecipeCoverDisplay(rows.recipes[0]!, rows.recipes[0]!.covers)?.displayUrl).toBe("https://example.com/hot-read-editorial.jpg");
    expect(rows.cookbooks[0]).toMatchObject({ id: "hot-read-cookbook", _count: { recipes: 6 } });
    const preview = rows.cookbooks[0]!.recipes;
    expect(preview.map((entry) => entry.id)).toEqual(["hot-read-entry-7", "hot-read-entry-6", "hot-read-entry-5", "hot-read-entry-4"]);
  });

  it("reads the recipe page as Prisma does, for the owner, another chef and a visitor", async () => {
    for (const userId of [OWNER, FRIEND, STRANGER, null]) {
      const fromD1 = await readRecipeDetailFromD1(database(), { recipeId: RECIPE, userId });
      expect(fromD1, String(userId)).toEqual(await readRecipeDetailWithPrisma(prisma, { recipeId: RECIPE, userId }));
    }
    const forOwner = await readRecipeDetailFromD1(database(), { recipeId: RECIPE, userId: OWNER });
    expect(forOwner.recipe?.steps.map((step) => step.ingredients.length)).toEqual([1, 3, 0]);
    expect(forOwner.recipe?.sourceRecipe).toMatchObject({ id: "hot-read-source", chef: { username: "hot_read_friend" } });
    expect(forOwner.coverHistoryCovers.map((cover) => cover.id)).toContain("hot-read-old-cover");
    expect(forOwner.spoons[0]!.cookedAt).toEqual(new Date("2026-09-05T18:00:00.000Z"));

    const forFriend = await readRecipeDetailFromD1(database(), { recipeId: RECIPE, userId: FRIEND });
    expect(forFriend.coverHistoryCovers).toEqual([]);
    expect(forFriend.spoonImages).toEqual([]);
    expect(forFriend.shoppingListItems).toHaveLength(2);

    await expect(readRecipeDetailFromD1(database(), { recipeId: "hot-read-deleted", userId: OWNER }))
      .resolves.toMatchObject({ recipe: null });
  });

  it("reads the cookbook page as Prisma does, for the owner, another chef and a visitor", async () => {
    for (const cookbookId of ["hot-read-cookbook", "hot-read-friend-cookbook", "hot-read-missing-cookbook"]) {
      for (const viewerId of [OWNER, FRIEND, null]) {
        const input = { cookbookId, viewerId };
        expect(displayedCookbookPage(await readCookbookPageFromD1(database(), input)), JSON.stringify(input))
          .toEqual(displayedCookbookPage(await readCookbookPageWithPrisma(prisma, input)));
      }
    }

    // The owner's cookbook holds a deleted recipe, which the page skips, and recipes
    // without an active cover beside the lemon rice and its stylized cover.
    const forVisitor = await readCookbookPageFromD1(database(), { cookbookId: "hot-read-cookbook", viewerId: null });
    expect(forVisitor.cookbook?.author).toEqual({ id: OWNER, username: "hot_read_owner" });
    expect(forVisitor.cookbook?.recipes.map((entry) => entry.id)).toEqual([
      "hot-read-entry-1", "hot-read-entry-2", "hot-read-entry-4", "hot-read-entry-5", "hot-read-entry-6", "hot-read-entry-7",
    ]);
    const [lemonRice, source] = forVisitor.cookbook!.recipes;
    expect(getRecipeCoverDisplay(lemonRice!.recipe, lemonRice!.recipe.covers)?.displayUrl).toBe("https://example.com/hot-read-editorial.jpg");
    expect(source!.recipe).toMatchObject({ activeCoverId: null, covers: [], chef: { username: "hot_read_friend" } });
    expect(forVisitor.availableRecipes).toEqual([]);

    // Only the author is offered recipes to add: the friend's own recipes outside their cookbook.
    const forFriend = await readCookbookPageFromD1(database(), { cookbookId: "hot-read-friend-cookbook", viewerId: FRIEND });
    expect(forFriend.availableRecipes.map((recipe) => recipe.id)).toEqual([
      "hot-read-extra-1", "hot-read-extra-2", "hot-read-extra-3", "hot-read-extra-4", "hot-read-source",
    ]);
    await expect(readCookbookPageFromD1(database(), { cookbookId: "hot-read-friend-cookbook", viewerId: OWNER }))
      .resolves.toMatchObject({ availableRecipes: [] });
  });

  it("promotes legacy OAuth rows and reads account settings in one D1 batch, as Prisma reads them", async () => {
    // A promotable legacy token: its client has no issuer yet.
    const legacyClient = await prisma.oAuthClient.create({ data: { clientName: "Hot Read Legacy", redirectUris: "[]" } });
    await prisma.oAuthRefreshToken.create({
      data: { tokenHash: "hot-read-refresh-legacy", userId: OWNER, clientId: legacyClient.id, scope: "recipes:read", issuer: null },
    });

    for (const userId of [OWNER, STRANGER]) {
      const fromD1 = await readAccountSettingsFromD1(database(), userId, ISSUER);
      expect(fromD1).toEqual(await readAccountSettingsWithPrisma(prisma, userId));
    }
    await expect(database().prepare(`SELECT "issuer" FROM "OAuthClient" WHERE "id" = ?`).bind(legacyClient.id).first())
      .resolves.toEqual({ issuer: ISSUER });
    await expect(database().prepare(`SELECT "issuer" FROM "OAuthRefreshToken" WHERE "tokenHash" = ?`).bind("hot-read-refresh-legacy").first())
      .resolves.toEqual({ issuer: ISSUER });
    // The legacy token whose client is bound to another issuer stays as it was.
    await expect(database().prepare(`SELECT "issuer" FROM "OAuthRefreshToken" WHERE "tokenHash" = ?`).bind("hot-read-refresh-foreign").first())
      .resolves.toEqual({ issuer: null });
    await expect(readAccountSettingsFromD1(database(), OWNER, ISSUER)).resolves.toMatchObject({
      user: { hasPassword: true, OAuth: [{ provider: "google" }] },
      preferences: { notifyForkOfMyRecipe: false },
      accessCredentialCounts: [{ oauthConnectionKey: "hot-read-conn", count: 1 }],
    });
  });

  it("reads the recipe, saved-recipe, cookbook and my-recipe lists as Prisma does", async () => {
    for (const input of [{ query: "", limit: 48 }, { query: "", limit: 2 }, { query: "stew", limit: 48 }]) {
      expect(await readPublicRecipesFromD1(database(), input), JSON.stringify(input))
        .toEqual(await readPublicRecipesWithPrisma(prisma, input));
    }
    for (const userId of [OWNER, FRIEND, STRANGER]) {
      expect(await readSavedRecipesFromD1(database(), userId)).toEqual(await readSavedRecipesWithPrisma(prisma, userId));
      expect(await readCookbookListFromD1(database(), userId)).toEqual(await readCookbookListWithPrisma(prisma, userId));
    }
    for (const [ownerId, ownerUsername] of [[OWNER, "hot_read_owner"], [FRIEND, "hot_read_friend"]] as const) {
      for (const query of ["", "stew", "hot_read", "lemon"]) {
        expect(await searchMyRecipesFromD1(database(), { ownerId, query }))
          .toEqual(await searchMyRecipes(prisma, { ownerId, ownerUsername, query }));
      }
    }
    const [weeknights] = await readCookbookListFromD1(database(), OWNER);
    // Seven entries, one of them a deleted recipe: counted as six, as on the kitchen home.
    expect(weeknights!._count.recipes).toBe(6);
    expect(weeknights!.recipes.map((entry) => entry.id)).toEqual(["hot-read-entry-7", "hot-read-entry-6", "hot-read-entry-5", "hot-read-entry-4"]);
    expect(weeknights!.searchableRecipeTitles).not.toContain("Hot Read Deleted");
  });

  it("fingerprints and indexes search sources exactly as the Prisma path does", async () => {
    expect(await searchSourceFingerprintFromD1(database())).toBe(await searchSourceFingerprint(prisma));

    await rebuildSearchIndex(prisma);
    const prismaDocuments = await database().prepare(`SELECT * FROM "SearchDocument" ORDER BY rowid`).all();
    await run(`DELETE FROM "SearchIndexMetadata"`);
    await searchSpoonjoyFromD1(database(), { query: "hot read" });
    const d1Documents = await database().prepare(`SELECT * FROM "SearchDocument" ORDER BY rowid`).all();
    expect(d1Documents.results).toEqual(prismaDocuments.results);

    const cases: SearchOptions[] = [
      { query: "hot read" },
      { query: "lemon", viewerId: FRIEND },
      { query: "lemon", scope: "shopping-list" },
      { query: "rice, parsley", scope: "recipes" },
      { query: "", viewerId: OWNER, limit: 5 },
    ];
    for (const options of cases) {
      expect(await searchSpoonjoyFromD1(database(), options), JSON.stringify(options))
        .toEqual(await searchSpoonjoy(prisma, options));
    }
    const friendResults = await searchSpoonjoyFromD1(database(), { query: "hot read", viewerId: FRIEND });
    expect(friendResults.filter((result) => result.type === "shopping-list-item").every((result) => result.ownerId === FRIEND))
      .toBe(true);
  });
});
