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
import {
  createNativeRecipe,
  deleteNativeRecipe,
  forkNativeRecipe,
  updateNativeRecipe,
} from "~/lib/api-v1-recipe-writes.server";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { getLocalDb } from "~/lib/db.server";
import { ACTIVE_RECIPE_TITLE_CONFLICT_ERROR } from "~/lib/recipe-title-uniqueness.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// The REST API's recipe and recipe-step writes with a D1 binding: each runs as one D1 batch
// (through the SQLite-backed fake binding) and must leave the same rows as its Prisma
// version, which still runs where there is no binding. Each case runs the write through
// Prisma on one recipe and through D1 on an identical twin, then compares the two.

let db: PrismaClient;
let d1: SqliteD1;
let chefId: string;

const OLD = new Date("2026-01-01T00:00:00.000Z");

let seeds = 0;

async function seedRecipe(title: string) {
  seeds += 1;
  const recipe = await db.recipe.create({ data: { title, description: "Seeded", servings: "2", chefId } });
  const cup = await db.unit.upsert({ where: { name: "cup" }, update: {}, create: { name: "cup" } });
  const refs = await Promise.all(["flour", "milk", "egg"].map((name) =>
    db.ingredientRef.upsert({ where: { name }, update: {}, create: { name } })));
  const steps = [];
  for (const [stepNum, stepTitle] of [[1, "Mix"], [2, "Rest"], [3, "Bake"]] as const) {
    steps.push(await db.recipeStep.create({
      data: { recipeId: recipe.id, stepNum, stepTitle, description: `${stepTitle} it`, duration: stepNum * 5 },
    }));
  }
  const ingredients = [];
  for (const [stepNum, ref] of [[1, 0], [1, 1], [2, 2]] as const) {
    ingredients.push(await db.ingredient.create({
      data: { recipeId: recipe.id, stepNum, quantity: stepNum, unitId: cup.id, ingredientRefId: refs[ref]!.id },
    }));
  }
  await db.stepOutputUse.create({ data: { recipeId: recipe.id, outputStepNum: 1, inputStepNum: 3 } });
  const cookbook = await db.cookbook.create({ data: { title: `Book ${seeds}`, authorId: chefId } });
  await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: chefId } });
  await db.cookbook.update({ where: { id: cookbook.id }, data: { updatedAt: OLD } });
  await db.recipe.update({ where: { id: recipe.id }, data: { updatedAt: OLD } });
  return { recipe, steps, ingredients, cookbook };
}

type Seeded = Awaited<ReturnType<typeof seedRecipe>>;

async function graph(seeded: Seeded) {
  const recipe = await db.recipe.findUniqueOrThrow({
    where: { id: seeded.recipe.id },
    include: {
      steps: {
        orderBy: { stepNum: "asc" },
        include: { ingredients: { include: { unit: true, ingredientRef: true } } },
      },
    },
  });
  const uses = await db.stepOutputUse.findMany({ where: { recipeId: recipe.id } });
  const tombstones = await db.apiMutationTombstone.findMany({ where: { parentResourceId: { in: [recipe.id, ...seeded.steps.map((step) => step.id)] } } });
  const cookbook = await db.cookbook.findUniqueOrThrow({ where: { id: seeded.cookbook.id } });
  const stepPositions = new Map(seeded.steps.map((step, index) => [step.id, index]));
  const replaceIds = (value: string | null) => {
    let text = value ?? "";
    for (const [id, index] of stepPositions) text = text.replaceAll(id, `step-${index}`);
    for (const [index, ingredient] of seeded.ingredients.entries()) text = text.replaceAll(ingredient.id, `ingredient-${index}`);
    return text.replaceAll(recipe.id, "recipe");
  };
  return {
    description: recipe.description,
    deleted: recipe.deletedAt !== null,
    touched: recipe.updatedAt.getTime() > OLD.getTime(),
    cookbookTouched: cookbook.updatedAt.getTime() > OLD.getTime(),
    steps: recipe.steps.map((step) => ({
      position: stepPositions.get(step.id) ?? "new",
      stepNum: step.stepNum,
      stepTitle: step.stepTitle,
      description: step.description,
      duration: step.duration,
      ingredients: step.ingredients
        .map((ingredient) => `${ingredient.quantity} ${ingredient.unit.name} ${ingredient.ingredientRef.name}`)
        .sort(),
    })),
    uses: uses.map((use) => `${use.outputStepNum}->${use.inputStepNum}`).sort(),
    tombstones: tombstones.map((tombstone) => ({
      operation: tombstone.operation,
      resourceType: tombstone.resourceType,
      resourceId: replaceIds(tombstone.resourceId),
      parentResourceId: replaceIds(tombstone.parentResourceId),
      payload: replaceIds(tombstone.payload),
    })),
  };
}

/** Runs `write` through Prisma on one recipe and through D1 on its twin; both must match. */
async function expectParity(
  write: (seeded: Seeded, d1: D1ReadDatabase | null) => Promise<unknown>,
) {
  const viaPrisma = await seedRecipe(`Via Prisma ${seeds}`);
  const viaD1 = await seedRecipe(`Via D1 ${seeds}`);
  const prismaResult = await write(viaPrisma, null);
  const batchesBefore = d1.roundTrips();
  const d1Result = await write(viaD1, d1.binding);
  expect(d1.roundTrips() - batchesBefore).toBe(1);
  expect(await graph(viaD1)).toEqual(await graph(viaPrisma));
  return { prismaResult, d1Result, viaPrisma, viaD1 };
}

async function idempotencyKey(label: string) {
  return db.apiIdempotencyKey.create({
    data: { userId: chefId, clientKey: "test", key: `${label}-${crypto.randomUUID()}`, operation: "test", requestHash: "hash", expiresAt: new Date("2099-01-01") },
  });
}

/** The fake binding, with `before` run once just ahead of the first batch. */
function interleaved(before: () => Promise<unknown>): D1ReadDatabase {
  let pending = true;
  return {
    prepare: (sql) => d1.binding.prepare(sql),
    async batch(statements) {
      if (pending) {
        pending = false;
        await before();
      }
      return d1.binding.batch(statements as never);
    },
  };
}

const failing = (): D1ReadDatabase => ({
  prepare: (sql) => d1.binding.prepare(sql),
  batch: async () => {
    throw new Error("D1 is down");
  },
});

describe("REST recipe writes on a D1 binding", () => {
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

  describe("recipes", () => {
    const createInput = (title: string) => ({
      clientMutationId: "create",
      title,
      description: null,
      servings: null,
      steps: [{ stepTitle: null, description: "Stir", duration: null, ingredients: [{ quantity: 1, unit: "cup", ingredientName: "rice" }] }],
    });

    it("creates through one batch, and reports a title taken before the write", async () => {
      const created = await createNativeRecipe(db, chefId, createInput("Rice"), { recipeId: "d1-rice", d1: d1.binding });
      expect(created).toEqual({ ok: true, status: 201, data: { recipeId: "d1-rice" } });
      await expect(db.ingredient.count({ where: { recipeId: "d1-rice" } })).resolves.toBe(1);

      const racing = interleaved(() => db.recipe.create({ data: { title: "Beans", chefId } }));
      await expect(createNativeRecipe(db, chefId, createInput("Beans"), { d1: racing })).resolves.toEqual({
        ok: false,
        code: "validation_error",
        message: "Invalid recipe fields",
        details: { fieldErrors: { title: ACTIVE_RECIPE_TITLE_CONFLICT_ERROR } },
      });
      await expect(createNativeRecipe(db, chefId, createInput("Lentils"), { d1: failing() })).rejects.toThrow("D1 is down");
    });

    it("updates fields and touches cookbooks as the Prisma path does", async () => {
      await expectParity(({ recipe }, binding) =>
        updateNativeRecipe(db, chefId, recipe.id, { clientMutationId: "u", fields: { description: "New" } }, binding));
      const { d1Result } = await expectParity(({ recipe }, binding) =>
        updateNativeRecipe(db, chefId, recipe.id, { clientMutationId: "u", fields: { title: `Renamed ${recipe.id}`, servings: null } }, binding));
      expect(d1Result).toMatchObject({ ok: true, data: { updated: true } });
    });

    it("reports a title taken before the write, a recipe gone before it, and other failures", async () => {
      const { recipe } = await seedRecipe("Mine");
      await seedRecipe("Theirs");
      const racing = interleaved(() => db.recipe.update({ where: { id: recipe.id }, data: { title: "Mine" } }));
      await expect(updateNativeRecipe(db, chefId, recipe.id, { clientMutationId: "u", fields: { title: "Theirs" } }, racing))
        .resolves.toMatchObject({ ok: false, details: { fieldErrors: { title: ACTIVE_RECIPE_TITLE_CONFLICT_ERROR } } });
      await expect(updateNativeRecipe(db, chefId, recipe.id, { clientMutationId: "u", fields: { description: "x" } }, failing()))
        .rejects.toThrow("D1 is down");

      const lonely = await db.recipe.create({ data: { title: "Lonely", chefId } });
      const deleting = () => interleaved(() => db.recipe.delete({ where: { id: lonely.id } }));
      await expect(updateNativeRecipe(db, chefId, lonely.id, { clientMutationId: "u", fields: { description: "x" } }, deleting()))
        .rejects.toThrow("Recipe to update was not found");
    });

    it("soft-deletes with the cookbook touch and sync tombstone as the Prisma path does", async () => {
      const { prismaResult, d1Result, viaD1 } = await expectParity(({ recipe }, binding) => deleteNativeRecipe(db, chefId, recipe.id, binding));
      expect(d1Result).toMatchObject({ ok: true, data: { recipe: { id: viaD1.recipe.id, title: viaD1.recipe.title } } });
      const { deletedAt, updatedAt } = (d1Result as { data: { recipe: { deletedAt: Date; updatedAt: Date } } }).data.recipe;
      expect(deletedAt).toEqual(updatedAt);
      expect(Object.keys((prismaResult as { data: { recipe: object } }).data.recipe)).toEqual(["id", "title", "deletedAt", "updatedAt"]);
      await expect(db.nativeSyncTombstone.findMany({ where: { resourceId: viaD1.recipe.id } })).resolves.toEqual([
        expect.objectContaining({ resourceType: "recipe", title: viaD1.recipe.title, deletedAt }),
      ]);

      const lonely = await db.recipe.create({ data: { title: "Lonely", chefId } });
      await expect(deleteNativeRecipe(db, chefId, lonely.id, interleaved(() => db.recipe.delete({ where: { id: lonely.id } }))))
        .rejects.toThrow("Recipe to delete was not found");
      const other = await db.recipe.create({ data: { title: "Other", chefId } });
      await expect(deleteNativeRecipe(db, chefId, other.id, failing())).rejects.toThrow("D1 is down");
    });

    it("forks through the D1 batch", async () => {
      const { recipe } = await seedRecipe("Source");
      await expect(forkNativeRecipe(db, chefId, recipe.id, { clientMutationId: "f", titleOverride: "Forked" }, { recipeId: "d1-forked", d1: d1.binding }))
        .resolves.toMatchObject({ ok: true, data: { recipeId: "d1-forked", fork: { appliedTitle: "Forked" } } });
      await expect(db.ingredient.count({ where: { recipeId: "d1-forked" } })).resolves.toBe(3);
    });
  });

  describe("recipe steps", () => {
    it("creates a step with ingredients and output uses as the Prisma path does", async () => {
      const { d1Result } = await expectParity(({ recipe }, binding) => createNativeRecipeStep(db, chefId, recipe.id, {
        clientMutationId: "s",
        stepTitle: "Glaze",
        description: "Glaze it",
        duration: 2,
        ingredients: [{ quantity: 1, unit: "Drizzle", ingredientName: "Honey" }, { quantity: 2, unit: "cup", ingredientName: "Sugar" }],
        outputStepNums: [3, 1, 3],
      }, { d1: binding }));
      expect(d1Result).toMatchObject({ ok: true, status: 201, data: { stepNum: 4 } });
    });

    it("stops a create when another request added one of its ingredients first", async () => {
      const { recipe, steps } = await seedRecipe("Race");
      const racing = interleaved(async () => {
        const honey = await db.ingredientRef.create({ data: { name: "honey" } });
        const cup = await db.unit.findUniqueOrThrow({ where: { name: "cup" } });
        await db.ingredient.create({ data: { recipeId: recipe.id, stepNum: 2, quantity: 1, unitId: cup.id, ingredientRefId: honey.id } });
      });
      await expect(createNativeRecipeStep(db, chefId, recipe.id, {
        clientMutationId: "s", stepTitle: null, description: "Glaze", duration: null,
        ingredients: [{ quantity: 1, unit: "cup", ingredientName: "Honey" }], outputStepNums: [],
      }, { d1: racing })).rejects.toThrow("malformed JSON");
      await expect(db.recipeStep.count({ where: { recipeId: recipe.id } })).resolves.toBe(steps.length);
    });

    it.each([
      ["step fields", { stepTitle: "Bake hot", duration: null }],
      ["output uses", { outputStepNums: [2, 1] }],
      ["fields and cleared output uses of a step with ingredients", { description: "Mix well", outputStepNums: [] }],
    ])("updates %s as the Prisma path does", async (_label, fields) => {
      await expectParity(({ recipe, steps }, binding) => {
        const step = "outputStepNums" in fields && fields.outputStepNums.length === 0 ? steps[0]! : steps[2]!;
        return updateNativeRecipeStep(db, chefId, recipe.id, step.id, { clientMutationId: "p", fields }, { d1: binding });
      });
    });

    it("writes nothing for an empty step update", async () => {
      const { recipe, steps } = await seedRecipe("Empty patch");
      const before = d1.roundTrips();
      await expect(updateNativeRecipeStep(db, chefId, recipe.id, steps[0]!.id, { clientMutationId: "p", fields: {} }, { d1: d1.binding }))
        .resolves.toMatchObject({ ok: true, data: { updated: false } });
      expect(d1.roundTrips()).toBe(before);
    });

    it("stops a step update when the step's content went away before the write", async () => {
      const { recipe, steps } = await seedRecipe("Content race");
      const racing = interleaved(() => db.stepOutputUse.deleteMany({ where: { recipeId: recipe.id } }));
      await expect(updateNativeRecipeStep(db, chefId, recipe.id, steps[2]!.id, { clientMutationId: "p", fields: { stepTitle: "Solo" } }, { d1: racing }))
        .rejects.toThrow("malformed JSON");
      await expect(db.recipeStep.findUniqueOrThrow({ where: { id: steps[2]!.id } })).resolves.toMatchObject({ stepTitle: "Bake" });
    });

    it.each([true, false])("deletes a step (tombstone: %s) as the Prisma path does", async (withTombstone) => {
      await expectParity(async ({ recipe, steps }, binding) => deleteNativeRecipeStep(db, chefId, recipe.id, steps[1]!.id, {
        ...(withTombstone ? { tombstone: { idempotencyKeyId: (await idempotencyKey("delete")).id, operation: "recipes.steps.delete" } } : {}),
        d1: binding,
      }));
    });

    it("creates a step ingredient as the Prisma path does", async () => {
      await expectParity(({ recipe, steps }, binding) => createNativeRecipeStepIngredient(db, chefId, recipe.id, steps[2]!.id, {
        clientMutationId: "i", quantity: 3, unit: "Pinch", ingredientName: "Salt",
      }, { d1: binding }));
    });

    it.each([true, false])("deletes a step ingredient (tombstone: %s) as the Prisma path does", async (withTombstone) => {
      await expectParity(async ({ recipe, steps, ingredients }, binding) => deleteNativeRecipeStepIngredient(db, chefId, recipe.id, steps[0]!.id, ingredients[0]!.id, {
        ...(withTombstone ? { tombstone: { idempotencyKeyId: (await idempotencyKey("ingredient")).id, operation: "recipes.steps.ingredients.delete" } } : {}),
        d1: binding,
      }));
    });

    it.each([true, false])("reorders steps (tombstone: %s) as the Prisma path does", async (withTombstone) => {
      const { d1Result } = await expectParity(async ({ recipe, steps }, binding) => reorderNativeRecipeStep(db, chefId, recipe.id, {
        clientMutationId: "r", stepId: steps[1]!.id, toStepNum: 1,
      }, {
        ...(withTombstone ? { tombstone: { idempotencyKeyId: (await idempotencyKey("reorder")).id, operation: "recipes.steps.reorder" } } : {}),
        d1: binding,
      }));
      expect(d1Result).toMatchObject({ ok: true, data: { reordered: true } });
    });

    it("stops a reorder when the steps changed after they were read", async () => {
      const { recipe, steps } = await seedRecipe("Reorder race");
      const racing = interleaved(() => db.recipeStep.update({ where: { id: steps[1]!.id }, data: { stepNum: 9 } }));
      await expect(reorderNativeRecipeStep(db, chefId, recipe.id, { clientMutationId: "r", stepId: steps[1]!.id, toStepNum: 1 }, { d1: racing }))
        .rejects.toThrow("malformed JSON");
      await expect(db.recipeStep.findMany({ where: { recipeId: recipe.id }, orderBy: { stepNum: "asc" }, select: { stepNum: true } }))
        .resolves.toEqual([{ stepNum: 1 }, { stepNum: 3 }, { stepNum: 9 }]);
    });

    it.each([
      ["new output uses", 2, [1, 2]],
      ["no output uses on a step with ingredients", 1, []],
    ])("replaces %s as the Prisma path does", async (_label, stepIndex, outputStepNums) => {
      await expectParity(({ recipe, steps }, binding) => replaceNativeRecipeStepOutputUses(db, chefId, recipe.id, {
        clientMutationId: "o", inputStepId: steps[stepIndex]!.id, outputStepNums,
      }, { d1: binding }));
    });
  });
});
