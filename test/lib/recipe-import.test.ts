import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
  fileURLToPath(new URL(".", import.meta.url)),
  "../fixtures/recipe-import",
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
      vi.useFakeTimers();
      try {
        const chef = await makeChefForError();
        const fetchImpl = vi.fn(
          async (_input: unknown, init?: { signal?: AbortSignal }) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                const err = new Error("Aborted");
                err.name = "AbortError";
                reject(err);
              });
            }),
        ) as unknown as typeof fetch;
        const promise = importRecipeFromUrl(
          { url: "https://example.com/r", chefId: chef.id },
          baseDeps({ fetchImpl }),
        );
        const assertion = expect(promise).rejects.toMatchObject({
          code: "fetch-timeout",
          status: 504,
        });
        await vi.advanceTimersByTimeAsync(16_000);
        await assertion;
      } finally {
        vi.useRealTimers();
      }
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

  describe("ImportRecipeError", () => {
    it("is an Error with code and status fields", () => {
      const e = new ImportRecipeError("rate-limited", 429, "msg");
      expect(e).toBeInstanceOf(Error);
      expect(e.code).toBe("rate-limited");
      expect(e.status).toBe(429);
      expect(e.message).toBe("msg");
    });
  });
});
