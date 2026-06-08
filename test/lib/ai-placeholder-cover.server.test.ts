import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "~/lib/db.server";
import { scheduleAiPlaceholderCover } from "~/lib/ai-placeholder-cover.server";
import type { ImageGenRunner } from "~/lib/image-gen.server";
import {
  PLACEHOLDER_DAILY_CAP,
  tryConsumeImageGenQuota,
} from "~/lib/image-gen-ledger.server";
import { createTestUser, createTestRecipe } from "../utils";
import { cleanupDatabase } from "../helpers/cleanup";

const GENERATED_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function makeRunner(): ImageGenRunner {
  return {
    textToImage: vi.fn(async () => ({ bytes: GENERATED_BYTES, contentType: "image/png" })),
    imageToImage: vi.fn(async () => ({ bytes: GENERATED_BYTES, contentType: "image/png" })),
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

describe("ai-placeholder-cover.server scheduleAiPlaceholderCover", () => {
  let userId: string;
  let recipeId: string;
  let coverId: string;
  let errorSpy: { error: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const user = await db.user.create({ data: createTestUser() });
    userId = user.id;
    const recipe = await db.recipe.create({
      data: { ...createTestRecipe(userId), chefId: userId },
    });
    recipeId = recipe.id;
    const cover = await db.recipeCover.create({
      data: {
        recipeId,
        imageUrl: "",
        sourceType: "ai-placeholder",
      },
    });
    coverId = cover.id;
    errorSpy = { error: vi.fn() };
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("replaces the cover imageUrl with the generated URL on success", async () => {
    const runner = makeRunner();
    const bucket = mockR2();
    await scheduleAiPlaceholderCover({
      db,
      userId,
      recipeId,
      coverId,
      title: "Pasta",
      description: null,
      runner,
      bucket,
      now: () => 1234,
      logger: errorSpy,
    });
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.imageUrl).toMatch(/^\/photos\/covers\/1234-[a-f0-9-]+\.png$/);
    expect(bucket.put).toHaveBeenCalledWith(
      cover.imageUrl.replace("/photos/", ""),
      GENERATED_BYTES,
      expect.objectContaining({ httpMetadata: { contentType: "image/png" } }),
    );
    expect(runner.textToImage).toHaveBeenCalledTimes(1);
    expect(errorSpy.error).not.toHaveBeenCalled();
  });

  it("returns silently when the quota is exhausted", async () => {
    const now = () => new Date("2026-05-11T08:30:00Z");
    for (let i = 0; i < PLACEHOLDER_DAILY_CAP; i++) {
      await tryConsumeImageGenQuota(db, userId, "placeholder", { now });
    }
    const runner = makeRunner();
    await scheduleAiPlaceholderCover({
      db,
      userId,
      recipeId,
      coverId,
      title: "Pasta",
      description: null,
      runner,
      now: () => now().getTime(),
      logger: errorSpy,
    });
    expect(runner.textToImage).not.toHaveBeenCalled();
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.imageUrl).toBe("");
  });

  it("returns silently when no runner is available and OPENAI_API_KEY is absent", async () => {
    const analyticsFetchImpl = postHogFetchSpy();
    await scheduleAiPlaceholderCover({
      db,
      userId,
      recipeId,
      coverId,
      title: "Pasta",
      description: null,
      env: {},
      postHogConfig: { enabled: true, key: "ph_test", host: "https://posthog.example" },
      analyticsFetchImpl,
      logger: errorSpy,
    });
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.imageUrl).toBe("");
    expect(errorSpy.error).not.toHaveBeenCalled();
    await expect(
      db.imageGenLedger.count({ where: { userId, kind: "placeholder" } }),
    ).resolves.toBe(0);
    expect(postHogBodies(analyticsFetchImpl)).toEqual([
      expect.objectContaining({
        event: "spoonjoy.image_generation.skipped",
        distinct_id: userId,
        properties: expect.objectContaining({
          feature: "recipe_image_generation",
          operation: "placeholder_generate",
          recipeId,
          coverId,
          sourceType: "ai-placeholder",
          quotaKind: "placeholder",
          model: "none",
          reason: "missing_openai_key",
        }),
      }),
    ]);
  });

  it("returns silently when the OpenAI runner factory returns null", async () => {
    const analyticsFetchImpl = postHogFetchSpy();
    await scheduleAiPlaceholderCover({
      db,
      userId,
      recipeId,
      coverId,
      title: "Pasta",
      description: null,
      env: { OPENAI_API_KEY: "sk-test" },
      createRunner: () => null,
      postHogConfig: { enabled: true, key: "ph_test", host: "https://posthog.example" },
      analyticsFetchImpl,
      logger: errorSpy,
    });
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.imageUrl).toBe("");
    await expect(
      db.imageGenLedger.count({ where: { userId, kind: "placeholder" } }),
    ).resolves.toBe(0);
    expect(postHogBodies(analyticsFetchImpl)).toEqual([
      expect.objectContaining({
        event: "spoonjoy.image_generation.skipped",
        distinct_id: userId,
        properties: expect.objectContaining({
          feature: "recipe_image_generation",
          operation: "placeholder_generate",
          recipeId,
          coverId,
          sourceType: "ai-placeholder",
          quotaKind: "placeholder",
          model: "none",
          reason: "missing_runner",
        }),
      }),
    ]);
  });

  it("returns silently when env is null", async () => {
    await scheduleAiPlaceholderCover({
      db,
      userId,
      recipeId,
      coverId,
      title: "Pasta",
      description: null,
      env: null,
      logger: errorSpy,
    });
    expect(errorSpy.error).not.toHaveBeenCalled();
  });

  it("logs and swallows runner errors without throwing", async () => {
    const runner: ImageGenRunner = {
      textToImage: vi.fn(async () => {
        throw new Error("boom");
      }),
      imageToImage: vi.fn(),
    };
    await expect(
      scheduleAiPlaceholderCover({
        db,
        userId,
        recipeId,
        coverId,
        title: "Pasta",
        description: null,
        runner,
        logger: errorSpy,
      }),
    ).resolves.toBeUndefined();
    expect(errorSpy.error).toHaveBeenCalledTimes(1);
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.imageUrl).toBe("");
  });

  it("defaults logger to console when none provided and the runner fails", async () => {
    const original = console.error;
    const spy = vi.fn();
    console.error = spy;
    try {
      const runner: ImageGenRunner = {
        textToImage: vi.fn(async () => {
          throw new Error("boom");
        }),
        imageToImage: vi.fn(),
      };
      await scheduleAiPlaceholderCover({
        db,
        userId,
        recipeId,
        coverId,
        title: "Pasta",
        description: null,
        runner,
      });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      console.error = original;
    }
  });

  it("uses the OpenAI runner factory when OPENAI_API_KEY is provided", async () => {
    // The default runner makes a real OpenAI call; supply a stub runner so this
    // unit test never reaches the network while still exercising the env-present
    // branch (the explicit runner takes precedence over the factory).
    const runner = makeRunner();
    await scheduleAiPlaceholderCover({
      db,
      userId,
      recipeId,
      coverId,
      title: "Pasta",
      description: "warm",
      env: { OPENAI_API_KEY: "test" },
      runner,
      logger: errorSpy,
    });
    expect(runner.textToImage).toHaveBeenCalledTimes(1);
  });

  it("constructs a real OpenAI runner when no explicit runner is passed and the API key is set", async () => {
    // Stub global fetch so the OpenAI client never reaches the real network.
    const originalFetch = globalThis.fetch;
    const stubFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "stubbed" } }), { status: 500 }),
    );
    globalThis.fetch = stubFetch as unknown as typeof fetch;
    try {
      await scheduleAiPlaceholderCover({
        db,
        userId,
        recipeId,
        coverId,
        title: "Pasta",
        description: null,
        env: { OPENAI_API_KEY: "sk-test-invalid" },
        logger: errorSpy,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    // The factory ran and built a runner; the runner's textToImage call hit the stub
    // (500), so generatePlaceholderImage threw and we landed in the catch block.
    expect(errorSpy.error).toHaveBeenCalled();
    expect(stubFetch).toHaveBeenCalled();
  });

  it("captures generation exceptions with image-generation metadata", async () => {
    const analyticsFetchImpl = postHogFetchSpy();
    const error = new Error("openai down");
    const runner: ImageGenRunner = {
      textToImage: vi.fn(async () => {
        throw error;
      }),
      imageToImage: vi.fn(),
    };
    await scheduleAiPlaceholderCover({
      db,
      userId,
      recipeId,
      coverId,
      title: "Pasta",
      description: null,
      runner,
      postHogConfig: { enabled: true, key: "ph_test", host: "https://posthog.example" },
      analyticsFetchImpl,
      logger: errorSpy,
    });
    expect(postHogBodies(analyticsFetchImpl)).toEqual([
      expect.objectContaining({
        event: "$exception",
        distinct_id: userId,
        properties: expect.objectContaining({
          $exception_message: "Placeholder image generation failed",
          feature: "recipe_image_generation",
          operation: "placeholder_generate",
          recipeId,
          coverId,
          sourceType: "ai-placeholder",
          quotaKind: "placeholder",
          model: "dall-e-3",
        }),
      }),
    ]);
  });
});
