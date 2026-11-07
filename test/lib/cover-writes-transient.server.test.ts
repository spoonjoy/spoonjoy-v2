// @vitest-environment node
// The cover and cook writes that MCP `create_spoon`, the API and the cover jobs share, when D1's
// connection drops: each runs again only when that is safe, or checks whether its earlier try
// committed, and ends with the rows one clean run leaves. "lost" never reached the database,
// "lost-answer" committed with the answer lost, and "late" committed just before the retry.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { createCover, startRecipeCoverRegeneration } from "~/lib/recipe-cover.server";
import { createSpoon } from "~/lib/recipe-spoon.server";
import { settleStuckCoverGenerations, d1StuckCoverStore, type StuckCoverStore } from "~/lib/recipe-cover-stuck.server";
import { tryConsumeImageGenQuota, PLACEHOLDER_DAILY_CAP } from "~/lib/image-gen-ledger.server";
import { D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { flakyD1, type FlakyOutcome } from "../helpers/flaky-d1";
import { flakyPrisma } from "../helpers/flaky-prisma";
import { createTestUser } from "../utils";

const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];

let db: PrismaClient;
let d1: SqliteD1;
let chefId: string;
let recipeId: string;

beforeEach(async () => {
  db = await getLocalDb();
  await cleanupDatabase();
  d1 = sqliteD1();
  chefId = (await db.user.create({ data: createTestUser() })).id;
  recipeId = (await db.recipe.create({ data: { title: "Bread", chefId } })).id;
});

afterEach(async () => {
  d1.close();
  await cleanupDatabase();
});

describe("shared cover and cook creates on Prisma", () => {
  it.each(OUTCOMES)("creates one cover with an id chosen before the first try (%s)", async (outcome) => {
    const flaky = flakyPrisma(db);
    flaky.failNext("recipeCover", "create", outcome);

    const cover = await createCover(flaky.db, { recipeId, imageUrl: "/c.jpg", sourceType: "chef-upload" });

    expect(flaky.failures()).toBe(1);
    expect(cover.id).toMatch(/^c[a-z0-9]{24}$/);
    expect(await db.recipeCover.findMany({ where: { recipeId }, select: { id: true } })).toEqual([{ id: cover.id }]);
  });

  it.each(OUTCOMES)("logs one cook, as MCP create_spoon does (%s)", async (outcome) => {
    const flaky = flakyPrisma(db);
    flaky.failNext("recipeSpoon", "create", outcome);

    const { spoon, isOriginCook } = await createSpoon(flaky.db, { chefId, recipeId, note: "Crusty" });

    expect(flaky.failures()).toBe(1);
    expect(isOriginCook).toBe(true);
    expect(spoon).toMatchObject({ chefId, recipeId, note: "Crusty" });
    expect(await db.recipeSpoon.findMany({ where: { recipeId }, select: { id: true } })).toEqual([{ id: spoon.id }]);
  });

  it("keeps a given cook id, and still refuses an id that is already taken on the first try", async () => {
    const { spoon } = await createSpoon(db, { id: "given-spoon-id", chefId, recipeId, note: "First" });
    expect(spoon.id).toBe("given-spoon-id");
    await expect(createSpoon(db, { id: "given-spoon-id", chefId, recipeId, note: "Again" })).rejects.toMatchObject({ code: "P2002" });
  });

  it("gives up with D1WriteUnavailableError when every try is lost, writing nothing", async () => {
    const flaky = flakyPrisma(db);
    flaky.failNext("recipeCover", "create", "lost", "lost", "lost", "lost");

    await expect(createCover(flaky.db, { recipeId, imageUrl: "/c.jpg", sourceType: "chef-upload" }))
      .rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await db.recipeCover.count({ where: { recipeId } })).toBe(0);
  });

  it("restarts a cover in place after a lost answer, with one start time", async () => {
    const cover = await db.recipeCover.create({
      data: { recipeId, imageUrl: "/plain.jpg", sourceType: "chef-upload", status: "failed", failureReason: "timeout" },
    });
    const flaky = flakyPrisma(db);
    flaky.failNext("recipeCover", "update", "lost-answer");

    await expect(startRecipeCoverRegeneration(flaky.db, cover, { createdById: chefId, rawPhotoUrl: "/plain.jpg", promptAddition: null }))
      .resolves.toEqual({ coverId: cover.id, parentCoverId: undefined });
    expect(flaky.failures()).toBe(1);
    await expect(db.recipeCover.findUniqueOrThrow({ where: { id: cover.id } })).resolves.toMatchObject({
      status: "processing",
      generationStatus: "processing",
      failureReason: null,
    });
  });
});

describe("settling stuck cover generations on D1", () => {
  const NOW = new Date("2026-10-09T12:00:00.000Z");

  async function stuckCover() {
    return db.recipeCover.create({
      data: {
        recipeId,
        imageUrl: "",
        sourceType: "ai-placeholder",
        status: "processing",
        generationStatus: "processing",
        createdAt: new Date(NOW.getTime() - 11 * 60_000),
      },
    });
  }

  it.each(OUTCOMES)("fails a stuck cover once (%s)", async (outcome) => {
    const cover = await stuckCover();
    const flaky = flakyD1(d1.binding);
    flaky.failNext(/UPDATE "RecipeCover"/, outcome);

    const [settled] = await settleStuckCoverGenerations(d1StuckCoverStore(flaky.binding), recipeId, [cover], NOW);

    expect(flaky.failures()).toBe(1);
    expect(settled).toMatchObject({ id: cover.id, status: "failed", generationStatus: "failed" });
  });

  it("answers the covers as they are while the database is unavailable, and rethrows any other error", async () => {
    const cover = await stuckCover();
    const flaky = flakyD1(d1.binding);
    flaky.failNext(/UPDATE "RecipeCover"/, "lost", "lost", "lost", "lost");

    await expect(settleStuckCoverGenerations(d1StuckCoverStore(flaky.binding), recipeId, [cover], NOW)).resolves.toEqual([cover]);
    await expect(db.recipeCover.findUniqueOrThrow({ where: { id: cover.id } })).resolves.toMatchObject({ status: "processing" });

    const broken: StuckCoverStore = { failStuck: async () => { throw new Error("no such table"); }, read: async () => [] };
    await expect(settleStuckCoverGenerations(broken, recipeId, [cover], NOW)).rejects.toThrow("no such table");
  });
});

describe("spending image generation quota on D1", () => {
  const now = () => new Date("2026-10-11T09:00:00.000Z");
  const spent = async () => (await db.imageGenLedger.findFirst({ where: { userId: chefId, kind: "placeholder" } }))?.count ?? 0;
  const budget = async () => (await db.imageGenDailyBudget.findFirst())?.count ?? 0;

  it.each(OUTCOMES)("spends exactly one unit and answers true (%s)", async (outcome) => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(/ImageGenLedger/, outcome);

    await expect(tryConsumeImageGenQuota(db, chefId, "placeholder", { now, d1: flaky.binding })).resolves.toBe(true);

    expect(flaky.failures()).toBe(1);
    expect(await spent()).toBe(1);
    expect(await budget()).toBe(1);
    // The marker that makes a retry spend nothing more is the chef's only one.
    expect(await db.apiIdempotencyKey.count({ where: { userId: chefId, clientKey: "image-gen-consume" } })).toBe(1);
  });

  it.each(OUTCOMES)("answers false at the cap and spends nothing more (%s)", async (outcome) => {
    for (let index = 0; index < PLACEHOLDER_DAILY_CAP; index += 1) {
      await tryConsumeImageGenQuota(db, chefId, "placeholder", { now, d1: d1.binding });
    }
    const flaky = flakyD1(d1.binding);
    flaky.failNext(/ImageGenLedger/, outcome);

    await expect(tryConsumeImageGenQuota(db, chefId, "placeholder", { now, d1: flaky.binding })).resolves.toBe(false);
    expect(await spent()).toBe(PLACEHOLDER_DAILY_CAP);
    expect(await budget()).toBe(PLACEHOLDER_DAILY_CAP);
  });

  it.each(OUTCOMES)("spends exactly one unit of the chef's cap and none of the global budget on a free consume (%s)", async (outcome) => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(/ImageGenLedger/, outcome);

    await expect(tryConsumeImageGenQuota(db, chefId, "placeholder", { now, d1: flaky.binding, free: true })).resolves.toBe(true);

    expect(flaky.failures()).toBe(1);
    expect(await spent()).toBe(1);
    expect(await budget()).toBe(0);
    const markers = await db.apiIdempotencyKey.findMany({ where: { userId: chefId, clientKey: "image-gen-consume" } });
    expect(markers).toHaveLength(1);
    expect(markers[0]!.responseStatus).toBe(200);
  });

  it.each(OUTCOMES)("answers a free consume false at the chef's cap and spends nothing more (%s)", async (outcome) => {
    for (let index = 0; index < PLACEHOLDER_DAILY_CAP; index += 1) {
      await expect(tryConsumeImageGenQuota(db, chefId, "placeholder", { now, d1: d1.binding, free: true })).resolves.toBe(true);
    }
    const flaky = flakyD1(d1.binding);
    flaky.failNext(/ImageGenLedger/, outcome);

    await expect(tryConsumeImageGenQuota(db, chefId, "placeholder", { now, d1: flaky.binding, free: true })).resolves.toBe(false);
    expect(await spent()).toBe(PLACEHOLDER_DAILY_CAP);
    expect(await budget()).toBe(0);
  });

  it("drops the chef's markers once they are a day old", async () => {
    await tryConsumeImageGenQuota(db, chefId, "placeholder", { now, d1: d1.binding });
    const nextDay = () => new Date("2026-10-12T09:00:01.000Z");
    await tryConsumeImageGenQuota(db, chefId, "placeholder", { now: nextDay, d1: d1.binding });

    const markers = await db.apiIdempotencyKey.findMany({ where: { userId: chefId, clientKey: "image-gen-consume" } });
    expect(markers).toHaveLength(1);
    expect(markers[0]!.operation).toBe("image_gen.consume.placeholder");
  });
});
