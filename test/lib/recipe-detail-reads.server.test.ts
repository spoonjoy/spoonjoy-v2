// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Request as UndiciRequest } from "undici";
import { getLocalDb } from "~/lib/db.server";
import { readRecipeDetailFromD1, readRecipeDetailWithPrisma } from "~/lib/recipe-detail-reads.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser, getOrCreateIngredientRef, getOrCreateUnit } from "../utils";

let db: PrismaClient;
let d1: SqliteD1;

const at = (minute: number) => new Date(Date.UTC(2026, 8, 1, 12, minute));

async function seedRecipe() {
  const owner = await db.user.create({ data: { ...createTestUser(), photoUrl: "https://example.com/owner.jpg" } });
  const friend = await db.user.create({ data: createTestUser() });
  const stranger = await db.user.create({ data: createTestUser() });

  const source = await db.recipe.create({ data: { title: "Grandma's Rice", chefId: friend.id } });
  const recipe = await db.recipe.create({
    data: {
      title: "Lemon Herb Rice",
      description: "Bright",
      servings: "4",
      chefId: owner.id,
      sourceRecipeId: source.id,
      sourceUrl: "https://example.com/rice",
      createdAt: at(0),
      updatedAt: at(1),
    },
  });
  await db.recipe.update({ where: { id: source.id }, data: { deletedAt: at(2) } });

  const cup = await getOrCreateUnit(db, "cup-detail-reads");
  const whole = await getOrCreateUnit(db, "whole-detail-reads");
  const rice = await getOrCreateIngredientRef(db, "rice-detail-reads");
  const lemon = await getOrCreateIngredientRef(db, "lemon-detail-reads");
  const parsley = await getOrCreateIngredientRef(db, "parsley-detail-reads");
  await db.recipeStep.create({ data: { recipeId: recipe.id, stepNum: 3, stepTitle: "Combine", description: "Fold", duration: 5 } });
  await db.recipeStep.create({ data: { recipeId: recipe.id, stepNum: 1, stepTitle: "Cook", description: "Simmer", duration: 20 } });
  await db.recipeStep.create({ data: { recipeId: recipe.id, stepNum: 2, stepTitle: null, description: "Dress" } });
  // Inserted out of name order: the page keeps insertion order within a step.
  await db.ingredient.create({ data: { recipeId: recipe.id, stepNum: 2, quantity: 1, unitId: whole.id, ingredientRefId: lemon.id } });
  await db.ingredient.create({ data: { recipeId: recipe.id, stepNum: 1, quantity: 1.5, unitId: cup.id, ingredientRefId: rice.id } });
  await db.ingredient.create({ data: { recipeId: recipe.id, stepNum: 2, quantity: 0.25, unitId: cup.id, ingredientRefId: parsley.id } });
  await db.ingredient.create({ data: { recipeId: recipe.id, stepNum: 2, quantity: 2, unitId: cup.id, ingredientRefId: lemon.id } });
  await db.stepOutputUse.create({ data: { recipeId: recipe.id, outputStepNum: 2, inputStepNum: 3 } });
  await db.stepOutputUse.create({ data: { recipeId: recipe.id, outputStepNum: 1, inputStepNum: 3 } });
  await db.stepOutputUse.create({ data: { recipeId: recipe.id, outputStepNum: 1, inputStepNum: 2 } });

  const oldCover = await db.recipeCover.create({
    data: { recipeId: recipe.id, imageUrl: "https://example.com/old.jpg", sourceType: "chef-upload", createdAt: at(3), archivedAt: at(5), status: "archived" },
  });
  // A stylized-only cover: its history entry has no raw image variant.
  await db.recipeCover.create({
    data: { recipeId: recipe.id, imageUrl: "", stylizedImageUrl: "https://example.com/s.jpg", sourceType: "ai-placeholder", createdAt: at(3) },
  });
  const cover = await db.recipeCover.create({
    data: {
      recipeId: recipe.id,
      imageUrl: "https://example.com/c.jpg",
      stylizedImageUrl: "https://example.com/c-editorial.jpg",
      sourceType: "spoon",
      status: "processing",
      generationStatus: "processing",
      createdAt: at(4),
      // Regenerated just now, so the page reads it as a live generation, not a stuck one.
      generationStartedAt: new Date(),
    },
  });
  await db.recipe.update({ where: { id: recipe.id }, data: { activeCoverId: cover.id, activeCoverVariant: "image" } });

  for (let index = 0; index < 12; index += 1) {
    await db.recipeSpoon.create({
      data: {
        recipeId: recipe.id,
        chefId: index % 2 === 0 ? friend.id : stranger.id,
        cookedAt: at(10 + (index % 6)),
        photoUrl: index % 3 === 0 ? null : `https://example.com/spoon-${index}.jpg`,
        note: `Cook ${index}`,
        nextTime: index === 1 ? "More lemon" : null,
        deletedAt: index === 5 ? at(30) : null,
      },
    });
  }

  const friendCookbooks = [
    await db.cookbook.create({ data: { title: "Zesty", authorId: friend.id } }),
    await db.cookbook.create({ data: { title: "All Rice", authorId: friend.id } }),
  ];
  await db.recipeInCookbook.create({ data: { cookbookId: friendCookbooks[0]!.id, recipeId: recipe.id, addedById: friend.id } });
  await db.cookbook.create({ data: { title: "Owner's", authorId: owner.id } });

  const friendList = await db.shoppingList.create({ data: { authorId: friend.id } });
  await db.shoppingListItem.create({ data: { shoppingListId: friendList.id, ingredientRefId: lemon.id, unitId: whole.id, quantity: 1 } });
  await db.shoppingListItem.create({ data: { shoppingListId: friendList.id, ingredientRefId: rice.id, unitId: null, quantity: null } });
  await db.shoppingListItem.create({
    data: { shoppingListId: friendList.id, ingredientRefId: parsley.id, unitId: cup.id, quantity: 1, deletedAt: at(9) },
  });
  const unrelated = await getOrCreateIngredientRef(db, "unrelated-detail-reads");
  await db.shoppingListItem.create({ data: { shoppingListId: friendList.id, ingredientRefId: unrelated.id, unitId: cup.id } });
  const strangerList = await db.shoppingList.create({ data: { authorId: stranger.id } });
  await db.shoppingListItem.create({ data: { shoppingListId: strangerList.id, ingredientRefId: rice.id, unitId: cup.id } });

  return { owner, friend, stranger, recipe, source, cover, oldCover };
}

describe("recipe detail reads", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("returns what the Prisma reads return, in one D1 batch, for the owner, another chef and a visitor", async () => {
    const { owner, friend, stranger, recipe } = await seedRecipe();

    for (const userId of [owner.id, friend.id, stranger.id, null]) {
      const before = d1.roundTrips();
      const fromD1 = await readRecipeDetailFromD1(d1.binding, { recipeId: recipe.id, userId });
      expect(d1.roundTrips() - before).toBe(1);
      expect(fromD1, String(userId)).toEqual(await readRecipeDetailWithPrisma(db, { recipeId: recipe.id, userId }));
    }

    const forOwner = await readRecipeDetailFromD1(d1.binding, { recipeId: recipe.id, userId: owner.id });
    expect(forOwner.recipe?.steps.map((step) => step.stepNum)).toEqual([1, 2, 3]);
    expect(forOwner.recipe?.steps[1]!.ingredients.map((ingredient) => ingredient.ingredientRef.name)).toEqual([
      "lemon-detail-reads", "parsley-detail-reads", "lemon-detail-reads",
    ]);
    expect(forOwner.recipe?.steps[2]!.usingSteps.map((use) => use.outputOfStep)).toEqual([
      { stepNum: 1, stepTitle: "Cook" }, { stepNum: 2, stepTitle: null },
    ]);
    expect(forOwner.recipe?.sourceRecipe).toMatchObject({ title: "Grandma's Rice", chef: { username: friend.username } });
    expect(forOwner.spoons).toHaveLength(10);
    expect(forOwner.coverHistoryCovers).toHaveLength(3);
    expect(forOwner.spoonImages.length).toBeGreaterThan(0);
    expect(forOwner.isOriginCookCandidate).toBe(true);

    const forFriend = await readRecipeDetailFromD1(d1.binding, { recipeId: recipe.id, userId: friend.id });
    // Owner-only reads stay empty for anyone else.
    expect(forFriend.coverHistoryCovers).toEqual([]);
    expect(forFriend.spoonImages).toEqual([]);
    expect(forFriend.isOriginCookCandidate).toBe(false);
    expect(forFriend.userCookbooks.map((cookbook) => [cookbook.title, cookbook.recipes.length])).toEqual([
      ["All Rice", 0], ["Zesty", 1],
    ]);
    // Only the viewer's own, not-deleted items for this recipe's ingredients.
    expect(forFriend.shoppingListItems).toHaveLength(2);
  });

  it("returns no owner-only rows from D1 for anyone but the owner, before the JavaScript check", async () => {
    const { owner, friend, recipe } = await seedRecipe();
    const rawResults: unknown[][] = [];
    const recording = {
      prepare: d1.binding.prepare,
      batch: async (statements: Parameters<typeof d1.binding.batch>[0]) => {
        const results = await d1.binding.batch(statements);
        rawResults.splice(0, rawResults.length, ...results.map((result) => result.results));
        return results;
      },
    };
    // Statements 8 and 9 are cover history and spoon photos; their SQL guard alone hides them.
    await readRecipeDetailFromD1(recording as never, { recipeId: recipe.id, userId: friend.id });
    expect(rawResults[8]).toEqual([]);
    expect(rawResults[9]).toEqual([]);
    await readRecipeDetailFromD1(recording as never, { recipeId: recipe.id, userId: owner.id });
    expect(rawResults[8]).toHaveLength(3);
    expect((rawResults[9] as unknown[]).length).toBeGreaterThan(0);
  });

  it("is not an origin cook once the owner has spooned the recipe", async () => {
    const { owner, recipe } = await seedRecipe();
    await db.recipeSpoon.create({ data: { recipeId: recipe.id, chefId: owner.id, note: "First cook" } });

    const fromD1 = await readRecipeDetailFromD1(d1.binding, { recipeId: recipe.id, userId: owner.id });
    expect(fromD1.isOriginCookCandidate).toBe(false);
    expect(fromD1).toEqual(await readRecipeDetailWithPrisma(db, { recipeId: recipe.id, userId: owner.id }));
  });

  it("reads a recipe without a source, a cover or steps", async () => {
    const owner = await db.user.create({ data: createTestUser() });
    const bare = await db.recipe.create({ data: { title: "Bare", chefId: owner.id } });

    for (const userId of [owner.id, null]) {
      const fromD1 = await readRecipeDetailFromD1(d1.binding, { recipeId: bare.id, userId });
      expect(fromD1).toMatchObject({ recipe: { sourceRecipe: null, activeCover: null, steps: [] } });
      expect(fromD1).toEqual(await readRecipeDetailWithPrisma(db, { recipeId: bare.id, userId }));
    }
  });

  it("returns no recipe, and nothing else, for a missing or deleted recipe", async () => {
    const { owner, recipe } = await seedRecipe();
    const empty = {
      recipe: null,
      userCookbooks: [],
      shoppingListItems: [],
      spoons: [],
      isOriginCookCandidate: false,
      coverHistoryCovers: [],
      spoonImages: [],
    };
    await expect(readRecipeDetailFromD1(d1.binding, { recipeId: "missing", userId: owner.id })).resolves.toEqual(empty);
    await expect(readRecipeDetailWithPrisma(db, { recipeId: "missing", userId: owner.id })).resolves.toEqual(empty);

    await db.recipe.update({ where: { id: recipe.id }, data: { deletedAt: at(50) } });
    await expect(readRecipeDetailFromD1(d1.binding, { recipeId: recipe.id, userId: owner.id })).resolves.toEqual(empty);
    await expect(readRecipeDetailWithPrisma(db, { recipeId: recipe.id, userId: owner.id })).resolves.toEqual(empty);
  });

  it("fails closed on a D1 error or a malformed row", async () => {
    const { owner, recipe } = await seedRecipe();
    const failing = { prepare: d1.binding.prepare, batch: async () => { throw new Error("D1_ERROR: lost"); } };
    await expect(readRecipeDetailFromD1(failing as never, { recipeId: recipe.id, userId: null })).rejects.toThrow("D1_ERROR: lost");

    const tampered = (edit: (results: Array<{ results: Record<string, unknown>[] }>) => void) => ({
      prepare: d1.binding.prepare,
      batch: async (statements: Parameters<typeof d1.binding.batch>[0]) => {
        const results = (await d1.binding.batch(statements)) as Array<{ results: Record<string, unknown>[] }>;
        edit(results);
        return results;
      },
    });
    const input = { recipeId: recipe.id, userId: owner.id };
    await expect(readRecipeDetailFromD1(tampered((r) => { r[0]!.results[0]!.chef_id = null; }) as never, input))
      .rejects.toThrow("D1 recipe chef is missing");
    await expect(readRecipeDetailFromD1(tampered((r) => { r[0]!.results[0]!.cover_id = 7; }) as never, input))
      .rejects.toThrow("D1 active cover id is not a string");
    await expect(readRecipeDetailFromD1(tampered((r) => { r[0]!.results[0]!.source_chef_username = null; }) as never, input))
      .rejects.toThrow("D1 column source_chef_username does not hold a string value");
    await expect(readRecipeDetailFromD1(tampered((r) => { r[7]!.results = []; }) as never, input))
      .rejects.toThrow("D1 prior spoon check returned no answer");
    await expect(readRecipeDetailFromD1(tampered((r) => { r[2]!.results[0]!.quantity = "1"; }) as never, input))
      .rejects.toThrow("D1 column quantity does not hold a float value");
  });
});

describe("recipe detail loader on a D1 binding", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    vi.doUnmock("~/lib/route-platform.server");
    vi.resetModules();
    await cleanupDatabase();
  });

  it("builds the page from D1 in two round trips, matches the Prisma page, and never constructs a Prisma client", async () => {
    const { owner, friend, recipe } = await seedRecipe();
    const { loadRecipeDetail: loadWithPrisma } = await import("~/lib/recipe-detail.server");

    vi.resetModules();
    const getRequestDb = vi.fn();
    vi.doMock("~/lib/route-platform.server", () => ({ getRequestDb }));
    const { loadRecipeDetail } = await import("~/lib/recipe-detail.server");

    // Both loads stamp renderedAt (what the cooks' "3 hr ago" labels are measured from) with the
    // clock, so the clock is held still for the comparison.
    const renderedAt = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(renderedAt);
    for (const userId of [owner.id, friend.id, null]) {
      const headers = userId ? { Cookie: (await createUserSessionCookie(userId)).split(";")[0]! } : undefined;
      const request = () => new UndiciRequest(`http://localhost:3000/recipes/${recipe.id}`, { headers });
      const before = d1.roundTrips();
      const fromD1 = await loadRecipeDetail({
        request: request(),
        params: { id: recipe.id },
        context: { cloudflare: { env: { DB: d1.binding } } },
      } as never);
      expect(d1.roundTrips() - before).toBe(userId ? 2 : 1);
      const fromPrisma = await loadWithPrisma({
        request: request(),
        params: { id: recipe.id },
        context: { cloudflare: { env: null } },
      } as never);
      expect(fromD1.renderedAt).toBe(renderedAt);
      expect(fromD1).toEqual(fromPrisma);
    }
    clock.mockRestore();
    expect(getRequestDb).not.toHaveBeenCalled();

    await expect(
      loadRecipeDetail({
        request: new UndiciRequest("http://localhost:3000/recipes/missing"),
        params: { id: "missing" },
        context: { cloudflare: { env: { DB: d1.binding } } },
      } as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("fails a generation that stopped long ago through D1, still without a Prisma client", async () => {
    const { owner, recipe, cover } = await seedRecipe();
    // The active cover's editorial pass started an hour ago and its job never finished.
    await db.recipeCover.update({ where: { id: cover.id }, data: { generationStartedAt: new Date(Date.now() - 60 * 60_000) } });

    vi.resetModules();
    const getRequestDb = vi.fn();
    vi.doMock("~/lib/route-platform.server", () => ({ getRequestDb }));
    const { loadRecipeDetail } = await import("~/lib/recipe-detail.server");
    const headers = { Cookie: (await createUserSessionCookie(owner.id)).split(";")[0]! };

    const page = await loadRecipeDetail({
      request: new UndiciRequest(`http://localhost:3000/recipes/${recipe.id}`, { headers }),
      params: { id: recipe.id },
      context: { cloudflare: { env: { DB: d1.binding } } },
    } as never);

    expect(page.activeCoverProcessing).toBeNull();
    expect(getRequestDb).not.toHaveBeenCalled();
    await expect(db.recipeCover.findUniqueOrThrow({ where: { id: cover.id } })).resolves.toMatchObject({
      status: "ready",
      generationStatus: "failed",
      failureReason: "Generation stopped before it finished.",
    });
  });
});
