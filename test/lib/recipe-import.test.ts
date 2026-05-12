import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { cleanupDatabase } from "../helpers/cleanup";
import {
  ImportRecipeError,
  importRecipeFromUrl,
  type ImportRecipeDeps,
} from "~/lib/recipe-import.server";
import type { RecipeLlmRunner } from "~/lib/recipe-import-llm.server";
import type { ParsedIngredient } from "~/lib/ingredient-parse.server";

const FIXTURES_DIR = path.resolve(
  process.cwd(),
  "test/fixtures/recipe-import",
);

async function loadFixture(name: string): Promise<string> {
  return readFile(path.join(FIXTURES_DIR, name), "utf-8");
}

function streamingResponse(
  body: string,
  init: { status?: number; contentType?: string; url?: string } = {},
): Response {
  const status = init.status ?? 200;
  const contentType = init.contentType ?? "text/html; charset=utf-8";
  const url = init.url ?? "https://example.com/r";
  const headers = new Headers();
  headers.set("content-type", contentType);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers,
    body: stream,
  } as unknown as Response;
}

function makeFetchImpl(fixtureHtml: string, finalUrl = "https://example.com/r"): typeof fetch {
  return vi.fn(async () =>
    streamingResponse(fixtureHtml, { url: finalUrl }),
  ) as unknown as typeof fetch;
}

function makeIngredientParser(): ImportRecipeDeps["ingredientParser"] {
  // Deterministic: yields one parsed ingredient per input string.
  return vi.fn(async (text: string): Promise<ParsedIngredient[]> => {
    if (!text.trim()) return [];
    return [
      {
        quantity: 1,
        unit: "whole",
        ingredientName: text.trim(),
      },
    ];
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
      title: payload.title ?? "",
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

describe("importRecipeFromUrl — extraction paths", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });
  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("JSON-LD happy path", () => {
    it("returns confidence=high and source=json-ld for pure JSON-LD page", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture) }),
      );
      expect(result.confidence).toBe("high");
      expect(result.source).toBe("json-ld");
    });

    it("persists Recipe with sourceUrl set to input URL", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture) }),
      );
      const recipe = await db.recipe.findUnique({ where: { id: result.recipeId! } });
      expect(recipe?.sourceUrl).toBe("https://example.com/r");
    });

    it("persists title, description, servings from JSON-LD", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture) }),
      );
      const recipe = await db.recipe.findUnique({ where: { id: result.recipeId! } });
      expect(recipe?.title).toBe("Pasta al Limone");
      expect(recipe?.description).toBe("Bright, lemony pasta with butter and cheese.");
      expect(recipe?.servings).toBe("4 servings");
    });

    it("persists RecipeStep + Ingredient rows from JSON-LD", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture) }),
      );
      const steps = await db.recipeStep.findMany({
        where: { recipeId: result.recipeId! },
        orderBy: { stepNum: "asc" },
      });
      expect(steps).toHaveLength(3);
      const ingredients = await db.ingredient.findMany({
        where: { recipeId: result.recipeId! },
      });
      // 3 ingredients in the JSON-LD; ingredientParser returns 1 per string.
      expect(ingredients).toHaveLength(3);
    });

    it("returns formatted recipe + recipeId on success", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture) }),
      );
      expect(result.recipeId).toBeTruthy();
      expect(result.recipe).not.toBeNull();
      expect((result.recipe as { title: string }).title).toBe("Pasta al Limone");
    });

    it("jsonld-howtosection fixture flattens nested instructions, confidence stays high", async () => {
      const fixture = await loadFixture("jsonld-howtosection.html");
      const chef = await makeChef();
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture) }),
      );
      expect(result.confidence).toBe("high");
      const steps = await db.recipeStep.findMany({
        where: { recipeId: result.recipeId! },
        orderBy: { stepNum: "asc" },
      });
      expect(steps).toHaveLength(4);
    });
  });

  describe("Multi-Recipe", () => {
    it("multi-Recipe JSON-LD page → first wins, confidence=medium, source=json-ld", async () => {
      const fixture = await loadFixture("jsonld-multiple-recipes.html");
      const chef = await makeChef();
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture) }),
      );
      expect(result.confidence).toBe("medium");
      expect(result.source).toBe("json-ld");
      const recipe = await db.recipe.findUnique({ where: { id: result.recipeId! } });
      expect(recipe?.title).toBe("Salt Cookies");
    });
  });

  describe("LLM fallback", () => {
    it("no JSON-LD + readable body → calls llmRunner, confidence=low, source=llm", async () => {
      const fixture = await loadFixture("no-jsonld-rich-html.html");
      const chef = await makeChef();
      const llmRunner = makeLlmRunner({
        title: "Grandma's Chocolate Cake",
        description: "Family recipe.",
        servings: "12",
        ingredients: ["2 cups flour", "2 cups sugar"],
        steps: ["Mix.", "Bake."],
      });
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture), llmRunner }),
      );
      expect(result.confidence).toBe("low");
      expect(result.source).toBe("llm");
      expect(llmRunner.extract).toHaveBeenCalled();
    });

    it("thin/empty body + LLM returns empty → throws ImportRecipeError no-content", async () => {
      const fixture = await loadFixture("no-jsonld-thin-html.html");
      const chef = await makeChef();
      const llmRunner = makeLlmRunner({ title: "" });
      await expect(
        importRecipeFromUrl(
          { url: "https://example.com/r", chefId: chef.id },
          baseDeps({ fetchImpl: makeFetchImpl(fixture), llmRunner }),
        ),
      ).rejects.toMatchObject({ code: "no-content", status: 422 });
    });

    it("malformed JSON-LD falls through to LLM (does not throw)", async () => {
      const fixture = await loadFixture("malformed-jsonld.html");
      const chef = await makeChef();
      const llmRunner = makeLlmRunner({
        title: "Mystery Stew",
        ingredients: ["2 carrots"],
        steps: ["Chop.", "Simmer."],
      });
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture), llmRunner }),
      );
      expect(result.source).toBe("llm");
      expect(result.confidence).toBe("low");
    });
  });

  describe("Mixed JSON-LD + LLM", () => {
    it("partial JSON-LD + LLM gap-fill → confidence=medium, source=mixed", async () => {
      const fixture = await loadFixture("partial-jsonld.html");
      const chef = await makeChef();
      const llmRunner = makeLlmRunner({
        title: "Mystery Soup",
        ingredients: ["2 carrots", "1 onion"],
        steps: ["Chop.", "Simmer."],
      });
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture), llmRunner }),
      );
      expect(result.confidence).toBe("medium");
      expect(result.source).toBe("mixed");
      expect(llmRunner.extract).toHaveBeenCalled();
    });
  });

  describe("existingRecipeId hint", () => {
    it("surfaces existingRecipeId when chef has a non-deleted Recipe with same sourceUrl", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const existing = await db.recipe.create({
        data: {
          title: "Previous Pasta",
          chefId: chef.id,
          sourceUrl: "https://example.com/r",
        },
      });
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture) }),
      );
      expect(result.existingRecipeId).toBe(existing.id);
    });

    it("existingRecipeId=null when only match is soft-deleted", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      await db.recipe.create({
        data: {
          title: "Soft Deleted",
          chefId: chef.id,
          sourceUrl: "https://example.com/r",
          deletedAt: new Date(),
        },
      });
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture) }),
      );
      expect(result.existingRecipeId).toBeNull();
    });

    it("existingRecipeId is scoped per chef", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chefA = await makeChef();
      const chefB = await makeChef();
      await db.recipe.create({
        data: {
          title: "Other Chef's Recipe",
          chefId: chefB.id,
          sourceUrl: "https://example.com/r",
        },
      });
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chefA.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture) }),
      );
      expect(result.existingRecipeId).toBeNull();
    });
  });

  describe("Rate limit", () => {
    it("throws ImportRecipeError code=rate-limited (429) when quota exhausted", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      // Pre-fill the ledger to the cap (50 imports today).
      const now = new Date(Date.UTC(2026, 4, 11, 12, 0));
      const bucketStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      await db.imageGenLedger.create({
        data: { userId: chef.id, kind: "import", bucketStart, count: 50 },
      });
      await expect(
        importRecipeFromUrl(
          { url: "https://example.com/r", chefId: chef.id },
          baseDeps({ fetchImpl: makeFetchImpl(fixture), now: () => now }),
        ),
      ).rejects.toMatchObject({ code: "rate-limited", status: 429 });
    });
  });

  describe("Dry-run", () => {
    it("returns draft with recipeId=null and does not persist", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id, dryRun: true },
        baseDeps({ fetchImpl: makeFetchImpl(fixture) }),
      );
      expect(result.recipeId).toBeNull();
      const count = await db.recipe.count({ where: { chefId: chef.id } });
      expect(count).toBe(0);
    });

    it("does not consume rate-limit quota", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id, dryRun: true },
        baseDeps({ fetchImpl: makeFetchImpl(fixture) }),
      );
      const count = await db.imageGenLedger.count({
        where: { userId: chef.id, kind: "import" },
      });
      expect(count).toBe(0);
    });

    it("does not enqueue cover upload (waitUntil not called)", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const waitUntil = vi.fn();
      await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id, dryRun: true },
        baseDeps({ fetchImpl: makeFetchImpl(fixture), waitUntil }),
      );
      expect(waitUntil).not.toHaveBeenCalled();
    });

    it("dryRun still surfaces existingRecipeId hint", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const existing = await db.recipe.create({
        data: {
          title: "Previous Pasta",
          chefId: chef.id,
          sourceUrl: "https://example.com/r",
        },
      });
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id, dryRun: true },
        baseDeps({ fetchImpl: makeFetchImpl(fixture) }),
      );
      expect(result.existingRecipeId).toBe(existing.id);
    });
  });

  describe("Error wiring", () => {
    async function makeChefForError() {
      return makeChef();
    }
    async function fetchError(
      response: Response | (() => Response),
    ): Promise<typeof fetch> {
      return vi.fn(async () =>
        typeof response === "function" ? response() : response,
      ) as unknown as typeof fetch;
    }

    it("SafeFetchError(blocked-host) → ImportRecipeError fetch-blocked (400)", async () => {
      const chef = await makeChefForError();
      await expect(
        importRecipeFromUrl(
          { url: "https://127.0.0.1/r", chefId: chef.id },
          baseDeps(),
        ),
      ).rejects.toMatchObject({ code: "fetch-blocked", status: 400 });
    });

    it("SafeFetchError(bad-scheme) → bad-url (400)", async () => {
      const chef = await makeChefForError();
      await expect(
        importRecipeFromUrl(
          { url: "file:///etc/passwd", chefId: chef.id },
          baseDeps(),
        ),
      ).rejects.toMatchObject({ code: "bad-url", status: 400 });
    });

    it("SafeFetchError(non-2xx) → fetch-failed (502)", async () => {
      const chef = await makeChefForError();
      const fetchImpl = await fetchError(
        streamingResponse("", { status: 500 }),
      );
      await expect(
        importRecipeFromUrl(
          { url: "https://example.com/r", chefId: chef.id },
          baseDeps({ fetchImpl }),
        ),
      ).rejects.toMatchObject({ code: "fetch-failed", status: 502 });
    });

    it("SafeFetchError(not-html) → not-html (415)", async () => {
      const chef = await makeChefForError();
      const fetchImpl = await fetchError(
        streamingResponse("", { contentType: "application/pdf" }),
      );
      await expect(
        importRecipeFromUrl(
          { url: "https://example.com/r", chefId: chef.id },
          baseDeps({ fetchImpl }),
        ),
      ).rejects.toMatchObject({ code: "not-html", status: 415 });
    });

    it("SafeFetchError(too-large) → fetch-too-large (413)", async () => {
      const chef = await makeChefForError();
      const chunk = new Uint8Array(512 * 1024).fill(65);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < 12; i++) controller.enqueue(chunk);
          controller.close();
        },
      });
      const headers = new Headers();
      headers.set("content-type", "text/html");
      const response = {
        ok: true,
        status: 200,
        url: "https://example.com/r",
        headers,
        body: stream,
      } as unknown as Response;
      const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch;
      await expect(
        importRecipeFromUrl(
          { url: "https://example.com/r", chefId: chef.id },
          baseDeps({ fetchImpl }),
        ),
      ).rejects.toMatchObject({ code: "fetch-too-large", status: 413 });
    });

    it("SafeFetchError(timeout) → fetch-timeout (504)", async () => {
      // Avoid fake timers (which interact poorly with Prisma's async DB
      // operations). Simulate the timeout path by having fetchImpl reject
      // with an AbortError directly — this is the same exit edge taken by
      // the AbortController-fired abort in production.
      const chef = await makeChefForError();
      const fetchImpl = vi.fn(async () => {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }) as unknown as typeof fetch;
      await expect(
        importRecipeFromUrl(
          { url: "https://example.com/r", chefId: chef.id },
          baseDeps({ fetchImpl }),
        ),
      ).rejects.toMatchObject({ code: "fetch-timeout", status: 504 });
    });

    it("RecipeLlmError → llm-failed (502)", async () => {
      const fixture = await loadFixture("no-jsonld-rich-html.html");
      const chef = await makeChefForError();
      const { RecipeLlmError } = await import("~/lib/recipe-import-llm.server");
      const llmRunner: RecipeLlmRunner = {
        extract: vi.fn(async () => {
          throw new RecipeLlmError("boom");
        }),
      };
      await expect(
        importRecipeFromUrl(
          { url: "https://example.com/r", chefId: chef.id },
          baseDeps({ fetchImpl: makeFetchImpl(fixture), llmRunner }),
        ),
      ).rejects.toMatchObject({ code: "llm-failed", status: 502 });
    });
  });

  describe("LLM runner edge cases", () => {
    it("throws llm-failed when LLM runner is required but not provided", async () => {
      const fixture = await loadFixture("no-jsonld-rich-html.html");
      const chef = await makeChef();
      await expect(
        importRecipeFromUrl(
          { url: "https://example.com/r", chefId: chef.id },
          baseDeps({ fetchImpl: makeFetchImpl(fixture), llmRunner: undefined }),
        ),
      ).rejects.toMatchObject({ code: "llm-failed" });
    });

    it("re-throws non-RecipeLlmError from llmRunner.extract", async () => {
      const fixture = await loadFixture("no-jsonld-rich-html.html");
      const chef = await makeChef();
      const llmRunner: RecipeLlmRunner = {
        extract: vi.fn(async () => {
          throw new TypeError("strange failure");
        }),
      };
      await expect(
        importRecipeFromUrl(
          { url: "https://example.com/r", chefId: chef.id },
          baseDeps({ fetchImpl: makeFetchImpl(fixture), llmRunner }),
        ),
      ).rejects.toBeInstanceOf(TypeError);
    });
  });

  describe("mixed path partial-JSON-LD variations", () => {
    it("uses JSON-LD ingredients when present and LLM only fills steps", async () => {
      // Partial JSON-LD with ingredients but no steps; LLM gap-fills steps.
      const html =
        "<html><head><script type=\"application/ld+json\">" +
        JSON.stringify({
          "@type": "Recipe",
          name: "Hybrid Recipe",
          recipeIngredient: ["1 cup flour", "1 tsp salt"],
        }) +
        "</script></head><body><p>body</p></body></html>";
      const chef = await makeChef();
      const llmRunner = makeLlmRunner({
        title: "Hybrid Recipe",
        ingredients: ["should not be used"],
        steps: ["Mix everything", "Bake until done"],
      });
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl: makeFetchImpl(html), llmRunner }),
      );
      expect(result.source).toBe("mixed");
      const ingredients = await db.ingredient.findMany({
        where: { recipeId: result.recipeId! },
        include: { ingredientRef: true },
      });
      const ingNames = ingredients.map((i) => i.ingredientRef.name).sort();
      // JSON-LD ingredients used: "1 cup flour" / "1 tsp salt" via stub
      expect(ingNames).toEqual(["1 cup flour", "1 tsp salt"]);
    });

    it("uses JSON-LD steps when present and LLM only fills ingredients", async () => {
      const html =
        "<html><head><script type=\"application/ld+json\">" +
        JSON.stringify({
          "@type": "Recipe",
          name: "Hybrid Recipe Two",
          recipeInstructions: [
            { "@type": "HowToStep", text: "Step One" },
            { "@type": "HowToStep", text: "Step Two" },
          ],
        }) +
        "</script></head><body/></html>";
      const chef = await makeChef();
      const llmRunner = makeLlmRunner({
        title: "Hybrid Recipe Two",
        ingredients: ["1 cup sugar"],
        steps: ["should not be used"],
      });
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl: makeFetchImpl(html), llmRunner }),
      );
      expect(result.source).toBe("mixed");
      const steps = await db.recipeStep.findMany({
        where: { recipeId: result.recipeId! },
        orderBy: { stepNum: "asc" },
      });
      expect(steps.map((s) => s.description)).toEqual(["Step One", "Step Two"]);
    });
  });

  describe("cover scheduling edge cases", () => {
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

    function pageThen(
      pageHtml: string,
      imageRespOrError: Response | Error,
    ): typeof fetch {
      let call = 0;
      return vi.fn(async () => {
        call++;
        if (call === 1) return streamingResponse(pageHtml, { url: "https://example.com/r" });
        if (imageRespOrError instanceof Error) throw imageRespOrError;
        return imageRespOrError;
      }) as unknown as typeof fetch;
    }

    it("image fetch returns non-2xx → logger.error, recipe still exists", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const bucket = mockBucket();
      const waitUntil = vi.fn();
      const logger = { error: vi.fn() };
      const fetchImpl = pageThen(fixture, {
        ok: false,
        status: 404,
        headers: new Headers([["content-type", "image/jpeg"]]),
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response);
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, bucket, waitUntil, logger }),
      );
      await waitUntil.mock.calls[0][0];
      expect(logger.error).toHaveBeenCalled();
      const covers = await db.recipeCover.findMany({
        where: { recipeId: result.recipeId! },
      });
      expect(covers).toHaveLength(0);
    });

    it("image fetch returns non-image content-type → logger.error, no cover", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const bucket = mockBucket();
      const waitUntil = vi.fn();
      const logger = { error: vi.fn() };
      const fetchImpl = pageThen(fixture, {
        ok: true,
        status: 200,
        headers: new Headers([["content-type", "application/pdf"]]),
        arrayBuffer: async () => new ArrayBuffer(4),
      } as unknown as Response);
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, bucket, waitUntil, logger }),
      );
      await waitUntil.mock.calls[0][0];
      expect(logger.error).toHaveBeenCalled();
      const covers = await db.recipeCover.findMany({
        where: { recipeId: result.recipeId! },
      });
      expect(covers).toHaveLength(0);
    });

    it("image response with no content-type header defaults to image/jpeg", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const bucket = mockBucket();
      const waitUntil = vi.fn();
      const fetchImpl = pageThen(fixture, {
        ok: true,
        status: 200,
        // No headers attribute at all on the response — exercises the default.
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as unknown as Response);
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, bucket, waitUntil }),
      );
      await waitUntil.mock.calls[0][0];
      const covers = await db.recipeCover.findMany({
        where: { recipeId: result.recipeId! },
      });
      expect(covers).toHaveLength(1);
      expect(covers[0].imageUrl).toMatch(/\.jpg$/);
    });

    it("png content-type produces .png extension", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const bucket = mockBucket();
      const waitUntil = vi.fn();
      const fetchImpl = pageThen(fixture, {
        ok: true,
        status: 200,
        headers: new Headers([["content-type", "image/png"]]),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as unknown as Response);
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, bucket, waitUntil }),
      );
      await waitUntil.mock.calls[0][0];
      const covers = await db.recipeCover.findMany({
        where: { recipeId: result.recipeId! },
      });
      expect(covers[0].imageUrl).toMatch(/\.png$/);
    });

    it("webp content-type produces .webp extension", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const bucket = mockBucket();
      const waitUntil = vi.fn();
      const fetchImpl = pageThen(fixture, {
        ok: true,
        status: 200,
        headers: new Headers([["content-type", "image/webp"]]),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as unknown as Response);
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, bucket, waitUntil }),
      );
      await waitUntil.mock.calls[0][0];
      const covers = await db.recipeCover.findMany({
        where: { recipeId: result.recipeId! },
      });
      expect(covers[0].imageUrl).toMatch(/\.webp$/);
    });

    it("image fetch timeout (AbortError on signal) → logger.error", async () => {
      // We exercise the abort path (which is what the 15s timer triggers in
      // production) by having fetchImpl reject with AbortError on the next
      // microtask. The setTimeout itself fires after 15s; rather than
      // advance fake timers (which interacts poorly with Prisma's async
      // bookkeeping), we trigger the same AbortError exit edge directly.
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const bucket = mockBucket();
      const waitUntil = vi.fn();
      const logger = { error: vi.fn() };
      let call = 0;
      const fetchImpl = vi.fn(async () => {
        call++;
        if (call === 1) return streamingResponse(fixture, { url: "https://example.com/r" });
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }) as unknown as typeof fetch;
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, bucket, waitUntil, logger }),
      );
      await waitUntil.mock.calls[0][0];
      expect(logger.error).toHaveBeenCalled();
      const covers = await db.recipeCover.findMany({
        where: { recipeId: result.recipeId! },
      });
      expect(covers).toHaveLength(0);
    });

    it("image fetch 15s setTimeout callback aborts the request", async () => {
      // Capture the timer callback by spying on setTimeout. The callback,
      // when invoked, calls controller.abort(); the in-flight fetch then
      // rejects with AbortError and the uploadImportCover catches it.
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const bucket = mockBucket();
      const waitUntil = vi.fn();
      const logger = { error: vi.fn() };
      let pageDone = false;
      const fetchImpl = vi.fn(async (_input: unknown, init?: { signal?: AbortSignal }) => {
        if (!pageDone) {
          pageDone = true;
          return streamingResponse(fixture, { url: "https://example.com/r" });
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }) as unknown as typeof fetch;

      // Spy on setTimeout: capture all callbacks scheduled with a 15_000ms
      // delay (the cover-fetch timeout). We invoke them synchronously to
      // simulate the timer firing.
      const realSetTimeout = globalThis.setTimeout;
      const captured: Array<() => void> = [];
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
        ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
          if (typeof handler === "function" && delay === 15_000) {
            captured.push(handler as () => void);
            return 0 as unknown as ReturnType<typeof setTimeout>;
          }
          // Delegate everything else (Prisma uses timers internally).
          return realSetTimeout(handler, delay, ...args);
        }) as typeof setTimeout,
      );
      try {
        const result = await importRecipeFromUrl(
          { url: "https://example.com/r", chefId: chef.id },
          baseDeps({ fetchImpl, bucket, waitUntil, logger }),
        );
        // Fire the cover-fetch timeout callback.
        expect(captured.length).toBeGreaterThan(0);
        for (const cb of captured) cb();
        await waitUntil.mock.calls[0][0];
        expect(logger.error).toHaveBeenCalled();
        const covers = await db.recipeCover.findMany({
          where: { recipeId: result.recipeId! },
        });
        expect(covers).toHaveLength(0);
      } finally {
        setTimeoutSpy.mockRestore();
      }
    });

    it("gif content-type produces .gif extension", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const bucket = mockBucket();
      const waitUntil = vi.fn();
      const fetchImpl = pageThen(fixture, {
        ok: true,
        status: 200,
        headers: new Headers([["content-type", "image/gif"]]),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as unknown as Response);
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, bucket, waitUntil }),
      );
      await waitUntil.mock.calls[0][0];
      const covers = await db.recipeCover.findMany({
        where: { recipeId: result.recipeId! },
      });
      expect(covers[0].imageUrl).toMatch(/\.gif$/);
    });
  });

  describe("orchestrator fallbacks", () => {
    it("re-throws non-SafeFetchError raised by fetchImpl", async () => {
      const chef = await makeChef();
      const fetchImpl = vi.fn(async () => {
        throw new TypeError("not a SafeFetchError");
      }) as unknown as typeof fetch;
      await expect(
        importRecipeFromUrl(
          { url: "https://example.com/r", chefId: chef.id },
          baseDeps({ fetchImpl }),
        ),
      ).rejects.toBeInstanceOf(TypeError);
    });

    it("default fetchImpl is used when deps.fetchImpl is undefined (bad-scheme exits early)", async () => {
      const chef = await makeChef();
      // We exit at bad-scheme BEFORE any fetch is attempted; this still
      // exercises the `deps.fetchImpl ?? fetch` line because we don't pass
      // fetchImpl. The scheduleCover() default never runs because we throw.
      await expect(
        importRecipeFromUrl(
          { url: "file:///etc/passwd", chefId: chef.id },
          baseDeps({ fetchImpl: undefined }),
        ),
      ).rejects.toMatchObject({ code: "bad-url" });
    });

    function localMockBucket(): R2Bucket {
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

    it("default fetchImpl falls back to global fetch when deps.fetchImpl is undefined", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const bucket = localMockBucket();
      const waitUntil = vi.fn();
      const stub = vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === "https://example.com/r") {
          return streamingResponse(fixture, { url: "https://example.com/r" });
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers([["content-type", "image/jpeg"]]),
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as unknown as Response;
      });
      const originalFetch = globalThis.fetch;
      (globalThis as { fetch: typeof fetch }).fetch = stub as unknown as typeof fetch;
      try {
        const result = await importRecipeFromUrl(
          { url: "https://example.com/r", chefId: chef.id },
          {
            db,
            ingredientParser: makeIngredientParser(),
            // fetchImpl omitted → defaults to global fetch
            // env omitted → defaults to {}
            bucket,
            waitUntil,
          },
        );
        await waitUntil.mock.calls[0][0];
        const covers = await db.recipeCover.findMany({
          where: { recipeId: result.recipeId! },
        });
        expect(covers).toHaveLength(1);
      } finally {
        (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
      }
    });

    it("default logger is console when deps.logger is undefined", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const bucket = {
        put: vi.fn(async () => {
          throw new Error("simulated R2 outage");
        }),
      } as unknown as R2Bucket;
      void localMockBucket;
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        let call = 0;
        const fetchImpl = vi.fn(async () => {
          call++;
          if (call === 1) return streamingResponse(fixture, { url: "https://example.com/r" });
          return {
            ok: true,
            status: 200,
            headers: new Headers([["content-type", "image/jpeg"]]),
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          } as unknown as Response;
        }) as unknown as typeof fetch;
        const result = await importRecipeFromUrl(
          { url: "https://example.com/r", chefId: chef.id },
          baseDeps({ fetchImpl, bucket, logger: undefined }),
        );
        expect(result.recipeId).toBeTruthy();
        expect(errSpy).toHaveBeenCalled();
      } finally {
        errSpy.mockRestore();
      }
    });

    it("default now is wall-clock when deps.now is undefined", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture), now: undefined }),
      );
      expect(result.recipeId).toBeTruthy();
    });

    it("default ingredient parser is parseIngredients (env propagated)", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      // We CAN'T actually call OpenAI in tests. Instead, we exercise the
      // default-parser line by relying on parseIngredients's "OPENAI_API_KEY
      // required" guard: pass empty env to trigger that synchronous error.
      // The default parser is invoked because we omit deps.ingredientParser.
      await expect(
        importRecipeFromUrl(
          { url: "https://example.com/r", chefId: chef.id },
          {
            db,
            env: { OPENAI_API_KEY: "" },
            fetchImpl: makeFetchImpl(fixture),
            // No ingredientParser → defaults to parseIngredients
            // No llmRunner needed (JSON-LD covers everything)
          },
        ),
      ).rejects.toThrow(/OpenAI API key/i);
    });

    it("default ingredient parser works when env is null", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      // Force the env-null branch of the default parser arrow.
      await expect(
        importRecipeFromUrl(
          { url: "https://example.com/r", chefId: chef.id },
          {
            db,
            env: null,
            fetchImpl: makeFetchImpl(fixture),
          },
        ),
      ).rejects.toThrow(/OpenAI API key/i);
    });
  });

  describe("ImportRecipeError", () => {
    it("is an Error with code and status fields", () => {
      const e = new ImportRecipeError("rate-limited", 429, "msg");
      expect(e).toBeInstanceOf(Error);
      expect(e.code).toBe("rate-limited");
      expect(e.status).toBe(429);
      expect(e.message).toBe("msg");
    });
  });

  describe("cover scheduling", () => {
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

    function imageFetchImpl(
      bytes: Uint8Array,
      contentType = "image/jpeg",
    ): typeof fetch {
      return vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers([["content-type", contentType]]),
        arrayBuffer: async () => bytes.buffer as ArrayBuffer,
      })) as unknown as typeof fetch;
    }

    function multiFetchImpl(handlers: {
      page: () => Response;
      image: () => Promise<{ ok: boolean; status: number; headers: Headers; arrayBuffer: () => Promise<ArrayBuffer> }>;
    }): typeof fetch {
      let call = 0;
      return vi.fn(async (input: unknown) => {
        call++;
        const url = String(input);
        if (call === 1 || url.endsWith("/r")) {
          return handlers.page();
        }
        return handlers.image();
      }) as unknown as typeof fetch;
    }

    it("og:image present → schedules upload via waitUntil; coverPending=true", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const bucket = mockBucket();
      const waitUntil = vi.fn();
      const fetchImpl = multiFetchImpl({
        page: () => streamingResponse(fixture, { url: "https://example.com/r" }),
        image: async () => ({
          ok: true,
          status: 200,
          headers: new Headers([["content-type", "image/jpeg"]]),
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        }),
      });
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, bucket, waitUntil }),
      );
      expect(result.coverPending).toBe(true);
      expect(waitUntil).toHaveBeenCalledTimes(1);
      await waitUntil.mock.calls[0][0]; // run the scheduled task
      const covers = await db.recipeCover.findMany({
        where: { recipeId: result.recipeId! },
      });
      expect(covers).toHaveLength(1);
      expect(covers[0].sourceType).toBe("import");
    });

    it("scheduled upload calls bucket.put and createCover sourceType=import", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const bucket = mockBucket();
      const bytes = new Uint8Array([10, 20, 30]);
      const waitUntil = vi.fn();
      const fetchImpl = multiFetchImpl({
        page: () => streamingResponse(fixture, { url: "https://example.com/r" }),
        image: async () => ({
          ok: true,
          status: 200,
          headers: new Headers([["content-type", "image/png"]]),
          arrayBuffer: async () => bytes.buffer as ArrayBuffer,
        }),
      });
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, bucket, waitUntil }),
      );
      await waitUntil.mock.calls[0][0];
      expect(bucket.put).toHaveBeenCalled();
      const covers = await db.recipeCover.findMany({
        where: { recipeId: result.recipeId! },
      });
      expect(covers[0].sourceType).toBe("import");
      expect(covers[0].imageUrl).toContain("/photos/");
    });

    it("oversized image is skipped, logger.error called, recipe still exists", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const bucket = mockBucket();
      const waitUntil = vi.fn();
      const logger = { error: vi.fn() };
      // Image fetch returns 6MB → exceeds 5MB cap
      const bigBytes = new Uint8Array(6 * 1024 * 1024).fill(7);
      const fetchImpl = multiFetchImpl({
        page: () => streamingResponse(fixture, { url: "https://example.com/r" }),
        image: async () => ({
          ok: true,
          status: 200,
          headers: new Headers([["content-type", "image/jpeg"]]),
          arrayBuffer: async () => bigBytes.buffer as ArrayBuffer,
        }),
      });
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, bucket, waitUntil, logger }),
      );
      await waitUntil.mock.calls[0][0];
      expect(logger.error).toHaveBeenCalled();
      const recipe = await db.recipe.findUnique({
        where: { id: result.recipeId! },
      });
      expect(recipe).not.toBeNull();
      const covers = await db.recipeCover.findMany({
        where: { recipeId: result.recipeId! },
      });
      expect(covers).toHaveLength(0);
    });

    it("network failure during image fetch is swallowed and logged", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const bucket = mockBucket();
      const waitUntil = vi.fn();
      const logger = { error: vi.fn() };
      let call = 0;
      const fetchImpl = vi.fn(async () => {
        call++;
        if (call === 1) return streamingResponse(fixture, { url: "https://example.com/r" });
        throw new Error("network down");
      }) as unknown as typeof fetch;
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, bucket, waitUntil, logger }),
      );
      await waitUntil.mock.calls[0][0];
      expect(logger.error).toHaveBeenCalled();
      expect(result.recipeId).toBeTruthy();
    });

    it("bucket.put failure is swallowed and logged", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const bucket = {
        put: vi.fn(async () => {
          throw new Error("r2 down");
        }),
      } as unknown as R2Bucket;
      const waitUntil = vi.fn();
      const logger = { error: vi.fn() };
      const fetchImpl = multiFetchImpl({
        page: () => streamingResponse(fixture, { url: "https://example.com/r" }),
        image: async () => ({
          ok: true,
          status: 200,
          headers: new Headers([["content-type", "image/jpeg"]]),
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        }),
      });
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, bucket, waitUntil, logger }),
      );
      await waitUntil.mock.calls[0][0];
      expect(logger.error).toHaveBeenCalled();
      expect(result.recipeId).toBeTruthy();
    });

    it("og:image absent + imageGenRunner present → schedules ai-placeholder", async () => {
      const fixture = await loadFixture("no-jsonld-thin-html.html");
      const chef = await makeChef();
      const bucket = mockBucket();
      const waitUntil = vi.fn();
      const imageGenRunner = {
        textToImage: vi.fn(async () => ({ url: "https://gen.example.com/p.png" })),
        imageToImage: vi.fn(async () => ({ url: "" })),
      };
      const llmRunner = makeLlmRunner({
        title: "Some Recipe",
        ingredients: ["1 cup flour"],
        steps: ["Mix."],
      });
      let call = 0;
      const fetchImpl = vi.fn(async (input: unknown) => {
        call++;
        if (call === 1) return streamingResponse(fixture, { url: "https://example.com/r" });
        // Image gen runner output fetch
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as unknown as Response;
      }) as unknown as typeof fetch;
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, bucket, waitUntil, imageGenRunner, llmRunner }),
      );
      expect(result.coverPending).toBe(true);
      await waitUntil.mock.calls[0][0];
      const covers = await db.recipeCover.findMany({
        where: { recipeId: result.recipeId! },
      });
      expect(covers).toHaveLength(1);
      expect(covers[0].sourceType).toBe("ai-placeholder");
    });

    it("og:image absent + imageGenRunner generation fails → recipe still exists, no cover", async () => {
      const fixture = await loadFixture("no-jsonld-thin-html.html");
      const chef = await makeChef();
      const bucket = mockBucket();
      const waitUntil = vi.fn();
      const logger = { error: vi.fn() };
      const imageGenRunner = {
        textToImage: vi.fn(async () => {
          throw new Error("openai down");
        }),
        imageToImage: vi.fn(async () => ({ url: "" })),
      };
      const llmRunner = makeLlmRunner({
        title: "Some Recipe",
        ingredients: ["1 cup flour"],
        steps: ["Mix."],
      });
      const fetchImpl = makeFetchImpl(fixture);
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, bucket, waitUntil, imageGenRunner, llmRunner, logger }),
      );
      await waitUntil.mock.calls[0][0];
      expect(logger.error).toHaveBeenCalled();
      const covers = await db.recipeCover.findMany({
        where: { recipeId: result.recipeId! },
      });
      expect(covers).toHaveLength(0);
    });

    it("og:image absent + imageGenRunner absent → no cover scheduled, coverPending=false", async () => {
      const fixture = await loadFixture("no-jsonld-thin-html.html");
      const chef = await makeChef();
      const bucket = mockBucket();
      const waitUntil = vi.fn();
      const llmRunner = makeLlmRunner({
        title: "Some Recipe",
        ingredients: ["1 cup flour"],
        steps: ["Mix."],
      });
      const fetchImpl = makeFetchImpl(fixture);
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, bucket, waitUntil, llmRunner }),
      );
      expect(result.coverPending).toBe(false);
      expect(waitUntil).not.toHaveBeenCalled();
    });

    it("bucket undefined → no cover scheduled even if og:image present, coverPending=false", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const waitUntil = vi.fn();
      const fetchImpl = makeFetchImpl(fixture);
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, waitUntil }),
      );
      expect(result.coverPending).toBe(false);
      expect(waitUntil).not.toHaveBeenCalled();
    });

    it("waitUntil undefined → cover task is awaited inline", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const bucket = mockBucket();
      const fetchImpl = multiFetchImpl({
        page: () => streamingResponse(fixture, { url: "https://example.com/r" }),
        image: async () => ({
          ok: true,
          status: 200,
          headers: new Headers([["content-type", "image/png"]]),
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        }),
      });
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, bucket }),
      );
      // Awaited inline → cover should already exist
      const covers = await db.recipeCover.findMany({
        where: { recipeId: result.recipeId! },
      });
      expect(covers).toHaveLength(1);
    });

    it("JSON-LD path uses jsonLd.imageUrl over ogImageUrl", async () => {
      // nyt-style-jsonld.html has both `image: cdn.example.com/pasta-hero.jpg`
      // in JSON-LD and og:image=cdn.example.com/pasta.jpg in <meta>. The
      // JSON-LD image must win.
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      const bucket = mockBucket();
      const waitUntil = vi.fn();
      const seenUrls: string[] = [];
      const fetchImpl = vi.fn(async (input: unknown) => {
        const u = String(input);
        if (u === "https://example.com/r") {
          return streamingResponse(fixture, { url: "https://example.com/r" });
        }
        seenUrls.push(u);
        return {
          ok: true,
          status: 200,
          headers: new Headers([["content-type", "image/jpeg"]]),
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as unknown as Response;
      }) as unknown as typeof fetch;
      await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl, bucket, waitUntil }),
      );
      await waitUntil.mock.calls[0][0];
      expect(seenUrls).toEqual(["https://cdn.example.com/pasta-hero.jpg"]);
    });
  });

  describe("title collision", () => {
    async function createRecipeWithTitle(chefId: string, title: string) {
      return db.recipe.create({ data: { chefId, title } });
    }

    it("first-collision appends ' (imported)' suffix", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      await createRecipeWithTitle(chef.id, "Pasta al Limone");
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture) }),
      );
      const recipe = await db.recipe.findUnique({
        where: { id: result.recipeId! },
      });
      expect(recipe?.title).toBe("Pasta al Limone (imported)");
    });

    it("second-collision appends ' (imported HH:MM)' suffix with zero-padded UTC time", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      await createRecipeWithTitle(chef.id, "Pasta al Limone");
      await createRecipeWithTitle(chef.id, "Pasta al Limone (imported)");
      const now = () => new Date(Date.UTC(2026, 4, 11, 7, 5));
      const result = await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture), now }),
      );
      const recipe = await db.recipe.findUnique({
        where: { id: result.recipeId! },
      });
      expect(recipe?.title).toBe("Pasta al Limone (imported 07:05)");
    });

    it("ingredient-ref cache hit (reuse existing ingredient row across imports)", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chefA = await makeChef();
      const chefB = await makeChef();
      // First import — creates a "spaghetti" ingredient ref
      await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chefA.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture) }),
      );
      // Second import — should hit the existing ingredient_ref by name
      await importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chefB.id },
        baseDeps({ fetchImpl: makeFetchImpl(fixture) }),
      );
      const refs = await db.ingredientRef.findMany({});
      // We expect each *normalized* ingredient name to exist only once.
      const names = refs.map((r) => r.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it("third-collision throws title-conflict (409)", async () => {
      const fixture = await loadFixture("nyt-style-jsonld.html");
      const chef = await makeChef();
      await createRecipeWithTitle(chef.id, "Pasta al Limone");
      await createRecipeWithTitle(chef.id, "Pasta al Limone (imported)");
      const now = () => new Date(Date.UTC(2026, 4, 11, 7, 5));
      await createRecipeWithTitle(chef.id, "Pasta al Limone (imported 07:05)");
      await expect(
        importRecipeFromUrl(
          { url: "https://example.com/r", chefId: chef.id },
          baseDeps({ fetchImpl: makeFetchImpl(fixture), now }),
        ),
      ).rejects.toMatchObject({ code: "title-conflict", status: 409 });
    });
  });
});
