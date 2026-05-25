/**
 * I2 — video dispatcher tests for `importRecipeFromUrl`.
 *
 * Lives in a separate file from `recipe-import.test.ts` to keep blast radius
 * small. Pre-existing I1 tests in `recipe-import.test.ts` continue to cover
 * the web path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { cleanupDatabase } from "../helpers/cleanup";
import {
  importRecipeFromUrl,
  type ImportRecipeDeps,
} from "~/lib/recipe-import.server";
import {
  RecipeLlmError,
  type RecipeLlmRunner,
} from "~/lib/recipe-import-llm.server";
import type { ParsedIngredient } from "~/lib/ingredient-parse.server";

const WEB_FIXTURES_DIR = path.resolve(
  process.cwd(),
  "test/fixtures/recipe-import",
);

const VIDEO_FIXTURES_DIR = path.resolve(
  process.cwd(),
  "test/fixtures/recipe-import/video",
);

async function loadWebFixture(name: string): Promise<string> {
  return readFile(path.join(WEB_FIXTURES_DIR, name), "utf-8");
}

function loadVideoFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(path.join(VIDEO_FIXTURES_DIR, name), "utf-8"),
  );
}

function htmlStreamingResponse(body: string, url = "https://example.com/r"): Response {
  const headers = new Headers([["content-type", "text/html; charset=utf-8"]]);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    url,
    headers,
    body: stream,
  } as unknown as Response;
}

function jsonStreamingResponse(value: unknown, status = 200): Response {
  const headers = new Headers([["content-type", "application/json"]]);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));
      controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    body: stream,
  } as unknown as Response;
}

function statusJsonResponse(status: number): Response {
  const headers = new Headers([["content-type", "application/json"]]);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{}"));
      controller.close();
    },
  });
  return {
    ok: false,
    status,
    headers,
    body: stream,
  } as unknown as Response;
}

function makeIngredientParser(): ImportRecipeDeps["ingredientParser"] {
  return vi.fn(async (text: string): Promise<ParsedIngredient[]> => {
    if (!text.trim()) return [];
    return [{ quantity: 1, unit: "whole", ingredientName: text.trim() }];
  });
}

function makeLlmRunner(
  payload: Partial<{
    title: string;
    description: string | null;
    servings: string | null;
    ingredients: string[];
    steps: string[];
  }> = {},
): RecipeLlmRunner {
  return {
    extract: vi.fn(async () => ({
      title: payload.title ?? "Default Title",
      description: payload.description ?? null,
      servings: payload.servings ?? null,
      ingredients: payload.ingredients ?? [],
      steps: payload.steps ?? [],
    })),
  };
}

async function makeChef() {
  const email = `chef-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
  const username = `user_${faker.string.alphanumeric(8).toLowerCase()}`;
  return createUser(db, email, username, "test-password-1234");
}

function baseDeps(overrides: Partial<ImportRecipeDeps> = {}): ImportRecipeDeps {
  return {
    db,
    env: { OPENAI_API_KEY: "test-key" },
    ingredientParser: makeIngredientParser(),
    llmRunner: makeLlmRunner(),
    ...overrides,
  };
}

/**
 * Sequence fetch impl: first call returns the oEmbed JSON; subsequent calls
 * return a tiny image-bytes response (for thumbnail download via waitUntil).
 */
function videoFetchSequence(
  oembed: Response,
  imageContentType = "image/jpeg",
): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  let call = 0;
  const fetchImpl = vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    calls.push(url);
    call++;
    if (call === 1) return oembed;
    return {
      ok: true,
      status: 200,
      headers: new Headers([["content-type", imageContentType]]),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function mockBucket(): R2Bucket {
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

describe("importRecipeFromUrl — I2 video dispatcher", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });
  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("URL parse + dispatch", () => {
    it("malformed URL → bad-url 400 BEFORE quota consume", async () => {
      const chef = await makeChef();
      await expect(
        importRecipeFromUrl({ url: "not a url", chefId: chef.id }, baseDeps()),
      ).rejects.toMatchObject({ code: "bad-url", status: 400 });
      const ledgerCount = await db.imageGenLedger.count({
        where: { userId: chef.id, kind: "import" },
      });
      expect(ledgerCount).toBe(0);
    });

    it("web URL → fetches the page, not an oEmbed endpoint", async () => {
      const fixture = await loadWebFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const calls: string[] = [];
      const fetchImpl = vi.fn(async (input: unknown) => {
        const url =
          typeof input === "string" ? input : (input as URL).toString();
        calls.push(url);
        return htmlStreamingResponse(fixture, "https://example.com/r");
      }) as unknown as typeof fetch;
      await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl }),
      );
      expect(calls[0]).toBe("https://example.com/r");
      expect(calls[0]).not.toContain("/oembed");
    });

    it("youtube URL → calls oEmbed endpoint, not the page directly", async () => {
      const fixture = loadVideoFixture("youtube-pasta.json");
      const chef = await makeChef();
      const { fetchImpl, calls } = videoFetchSequence(
        jsonStreamingResponse(fixture),
      );
      const llmRunner = makeLlmRunner({
        title: "Pasta",
        ingredients: ["1 lb pasta"],
        steps: ["Boil"],
      });
      await importRecipeFromUrl(
        { url: "https://www.youtube.com/watch?v=abc123", chefId: chef.id },
        baseDeps({ fetchImpl, llmRunner }),
      );
      expect(calls[0]).toContain("youtube.com/oembed");
      expect(calls[0]).toContain(
        encodeURIComponent("https://www.youtube.com/watch?v=abc123"),
      );
    });

    it("tiktok URL → calls TikTok oEmbed endpoint", async () => {
      const fixture = loadVideoFixture("tiktok-dumpling.json");
      const chef = await makeChef();
      const { fetchImpl, calls } = videoFetchSequence(
        jsonStreamingResponse(fixture),
      );
      const llmRunner = makeLlmRunner({
        title: "Dumplings",
        ingredients: ["flour"],
        steps: ["Fold"],
      });
      await importRecipeFromUrl(
        {
          url: "https://www.tiktok.com/@dumpling_chef/video/123",
          chefId: chef.id,
        },
        baseDeps({ fetchImpl, llmRunner }),
      );
      expect(calls[0]).toContain("tiktok.com/oembed");
    });
  });

  describe("Video pipeline → draft", () => {
    it("youtube happy path → confidence=low, source=video-oembed-llm, sourceUrl=input", async () => {
      const fixture = loadVideoFixture("youtube-pasta.json");
      const chef = await makeChef();
      const { fetchImpl } = videoFetchSequence(jsonStreamingResponse(fixture));
      const llmRunner = makeLlmRunner({
        title: "One-Pot Pasta",
        ingredients: ["1 lb pasta"],
        steps: ["Boil"],
      });
      const result = await importRecipeFromUrl(
        { url: "https://www.youtube.com/watch?v=abc123", chefId: chef.id },
        baseDeps({ fetchImpl, llmRunner }),
      );
      expect(result.confidence).toBe("low");
      expect(result.source).toBe("video-oembed-llm");
      const recipe = await db.recipe.findUnique({
        where: { id: result.recipeId! },
      });
      expect(recipe?.sourceUrl).toBe("https://www.youtube.com/watch?v=abc123");
    });

    it("tiktok happy path → confidence=low, source=video-oembed-llm", async () => {
      const fixture = loadVideoFixture("tiktok-dumpling.json");
      const chef = await makeChef();
      const { fetchImpl } = videoFetchSequence(jsonStreamingResponse(fixture));
      const llmRunner = makeLlmRunner({
        title: "Dumplings",
        ingredients: ["flour"],
        steps: ["Fold"],
      });
      const result = await importRecipeFromUrl(
        {
          url: "https://www.tiktok.com/@dumpling_chef/video/123",
          chefId: chef.id,
        },
        baseDeps({ fetchImpl, llmRunner }),
      );
      expect(result.confidence).toBe("low");
      expect(result.source).toBe("video-oembed-llm");
    });

    it("confidence stays low even if LLM yields a rich draft", async () => {
      const fixture = loadVideoFixture("youtube-pasta.json");
      const chef = await makeChef();
      const { fetchImpl } = videoFetchSequence(jsonStreamingResponse(fixture));
      const llmRunner = makeLlmRunner({
        title: "Pasta",
        description: "very detailed",
        servings: "4",
        ingredients: ["1 lb pasta", "2 tbsp olive oil"],
        steps: ["Boil pasta", "Drain", "Serve"],
      });
      const result = await importRecipeFromUrl(
        { url: "https://www.youtube.com/watch?v=abc", chefId: chef.id },
        baseDeps({ fetchImpl, llmRunner }),
      );
      expect(result.confidence).toBe("low");
    });

    it("video pipeline persists ingredients via deps.ingredientParser", async () => {
      const fixture = loadVideoFixture("youtube-pasta.json");
      const chef = await makeChef();
      const { fetchImpl } = videoFetchSequence(jsonStreamingResponse(fixture));
      const llmRunner = makeLlmRunner({
        title: "Pasta",
        ingredients: ["1 lb pasta", "2 tbsp olive oil"],
        steps: ["Boil"],
      });
      const result = await importRecipeFromUrl(
        { url: "https://www.youtube.com/watch?v=abc", chefId: chef.id },
        baseDeps({ fetchImpl, llmRunner }),
      );
      const ingredients = await db.ingredient.findMany({
        where: { recipeId: result.recipeId! },
      });
      expect(ingredients).toHaveLength(2);
    });

    it("video pipeline persists steps as RecipeStep rows", async () => {
      const fixture = loadVideoFixture("youtube-pasta.json");
      const chef = await makeChef();
      const { fetchImpl } = videoFetchSequence(jsonStreamingResponse(fixture));
      const llmRunner = makeLlmRunner({
        title: "Pasta",
        ingredients: ["1 lb pasta"],
        steps: ["Boil water", "Cook pasta", "Drain"],
      });
      const result = await importRecipeFromUrl(
        { url: "https://www.youtube.com/watch?v=abc", chefId: chef.id },
        baseDeps({ fetchImpl, llmRunner }),
      );
      const steps = await db.recipeStep.findMany({
        where: { recipeId: result.recipeId! },
        orderBy: { stepNum: "asc" },
      });
      expect(steps.map((s) => s.description)).toEqual([
        "Boil water",
        "Cook pasta",
        "Drain",
      ]);
    });
  });

  describe("Empty title", () => {
    it("video LLM returns empty title → no-content 422", async () => {
      const fixture = loadVideoFixture("youtube-pasta.json");
      const chef = await makeChef();
      const { fetchImpl } = videoFetchSequence(jsonStreamingResponse(fixture));
      const llmRunner = makeLlmRunner({ title: "" });
      await expect(
        importRecipeFromUrl(
          { url: "https://www.youtube.com/watch?v=abc", chefId: chef.id },
          baseDeps({ fetchImpl, llmRunner }),
        ),
      ).rejects.toMatchObject({ code: "no-content", status: 422 });
    });

    it("video LLM returns whitespace-only title → no-content 422", async () => {
      const fixture = loadVideoFixture("youtube-pasta.json");
      const chef = await makeChef();
      const { fetchImpl } = videoFetchSequence(jsonStreamingResponse(fixture));
      const llmRunner = makeLlmRunner({ title: "   " });
      await expect(
        importRecipeFromUrl(
          { url: "https://www.youtube.com/watch?v=abc", chefId: chef.id },
          baseDeps({ fetchImpl, llmRunner }),
        ),
      ).rejects.toMatchObject({ code: "no-content", status: 422 });
    });
  });

  describe("Error mapping", () => {
    it("OEmbedError(oembed-failed) → oembed-failed 502 (5xx from oEmbed)", async () => {
      const chef = await makeChef();
      const { fetchImpl } = videoFetchSequence(statusJsonResponse(500));
      await expect(
        importRecipeFromUrl(
          { url: "https://www.youtube.com/watch?v=abc", chefId: chef.id },
          baseDeps({ fetchImpl }),
        ),
      ).rejects.toMatchObject({ code: "oembed-failed", status: 502 });
    });

    it("OEmbedError(video-unavailable) → video-unavailable 502 (4xx from oEmbed)", async () => {
      const chef = await makeChef();
      const { fetchImpl } = videoFetchSequence(statusJsonResponse(404));
      await expect(
        importRecipeFromUrl(
          { url: "https://www.youtube.com/watch?v=missing", chefId: chef.id },
          baseDeps({ fetchImpl }),
        ),
      ).rejects.toMatchObject({ code: "video-unavailable", status: 502 });
    });

    it("RecipeLlmError from video path → llm-failed 502", async () => {
      const fixture = loadVideoFixture("youtube-pasta.json");
      const chef = await makeChef();
      const { fetchImpl } = videoFetchSequence(jsonStreamingResponse(fixture));
      const llmRunner: RecipeLlmRunner = {
        extract: vi.fn(async () => {
          throw new RecipeLlmError("boom");
        }),
      };
      await expect(
        importRecipeFromUrl(
          { url: "https://www.youtube.com/watch?v=abc", chefId: chef.id },
          baseDeps({ fetchImpl, llmRunner }),
        ),
      ).rejects.toMatchObject({ code: "llm-failed", status: 502 });
    });

    it("video path with missing llmRunner → llm-failed 502", async () => {
      const fixture = loadVideoFixture("youtube-pasta.json");
      const chef = await makeChef();
      const { fetchImpl } = videoFetchSequence(jsonStreamingResponse(fixture));
      await expect(
        importRecipeFromUrl(
          { url: "https://www.youtube.com/watch?v=abc", chefId: chef.id },
          baseDeps({ env: null, fetchImpl, llmRunner: undefined }),
        ),
      ).rejects.toMatchObject({ code: "llm-failed", status: 502 });
    });

    it("video path creates a default LLM runner from env when one is not injected", async () => {
      const fixture = loadVideoFixture("youtube-pasta.json");
      const chef = await makeChef();
      const { fetchImpl } = videoFetchSequence(jsonStreamingResponse(fixture));
      const llmRunner = makeLlmRunner({
        title: "Factory Video Pasta",
        description: "A video import wiring check.",
        servings: "4",
        ingredients: ["1 cup tomatoes"],
        steps: ["Simmer the sauce."],
      });
      const createLlmRunner = vi.fn(() => llmRunner);
      const result = await importRecipeFromUrl(
        { url: "https://www.youtube.com/watch?v=abc", chefId: chef.id, dryRun: true },
        baseDeps({ fetchImpl, llmRunner: undefined, createLlmRunner }),
      );

      expect(createLlmRunner).toHaveBeenCalledWith({ OPENAI_API_KEY: "test-key" });
      expect(llmRunner.extract).toHaveBeenCalled();
      expect(result).toMatchObject({
        recipeId: null,
        confidence: "low",
        source: "video-oembed-llm",
        recipe: {
          title: "Factory Video Pasta",
          ingredients: ["1 cup tomatoes"],
          steps: ["Simmer the sauce."],
        },
      });
    });

    it("video path wraps a generic fetch failure as oembed-failed", async () => {
      const chef = await makeChef();
      const fetchImpl = vi.fn(async () => {
        throw new TypeError("network down");
      }) as unknown as typeof fetch;
      await expect(
        importRecipeFromUrl(
          { url: "https://www.youtube.com/watch?v=abc", chefId: chef.id },
          baseDeps({ fetchImpl, llmRunner: undefined }),
        ),
      ).rejects.toMatchObject({ code: "oembed-failed", status: 502 });
    });

    it("video path re-throws non-RecipeLlmError from LLM", async () => {
      const fixture = loadVideoFixture("youtube-pasta.json");
      const chef = await makeChef();
      const { fetchImpl } = videoFetchSequence(jsonStreamingResponse(fixture));
      const llmRunner: RecipeLlmRunner = {
        extract: vi.fn(async () => {
          throw new TypeError("strange failure");
        }),
      };
      await expect(
        importRecipeFromUrl(
          { url: "https://www.youtube.com/watch?v=abc", chefId: chef.id },
          baseDeps({ fetchImpl, llmRunner }),
        ),
      ).rejects.toBeInstanceOf(TypeError);
    });
  });

  describe("Cover scheduling on video", () => {
    it("youtube with thumbnailUrl → schedules cover upload sourceType=import", async () => {
      const fixture = loadVideoFixture("youtube-pasta.json");
      const chef = await makeChef();
      const { fetchImpl } = videoFetchSequence(jsonStreamingResponse(fixture));
      const llmRunner = makeLlmRunner({
        title: "Pasta",
        ingredients: ["1 lb pasta"],
        steps: ["Boil"],
      });
      const result = await importRecipeFromUrl(
        { url: "https://www.youtube.com/watch?v=abc", chefId: chef.id },
        baseDeps({ fetchImpl, llmRunner, bucket: mockBucket() }),
      );
      expect(result.coverPending).toBe(true);
      const covers = await db.recipeCover.findMany({
        where: { recipeId: result.recipeId! },
      });
      expect(covers).toHaveLength(1);
      expect(covers[0].sourceType).toBe("import");
    });

    it("tiktok with thumbnailUrl=null + imageGenRunner present → schedules ai-placeholder", async () => {
      const fixture = loadVideoFixture("tiktok-minimal.json");
      const chef = await makeChef();
      let call = 0;
      const fetchImpl = vi.fn(async () => {
        call++;
        if (call === 1) return jsonStreamingResponse(fixture);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as unknown as Response;
      }) as unknown as typeof fetch;
      const llmRunner = makeLlmRunner({
        title: "Dumplings",
        ingredients: ["flour"],
        steps: ["Fold"],
      });
      const imageGenRunner = {
        textToImage: vi.fn(async () => ({ url: "https://gen.example.com/p.png" })),
        imageToImage: vi.fn(async () => ({ url: "" })),
      };
      const waitUntil = vi.fn();
      const result = await importRecipeFromUrl(
        { url: "https://www.tiktok.com/@x/video/1", chefId: chef.id },
        baseDeps({
          fetchImpl,
          llmRunner,
          bucket: mockBucket(),
          imageGenRunner,
          waitUntil,
        }),
      );
      expect(result.coverPending).toBe(true);
      await waitUntil.mock.calls[0][0];
      const covers = await db.recipeCover.findMany({
        where: { recipeId: result.recipeId! },
      });
      expect(covers).toHaveLength(1);
      expect(covers[0].sourceType).toBe("ai-placeholder");
    });

    it("youtube with thumbnailUrl=null and imageGenRunner=undefined → no cover scheduled", async () => {
      const fixture = loadVideoFixture("youtube-no-thumbnail.json");
      const chef = await makeChef();
      const { fetchImpl } = videoFetchSequence(jsonStreamingResponse(fixture));
      const llmRunner = makeLlmRunner({
        title: "Pasta",
        ingredients: ["1 lb pasta"],
        steps: ["Boil"],
      });
      const result = await importRecipeFromUrl(
        { url: "https://www.youtube.com/watch?v=abc", chefId: chef.id },
        baseDeps({ fetchImpl, llmRunner, bucket: mockBucket() }),
      );
      expect(result.coverPending).toBe(false);
      const covers = await db.recipeCover.findMany({
        where: { recipeId: result.recipeId! },
      });
      expect(covers).toHaveLength(0);
    });
  });

  describe("Quota / existing / dry-run on video", () => {
    it("youtube import consumes ImageGenLedger kind=import", async () => {
      const fixture = loadVideoFixture("youtube-pasta.json");
      const chef = await makeChef();
      const { fetchImpl } = videoFetchSequence(jsonStreamingResponse(fixture));
      const llmRunner = makeLlmRunner({
        title: "Pasta",
        ingredients: ["1 lb pasta"],
        steps: ["Boil"],
      });
      await importRecipeFromUrl(
        { url: "https://www.youtube.com/watch?v=abc", chefId: chef.id },
        baseDeps({ fetchImpl, llmRunner }),
      );
      const ledger = await db.imageGenLedger.findMany({
        where: { userId: chef.id, kind: "import" },
      });
      expect(ledger).toHaveLength(1);
      expect(ledger[0].count).toBe(1);
    });

    it("video URL hitting quota → rate-limited 429", async () => {
      const chef = await makeChef();
      const now = new Date(Date.UTC(2026, 4, 11, 12, 0));
      const bucketStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      await db.imageGenLedger.create({
        data: { userId: chef.id, kind: "import", bucketStart, count: 50 },
      });
      await expect(
        importRecipeFromUrl(
          { url: "https://www.youtube.com/watch?v=abc", chefId: chef.id },
          baseDeps({ now: () => now }),
        ),
      ).rejects.toMatchObject({ code: "rate-limited", status: 429 });
    });

    it("dryRun on youtube → returns draft, no quota, no persistence", async () => {
      const chef = await makeChef();
      const fixture = loadVideoFixture("youtube-pasta.json");
      const { fetchImpl } = videoFetchSequence(jsonStreamingResponse(fixture));
      const llmRunner = makeLlmRunner({
        title: "Pasta",
        ingredients: ["1 lb pasta"],
        steps: ["Boil"],
      });
      const result = await importRecipeFromUrl(
        {
          url: "https://www.youtube.com/watch?v=abc",
          chefId: chef.id,
          dryRun: true,
        },
        baseDeps({ fetchImpl, llmRunner }),
      );
      expect(result.recipeId).toBeNull();
      expect(result.confidence).toBe("low");
      expect(result.source).toBe("video-oembed-llm");
      const ledger = await db.imageGenLedger.count({
        where: { userId: chef.id, kind: "import" },
      });
      expect(ledger).toBe(0);
      const recipeCount = await db.recipe.count({ where: { chefId: chef.id } });
      expect(recipeCount).toBe(0);
    });

    it("youtube URL where same chef already imported same sourceUrl → existingRecipeId set", async () => {
      const fixture = loadVideoFixture("youtube-pasta.json");
      const chef = await makeChef();
      const existing = await db.recipe.create({
        data: {
          title: "Previously Imported",
          chefId: chef.id,
          sourceUrl: "https://www.youtube.com/watch?v=abc",
        },
      });
      const { fetchImpl } = videoFetchSequence(jsonStreamingResponse(fixture));
      const llmRunner = makeLlmRunner({
        title: "Pasta v2",
        ingredients: ["1 lb pasta"],
        steps: ["Boil"],
      });
      const result = await importRecipeFromUrl(
        { url: "https://www.youtube.com/watch?v=abc", chefId: chef.id },
        baseDeps({ fetchImpl, llmRunner }),
      );
      expect(result.existingRecipeId).toBe(existing.id);
    });
  });

  describe("Title-collision regression on video", () => {
    it("video draft title collides → retries with (imported) suffix", async () => {
      const fixture = loadVideoFixture("youtube-pasta.json");
      const chef = await makeChef();
      await db.recipe.create({
        data: { title: "Pasta", chefId: chef.id },
      });
      const { fetchImpl } = videoFetchSequence(jsonStreamingResponse(fixture));
      const llmRunner = makeLlmRunner({
        title: "Pasta",
        ingredients: ["1 lb pasta"],
        steps: ["Boil"],
      });
      const result = await importRecipeFromUrl(
        { url: "https://www.youtube.com/watch?v=abc", chefId: chef.id },
        baseDeps({ fetchImpl, llmRunner }),
      );
      const recipe = await db.recipe.findUnique({
        where: { id: result.recipeId! },
      });
      expect(recipe?.title).toBe("Pasta (imported)");
    });
  });

  describe("Web-path regression smoke test", () => {
    it("existing nyt-style-jsonld fixture still produces confidence=high source=json-ld", async () => {
      const fixture = await loadWebFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const calls: string[] = [];
      const fetchImpl = vi.fn(async (input: unknown) => {
        const url =
          typeof input === "string" ? input : (input as URL).toString();
        calls.push(url);
        return htmlStreamingResponse(fixture, "https://example.com/r");
      }) as unknown as typeof fetch;
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl }),
      );
      expect(result.confidence).toBe("high");
      expect(result.source).toBe("json-ld");
    });
  });
});
