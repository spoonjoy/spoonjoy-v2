import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import { scheduleSpoonCoverStylization } from "~/lib/spoon-cover-stylization.server";
import type { ImageGenRunner } from "~/lib/image-gen.server";
import { cleanupDatabase } from "../helpers/cleanup";

type Database = Awaited<ReturnType<typeof getLocalDb>>;

const GENERATED_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const VALID_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function dataUrl(contentType: string, bytes: Uint8Array): string {
  return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function makeRunner(): ImageGenRunner & { textToImage: ReturnType<typeof vi.fn>; imageToImage: ReturnType<typeof vi.fn> } {
  return {
    textToImage: vi.fn().mockResolvedValue({ bytes: GENERATED_BYTES, contentType: "image/png" }),
    imageToImage: vi.fn().mockResolvedValue({ bytes: GENERATED_BYTES, contentType: "image/png" }),
  };
}

function mockR2(): R2Bucket {
  return {
    put: vi.fn(async () => ({})),
    delete: vi.fn(async () => undefined),
    get: vi.fn(),
    head: vi.fn(),
    list: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket;
}

function postHogFetchSpy() {
  return vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
}

function postHogBodies(fetchImpl: typeof fetch): Array<{ event: string; distinct_id: string; properties: Record<string, unknown> }> {
  return (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([, init]) =>
    JSON.parse(init.body as string),
  );
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
    const bucket = mockR2();
    await scheduleSpoonCoverStylization({
      db,
      userId,
      recipeId,
      coverId,
      rawPhotoUrl: dataUrl("image/png", VALID_PNG_BYTES),
      recipeTitle: "Stylize Me",
      runner,
      bucket,
      now: () => 1234,
      logger: errorSpy,
    });
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.stylizedImageUrl).toMatch(/^\/photos\/covers\/1234-[a-f0-9-]+\.png$/);
    expect(bucket.put).toHaveBeenCalledWith(
      cover.stylizedImageUrl!.replace("/photos/", ""),
      GENERATED_BYTES,
      expect.objectContaining({ httpMetadata: { contentType: "image/png" } }),
    );
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
    const analyticsFetchImpl = postHogFetchSpy();
    await scheduleSpoonCoverStylization({
      db,
      userId,
      recipeId,
      coverId,
      rawPhotoUrl: dataUrl("image/png", VALID_PNG_BYTES),
      recipeTitle: "Stylize Me",
      runner,
      now: () => fixed.getTime(),
      postHogConfig: { enabled: true, key: "ph_test", host: "https://posthog.example" },
      analyticsFetchImpl,
      logger: errorSpy,
    });
    expect(runner.imageToImage).not.toHaveBeenCalled();
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.stylizedImageUrl).toBeNull();
    expect(postHogBodies(analyticsFetchImpl)).toEqual([
      expect.objectContaining({
        event: "spoonjoy.image_generation.skipped",
        distinct_id: userId,
        properties: expect.objectContaining({
          feature: "recipe_image_generation",
          operation: "cover_stylize",
          recipeId,
          coverId,
          sourceType: "spoon",
          quotaKind: "stylization",
          model: "none",
          reason: "quota_exhausted",
        }),
      }),
    ]);
  });

  it("returns silently when no runner is available and OPENAI_API_KEY is absent", async () => {
    const analyticsFetchImpl = postHogFetchSpy();
    await scheduleSpoonCoverStylization({
      db,
      userId,
      recipeId,
      coverId,
      rawPhotoUrl: dataUrl("image/png", VALID_PNG_BYTES),
      recipeTitle: "Stylize Me",
      env: {},
      sourceType: "chef-upload",
      postHogConfig: { enabled: true, key: "ph_test", host: "https://posthog.example" },
      analyticsFetchImpl,
      logger: errorSpy,
    });
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.stylizedImageUrl).toBeNull();
    await expect(
      db.imageGenLedger.count({ where: { userId, kind: "stylization" } }),
    ).resolves.toBe(0);
    expect(postHogBodies(analyticsFetchImpl)).toEqual([
      expect.objectContaining({
        event: "spoonjoy.image_generation.skipped",
        distinct_id: userId,
        properties: expect.objectContaining({
          feature: "recipe_image_generation",
          operation: "cover_stylize",
          recipeId,
          coverId,
          sourceType: "chef-upload",
          quotaKind: "stylization",
          model: "none",
          reason: "missing_openai_key",
        }),
      }),
    ]);
  });

  it("returns silently when the OpenAI runner factory returns null", async () => {
    const analyticsFetchImpl = postHogFetchSpy();
    await scheduleSpoonCoverStylization({
      db,
      userId,
      recipeId,
      coverId,
      rawPhotoUrl: dataUrl("image/png", VALID_PNG_BYTES),
      recipeTitle: "Stylize Me",
      env: { OPENAI_API_KEY: "sk-test" },
      createRunner: () => null,
      postHogConfig: { enabled: true, key: "ph_test", host: "https://posthog.example" },
      analyticsFetchImpl,
      logger: errorSpy,
    });
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.stylizedImageUrl).toBeNull();
    await expect(
      db.imageGenLedger.count({ where: { userId, kind: "stylization" } }),
    ).resolves.toBe(0);
    expect(postHogBodies(analyticsFetchImpl)).toEqual([
      expect.objectContaining({
        event: "spoonjoy.image_generation.skipped",
        distinct_id: userId,
        properties: expect.objectContaining({
          feature: "recipe_image_generation",
          operation: "cover_stylize",
          recipeId,
          coverId,
          sourceType: "spoon",
          quotaKind: "stylization",
          model: "none",
          reason: "missing_runner",
        }),
      }),
    ]);
  });

  it("logs errors and leaves stylizedImageUrl null when the runner throws", async () => {
    const analyticsFetchImpl = postHogFetchSpy();
    const runner: ImageGenRunner = {
      textToImage: vi.fn().mockRejectedValue(new Error("text failed")),
      imageToImage: vi.fn().mockRejectedValue(new Error("img failed")),
    };
    await scheduleSpoonCoverStylization({
      db,
      userId,
      recipeId,
      coverId,
      rawPhotoUrl: dataUrl("image/png", VALID_PNG_BYTES),
      recipeTitle: "Stylize Me",
      runner,
      postHogConfig: { enabled: true, key: "ph_test", host: "https://posthog.example" },
      analyticsFetchImpl,
      logger: errorSpy,
    });
    expect(errorSpy.error).toHaveBeenCalled();
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.stylizedImageUrl).toBeNull();
    expect(postHogBodies(analyticsFetchImpl)).toEqual([
      expect.objectContaining({
        event: "$exception",
        distinct_id: userId,
        properties: expect.objectContaining({
          $exception_message: "Stylization failed",
          feature: "recipe_image_generation",
          operation: "cover_stylize",
          recipeId,
          coverId,
          sourceType: "spoon",
          quotaKind: "stylization",
          model: "gpt-image-1",
        }),
      }),
    ]);
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
        recipeId,
        coverId,
        rawPhotoUrl: dataUrl("image/png", VALID_PNG_BYTES),
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
      recipeId,
      coverId,
      rawPhotoUrl: dataUrl("image/png", VALID_PNG_BYTES),
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
        recipeId,
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
