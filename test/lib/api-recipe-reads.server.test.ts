// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Request as UndiciRequest } from "undici";
import { loadApiRecipeFromD1, loadApiRecipeWithPrisma } from "~/lib/api-recipe-reads.server";
import { handleApiV1Request } from "~/lib/api-v1.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// GET /api/v1/recipes/:id with a D1 binding reads the recipe in one batch, and must return
// exactly what the Prisma read (still used without a binding) returns.

let db: PrismaClient;
let d1: SqliteD1;

const at = (minute: number) => new Date(Date.UTC(2026, 8, 1, 12, minute));

async function seedRecipe() {
  const chef = await db.user.create({ data: createTestUser() });
  const original = await db.user.create({ data: createTestUser() });
  const source = await db.recipe.create({ data: { title: "Grandma's bread", chefId: original.id, deletedAt: at(1) } });
  const recipe = await db.recipe.create({
    data: { title: "Bread", description: "Crusty", servings: "2", sourceUrl: "https://example.com/bread", chefId: chef.id, sourceRecipeId: source.id },
  });
  const cover = await db.recipeCover.create({
    data: { recipeId: recipe.id, imageUrl: "https://example.com/c.jpg", stylizedImageUrl: "https://example.com/s.jpg", sourceType: "chef-upload" },
  });
  await db.recipe.update({ where: { id: recipe.id }, data: { activeCoverId: cover.id, activeCoverVariant: "stylized" } });

  const cup = await db.unit.upsert({ where: { name: "cup" }, update: {}, create: { name: "cup" } });
  const gram = await db.unit.upsert({ where: { name: "g" }, update: {}, create: { name: "g" } });
  const refs = await Promise.all(["flour", "water", "salt"].map((name) =>
    db.ingredientRef.upsert({ where: { name }, update: {}, create: { name } })));
  // Steps are created out of order; the serializer orders them by number.
  for (const [stepNum, stepTitle] of [[2, "Rest"], [1, null], [3, "Bake"]] as const) {
    await db.recipeStep.create({
      data: { recipeId: recipe.id, stepNum, stepTitle, description: `Step ${stepNum}`, duration: stepNum === 1 ? null : stepNum * 10 },
    });
  }
  for (const [stepNum, ref, unit, quantity] of [[1, 1, cup, 1.5], [1, 0, gram, 500], [1, 0, cup, 2], [3, 2, gram, 10]] as const) {
    await db.ingredient.create({ data: { recipeId: recipe.id, stepNum, quantity, unitId: unit.id, ingredientRefId: refs[ref]!.id } });
  }
  await db.stepOutputUse.create({ data: { recipeId: recipe.id, outputStepNum: 2, inputStepNum: 3 } });
  await db.stepOutputUse.create({ data: { recipeId: recipe.id, outputStepNum: 1, inputStepNum: 3 } });
  for (const [title, minute] of [["Later", 5], ["Earlier", 2]] as const) {
    const cookbook = await db.cookbook.create({ data: { title, authorId: chef.id } });
    await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: chef.id, createdAt: at(minute) } });
  }
  const plain = await db.recipe.create({ data: { title: "Plain", chefId: chef.id } });
  const deleted = await db.recipe.create({ data: { title: "Gone", chefId: chef.id, deletedAt: at(3) } });
  return { recipe, plain, deleted };
}

describe("API recipe reads", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("returns what the Prisma read returns, in one D1 batch", async () => {
    const { recipe, plain, deleted } = await seedRecipe();
    for (const id of [recipe.id, plain.id, deleted.id, "missing"]) {
      const before = d1.roundTrips();
      const fromD1 = await loadApiRecipeFromD1(d1.binding, id);
      expect(d1.roundTrips() - before).toBe(1);
      expect(fromD1).toEqual(await loadApiRecipeWithPrisma(db, id));
    }

    const full = (await loadApiRecipeFromD1(d1.binding, recipe.id))!;
    expect(full.sourceRecipe?.title).toBe("Grandma's bread");
    expect(full.sourceRecipe?.deletedAt).toEqual(at(1));
    expect(full.activeCover?.stylizedImageUrl).toBe("https://example.com/s.jpg");
    const stepThree = full.steps.find((step) => step.stepNum === 3)!;
    expect(stepThree.usingSteps.map((use) => use.outputOfStep)).toEqual([
      { stepNum: 1, stepTitle: null },
      { stepNum: 2, stepTitle: "Rest" },
    ]);
    expect(full.steps.find((step) => step.stepNum === 1)!.ingredients).toHaveLength(3);
    expect(full.cookbooks.map((entry) => entry.cookbook.title)).toEqual(["Earlier", "Later"]);
    expect(await loadApiRecipeFromD1(d1.binding, plain.id)).toMatchObject({ sourceRecipe: null, activeCover: null, steps: [], cookbooks: [] });
    expect(await loadApiRecipeFromD1(d1.binding, deleted.id)).toBeNull();
  });

  it("fails closed on a D1 error or a malformed row", async () => {
    const failing = { prepare: d1.binding.prepare, batch: async () => { throw new Error("D1_ERROR: lost"); } };
    await expect(loadApiRecipeFromD1(failing as never, "r")).rejects.toThrow("D1_ERROR: lost");

    const rowsFor = (rows: unknown[][]) => ({
      prepare: d1.binding.prepare,
      batch: async () => rows.map((results) => ({ results })),
    });
    const recipe = {
      id: "r", title: "t", description: null, servings: null, sourceUrl: null, activeCoverId: null, activeCoverVariant: null,
      coverMode: "auto", createdAt: 1, updatedAt: 1, chef_id: "u", chef_username: "chef", source_id: null, cover_id: null,
    };
    await expect(loadApiRecipeFromD1(rowsFor([[{ ...recipe, chef_username: 1 }], [], [], [], []]) as never, "r"))
      .rejects.toThrow("D1 column chef_username");
    const step = { id: "s", stepNum: 1, stepTitle: null, description: "d", duration: null };
    await expect(loadApiRecipeFromD1(rowsFor([[recipe], [step], [{ id: "i", stepNum: 1, quantity: "2", refName: "x", unitName: "g" }], [], []]) as never, "r"))
      .rejects.toThrow("D1 column quantity");
    await expect(loadApiRecipeFromD1(rowsFor([[recipe], [step], [], [{ id: "u", inputStepNum: 1, outputStepNum: "1", outputStepTitle: null }], []]) as never, "r"))
      .rejects.toThrow("D1 column outputStepNum");
  });

  it("serves GET /api/v1/recipes/:id from one D1 batch with the same response as Prisma", async () => {
    const { recipe } = await seedRecipe();
    const get = async (context: object) => {
      const response = await handleApiV1Request({
        request: new UndiciRequest(`http://localhost/api/v1/recipes/${recipe.id}`, {
          headers: { "X-Request-Id": "req_api_recipe_reads" },
        }) as unknown as Request,
        params: { "*": `recipes/${recipe.id}` },
        context: context as never,
      });
      expect(response.status).toBe(200);
      return response.text();
    };

    const viaPrisma = await get({ cloudflare: { env: null } });
    const before = d1.roundTrips();
    const viaD1 = await get({ cloudflare: { env: { DB: d1.binding } } });
    expect(d1.roundTrips() - before).toBe(1);
    expect(viaD1).toBe(viaPrisma);
    expect(JSON.parse(viaD1).data.recipe.steps.map((step: { stepNum: number }) => step.stepNum)).toEqual([1, 2, 3]);
  });
});
