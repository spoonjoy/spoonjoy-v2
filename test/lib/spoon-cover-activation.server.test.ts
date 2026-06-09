import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { activateSpoonCoverForDecision } from "~/lib/spoon-cover-activation.server";
import type { SpoonCoverCreationDecision } from "~/lib/spoon-cover-decision.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../utils";

describe("spoon-cover-activation.server", () => {
  let chefId: string;
  let recipeId: string;

  const autoSeedDecision = {
    shouldCreateCover: true,
    reason: "auto-seed",
    coverMode: "auto",
    activeCoverVariant: null,
  } satisfies SpoonCoverCreationDecision;

  const manualDecision = {
    shouldCreateCover: true,
    reason: "manual-opt-in",
    coverMode: "manual",
    activeCoverVariant: "image",
  } satisfies SpoonCoverCreationDecision;

  beforeEach(async () => {
    await cleanupDatabase();
    const chef = await db.user.create({ data: createTestUser() });
    chefId = chef.id;
    const recipe = await db.recipe.create({
      data: { ...createTestRecipe(chefId), chefId },
    });
    recipeId = recipe.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("auto-activates a first spoon cover when the active selection is still unchanged", async () => {
    const cover = await db.recipeCover.create({
      data: {
        recipeId,
        imageUrl: "https://example.test/spoon.png",
        sourceType: "spoon",
        status: "processing",
      },
    });

    await expect(activateSpoonCoverForDecision(db, {
      recipeId,
      coverId: cover.id,
      decision: autoSeedDecision,
      previousActiveCoverId: null,
    })).resolves.toBe(true);

    await expect(
      db.recipe.findUniqueOrThrow({
        where: { id: recipeId },
        select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
      }),
    ).resolves.toEqual({
      activeCoverId: cover.id,
      activeCoverVariant: null,
      coverMode: "auto",
    });
  });

  it("does not overwrite a real cover that appears during auto-seed activation", async () => {
    const seedCover = await db.recipeCover.create({
      data: {
        recipeId,
        imageUrl: "https://example.test/spoon.png",
        sourceType: "spoon",
        status: "processing",
      },
    });
    const competingCover = await db.recipeCover.create({
      data: {
        recipeId,
        imageUrl: "https://example.test/manual.png",
        sourceType: "chef-upload",
        status: "ready",
      },
    });
    let selectedCompetingCover = false;
    const raceDb = db.$extends({
      query: {
        recipe: {
          async updateMany({ args, query }) {
            if (!selectedCompetingCover && args.where?.id === recipeId) {
              selectedCompetingCover = true;
              await db.recipe.update({
                where: { id: recipeId },
                data: {
                  activeCoverId: competingCover.id,
                  activeCoverVariant: "image",
                  coverMode: "manual",
                },
              });
            }
            return query(args);
          },
        },
      },
    });

    await expect(activateSpoonCoverForDecision(raceDb as never, {
      recipeId,
      coverId: seedCover.id,
      decision: autoSeedDecision,
      previousActiveCoverId: null,
    })).resolves.toBe(false);

    await expect(
      db.recipe.findUniqueOrThrow({
        where: { id: recipeId },
        select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
      }),
    ).resolves.toEqual({
      activeCoverId: competingCover.id,
      activeCoverVariant: "image",
      coverMode: "manual",
    });
  });

  it("activates explicit owner opt-in covers as manual image covers", async () => {
    const existingCover = await db.recipeCover.create({
      data: {
        recipeId,
        imageUrl: "https://example.test/existing.png",
        sourceType: "chef-upload",
        status: "ready",
      },
    });
    await db.recipe.update({
      where: { id: recipeId },
      data: {
        activeCoverId: existingCover.id,
        activeCoverVariant: "image",
        coverMode: "manual",
      },
    });
    const newCover = await db.recipeCover.create({
      data: {
        recipeId,
        imageUrl: "https://example.test/new.png",
        sourceType: "spoon",
        status: "processing",
      },
    });

    await expect(activateSpoonCoverForDecision(db, {
      recipeId,
      coverId: newCover.id,
      decision: manualDecision,
      previousActiveCoverId: existingCover.id,
    })).resolves.toBe(true);

    await expect(
      db.recipe.findUniqueOrThrow({
        where: { id: recipeId },
        select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
      }),
    ).resolves.toEqual({
      activeCoverId: newCover.id,
      activeCoverVariant: "image",
      coverMode: "manual",
    });
  });
});
