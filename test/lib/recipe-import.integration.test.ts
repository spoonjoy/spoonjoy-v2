import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { cleanupDatabase } from "../helpers/cleanup";
import {
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

function streamingResponse(body: string, url = "https://example.com/r"): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  const headers = new Headers([["content-type", "text/html"]]);
  return {
    ok: true,
    status: 200,
    url,
    headers,
    body: stream,
  } as unknown as Response;
}

function ingredientParser(): NonNullable<ImportRecipeDeps["ingredientParser"]> {
  return vi.fn(async (text: string): Promise<ParsedIngredient[]> => {
    if (!text.trim()) return [];
    return [{ quantity: 1, unit: "whole", ingredientName: text.trim() }];
  });
}

function mockLlm(payload: {
  title: string;
  description?: string | null;
  servings?: string | null;
  ingredients?: string[];
  steps?: string[];
}): RecipeLlmRunner {
  return {
    extract: vi.fn(async () => ({
      title: payload.title,
      description: payload.description ?? null,
      servings: payload.servings ?? null,
      ingredients: payload.ingredients ?? [],
      steps: payload.steps ?? [],
    })),
  };
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

async function makeChef() {
  const email = `int-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
  const username = `intuser_${faker.string.alphanumeric(8).toLowerCase()}`;
  return createUser(db, email, username, "test-password-1234");
}

function makeFetchSequence(fixture: string, imageContentType = "image/jpeg") {
  let call = 0;
  return vi.fn(async () => {
    call++;
    if (call === 1) return streamingResponse(fixture);
    return {
      ok: true,
      status: 200,
      headers: new Headers([["content-type", imageContentType]]),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("recipe-import integration", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });
  afterEach(async () => {
    await cleanupDatabase();
  });

  it("nyt-style-jsonld fixture → Recipe + steps + ingredients; confidence=high", async () => {
    const fixture = await loadFixture("nyt-style-jsonld.html");
    const chef = await makeChef();
    const result = await importRecipeFromUrl(
      { url: "https://example.com/r", chefId: chef.id },
      {
        db,
        env: { OPENAI_API_KEY: "k" },
        fetchImpl: vi.fn(async () => streamingResponse(fixture)) as unknown as typeof fetch,
        ingredientParser: ingredientParser(),
      },
    );
    expect(result.confidence).toBe("high");
    const recipe = await db.recipe.findUnique({
      where: { id: result.recipeId! },
      include: { steps: { include: { ingredients: true } } },
    });
    expect(recipe).not.toBeNull();
    expect(recipe!.steps).toHaveLength(3);
    const allIngredients = recipe!.steps.flatMap((s) => s.ingredients);
    expect(allIngredients.length).toBeGreaterThan(0);
  });

  it("og-image-only fixture → cover row created with sourceType=import after waitUntil completes", async () => {
    const fixture = await loadFixture("og-image-only.html");
    const chef = await makeChef();
    const bucket = mockBucket();
    const waitUntil = vi.fn();
    const result = await importRecipeFromUrl(
      { url: "https://example.com/r", chefId: chef.id },
      {
        db,
        env: { OPENAI_API_KEY: "k" },
        bucket,
        waitUntil,
        fetchImpl: makeFetchSequence(fixture),
        ingredientParser: ingredientParser(),
        llmRunner: mockLlm({
          title: "Cover Only Recipe",
          ingredients: ["1 cup of nothing"],
          steps: ["Wait."],
        }),
      },
    );
    await waitUntil.mock.calls[0][0];
    const covers = await db.recipeCover.findMany({
      where: { recipeId: result.recipeId! },
    });
    expect(covers).toHaveLength(1);
    expect(covers[0].sourceType).toBe("import");
  });

  it("no-jsonld-thin-html → LLM mock returns content; recipe persisted; confidence=low", async () => {
    const fixture = await loadFixture("no-jsonld-thin-html.html");
    const chef = await makeChef();
    const result = await importRecipeFromUrl(
      { url: "https://example.com/r", chefId: chef.id },
      {
        db,
        env: { OPENAI_API_KEY: "k" },
        fetchImpl: vi.fn(async () => streamingResponse(fixture)) as unknown as typeof fetch,
        ingredientParser: ingredientParser(),
        llmRunner: mockLlm({
          title: "Thin LLM Recipe",
          ingredients: ["1 lonely ingredient"],
          steps: ["The only step."],
        }),
      },
    );
    expect(result.confidence).toBe("low");
    expect(result.source).toBe("llm");
    const recipe = await db.recipe.findUnique({ where: { id: result.recipeId! } });
    expect(recipe?.title).toBe("Thin LLM Recipe");
  });

  it("malformed-jsonld fixture → falls through to LLM; recipe persisted; no exception leaks", async () => {
    const fixture = await loadFixture("malformed-jsonld.html");
    const chef = await makeChef();
    const result = await importRecipeFromUrl(
      { url: "https://example.com/r", chefId: chef.id },
      {
        db,
        env: { OPENAI_API_KEY: "k" },
        fetchImpl: vi.fn(async () => streamingResponse(fixture)) as unknown as typeof fetch,
        ingredientParser: ingredientParser(),
        llmRunner: mockLlm({
          title: "Mystery Stew",
          ingredients: ["2 carrots", "1 onion"],
          steps: ["Chop.", "Simmer."],
        }),
      },
    );
    expect(result.source).toBe("llm");
    expect(result.recipeId).toBeTruthy();
  });

  it("second call with same URL surfaces existingRecipeId", async () => {
    const fixture = await loadFixture("nyt-style-jsonld.html");
    const chef = await makeChef();
    const first = await importRecipeFromUrl(
      { url: "https://example.com/r", chefId: chef.id },
      {
        db,
        env: { OPENAI_API_KEY: "k" },
        fetchImpl: vi.fn(async () => streamingResponse(fixture)) as unknown as typeof fetch,
        ingredientParser: ingredientParser(),
      },
    );
    const second = await importRecipeFromUrl(
      { url: "https://example.com/r", chefId: chef.id },
      {
        db,
        env: { OPENAI_API_KEY: "k" },
        fetchImpl: vi.fn(async () => streamingResponse(fixture)) as unknown as typeof fetch,
        ingredientParser: ingredientParser(),
      },
    );
    expect(second.existingRecipeId).toBe(first.recipeId);
  });

  it("50 consecutive imports succeed; 51st returns rate-limited", async () => {
    const fixture = await loadFixture("nyt-style-jsonld.html");
    const chef = await makeChef();
    // Pin time so we stay within one UTC day.
    const now = () => new Date(Date.UTC(2026, 4, 11, 12, 0));
    // Pre-load ledger to 49 to keep test fast.
    await db.imageGenLedger.create({
      data: {
        userId: chef.id,
        kind: "import",
        bucketStart: new Date(Date.UTC(2026, 4, 11)),
        count: 49,
      },
    });
    const ok = await importRecipeFromUrl(
      { url: "https://example.com/r", chefId: chef.id },
      {
        db,
        env: { OPENAI_API_KEY: "k" },
        fetchImpl: vi.fn(async () => streamingResponse(fixture)) as unknown as typeof fetch,
        ingredientParser: ingredientParser(),
        now,
      },
    );
    expect(ok.recipeId).toBeTruthy();
    await expect(
      importRecipeFromUrl(
        { url: "https://example.com/r", chefId: chef.id },
        {
          db,
          env: { OPENAI_API_KEY: "k" },
          fetchImpl: vi.fn(async () => streamingResponse(fixture)) as unknown as typeof fetch,
          ingredientParser: ingredientParser(),
          now,
        },
      ),
    ).rejects.toMatchObject({ code: "rate-limited" });
  });

  it("dry-run path returns draft without DB rows", async () => {
    const fixture = await loadFixture("nyt-style-jsonld.html");
    const chef = await makeChef();
    const result = await importRecipeFromUrl(
      { url: "https://example.com/r", chefId: chef.id, dryRun: true },
      {
        db,
        env: { OPENAI_API_KEY: "k" },
        fetchImpl: vi.fn(async () => streamingResponse(fixture)) as unknown as typeof fetch,
        ingredientParser: ingredientParser(),
      },
    );
    expect(result.recipeId).toBeNull();
    const count = await db.recipe.count({ where: { chefId: chef.id } });
    expect(count).toBe(0);
  });
});
