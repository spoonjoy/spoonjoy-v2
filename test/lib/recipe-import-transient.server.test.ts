// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { getLocalDb } from "~/lib/db.server";
import { importRecipeFromSource } from "~/lib/recipe-import.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { flakyD1, type FlakyOutcome } from "../helpers/flaky-d1";
import { flakyPrisma } from "../helpers/flaky-prisma";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// A recipe import when D1's connection drops: before the recipe batch reaches the database
// ("lost"), after it committed ("lost-answer"), or committing just before the retry ("late").
// The import must write one recipe under its title, never a second copy or a title race against
// its own commit, and give up with D1WriteUnavailableError when every try is lost. The imported
// cover's activation runs again in the same way.

let db: PrismaClient;
let d1: SqliteD1;
let chefId: string;

const RECIPE_BATCH = /INSERT INTO "Recipe" \(/;

function jsonLd(name: string, image?: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name,
    ...(image ? { image } : {}),
    recipeIngredient: ["2 cups rice"],
    recipeInstructions: [{ "@type": "HowToStep", text: "Cook the rice" }],
  };
}

const ingredientParser = async (text: string) => [{ quantity: 1, unit: "whole", ingredientName: text }];

describe("recipe import when D1's connection drops", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
    chefId = (await db.user.create({ data: createTestUser() })).id;
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it.each<FlakyOutcome>(["lost", "lost-answer", "late"])("writes one recipe under its own title when its batch is %s", async (outcome) => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(RECIPE_BATCH, outcome);

    const imported = await importRecipeFromSource(
      { chefId, source: { type: "json-ld", jsonLd: jsonLd("Lemon Rice"), sourceUrl: "https://example.com/rice" } },
      { db, env: { DB: flaky.binding }, ingredientParser },
    );

    expect(flaky.failures()).toBe(1);
    const recipes = await db.recipe.findMany({ where: { chefId }, include: { steps: true } });
    expect(recipes).toHaveLength(1);
    expect(recipes[0]).toMatchObject({ id: imported.recipeId, title: "Lemon Rice" });
    expect(recipes[0]!.steps).toHaveLength(1);
  });

  it("gives up after four lost tries, writing no recipe", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(RECIPE_BATCH, "lost", "lost", "lost", "lost");

    await expect(importRecipeFromSource(
      { chefId, source: { type: "json-ld", jsonLd: jsonLd("Lemon Rice"), sourceUrl: "https://example.com/rice" } },
      { db, env: { DB: flaky.binding }, ingredientParser },
    )).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await db.recipe.count({ where: { chefId } })).toBe(0);
  });

  describe("the imported cover", () => {
    const bucket = () => ({ put: vi.fn(async () => ({})) }) as unknown as R2Bucket;
    const imageFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers([["content-type", "image/png"]]),
      arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).buffer,
    })) as unknown as typeof fetch;

    async function importWithCover(database: PrismaClient) {
      const pending: Promise<unknown>[] = [];
      const logger = { error: vi.fn() };
      const imported = await importRecipeFromSource(
        { chefId, source: { type: "json-ld", jsonLd: jsonLd("Paella", "https://images.example.com/paella.png"), sourceUrl: "https://example.com/paella" } },
        {
          db: database,
          env: { DB: d1.binding },
          ingredientParser,
          bucket: bucket(),
          fetchImpl: imageFetch,
          waitUntil: (promise) => pending.push(promise),
          logger,
        },
      );
      await Promise.all(pending);
      return { recipe: await db.recipe.findUniqueOrThrow({ where: { id: imported.recipeId! }, include: { covers: true } }), logger };
    }

    it.each<FlakyOutcome>(["lost", "lost-answer", "late"])("is made the active cover when its activation is %s", async (outcome) => {
      const flaky = flakyPrisma(db);
      flaky.failNext("recipe", "updateMany", outcome);

      const { recipe, logger } = await importWithCover(flaky.db);

      expect(flaky.failures()).toBe(1);
      expect(logger.error).not.toHaveBeenCalled();
      expect(recipe.covers).toHaveLength(1);
      expect(recipe).toMatchObject({ activeCoverId: recipe.covers[0]!.id, activeCoverVariant: "image", coverMode: "auto" });
    });

    it("is logged, and left inactive, when every activation try is lost", async () => {
      const flaky = flakyPrisma(db);
      flaky.failNext("recipe", "updateMany", "lost", "lost", "lost", "lost");

      const { recipe, logger } = await importWithCover(flaky.db);

      expect(logger.error).toHaveBeenCalledWith("recipe-import cover upload failed", expect.any(D1WriteUnavailableError));
      expect(recipe.activeCoverId).toBeNull();
    });
  });
});
