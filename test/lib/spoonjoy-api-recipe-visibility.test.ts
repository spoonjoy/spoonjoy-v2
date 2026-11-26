// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { callSpoonjoyApiOperation, type SpoonjoyApiContext } from "~/lib/spoonjoy-api.server";
import type { ApiPrincipal } from "~/lib/api-auth.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { shareHousehold } from "../utils";

// A private recipe reads, over MCP, only for its cook: to anyone else it is not there.

let db: PrismaClient;

const SCOPES = ["cookbooks:read", "public:read", "recipes:read", "shopping_list:read", "shopping_list:write", "kitchen:read", "kitchen:write"];

async function makeChef(name: string) {
  const user = await db.user.create({ data: { email: `${name}@example.com`, username: name } });
  const principal: ApiPrincipal = { id: user.id, email: user.email, username: user.username, source: "bearer", scopes: SCOPES };
  return { user, principal, context: { db, principal, env: null } satisfies SpoonjoyApiContext };
}

describe("private recipes over MCP", () => {
  let cook: Awaited<ReturnType<typeof makeChef>>;
  let stranger: Awaited<ReturnType<typeof makeChef>>;
  let privateId: string;

  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    cook = await makeChef("visibility_cook");
    stranger = await makeChef("visibility_stranger");
    const recipe = await db.recipe.create({
      data: { title: "Secret Plum Tart", chefId: cook.user.id, visibility: "private", steps: { create: [{ stepNum: 1, description: "Bake" }] } },
    });
    privateId = recipe.id;
    await db.recipeSpoon.create({ data: { recipeId: recipe.id, chefId: cook.user.id, cookedAt: new Date() } });
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("get_recipe finds it for its cook and for no one else", async () => {
    const mine = await callSpoonjoyApiOperation("get_recipe", { id: privateId }, cook.context) as { recipe: { title: string } | null };
    expect(mine.recipe?.title).toBe("Secret Plum Tart");
    for (const context of [stranger.context, { db, principal: null, env: null }]) {
      expect(await callSpoonjoyApiOperation("get_recipe", { id: privateId }, context)).toEqual({ recipe: null });
      expect(await callSpoonjoyApiOperation("get_recipe", { title: "Secret Plum Tart" }, context)).toEqual({ recipe: null });
    }
  });

  it("search_recipes and search_spoonjoy leave it out for anyone else", async () => {
    const mine = await callSpoonjoyApiOperation("search_recipes", { query: "Plum" }, cook.context) as { recipes: Array<{ id: string }> };
    expect(mine.recipes.map((recipe) => recipe.id)).toEqual([privateId]);
    const theirs = await callSpoonjoyApiOperation("search_recipes", { query: "Plum" }, stranger.context) as { recipes: unknown[] };
    expect(theirs.recipes).toEqual([]);
    const everything = await callSpoonjoyApiOperation("search_spoonjoy", { query: "Plum" }, stranger.context) as { results: unknown[] };
    expect(everything.results).toEqual([]);
  });

  it("a stranger cannot list its cooks, covers, or put it in a cookbook or shopping list", async () => {
    await expect(callSpoonjoyApiOperation("list_spoons_for_recipe", { recipeId: privateId }, stranger.context)).rejects.toThrow("not found");
    await expect(callSpoonjoyApiOperation("list_recipe_covers", { recipeId: privateId }, stranger.context)).rejects.toThrow("Recipe not found");
    await expect(callSpoonjoyApiOperation("add_recipe_to_shopping_list", { recipeId: privateId }, stranger.context)).rejects.toThrow("Recipe not found");
    await db.cookbook.create({ data: { title: "Stranger Book", authorId: stranger.user.id } });
    await expect(callSpoonjoyApiOperation("add_recipe_to_cookbook", { recipeId: privateId, cookbookTitle: "Stranger Book" }, stranger.context))
      .rejects.toThrow("Recipe not found");
    const cooks = await callSpoonjoyApiOperation("list_spoons_by_chef", { chefIdOrUsername: cook.user.username }, stranger.context) as { spoons: unknown[] };
    expect(cooks.spoons).toEqual([]);
    const ownCooks = await callSpoonjoyApiOperation("list_spoons_by_chef", { chefIdOrUsername: cook.user.username }, cook.context) as { spoons: unknown[] };
    expect(ownCooks.spoons).toHaveLength(1);
  });

  it("a cookbook holding another cook's private recipe no longer shows it", async () => {
    const book = await db.cookbook.create({ data: { title: "Stranger Saved", authorId: stranger.user.id } });
    await db.recipeInCookbook.create({ data: { recipeId: privateId, cookbookId: book.id, addedById: stranger.user.id } });
    const got = await callSpoonjoyApiOperation("get_cookbook", { cookbookId: book.id }, stranger.context) as { cookbook: { recipeCount: number; recipes: unknown[] } };
    expect(got.cookbook.recipeCount).toBe(0);
    expect(got.cookbook.recipes).toEqual([]);
    const listed = await callSpoonjoyApiOperation("list_cookbooks", {}, stranger.context) as { cookbooks: Array<{ recipeCount: number }> };
    expect(listed.cookbooks.map((cookbook) => cookbook.recipeCount)).toEqual([0]);
  });

  it("create_recipe makes the recipe at the cook's default, so it stays theirs", async () => {
    await db.user.update({ where: { id: cook.user.id }, data: { defaultRecipeVisibility: "private" } });
    const made = await callSpoonjoyApiOperation("create_recipe", { title: "Quiet Pear Crumble", steps: [{ description: "Bake" }] }, cook.context) as { recipe: { id: string } };
    expect((await db.recipe.findUniqueOrThrow({ where: { id: made.recipe.id }, select: { visibility: true } })).visibility).toBe("private");
    expect(await callSpoonjoyApiOperation("get_recipe", { id: made.recipe.id }, stranger.context)).toEqual({ recipe: null });
  });

  it("fork_recipe starts a fork of another cook's recipe at the forking cook's default", async () => {
    const open = await db.recipe.create({ data: { title: "Open Quince Paste", chefId: stranger.user.id } });
    await db.user.update({ where: { id: cook.user.id }, data: { defaultRecipeVisibility: "private" } });
    const visibilityOf = async (context: SpoonjoyApiContext, titleOverride: string) => {
      const forked = await callSpoonjoyApiOperation("fork_recipe", { sourceRecipeId: open.id, title: titleOverride }, context) as { recipe: { id: string } };
      return (await db.recipe.findUniqueOrThrow({ where: { id: forked.recipe.id }, select: { visibility: true } })).visibility;
    };
    expect(await visibilityOf(cook.context, "Quiet Quince")).toBe("private");
  });

  it("fork_recipe starts a fork at a household default", async () => {
    const open = await db.recipe.create({ data: { title: "Open Medlar Jelly", chefId: stranger.user.id } });
    await db.user.update({ where: { id: cook.user.id }, data: { defaultRecipeVisibility: "household" } });
    const forked = await callSpoonjoyApiOperation("fork_recipe", { sourceRecipeId: open.id, title: "Shared Medlar" }, cook.context) as { recipe: { id: string } };
    expect((await db.recipe.findUniqueOrThrow({ where: { id: forked.recipe.id }, select: { visibility: true } })).visibility).toBe("household");
  });

  it("reads it for its cook on a local stdio server, which runs as its owner with no principal", async () => {
    const local = { db, principal: null, env: null, defaultOwnerEmail: cook.user.email };
    const mine = await callSpoonjoyApiOperation("get_recipe", { id: privateId }, local) as { recipe: { title: string } | null };
    expect(mine.recipe?.title).toBe("Secret Plum Tart");
    const found = await callSpoonjoyApiOperation("search_recipes", { query: "Plum" }, local) as { recipes: Array<{ id: string }> };
    expect(found.recipes.map((recipe) => recipe.id)).toEqual([privateId]);
  });
});

describe("household recipes over MCP", () => {
  let cook: Awaited<ReturnType<typeof makeChef>>;
  let housemate: Awaited<ReturnType<typeof makeChef>>;
  let stranger: Awaited<ReturnType<typeof makeChef>>;
  let keptId: string;

  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    cook = await makeChef("household_cook");
    housemate = await makeChef("household_mate");
    stranger = await makeChef("household_stranger");
    await shareHousehold(db, cook.user.id, housemate.user.id);
    const recipe = await db.recipe.create({
      data: { title: "Household Pear Tart", chefId: cook.user.id, visibility: "household", steps: { create: [{ stepNum: 1, description: "Bake" }] } },
    });
    keptId = recipe.id;
    await db.recipeSpoon.create({ data: { recipeId: recipe.id, chefId: cook.user.id, cookedAt: new Date() } });
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("fork_recipe keeps a housemate's fork of it to the housemate, so forking never opens it to anyone else", async () => {
    await db.user.update({ where: { id: housemate.user.id }, data: { defaultRecipeVisibility: "public" } });
    const forked = await callSpoonjoyApiOperation("fork_recipe", { sourceRecipeId: keptId, title: "Pear Tart Fork" }, housemate.context) as { recipe: { id: string } };
    const { visibility } = await db.recipe.findUniqueOrThrow({ where: { id: forked.recipe.id }, select: { visibility: true } });
    expect(visibility).toBe("private");
    expect(await callSpoonjoyApiOperation("get_recipe", { id: forked.recipe.id }, stranger.context)).toEqual({ recipe: null });
  });

  it("get_recipe, search_recipes, list_spoons_for_recipe and get_cookbook read it for its cook's household and no one else", async () => {
    const book = await db.cookbook.create({ data: { title: "Shared Tarts", authorId: housemate.user.id } });
    await db.recipeInCookbook.create({ data: { recipeId: keptId, cookbookId: book.id, addedById: housemate.user.id } });
    const strangerBook = await db.cookbook.create({ data: { title: "Stranger Tarts", authorId: stranger.user.id } });
    await db.recipeInCookbook.create({ data: { recipeId: keptId, cookbookId: strangerBook.id, addedById: stranger.user.id } });

    for (const reader of [cook, housemate]) {
      const got = await callSpoonjoyApiOperation("get_recipe", { id: keptId }, reader.context) as { recipe: { title: string } | null };
      expect(got.recipe?.title, reader.user.username).toBe("Household Pear Tart");
      const found = await callSpoonjoyApiOperation("search_recipes", { query: "Pear" }, reader.context) as { recipes: Array<{ id: string }> };
      expect(found.recipes.map((recipe) => recipe.id)).toEqual([keptId]);
      const cooks = await callSpoonjoyApiOperation("list_spoons_for_recipe", { recipeId: keptId }, reader.context) as { spoons: unknown[] };
      expect(cooks.spoons).toHaveLength(1);
    }
    const shared = await callSpoonjoyApiOperation("get_cookbook", { cookbookId: book.id }, housemate.context) as { cookbook: { recipeCount: number } };
    expect(shared.cookbook.recipeCount).toBe(1);

    expect(await callSpoonjoyApiOperation("get_recipe", { id: keptId }, stranger.context)).toEqual({ recipe: null });
    const missed = await callSpoonjoyApiOperation("search_recipes", { query: "Pear" }, stranger.context) as { recipes: unknown[] };
    expect(missed.recipes).toEqual([]);
    await expect(callSpoonjoyApiOperation("list_spoons_for_recipe", { recipeId: keptId }, stranger.context)).rejects.toThrow("not found");
    const theirs = await callSpoonjoyApiOperation("get_cookbook", { cookbookId: strangerBook.id }, stranger.context) as { cookbook: { recipeCount: number } };
    expect(theirs.cookbook.recipeCount).toBe(0);
  });
});
