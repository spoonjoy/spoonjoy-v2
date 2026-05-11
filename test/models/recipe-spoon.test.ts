import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/lib/db.server";
import { createTestUser, createTestRecipe } from "../utils";
import { cleanupDatabase } from "../helpers/cleanup";

describe("RecipeSpoon Model", () => {
  let chefId: string;
  let recipeId: string;

  beforeEach(async () => {
    const user = await db.user.create({ data: createTestUser() });
    chefId = user.id;
    const recipe = await db.recipe.create({
      data: { ...createTestRecipe(chefId), chefId },
    });
    recipeId = recipe.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("create", () => {
    it("creates a spoon with only the required fields", async () => {
      const spoon = await db.recipeSpoon.create({
        data: { chefId, recipeId },
      });
      expect(spoon.id).toBeDefined();
      expect(spoon.chefId).toBe(chefId);
      expect(spoon.recipeId).toBe(recipeId);
      expect(spoon.cookedAt).toBeInstanceOf(Date);
      expect(spoon.photoUrl).toBeNull();
      expect(spoon.note).toBeNull();
      expect(spoon.nextTime).toBeNull();
      expect(spoon.deletedAt).toBeNull();
    });

    it("creates a spoon with all optional fields populated", async () => {
      const cookedAt = new Date("2026-04-01T12:00:00Z");
      const spoon = await db.recipeSpoon.create({
        data: {
          chefId,
          recipeId,
          cookedAt,
          photoUrl: "https://example.com/spoon.jpg",
          note: "Tasty!",
          nextTime: "More salt",
        },
      });
      expect(spoon.photoUrl).toBe("https://example.com/spoon.jpg");
      expect(spoon.note).toBe("Tasty!");
      expect(spoon.nextTime).toBe("More salt");
      expect(spoon.cookedAt.toISOString()).toBe(cookedAt.toISOString());
    });
  });

  describe("soft-delete", () => {
    it("sets deletedAt without removing the row", async () => {
      const spoon = await db.recipeSpoon.create({ data: { chefId, recipeId } });
      const deleted = await db.recipeSpoon.update({
        where: { id: spoon.id },
        data: { deletedAt: new Date() },
      });
      expect(deleted.deletedAt).not.toBeNull();
      const found = await db.recipeSpoon.findUnique({ where: { id: spoon.id } });
      expect(found).not.toBeNull();
    });
  });

  describe("relations", () => {
    it("cascade-deletes when the chef is removed", async () => {
      const spoon = await db.recipeSpoon.create({ data: { chefId, recipeId } });
      await db.recipe.delete({ where: { id: recipeId } });
      await db.user.delete({ where: { id: chefId } });
      const found = await db.recipeSpoon.findUnique({ where: { id: spoon.id } });
      expect(found).toBeNull();
    });

    it("cascade-deletes when the recipe is removed", async () => {
      const spoon = await db.recipeSpoon.create({ data: { chefId, recipeId } });
      await db.recipe.delete({ where: { id: recipeId } });
      const found = await db.recipeSpoon.findUnique({ where: { id: spoon.id } });
      expect(found).toBeNull();
    });
  });

  describe("indexes", () => {
    it("declares the expected indexes", async () => {
      const rows = await db.$queryRawUnsafe<{ name: string }[]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='RecipeSpoon'",
      );
      const names = rows.map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "RecipeSpoon_recipeId_cookedAt_idx",
          "RecipeSpoon_chefId_cookedAt_idx",
        ]),
      );
    });
  });
});
