// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { getLocalDb } from "~/lib/db.server";
import type { ImageGenRunner } from "~/lib/image-gen.server";
import { scheduleSpoonCoverStylization } from "~/lib/spoon-cover-stylization.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";

// Cover stylization with a D1 binding: each lifecycle update of the cover and the
// native-sync touches of its recipe and cookbooks go to D1 as one batch (through the
// SQLite-backed fake binding). The rows must match the Prisma path, which still runs
// without a binding, and a cover archived after the read must be left alone.

let db: PrismaClient;
let d1: SqliteD1;
let userId: string;

const OLD = new Date("2026-01-01T00:00:00.000Z");
const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64")}`;

function runner(fails = false): ImageGenRunner {
  const result = fails
    ? vi.fn().mockRejectedValue(new Error("provider down"))
    : vi.fn().mockResolvedValue({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]), contentType: "image/png" });
  return { textToImage: result, imageToImage: result };
}

const bucket = { put: vi.fn(async () => ({})) } as unknown as R2Bucket;

/** A recipe in a cookbook with one cover, every timestamp old. */
async function seed(label: string) {
  const recipe = await db.recipe.create({ data: { title: `Stylize ${label}`, chefId: userId, updatedAt: OLD } });
  const cookbook = await db.cookbook.create({ data: { title: `Book ${label}`, authorId: userId, updatedAt: OLD } });
  await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: userId } });
  await db.cookbook.update({ where: { id: cookbook.id }, data: { updatedAt: OLD } });
  const cover = await db.recipeCover.create({
    data: { recipeId: recipe.id, imageUrl: "https://stub.test/raw.png", sourceType: "spoon" },
  });
  return { recipeId: recipe.id, cookbookId: cookbook.id, coverId: cover.id };
}

async function state(seeded: Awaited<ReturnType<typeof seed>>) {
  const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: seeded.coverId } });
  const recipe = await db.recipe.findUniqueOrThrow({ where: { id: seeded.recipeId } });
  const cookbook = await db.cookbook.findUniqueOrThrow({ where: { id: seeded.cookbookId } });
  return {
    status: cover.status,
    generationStatus: cover.generationStatus,
    failureReason: cover.failureReason,
    stylized: cover.stylizedImageUrl?.replace(/-[0-9a-f-]{36}\./, "-<uuid>.") ?? null,
    promptVersion: cover.promptVersion,
    styleVersion: cover.styleVersion,
    promptAddition: cover.promptAddition,
    parentCoverId: cover.parentCoverId === null ? null : "set",
    archived: cover.archivedAt !== null,
    recipeTouched: recipe.updatedAt.getTime() > OLD.getTime(),
    cookbookTouched: cookbook.updatedAt.getTime() > OLD.getTime(),
  };
}

function stylize(seeded: Awaited<ReturnType<typeof seed>>, DB: D1ReadDatabase | null, overrides: Record<string, unknown> = {}) {
  return scheduleSpoonCoverStylization({
    db,
    userId,
    recipeId: seeded.recipeId,
    coverId: seeded.coverId,
    parentCoverId: seeded.coverId,
    promptAddition: "  keep   the plate ",
    rawPhotoUrl: PNG,
    recipeTitle: "Stylize",
    runner: runner(),
    bucket,
    now: () => 1234,
    suppressAutoActivation: true,
    env: DB ? ({ DB } as never) : null,
    logger: { error: vi.fn() },
    ...overrides,
  });
}

/** The binding, but `before` runs once, just ahead of batch number `at` (1-based). */
function beforeBatch(at: number, before: () => Promise<unknown>): D1ReadDatabase {
  let seen = 0;
  return {
    prepare: (sql) => d1.binding.prepare(sql),
    async batch(statements) {
      seen += 1;
      if (seen === at) await before();
      return d1.binding.batch(statements as never);
    },
  };
}

describe("cover stylization on a D1 binding", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
    userId = (await db.user.create({ data: { email: "stylize-d1@example.com", username: "stylize_d1" } })).id;
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("marks a cover processing then succeeded, one batch each, as the Prisma path does", async () => {
    const viaPrisma = await seed("prisma");
    const viaD1 = await seed("d1");

    await stylize(viaPrisma, null);
    const before = d1.roundTrips();
    await stylize(viaD1, d1.binding);

    // Processing, the atomic quota claim, and succeeded.
    expect(d1.roundTrips() - before).toBe(3);
    expect(await state(viaD1)).toEqual(await state(viaPrisma));
    expect(await state(viaD1)).toMatchObject({
      status: "ready",
      generationStatus: "succeeded",
      stylized: "/photos/covers/1234-<uuid>.png",
      promptAddition: "keep the plate",
      parentCoverId: "set",
      recipeTouched: true,
      cookbookTouched: true,
    });
  });

  it("marks a cover failed with its touches, as the Prisma path does", async () => {
    const viaPrisma = await seed("prisma");
    const viaD1 = await seed("d1");

    await stylize(viaPrisma, null, { runner: runner(true), parentCoverId: undefined });
    await stylize(viaD1, d1.binding, { runner: runner(true), parentCoverId: undefined });

    expect(await state(viaD1)).toEqual(await state(viaPrisma));
    expect(await state(viaD1)).toMatchObject({
      status: "ready",
      generationStatus: "failed",
      failureReason: expect.stringContaining("provider down"),
      parentCoverId: null,
      recipeTouched: true,
    });
  });

  it("marks a cover without an image failed rather than ready", async () => {
    const viaPrisma = await seed("prisma");
    const viaD1 = await seed("d1");
    for (const seeded of [viaPrisma, viaD1]) {
      await db.recipeCover.update({ where: { id: seeded.coverId }, data: { imageUrl: "" } });
    }

    await stylize(viaPrisma, null, { rawPhotoUrl: " " });
    await stylize(viaD1, d1.binding, { rawPhotoUrl: " " });

    expect(await state(viaD1)).toEqual(await state(viaPrisma));
    expect(await state(viaD1)).toMatchObject({ status: "failed", failureReason: "missing_source_image" });
  });

  it("leaves a cover archived after the failure check alone, touching nothing", async () => {
    const seeded = await seed("archived");
    const archive = () => db.recipeCover.update({
      where: { id: seeded.coverId },
      data: { status: "archived", archivedAt: new Date() },
    });

    await stylize(seeded, beforeBatch(1, archive), { rawPhotoUrl: " " });

    expect(await state(seeded)).toMatchObject({
      status: "archived",
      generationStatus: "none",
      failureReason: null,
      archived: true,
      recipeTouched: false,
      cookbookTouched: false,
    });
  });

  it("does not start on a cover archived before the processing update", async () => {
    const seeded = await seed("archived-early");
    const image = runner();
    await db.recipeCover.update({ where: { id: seeded.coverId }, data: { status: "archived", archivedAt: new Date() } });

    await stylize(seeded, d1.binding, { runner: image });

    expect(image.imageToImage).not.toHaveBeenCalled();
    expect(await state(seeded)).toMatchObject({ status: "archived", recipeTouched: false, cookbookTouched: false });
  });

  describe("activation after a successful stylization", () => {
    const TRIGGER = "StylizationD1_injected_failure";

    afterEach(async () => {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${TRIGGER}"`);
    });

    async function activation(seeded: Awaited<ReturnType<typeof seed>>) {
      const recipe = await db.recipe.findUniqueOrThrow({ where: { id: seeded.recipeId } });
      return {
        active: recipe.activeCoverId === null
          ? null
          : recipe.activeCoverId === seeded.coverId ? "stylized cover" : "other cover",
        activeCoverVariant: recipe.activeCoverVariant,
        coverMode: recipe.coverMode,
      };
    }

    /** Another cover on the recipe, made its active cover with the given fields. */
    async function activeCover(seeded: Awaited<ReturnType<typeof seed>>, fields: Record<string, unknown>, variant: string | null) {
      const cover = await db.recipeCover.create({
        data: { recipeId: seeded.recipeId, imageUrl: "https://stub.test/other.png", sourceType: "chef-upload", ...fields },
      });
      await db.recipe.update({
        where: { id: seeded.recipeId },
        data: { activeCoverId: cover.id, activeCoverVariant: variant, updatedAt: OLD },
      });
      return cover.id;
    }

    it("marks the cover succeeded and activates it in one batch, or neither", async () => {
      const seeded = await seed("injected");
      await db.$executeRawUnsafe(`CREATE TRIGGER "${TRIGGER}" BEFORE UPDATE ON "Recipe"
        WHEN NEW."activeCoverId" = '${seeded.coverId}' AND OLD."activeCoverId" IS NOT NEW."activeCoverId"
        BEGIN SELECT RAISE(ABORT, 'stylization_injected_failure'); END`);

      await stylize(seeded, d1.binding, { suppressAutoActivation: false });

      // The success mark was rolled back with the failed activation, so no stylized image is
      // recorded on a cover marked failed; the recipe keeps its cover.
      expect(await state(seeded)).toMatchObject({ stylized: null, generationStatus: "failed" });
      expect((await state(seeded)).failureReason).toContain("stylization_injected_failure");
      expect(await activation(seeded)).toMatchObject({ active: null });

      await db.$executeRawUnsafe(`DROP TRIGGER "${TRIGGER}"`);
      await stylize(seeded, d1.binding, { suppressAutoActivation: false });
      expect(await state(seeded)).toMatchObject({ status: "ready", generationStatus: "succeeded", cookbookTouched: true });
      expect(await activation(seeded)).toEqual({ active: "stylized cover", activeCoverVariant: "stylized", coverMode: "auto" });
    });

    it("auto-activates on D1 exactly when the Prisma path does", async () => {
      const scenarios: Array<[string, (seeded: Awaited<ReturnType<typeof seed>>) => Promise<unknown>]> = [
        ["no active cover", async () => undefined],
        ["a real active cover", (seeded) => activeCover(seeded, {}, "image")],
        ["a real stylized active cover", (seeded) => activeCover(seeded, { stylizedImageUrl: "https://stub.test/s.png" }, "stylized")],
        ["a real active cover with either variant", (seeded) => activeCover(seeded, {}, null)],
        ["an active placeholder", (seeded) => activeCover(seeded, { sourceType: "ai-placeholder" }, "image")],
        ["an archived active cover", (seeded) => activeCover(seeded, { status: "archived", archivedAt: new Date() }, "image")],
        ["an active cover still processing", (seeded) => activeCover(seeded, { status: "processing" }, "image")],
        ["an active cover without its variant's image", (seeded) => activeCover(seeded, {}, "stylized")],
        ["an active cover with no image at all", (seeded) => activeCover(seeded, { imageUrl: "" }, null)],
        ["a manual recipe", (seeded) => db.recipe.update({ where: { id: seeded.recipeId }, data: { coverMode: "manual", updatedAt: OLD } })],
      ];
      const outcomes: Record<string, unknown> = {};
      for (const [label, arrange] of scenarios) {
        const viaPrisma = await seed(`prisma ${label}`);
        const viaD1 = await seed(`d1 ${label}`);
        await arrange(viaPrisma);
        await arrange(viaD1);

        await stylize(viaPrisma, null, { suppressAutoActivation: false });
        await stylize(viaD1, d1.binding, { suppressAutoActivation: false });

        const prismaActivation = await activation(viaPrisma);
        expect({ label, ...(await activation(viaD1)) }).toEqual({ label, ...prismaActivation });
        outcomes[label] = prismaActivation.active === "stylized cover";
      }
      expect(outcomes).toEqual({
        "no active cover": true,
        "a real active cover": false,
        "a real stylized active cover": false,
        "a real active cover with either variant": false,
        "an active placeholder": true,
        "an archived active cover": true,
        "an active cover still processing": true,
        "an active cover without its variant's image": true,
        "an active cover with no image at all": true,
        "a manual recipe": false,
      });
    });

    it("activates a requested cover with its success only while the guard still matches", async () => {
      const guard = { activeCoverId: null, activeCoverVariant: null, coverMode: "auto" };
      const viaPrisma = await seed("prisma");
      const viaD1 = await seed("d1");

      await stylize(viaPrisma, null, { activateWhenReady: true, activationGuard: guard });
      await stylize(viaD1, d1.binding, { activateWhenReady: true, activationGuard: guard });

      expect(await activation(viaD1)).toEqual(await activation(viaPrisma));
      expect(await activation(viaD1)).toEqual({ active: "stylized cover", activeCoverVariant: "stylized", coverMode: "manual" });

      const stale = await seed("stale");
      await db.recipe.update({ where: { id: stale.recipeId }, data: { coverMode: "none", updatedAt: OLD } });
      await stylize(stale, d1.binding, { activateWhenReady: true, activationGuard: guard });
      expect(await activation(stale)).toEqual({ active: null, activeCoverVariant: null, coverMode: "none" });
      expect(await state(stale)).toMatchObject({ status: "ready", generationStatus: "succeeded" });

      const unguarded = await seed("unguarded");
      await stylize(unguarded, d1.binding, { activateWhenReady: true });
      expect(await activation(unguarded)).toEqual({ active: null, activeCoverVariant: null, coverMode: "auto" });
    });

    it("never activates a cover archived after it was marked succeeded (Prisma path)", async () => {
      const auto = await seed("archived-auto");
      const requested = await seed("archived-requested");
      const read = db.recipe.findUnique.bind(db.recipe);
      const archiving = vi.spyOn(db.recipe, "findUnique").mockImplementation((async (args: never) => {
        await db.recipeCover.updateMany({
          where: { id: { in: [auto.coverId, requested.coverId] } },
          data: { status: "archived", archivedAt: new Date() },
        });
        return read(args);
      }) as never);
      const update = db.recipe.updateMany.bind(db.recipe);
      const archivingBeforeRequested = vi.spyOn(db.recipe, "updateMany").mockImplementation((async (args: never) => {
        await db.recipeCover.update({ where: { id: requested.coverId }, data: { status: "archived", archivedAt: new Date() } });
        return update(args);
      }) as never);

      await stylize(auto, null, { suppressAutoActivation: false });
      archiving.mockRestore();
      await stylize(requested, null, {
        activateWhenReady: true,
        activationGuard: { activeCoverId: null, activeCoverVariant: null, coverMode: "auto" },
      });
      archivingBeforeRequested.mockRestore();

      expect(await activation(auto)).toMatchObject({ active: null });
      expect(await activation(requested)).toMatchObject({ active: null, coverMode: "auto" });
    });

    it("does not mark failed, or touch, a cover archived after the failure read (Prisma path)", async () => {
      const seeded = await seed("archived-failure");
      const read = db.recipeCover.findFirst.bind(db.recipeCover);
      const archiving = vi.spyOn(db.recipeCover, "findFirst").mockImplementation((async (args: never) => {
        const cover = await read(args);
        await db.recipeCover.update({ where: { id: seeded.coverId }, data: { status: "archived", archivedAt: new Date() } });
        return cover;
      }) as never);

      await stylize(seeded, null, { rawPhotoUrl: " " });
      archiving.mockRestore();

      expect(await state(seeded)).toMatchObject({
        status: "archived",
        generationStatus: "none",
        failureReason: null,
        recipeTouched: false,
        cookbookTouched: false,
      });
    });
  });
});
