import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/lib/db.server";
import {
  createCover,
  getCurrentCover,
  getRecipeCoverImageUrl,
  listCoversForRecipe,
  makeFallbackPlaceholderSvg,
} from "~/lib/recipe-cover.server";
import type { RecipeCover } from "@prisma/client";
import { createTestUser, createTestRecipe } from "../utils";
import { cleanupDatabase } from "../helpers/cleanup";

describe("recipe-cover.server", () => {
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

  describe("createCover", () => {
    it("inserts a cover with the supplied fields", async () => {
      const cover = await createCover(db, {
        recipeId,
        imageUrl: "https://example.com/a.png",
        sourceType: "ai-placeholder",
      });
      expect(cover.recipeId).toBe(recipeId);
      expect(cover.imageUrl).toBe("https://example.com/a.png");
      expect(cover.sourceType).toBe("ai-placeholder");
      expect(cover.stylizedImageUrl).toBeNull();
      expect(cover.sourceSpoonId).toBeNull();
    });

    it("stores optional stylizedImageUrl and sourceSpoonId", async () => {
      const spoon = await db.recipeSpoon.create({ data: { chefId, recipeId } });
      const cover = await createCover(db, {
        recipeId,
        imageUrl: "https://example.com/a.png",
        stylizedImageUrl: "https://example.com/a-stylized.png",
        sourceType: "spoon",
        sourceSpoonId: spoon.id,
      });
      expect(cover.stylizedImageUrl).toBe("https://example.com/a-stylized.png");
      expect(cover.sourceSpoonId).toBe(spoon.id);
    });
  });

  describe("listCoversForRecipe", () => {
    it("returns covers ordered by createdAt desc, id desc", async () => {
      const t1 = new Date("2026-01-01T00:00:00Z");
      const t2 = new Date("2026-01-02T00:00:00Z");
      await db.recipeCover.create({
        data: { id: "z", recipeId, imageUrl: "u1", sourceType: "chef-upload", createdAt: t1 },
      });
      await db.recipeCover.create({
        data: { id: "a", recipeId, imageUrl: "u2", sourceType: "chef-upload", createdAt: t2 },
      });
      await db.recipeCover.create({
        data: { id: "b", recipeId, imageUrl: "u3", sourceType: "chef-upload", createdAt: t2 },
      });
      const rows = await listCoversForRecipe(db, recipeId);
      expect(rows.map((r) => r.id)).toEqual(["b", "a", "z"]);
    });

    it("returns [] when the recipe has no covers", async () => {
      const rows = await listCoversForRecipe(db, recipeId);
      expect(rows).toEqual([]);
    });
  });

  describe("getCurrentCover", () => {
    it("returns the latest cover by (createdAt desc, id desc)", async () => {
      const t = new Date("2026-01-02T00:00:00Z");
      await db.recipeCover.create({
        data: { id: "a", recipeId, imageUrl: "u1", sourceType: "chef-upload", createdAt: t },
      });
      const winner = await db.recipeCover.create({
        data: { id: "b", recipeId, imageUrl: "u2", sourceType: "chef-upload", createdAt: t },
      });
      const current = await getCurrentCover(db, recipeId);
      expect(current?.id).toBe(winner.id);
    });

    it("returns null when no covers exist", async () => {
      const current = await getCurrentCover(db, recipeId);
      expect(current).toBeNull();
    });
  });

  function fakeCover(over: Partial<RecipeCover>): RecipeCover {
    return {
      id: "id",
      recipeId,
      imageUrl: "https://example.com/raw.png",
      stylizedImageUrl: null,
      sourceType: "chef-upload",
      sourceSpoonId: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      ...over,
    };
  }

  describe("getRecipeCoverImageUrl", () => {
    const recipe = { id: "r", title: "Tomato Soup" };

    it("returns stylizedImageUrl when present on the latest cover", () => {
      const url = getRecipeCoverImageUrl(recipe, [
        fakeCover({
          id: "b",
          imageUrl: "raw",
          stylizedImageUrl: "stylized",
          createdAt: new Date("2026-02-01"),
        }),
      ]);
      expect(url).toBe("stylized");
    });

    it("returns imageUrl when stylizedImageUrl is null", () => {
      const url = getRecipeCoverImageUrl(recipe, [
        fakeCover({ id: "a", imageUrl: "raw", createdAt: new Date("2026-02-01") }),
      ]);
      expect(url).toBe("raw");
    });

    it("breaks createdAt ties by id desc", () => {
      const t = new Date("2026-02-01");
      const url = getRecipeCoverImageUrl(recipe, [
        fakeCover({ id: "a", imageUrl: "loser", createdAt: t }),
        fakeCover({ id: "z", imageUrl: "winner", createdAt: t }),
      ]);
      expect(url).toBe("winner");
    });

    it("picks the newer cover when createdAt differs", () => {
      const url = getRecipeCoverImageUrl(recipe, [
        fakeCover({ id: "old", imageUrl: "old", createdAt: new Date("2026-01-01") }),
        fakeCover({ id: "new", imageUrl: "new", createdAt: new Date("2026-03-01") }),
      ]);
      expect(url).toBe("new");
    });

    it("treats identical (createdAt, id) pairs as equal in the comparator", () => {
      const t = new Date("2026-02-01");
      const url = getRecipeCoverImageUrl(recipe, [
        fakeCover({ id: "x", imageUrl: "x", createdAt: t }),
        fakeCover({ id: "x", imageUrl: "y", createdAt: t }),
      ]);
      // Both rows tie on createdAt+id so the first non-empty imageUrl wins by stable order.
      expect(url).toBe("x");
    });

    it("exercises both arms of the id-desc tiebreak comparator", () => {
      const t = new Date("2026-02-01");
      const url = getRecipeCoverImageUrl(recipe, [
        fakeCover({ id: "m", imageUrl: "middle", createdAt: t }),
        fakeCover({ id: "a", imageUrl: "lowest", createdAt: t }),
        fakeCover({ id: "z", imageUrl: "winner", createdAt: t }),
      ]);
      expect(url).toBe("winner");
    });

    it("returns null when covers array is empty", () => {
      const url = getRecipeCoverImageUrl(recipe, []);
      expect(url).toBeNull();
    });

    it("returns null when the latest cover row is empty", () => {
      const url = getRecipeCoverImageUrl(recipe, [
        fakeCover({
          id: "old",
          imageUrl: "older-real",
          stylizedImageUrl: null,
          createdAt: new Date("2026-01-01"),
        }),
        fakeCover({
          id: "new",
          imageUrl: "",
          stylizedImageUrl: "",
          createdAt: new Date("2026-03-01"),
        }),
      ]);
      expect(url).toBeNull();
    });

    it("returns an ai-placeholder image once generation has filled imageUrl", () => {
      const url = getRecipeCoverImageUrl(recipe, [
        fakeCover({
          id: "placeholder",
          imageUrl: "/photos/covers/generated.png",
          stylizedImageUrl: null,
          sourceType: "ai-placeholder",
          createdAt: new Date("2026-03-01"),
        }),
      ]);
      expect(url).toBe("/photos/covers/generated.png");
    });

    it("does not throw when recipe.title is an empty string", () => {
      expect(() => getRecipeCoverImageUrl({ id: "r", title: "" }, [])).not.toThrow();
    });
  });

  describe("makeFallbackPlaceholderSvg", () => {
    it("returns a data URL and matching byte buffer", () => {
      const { url, bytes } = makeFallbackPlaceholderSvg("Risotto");
      expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
      const decoded = Buffer.from(url.split(",")[1], "base64").toString("utf8");
      expect(decoded).toContain("Risotto");
      expect(decoded).not.toContain("<text");
      expect(bytes.length).toBe(Buffer.byteLength(decoded, "utf8"));
    });

    it("escapes special characters in the title", () => {
      const { url } = makeFallbackPlaceholderSvg(`<a> & "b"`);
      const decoded = Buffer.from(url.split(",")[1], "base64").toString("utf8");
      expect(decoded).toContain("&lt;a&gt;");
      expect(decoded).toContain("&amp;");
      expect(decoded).toContain("&quot;b&quot;");
      expect(decoded).not.toContain("<a>");
    });

    it("renders an empty title without throwing", () => {
      expect(() => makeFallbackPlaceholderSvg("")).not.toThrow();
    });
  });
});
