import { describe, it, expect, vi } from "vitest";
import {
  IMAGE_FALLBACK_ERROR_CODES,
  ImageGenError,
  composePlaceholderPrompt,
  composeStylizationFallbackPrompt,
  composeStylizationPrompt,
  createOpenAIImageRunner,
  generatePlaceholderImage,
  makeFallbackPlaceholderSvg,
  stylizeSpoonPhoto,
  type ImageGenDeps,
  type ImageGenRunner,
} from "~/lib/image-gen.server";

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

function mockFetchReturning(bytes: Uint8Array): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => bytes.buffer as ArrayBuffer,
  })) as unknown as typeof fetch;
}

function mockRunner(overrides: Partial<ImageGenRunner> = {}): ImageGenRunner {
  return {
    textToImage: vi.fn(async () => ({ url: "https://openai.test/img.png" })),
    imageToImage: vi.fn(async () => ({ url: "https://openai.test/img-edit.png" })),
    ...overrides,
  };
}

describe("image-gen.server prompts and constants", () => {
  it("composes the placeholder prompt verbatim with title + description", () => {
    const prompt = composePlaceholderPrompt("Tomato Soup", "warming and rich");
    expect(prompt).toContain("Warm editorial food photograph of Tomato Soup, warming and rich.");
    expect(prompt).toContain("Plated on cream ceramic with brass-toned cutlery");
    expect(prompt).toContain("No text, no watermarks, no people.");
  });

  it("omits the description clause when description is null", () => {
    const prompt = composePlaceholderPrompt("Tomato Soup", null);
    expect(prompt).toContain("Warm editorial food photograph of Tomato Soup.");
    expect(prompt).not.toContain(", null");
    expect(prompt).not.toContain("Tomato Soup, .");
  });

  it("returns the verbatim stylization prompt", () => {
    expect(composeStylizationPrompt()).toContain(
      "Restyle this photograph as warm editorial cookbook photography",
    );
  });

  it("returns a text-only fallback prompt for DALL-E 3", () => {
    const prompt = composeStylizationFallbackPrompt("Tomato Soup");
    expect(prompt).toContain("Restyle this photograph");
    expect(prompt).toContain("warm editorial cookbook photography");
    expect(prompt).toContain("Tomato Soup");
  });

  it("re-exports the SVG fallback helper", () => {
    const { url } = makeFallbackPlaceholderSvg("X");
    expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  it("declares the OpenAI fallback error codes", () => {
    expect(IMAGE_FALLBACK_ERROR_CODES).toEqual([
      "model_not_found",
      "model_unsupported",
      "404",
    ]);
  });
});

describe("generatePlaceholderImage", () => {
  it("calls textToImage with the composed prompt and the DALL-E 3 model", async () => {
    const runner = mockRunner();
    const deps: ImageGenDeps = {
      env: {},
      runner,
      fetchImpl: mockFetchReturning(new Uint8Array([1, 2, 3])),
      bucket: mockR2(),
      now: () => 12345,
    };
    await generatePlaceholderImage("Pasta", "fresh and bright", deps);
    expect(runner.textToImage).toHaveBeenCalledWith(
      composePlaceholderPrompt("Pasta", "fresh and bright"),
      { model: "dall-e-3" },
    );
  });

  it("uploads bytes to R2 under covers/<timestamp>.png and returns /photos/...", async () => {
    const bucket = mockR2();
    const deps: ImageGenDeps = {
      env: {},
      runner: mockRunner(),
      fetchImpl: mockFetchReturning(new Uint8Array([9, 9, 9])),
      bucket,
      now: () => 4242,
    };
    const url = await generatePlaceholderImage("Cake", null, deps);
    expect(url).toBe("/photos/covers/4242.png");
    expect(bucket.put).toHaveBeenCalledWith(
      "covers/4242.png",
      expect.any(Uint8Array),
      expect.objectContaining({ httpMetadata: { contentType: "image/png" } }),
    );
  });

  it("returns the runner URL directly when bucket is absent", async () => {
    const url = await generatePlaceholderImage("Cake", null, {
      env: {},
      runner: mockRunner({
        textToImage: vi.fn(async () => ({ url: "https://openai.test/direct.png" })),
      }),
    });
    expect(url).toBe("https://openai.test/direct.png");
  });

  it("wraps runner failures in ImageGenError preserving the cause", async () => {
    const cause = new Error("boom");
    const runner = mockRunner({
      textToImage: vi.fn(async () => {
        throw cause;
      }),
    });
    await expect(
      generatePlaceholderImage("X", null, { env: {}, runner }),
    ).rejects.toMatchObject({ name: "ImageGenError", cause });
  });

  it("throws ImageGenError when the bucket fetch returns a non-OK response", async () => {
    const failingFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch;
    await expect(
      generatePlaceholderImage("X", null, {
        env: {},
        runner: mockRunner(),
        fetchImpl: failingFetch,
        bucket: mockR2(),
        now: () => 1,
      }),
    ).rejects.toBeInstanceOf(ImageGenError);
  });
});

describe("stylizeSpoonPhoto", () => {
  it("tries imageToImage with gpt-image-1 first and returns its URL", async () => {
    const runner = mockRunner({
      imageToImage: vi.fn(async () => ({ url: "https://openai.test/stylized.png" })),
    });
    const deps: ImageGenDeps = {
      env: {},
      runner,
      fetchImpl: mockFetchReturning(new Uint8Array([1])),
      bucket: mockR2(),
      now: () => 1,
    };
    await stylizeSpoonPhoto("https://photos.test/raw.jpg", "Tomato Soup", deps);
    expect(runner.imageToImage).toHaveBeenCalledWith(
      "https://photos.test/raw.jpg",
      composeStylizationPrompt(),
      { model: "gpt-image-1" },
    );
  });

  it("falls back to textToImage with DALL-E 3 on a fallback-coded error", async () => {
    const fallbackErr = Object.assign(new Error("nope"), { code: "model_not_found" });
    const runner = mockRunner({
      imageToImage: vi.fn(async () => {
        throw fallbackErr;
      }),
      textToImage: vi.fn(async () => ({ url: "https://openai.test/fallback.png" })),
    });
    const deps: ImageGenDeps = {
      env: {},
      runner,
      fetchImpl: mockFetchReturning(new Uint8Array([2])),
      bucket: mockR2(),
      now: () => 7,
    };
    const result = await stylizeSpoonPhoto("https://photos.test/raw.jpg", "Pasta", deps);
    expect(runner.textToImage).toHaveBeenCalledWith(
      composeStylizationFallbackPrompt("Pasta"),
      { model: "dall-e-3" },
    );
    expect(result.usedModel).toBe("dall-e-3");
    expect(result.url).toBe("/photos/covers/7.png");
  });

  it("returns usedModel=gpt-image-1 when the primary call succeeds", async () => {
    const runner = mockRunner({
      imageToImage: vi.fn(async () => ({ url: "https://openai.test/img.png" })),
    });
    const result = await stylizeSpoonPhoto("https://photos.test/raw.jpg", "X", {
      env: {},
      runner,
      fetchImpl: mockFetchReturning(new Uint8Array([3])),
      bucket: mockR2(),
      now: () => 8,
    });
    expect(result.usedModel).toBe("gpt-image-1");
  });

  it("rethrows as ImageGenError on a non-fallback error", async () => {
    const runner = mockRunner({
      imageToImage: vi.fn(async () => {
        const err = Object.assign(new Error("rate"), { code: "rate_limit" });
        throw err;
      }),
    });
    await expect(
      stylizeSpoonPhoto("https://photos.test/raw.jpg", "X", { env: {}, runner }),
    ).rejects.toBeInstanceOf(ImageGenError);
  });

  it("wraps a fallback failure in ImageGenError", async () => {
    const runner = mockRunner({
      imageToImage: vi.fn(async () => {
        throw Object.assign(new Error("primary"), { code: "model_not_found" });
      }),
      textToImage: vi.fn(async () => {
        throw new Error("fallback failed");
      }),
    });
    await expect(
      stylizeSpoonPhoto("https://photos.test/raw.jpg", "X", { env: {}, runner }),
    ).rejects.toBeInstanceOf(ImageGenError);
  });

  it("returns the runner URL directly when bucket is absent on success", async () => {
    const runner = mockRunner({
      imageToImage: vi.fn(async () => ({ url: "https://openai.test/raw-stylized.png" })),
    });
    const result = await stylizeSpoonPhoto("https://photos.test/raw.jpg", "X", {
      env: {},
      runner,
    });
    expect(result.url).toBe("https://openai.test/raw-stylized.png");
  });
});

describe("createOpenAIImageRunner", () => {
  it("calls client.images.generate for textToImage", async () => {
    const generate = vi.fn(async () => ({ data: [{ url: "https://openai.test/g.png" }] }));
    const runner = createOpenAIImageRunner({
      images: { generate, edit: vi.fn() },
    });
    const result = await runner.textToImage("prompt", { model: "dall-e-3" });
    expect(generate).toHaveBeenCalledWith({
      prompt: "prompt",
      model: "dall-e-3",
      n: 1,
      size: "1024x1024",
    });
    expect(result).toEqual({ url: "https://openai.test/g.png" });
  });

  it("calls client.images.edit for imageToImage and forwards the source URL", async () => {
    const edit = vi.fn(async () => ({ data: [{ url: "https://openai.test/e.png" }] }));
    const runner = createOpenAIImageRunner({
      images: { generate: vi.fn(), edit },
    });
    const result = await runner.imageToImage(
      "https://photos.test/raw.jpg",
      "prompt",
      { model: "gpt-image-1" },
    );
    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({
        image: "https://photos.test/raw.jpg",
        prompt: "prompt",
        model: "gpt-image-1",
      }),
    );
    expect(result).toEqual({ url: "https://openai.test/e.png" });
  });

  it("throws when the OpenAI response contains no URL", async () => {
    const runner = createOpenAIImageRunner({
      images: {
        generate: vi.fn(async () => ({ data: [{}] })),
        edit: vi.fn(),
      },
    });
    await expect(runner.textToImage("p", { model: "dall-e-3" })).rejects.toBeInstanceOf(
      ImageGenError,
    );
  });

  it("treats non-object thrown values as non-fallback errors", async () => {
    const runner = mockRunner({
      imageToImage: vi.fn(async () => {
        // Throw a string (not an object) — must not enter the fallback branch.
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "boom";
      }),
    });
    await expect(
      stylizeSpoonPhoto("https://photos.test/raw.jpg", "X", { env: {}, runner }),
    ).rejects.toBeInstanceOf(ImageGenError);
  });

  it("treats non-string error codes as non-fallback errors", async () => {
    const runner = mockRunner({
      imageToImage: vi.fn(async () => {
        throw Object.assign(new Error("weird"), { code: 404 });
      }),
    });
    await expect(
      stylizeSpoonPhoto("https://photos.test/raw.jpg", "X", { env: {}, runner }),
    ).rejects.toBeInstanceOf(ImageGenError);
  });

  it("falls back to global fetch and Date.now when no overrides are supplied", async () => {
    const originalFetch = globalThis.fetch;
    const originalNow = Date.now;
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([7, 7, 7]).buffer as ArrayBuffer,
    }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const stamp = 999_000;
    Date.now = () => stamp;
    try {
      const bucket = mockR2();
      const url = await generatePlaceholderImage("X", null, {
        env: {},
        runner: mockRunner({
          textToImage: vi.fn(async () => ({ url: "https://openai.test/x.png" })),
        }),
        bucket,
      });
      expect(url).toBe(`/photos/covers/${stamp}.png`);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
      Date.now = originalNow;
    }
  });

  it("throws when imageToImage returns no URL", async () => {
    const runner = createOpenAIImageRunner({
      images: {
        generate: vi.fn(),
        edit: vi.fn(async () => ({ data: [{}] })),
      },
    });
    await expect(
      runner.imageToImage("https://x.test/raw.jpg", "p", { model: "gpt-image-1" }),
    ).rejects.toBeInstanceOf(ImageGenError);
  });
});
