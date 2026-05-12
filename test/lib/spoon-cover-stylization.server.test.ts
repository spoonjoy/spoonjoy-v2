import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import { scheduleSpoonCoverStylization } from "~/lib/spoon-cover-stylization.server";
import type { ImageGenRunner } from "~/lib/image-gen.server";
import { cleanupDatabase } from "../helpers/cleanup";

type Database = Awaited<ReturnType<typeof getLocalDb>>;

function makeRunner(): ImageGenRunner & { textToImage: ReturnType<typeof vi.fn>; imageToImage: ReturnType<typeof vi.fn> } {
  return {
    textToImage: vi.fn().mockResolvedValue({ url: "https://stub.test/text.png" }),
    imageToImage: vi.fn().mockResolvedValue({ url: "https://stub.test/img.png" }),
  };
}

describe("scheduleSpoonCoverStylization", () => {
  let db: Database;
  let userId: string;
  let recipeId: string;
  let coverId: string;
  let errorSpy: { error: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    const user = await db.user.create({
      data: {
        email: `${faker.string.alphanumeric(10).toLowerCase()}@example.com`,
        username: `u_${faker.string.alphanumeric(10).toLowerCase()}`,
      },
    });
    userId = user.id;
    const recipe = await db.recipe.create({
      data: { title: "Stylize Me", chefId: userId },
    });
    recipeId = recipe.id;
    const cover = await db.recipeCover.create({
      data: {
        recipeId,
        imageUrl: "https://stub.test/raw.png",
        sourceType: "spoon",
      },
    });
    coverId = cover.id;
    errorSpy = { error: vi.fn() };
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("writes stylizedImageUrl on success via the supplied runner", async () => {
    const runner = makeRunner();
    await scheduleSpoonCoverStylization({
      db,
      userId,
      coverId,
      rawPhotoUrl: "https://stub.test/raw.png",
      recipeTitle: "Stylize Me",
      runner,
      logger: errorSpy,
    });
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.stylizedImageUrl).toBe("https://stub.test/img.png");
    expect(runner.imageToImage).toHaveBeenCalledTimes(1);
  });

  it("does nothing when stylization quota is exhausted", async () => {
    // Pin time to a fixed UTC date so the quota bucket is deterministic across CI day boundaries.
    const fixed = new Date("2026-05-11T08:30:00Z");
    const bucketStart = new Date(
      Date.UTC(fixed.getUTCFullYear(), fixed.getUTCMonth(), fixed.getUTCDate()),
    );
    await db.imageGenLedger.create({
      data: { userId, kind: "stylization", bucketStart, count: 50 },
    });
    const runner = makeRunner();
    await scheduleSpoonCoverStylization({
      db,
      userId,
      coverId,
      rawPhotoUrl: "https://stub.test/raw.png",
      recipeTitle: "Stylize Me",
      runner,
      now: () => fixed.getTime(),
      logger: errorSpy,
    });
    expect(runner.imageToImage).not.toHaveBeenCalled();
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.stylizedImageUrl).toBeNull();
  });

  it("returns silently when no runner is available and OPENAI_API_KEY is absent", async () => {
    await scheduleSpoonCoverStylization({
      db,
      userId,
      coverId,
      rawPhotoUrl: "https://stub.test/raw.png",
      recipeTitle: "Stylize Me",
      env: {},
      logger: errorSpy,
    });
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.stylizedImageUrl).toBeNull();
  });

  it("logs errors and leaves stylizedImageUrl null when the runner throws", async () => {
    const runner: ImageGenRunner = {
      textToImage: vi.fn().mockRejectedValue(new Error("text failed")),
      imageToImage: vi.fn().mockRejectedValue(new Error("img failed")),
    };
    await scheduleSpoonCoverStylization({
      db,
      userId,
      coverId,
      rawPhotoUrl: "https://stub.test/raw.png",
      recipeTitle: "Stylize Me",
      runner,
      logger: errorSpy,
    });
    expect(errorSpy.error).toHaveBeenCalled();
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.stylizedImageUrl).toBeNull();
  });

  it("falls back to the default console logger when none is supplied", async () => {
    const original = console.error;
    const spy = vi.fn();
    console.error = spy;
    try {
      const runner: ImageGenRunner = {
        textToImage: vi.fn().mockRejectedValue(new Error("text fail")),
        imageToImage: vi.fn().mockRejectedValue(new Error("img fail")),
      };
      await scheduleSpoonCoverStylization({
        db,
        userId,
        coverId,
        rawPhotoUrl: "https://stub.test/raw.png",
        recipeTitle: "Stylize Me",
        runner,
      });
      expect(spy).toHaveBeenCalled();
    } finally {
      console.error = original;
    }
  });

  it("uses the OpenAI runner factory when OPENAI_API_KEY is provided", async () => {
    const runner = makeRunner();
    await scheduleSpoonCoverStylization({
      db,
      userId,
      coverId,
      rawPhotoUrl: "https://stub.test/raw.png",
      recipeTitle: "Stylize Me",
      env: { OPENAI_API_KEY: "test" },
      runner,
      logger: errorSpy,
    });
    expect(runner.imageToImage).toHaveBeenCalledTimes(1);
  });

  it("constructs a real OpenAI runner when no explicit runner is passed and the API key is set", async () => {
    const originalFetch = globalThis.fetch;
    const stubFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "stubbed" } }), { status: 500 }),
    );
    globalThis.fetch = stubFetch as unknown as typeof fetch;
    try {
      await scheduleSpoonCoverStylization({
        db,
        userId,
        coverId,
        rawPhotoUrl: "https://stub.test/raw.png",
        recipeTitle: "Stylize Me",
        env: { OPENAI_API_KEY: "sk-test-invalid" },
        logger: errorSpy,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(errorSpy.error).toHaveBeenCalled();
    expect(stubFetch).toHaveBeenCalled();
  });
});
