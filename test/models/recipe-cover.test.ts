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
      expect(cover.status).toBe("ready");
      expect(cover.generationStatus).toBe("none");
      expect(cover.createdById).toBeNull();
      expect(cover.sourceImageUrl).toBeNull();
      expect(cover.failureReason).toBeNull();
      expect(cover.promptVersion).toBeNull();
      expect(cover.styleVersion).toBeNull();
      expect(cover.archivedAt).toBeNull();
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

    it("stores cover lifecycle metadata", async () => {
      const cover = await db.recipeCover.create({
        data: {
          recipeId,
          imageUrl: "https://example.com/raw.jpg",
          stylizedImageUrl: "https://example.com/editorial.jpg",
          sourceType: "chef-upload",
          status: "processing",
          generationStatus: "processing",
          createdById: chefId,
          sourceImageUrl: "https://example.com/source.jpg",
          failureReason: "queued",
          promptVersion: "editorial-v1",
          styleVersion: "phone-to-editorial-v1",
        },
      });

      expect(cover).toMatchObject({
        status: "processing",
        generationStatus: "processing",
        createdById: chefId,
        sourceImageUrl: "https://example.com/source.jpg",
        failureReason: "queued",
        promptVersion: "editorial-v1",
        styleVersion: "phone-to-editorial-v1",
      });
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

    it("sets Recipe.activeCoverId to null when the active cover is hard-deleted", async () => {
      const cover = await db.recipeCover.create({
        data: {
          recipeId,
          imageUrl: "https://example.com/raw.jpg",
          sourceType: "chef-upload",
        },
      });
      await db.recipe.update({
        where: { id: recipeId },
        data: {
          activeCoverId: cover.id,
          activeCoverVariant: "image",
          coverMode: "manual",
        },
      });

      await db.recipeCover.delete({ where: { id: cover.id } });

      const found = await db.recipe.findUniqueOrThrow({ where: { id: recipeId } });
      expect(found.activeCoverId).toBeNull();
      expect(found.activeCoverVariant).toBe("image");
      expect(found.coverMode).toBe("manual");
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
    it("declares the expected cover indexes", async () => {
      const rows = await db.$queryRawUnsafe<{ name: string }[]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='RecipeCover'",
      );
      const names = rows.map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "RecipeCover_recipeId_createdAt_idx",
          "RecipeCover_sourceSpoonId_idx",
          "RecipeCover_recipeId_status_createdAt_idx",
          "RecipeCover_status_idx",
        ]),
      );
    });

    it("declares the expected recipe active-cover indexes", async () => {
      const rows = await db.$queryRawUnsafe<{ name: string }[]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='Recipe'",
      );
      const names = rows.map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "Recipe_activeCoverId_idx",
          "Recipe_coverMode_idx",
        ]),
      );
    });
  });
});
