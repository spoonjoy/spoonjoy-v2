import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/lib/db.server";
import {
  archiveRecipeCover,
  backfillActiveCoverForRecipe,
  createCover,
  getActiveRecipeCover,
  getCurrentCover,
  getRecipeCoverDisplay,
  getRecipeCoverImageUrl,
  getScopedActiveCover,
  listCoversForRecipe,
  makeFallbackPlaceholderSvg,
  recipeCoverCacheSnapshot,
  setActiveRecipeCover,
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
      expect(cover.status).toBe("ready");
      expect(cover.generationStatus).toBe("none");
      expect(cover.createdById).toBeNull();
      expect(cover.sourceImageUrl).toBeNull();
      expect(cover.failureReason).toBeNull();
      expect(cover.promptVersion).toBeNull();
      expect(cover.styleVersion).toBeNull();
      expect(cover.archivedAt).toBeNull();
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

    it("stores status, generation, provenance, and prompt metadata", async () => {
      const cover = await createCover(db, {
        recipeId,
        imageUrl: "https://example.com/raw.png",
        stylizedImageUrl: "https://example.com/editorial.png",
        sourceType: "chef-upload",
        createdById: chefId,
        sourceImageUrl: "https://example.com/source.png",
        status: "processing",
        generationStatus: "processing",
        failureReason: "queued",
        promptVersion: "editorial-v1",
        styleVersion: "mendelow-phone-to-editorial-v1",
      });

      expect(cover).toMatchObject({
        status: "processing",
        generationStatus: "processing",
        createdById: chefId,
        sourceImageUrl: "https://example.com/source.png",
        failureReason: "queued",
        promptVersion: "editorial-v1",
        styleVersion: "mendelow-phone-to-editorial-v1",
      });
    });

    it("rejects an invalid source type", async () => {
      await expect(createCover(db, {
        recipeId,
        imageUrl: "https://example.com/raw.png",
        sourceType: "unknown-source" as never,
      })).rejects.toThrow("Invalid cover source type");
    });

    it("rejects an invalid lifecycle status", async () => {
      await expect(createCover(db, {
        recipeId,
        imageUrl: "https://example.com/raw.png",
        sourceType: "chef-upload",
        status: "queued" as never,
      })).rejects.toThrow("Invalid cover status");
    });

    it("rejects an invalid generation status", async () => {
      await expect(createCover(db, {
        recipeId,
        imageUrl: "https://example.com/raw.png",
        sourceType: "chef-upload",
        generationStatus: "queued" as never,
      })).rejects.toThrow("Invalid cover generation status");
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

  describe("getActiveRecipeCover", () => {
    it("returns the explicitly active cover instead of the latest row", async () => {
      const t = new Date("2026-01-02T00:00:00Z");
      const active = await db.recipeCover.create({
        data: { id: "a", recipeId, imageUrl: "u1", sourceType: "chef-upload", createdAt: t },
      });
      await db.recipeCover.create({
        data: { id: "b", recipeId, imageUrl: "u2", sourceType: "chef-upload", createdAt: t },
      });
      await db.recipe.update({
        where: { id: recipeId },
        data: { activeCoverId: active.id, activeCoverVariant: "image", coverMode: "manual" },
      });

      const current = await getActiveRecipeCover(db, recipeId);
      expect(current?.id).toBe(active.id);
    });

    it("returns null when the recipe has no active cover", async () => {
      await db.recipeCover.create({
        data: { id: "a", recipeId, imageUrl: "u1", sourceType: "chef-upload" },
      });

      const current = await getActiveRecipeCover(db, recipeId);
      expect(current).toBeNull();
    });

    it("keeps getCurrentCover as an explicit-active compatibility alias", async () => {
      const active = await db.recipeCover.create({
        data: { recipeId, imageUrl: "u1", sourceType: "chef-upload" },
      });
      await db.recipe.update({
        where: { id: recipeId },
        data: { activeCoverId: active.id, activeCoverVariant: "image", coverMode: "manual" },
      });

      const current = await getCurrentCover(db, recipeId);
      expect(current?.id).toBe(active.id);
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
      status: "ready",
      createdById: null,
      sourceImageUrl: null,
      generationStatus: "none",
      failureReason: null,
      promptVersion: null,
      styleVersion: null,
      archivedAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      ...over,
    };
  }

  describe("getRecipeCoverImageUrl", () => {
    const recipe = {
      id: "r",
      title: "Tomato Soup",
      activeCoverId: "active",
      activeCoverVariant: "stylized",
      coverMode: "manual",
    };

    it("returns the requested active stylized variant", () => {
      const url = getRecipeCoverImageUrl(recipe, [
        fakeCover({
          id: "active",
          imageUrl: "raw",
          stylizedImageUrl: "stylized",
          createdAt: new Date("2026-02-01"),
        }),
        fakeCover({
          id: "newer",
          imageUrl: "newer-raw",
          stylizedImageUrl: "newer-stylized",
          createdAt: new Date("2026-03-01"),
        }),
      ]);
      expect(url).toBe("stylized");
    });

    it("returns the requested active image variant", () => {
      const url = getRecipeCoverImageUrl(recipe, [
        fakeCover({ id: "active", imageUrl: "raw", stylizedImageUrl: "stylized" }),
      ], "image");
      expect(url).toBe("raw");
    });

    it("returns null when coverMode is intentionally none", () => {
      const url = getRecipeCoverImageUrl(
        { ...recipe, coverMode: "none", activeCoverId: null, activeCoverVariant: null },
        [fakeCover({ id: "active", imageUrl: "raw", stylizedImageUrl: "stylized" })],
      );
      expect(url).toBeNull();
    });

    it("does not fall back to newest row when the active cover is missing", () => {
      const url = getRecipeCoverImageUrl(recipe, [
        fakeCover({ id: "newer", imageUrl: "newer", createdAt: new Date("2026-03-01") }),
      ]);
      expect(url).toBeNull();
    });

    it("returns null when the active cover is archived", () => {
      const url = getRecipeCoverImageUrl(recipe, [
        fakeCover({ id: "active", imageUrl: "raw", status: "archived", archivedAt: new Date("2026-02-01") }),
      ]);
      expect(url).toBeNull();
    });

    it("uses raw image as temporary display for a processing active cover with no variant", () => {
      const url = getRecipeCoverImageUrl(
        { ...recipe, activeCoverVariant: null, coverMode: "auto" },
        [fakeCover({ id: "active", imageUrl: "raw", stylizedImageUrl: null, status: "processing" })],
      );
      expect(url).toBe("raw");
    });

    it("falls back to the preferred variant when a ready active cover has no selected variant", () => {
      const url = getRecipeCoverImageUrl(
        { ...recipe, activeCoverVariant: null },
        [fakeCover({ id: "active", imageUrl: "raw", stylizedImageUrl: "stylized" })],
      );
      expect(url).toBe("stylized");
    });

    it("treats a missing coverMode as auto for compatibility", () => {
      const url = getRecipeCoverImageUrl(
        { id: "r", title: "Tomato Soup", activeCoverId: "active", activeCoverVariant: "image" },
        [fakeCover({ id: "active", imageUrl: "raw", stylizedImageUrl: "stylized" })],
      );
      expect(url).toBe("raw");
    });

    it("returns null when no variant is selected and the ready cover has no displayable URL", () => {
      const url = getRecipeCoverImageUrl(
        { ...recipe, activeCoverVariant: null },
        [fakeCover({ id: "active", imageUrl: "", stylizedImageUrl: "" })],
      );
      expect(url).toBeNull();
    });

    it("returns null when the selected variant URL is empty", () => {
      const url = getRecipeCoverImageUrl(recipe, [
        fakeCover({ id: "active", imageUrl: "raw", stylizedImageUrl: "" }),
      ]);
      expect(url).toBeNull();
    });

    it("returns null for an invalid override variant", () => {
      const url = getRecipeCoverImageUrl(
        recipe,
        [fakeCover({ id: "active", imageUrl: "raw", stylizedImageUrl: "stylized" })],
        "poster" as never,
      );
      expect(url).toBeNull();
    });

    it("returns null for an invalid active cover variant", () => {
      const url = getRecipeCoverImageUrl(
        { ...recipe, activeCoverVariant: "poster" },
        [fakeCover({ id: "active", imageUrl: "raw", stylizedImageUrl: "stylized" })],
      );
      expect(url).toBeNull();
    });

    it("returns null for an invalid cover mode", () => {
      const url = getRecipeCoverImageUrl(
        { ...recipe, coverMode: "surprise" },
        [fakeCover({ id: "active", imageUrl: "raw", stylizedImageUrl: "stylized" })],
      );
      expect(url).toBeNull();
    });

    it("returns null for a failed active cover", () => {
      const url = getRecipeCoverImageUrl(
        { ...recipe, activeCoverVariant: "image" },
        [fakeCover({ id: "active", imageUrl: "raw", status: "failed", generationStatus: "failed" })],
      );
      expect(url).toBeNull();
    });

    it("returns null for an invalid active cover status", () => {
      const url = getRecipeCoverImageUrl(
        { ...recipe, activeCoverVariant: "image" },
        [fakeCover({ id: "active", imageUrl: "raw", status: "queued" })],
      );
      expect(url).toBeNull();
    });

    it("does not throw when recipe.title is an empty string", () => {
      expect(() => getRecipeCoverImageUrl({ ...recipe, title: "" }, [])).not.toThrow();
    });
  });

  describe("active cover payload helpers", () => {
    it("returns only same-recipe active covers and serializes cache snapshots", async () => {
      const cover = await createCover(db, {
        recipeId,
        imageUrl: "https://example.com/raw.jpg",
        stylizedImageUrl: "https://example.com/editorial.jpg",
        sourceType: "spoon",
        sourceImageUrl: "https://example.com/source.jpg",
        createdById: chefId,
        promptVersion: "editorial-v1",
        styleVersion: "phone-to-editorial-v1",
      });
      const otherRecipe = await db.recipe.create({
        data: { ...createTestRecipe(chefId), chefId },
      });

      expect(getScopedActiveCover({ id: recipeId, activeCover: cover })).toBe(cover);
      expect(getScopedActiveCover({ id: otherRecipe.id, activeCover: cover })).toBeNull();
      expect(getScopedActiveCover({ id: recipeId, activeCover: null })).toBeNull();
      expect(recipeCoverCacheSnapshot(null)).toBeNull();
      expect(recipeCoverCacheSnapshot(cover)).toMatchObject({
        id: cover.id,
        recipeId,
        imageUrl: "https://example.com/raw.jpg",
        stylizedImageUrl: "https://example.com/editorial.jpg",
        sourceType: "spoon",
        sourceImageUrl: "https://example.com/source.jpg",
        createdById: chefId,
        promptVersion: "editorial-v1",
        styleVersion: "phone-to-editorial-v1",
        archivedAt: null,
        createdAt: cover.createdAt.toISOString(),
      });
    });
  });

  describe("getRecipeCoverDisplay", () => {
    it.each([
      ["ai-placeholder", "image", "AI generated"],
      ["chef-upload", "image", "Chef photo"],
      ["chef-upload", "stylized", "Editorialized chef photo"],
      ["spoon", "image", "Chef photo"],
      ["spoon", "stylized", "Editorialized chef photo"],
      ["import", "image", "Imported photo"],
    ] as const)("labels %s/%s as %s", (sourceType, variant, provenanceLabel) => {
      const display = getRecipeCoverDisplay(
        { id: "r", title: "Tomato Soup", activeCoverId: "active", activeCoverVariant: variant, coverMode: "manual" },
        [fakeCover({ id: "active", sourceType, imageUrl: "raw", stylizedImageUrl: "stylized" })],
      );
      expect(display).toMatchObject({
        coverId: "active",
        activeVariant: variant,
        provenanceLabel,
      });
    });

    it("does not mislabel an unknown source type as AI generated", () => {
      const display = getRecipeCoverDisplay(
        { id: "r", title: "Tomato Soup", activeCoverId: "active", activeCoverVariant: "image", coverMode: "manual" },
        [fakeCover({ id: "active", sourceType: "legacy-random", imageUrl: "raw" })],
      );
      expect(display?.provenanceLabel).toBe("Unknown source");
    });
  });

  describe("setActiveRecipeCover", () => {
    it("sets recipe active cover, variant, and manual cover mode", async () => {
      const cover = await db.recipeCover.create({
        data: {
          recipeId,
          imageUrl: "raw",
          stylizedImageUrl: "stylized",
          sourceType: "chef-upload",
        },
      });

      const result = await setActiveRecipeCover(db, { recipeId, coverId: cover.id, variant: "stylized" });
      expect(result.activeCoverId).toBe(cover.id);
      expect(result.activeCoverVariant).toBe("stylized");
      expect(result.coverMode).toBe("manual");
    });

    it("rejects an archived cover", async () => {
      const cover = await db.recipeCover.create({
        data: {
          recipeId,
          imageUrl: "raw",
          sourceType: "chef-upload",
          status: "archived",
          archivedAt: new Date("2026-02-01"),
        },
      });

      await expect(setActiveRecipeCover(db, { recipeId, coverId: cover.id, variant: "image" }))
        .rejects.toThrow("Cannot activate an archived cover");
    });

    it("rejects a missing stylized variant URL", async () => {
      const cover = await db.recipeCover.create({
        data: {
          recipeId,
          imageUrl: "raw",
          sourceType: "chef-upload",
        },
      });

      await expect(setActiveRecipeCover(db, { recipeId, coverId: cover.id, variant: "stylized" }))
        .rejects.toThrow("Selected cover variant is unavailable");
    });

    it("rejects a missing cover", async () => {
      await expect(setActiveRecipeCover(db, {
        recipeId,
        coverId: "missing-cover",
        variant: "image",
      })).rejects.toThrow("Selected cover was not found");
    });

    it("rejects an invalid requested variant", async () => {
      const cover = await db.recipeCover.create({
        data: {
          recipeId,
          imageUrl: "raw",
          sourceType: "chef-upload",
        },
      });

      await expect(setActiveRecipeCover(db, {
        recipeId,
        coverId: cover.id,
        variant: "poster" as never,
      })).rejects.toThrow("Invalid cover variant");
    });

    it("rejects a failed cover", async () => {
      const cover = await db.recipeCover.create({
        data: {
          recipeId,
          imageUrl: "raw",
          sourceType: "chef-upload",
          status: "failed",
          generationStatus: "failed",
        },
      });

      await expect(setActiveRecipeCover(db, { recipeId, coverId: cover.id, variant: "image" }))
        .rejects.toThrow("Cannot activate a failed cover");
    });

    it("rejects a cover with an invalid status", async () => {
      const cover = await db.recipeCover.create({
        data: {
          recipeId,
          imageUrl: "raw",
          sourceType: "chef-upload",
          status: "queued",
        },
      });

      await expect(setActiveRecipeCover(db, { recipeId, coverId: cover.id, variant: "image" }))
        .rejects.toThrow("Cannot activate a cover with invalid status");
    });
  });

  describe("archiveRecipeCover", () => {
    it("archives an inactive cover", async () => {
      const cover = await db.recipeCover.create({
        data: { recipeId, imageUrl: "raw", sourceType: "chef-upload" },
      });

      const result = await archiveRecipeCover(db, { recipeId, coverId: cover.id });
      expect(result.archivedCover.status).toBe("archived");
      expect(result.archivedCover.archivedAt).toBeInstanceOf(Date);
    });

    it("rejects a missing cover", async () => {
      await expect(archiveRecipeCover(db, {
        recipeId,
        coverId: "missing-cover",
      })).rejects.toThrow("Cover was not found");
    });

    it("requires a replacement or explicit no-cover state for the active cover", async () => {
      const cover = await db.recipeCover.create({
        data: { recipeId, imageUrl: "raw", sourceType: "chef-upload" },
      });
      await db.recipe.update({
        where: { id: recipeId },
        data: { activeCoverId: cover.id, activeCoverVariant: "image", coverMode: "manual" },
      });

      await expect(archiveRecipeCover(db, { recipeId, coverId: cover.id }))
        .rejects.toThrow("Archiving the active cover requires a replacement or confirmNoCover");
    });

    it("rejects replacing the active cover with the same cover being archived", async () => {
      const cover = await db.recipeCover.create({
        data: { recipeId, imageUrl: "raw", sourceType: "chef-upload" },
      });
      await db.recipe.update({
        where: { id: recipeId },
        data: { activeCoverId: cover.id, activeCoverVariant: "image", coverMode: "manual" },
      });

      await expect(archiveRecipeCover(db, {
        recipeId,
        coverId: cover.id,
        replacementCoverId: cover.id,
        replacementVariant: "image",
      })).rejects.toThrow("Replacement cover must be different from the archived cover");
    });

    it("requires a replacement variant when replacing the active cover", async () => {
      const active = await db.recipeCover.create({
        data: { recipeId, imageUrl: "raw", sourceType: "chef-upload" },
      });
      const replacement = await db.recipeCover.create({
        data: { recipeId, imageUrl: "replacement", sourceType: "chef-upload" },
      });
      await db.recipe.update({
        where: { id: recipeId },
        data: { activeCoverId: active.id, activeCoverVariant: "image", coverMode: "manual" },
      });

      await expect(archiveRecipeCover(db, {
        recipeId,
        coverId: active.id,
        replacementCoverId: replacement.id,
      })).rejects.toThrow("Replacement variant is required");
    });

    it("sets coverMode none when archiving the active cover with confirmation", async () => {
      const cover = await db.recipeCover.create({
        data: { recipeId, imageUrl: "raw", sourceType: "chef-upload" },
      });
      await db.recipe.update({
        where: { id: recipeId },
        data: { activeCoverId: cover.id, activeCoverVariant: "image", coverMode: "manual" },
      });

      const result = await archiveRecipeCover(db, { recipeId, coverId: cover.id, confirmNoCover: true });
      expect(result.recipe).toMatchObject({
        activeCoverId: null,
        activeCoverVariant: null,
        coverMode: "none",
      });
    });

    it("switches active cover before archiving the previous active cover", async () => {
      const active = await db.recipeCover.create({
        data: { recipeId, imageUrl: "raw", sourceType: "chef-upload" },
      });
      const replacement = await db.recipeCover.create({
        data: { recipeId, imageUrl: "replacement", sourceType: "chef-upload" },
      });
      await db.recipe.update({
        where: { id: recipeId },
        data: { activeCoverId: active.id, activeCoverVariant: "image", coverMode: "manual" },
      });

      const result = await archiveRecipeCover(db, {
        recipeId,
        coverId: active.id,
        replacementCoverId: replacement.id,
        replacementVariant: "image",
      });

      expect(result.archivedCover.status).toBe("archived");
      expect(result.recipe).toMatchObject({
        activeCoverId: replacement.id,
        activeCoverVariant: "image",
        coverMode: "manual",
      });
    });
  });

  describe("backfillActiveCoverForRecipe", () => {
    it("chooses the newest ready non-archived cover with a non-empty display URL", async () => {
      await db.recipeCover.create({
        data: {
          id: "old-real",
          recipeId,
          imageUrl: "old",
          sourceType: "chef-upload",
          createdAt: new Date("2026-01-01"),
        },
      });
      const winner = await db.recipeCover.create({
        data: {
          id: "winner",
          recipeId,
          imageUrl: "raw",
          stylizedImageUrl: "stylized",
          sourceType: "spoon",
          createdAt: new Date("2026-02-01"),
        },
      });
      await db.recipeCover.create({
        data: {
          id: "new-empty",
          recipeId,
          imageUrl: "",
          stylizedImageUrl: "",
          sourceType: "ai-placeholder",
          createdAt: new Date("2026-03-01"),
        },
      });

      const recipe = await backfillActiveCoverForRecipe(db, recipeId);
      expect(recipe.activeCoverId).toBe(winner.id);
      expect(recipe.activeCoverVariant).toBe("stylized");
      expect(recipe.coverMode).toBe("auto");
    });

    it("leaves active fields null when no ready displayable cover exists", async () => {
      await db.recipeCover.create({
        data: {
          recipeId,
          imageUrl: "",
          sourceType: "ai-placeholder",
        },
      });

      const recipe = await backfillActiveCoverForRecipe(db, recipeId);
      expect(recipe.activeCoverId).toBeNull();
      expect(recipe.activeCoverVariant).toBeNull();
      expect(recipe.coverMode).toBe("auto");
    });

    it("ignores failed, processing, archived, and invalid-status covers", async () => {
      const ready = await db.recipeCover.create({
        data: {
          id: "ready-cover",
          recipeId,
          imageUrl: "ready",
          sourceType: "chef-upload",
          createdAt: new Date("2026-01-01"),
        },
      });
      await db.recipeCover.createMany({
        data: [
          {
            id: "failed-cover",
            recipeId,
            imageUrl: "failed",
            sourceType: "chef-upload",
            status: "failed",
            createdAt: new Date("2026-02-01"),
          },
          {
            id: "processing-cover",
            recipeId,
            imageUrl: "processing",
            sourceType: "chef-upload",
            status: "processing",
            createdAt: new Date("2026-03-01"),
          },
          {
            id: "archived-cover",
            recipeId,
            imageUrl: "archived",
            sourceType: "chef-upload",
            status: "archived",
            archivedAt: new Date("2026-04-01"),
            createdAt: new Date("2026-04-01"),
          },
          {
            id: "invalid-cover",
            recipeId,
            imageUrl: "invalid",
            sourceType: "chef-upload",
            status: "queued",
            createdAt: new Date("2026-05-01"),
          },
        ],
      });

      const recipe = await backfillActiveCoverForRecipe(db, recipeId);
      expect(recipe.activeCoverId).toBe(ready.id);
      expect(recipe.activeCoverVariant).toBe("image");
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
