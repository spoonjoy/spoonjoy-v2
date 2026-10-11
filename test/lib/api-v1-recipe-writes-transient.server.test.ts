// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createNativeRecipeStep,
  createNativeRecipeStepIngredient,
  deleteNativeRecipeStep,
  deleteNativeRecipeStepIngredient,
  reorderNativeRecipeStep,
  replaceNativeRecipeStepOutputUses,
  updateNativeRecipeStep,
} from "~/lib/api-v1-recipe-steps.server";
import { deleteNativeRecipe, updateNativeRecipe } from "~/lib/api-v1-recipe-writes.server";
import { D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { flakyD1, type FlakyOutcome } from "../helpers/flaky-d1";
import { flakyPrisma } from "../helpers/flaky-prisma";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// The REST API's recipe and recipe-step writes when D1's connection drops: before the batch
// reaches the database ("lost"), after it committed ("lost-answer"), or committing just before
// the retry ("late"). Each must end with the rows and the answer one clean run gives, never a
// race answer against its own commit, and a write whose every try is lost gives up with
// D1WriteUnavailableError, writing nothing.

let db: PrismaClient;
let d1: SqliteD1;
let chefId: string;

const OLD = new Date("2026-01-01T00:00:00.000Z");
const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];
const LOST_FOUR: FlakyOutcome[] = ["lost", "lost", "lost", "lost"];

async function seedRecipe() {
  const recipe = await db.recipe.create({ data: { title: `Crepes ${crypto.randomUUID()}`, chefId } });
  const cup = await db.unit.upsert({ where: { name: "cup" }, update: {}, create: { name: "cup" } });
  const flour = await db.ingredientRef.upsert({ where: { name: "flour" }, update: {}, create: { name: "flour" } });
  const steps = [];
  for (const [stepNum, stepTitle] of [[1, "Mix"], [2, "Rest"], [3, "Cook"]] as const) {
    steps.push(await db.recipeStep.create({ data: { recipeId: recipe.id, stepNum, stepTitle, description: `${stepTitle} it` } }));
  }
  const ingredient = await db.ingredient.create({
    data: { recipeId: recipe.id, stepNum: 1, quantity: 2, unitId: cup.id, ingredientRefId: flour.id },
  });
  await db.stepOutputUse.create({ data: { recipeId: recipe.id, outputStepNum: 1, inputStepNum: 3 } });
  await db.recipe.update({ where: { id: recipe.id }, data: { updatedAt: OLD } });
  return { recipe, steps, ingredient };
}

async function idempotencyKeyId() {
  const key = await db.apiIdempotencyKey.create({
    data: { userId: chefId, clientKey: "test", key: crypto.randomUUID(), operation: "test", requestHash: "hash", expiresAt: new Date("2099-01-01") },
  });
  return key.id;
}

async function stepTitles(recipeId: string) {
  const steps = await db.recipeStep.findMany({ where: { recipeId }, orderBy: { stepNum: "asc" } });
  return steps.map((step) => step.stepTitle);
}

async function ingredientNames(recipeId: string) {
  const rows = await db.ingredient.findMany({ where: { recipeId }, include: { ingredientRef: true } });
  return rows.map((row) => `${row.stepNum}:${row.ingredientRef.name}`).sort();
}

describe("REST recipe writes when D1's connection drops", () => {
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

  describe("updateNativeRecipe", () => {
    const UPDATE = /UPDATE "Cookbook"/;

    it.each(OUTCOMES)("updates once with an expected updatedAt when its batch is %s", async (outcome) => {
      const { recipe } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(UPDATE, outcome);

      await expect(updateNativeRecipe(db, chefId, recipe.id, {
        clientMutationId: "u", fields: { title: "Renamed" }, expectedUpdatedAt: OLD,
      }, flaky.binding)).resolves.toEqual({ ok: true, status: 200, data: { recipeId: recipe.id, updated: true } });

      expect(flaky.failures()).toBe(1);
      expect((await db.recipe.findUniqueOrThrow({ where: { id: recipe.id } })).title).toBe("Renamed");
    });

    it("gives up after four lost tries, writing nothing", async () => {
      const { recipe } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(UPDATE, ...LOST_FOUR);

      await expect(updateNativeRecipe(db, chefId, recipe.id, { clientMutationId: "u", fields: { title: "Renamed" } }, flaky.binding))
        .rejects.toBeInstanceOf(D1WriteUnavailableError);
      expect((await db.recipe.findUniqueOrThrow({ where: { id: recipe.id } })).title).toBe(recipe.title);
    });
  });

  describe("deleteNativeRecipe", () => {
    const DELETE = /SET "deletedAt"/;

    it.each(OUTCOMES)("deletes once and answers the deleted recipe when its batch is %s", async (outcome) => {
      const { recipe } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(DELETE, outcome);

      const result = await deleteNativeRecipe(db, chefId, recipe.id, flaky.binding);

      expect(flaky.failures()).toBe(1);
      const deleted = await db.recipe.findUniqueOrThrow({ where: { id: recipe.id } });
      expect(result).toEqual({
        ok: true,
        status: 200,
        data: { recipe: { id: recipe.id, title: recipe.title, deletedAt: deleted.deletedAt, updatedAt: deleted.updatedAt } },
      });
      expect(await db.nativeSyncTombstone.count({ where: { resourceId: recipe.id } })).toBe(1);
    });

    it("gives up after four lost tries, deleting nothing", async () => {
      const { recipe } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(DELETE, ...LOST_FOUR);

      await expect(deleteNativeRecipe(db, chefId, recipe.id, flaky.binding)).rejects.toBeInstanceOf(D1WriteUnavailableError);
      expect((await db.recipe.findUniqueOrThrow({ where: { id: recipe.id } })).deletedAt).toBeNull();
    });
  });

  describe("createNativeRecipeStep", () => {
    const CREATE = /INSERT INTO "RecipeStep"/;
    const input = {
      clientMutationId: "s",
      stepTitle: "Serve",
      description: "Fold and serve",
      duration: null,
      ingredients: [{ quantity: 1, unit: "Tbsp", ingredientName: "Sugar" }],
      outputStepNums: [3],
    };

    it.each(OUTCOMES)("creates the step once when its batch is %s", async (outcome) => {
      const { recipe } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(CREATE, outcome);

      await expect(createNativeRecipeStep(db, chefId, recipe.id, input, { stepId: "api-step", d1: flaky.binding }))
        .resolves.toEqual({ ok: true, status: 201, data: { recipeId: recipe.id, stepId: "api-step", stepNum: 4 } });

      expect(flaky.failures()).toBe(1);
      expect(await stepTitles(recipe.id)).toEqual(["Mix", "Rest", "Cook", "Serve"]);
      expect(await ingredientNames(recipe.id)).toEqual(["1:flour", "4:sugar"]);
    });

    it("gives up after four lost tries, creating nothing", async () => {
      const { recipe } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(CREATE, ...LOST_FOUR);

      await expect(createNativeRecipeStep(db, chefId, recipe.id, input, { stepId: "api-step", d1: flaky.binding }))
        .rejects.toBeInstanceOf(D1WriteUnavailableError);
      expect(await stepTitles(recipe.id)).toEqual(["Mix", "Rest", "Cook"]);
    });
  });

  describe("updateNativeRecipeStep", () => {
    const UPDATE = /UPDATE "RecipeStep" SET "stepTitle"/;

    it.each(OUTCOMES)("saves the step when its batch is %s", async (outcome) => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(UPDATE, outcome);

      await expect(updateNativeRecipeStep(db, chefId, recipe.id, steps[2]!.id, {
        clientMutationId: "u", fields: { stepTitle: "Cook slowly", outputStepNums: [1, 2] },
      }, { d1: flaky.binding })).resolves.toEqual({ ok: true, status: 200, data: { recipeId: recipe.id, stepId: steps[2]!.id, updated: true } });

      expect(flaky.failures()).toBe(1);
      expect(await stepTitles(recipe.id)).toEqual(["Mix", "Rest", "Cook slowly"]);
      expect(await db.stepOutputUse.count({ where: { recipeId: recipe.id } })).toBe(2);
    });

    it("gives up after four lost tries, saving nothing", async () => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(UPDATE, ...LOST_FOUR);

      await expect(updateNativeRecipeStep(db, chefId, recipe.id, steps[2]!.id, {
        clientMutationId: "u", fields: { stepTitle: "Cook slowly" },
      }, { d1: flaky.binding })).rejects.toBeInstanceOf(D1WriteUnavailableError);
      expect(await stepTitles(recipe.id)).toEqual(["Mix", "Rest", "Cook"]);
    });
  });

  describe("deleteNativeRecipeStep", () => {
    const DELETE = /DELETE FROM "RecipeStep"/;

    it.each(OUTCOMES)("deletes the step, with its tombstone, when its batch is %s", async (outcome) => {
      const { recipe, steps } = await seedRecipe();
      const keyId = await idempotencyKeyId();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(DELETE, outcome);

      await expect(deleteNativeRecipeStep(db, chefId, recipe.id, steps[2]!.id, {
        tombstone: { idempotencyKeyId: keyId, operation: "recipes.steps.delete" }, d1: flaky.binding,
      })).resolves.toEqual({ ok: true, status: 200, data: { recipeId: recipe.id, step: { id: steps[2]!.id, stepNum: 3 } } });

      expect(flaky.failures()).toBe(1);
      expect(await stepTitles(recipe.id)).toEqual(["Mix", "Rest"]);
      expect(await db.apiMutationTombstone.count({ where: { idempotencyKeyId: keyId } })).toBe(1);
    });

    it("gives up after four lost tries, deleting nothing", async () => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(DELETE, ...LOST_FOUR);

      await expect(deleteNativeRecipeStep(db, chefId, recipe.id, steps[2]!.id, { d1: flaky.binding }))
        .rejects.toBeInstanceOf(D1WriteUnavailableError);
      expect(await stepTitles(recipe.id)).toEqual(["Mix", "Rest", "Cook"]);
    });
  });

  describe("createNativeRecipeStepIngredient", () => {
    const CREATE = /INSERT INTO "Ingredient"/;
    const input = { clientMutationId: "i", quantity: 3, unit: "Pinch", ingredientName: "Salt" };

    it.each(OUTCOMES)("adds the ingredient once when its batch is %s", async (outcome) => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(CREATE, outcome);

      await expect(createNativeRecipeStepIngredient(db, chefId, recipe.id, steps[1]!.id, input, { ingredientId: "api-ingredient", d1: flaky.binding }))
        .resolves.toEqual({ ok: true, status: 201, data: { recipeId: recipe.id, stepId: steps[1]!.id, ingredientId: "api-ingredient" } });

      expect(flaky.failures()).toBe(1);
      expect(await ingredientNames(recipe.id)).toEqual(["1:flour", "2:salt"]);
    });

    it("gives up after four lost tries, adding nothing", async () => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(CREATE, ...LOST_FOUR);

      await expect(createNativeRecipeStepIngredient(db, chefId, recipe.id, steps[1]!.id, input, { d1: flaky.binding }))
        .rejects.toBeInstanceOf(D1WriteUnavailableError);
      expect(await ingredientNames(recipe.id)).toEqual(["1:flour"]);
    });
  });

  describe("deleteNativeRecipeStepIngredient", () => {
    const DELETE = /DELETE FROM "Ingredient"/;

    it.each(OUTCOMES)("deletes the ingredient, with its tombstone, when its batch is %s", async (outcome) => {
      const { recipe, steps, ingredient } = await seedRecipe();
      const keyId = await idempotencyKeyId();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(DELETE, outcome);

      await expect(deleteNativeRecipeStepIngredient(db, chefId, recipe.id, steps[0]!.id, ingredient.id, {
        tombstone: { idempotencyKeyId: keyId, operation: "recipes.steps.ingredients.delete" }, d1: flaky.binding,
      })).resolves.toEqual({ ok: true, status: 200, data: { recipeId: recipe.id, stepId: steps[0]!.id, ingredient: { id: ingredient.id } } });

      expect(flaky.failures()).toBe(1);
      expect(await ingredientNames(recipe.id)).toEqual([]);
      expect(await db.apiMutationTombstone.count({ where: { idempotencyKeyId: keyId } })).toBe(1);
    });

    it("gives up after four lost tries, deleting nothing", async () => {
      const { recipe, steps, ingredient } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(DELETE, ...LOST_FOUR);

      await expect(deleteNativeRecipeStepIngredient(db, chefId, recipe.id, steps[0]!.id, ingredient.id, { d1: flaky.binding }))
        .rejects.toBeInstanceOf(D1WriteUnavailableError);
      expect(await ingredientNames(recipe.id)).toEqual(["1:flour"]);
    });
  });

  describe("reorderNativeRecipeStep", () => {
    const REORDER = /SET "stepNum" = \?/;

    it.each(OUTCOMES)("moves the step once, never back, when its batch is %s", async (outcome) => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(REORDER, outcome);

      await expect(reorderNativeRecipeStep(db, chefId, recipe.id, { clientMutationId: "r", stepId: steps[1]!.id, toStepNum: 1 }, { d1: flaky.binding }))
        .resolves.toEqual({ ok: true, status: 200, data: { recipeId: recipe.id, stepId: steps[1]!.id, reordered: true } });

      expect(flaky.failures()).toBe(1);
      expect(await stepTitles(recipe.id)).toEqual(["Rest", "Mix", "Cook"]);
    });

    it("gives up after four lost tries, moving nothing", async () => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(REORDER, ...LOST_FOUR);

      await expect(reorderNativeRecipeStep(db, chefId, recipe.id, { clientMutationId: "r", stepId: steps[1]!.id, toStepNum: 1 }, { d1: flaky.binding }))
        .rejects.toBeInstanceOf(D1WriteUnavailableError);
      expect(await stepTitles(recipe.id)).toEqual(["Mix", "Rest", "Cook"]);
    });

    it.each(OUTCOMES)("records an unchanged order's tombstone once when its upsert is %s", async (outcome) => {
      const { recipe, steps } = await seedRecipe();
      const keyId = await idempotencyKeyId();
      const flaky = flakyPrisma(db);
      flaky.failNext("apiMutationTombstone", "upsert", outcome);

      await expect(reorderNativeRecipeStep(flaky.db, chefId, recipe.id, { clientMutationId: "r", stepId: steps[1]!.id, toStepNum: 2 }, {
        tombstone: { idempotencyKeyId: keyId, operation: "recipes.steps.reorder" },
      })).resolves.toEqual({ ok: true, status: 200, data: { recipeId: recipe.id, stepId: steps[1]!.id, reordered: false } });

      expect(flaky.failures()).toBe(1);
      expect(await db.apiMutationTombstone.count({ where: { idempotencyKeyId: keyId } })).toBe(1);
    });

    it("gives up on an unchanged order's tombstone after four lost tries", async () => {
      const { recipe, steps } = await seedRecipe();
      const keyId = await idempotencyKeyId();
      const flaky = flakyPrisma(db);
      flaky.failNext("apiMutationTombstone", "upsert", ...LOST_FOUR);

      await expect(reorderNativeRecipeStep(flaky.db, chefId, recipe.id, { clientMutationId: "r", stepId: steps[1]!.id, toStepNum: 2 }, {
        tombstone: { idempotencyKeyId: keyId, operation: "recipes.steps.reorder" },
      })).rejects.toBeInstanceOf(D1WriteUnavailableError);
      expect(await db.apiMutationTombstone.count({ where: { idempotencyKeyId: keyId } })).toBe(0);
    });
  });

  describe("replaceNativeRecipeStepOutputUses", () => {
    const REPLACE = /DELETE FROM "StepOutputUse"/;

    it.each(OUTCOMES)("replaces the step's output uses when its batch is %s", async (outcome) => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(REPLACE, outcome);

      await expect(replaceNativeRecipeStepOutputUses(db, chefId, recipe.id, {
        clientMutationId: "o", inputStepId: steps[2]!.id, outputStepNums: [2],
      }, { d1: flaky.binding })).resolves.toEqual({ ok: true, status: 200, data: { recipeId: recipe.id, stepId: steps[2]!.id, replaced: true } });

      expect(flaky.failures()).toBe(1);
      const uses = await db.stepOutputUse.findMany({ where: { recipeId: recipe.id } });
      expect(uses.map((use) => `${use.outputStepNum}->${use.inputStepNum}`)).toEqual(["2->3"]);
    });

    it("gives up after four lost tries, replacing nothing", async () => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(REPLACE, ...LOST_FOUR);

      await expect(replaceNativeRecipeStepOutputUses(db, chefId, recipe.id, {
        clientMutationId: "o", inputStepId: steps[2]!.id, outputStepNums: [2],
      }, { d1: flaky.binding })).rejects.toBeInstanceOf(D1WriteUnavailableError);
      const uses = await db.stepOutputUse.findMany({ where: { recipeId: recipe.id } });
      expect(uses.map((use) => `${use.outputStepNum}->${use.inputStepNum}`)).toEqual(["1->3"]);
    });
  });
});
