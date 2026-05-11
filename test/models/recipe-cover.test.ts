import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/lib/db.server";
import { createTestUser, createTestRecipe } from "../utils";
import { cleanupDatabase } from "../helpers/cleanup";

describe("RecipeCover Model", () => {
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
    it.each([
      "ai-placeholder" as const,
      "import" as const,
      "chef-upload" as const,
      "spoon" as const,
    ])("creates a cover with sourceType %s", async (sourceType) => {
      const cover = await db.recipeCover.create({
        data: {
          recipeId,
          imageUrl: "https://example.com/cover.jpg",
          sourceType,
        },
      });
      expect(cover.id).toBeDefined();
      expect(cover.recipeId).toBe(recipeId);
      expect(cover.imageUrl).toBe("https://example.com/cover.jpg");
      expect(cover.sourceType).toBe(sourceType);
      expect(cover.stylizedImageUrl).toBeNull();
      expect(cover.sourceSpoonId).toBeNull();
      expect(cover.createdAt).toBeInstanceOf(Date);
    });

    it("stores a stylizedImageUrl when provided", async () => {
      const cover = await db.recipeCover.create({
        data: {
          recipeId,
          imageUrl: "https://example.com/raw.jpg",
          stylizedImageUrl: "https://example.com/stylized.jpg",
          sourceType: "spoon",
        },
      });
      expect(cover.stylizedImageUrl).toBe("https://example.com/stylized.jpg");
    });

    it("links to a sourceSpoon via sourceSpoonId", async () => {
      const spoon = await db.recipeSpoon.create({ data: { chefId, recipeId } });
      const cover = await db.recipeCover.create({
        data: {
          recipeId,
          imageUrl: "https://example.com/raw.jpg",
          sourceType: "spoon",
          sourceSpoonId: spoon.id,
        },
      });
      expect(cover.sourceSpoonId).toBe(spoon.id);
    });
  });

  describe("relations", () => {
    it("sets sourceSpoonId to null when the spoon is hard-deleted", async () => {
      const spoon = await db.recipeSpoon.create({ data: { chefId, recipeId } });
      const cover = await db.recipeCover.create({
        data: {
          recipeId,
          imageUrl: "https://example.com/raw.jpg",
          sourceType: "spoon",
          sourceSpoonId: spoon.id,
        },
      });
      await db.recipeSpoon.delete({ where: { id: spoon.id } });
      const found = await db.recipeCover.findUnique({ where: { id: cover.id } });
      expect(found).not.toBeNull();
      expect(found?.sourceSpoonId).toBeNull();
    });

    it("cascade-deletes when the recipe is removed", async () => {
      const cover = await db.recipeCover.create({
        data: {
          recipeId,
          imageUrl: "https://example.com/raw.jpg",
          sourceType: "chef-upload",
        },
      });
      await db.recipe.delete({ where: { id: recipeId } });
      const found = await db.recipeCover.findUnique({ where: { id: cover.id } });
      expect(found).toBeNull();
    });
  });

  describe("indexes", () => {
    it("declares the expected indexes", async () => {
      const rows = await db.$queryRawUnsafe<{ name: string }[]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='RecipeCover'",
      );
      const names = rows.map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "RecipeCover_recipeId_createdAt_idx",
          "RecipeCover_sourceSpoonId_idx",
        ]),
      );
    });
  });
});
