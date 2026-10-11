// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { D1_WRITE_UNAVAILABLE_MESSAGE, D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { getLocalDb } from "~/lib/db.server";
import { createRecipeDraft } from "~/lib/recipe-create.server";
import {
  addStepIngredientsOnD1,
  deleteRecipeStepOnD1,
  deleteStepIngredientOnD1,
  recipeEditorUnavailable,
  saveRecipeEditOnD1,
  swapRecipeStepsOnD1,
  updateRecipeStepOnD1,
} from "~/lib/recipe-d1-edits.server";
import { ActiveRecipeTitleConflictError } from "~/lib/recipe-title-uniqueness.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { flakyD1, NETWORK_LOST_MESSAGE, type FlakyOutcome } from "../helpers/flaky-d1";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// The new-recipe write and the recipe editor's writes when D1's connection drops: before the
// batch reaches the database ("lost"), after it committed ("lost-answer"), or committing just
// before the retry ("late"). Each must end with the rows one clean run leaves and the answer it
// gives, and a write whose every try is lost gives up with D1WriteUnavailableError, writing
// nothing.

let db: PrismaClient;
let d1: SqliteD1;
let chefId: string;

const OLD = new Date("2026-01-01T00:00:00.000Z");
const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];

/** A recipe with three steps (step 3 uses step 1) and an ingredient on step 1, in a cookbook. */
async function seedRecipe(title = `Pancakes ${crypto.randomUUID()}`) {
  const recipe = await db.recipe.create({ data: { title, chefId } });
  const cup = await db.unit.upsert({ where: { name: "cup" }, update: {}, create: { name: "cup" } });
  const flour = await db.ingredientRef.upsert({ where: { name: "flour" }, update: {}, create: { name: "flour" } });
  const steps = [];
  for (const [stepNum, stepTitle] of [[1, "Mix"], [2, "Rest"], [3, "Bake"]] as const) {
    steps.push(await db.recipeStep.create({ data: { recipeId: recipe.id, stepNum, stepTitle, description: `${stepTitle} it` } }));
  }
  const ingredient = await db.ingredient.create({
    data: { recipeId: recipe.id, stepNum: 1, quantity: 2, unitId: cup.id, ingredientRefId: flour.id },
  });
  await db.stepOutputUse.create({ data: { recipeId: recipe.id, outputStepNum: 1, inputStepNum: 3 } });
  const cookbook = await db.cookbook.create({ data: { title: `Book ${title}`, authorId: chefId } });
  await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: chefId } });
  await db.recipe.update({ where: { id: recipe.id }, data: { updatedAt: OLD } });
  return { recipe, steps, ingredient };
}

async function stepTitles(recipeId: string) {
  const steps = await db.recipeStep.findMany({ where: { recipeId }, orderBy: { stepNum: "asc" } });
  return steps.map((step) => step.stepTitle);
}

async function ingredientNames(recipeId: string) {
  const rows = await db.ingredient.findMany({ where: { recipeId }, include: { ingredientRef: true }, orderBy: { stepNum: "asc" } });
  return rows.map((row) => `${row.stepNum}:${row.ingredientRef.name}`).sort();
}

describe("recipe create and editor writes when D1's connection drops", () => {
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

  describe("createRecipeDraft", () => {
    const draft = (id: string, title = "Soda bread") => ({
      id,
      title,
      description: null,
      servings: null,
      chefId,
      steps: [{ stepTitle: null, description: "Mix and bake", duration: null, ingredients: [{ quantity: 2, unit: "cup", ingredientName: "Flour" }] }],
      cover: { id: `${id}-cover`, imageUrl: "", sourceType: "ai-placeholder", status: "processing", createdById: chefId, generationStatus: "processing" },
    });

    it.each(OUTCOMES)("writes the recipe once when its batch is %s", async (outcome) => {
      const flaky = flakyD1(d1.binding);
      flaky.failNext(/INSERT INTO "Recipe"/, outcome);
      const id = crypto.randomUUID();

      await expect(createRecipeDraft(db, draft(id), flaky.binding)).resolves.toEqual({ id });

      expect(flaky.failures()).toBe(1);
      expect(await db.recipe.count({ where: { chefId } })).toBe(1);
      expect(await db.recipeCover.count({ where: { recipeId: id } })).toBe(1);
      expect(await ingredientNames(id)).toEqual(["1:flour"]);
    });

    it("still reports a title another recipe took", async () => {
      await db.recipe.create({ data: { title: "Soda bread", chefId } });
      const flaky = flakyD1(d1.binding);
      flaky.failNext(/INSERT INTO "Recipe"/, "lost");

      await expect(createRecipeDraft(db, draft(crypto.randomUUID()), flaky.binding)).rejects.toBeInstanceOf(ActiveRecipeTitleConflictError);
      expect(await db.recipe.count({ where: { chefId } })).toBe(1);
    });

    it("gives up after four lost tries, writing nothing", async () => {
      const flaky = flakyD1(d1.binding);
      flaky.failNext(/INSERT INTO "Recipe"/, "lost", "lost", "lost", "lost");

      await expect(createRecipeDraft(db, draft(crypto.randomUUID()), flaky.binding)).rejects.toBeInstanceOf(D1WriteUnavailableError);
      expect(await db.recipe.count({ where: { chefId } })).toBe(0);
    });
  });

  describe("saveRecipeEditOnD1", () => {
    const COOKBOOK_TOUCH = /FROM "RecipeInCookbook" WHERE "recipeId"/;

    it.each(OUTCOMES)("saves an edit with an upload and an expected updatedAt once when its batch is %s", async (outcome) => {
      const { recipe } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(COOKBOOK_TOUCH, outcome);

      await saveRecipeEditOnD1(flaky.binding, {
        recipeId: recipe.id,
        chefId,
        fields: { title: "Edited", description: "New", servings: "4" },
        cover: { kind: "upload", coverId: "upload-cover", imageUrl: "https://example.com/u.jpg", createdById: chefId },
        expectedUpdatedAt: OLD,
      });

      expect(flaky.failures()).toBe(1);
      expect(await db.recipe.findUniqueOrThrow({ where: { id: recipe.id } })).toMatchObject({
        title: "Edited", description: "New", servings: "4", activeCoverId: "upload-cover", coverMode: "manual",
      });
      expect(await db.recipeCover.count({ where: { recipeId: recipe.id } })).toBe(1);
    });

    it.each(OUTCOMES)("saves an edit without a cover once when its batch is %s", async (outcome) => {
      const { recipe } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(COOKBOOK_TOUCH, outcome);

      await saveRecipeEditOnD1(flaky.binding, {
        recipeId: recipe.id, chefId, fields: { title: "Edited", description: null, servings: null }, cover: { kind: "clear" }, expectedUpdatedAt: OLD,
      });

      expect(await db.recipe.findUniqueOrThrow({ where: { id: recipe.id } })).toMatchObject({ title: "Edited", coverMode: "none" });
    });

    it("still stops an edit whose recipe changed since the page loaded it", async () => {
      const { recipe } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(COOKBOOK_TOUCH, "lost");

      await expect(saveRecipeEditOnD1(flaky.binding, {
        recipeId: recipe.id, chefId, fields: { title: "Edited", description: null, servings: null }, cover: null,
        expectedUpdatedAt: new Date("2025-01-01T00:00:00.000Z"),
      })).rejects.toMatchObject({ name: "D1GuardFailure" });
      expect((await db.recipe.findUniqueOrThrow({ where: { id: recipe.id } })).title).toBe(recipe.title);
    });

    it("gives up after four lost tries, writing nothing", async () => {
      const { recipe } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(COOKBOOK_TOUCH, "lost", "lost", "lost", "lost");

      await expect(saveRecipeEditOnD1(flaky.binding, {
        recipeId: recipe.id, chefId, fields: { title: "Edited", description: null, servings: null }, cover: null,
      })).rejects.toBeInstanceOf(D1WriteUnavailableError);
      expect((await db.recipe.findUniqueOrThrow({ where: { id: recipe.id } })).title).toBe(recipe.title);
    });
  });

  describe("swapRecipeStepsOnD1", () => {
    const SWAP = /SET "stepNum" = \?/;

    it.each(OUTCOMES)("swaps the steps once, never back, when its batch is %s", async (outcome) => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(SWAP, outcome);

      await swapRecipeStepsOnD1(flaky.binding, {
        recipeId: recipe.id, stepId: steps[1]!.id, stepNum: 2, targetStepId: steps[0]!.id, targetStepNum: 1,
      });

      expect(flaky.failures()).toBe(1);
      expect(await stepTitles(recipe.id)).toEqual(["Rest", "Mix", "Bake"]);
    });

    it("still stops a swap whose steps another request moved", async () => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(SWAP, "lost");
      await db.recipeStep.update({ where: { id: steps[0]!.id }, data: { stepNum: 9 } });

      await expect(swapRecipeStepsOnD1(flaky.binding, {
        recipeId: recipe.id, stepId: steps[1]!.id, stepNum: 2, targetStepId: steps[0]!.id, targetStepNum: 1,
      })).rejects.toMatchObject({ name: "D1GuardFailure" });
    });

    it("gives up after four lost tries, swapping nothing", async () => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(SWAP, "lost", "lost", "lost", "lost");

      await expect(swapRecipeStepsOnD1(flaky.binding, {
        recipeId: recipe.id, stepId: steps[1]!.id, stepNum: 2, targetStepId: steps[0]!.id, targetStepNum: 1,
      })).rejects.toBeInstanceOf(D1WriteUnavailableError);
      expect(await stepTitles(recipe.id)).toEqual(["Mix", "Rest", "Bake"]);
    });
  });

  describe("deleteRecipeStepOnD1", () => {
    const DELETE = /DELETE FROM "RecipeStep"/;

    it.each(OUTCOMES)("deletes the step when its batch is %s", async (outcome) => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(DELETE, outcome);

      await deleteRecipeStepOnD1(flaky.binding, { recipeId: recipe.id, stepId: steps[2]!.id, stepNum: 3 });

      expect(flaky.failures()).toBe(1);
      expect(await stepTitles(recipe.id)).toEqual(["Mix", "Rest"]);
    });

    it("gives up after four lost tries, deleting nothing", async () => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(DELETE, "lost", "lost", "lost", "lost");

      await expect(deleteRecipeStepOnD1(flaky.binding, { recipeId: recipe.id, stepId: steps[2]!.id, stepNum: 3 }))
        .rejects.toBeInstanceOf(D1WriteUnavailableError);
      expect(await stepTitles(recipe.id)).toEqual(["Mix", "Rest", "Bake"]);
    });
  });

  describe("addStepIngredientsOnD1", () => {
    const ADD = /INSERT INTO "Ingredient"/;
    const rows = [{ quantity: 1, unitName: "cup", ingredientName: "milk" }, { quantity: 2, unitName: "each", ingredientName: "egg" }];

    it.each(OUTCOMES)("adds the ingredients once when its batch is %s", async (outcome) => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(ADD, outcome);

      await addStepIngredientsOnD1(flaky.binding, { recipeId: recipe.id, stepId: steps[1]!.id, stepNum: 2, rows });

      expect(flaky.failures()).toBe(1);
      expect(await ingredientNames(recipe.id)).toEqual(["1:flour", "2:egg", "2:milk"]);
    });

    it("still stops an add whose ingredient another request added", async () => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(ADD, "lost");

      await expect(addStepIngredientsOnD1(flaky.binding, {
        recipeId: recipe.id, stepId: steps[1]!.id, stepNum: 2, rows: [{ quantity: 1, unitName: "cup", ingredientName: "flour" }],
      })).rejects.toMatchObject({ name: "D1GuardFailure" });
    });

    it("gives up after four lost tries, adding nothing", async () => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(ADD, "lost", "lost", "lost", "lost");

      await expect(addStepIngredientsOnD1(flaky.binding, { recipeId: recipe.id, stepId: steps[1]!.id, stepNum: 2, rows }))
        .rejects.toBeInstanceOf(D1WriteUnavailableError);
      expect(await ingredientNames(recipe.id)).toEqual(["1:flour"]);
    });
  });

  describe("updateRecipeStepOnD1", () => {
    const UPDATE = /UPDATE "RecipeStep" SET "stepTitle"/;

    it.each(OUTCOMES)("saves the step when its batch is %s", async (outcome) => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(UPDATE, outcome);

      await updateRecipeStepOnD1(flaky.binding, {
        recipeId: recipe.id, stepId: steps[2]!.id, stepNum: 3, stepTitle: "Bake hot", description: "Bake it hot", usesSteps: [1, 2],
      });

      expect(flaky.failures()).toBe(1);
      expect(await stepTitles(recipe.id)).toEqual(["Mix", "Rest", "Bake hot"]);
      const uses = await db.stepOutputUse.findMany({ where: { recipeId: recipe.id }, orderBy: { outputStepNum: "asc" } });
      expect(uses.map((use) => `${use.outputStepNum}->${use.inputStepNum}`)).toEqual(["1->3", "2->3"]);
    });

    it("gives up after four lost tries, saving nothing", async () => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(UPDATE, "lost", "lost", "lost", "lost");

      await expect(updateRecipeStepOnD1(flaky.binding, {
        recipeId: recipe.id, stepId: steps[2]!.id, stepNum: 3, stepTitle: "Bake hot", description: "Bake it hot", usesSteps: [1],
      })).rejects.toBeInstanceOf(D1WriteUnavailableError);
      expect(await stepTitles(recipe.id)).toEqual(["Mix", "Rest", "Bake"]);
    });
  });

  describe("deleteStepIngredientOnD1", () => {
    const DELETE = /DELETE FROM "Ingredient"/;

    it.each(OUTCOMES)("deletes the ingredient and answers that it did when its batch is %s", async (outcome) => {
      const { recipe, ingredient } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(DELETE, outcome);

      await expect(deleteStepIngredientOnD1(flaky.binding, { recipeId: recipe.id, stepNum: 1, ingredientId: ingredient.id })).resolves.toBe(true);

      expect(flaky.failures()).toBe(1);
      expect(await ingredientNames(recipe.id)).toEqual([]);
    });

    it("answers that a retry deleted nothing when the ingredient was never there", async () => {
      const { recipe } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(DELETE, "lost");

      await expect(deleteStepIngredientOnD1(flaky.binding, { recipeId: recipe.id, stepNum: 1, ingredientId: "missing" })).resolves.toBe(false);
      expect((await db.recipe.findUniqueOrThrow({ where: { id: recipe.id } })).updatedAt).toEqual(OLD);
    });

    it("gives up after four lost tries, deleting nothing", async () => {
      const { recipe, ingredient } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(DELETE, "lost", "lost", "lost", "lost");

      await expect(deleteStepIngredientOnD1(flaky.binding, { recipeId: recipe.id, stepNum: 1, ingredientId: ingredient.id }))
        .rejects.toBeInstanceOf(D1WriteUnavailableError);
      expect(await ingredientNames(recipe.id)).toEqual(["1:flour"]);
    });
  });

  describe("recipeEditorUnavailable", () => {
    it("answers a write the database could not take with a retryable 503 in the named field", () => {
      const answer = recipeEditorUnavailable(new D1WriteUnavailableError("recipe.edit", new Error(NETWORK_LOST_MESSAGE)), "reorder");
      expect(answer).toMatchObject({
        data: { errors: { reorder: D1_WRITE_UNAVAILABLE_MESSAGE }, errorCode: "temporarily_unavailable", retryable: true },
        init: { status: 503 },
      });
      expect(new Headers(answer!.init!.headers).get("Retry-After")).toBe("1");
      expect(recipeEditorUnavailable(new D1WriteUnavailableError("recipe.edit", null))).toMatchObject({
        data: { errors: { general: D1_WRITE_UNAVAILABLE_MESSAGE } },
      });
    });

    it("leaves any other error to the caller", () => {
      expect(recipeEditorUnavailable(new Error("constraint failed"))).toBeNull();
    });
  });
});
