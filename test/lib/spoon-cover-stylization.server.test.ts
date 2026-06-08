import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import {
  resolveImageProviderOrder,
  scheduleSpoonCoverStylization,
} from "~/lib/spoon-cover-stylization.server";
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

  it("returns silently before consuming quota when no image provider config is available", async () => {
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
          reason: "missing_image_provider_config",
        }),
      }),
    ]);
  });

  it("returns silently before consuming quota when env is null", async () => {
    const analyticsFetchImpl = postHogFetchSpy();
    await scheduleSpoonCoverStylization({
      db,
      userId,
      recipeId,
      coverId,
      rawPhotoUrl: dataUrl("image/png", VALID_PNG_BYTES),
      recipeTitle: "Stylize Me",
      env: null,
      postHogConfig: { enabled: true, key: "ph_test", host: "https://posthog.example" },
      analyticsFetchImpl,
      logger: errorSpy,
    });
    await expect(
      db.imageGenLedger.count({ where: { userId, kind: "stylization" } }),
    ).resolves.toBe(0);
    expect(postHogBodies(analyticsFetchImpl)[0].properties).toEqual(
      expect.objectContaining({ reason: "missing_image_provider_config" }),
    );
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

  it("uses a legacy createRunner factory when it returns a runner", async () => {
    const runner = makeRunner();
    await scheduleSpoonCoverStylization({
      db,
      userId,
      recipeId,
      coverId,
      rawPhotoUrl: dataUrl("image/png", VALID_PNG_BYTES),
      recipeTitle: "Stylize Me",
      env: { OPENAI_API_KEY: "sk-test" },
      createRunner: () => runner,
      bucket: mockR2(),
      logger: errorSpy,
    });
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.stylizedImageUrl).toMatch(/^\/photos\/covers\/[0-9]+-[a-f0-9-]+\.png$/);
    expect(runner.imageToImage).toHaveBeenCalledTimes(1);
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
          errorDetails: expect.stringContaining("img failed"),
          feature: "recipe_image_generation",
          operation: "cover_stylize",
          recipeId,
          coverId,
          sourceType: "spoon",
          quotaKind: "stylization",
          model: "gpt-image-2",
          provider: "openai",
          retryable: false,
          fallbackAttempted: false,
        }),
      }),
    ]);
  });

  it("logs nested aggregate errors in serializable form", async () => {
    const analyticsFetchImpl = postHogFetchSpy();
    function nestedCause(depth: number): Error {
      const error = new Error(`level-${depth}`);
      if (depth > 0) {
        (error as Error & { cause?: unknown }).cause = nestedCause(depth - 1);
      }
      return error;
    }
    const aggregate = new AggregateError([
      Object.assign(new Error("inner"), {
        code: "model_not_found",
        status: 404,
        requestID: "req_inner",
        request_id: "req_legacy",
        error: {
          message: "bad model",
          code: "model_not_found",
          type: "invalid_request_error",
        },
        body: { error: { message: "bad model" } },
      }),
      "plain child",
      nestedCause(5),
    ], "aggregate failure");
    const runner: ImageGenRunner = {
      textToImage: vi.fn(),
      imageToImage: vi.fn().mockRejectedValue(aggregate),
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

    const [, payload] = errorSpy.error.mock.calls[0];
    expect(payload).toMatchObject({
      name: "ImageGenError",
      message: "Stylization failed",
      cause: expect.objectContaining({
        name: "ImageProviderAttemptError",
        provider: "openai",
        model: "gpt-image-2",
        retryable: false,
        cause: {
          name: "AggregateError",
          message: "aggregate failure",
          errors: [
            expect.objectContaining({
              name: "Error",
              message: "inner",
              code: "model_not_found",
              status: 404,
              requestID: "req_inner",
              request_id: "req_legacy",
              error: {
                message: "bad model",
                code: "model_not_found",
                type: "invalid_request_error",
              },
              body: { error: { message: "bad model" } },
            }),
            { value: "plain child" },
            expect.objectContaining({ name: "Error", message: "level-5" }),
          ],
        },
      }),
    });
    expect(JSON.stringify(payload)).toContain('"truncated":true');
    const [{ properties }] = postHogBodies(analyticsFetchImpl);
    const errorDetails = JSON.parse(properties.errorDetails as string);
    expect(errorDetails).toMatchObject(payload);
  });

  it("falls back to a configured secondary provider within one consumed quota unit", async () => {
    const fixed = new Date("2026-06-08T12:00:00Z");
    const bucketStart = new Date(
      Date.UTC(fixed.getUTCFullYear(), fixed.getUTCMonth(), fixed.getUTCDate()),
    );
    const analyticsFetchImpl = postHogFetchSpy();
    const openaiRunner: ImageGenRunner = {
      textToImage: vi.fn(),
      imageToImage: vi.fn().mockRejectedValue(Object.assign(new Error("billing"), {
        code: "billing_hard_limit_reached",
        status: 400,
        type: "billing_limit_user_error",
        requestID: "req_openai",
      })),
    };
    const geminiRunner: ImageGenRunner = {
      textToImage: vi.fn(),
      imageToImage: vi.fn().mockResolvedValue({ bytes: GENERATED_BYTES, contentType: "image/png" }),
    };
    await scheduleSpoonCoverStylization({
      db,
      userId,
      recipeId,
      coverId,
      rawPhotoUrl: dataUrl("image/png", VALID_PNG_BYTES),
      recipeTitle: "Stylize Me",
      env: { OPENAI_API_KEY: "sk-test", GOOGLE_API_KEY: "gemini-test" },
      createImageEditAttempts: () => [
        { provider: "openai", model: "gpt-image-2", runner: openaiRunner },
        { provider: "gemini", model: "gemini-3.1-flash-image", runner: geminiRunner },
      ],
      bucket: mockR2(),
      now: () => fixed.getTime(),
      postHogConfig: { enabled: true, key: "ph_test", host: "https://posthog.example" },
      analyticsFetchImpl,
      logger: errorSpy,
    });
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.stylizedImageUrl).toMatch(/^\/photos\/covers\/1780920000000-[a-f0-9-]+\.png$/);
    await expect(
      db.imageGenLedger.findUniqueOrThrow({
        where: {
          userId_kind_bucketStart: {
            userId,
            kind: "stylization",
            bucketStart,
          },
        },
      }),
    ).resolves.toMatchObject({ count: 1 });
    expect(openaiRunner.imageToImage).toHaveBeenCalledTimes(1);
    expect(geminiRunner.imageToImage).toHaveBeenCalledTimes(1);
    expect(postHogBodies(analyticsFetchImpl)).toEqual([
      expect.objectContaining({
        event: "spoonjoy.image_generation.provider_fallback",
        distinct_id: userId,
        properties: expect.objectContaining({
          feature: "recipe_image_generation",
          operation: "cover_stylize",
          recipeId,
          coverId,
          model: "gpt-image-2",
          provider: "openai",
          errorStatus: 400,
          errorCode: "billing_hard_limit_reached",
          errorType: "billing_limit_user_error",
          requestId: "req_openai",
          retryable: true,
          fallbackAttempted: true,
          fallbackProvider: "gemini",
          fallbackModel: "gemini-3.1-flash-image",
          primaryProvider: "openai",
          primaryModel: "gpt-image-2",
          primaryErrorStatus: 400,
          primaryErrorCode: "billing_hard_limit_reached",
          primaryErrorType: "billing_limit_user_error",
          primaryRequestId: "req_openai",
        }),
      }),
    ]);
  });

  it("constructs the default Gemini runner from image provider env", async () => {
    const bucket = mockR2();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              mimeType: "image/png",
              data: Buffer.from(GENERATED_BYTES).toString("base64"),
            },
          }],
        },
      }],
    }))) as unknown as typeof fetch;
    await scheduleSpoonCoverStylization({
      db,
      userId,
      recipeId,
      coverId,
      rawPhotoUrl: dataUrl("image/png", VALID_PNG_BYTES),
      recipeTitle: "Stylize Me",
      env: {
        IMAGE_PROVIDER_PRIMARY: "gemini",
        GOOGLE_API_KEY: "google-test",
        GEMINI_IMAGE_MODEL: "gemini-custom-image",
        GEMINI_IMAGE_TIMEOUT_MS: "45000",
      },
      fetchImpl,
      bucket,
      now: () => 1780920000000,
      logger: errorSpy,
    });
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.stylizedImageUrl).toMatch(/^\/photos\/covers\/1780920000000-[a-f0-9-]+\.png$/);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1/models/gemini-custom-image:generateContent",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-goog-api-key": "google-test" }),
      }),
    );
    expect(bucket.put).toHaveBeenCalled();
  });

  it("uses the default Gemini image model when none is configured", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              mimeType: "image/png",
              data: Buffer.from(GENERATED_BYTES).toString("base64"),
            },
          }],
        },
      }],
    }))) as unknown as typeof fetch;
    await scheduleSpoonCoverStylization({
      db,
      userId,
      recipeId,
      coverId,
      rawPhotoUrl: dataUrl("image/png", VALID_PNG_BYTES),
      recipeTitle: "Stylize Me",
      env: {
        IMAGE_PROVIDER_PRIMARY: "gemini",
        GOOGLE_API_KEY: "google-test",
      },
      fetchImpl,
      bucket: mockR2(),
      logger: errorSpy,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-image:generateContent",
      expect.any(Object),
    );
  });

  it("skips when a custom image edit attempt factory returns null", async () => {
    const analyticsFetchImpl = postHogFetchSpy();
    await scheduleSpoonCoverStylization({
      db,
      userId,
      recipeId,
      coverId,
      rawPhotoUrl: dataUrl("image/png", VALID_PNG_BYTES),
      recipeTitle: "Stylize Me",
      env: { IMAGE_PROVIDER_PRIMARY: "gemini", GOOGLE_API_KEY: "google-test" },
      createImageEditAttempts: () => null,
      postHogConfig: { enabled: true, key: "ph_test", host: "https://posthog.example" },
      analyticsFetchImpl,
      logger: errorSpy,
    });
    expect(postHogBodies(analyticsFetchImpl)[0].properties).toEqual(
      expect.objectContaining({ reason: "missing_image_provider_config" }),
    );
  });

  it("captures normalized provider metadata when all configured providers fail", async () => {
    const analyticsFetchImpl = postHogFetchSpy();
    const openaiRunner: ImageGenRunner = {
      textToImage: vi.fn(),
      imageToImage: vi.fn().mockRejectedValue(Object.assign(new Error("billing"), {
        code: "billing_hard_limit_reached",
        status: 400,
        type: "billing_limit_user_error",
        requestID: "req_openai",
      })),
    };
    const geminiRunner: ImageGenRunner = {
      textToImage: vi.fn(),
      imageToImage: vi.fn().mockRejectedValue(Object.assign(new Error("quota"), {
        code: "RESOURCE_EXHAUSTED",
        status: 429,
        type: "RESOURCE_EXHAUSTED",
        error: { status: "RESOURCE_EXHAUSTED", type: "quota_error", code: 429 },
      })),
    };
    await scheduleSpoonCoverStylization({
      db,
      userId,
      recipeId,
      coverId,
      rawPhotoUrl: dataUrl("image/png", VALID_PNG_BYTES),
      recipeTitle: "Stylize Me",
      env: { OPENAI_API_KEY: "sk-test", GOOGLE_API_KEY: "gemini-test" },
      createImageEditAttempts: () => [
        { provider: "openai", model: "gpt-image-2", runner: openaiRunner },
        { provider: "gemini", model: "gemini-3.1-flash-image", runner: geminiRunner },
      ],
      postHogConfig: { enabled: true, key: "ph_test", host: "https://posthog.example" },
      analyticsFetchImpl,
      logger: errorSpy,
    });
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: coverId } });
    expect(cover.stylizedImageUrl).toBeNull();
    expect(postHogBodies(analyticsFetchImpl)).toEqual([
      expect.objectContaining({
        event: "$exception",
        distinct_id: userId,
        properties: expect.objectContaining({
          feature: "recipe_image_generation",
          operation: "cover_stylize",
          recipeId,
          coverId,
          model: "gemini-3.1-flash-image",
          provider: "gemini",
          errorStatus: 429,
          errorCode: "RESOURCE_EXHAUSTED",
          errorType: "RESOURCE_EXHAUSTED",
          retryable: true,
          fallbackAttempted: true,
          fallbackProvider: "gemini",
          fallbackModel: "gemini-3.1-flash-image",
          primaryProvider: "openai",
          primaryModel: "gpt-image-2",
          primaryErrorStatus: 400,
          primaryErrorCode: "billing_hard_limit_reached",
          primaryErrorType: "billing_limit_user_error",
          primaryRequestId: "req_openai",
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

describe("resolveImageProviderOrder", () => {
  it("defaults to openai then gemini", () => {
    expect(resolveImageProviderOrder({})).toEqual(["openai", "gemini"]);
  });

  it("uses configured primary and fallbacks while ignoring duplicates and unsupported providers", () => {
    expect(resolveImageProviderOrder({
      IMAGE_PROVIDER_PRIMARY: "gemini",
      IMAGE_PROVIDER_FALLBACKS: "bfl, openai, gemini, stability",
    })).toEqual(["gemini", "openai"]);
  });
});
