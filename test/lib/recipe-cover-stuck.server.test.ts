// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient, RecipeCover } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import {
  d1StuckCoverStore,
  isStuckCoverGeneration,
  prismaStuckCoverStore,
  settleStuckCoverGenerations,
  STUCK_COVER_FAILURE_REASON,
  STUCK_COVER_GENERATION_AFTER_MS,
  type StuckCoverStore,
} from "~/lib/recipe-cover-stuck.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

let db: PrismaClient;
let d1: SqliteD1;

const NOW = new Date("2026-10-09T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

function coverShape(overrides: Partial<RecipeCover>): RecipeCover {
  return {
    id: "cover",
    recipeId: "recipe",
    imageUrl: "",
    stylizedImageUrl: null,
    sourceType: "ai-placeholder",
    sourceSpoonId: null,
    status: "processing",
    createdById: null,
    sourceImageUrl: null,
    generationStatus: "processing",
    generationStartedAt: null,
    failureReason: null,
    promptVersion: null,
    styleVersion: null,
    promptAddition: null,
    parentCoverId: null,
    archivedAt: null,
    createdAt: minutesAgo(11),
    ...overrides,
  };
}

async function seed() {
  const owner = await db.user.create({ data: createTestUser() });
  const recipe = await db.recipe.create({
    data: { title: "Stuck Covers", chefId: owner.id, updatedAt: minutesAgo(60) },
  });
  const cookbook = await db.cookbook.create({
    data: { title: "Weeknights", authorId: owner.id, updatedAt: minutesAgo(60) },
  });
  await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: owner.id } });
  const cover = (data: Partial<RecipeCover>) => db.recipeCover.create({
    data: { recipeId: recipe.id, imageUrl: "", sourceType: "ai-placeholder", ...data },
  });
  return {
    recipe,
    cookbook,
    // Created processing 11 minutes ago, never restarted: its job died.
    deadPlaceholder: await cover({ status: "processing", generationStatus: "processing", createdAt: minutesAgo(11) }),
    // An uploaded photo whose editorial pass started 11 minutes ago and never finished.
    deadEditorial: await cover({
      imageUrl: "https://spoonjoy.app/photos/covers/raw.jpg",
      sourceType: "spoon",
      status: "processing",
      generationStatus: "processing",
      createdAt: minutesAgo(90),
      generationStartedAt: minutesAgo(11),
    }),
    // Created long ago, but regenerated a minute ago: a live job.
    regenerated: await cover({
      imageUrl: "https://spoonjoy.app/photos/covers/regen.jpg",
      sourceType: "spoon",
      status: "processing",
      generationStatus: "processing",
      createdAt: minutesAgo(90),
      generationStartedAt: minutesAgo(1),
    }),
    ready: await cover({
      imageUrl: "https://spoonjoy.app/photos/covers/ready.jpg",
      status: "ready",
      generationStatus: "succeeded",
      createdAt: minutesAgo(90),
    }),
    archived: await cover({ status: "archived", generationStatus: "processing", createdAt: minutesAgo(90), archivedAt: minutesAgo(80) }),
  };
}

describe("isStuckCoverGeneration", () => {
  it.each([
    ["a cover created processing past the cutoff", {}, true],
    ["a cover whose generation started inside the cutoff", { generationStartedAt: minutesAgo(9), createdAt: minutesAgo(90) }, false],
    ["a cover whose generation restarted past the cutoff", { generationStartedAt: minutesAgo(10), createdAt: minutesAgo(90) }, true],
    ["a ready cover still generating its editorial variant", { status: "ready" }, true],
    ["a cover that finished", { status: "ready", generationStatus: "succeeded" }, false],
    ["an archived cover", { status: "archived" }, false],
    ["a cover archived without its status", { archivedAt: minutesAgo(1) }, false],
  ] as const)("judges %s", (_label, overrides, stuck) => {
    expect(isStuckCoverGeneration(coverShape(overrides as Partial<RecipeCover>), NOW)).toBe(stuck);
  });

  it("waits the whole cutoff, which is longer than any job's own budget", () => {
    expect(STUCK_COVER_GENERATION_AFTER_MS).toBe(10 * 60_000);
  });
});

describe("settleStuckCoverGenerations", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("does nothing at all when no cover is stuck", async () => {
    const store: StuckCoverStore = { failStuck: vi.fn(), read: vi.fn() };
    const covers = [coverShape({ status: "ready", generationStatus: "succeeded" }), null];

    await expect(settleStuckCoverGenerations(store, "recipe", covers, NOW)).resolves.toBe(covers);
    expect(store.failStuck).not.toHaveBeenCalled();
    expect(store.read).not.toHaveBeenCalled();
  });

  it.each([
    ["Prisma", () => prismaStuckCoverStore(db)],
    ["D1", () => d1StuckCoverStore(d1.binding)],
  ] as const)("fails only the stuck generations, through %s, and touches the recipe and its cookbooks", async (_store, store) => {
    const seeded = await seed();
    const read = await db.recipeCover.findMany({ where: { recipeId: seeded.recipe.id }, orderBy: { createdAt: "desc" } });

    const settled = await settleStuckCoverGenerations(store(), seeded.recipe.id, [null, ...read], NOW);

    expect(settled[0]).toBeNull();
    const byId = new Map(settled.slice(1).map((cover) => [cover!.id, cover!]));
    // No image: nothing to show, so the cover fails.
    expect(byId.get(seeded.deadPlaceholder.id)).toMatchObject({
      status: "failed",
      generationStatus: "failed",
      failureReason: STUCK_COVER_FAILURE_REASON,
    });
    // An image: the raw photo stays usable, and only the editorial pass failed.
    expect(byId.get(seeded.deadEditorial.id)).toMatchObject({
      status: "ready",
      generationStatus: "failed",
      failureReason: STUCK_COVER_FAILURE_REASON,
    });
    expect(byId.get(seeded.regenerated.id)).toMatchObject({ status: "processing", generationStatus: "processing" });
    expect(byId.get(seeded.ready.id)).toMatchObject({ status: "ready", generationStatus: "succeeded" });
    expect(byId.get(seeded.archived.id)).toMatchObject({ status: "archived", generationStatus: "processing" });

    // What was returned is what is stored.
    const stored = await db.recipeCover.findMany({ where: { recipeId: seeded.recipe.id } });
    for (const cover of stored) {
      expect(byId.get(cover.id)).toMatchObject({ status: cover.status, generationStatus: cover.generationStatus });
    }
    // Native sync sees the change.
    await expect(db.recipe.findUniqueOrThrow({ where: { id: seeded.recipe.id } })).resolves.toMatchObject({ updatedAt: NOW });
    await expect(db.cookbook.findUniqueOrThrow({ where: { id: seeded.cookbook.id } })).resolves.toMatchObject({ updatedAt: NOW });
  });

  it.each([
    ["Prisma", () => prismaStuckCoverStore(db)],
    ["D1", () => d1StuckCoverStore(d1.binding)],
  ] as const)("keeps the outcome of a job that finished after the read, through %s", async (_store, store) => {
    const seeded = await seed();
    const read = await db.recipeCover.findUniqueOrThrow({ where: { id: seeded.deadEditorial.id } });
    // The job writes its outcome between the read and the settle.
    await db.recipeCover.update({
      where: { id: seeded.deadEditorial.id },
      data: { status: "ready", generationStatus: "succeeded", stylizedImageUrl: "https://spoonjoy.app/photos/covers/editorial.jpg" },
    });

    const [settled] = await settleStuckCoverGenerations(store(), seeded.recipe.id, [read], NOW);

    expect(settled).toMatchObject({
      status: "ready",
      generationStatus: "succeeded",
      stylizedImageUrl: "https://spoonjoy.app/photos/covers/editorial.jpg",
      failureReason: null,
    });
  });

  it("keeps a generation restarted after the read, through D1", async () => {
    const seeded = await seed();
    const read = await db.recipeCover.findUniqueOrThrow({ where: { id: seeded.deadPlaceholder.id } });
    // Someone regenerates the cover between the read and the settle.
    await db.recipeCover.update({ where: { id: seeded.deadPlaceholder.id }, data: { generationStartedAt: minutesAgo(0) } });

    const [settled] = await settleStuckCoverGenerations(d1StuckCoverStore(d1.binding), seeded.recipe.id, [read], NOW);

    expect(settled).toMatchObject({ status: "processing", generationStatus: "processing", failureReason: null });
  });
});
