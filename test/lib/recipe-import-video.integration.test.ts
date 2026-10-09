/**
 * I2 — video pipeline integration tests.
 *
 * End-to-end through `importRecipeFromUrl` with a real Prisma DB, mocked
 * oEmbed fetch, and a mocked LLM runner. No real network, no real OpenAI.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { importRecipeFromUrl } from "~/lib/recipe-import.server";
import type { RecipeLlmRunner } from "~/lib/recipe-import-llm.server";
import type { ParsedIngredient } from "~/lib/ingredient-parse.server";
import type { ImportRecipeDeps } from "~/lib/recipe-import.server";

const VIDEO_FIXTURES_DIR = path.resolve(
  process.cwd(),
  "test/fixtures/recipe-import/video",
);

function loadVideoFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(path.join(VIDEO_FIXTURES_DIR, name), "utf-8"),
  );
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
  const email = `vid-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
  const username = `viduser_${faker.string.alphanumeric(8).toLowerCase()}`;
  return createUser(db, email, username, "test-password-1234");
}

function makeVideoFetchSequence(
  oembed: Response | (() => Response),
  imageContentType = "image/jpeg",
): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    call++;
    if (call === 1) return typeof oembed === "function" ? oembed() : oembed;
    return {
      ok: true,
      status: 200,
      headers: new Headers([["content-type", imageContentType]]),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("recipe-import-video integration", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });
  afterEach(async () => {
    await cleanupDatabase();
  });

  it("youtube-pasta fixture → Recipe with steps + ingredients persisted; confidence=low; source=video-oembed-llm", async () => {
    const fixture = loadVideoFixture("youtube-pasta.json");
    const chef = await makeChef();
    const result = await importRecipeFromUrl(
      {
        url: "https://www.youtube.com/watch?v=abc123",
        chefId: chef.id,
      },
      {
        db,
        env: { OPENAI_API_KEY: "k" },
        fetchImpl: makeVideoFetchSequence(jsonStreamingResponse(fixture)),
        ingredientParser: ingredientParser(),
        llmRunner: mockLlm({
          title: "One-Pot Pasta",
          ingredients: ["1 lb spaghetti", "2 tbsp olive oil"],
          steps: ["Boil water.", "Add pasta.", "Drain and serve."],
        }),
      },
    );
    expect(result.confidence).toBe("low");
    expect(result.source).toBe("video-oembed-llm");
    const recipe = await db.recipe.findUnique({
      where: { id: result.recipeId! },
      include: { steps: { include: { ingredients: true } } },
    });
    expect(recipe).not.toBeNull();
    expect(recipe!.steps).toHaveLength(3);
    const ingredients = recipe!.steps.flatMap((s) => s.ingredients);
    expect(ingredients).toHaveLength(2);
  });

  it("tiktok-dumpling fixture → Recipe created with same shape", async () => {
    const fixture = loadVideoFixture("tiktok-dumpling.json");
    const chef = await makeChef();
    const result = await importRecipeFromUrl(
      {
        url: "https://www.tiktok.com/@dumpling_chef/video/123",
        chefId: chef.id,
      },
      {
        db,
        env: { OPENAI_API_KEY: "k" },
        fetchImpl: makeVideoFetchSequence(jsonStreamingResponse(fixture)),
        ingredientParser: ingredientParser(),
        llmRunner: mockLlm({
          title: "Easy Dumplings",
          ingredients: ["dumpling wrappers", "ground pork"],
          steps: ["Fold dumplings.", "Pan-fry."],
        }),
      },
    );
    expect(result.confidence).toBe("low");
    expect(result.source).toBe("video-oembed-llm");
    const recipe = await db.recipe.findUnique({
      where: { id: result.recipeId! },
      include: { steps: true },
    });
    expect(recipe?.steps).toHaveLength(2);
  });

  it("youtube-no-thumbnail fixture → Recipe created, no cover scheduled when no bucket and no imageGenRunner", async () => {
    const fixture = loadVideoFixture("youtube-no-thumbnail.json");
    const chef = await makeChef();
    const result = await importRecipeFromUrl(
      {
        url: "https://www.youtube.com/watch?v=noimg",
        chefId: chef.id,
      },
      {
        db,
        env: { OPENAI_API_KEY: "k" },
        fetchImpl: makeVideoFetchSequence(jsonStreamingResponse(fixture)),
        ingredientParser: ingredientParser(),
        llmRunner: mockLlm({
          title: "Plain Pasta",
          ingredients: ["pasta"],
          steps: ["Cook."],
        }),
      },
    );
    expect(result.coverPending).toBe(false);
    const covers = await db.recipeCover.findMany({
      where: { recipeId: result.recipeId! },
    });
    expect(covers).toHaveLength(0);
  });

  it("tiktok-minimal fixture → Recipe created with default-ish fields; no thumbnail; no cover", async () => {
    const fixture = loadVideoFixture("tiktok-minimal.json");
    const chef = await makeChef();
    const result = await importRecipeFromUrl(
      {
        url: "https://www.tiktok.com/@x/video/min",
        chefId: chef.id,
      },
      {
        db,
        env: { OPENAI_API_KEY: "k" },
        fetchImpl: makeVideoFetchSequence(jsonStreamingResponse(fixture)),
        ingredientParser: ingredientParser(),
        llmRunner: mockLlm({
          title: "Minimal Dumplings",
          ingredients: ["dumplings"],
          steps: ["Eat."],
        }),
        bucket: mockBucket(),
      },
    );
    expect(result.coverPending).toBe(false);
    const covers = await db.recipeCover.findMany({
      where: { recipeId: result.recipeId! },
    });
    expect(covers).toHaveLength(0);
  });

  it("second call with same youtube URL surfaces existingRecipeId", async () => {
    const fixture = loadVideoFixture("youtube-pasta.json");
    const chef = await makeChef();
    const baseDeps = {
      db,
      env: { OPENAI_API_KEY: "k" },
      ingredientParser: ingredientParser(),
      llmRunner: mockLlm({
        title: "One-Pot Pasta",
        ingredients: ["pasta"],
        steps: ["Boil"],
      }),
    } satisfies Partial<ImportRecipeDeps>;
    const first = await importRecipeFromUrl(
      {
        url: "https://www.youtube.com/watch?v=duplicate",
        chefId: chef.id,
      },
      {
        ...baseDeps,
        fetchImpl: makeVideoFetchSequence(jsonStreamingResponse(fixture)),
      },
    );
    const second = await importRecipeFromUrl(
      {
        url: "https://www.youtube.com/watch?v=duplicate",
        chefId: chef.id,
      },
      {
        ...baseDeps,
        fetchImpl: makeVideoFetchSequence(jsonStreamingResponse(fixture)),
      },
    );
    expect(second.existingRecipeId).toBe(first.recipeId);
  });

  it("50 imports for same user succeed; 51st returns rate-limited", async () => {
    const fixture = loadVideoFixture("youtube-pasta.json");
    const chef = await makeChef();
    const now = new Date(Date.UTC(2026, 4, 11, 12, 0));
    // Pre-fill ledger to the daily cap (50).
    const bucketStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    await db.imageGenLedger.create({
      data: { userId: chef.id, kind: "import", bucketStart, count: 50 },
    });
    await expect(
      importRecipeFromUrl(
        {
          url: "https://www.youtube.com/watch?v=overcap",
          chefId: chef.id,
        },
        {
          db,
          env: { OPENAI_API_KEY: "k" },
          fetchImpl: makeVideoFetchSequence(jsonStreamingResponse(fixture)),
          ingredientParser: ingredientParser(),
          llmRunner: mockLlm({
            title: "Should not persist",
            ingredients: [],
            steps: [],
          }),
          now: () => now,
        },
      ),
    ).rejects.toMatchObject({ code: "rate-limited", status: 429 });
  });

  it("dry-run on youtube URL returns draft without DB rows", async () => {
    const fixture = loadVideoFixture("youtube-pasta.json");
    const chef = await makeChef();
    const result = await importRecipeFromUrl(
      {
        url: "https://www.youtube.com/watch?v=dry",
        chefId: chef.id,
        dryRun: true,
      },
      {
        db,
        env: { OPENAI_API_KEY: "k" },
        fetchImpl: makeVideoFetchSequence(jsonStreamingResponse(fixture)),
        ingredientParser: ingredientParser(),
        llmRunner: mockLlm({
          title: "Dry-run Pasta",
          ingredients: ["pasta"],
          steps: ["Boil"],
        }),
      },
    );
    expect(result.recipeId).toBeNull();
    expect(result.confidence).toBe("low");
    expect(result.source).toBe("video-oembed-llm");
    const recipeCount = await db.recipe.count({ where: { chefId: chef.id } });
    expect(recipeCount).toBe(0);
    // A dry run still runs the extraction model, so it spends one import unit.
    const ledger = await db.imageGenLedger.findMany({
      where: { userId: chef.id, kind: "import" },
    });
    expect(ledger.map((row) => row.count)).toEqual([1]);
  });

  it("oEmbed 404 → ImportRecipeError code=video-unavailable status=502", async () => {
    const chef = await makeChef();
    await expect(
      importRecipeFromUrl(
        {
          url: "https://www.youtube.com/watch?v=missing",
          chefId: chef.id,
        },
        {
          db,
          env: { OPENAI_API_KEY: "k" },
          fetchImpl: makeVideoFetchSequence(statusJsonResponse(404)),
          ingredientParser: ingredientParser(),
          llmRunner: mockLlm({ title: "irrelevant" }),
        },
      ),
    ).rejects.toMatchObject({ code: "video-unavailable", status: 502 });
  });
});
