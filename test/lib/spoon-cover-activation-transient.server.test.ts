// @vitest-environment node
// Making a cook's photo the recipe's cover when D1's connection drops. After each outcome (the
// write never ran, it committed but its answer was lost, or it committed late) the recipe points
// at the new cover and the answer says so, and a write the database never takes fails as
// retryable instead of reporting a cover that is not there.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { activateSpoonCoverForDecision } from "~/lib/spoon-cover-activation.server";
import type { SpoonCoverCreationDecision } from "~/lib/spoon-cover-decision.server";
import { cleanupDatabase } from "../helpers/cleanup";
import type { FlakyOutcome } from "../helpers/flaky-d1";
import { flakyPrisma } from "../helpers/flaky-prisma";
import { createTestRecipe, createTestUser } from "../utils";

const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];

const autoSeed = {
  shouldCreateCover: true,
  reason: "auto-seed",
  coverMode: "auto",
  activeCoverVariant: null,
} satisfies SpoonCoverCreationDecision;

const manual = {
  shouldCreateCover: true,
  reason: "manual-opt-in",
  coverMode: "manual",
  activeCoverVariant: "image",
} satisfies SpoonCoverCreationDecision;

let db: PrismaClient;
let recipeId: string;

async function spoonCover() {
  return db.recipeCover.create({
    data: { recipeId, imageUrl: "https://example.test/spoon.png", sourceType: "spoon", status: "processing" },
  });
}

async function recipeCoverChoice() {
  return db.recipe.findUniqueOrThrow({
    where: { id: recipeId },
    select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
  });
}

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
  const chef = await db.user.create({ data: createTestUser() });
  recipeId = (await db.recipe.create({ data: { ...createTestRecipe(chef.id), chefId: chef.id } })).id;
});

afterEach(async () => {
  await cleanupDatabase();
});

describe("activateSpoonCoverForDecision after a transient D1 error", () => {
  it.each(OUTCOMES)("makes a chosen cook photo the cover once (%s)", async (outcome) => {
    const cover = await spoonCover();
    const flaky = flakyPrisma(db);
    flaky.failNext("recipe", "update", outcome);

    await expect(activateSpoonCoverForDecision(flaky.db, {
      recipeId,
      coverId: cover.id,
      decision: manual,
      previousActiveCoverId: null,
    })).resolves.toBe(true);

    expect(flaky.failures()).toBe(1);
    await expect(recipeCoverChoice()).resolves.toEqual({ activeCoverId: cover.id, activeCoverVariant: "image", coverMode: "manual" });
  });

  it.each(OUTCOMES)("fills an open cover gap and answers that it did (%s)", async (outcome) => {
    const cover = await spoonCover();
    const flaky = flakyPrisma(db);
    flaky.failNext("recipe", "updateMany", outcome);

    await expect(activateSpoonCoverForDecision(flaky.db, {
      recipeId,
      coverId: cover.id,
      decision: autoSeed,
      previousActiveCoverId: null,
    })).resolves.toBe(true);

    expect(flaky.failures()).toBe(1);
    await expect(recipeCoverChoice()).resolves.toEqual({ activeCoverId: cover.id, activeCoverVariant: "image", coverMode: "auto" });
  });

  it("answers false when a retry finds the gap closed by a real cover it did not set", async () => {
    const real = await db.recipeCover.create({
      data: { recipeId, imageUrl: "https://example.test/real.png", sourceType: "chef-upload", status: "ready" },
    });
    await db.recipe.update({ where: { id: recipeId }, data: { activeCoverId: real.id, activeCoverVariant: "image", coverMode: "auto" } });
    const cover = await spoonCover();
    const flaky = flakyPrisma(db);
    flaky.failNext("recipe", "updateMany", "lost");

    await expect(activateSpoonCoverForDecision(flaky.db, {
      recipeId,
      coverId: cover.id,
      decision: autoSeed,
      previousActiveCoverId: real.id,
    })).resolves.toBe(false);

    await expect(recipeCoverChoice()).resolves.toEqual({ activeCoverId: real.id, activeCoverVariant: "image", coverMode: "auto" });
  });

  it.each([
    ["a chosen cook photo", manual, "update", "cover.activate_spoon"],
    ["an automatic cook photo", autoSeed, "updateMany", "cover.auto_seed_spoon"],
  ] as const)("gives up on %s with a retryable error, leaving the recipe as it was", async (_label, decision, method, scope) => {
    const cover = await spoonCover();
    const flaky = flakyPrisma(db);
    flaky.failNext("recipe", method, "lost", "lost", "lost", "lost");

    const failure = activateSpoonCoverForDecision(flaky.db, { recipeId, coverId: cover.id, decision, previousActiveCoverId: null });
    await expect(failure).rejects.toBeInstanceOf(D1WriteUnavailableError);
    await expect(failure).rejects.toMatchObject({ scope });
    await expect(recipeCoverChoice()).resolves.toMatchObject({ activeCoverId: null });
  });
});
