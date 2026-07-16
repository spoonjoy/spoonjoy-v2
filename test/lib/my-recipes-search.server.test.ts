import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import {
  MY_RECIPES_PAGE_SIZE,
  normalizeMyRecipesPage,
  normalizeMyRecipesQuery,
  searchMyRecipes,
} from "~/lib/my-recipes-search.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser, getOrCreateIngredientRef, getOrCreateUnit } from "../utils";

async function createChef(label: string) {
  return db.user.create({
    data: {
      ...createTestUser(),
      username: `${label}_${faker.string.alphanumeric(8).toLowerCase()}`,
    },
  });
}

async function createRecipe({
  chefId,
  id,
  title,
  description = null,
  servings = null,
  updatedAt,
  deletedAt = null,
}: {
  chefId: string;
  id?: string;
  title: string;
  description?: string | null;
  servings?: string | null;
  updatedAt: Date;
  deletedAt?: Date | null;
}) {
  return db.recipe.create({
    data: {
      id,
      chefId,
      title,
      description,
      servings,
      updatedAt,
      deletedAt,
    },
  });
}

async function addIngredient(recipeId: string, ingredientName: string) {
  const step = await db.recipeStep.create({
    data: {
      recipeId,
      stepNum: 1,
      stepTitle: "Prep",
      description: `Use ${ingredientName}`,
    },
  });
  const unit = await getOrCreateUnit(db, `unit_${faker.string.alphanumeric(8).toLowerCase()}`);
  const ingredientRef = await getOrCreateIngredientRef(db, ingredientName);

  return db.ingredient.create({
    data: {
      recipeId,
      stepNum: step.stepNum,
      quantity: 1,
      unitId: unit.id,
      ingredientRefId: ingredientRef.id,
    },
  });
}

describe("my-recipes-search.server", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("normalizes query and page inputs without inventing wildcard semantics", () => {
    expect(normalizeMyRecipesQuery(null)).toBe("");
    expect(normalizeMyRecipesQuery("  SuMaC oil  ")).toBe("SuMaC oil");
    expect(normalizeMyRecipesPage(null)).toBe(1);
    expect(normalizeMyRecipesPage("0")).toBe(1);
    expect(normalizeMyRecipesPage("-2")).toBe(1);
    expect(normalizeMyRecipesPage("2.8")).toBe(2);
    expect(normalizeMyRecipesPage("not-a-page")).toBe(1);
  });

  it("matches only the owner's active recipes across title, description, servings, username, and ingredients", async () => {
    const owner = await createChef("my_search_owner");
    const otherOwner = await createChef("my_search_other");
    const titleMatch = await createRecipe({
      chefId: owner.id,
      title: "Sumac Onion Toast",
      updatedAt: new Date("2026-03-05T00:00:00.000Z"),
    });
    const descriptionMatch = await createRecipe({
      chefId: owner.id,
      title: "Quiet Beans",
      description: "A skillet with bright sumac oil",
      updatedAt: new Date("2026-03-04T00:00:00.000Z"),
    });
    const servingsMatch = await createRecipe({
      chefId: owner.id,
      title: "Picnic Salad",
      servings: "Serves sumac club",
      updatedAt: new Date("2026-03-03T00:00:00.000Z"),
    });
    const ingredientMatch = await createRecipe({
      chefId: owner.id,
      title: "Lentil Bowl",
      updatedAt: new Date("2026-03-02T00:00:00.000Z"),
    });
    await addIngredient(ingredientMatch.id, "codex sumac");
    await createRecipe({
      chefId: owner.id,
      title: "Deleted Sumac",
      updatedAt: new Date("2026-03-06T00:00:00.000Z"),
      deletedAt: new Date("2026-03-06T01:00:00.000Z"),
    });
    await createRecipe({
      chefId: otherOwner.id,
      title: "Other Sumac",
      updatedAt: new Date("2026-03-07T00:00:00.000Z"),
    });

    const result = await searchMyRecipes(db, {
      ownerId: owner.id,
      ownerUsername: owner.username,
      query: "  SuMaC  ",
    });

    expect(result).toMatchObject({
      query: "SuMaC",
      page: 1,
      pageSize: MY_RECIPES_PAGE_SIZE,
      hasPreviousPage: false,
      hasNextPage: false,
    });
    expect(result.recipes.map((recipe) => recipe.id)).toEqual([
      titleMatch.id,
      descriptionMatch.id,
      servingsMatch.id,
      ingredientMatch.id,
    ]);

    const usernameResult = await searchMyRecipes(db, {
      ownerId: owner.id,
      ownerUsername: owner.username,
      query: owner.username.toUpperCase(),
    });
    expect(usernameResult.recipes.map((recipe) => recipe.id)).toEqual([
      titleMatch.id,
      descriptionMatch.id,
      servingsMatch.id,
      ingredientMatch.id,
    ]);
  });

  it("treats percent, underscore, and backslash as literal search characters", async () => {
    const owner = await createChef("special_owner");
    const literalMatch = await createRecipe({
      chefId: owner.id,
      title: "100%_fold \\ sauce",
      updatedAt: new Date("2026-03-05T00:00:00.000Z"),
    });
    await createRecipe({
      chefId: owner.id,
      title: "100xxfold sauce",
      updatedAt: new Date("2026-03-06T00:00:00.000Z"),
    });

    const result = await searchMyRecipes(db, {
      ownerId: owner.id,
      ownerUsername: owner.username,
      query: "%_fold \\",
    });

    expect(result.recipes.map((recipe) => recipe.id)).toEqual([literalMatch.id]);
  });

  it("paginates at the database boundary while preserving updated/id descending order", async () => {
    const owner = await createChef("paged_owner");
    await createRecipe({
      chefId: owner.id,
      id: "recipe_page_a",
      title: "Pageable A",
      updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    });
    await createRecipe({
      chefId: owner.id,
      id: "recipe_page_z",
      title: "Pageable Z",
      updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    });
    await createRecipe({
      chefId: owner.id,
      id: "recipe_page_newest",
      title: "Pageable Newest",
      updatedAt: new Date("2026-03-02T00:00:00.000Z"),
    });
    await createRecipe({
      chefId: owner.id,
      id: "recipe_page_oldest",
      title: "Pageable Oldest",
      updatedAt: new Date("2026-02-28T00:00:00.000Z"),
    });

    const firstPage = await searchMyRecipes(db, {
      ownerId: owner.id,
      ownerUsername: owner.username,
      query: "pageable",
      page: 1,
      pageSize: 2,
    });
    const secondPage = await searchMyRecipes(db, {
      ownerId: owner.id,
      ownerUsername: owner.username,
      query: "pageable",
      page: 2,
      pageSize: 2,
    });

    expect(firstPage.recipes.map((recipe) => recipe.id)).toEqual([
      "recipe_page_newest",
      "recipe_page_z",
    ]);
    expect(firstPage.hasNextPage).toBe(true);
    expect(firstPage.hasPreviousPage).toBe(false);
    expect(secondPage.recipes.map((recipe) => recipe.id)).toEqual([
      "recipe_page_a",
      "recipe_page_oldest",
    ]);
    expect(secondPage.hasNextPage).toBe(false);
    expect(secondPage.hasPreviousPage).toBe(true);
  });

  it("returns empty pages and no-result searches without extra application filtering", async () => {
    const owner = await createChef("empty_owner");
    await createRecipe({
      chefId: owner.id,
      title: "Plain Rice",
      updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    });

    const noMatch = await searchMyRecipes(db, {
      ownerId: owner.id,
      ownerUsername: owner.username,
      query: "turnip",
    });
    const emptyOwner = await searchMyRecipes(db, {
      ownerId: "missing-owner",
      ownerUsername: "missing",
      query: "",
    });

    expect(noMatch.recipes).toEqual([]);
    expect(noMatch.hasNextPage).toBe(false);
    expect(emptyOwner.recipes).toEqual([]);
    expect(emptyOwner.hasNextPage).toBe(false);
  });

  it("uses one bounded SQL query and keeps D1 parameters independent of corpus size", async () => {
    const rows = Array.from({ length: MY_RECIPES_PAGE_SIZE + 1 }, (_, index) => ({
      id: `recipe_${index}`,
      title: `Bounded ${index}`,
      description: null,
      servings: null,
    }));
    const database = {
      $queryRawUnsafe: vi.fn(async () => rows),
    };

    const result = await searchMyRecipes(database, {
      ownerId: "owner_large",
      ownerUsername: "large_owner",
      query: "a query with % _ \\ and many spaces",
      page: 3,
      pageSize: MY_RECIPES_PAGE_SIZE,
    });

    expect(database.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    const [sql, ...params] = database.$queryRawUnsafe.mock.calls[0]!;
    expect(sql).toMatch(/\bLIMIT\s+\?/i);
    expect(sql).toMatch(/\bOFFSET\s+\?/i);
    expect(sql).toMatch(/\bEXISTS\b/i);
    expect(params.length).toBeLessThan(20);
    expect(params).toContain(MY_RECIPES_PAGE_SIZE + 1);
    expect(params).toContain(MY_RECIPES_PAGE_SIZE * 2);
    expect(result.recipes).toHaveLength(MY_RECIPES_PAGE_SIZE);
    expect(result.hasNextPage).toBe(true);
  });

  it("clamps service-only page sizes while keeping SQL row reads bounded", async () => {
    const database = {
      $queryRawUnsafe: vi.fn(async () => []),
    };

    const defaulted = await searchMyRecipes(database, {
      ownerId: "owner_defaulted",
      ownerUsername: "defaulted",
      pageSize: 0,
    });
    const capped = await searchMyRecipes(database, {
      ownerId: "owner_capped",
      ownerUsername: "capped",
      pageSize: 999,
    });
    const floored = await searchMyRecipes(database, {
      ownerId: "owner_floored",
      ownerUsername: "floored",
      pageSize: 2.8,
    });
    const minimum = await searchMyRecipes(database, {
      ownerId: "owner_minimum",
      ownerUsername: "minimum",
      pageSize: -2,
    });

    expect(defaulted.pageSize).toBe(MY_RECIPES_PAGE_SIZE);
    expect(capped.pageSize).toBe(MY_RECIPES_PAGE_SIZE);
    expect(floored.pageSize).toBe(2);
    expect(minimum.pageSize).toBe(1);
    expect(database.$queryRawUnsafe).toHaveBeenCalledTimes(4);
    expect(database.$queryRawUnsafe.mock.calls.map((call) => call.at(-2))).toEqual([
      MY_RECIPES_PAGE_SIZE + 1,
      MY_RECIPES_PAGE_SIZE + 1,
      3,
      2,
    ]);
  });
});
