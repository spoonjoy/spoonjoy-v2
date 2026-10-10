// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { scheduleAiPlaceholderCover, type SchedulePlaceholderInput } from "~/lib/ai-placeholder-cover.server";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { getLocalDb } from "~/lib/db.server";
import type { ImageGenRunner } from "~/lib/image-gen.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";

// AI placeholder covers with a D1 binding: marking the placeholder ready and activating it
// go to D1 as one batch, and marking it failed is one statement, never Prisma's multi-row
// writes (which run as separate statements on D1, outside any transaction). The rows must
// match the Prisma path, which still runs without a binding.

let db: PrismaClient;
let d1: SqliteD1;
let userId: string;

const OLD = new Date("2026-01-01T00:00:00.000Z");
const TRIGGER = "PlaceholderD1_injected_failure";
const bucket = { put: vi.fn(async () => ({})) } as unknown as R2Bucket;

function runner(options: { fails?: boolean; before?: () => Promise<unknown> } = {}): ImageGenRunner {
  const generate = vi.fn(async () => {
    await options.before?.();
    if (options.fails) throw new Error("provider down");
    return { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]), contentType: "image/png" };
  });
  return { textToImage: generate, imageToImage: generate };
}

/** A recipe in a cookbook with one generating placeholder, every timestamp old. */
async function seed(label: string, recipe: { activeCoverId?: string | null; coverMode?: string } = {}) {
  const created = await db.recipe.create({
    data: { title: `Placeholder ${label}`, chefId: userId, coverMode: recipe.coverMode ?? "auto", updatedAt: OLD },
  });
  const cookbook = await db.cookbook.create({ data: { title: `Book ${label}`, authorId: userId, updatedAt: OLD } });
  await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: created.id, addedById: userId } });
  await db.cookbook.update({ where: { id: cookbook.id }, data: { updatedAt: OLD } });
  const cover = await db.recipeCover.create({
    data: {
      recipeId: created.id,
      imageUrl: "",
      sourceType: "ai-placeholder",
      status: "processing",
      generationStatus: "processing",
      createdById: userId,
    },
  });
  return { recipeId: created.id, cookbookId: cookbook.id, coverId: cover.id };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

async function state(seeded: Seeded) {
  const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: seeded.coverId } });
  const recipe = await db.recipe.findUniqueOrThrow({ where: { id: seeded.recipeId } });
  const cookbook = await db.cookbook.findUniqueOrThrow({ where: { id: seeded.cookbookId } });
  return {
    imageUrl: cover.imageUrl.replace(/-[0-9a-f-]{36}\./, "-<uuid>."),
    status: cover.status,
    generationStatus: cover.generationStatus,
    failureReason: cover.failureReason,
    promptAddition: cover.promptAddition,
    archived: cover.archivedAt !== null,
    active: recipe.activeCoverId === seeded.coverId ? "placeholder" : recipe.activeCoverId,
    activeCoverVariant: recipe.activeCoverVariant,
    coverMode: recipe.coverMode,
    recipeTouched: recipe.updatedAt.getTime() > OLD.getTime(),
    cookbookTouched: cookbook.updatedAt.getTime() > OLD.getTime(),
  };
}

function generate(seeded: Seeded, DB: D1ReadDatabase | null, overrides: Partial<SchedulePlaceholderInput> = {}) {
  return scheduleAiPlaceholderCover({
    db,
    userId,
    recipeId: seeded.recipeId,
    coverId: seeded.coverId,
    title: "Placeholder",
    description: null,
    promptAddition: "  warm   light ",
    runner: runner(),
    bucket,
    now: () => 1234,
    env: DB ? ({ DB } as never) : null,
    logger: { error: vi.fn() },
    ...overrides,
  });
}

describe("AI placeholder covers on a D1 binding", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
    userId = (await db.user.create({ data: { email: "placeholder-d1@example.com", username: "placeholder_d1" } })).id;
  });

  afterEach(async () => {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${TRIGGER}"`);
    d1.close();
    await cleanupDatabase();
  });

  it("marks a placeholder ready and makes it the automatic cover in one batch, as the Prisma path does", async () => {
    const viaPrisma = await seed("prisma");
    const viaD1 = await seed("d1");

    await generate(viaPrisma, null);
    const before = d1.roundTrips();
    await generate(viaD1, d1.binding);

    // The atomic quota claim, then one batch for ready plus activation.
    expect(d1.roundTrips() - before).toBe(2);
    expect(await state(viaD1)).toEqual(await state(viaPrisma));
    expect(await state(viaD1)).toMatchObject({
      status: "ready",
      generationStatus: "succeeded",
      failureReason: null,
      promptAddition: "warm light",
      active: "placeholder",
      activeCoverVariant: "image",
      coverMode: "auto",
      recipeTouched: true,
      cookbookTouched: false,
    });
  });

  it("activates a requested placeholder and touches its cookbooks only while the guard still matches", async () => {
    const guard = { activeCoverId: null, activeCoverVariant: null, coverMode: "auto" };
    const viaPrisma = await seed("prisma");
    const viaD1 = await seed("d1");

    await generate(viaPrisma, null, { activateWhenReady: true, activationGuard: guard });
    await generate(viaD1, d1.binding, { activateWhenReady: true, activationGuard: guard });

    expect(await state(viaD1)).toEqual(await state(viaPrisma));
    expect(await state(viaD1)).toMatchObject({
      status: "ready",
      active: "placeholder",
      coverMode: "manual",
      recipeTouched: true,
      cookbookTouched: true,
    });

    const stale = await seed("stale", { coverMode: "none" });
    await generate(stale, d1.binding, { activateWhenReady: true, activationGuard: guard });
    expect(await state(stale)).toMatchObject({
      status: "ready",
      active: null,
      coverMode: "none",
      recipeTouched: false,
      cookbookTouched: false,
    });
  });

  it("marks a placeholder ready without activating it when activation is not wanted", async () => {
    const unguarded = await seed("unguarded");
    const suppressed = await seed("suppressed");

    await generate(unguarded, d1.binding, { activateWhenReady: true });
    await generate(suppressed, d1.binding, { suppressAutoActivation: true });

    for (const seeded of [unguarded, suppressed]) {
      expect(await state(seeded)).toMatchObject({
        status: "ready",
        generationStatus: "succeeded",
        active: null,
        recipeTouched: false,
        cookbookTouched: false,
      });
    }
  });

  it("leaves a placeholder archived during generation archived and unused", async () => {
    const seeded = await seed("archived");
    const archive = () => db.recipeCover.update({
      where: { id: seeded.coverId },
      data: { status: "archived", archivedAt: new Date() },
    });

    await generate(seeded, d1.binding, { runner: runner({ before: archive }) });

    expect(await state(seeded)).toMatchObject({
      imageUrl: "",
      status: "archived",
      generationStatus: "processing",
      archived: true,
      active: null,
      recipeTouched: false,
      cookbookTouched: false,
    });
  });

  it("applies none of the batch when a statement in it fails, then marks the placeholder failed", async () => {
    const seeded = await seed("injected");
    await db.$executeRawUnsafe(`CREATE TRIGGER "${TRIGGER}" BEFORE UPDATE ON "Recipe" WHEN OLD."id" = '${seeded.recipeId}'
      BEGIN SELECT RAISE(ABORT, 'placeholder_injected_failure'); END`);
    const logger = { error: vi.fn() };

    await generate(seeded, d1.binding, { logger });

    // The ready mark was rolled back with the failed activation; the failure mark then applied.
    expect(await state(seeded)).toMatchObject({
      imageUrl: "",
      status: "failed",
      generationStatus: "failed",
      active: null,
      recipeTouched: false,
    });
    expect((await state(seeded)).failureReason).toContain("placeholder_injected_failure");
    expect(logger.error).toHaveBeenCalledWith("ai-placeholder cover generation failed", expect.any(Error));
  });

  it("marks a failed placeholder failed on D1, as the Prisma path does, and never an archived one", async () => {
    const viaPrisma = await seed("prisma");
    const viaD1 = await seed("d1");
    const archived = await seed("archived");
    await db.recipeCover.update({ where: { id: archived.coverId }, data: { status: "archived", archivedAt: new Date() } });

    await generate(viaPrisma, null, { runner: runner({ fails: true }) });
    await generate(viaD1, d1.binding, { runner: runner({ fails: true }) });
    await generate(archived, d1.binding, { runner: runner({ fails: true }) });

    expect(await state(viaD1)).toEqual(await state(viaPrisma));
    expect(await state(viaD1)).toMatchObject({ status: "failed", generationStatus: "failed", failureReason: "Placeholder image generation failed: provider down" });
    expect(await state(archived)).toMatchObject({ status: "archived", generationStatus: "processing", failureReason: null });
  });
});
