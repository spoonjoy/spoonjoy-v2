// @vitest-environment node
// The recipe page's cookbook and cook-log actions on D1 (recipe-detail-d1-actions.server.ts), run
// against the real test database through the D1 test binding. Each action is one batch, answers as
// the Prisma path does, and writes nothing when a check fails.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { isCookbookTitleUniqueConflict } from "~/lib/cookbook-membership-compat.server";
import { SpoonAuthError, SpoonNotFoundError } from "~/lib/recipe-spoon.server";
import {
  addRecipeToCookbookOnD1,
  assertActiveRecipeOnD1,
  assertOwnedActiveRecipeOnD1,
  createCookbookWithRecipeOnD1,
  deleteSpoonOnD1,
  removeRecipeFromCookbookOnD1,
} from "~/lib/recipe-detail-d1-actions.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { flakyD1, type FlakyOutcome } from "../helpers/flaky-d1";

async function makeChef(prefix: string) {
  const handle = faker.string.alphanumeric(8).toLowerCase();
  return createUser(db, `${prefix}-${handle}@example.com`, `${prefix}_${handle}`, "testPassword123");
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => {
    throw new Error("expected a rejection");
  }, (error: unknown) => error);
}

async function status(promise: Promise<unknown>): Promise<number> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(Response);
  return (error as Response).status;
}

describe("recipe page actions on D1", () => {
  let d1: SqliteD1;
  let chefId: string;
  let otherId: string;
  let recipeId: string;
  let cookbookId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    d1 = sqliteD1();
    chefId = (await makeChef("chef")).id;
    otherId = (await makeChef("other")).id;
    recipeId = (await db.recipe.create({ data: { title: "Bread", chefId: otherId } })).id;
    cookbookId = (await db.cookbook.create({
      data: { title: "Weeknights", authorId: chefId, updatedAt: new Date("2020-01-01T00:00:00Z") },
    })).id;
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  async function memberships() {
    return db.recipeInCookbook.findMany({ where: { cookbookId }, select: { recipeId: true, addedById: true } });
  }

  async function cookbookUpdatedAt() {
    return (await db.cookbook.findUniqueOrThrow({ where: { id: cookbookId } })).updatedAt.getTime();
  }

  describe("addRecipeToCookbookOnD1", () => {
    it("saves the recipe in one round trip, and saving it again only touches the cookbook", async () => {
      await addRecipeToCookbookOnD1(d1.binding, { userId: chefId, cookbookId, recipeId });
      expect(d1.roundTrips()).toBe(1);
      expect(await memberships()).toEqual([{ recipeId, addedById: chefId }]);
      const touched = await cookbookUpdatedAt();
      expect(touched).toBeGreaterThan(new Date("2020-01-01T00:00:00Z").getTime());

      await db.cookbook.update({ where: { id: cookbookId }, data: { updatedAt: new Date("2020-01-01T00:00:00Z") } });
      await addRecipeToCookbookOnD1(d1.binding, { userId: chefId, cookbookId, recipeId });
      expect(await memberships()).toHaveLength(1);
      expect(await cookbookUpdatedAt()).toBeGreaterThan(new Date("2020-01-01T00:00:00Z").getTime());
    });

    it("refuses another chef's cookbook or a missing one with 403, before checking the recipe, and writes nothing", async () => {
      expect(await status(addRecipeToCookbookOnD1(d1.binding, { userId: otherId, cookbookId, recipeId }))).toBe(403);
      expect(await status(addRecipeToCookbookOnD1(d1.binding, { userId: otherId, cookbookId, recipeId: "missing" }))).toBe(403);
      expect(await status(addRecipeToCookbookOnD1(d1.binding, { userId: chefId, cookbookId: "missing", recipeId }))).toBe(403);
      expect(await memberships()).toEqual([]);
      expect(await cookbookUpdatedAt()).toBe(new Date("2020-01-01T00:00:00Z").getTime());
    });

    it("answers 404 for a deleted or missing recipe and writes nothing", async () => {
      await db.recipe.update({ where: { id: recipeId }, data: { deletedAt: new Date() } });
      expect(await status(addRecipeToCookbookOnD1(d1.binding, { userId: chefId, cookbookId, recipeId }))).toBe(404);
      expect(await status(addRecipeToCookbookOnD1(d1.binding, { userId: chefId, cookbookId, recipeId: "missing" }))).toBe(404);
      expect(await memberships()).toEqual([]);
      expect(await cookbookUpdatedAt()).toBe(new Date("2020-01-01T00:00:00Z").getTime());
    });
  });

  describe("removeRecipeFromCookbookOnD1", () => {
    beforeEach(async () => {
      await db.recipeInCookbook.create({ data: { cookbookId, recipeId, addedById: chefId } });
    });

    it("takes the recipe out in one round trip, even once the recipe is deleted", async () => {
      await db.recipe.update({ where: { id: recipeId }, data: { deletedAt: new Date() } });
      await removeRecipeFromCookbookOnD1(d1.binding, { userId: chefId, cookbookId, recipeId });
      expect(d1.roundTrips()).toBe(1);
      expect(await memberships()).toEqual([]);
      expect(await cookbookUpdatedAt()).toBeGreaterThan(new Date("2020-01-01T00:00:00Z").getTime());
      // Taking out a recipe that is not there is not an error.
      await removeRecipeFromCookbookOnD1(d1.binding, { userId: chefId, cookbookId, recipeId });
    });

    it("refuses another chef's cookbook with 403 and leaves it as it was", async () => {
      expect(await status(removeRecipeFromCookbookOnD1(d1.binding, { userId: otherId, cookbookId, recipeId }))).toBe(403);
      expect(await memberships()).toHaveLength(1);
      expect(await cookbookUpdatedAt()).toBe(new Date("2020-01-01T00:00:00Z").getTime());
    });
  });

  describe("createCookbookWithRecipeOnD1", () => {
    it("makes the cookbook with the recipe in it, in one round trip", async () => {
      const created = await createCookbookWithRecipeOnD1(d1.binding, { userId: chefId, recipeId, title: "Breads" });
      expect(d1.roundTrips()).toBe(1);
      expect(created.title).toBe("Breads");
      const cookbook = await db.cookbook.findUniqueOrThrow({
        where: { id: created.id },
        include: { recipes: { select: { recipeId: true, addedById: true } } },
      });
      expect(cookbook).toMatchObject({ title: "Breads", authorId: chefId, recipes: [{ recipeId, addedById: chefId }] });
    });

    it("fails with the title conflict for a title the chef already uses, and writes nothing", async () => {
      const error = await rejection(createCookbookWithRecipeOnD1(d1.binding, { userId: chefId, recipeId, title: "Weeknights" }));
      expect(isCookbookTitleUniqueConflict(error)).toBe(true);
      expect(await db.cookbook.count({ where: { authorId: chefId } })).toBe(1);
      expect(await db.recipeInCookbook.count()).toBe(0);
    });

    it("answers 404 for a deleted recipe, and writes nothing", async () => {
      await db.recipe.update({ where: { id: recipeId }, data: { deletedAt: new Date() } });
      expect(await status(createCookbookWithRecipeOnD1(d1.binding, { userId: chefId, recipeId, title: "Breads" }))).toBe(404);
      expect(await db.cookbook.count({ where: { authorId: chefId } })).toBe(1);
      expect(await db.recipeInCookbook.count()).toBe(0);
    });
  });

  it("assertActiveRecipeOnD1 passes an active recipe and answers 404 for a deleted one", async () => {
    await assertActiveRecipeOnD1(d1.binding, recipeId);
    await db.recipe.update({ where: { id: recipeId }, data: { deletedAt: new Date() } });
    expect(await status(assertActiveRecipeOnD1(d1.binding, recipeId))).toBe(404);
  });

  it("assertOwnedActiveRecipeOnD1 returns the owner's recipe title and refuses a row whose title is not text", async () => {
    const ownId = (await db.recipe.create({ data: { title: "Soup", chefId } })).id;
    expect(await assertOwnedActiveRecipeOnD1(d1.binding, { recipeId: ownId, userId: chefId })).toEqual({ title: "Soup" });

    const statement = { bind: () => statement };
    const corrupt = {
      prepare: () => statement,
      batch: async () => [{ results: [{ chefId, deletedAt: null, title: 42 }] }],
    } as never;
    await expect(assertOwnedActiveRecipeOnD1(corrupt, { recipeId: ownId, userId: chefId })).rejects.toThrow(
      "D1 column title is not text",
    );
  });

  describe("deleteSpoonOnD1", () => {
    let spoonId: string;

    beforeEach(async () => {
      spoonId = (await db.recipeSpoon.create({ data: { chefId, recipeId, note: "Good" } })).id;
    });

    it("deletes the chef's own cook in one round trip", async () => {
      await deleteSpoonOnD1(d1.binding, { userId: chefId, spoonId });
      expect(d1.roundTrips()).toBe(1);
      const spoon = await db.recipeSpoon.findUniqueOrThrow({ where: { id: spoonId } });
      expect(spoon.deletedAt).toBeInstanceOf(Date);
      expect(spoon.updatedAt.getTime()).toBe(spoon.deletedAt!.getTime());
    });

    it("throws deleteSpoon's errors: someone else's, missing, or already deleted", async () => {
      expect(await rejection(deleteSpoonOnD1(d1.binding, { userId: otherId, spoonId }))).toBeInstanceOf(SpoonAuthError);
      expect((await db.recipeSpoon.findUniqueOrThrow({ where: { id: spoonId } })).deletedAt).toBeNull();

      const missing = await rejection(deleteSpoonOnD1(d1.binding, { userId: chefId, spoonId: "missing" }));
      expect(missing).toBeInstanceOf(SpoonNotFoundError);
      expect((missing as Error).message).toBe("Spoon missing not found");

      await deleteSpoonOnD1(d1.binding, { userId: chefId, spoonId });
      const again = await rejection(deleteSpoonOnD1(d1.binding, { userId: chefId, spoonId }));
      expect(again).toBeInstanceOf(SpoonNotFoundError);
      expect((again as Error).message).toBe(`Spoon ${spoonId} is deleted`);
    });
  });

  describe("when D1's connection drops", () => {
    const membership = () => db.recipeInCookbook.count({ where: { cookbookId, recipeId } });

    it.each<FlakyOutcome>(["lost", "lost-answer", "late"])("saves to and takes out of a cookbook as one run would (%s)", async (outcome) => {
      const flaky = flakyD1(d1.binding);
      flaky.failNext(/INSERT INTO "RecipeInCookbook"/, outcome);
      await addRecipeToCookbookOnD1(flaky.binding, { userId: chefId, cookbookId, recipeId });
      expect(await membership()).toBe(1);

      flaky.failNext(/DELETE FROM "RecipeInCookbook"/, outcome);
      await removeRecipeFromCookbookOnD1(flaky.binding, { userId: chefId, cookbookId, recipeId });
      expect(await membership()).toBe(0);
      expect(flaky.failures()).toBe(2);
    });

    it.each<FlakyOutcome>(["lost", "lost-answer", "late"])("makes one new cookbook with the recipe in it (%s)", async (outcome) => {
      const flaky = flakyD1(d1.binding);
      flaky.failNext(/INSERT INTO "Cookbook"/, outcome);

      const created = await createCookbookWithRecipeOnD1(flaky.binding, { userId: chefId, recipeId, title: "Breads" });

      expect(flaky.failures()).toBe(1);
      expect(await db.cookbook.findMany({ where: { authorId: chefId, title: "Breads" }, select: { id: true } })).toEqual([{ id: created.id }]);
      expect(await db.recipeInCookbook.count({ where: { cookbookId: created.id, recipeId } })).toBe(1);
    });

    it.each<FlakyOutcome>(["lost", "lost-answer", "late"])("deletes a cook once and answers as the first try would (%s)", async (outcome) => {
      const spoonId = (await db.recipeSpoon.create({ data: { chefId, recipeId, note: "Good" } })).id;
      const flaky = flakyD1(d1.binding);
      flaky.failNext(/UPDATE "RecipeSpoon"/, outcome);

      await deleteSpoonOnD1(flaky.binding, { userId: chefId, spoonId });

      expect(flaky.failures()).toBe(1);
      expect((await db.recipeSpoon.findUniqueOrThrow({ where: { id: spoonId } })).deletedAt).not.toBeNull();
      // A later request still finds it deleted.
      await expect(deleteSpoonOnD1(d1.binding, { userId: chefId, spoonId })).rejects.toBeInstanceOf(SpoonNotFoundError);
    });
  });
});

