import { createExecutionContext, env } from "cloudflare:test";
import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { action as apiV1Action } from "../../../app/routes/api.v1.$";
import { hashApiToken } from "../../../app/lib/api-auth.server";
import {
  createNativeRecipeStep,
  createNativeRecipeStepIngredient,
  deleteNativeRecipeStep,
  deleteNativeRecipeStepIngredient,
  reorderNativeRecipeStep,
  replaceNativeRecipeStepOutputUses,
  updateNativeRecipeStep,
} from "../../../app/lib/api-v1-recipe-steps.server";
import { createNativeRecipe, deleteNativeRecipe, updateNativeRecipe } from "../../../app/lib/api-v1-recipe-writes.server";
import type { D1ReadDatabase } from "../../../app/lib/d1-read.server";
import { d1Guard, d1WriteBatch, isD1GuardFailure } from "../../../app/lib/d1-write.server";
import { getDb } from "../../../app/lib/db.server";
import { createRecipeDraft } from "../../../app/lib/recipe-create.server";
import {
  addStepIngredientsOnD1,
  deleteRecipeStepOnD1,
  deleteStepIngredientOnD1,
  saveRecipeEditOnD1,
  swapRecipeStepsOnD1,
  updateRecipeStepOnD1,
} from "../../../app/lib/recipe-d1-edits.server";
import { archiveRecipeCover, setActiveRecipeCover } from "../../../app/lib/recipe-cover.server";
import { forkRecipe } from "../../../app/lib/recipe-fork.server";
import { ActiveRecipeTitleConflictError } from "../../../app/lib/recipe-title-uniqueness.server";
import { handleGoogleOAuthCallback } from "../../../app/lib/google-oauth-callback.server";
import { handleGitHubOAuthCallback } from "../../../app/lib/github-oauth-callback.server";
import { handleAppleOAuthCallback } from "../../../app/lib/apple-oauth-callback.server";
import { IMPORT_DAILY_CAP, tryConsumeImageGenQuota } from "../../../app/lib/image-gen-ledger.server";
import { createOAuthUser } from "../../../app/lib/oauth-user.server";
import { handleRecipeDetailAction } from "../../../app/lib/recipe-detail.server";
import { importRecipeFromSource } from "../../../app/lib/recipe-import.server";
import { createUserSessionCookie } from "../../../app/lib/session.server";
import { callSpoonjoyApiOperation } from "../../../app/lib/spoonjoy-api.server";
import { expectConsoleError } from "../../warning-policy";
import { applyRepositoryMigrations } from "./repository-migrations";

// Prisma's D1 adapter ignores transactions, so the recipe writes that must be atomic go to
// D1 as one batch. These tests run them against Wrangler's real D1 (workerd): a failure
// injected into a late statement (a trigger that aborts) must leave nothing applied, rows
// changed between an action's reads and its batch must stop the batch, and a successful
// batch must leave the same rows the Prisma version wrote.

const CHEF = "atomic-chef";
const FRIEND = "atomic-friend";
const COOKBOOK = "atomic-cookbook";
const SOURCE = "atomic-source";
const OLD = "2026-01-01T00:00:00.000Z";
const FAILURE = "recipe_atomic_injected_failure";
const TRIGGER = "RecipeAtomic_injected_failure";
const TOKEN = "sj_recipe_atomic_d1_test";
const ORIGIN = "https://spoonjoy.test";

let prisma: PrismaClient;

function database(): D1Database {
  return env.DB as D1Database;
}

async function run(sql: string, ...values: unknown[]) {
  await database().prepare(sql).bind(...values).run();
}

async function rows<T = Record<string, unknown>>(sql: string, ...values: unknown[]): Promise<T[]> {
  return (await database().prepare(sql).bind(...values).all<T>()).results;
}

async function count(sql: string, ...values: unknown[]): Promise<number> {
  const row = await database().prepare(sql).bind(...values).first<{ count: number }>();
  return row!.count;
}

/** Makes the next matching write abort, as a failing statement late in a batch would. */
async function failOn(event: "INSERT" | "UPDATE" | "DELETE", table: string, when: string) {
  await run(`DROP TRIGGER IF EXISTS "${TRIGGER}"`);
  await run(`CREATE TRIGGER "${TRIGGER}" BEFORE ${event} ON "${table}" WHEN ${when}
    BEGIN SELECT RAISE(ABORT, '${FAILURE}'); END`);
}

/** The binding, but `before` runs once just ahead of the first batch: another request's writes. */
function interleaved(before: () => Promise<unknown>): D1ReadDatabase {
  let pending = true;
  return {
    prepare: (sql) => database().prepare(sql) as never,
    async batch(statements) {
      if (pending) {
        pending = false;
        await before();
      }
      return database().batch(statements as never);
    },
  };
}

async function recipeGraph(recipeId: string) {
  const [recipe] = await rows(
    `SELECT "title", "description", "servings", "chefId", "sourceRecipeId", "sourceUrl", "coverMode",
            "activeCoverVariant", "deletedAt" IS NOT NULL AS "deleted", "activeCoverId" IS NOT NULL AS "hasActiveCover"
     FROM "Recipe" WHERE "id" = ?`,
    recipeId,
  );
  return {
    recipe: recipe ?? null,
    steps: await rows(
      `SELECT "stepNum", "stepTitle", "description", "duration" FROM "RecipeStep" WHERE "recipeId" = ? ORDER BY "stepNum"`,
      recipeId,
    ),
    ingredients: await rows(
      `SELECT "Ingredient"."stepNum", "quantity", "Unit"."name" AS "unit", "IngredientRef"."name" AS "ingredient"
       FROM "Ingredient"
       JOIN "Unit" ON "Unit"."id" = "Ingredient"."unitId"
       JOIN "IngredientRef" ON "IngredientRef"."id" = "Ingredient"."ingredientRefId"
       WHERE "Ingredient"."recipeId" = ? ORDER BY "Ingredient"."stepNum", "IngredientRef"."name"`,
      recipeId,
    ),
    uses: await rows(
      `SELECT "outputStepNum", "inputStepNum" FROM "StepOutputUse" WHERE "recipeId" = ? ORDER BY 1, 2`,
      recipeId,
    ),
    covers: await rows(
      `SELECT "imageUrl", "stylizedImageUrl", "sourceType", "status", "generationStatus", "createdById"
       FROM "RecipeCover" WHERE "recipeId" = ? ORDER BY "createdAt", "id"`,
      recipeId,
    ),
  };
}

async function seedUnitsAndRefs() {
  for (const name of ["atomic cup", "atomic tbsp"]) {
    await run(`INSERT INTO "Unit" ("id", "name", "updatedAt") VALUES (?, ?, ?)`, name.replace(" ", "-"), name, OLD);
  }
  for (const name of ["atomic flour", "atomic milk", "atomic egg", "atomic salt", "atomic sugar"]) {
    await run(`INSERT INTO "IngredientRef" ("id", "name", "updatedAt") VALUES (?, ?, ?)`, name.replace(" ", "-"), name, OLD);
  }
}

/** A chef's recipe: three steps, step 3 uses step 1, in the chef's cookbook. */
async function seedRecipe(id: string, chefId = CHEF, title = `Recipe ${id}`) {
  await run(
    `INSERT INTO "Recipe" ("id", "title", "description", "servings", "chefId", "coverMode", "createdAt", "updatedAt")
     VALUES (?, ?, 'Seeded', '2', ?, 'auto', ?, ?)`,
    id, title, chefId, OLD, OLD,
  );
  for (const [stepNum, stepTitle] of [[1, "Mix"], [2, "Rest"], [3, "Bake"]] as const) {
    await run(
      `INSERT INTO "RecipeStep" ("id", "recipeId", "stepNum", "stepTitle", "description", "duration", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      `${id}-step-${stepNum}`, id, stepNum, stepTitle, `${stepTitle} it`, stepNum * 5, OLD,
    );
  }
  for (const [stepNum, ref, quantity] of [[1, "flour", 2], [1, "milk", 1], [2, "egg", 1]] as const) {
    await run(
      `INSERT INTO "Ingredient" ("id", "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId", "updatedAt")
       VALUES (?, ?, ?, ?, 'atomic-cup', ?, ?)`,
      `${id}-ingredient-${ref}`, id, stepNum, quantity, `atomic-${ref}`, OLD,
    );
  }
  await run(
    `INSERT INTO "StepOutputUse" ("id", "recipeId", "outputStepNum", "inputStepNum", "updatedAt") VALUES (?, ?, 1, 3, ?)`,
    `${id}-use`, id, OLD,
  );
  if (chefId === CHEF) {
    await run(
      `INSERT INTO "RecipeInCookbook" ("id", "cookbookId", "recipeId", "addedById", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?)`,
      `${id}-membership`, COOKBOOK, id, CHEF, OLD, OLD,
    );
  }
}

async function recipeUpdatedAt(recipeId: string) {
  return (await rows<{ updatedAt: string }>(`SELECT "updatedAt" FROM "Recipe" WHERE "id" = ?`, recipeId))[0]!.updatedAt;
}

async function cookbookUpdatedAt() {
  return (await rows<{ updatedAt: string }>(`SELECT "updatedAt" FROM "Cookbook" WHERE "id" = ?`, COOKBOOK))[0]!.updatedAt;
}

async function seedIdempotencyKey(id: string) {
  await run(
    `INSERT INTO "ApiIdempotencyKey" ("id", "userId", "clientKey", "key", "operation", "requestHash", "expiresAt", "updatedAt")
     VALUES (?, ?, 'atomic-client', ?, 'test', 'hash', '2099-01-01T00:00:00.000Z', ?)`,
    id, CHEF, id, OLD,
  );
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => {
    throw new Error("expected the write to fail");
  }, (error: unknown) => error);
}

const draftSteps = [
  {
    stepTitle: "Mix",
    description: "Mix the batter",
    duration: 5,
    ingredients: [
      { quantity: 2, unit: "Atomic Cup", ingredientName: "Atomic Flour" },
      { quantity: 1, unit: "atomic cup", ingredientName: "atomic milk" },
    ],
  },
  {
    stepTitle: null,
    description: "Cook it",
    duration: null,
    ingredients: [{ quantity: 3, unit: "atomic pinch", ingredientName: "atomic nutmeg" }],
  },
];

describe("atomic recipe writes on Wrangler D1", () => {
  beforeAll(async () => {
    await applyRepositoryMigrations(database());
    prisma = await getDb({ DB: database() });
    for (const id of [CHEF, FRIEND]) {
      await run(
        `INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)`,
        id, `${id}@example.com`, id.replace("-", "_"), OLD, OLD,
      );
    }
    await run(
      `INSERT INTO "ApiCredential" ("id", "userId", "name", "tokenHash", "tokenPrefix", "scopes", "createdAt", "updatedAt")
       VALUES ('atomic-credential', ?, 'Atomic', ?, ?, 'kitchen:read kitchen:write', ?, ?)`,
      CHEF, await hashApiToken(TOKEN), TOKEN.slice(0, 12), OLD, OLD,
    );
    await run(
      `INSERT INTO "Cookbook" ("id", "title", "authorId", "createdAt", "updatedAt") VALUES (?, 'Atomic Cookbook', ?, ?, ?)`,
      COOKBOOK, CHEF, OLD, OLD,
    );
    await seedUnitsAndRefs();
    await seedRecipe(SOURCE, FRIEND, "Atomic Source Loaf");
    await run(
      `INSERT INTO "RecipeCover" ("id", "recipeId", "imageUrl", "stylizedImageUrl", "sourceType", "status", "createdById",
         "generationStatus", "createdAt")
       VALUES ('atomic-source-cover', ?, 'https://example.com/loaf.jpg', 'https://example.com/loaf-editorial.jpg',
         'chef-upload', 'ready', ?, 'succeeded', ?)`,
      SOURCE, FRIEND, OLD,
    );
    await run(
      `UPDATE "Recipe" SET "activeCoverId" = 'atomic-source-cover', "activeCoverVariant" = 'stylized' WHERE "id" = ?`,
      SOURCE,
    );
  });

  afterEach(async () => {
    await run(`DROP TRIGGER IF EXISTS "${TRIGGER}"`);
  });

  describe("the batch guard", () => {
    it("fails the whole batch, rolling back the statements before it, unless its condition holds", async () => {
      const error = await rejection(d1WriteBatch(database(), [
        [`INSERT INTO "Unit" ("id", "name", "updatedAt") VALUES ('atomic-guard-a', 'atomic guard a', ?)`, OLD],
        d1Guard(`EXISTS (SELECT 1 FROM "Unit" WHERE "name" = ?)`, "atomic missing"),
        [`INSERT INTO "Unit" ("id", "name", "updatedAt") VALUES ('atomic-guard-b', 'atomic guard b', ?)`, OLD],
      ]));
      expect(isD1GuardFailure(error)).toBe(true);
      expect(await count(`SELECT COUNT(*) AS "count" FROM "Unit" WHERE "id" LIKE 'atomic-guard-%'`)).toBe(0);

      const results = await d1WriteBatch(database(), [
        [`INSERT INTO "Unit" ("id", "name", "updatedAt") VALUES ('atomic-guard-a', 'atomic guard a', ?)`, OLD],
        d1Guard(`EXISTS (SELECT 1 FROM "Unit" WHERE "name" = ?)`, "atomic guard a"),
      ]);
      expect(results).toEqual([{ rows: [], changes: 1 }, { rows: [{ guard: "0" }], changes: 0 }]);
      expect(isD1GuardFailure(await rejection(d1WriteBatch(database(), [[`SELECT 1 FROM "AtomicMissingTable"`]])))).toBe(false);
    });
  });

  describe("recipe create", () => {
    it("writes the whole recipe graph in one batch", async () => {
      await createRecipeDraft(prisma, {
        id: "atomic-create",
        title: "Atomic Pancakes",
        description: "Breakfast",
        servings: "4",
        chefId: CHEF,
        steps: draftSteps,
      }, database());

      expect(await recipeGraph("atomic-create")).toEqual({
        recipe: {
          title: "Atomic Pancakes", description: "Breakfast", servings: "4", chefId: CHEF, sourceRecipeId: null,
          sourceUrl: null, coverMode: "auto", activeCoverVariant: null, deleted: 0, hasActiveCover: 0,
        },
        steps: [
          { stepNum: 1, stepTitle: "Mix", description: "Mix the batter", duration: 5 },
          { stepNum: 2, stepTitle: null, description: "Cook it", duration: null },
        ],
        ingredients: [
          { stepNum: 1, quantity: 2, unit: "atomic cup", ingredient: "atomic flour" },
          { stepNum: 1, quantity: 1, unit: "atomic cup", ingredient: "atomic milk" },
          { stepNum: 2, quantity: 3, unit: "atomic pinch", ingredient: "atomic nutmeg" },
        ],
        uses: [],
        covers: [],
      });
      // Existing units and ingredient refs are reused, not duplicated.
      expect(await count(`SELECT COUNT(*) AS "count" FROM "Unit" WHERE "name" = 'atomic cup'`)).toBe(1);
      const created = await prisma.recipe.findUniqueOrThrow({ where: { id: "atomic-create" } });
      expect(created.createdAt).toBeInstanceOf(Date);
      expect(created.updatedAt.getTime()).toBe(created.createdAt.getTime());
    });

    it("leaves no partial recipe, unit or ingredient ref when a late statement fails", async () => {
      await failOn("INSERT", "Ingredient", `NEW."quantity" = 3`);

      const error = await rejection(createRecipeDraft(prisma, {
        id: "atomic-create-failed",
        title: "Atomic Failed Pancakes",
        description: null,
        servings: null,
        chefId: CHEF,
        steps: draftSteps.map((step) => ({
          ...step,
          ingredients: step.ingredients.map((ingredient) => ({ ...ingredient, unit: `${ingredient.unit} failed` })),
        })),
      }, database()));

      expect(String(error)).toContain(FAILURE);
      expect(await recipeGraph("atomic-create-failed")).toEqual({ recipe: null, steps: [], ingredients: [], uses: [], covers: [] });
      expect(await count(`SELECT COUNT(*) AS "count" FROM "Unit" WHERE "name" LIKE '% failed'`)).toBe(0);
    });

    it("writes the recipe with its active cover, or neither", async () => {
      const draft = {
        id: "atomic-create-cover",
        title: "Atomic Covered Pancakes",
        description: null,
        servings: null,
        chefId: CHEF,
        steps: draftSteps,
        cover: {
          id: "atomic-create-cover-image",
          imageUrl: "https://example.com/pancakes.jpg",
          sourceType: "chef-upload" as const,
          status: "ready" as const,
          createdById: CHEF,
          sourceImageUrl: "https://example.com/pancakes.jpg",
          generationStatus: "none" as const,
          activeVariant: "image" as const,
        },
      };
      await failOn("UPDATE", "Recipe", `OLD."id" = 'atomic-create-cover'`);

      expect(String(await rejection(createRecipeDraft(prisma, draft, database())))).toContain(FAILURE);
      expect(await recipeGraph("atomic-create-cover")).toEqual({ recipe: null, steps: [], ingredients: [], uses: [], covers: [] });

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await createRecipeDraft(prisma, draft, database());
      expect(await recipeGraph("atomic-create-cover")).toMatchObject({
        recipe: { coverMode: "manual", activeCoverVariant: "image", hasActiveCover: 1 },
        covers: [{ imageUrl: "https://example.com/pancakes.jpg", sourceType: "chef-upload", status: "ready", createdById: CHEF }],
      });
      expect((await recipeGraph("atomic-create-cover")).steps).toHaveLength(2);
    });

    it("lets only one of two interleaved creates take a title", async () => {
      const competitor = { id: "atomic-create-first", title: "Atomic Race Title", description: null, servings: null, chefId: CHEF, steps: [] };
      const d1 = interleaved(() => createRecipeDraft(prisma, competitor, database()));

      const error = await rejection(createRecipeDraft(prisma, { ...competitor, id: "atomic-create-second", steps: draftSteps }, d1));

      expect(error).toBeInstanceOf(ActiveRecipeTitleConflictError);
      expect(await rows(`SELECT "id" FROM "Recipe" WHERE "title" = 'Atomic Race Title'`)).toEqual([{ id: "atomic-create-first" }]);
      expect((await recipeGraph("atomic-create-second")).steps).toEqual([]);
    });
  });

  describe("recipe fork", () => {
    it("copies the recipe, steps, ingredients, output uses and cover in one batch", async () => {
      const result = await forkRecipe(prisma, { sourceRecipeId: SOURCE, viewerId: CHEF, recipeId: "atomic-fork" }, database());

      const source = await recipeGraph(SOURCE);
      const fork = await recipeGraph("atomic-fork");
      expect(fork).toEqual({
        ...source,
        recipe: { ...source.recipe, chefId: CHEF, sourceRecipeId: SOURCE },
      });
      expect(result).toMatchObject({ appliedTitle: "Atomic Source Loaf", titleWasSuffixed: false });
      expect(result.recipe.steps.map((step) => step.ingredients.length)).toEqual([2, 1, 0]);
    });

    it("leaves no partial fork when a late statement fails", async () => {
      await failOn("INSERT", "RecipeCover", `NEW."recipeId" = 'atomic-fork-failed'`);

      const error = await rejection(forkRecipe(prisma, {
        sourceRecipeId: SOURCE,
        viewerId: CHEF,
        titleOverride: "Atomic Failed Fork",
        recipeId: "atomic-fork-failed",
      }, database()));

      expect(String(error)).toContain(FAILURE);
      expect(await recipeGraph("atomic-fork-failed")).toEqual({ recipe: null, steps: [], ingredients: [], uses: [], covers: [] });
    });

    it("gives two interleaved forks of the same title different titles", async () => {
      const d1 = interleaved(() => forkRecipe(prisma, {
        sourceRecipeId: SOURCE,
        viewerId: CHEF,
        titleOverride: "Atomic Fork Race",
        recipeId: "atomic-fork-race-first",
      }, database()));

      const second = await forkRecipe(prisma, {
        sourceRecipeId: SOURCE,
        viewerId: CHEF,
        titleOverride: "Atomic Fork Race",
        recipeId: "atomic-fork-race-second",
      }, d1);

      expect(second).toMatchObject({ appliedTitle: "Atomic Fork Race (variation 2)", titleWasSuffixed: true });
      expect(await rows(`SELECT "id", "title" FROM "Recipe" WHERE "title" LIKE 'Atomic Fork Race%' ORDER BY "title"`)).toEqual([
        { id: "atomic-fork-race-first", title: "Atomic Fork Race" },
        { id: "atomic-fork-race-second", title: "Atomic Fork Race (variation 2)" },
      ]);
      expect((await recipeGraph("atomic-fork-race-second")).steps).toHaveLength(3);
    });
  });

  describe("recipe editor", () => {
    it("saves fields, an uploaded cover and the cookbook touch together, or none of them", async () => {
      await seedRecipe("atomic-edit");
      await failOn("UPDATE", "Cookbook", `OLD."id" = '${COOKBOOK}'`);
      const save = () => saveRecipeEditOnD1(database(), {
        recipeId: "atomic-edit",
        chefId: CHEF,
        fields: { title: "Atomic Edited", description: null, servings: "6" },
        cover: { kind: "upload", coverId: "atomic-edit-cover", imageUrl: "https://example.com/new.jpg", createdById: CHEF },
      });

      expect(String(await rejection(save()))).toContain(FAILURE);
      expect((await recipeGraph("atomic-edit")).recipe).toMatchObject({ title: "Recipe atomic-edit", servings: "2", hasActiveCover: 0 });
      expect((await recipeGraph("atomic-edit")).covers).toEqual([]);
      expect(await cookbookUpdatedAt()).toBe(OLD);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await save();
      const saved = await recipeGraph("atomic-edit");
      expect(saved.recipe).toMatchObject({
        title: "Atomic Edited", description: null, servings: "6", coverMode: "manual", activeCoverVariant: "image", hasActiveCover: 1,
      });
      expect(saved.covers).toEqual([{
        imageUrl: "https://example.com/new.jpg", stylizedImageUrl: null, sourceType: "chef-upload", status: "ready",
        generationStatus: "none", createdById: CHEF,
      }]);
      expect(await cookbookUpdatedAt()).not.toBe(OLD);

      await saveRecipeEditOnD1(database(), { recipeId: "atomic-edit", chefId: CHEF, fields: { title: "Atomic Edited", description: null, servings: null }, cover: { kind: "clear" } });
      expect((await recipeGraph("atomic-edit")).recipe).toMatchObject({ coverMode: "none", activeCoverVariant: null, hasActiveCover: 0 });
    });

    it("rejects a save whose new title another recipe took in between", async () => {
      await seedRecipe("atomic-edit-title");
      const d1 = interleaved(() => run(`UPDATE "Recipe" SET "title" = 'Atomic Taken Title' WHERE "id" = 'atomic-edit'`));

      const error = await rejection(saveRecipeEditOnD1(d1, {
        recipeId: "atomic-edit-title",
        chefId: CHEF,
        fields: { title: "Atomic Taken Title", description: null, servings: null },
        cover: null,
      }));

      expect(isD1GuardFailure(error)).toBe(true);
      expect((await recipeGraph("atomic-edit-title")).recipe).toMatchObject({ title: "Recipe atomic-edit-title" });
    });

    it("swaps two steps and touches the recipe together, or leaves both steps where they were", async () => {
      await seedRecipe("atomic-swap");
      const swap = { recipeId: "atomic-swap", stepId: "atomic-swap-step-2", stepNum: 2, targetStepId: "atomic-swap-step-1", targetStepNum: 1 };
      await failOn("UPDATE", "Recipe", `OLD."id" = 'atomic-swap'`);

      expect(String(await rejection(swapRecipeStepsOnD1(database(), swap)))).toContain(FAILURE);
      expect((await recipeGraph("atomic-swap")).steps.map((step) => step.stepTitle)).toEqual(["Mix", "Rest", "Bake"]);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      expect(isD1GuardFailure(await rejection(swapRecipeStepsOnD1(database(), { ...swap, stepNum: 3 })))).toBe(true);
      await swapRecipeStepsOnD1(database(), swap);
      const swapped = await recipeGraph("atomic-swap");
      expect(swapped.steps.map((step) => step.stepTitle)).toEqual(["Rest", "Mix", "Bake"]);
      // Ingredients and output uses follow their steps through the cascade.
      expect(swapped.ingredients.map((row) => [row.stepNum, row.ingredient])).toEqual([
        [1, "atomic egg"], [2, "atomic flour"], [2, "atomic milk"],
      ]);
      expect(swapped.uses).toEqual([{ outputStepNum: 2, inputStepNum: 3 }]);
      expect(await recipeUpdatedAt("atomic-swap")).not.toBe(OLD);
    });

    it("deletes a step only while no other step uses it, with the recipe touch", async () => {
      await seedRecipe("atomic-delete-step");
      const used = { recipeId: "atomic-delete-step", stepId: "atomic-delete-step-step-1", stepNum: 1 };
      expect(isD1GuardFailure(await rejection(deleteRecipeStepOnD1(database(), used)))).toBe(true);
      expect((await recipeGraph("atomic-delete-step")).steps).toHaveLength(3);

      const unused = { recipeId: "atomic-delete-step", stepId: "atomic-delete-step-step-2", stepNum: 2 };
      await failOn("UPDATE", "Recipe", `OLD."id" = 'atomic-delete-step'`);
      expect(String(await rejection(deleteRecipeStepOnD1(database(), unused)))).toContain(FAILURE);
      expect((await recipeGraph("atomic-delete-step")).ingredients).toHaveLength(3);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await deleteRecipeStepOnD1(database(), unused);
      const after = await recipeGraph("atomic-delete-step");
      expect(after.steps.map((step) => step.stepNum)).toEqual([1, 3]);
      expect(after.ingredients.map((row) => row.ingredient)).toEqual(["atomic flour", "atomic milk"]);
    });

    it("adds all of a batch of ingredients or none of them", async () => {
      await seedRecipe("atomic-add");
      const rowsToAdd = [
        { quantity: 1, unitId: "atomic-tbsp", ingredientRefId: "atomic-salt" },
        { quantity: 2, unitId: "atomic-tbsp", ingredientRefId: "atomic-sugar" },
      ];
      const add = { recipeId: "atomic-add", stepId: "atomic-add-step-3", stepNum: 3, rows: rowsToAdd };
      await failOn("INSERT", "Ingredient", `NEW."ingredientRefId" = 'atomic-sugar'`);

      expect(String(await rejection(addStepIngredientsOnD1(database(), add)))).toContain(FAILURE);
      expect((await recipeGraph("atomic-add")).ingredients).toHaveLength(3);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await addStepIngredientsOnD1(database(), add);
      expect((await recipeGraph("atomic-add")).ingredients.filter((row) => row.stepNum === 3)).toEqual([
        { stepNum: 3, quantity: 1, unit: "atomic tbsp", ingredient: "atomic salt" },
        { stepNum: 3, quantity: 2, unit: "atomic tbsp", ingredient: "atomic sugar" },
      ]);
      // An ingredient already in the recipe (added in between) stops the whole batch.
      expect(isD1GuardFailure(await rejection(addStepIngredientsOnD1(database(), { ...add, rows: [rowsToAdd[0]!] })))).toBe(true);
    });

    it("saves a step with its replaced output uses, or keeps the old ones", async () => {
      await seedRecipe("atomic-step-save");
      const save = {
        recipeId: "atomic-step-save", stepId: "atomic-step-save-step-3", stepNum: 3,
        stepTitle: "Bake well", description: "Bake it well", usesSteps: [1, 2, 2],
      };
      await failOn("INSERT", "StepOutputUse", `NEW."outputStepNum" = 2`);

      expect(String(await rejection(updateRecipeStepOnD1(database(), save)))).toContain(FAILURE);
      const unchanged = await recipeGraph("atomic-step-save");
      expect(unchanged.steps[2]).toMatchObject({ stepTitle: "Bake" });
      expect(unchanged.uses).toEqual([{ outputStepNum: 1, inputStepNum: 3 }]);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await updateRecipeStepOnD1(database(), save);
      const saved = await recipeGraph("atomic-step-save");
      expect(saved.steps[2]).toMatchObject({ stepTitle: "Bake well", description: "Bake it well" });
      expect(saved.uses).toEqual([{ outputStepNum: 1, inputStepNum: 3 }, { outputStepNum: 2, inputStepNum: 3 }]);
      // Step 3 has no ingredient, so clearing its output uses would leave it empty.
      expect(isD1GuardFailure(await rejection(updateRecipeStepOnD1(database(), { ...save, usesSteps: [] })))).toBe(true);
    });

    it("deletes an ingredient and touches the recipe together, and neither for another step's ingredient", async () => {
      await seedRecipe("atomic-delete-ingredient");
      const input = { recipeId: "atomic-delete-ingredient", stepNum: 2, ingredientId: "atomic-delete-ingredient-ingredient-flour" };
      expect(await deleteStepIngredientOnD1(database(), input)).toBe(false);
      expect(await recipeUpdatedAt("atomic-delete-ingredient")).toBe(OLD);

      await failOn("DELETE", "Ingredient", `OLD."recipeId" = 'atomic-delete-ingredient'`);
      expect(String(await rejection(deleteStepIngredientOnD1(database(), { ...input, stepNum: 1 })))).toContain(FAILURE);
      expect(await recipeUpdatedAt("atomic-delete-ingredient")).toBe(OLD);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      expect(await deleteStepIngredientOnD1(database(), { ...input, stepNum: 1 })).toBe(true);
      expect((await recipeGraph("atomic-delete-ingredient")).ingredients).toHaveLength(2);
      expect(await recipeUpdatedAt("atomic-delete-ingredient")).not.toBe(OLD);
    });
  });

  describe("recipe page and recipe import", () => {
    async function recipePageAction(recipeId: string, fields: Record<string, string>) {
      const cookie = await createUserSessionCookie(CHEF, env as never, new Request(`${ORIGIN}/recipes/${recipeId}`));
      const body = new FormData();
      for (const [key, value] of Object.entries(fields)) body.set(key, value);
      return handleRecipeDetailAction({
        request: new Request(`${ORIGIN}/recipes/${recipeId}`, { method: "POST", headers: { Cookie: cookie }, body }),
        params: { id: recipeId },
        context: { cloudflare: { env, ctx: createExecutionContext() } },
      } as never).catch((error: unknown) => error);
    }

    it("soft-deletes a recipe with its sync tombstone, or neither", async () => {
      await seedRecipe("atomic-page-delete");
      await failOn("INSERT", "NativeSyncTombstone", `NEW."resourceId" = 'atomic-page-delete'`);

      expect(String(await recipePageAction("atomic-page-delete", { intent: "delete" }))).toContain(FAILURE);
      expect((await recipeGraph("atomic-page-delete")).recipe).toMatchObject({ deleted: 0 });

      await run(`DROP TRIGGER "${TRIGGER}"`);
      const deleted = await recipePageAction("atomic-page-delete", { intent: "delete" });
      expect((deleted as Response).status).toBe(302);
      expect((await recipeGraph("atomic-page-delete")).recipe).toMatchObject({ deleted: 1 });
      expect(await count(`SELECT COUNT(*) AS "count" FROM "NativeSyncTombstone" WHERE "resourceId" = 'atomic-page-delete'`)).toBe(1);
    });

    it("clears a cover and touches the cookbooks together, or neither", async () => {
      await seedRecipe("atomic-page-cover");
      await run(`UPDATE "Recipe" SET "coverMode" = 'manual' WHERE "id" = 'atomic-page-cover'`);
      await run(`UPDATE "Cookbook" SET "updatedAt" = ? WHERE "id" = ?`, OLD, COOKBOOK);
      await failOn("UPDATE", "Cookbook", `OLD."id" = '${COOKBOOK}'`);
      const fields = { intent: "setRecipeNoCover", confirmNoCover: "true" };

      expect(String(await recipePageAction("atomic-page-cover", fields))).toContain(FAILURE);
      expect((await recipeGraph("atomic-page-cover")).recipe).toMatchObject({ coverMode: "manual" });

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await expect(recipePageAction("atomic-page-cover", fields)).resolves.toEqual({ success: true, intent: "setRecipeNoCover" });
      expect((await recipeGraph("atomic-page-cover")).recipe).toMatchObject({ coverMode: "none" });
      expect(await cookbookUpdatedAt()).not.toBe(OLD);
    });

    it("imports a recipe with its steps and ingredients together, or nothing", async () => {
      const importIt = () => importRecipeFromSource({
        chefId: CHEF,
        source: {
          type: "json-ld",
          sourceUrl: "https://example.com/atomic-import",
          jsonLd: {
            "@context": "https://schema.org",
            "@type": "Recipe",
            name: "Atomic Imported Rice",
            recipeIngredient: ["rice", "lemon"],
            recipeInstructions: [{ "@type": "HowToStep", text: "Rinse" }, { "@type": "HowToStep", text: "Cook" }],
          },
        },
      }, {
        db: prisma,
        env: { DB: database() },
        ingredientParser: async (text) => [{ quantity: 1, unit: "atomic whole", ingredientName: `atomic ${text}` }],
      });
      await failOn("INSERT", "Ingredient", `NEW."ingredientRefId" IN (SELECT "id" FROM "IngredientRef" WHERE "name" = 'atomic lemon')`);

      expect(String(await rejection(importIt()))).toContain(FAILURE);
      expect(await count(`SELECT COUNT(*) AS "count" FROM "Recipe" WHERE "title" LIKE 'Atomic Imported Rice%'`)).toBe(0);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      const imported = await importIt();
      expect(await recipeGraph(imported.recipeId!)).toMatchObject({
        recipe: { title: "Atomic Imported Rice", sourceUrl: "https://example.com/atomic-import" },
        steps: [
          { stepNum: 1, stepTitle: null, description: "Rinse", duration: null },
          { stepNum: 2, stepTitle: null, description: "Cook", duration: null },
        ],
        ingredients: [
          { stepNum: 1, quantity: 1, unit: "atomic whole", ingredient: "atomic lemon" },
          { stepNum: 1, quantity: 1, unit: "atomic whole", ingredient: "atomic rice" },
        ],
      });
    });
  });

  describe("daily image-generation quota", () => {
    const DAY = "2026-09-27T00:00:00.000+00:00";
    const now = () => new Date("2026-09-27T15:00:00.000Z");
    const ledger = () => rows<{ count: number }>(
      `SELECT "count" FROM "ImageGenLedger" WHERE "userId" = ? AND "kind" = 'import' AND "bucketStart" = ?`,
      FRIEND,
      DAY,
    );

    afterEach(async () => {
      await run(`DELETE FROM "ImageGenLedger" WHERE "userId" = ?`, FRIEND);
    });

    it("lets exactly one of many concurrent consumes take the last unit", async () => {
      // The day's row as Prisma's D1 adapter wrote it (offset-form timestamp), one below the cap.
      await run(
        `INSERT INTO "ImageGenLedger" ("id", "userId", "kind", "bucketStart", "count", "updatedAt") VALUES ('atomic-ledger', ?, 'import', ?, ?, ?)`,
        FRIEND,
        DAY,
        IMPORT_DAILY_CAP - 1,
        DAY,
      );

      const results = await Promise.all(Array.from({ length: 8 }, () =>
        tryConsumeImageGenQuota(prisma, FRIEND, "import", { now, d1: database() })));

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await ledger()).toEqual([{ count: IMPORT_DAILY_CAP }]);
      await expect(tryConsumeImageGenQuota(prisma, FRIEND, "import", { now, d1: database() })).resolves.toBe(false);
    });

    it("counts concurrent first consumes of the day in one row", async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () =>
        tryConsumeImageGenQuota(prisma, FRIEND, "import", { now, d1: database() })));

      expect(results).toEqual([true, true, true, true, true]);
      expect(await ledger()).toEqual([{ count: 5 }]);
    });

    it("spends one unit in one row when older writers stored the same day in two forms", async () => {
      for (const [id, day] of [["atomic-ledger-offset", DAY], ["atomic-ledger-z", "2026-09-27T00:00:00.000Z"]]) {
        await run(
          `INSERT INTO "ImageGenLedger" ("id", "userId", "kind", "bucketStart", "count", "updatedAt") VALUES (?, ?, 'import', ?, 0, ?)`,
          id,
          FRIEND,
          day,
          DAY,
        );
      }

      await expect(tryConsumeImageGenQuota(prisma, FRIEND, "import", { now, d1: database() })).resolves.toBe(true);
      const counts = await rows<{ count: number }>(`SELECT "count" FROM "ImageGenLedger" WHERE "userId" = ?`, FRIEND);
      expect(counts.map((row) => row.count).sort()).toEqual([0, 1]);
    });

    it("consumes nothing, and writes no row, for a user that is gone", async () => {
      await expect(tryConsumeImageGenQuota(prisma, "atomic-nobody", "import", { now, d1: database() })).resolves.toBe(false);
      expect(await count(`SELECT COUNT(*) AS "count" FROM "ImageGenLedger" WHERE "userId" = 'atomic-nobody'`)).toBe(0);
    });
  });

  describe("OAuth sign-up", () => {
    const googleUser = (id: string, email: string) => ({
      id, email, emailVerified: true, name: "Atomic Cook", givenName: null, familyName: null, picture: null,
    }) as never;
    const accounts = (email: string) => rows<{ id: string; provider: string | null }>(
      `SELECT "User"."id", "OAuth"."provider" FROM "User" LEFT JOIN "OAuth" ON "OAuth"."userId" = "User"."id"
       WHERE "User"."email" = ?`,
      email,
    );

    it("never leaves a user without the OAuth link it was created for", async () => {
      await failOn("INSERT", "OAuth", `NEW."providerUserId" = 'atomic-google-1'`);
      const signIn = (d1: D1ReadDatabase) => handleGoogleOAuthCallback({
        db: prisma, d1, googleUser: googleUser("atomic-google-1", "atomic-oauth-1@example.com"), currentUserId: null, redirectTo: null,
      });

      expect(String(await rejection(signIn(database())))).toContain(FAILURE);
      expect(await accounts("atomic-oauth-1@example.com")).toEqual([]);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      const created = await signIn(database());
      expect(created).toMatchObject({ success: true, action: "user_created" });
      expect(await accounts("atomic-oauth-1@example.com")).toEqual([{ id: created.userId, provider: "google" }]);
    });

    it.each([
      ["GitHub", (d1: D1ReadDatabase, id: string, email: string) => handleGitHubOAuthCallback({
        db: prisma, d1, githubUser: { id, email, emailVerified: true, login: "atomic-cook", name: null, avatarUrl: null }, currentUserId: null,
      })],
      ["Apple", (d1: D1ReadDatabase, id: string, email: string) => handleAppleOAuthCallback({
        db: prisma, d1, currentUserId: null, redirectTo: null,
        appleUser: { id, email, emailVerified: true, isPrivateEmail: false, firstName: null, lastName: null, fullName: "Atomic Cook" },
      })],
    ])("writes a new %s user and link together, or neither", async (provider, signIn) => {
      const id = `atomic-${provider.toLowerCase()}-1`;
      const email = `atomic-${provider.toLowerCase()}@example.com`;
      await failOn("INSERT", "OAuth", `NEW."providerUserId" = '${id}'`);

      expect(String(await rejection(signIn(database(), id, email)))).toContain(FAILURE);
      expect(await accounts(email)).toEqual([]);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      const created = await signIn(database(), id, email);
      expect(created).toMatchObject({ success: true, action: "user_created" });
      expect(await accounts(email)).toEqual([{ id: created.userId, provider: provider.toLowerCase() }]);
    });

    it("signs a second concurrent first sign-in in to the account the first one created", async () => {
      const identity = googleUser("atomic-google-race", "atomic-oauth-race@example.com");
      const signIn = (d1: D1ReadDatabase) => handleGoogleOAuthCallback({
        db: prisma, d1, googleUser: identity, currentUserId: null, redirectTo: null,
      });
      // The second sign-in finishes between the first one's checks and its write.
      let second: Awaited<ReturnType<typeof signIn>> | undefined;
      const first = await signIn(interleaved(async () => {
        second = await signIn(database());
      }));

      expect(second).toMatchObject({ success: true, action: "user_created" });
      expect(first).toMatchObject({ success: true, userId: second!.userId });
      expect(await accounts("atomic-oauth-race@example.com")).toEqual([{ id: second!.userId, provider: "google" }]);

      const concurrent = await Promise.all([1, 2].map(() => signIn(database())));
      expect(concurrent.map((result) => result.userId)).toEqual([second!.userId, second!.userId]);
    });

    it("answers account_exists when a sign-up in between stored the same email in another case", async () => {
      // The unique index on email is case-sensitive, so only the batch's guard stops a second account.
      const result = await createOAuthUser(prisma, {
        provider: "google",
        providerUserId: "atomic-google-case",
        providerUsername: "Atomic Cook",
        email: "atomic-oauth-case@example.com",
        name: "Atomic Cook",
      }, interleaved(() => run(
        `INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt") VALUES ('atomic-case-user', ?, 'atomic-case-user', ?, ?)`,
        "Atomic-OAuth-Case@example.com",
        OLD,
        OLD,
      )));

      expect(result).toMatchObject({ success: false, error: "account_exists" });
      expect(await count(`SELECT COUNT(*) AS "count" FROM "User" WHERE LOWER("email") = 'atomic-oauth-case@example.com'`)).toBe(1);
      expect(await count(`SELECT COUNT(*) AS "count" FROM "OAuth" WHERE "providerUserId" = 'atomic-google-case'`)).toBe(0);
    });

    it("creates one account for two truly concurrent first sign-ins", async () => {
      const identity = googleUser("atomic-google-parallel", "atomic-oauth-parallel@example.com");
      const results = await Promise.all([1, 2].map(() => handleGoogleOAuthCallback({
        db: prisma, d1: database(), googleUser: identity, currentUserId: null, redirectTo: null,
      })));

      expect(results.every((result) => result.success)).toBe(true);
      expect(results[1]!.userId).toBe(results[0]!.userId);
      expect(await accounts("atomic-oauth-parallel@example.com")).toEqual([{ id: results[0]!.userId, provider: "google" }]);
    });
  });

  describe("recipe covers", () => {
    async function seedCovers(id: string) {
      await seedRecipe(id);
      for (const index of [0, 1]) {
        await run(
          `INSERT INTO "RecipeCover" ("id", "recipeId", "imageUrl", "sourceType", "status", "createdAt") VALUES (?, ?, ?, 'chef-upload', 'ready', ?)`,
          `${id}-cover-${index}`, id, `https://example.com/${id}-${index}.jpg`, OLD,
        );
      }
      await run(`UPDATE "Recipe" SET "activeCoverId" = ?, "activeCoverVariant" = 'image', "coverMode" = 'manual' WHERE "id" = ?`, `${id}-cover-0`, id);
      await run(`UPDATE "Cookbook" SET "updatedAt" = ? WHERE "id" = ?`, OLD, COOKBOOK);
    }

    async function coverState(id: string) {
      const [recipe] = await rows<{ activeCoverId: string | null }>(`SELECT "activeCoverId" FROM "Recipe" WHERE "id" = ?`, id);
      const covers = await rows<{ id: string; status: string }>(`SELECT "id", "status" FROM "RecipeCover" WHERE "recipeId" = ? ORDER BY "id"`, id);
      return { active: recipe!.activeCoverId, covers: covers.map((cover) => cover.status), cookbookUpdatedAt: await cookbookUpdatedAt() };
    }

    it("activates a cover and touches the cookbooks together, or neither", async () => {
      await seedCovers("atomic-cover-set");
      await failOn("UPDATE", "Cookbook", `OLD."id" = '${COOKBOOK}'`);
      const activate = () => setActiveRecipeCover(prisma, { recipeId: "atomic-cover-set", coverId: "atomic-cover-set-cover-1", variant: "image" }, database());

      expect(String(await rejection(activate()))).toContain(FAILURE);
      expect(await coverState("atomic-cover-set")).toEqual({ active: "atomic-cover-set-cover-0", covers: ["ready", "ready"], cookbookUpdatedAt: OLD });

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await activate();
      expect(await coverState("atomic-cover-set")).toMatchObject({ active: "atomic-cover-set-cover-1" });
      expect(await cookbookUpdatedAt()).not.toBe(OLD);
    });

    it("archives the active cover, activates its replacement and touches the cookbooks together, or none of it", async () => {
      await seedCovers("atomic-cover-archive");
      await failOn("UPDATE", "Cookbook", `OLD."id" = '${COOKBOOK}'`);
      const archive = () => archiveRecipeCover(prisma, {
        recipeId: "atomic-cover-archive",
        coverId: "atomic-cover-archive-cover-0",
        replacementCoverId: "atomic-cover-archive-cover-1",
        replacementVariant: "image",
      }, database());

      expect(String(await rejection(archive()))).toContain(FAILURE);
      expect(await coverState("atomic-cover-archive")).toEqual({
        active: "atomic-cover-archive-cover-0", covers: ["ready", "ready"], cookbookUpdatedAt: OLD,
      });

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await archive();
      expect(await coverState("atomic-cover-archive")).toMatchObject({
        active: "atomic-cover-archive-cover-1", covers: ["archived", "ready"],
      });
    });
  });

  describe("REST API recipe writes", () => {
    it("updates a recipe and its cookbooks together, or neither", async () => {
      await seedRecipe("atomic-api-update");
      await run(`UPDATE "Cookbook" SET "updatedAt" = ? WHERE "id" = ?`, OLD, COOKBOOK);
      await failOn("UPDATE", "Cookbook", `OLD."id" = '${COOKBOOK}'`);
      const patch = { clientMutationId: "atomic-patch", fields: { title: "Atomic API Title" } };

      expect(String(await rejection(updateNativeRecipe(prisma, CHEF, "atomic-api-update", patch, database())))).toContain(FAILURE);
      expect((await recipeGraph("atomic-api-update")).recipe).toMatchObject({ title: "Recipe atomic-api-update" });

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await expect(updateNativeRecipe(prisma, CHEF, "atomic-api-update", patch, database())).resolves.toMatchObject({ ok: true });
      expect((await recipeGraph("atomic-api-update")).recipe).toMatchObject({ title: "Atomic API Title" });
      expect(await cookbookUpdatedAt()).not.toBe(OLD);
    });

    it("applies a recipe update with expectedUpdatedAt only while the recipe is unchanged, on real D1", async () => {
      await seedRecipe("atomic-api-precondition");
      const id = "atomic-api-precondition";
      const patch = (expectedUpdatedAt: string, title: string) => ({
        clientMutationId: `atomic-precondition-${title}`,
        fields: { title },
        expectedUpdatedAt: new Date(expectedUpdatedAt),
      });

      // Seeded with updatedAt OLD as ISO text; the batch's guard compares it as the same instant.
      await expect(updateNativeRecipe(prisma, CHEF, id, patch(OLD, "Atomic Fresh"), database())).resolves.toMatchObject({ ok: true });
      const after = await recipeUpdatedAt(id);
      expect(after).not.toBe(OLD);

      // Another save moved updatedAt on (in Prisma's +00:00 format) between this client's read and its batch.
      const racing: D1ReadDatabase = {
        prepare: (sql) => database().prepare(sql),
        async batch(statements) {
          await run(`UPDATE "Recipe" SET "title" = 'Atomic Theirs', "updatedAt" = '2026-05-01T00:00:00.000+00:00' WHERE "id" = ?`, id);
          return database().batch(statements as never);
        },
      };
      await expect(updateNativeRecipe(prisma, CHEF, id, patch(after, "Atomic Stale"), racing)).resolves.toMatchObject({
        ok: false,
        code: "edit_conflict",
        details: { currentUpdatedAt: "2026-05-01T00:00:00.000Z" },
      });
      expect((await recipeGraph(id)).recipe).toMatchObject({ title: "Atomic Theirs" });
    });

    it("creates a recipe with its steps' output uses together, or nothing", async () => {
      const input = {
        clientMutationId: "atomic-create-uses",
        title: "Atomic Layered Bake",
        description: null,
        servings: null,
        steps: [
          { stepTitle: null, description: "Sauce", duration: null, ingredients: [{ quantity: 1, unit: "atomic cup", ingredientName: "atomic milk" }], outputStepNums: [] },
          { stepTitle: null, description: "Layer", duration: null, ingredients: [], outputStepNums: [1] },
        ],
      };
      await failOn("INSERT", "StepOutputUse", `NEW."inputStepNum" = 2 AND NEW."recipeId" = 'atomic-create-uses'`);

      expect(String(await rejection(createNativeRecipe(prisma, CHEF, input, { recipeId: "atomic-create-uses", d1: database() })))).toContain(FAILURE);
      expect((await recipeGraph("atomic-create-uses")).recipe).toBeNull();
      expect(await count(`SELECT COUNT(*) AS "count" FROM "RecipeStep" WHERE "recipeId" = 'atomic-create-uses'`)).toBe(0);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await expect(createNativeRecipe(prisma, CHEF, input, { recipeId: "atomic-create-uses", d1: database() }))
        .resolves.toMatchObject({ ok: true, data: { recipeId: "atomic-create-uses" } });
      const created = await recipeGraph("atomic-create-uses");
      expect(created.steps).toHaveLength(2);
      expect(created.uses).toEqual([{ outputStepNum: 1, inputStepNum: 2 }]);
    });

    it("soft-deletes a recipe and writes its sync tombstone together, or neither", async () => {
      await seedRecipe("atomic-api-delete");
      await failOn("INSERT", "NativeSyncTombstone", `NEW."resourceId" = 'atomic-api-delete'`);

      expect(String(await rejection(deleteNativeRecipe(prisma, CHEF, "atomic-api-delete", database())))).toContain(FAILURE);
      expect((await recipeGraph("atomic-api-delete")).recipe).toMatchObject({ deleted: 0 });

      await run(`DROP TRIGGER "${TRIGGER}"`);
      const deleted = await deleteNativeRecipe(prisma, CHEF, "atomic-api-delete", database());
      expect(deleted).toMatchObject({ ok: true, data: { recipe: { id: "atomic-api-delete", title: "Recipe atomic-api-delete" } } });
      const tombstones = await rows(`SELECT "resourceType", "title" FROM "NativeSyncTombstone" WHERE "resourceId" = 'atomic-api-delete'`);
      expect(tombstones).toEqual([{ resourceType: "recipe", title: "Recipe atomic-api-delete" }]);
      expect((await recipeGraph("atomic-api-delete")).recipe).toMatchObject({ deleted: 1 });
    });

    it("creates a step with its output uses and ingredients, or nothing", async () => {
      await seedRecipe("atomic-api-step");
      const input = {
        clientMutationId: "atomic-step-create",
        stepTitle: "Glaze",
        description: "Glaze it",
        duration: null,
        ingredients: [{ quantity: 1, unit: "Atomic Drizzle", ingredientName: "Atomic Honey" }],
        outputStepNums: [3],
      };
      await failOn("INSERT", "Ingredient", `NEW."recipeId" = 'atomic-api-step'`);

      const error = await rejection(createNativeRecipeStep(prisma, CHEF, "atomic-api-step", input, { stepId: "atomic-api-step-4", d1: database() }));
      expect(String(error)).toContain(FAILURE);
      const unchanged = await recipeGraph("atomic-api-step");
      expect(unchanged.steps).toHaveLength(3);
      expect(unchanged.uses).toHaveLength(1);
      expect(await count(`SELECT COUNT(*) AS "count" FROM "Unit" WHERE "name" = 'atomic drizzle'`)).toBe(0);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await expect(createNativeRecipeStep(prisma, CHEF, "atomic-api-step", input, { stepId: "atomic-api-step-4", d1: database() }))
        .resolves.toMatchObject({ ok: true, data: { stepId: "atomic-api-step-4", stepNum: 4 } });
      const created = await recipeGraph("atomic-api-step");
      expect(created.steps[3]).toMatchObject({ stepNum: 4, stepTitle: "Glaze" });
      expect(created.ingredients.at(-1)).toEqual({ stepNum: 4, quantity: 1, unit: "atomic drizzle", ingredient: "atomic honey" });
      expect(created.uses).toEqual([{ outputStepNum: 1, inputStepNum: 3 }, { outputStepNum: 3, inputStepNum: 4 }]);
    });

    it("updates a step's fields and output uses together, or neither", async () => {
      await seedRecipe("atomic-api-step-update");
      const patch = { clientMutationId: "atomic-step-update", fields: { stepTitle: "Bake hot", outputStepNums: [2] } };
      await failOn("INSERT", "StepOutputUse", `NEW."recipeId" = 'atomic-api-step-update'`);

      const call = () => updateNativeRecipeStep(prisma, CHEF, "atomic-api-step-update", "atomic-api-step-update-step-3", patch, { d1: database() });
      expect(String(await rejection(call()))).toContain(FAILURE);
      expect((await recipeGraph("atomic-api-step-update")).steps[2]).toMatchObject({ stepTitle: "Bake" });

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await expect(call()).resolves.toMatchObject({ ok: true, data: { updated: true } });
      const updated = await recipeGraph("atomic-api-step-update");
      expect(updated.steps[2]).toMatchObject({ stepTitle: "Bake hot" });
      expect(updated.uses).toEqual([{ outputStepNum: 2, inputStepNum: 3 }]);
    });

    it("deletes a step with its tombstone, or neither", async () => {
      await seedRecipe("atomic-api-step-delete");
      await seedIdempotencyKey("atomic-key-step-delete");
      await failOn("UPDATE", "Recipe", `OLD."id" = 'atomic-api-step-delete'`);
      const call = () => deleteNativeRecipeStep(prisma, CHEF, "atomic-api-step-delete", "atomic-api-step-delete-step-2", {
        tombstone: { idempotencyKeyId: "atomic-key-step-delete", operation: "recipes.steps.delete" },
        d1: database(),
      });

      expect(String(await rejection(call()))).toContain(FAILURE);
      expect((await recipeGraph("atomic-api-step-delete")).steps).toHaveLength(3);
      expect(await count(`SELECT COUNT(*) AS "count" FROM "ApiMutationTombstone" WHERE "idempotencyKeyId" = 'atomic-key-step-delete'`)).toBe(0);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await expect(call()).resolves.toMatchObject({ ok: true });
      expect((await recipeGraph("atomic-api-step-delete")).steps.map((step) => step.stepNum)).toEqual([1, 3]);
      expect(await rows(`SELECT "resourceType", "payload" FROM "ApiMutationTombstone" WHERE "idempotencyKeyId" = 'atomic-key-step-delete'`))
        .toEqual([{ resourceType: "recipe_step", payload: JSON.stringify({ recipeId: "atomic-api-step-delete", stepNum: 2 }) }]);
    });

    it("adds and deletes a step ingredient atomically", async () => {
      await seedRecipe("atomic-api-ingredient");
      await seedIdempotencyKey("atomic-key-ingredient");
      await failOn("UPDATE", "Recipe", `OLD."id" = 'atomic-api-ingredient'`);
      const add = () => createNativeRecipeStepIngredient(prisma, CHEF, "atomic-api-ingredient", "atomic-api-ingredient-step-2", {
        clientMutationId: "atomic-ingredient-add", quantity: 4, unit: "atomic tbsp", ingredientName: "Atomic Salt",
      }, { ingredientId: "atomic-api-ingredient-salt", d1: database() });
      const remove = () => deleteNativeRecipeStepIngredient(prisma, CHEF, "atomic-api-ingredient", "atomic-api-ingredient-step-1", "atomic-api-ingredient-ingredient-flour", {
        tombstone: { idempotencyKeyId: "atomic-key-ingredient", operation: "recipes.steps.ingredients.delete" },
        d1: database(),
      });

      expect(String(await rejection(add()))).toContain(FAILURE);
      expect(String(await rejection(remove()))).toContain(FAILURE);
      expect((await recipeGraph("atomic-api-ingredient")).ingredients).toHaveLength(3);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await expect(add()).resolves.toMatchObject({ ok: true });
      await expect(remove()).resolves.toMatchObject({ ok: true });
      expect((await recipeGraph("atomic-api-ingredient")).ingredients.map((row) => row.ingredient)).toEqual([
        "atomic milk", "atomic egg", "atomic salt",
      ]);
      expect(await count(`SELECT COUNT(*) AS "count" FROM "ApiMutationTombstone" WHERE "idempotencyKeyId" = 'atomic-key-ingredient'`)).toBe(1);
    });

    it("renumbers every step or none, and re-reads the steps if they changed after they were read", async () => {
      await seedRecipe("atomic-api-reorder");
      await seedIdempotencyKey("atomic-key-reorder");
      const input = { clientMutationId: "atomic-reorder", stepId: "atomic-api-reorder-step-2", toStepNum: 1 };
      const options = { tombstone: { idempotencyKeyId: "atomic-key-reorder", operation: "recipes.steps.reorder" } };
      await failOn("INSERT", "ApiMutationTombstone", `NEW."idempotencyKeyId" = 'atomic-key-reorder'`);

      expect(String(await rejection(reorderNativeRecipeStep(prisma, CHEF, "atomic-api-reorder", input, { ...options, d1: database() })))).toContain(FAILURE);
      expect((await recipeGraph("atomic-api-reorder")).steps.map((step) => step.stepTitle)).toEqual(["Mix", "Rest", "Bake"]);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      const addedInBetween = interleaved(() => run(
        `INSERT INTO "RecipeStep" ("id", "recipeId", "stepNum", "description", "updatedAt") VALUES ('atomic-api-reorder-step-4', 'atomic-api-reorder', 4, 'Late', ?)`,
        OLD,
      ));
      // The first batch is stopped (a step appeared after the read); the write runs again from
      // the current steps and lands.
      await expect(reorderNativeRecipeStep(prisma, CHEF, "atomic-api-reorder", input, { ...options, d1: addedInBetween }))
        .resolves.toMatchObject({ ok: true, data: { reordered: true } });
      const reordered = await recipeGraph("atomic-api-reorder");
      expect(reordered.steps.map((step) => step.stepTitle)).toEqual(["Rest", "Mix", "Bake", null]);
      expect(reordered.uses).toEqual([{ outputStepNum: 2, inputStepNum: 3 }]);
    });

    it("replaces a step's output uses or keeps the old ones", async () => {
      await seedRecipe("atomic-api-uses");
      const input = { clientMutationId: "atomic-uses", inputStepId: "atomic-api-uses-step-3", outputStepNums: [2] };
      await failOn("INSERT", "StepOutputUse", `NEW."recipeId" = 'atomic-api-uses'`);

      expect(String(await rejection(replaceNativeRecipeStepOutputUses(prisma, CHEF, "atomic-api-uses", input, { d1: database() })))).toContain(FAILURE);
      expect((await recipeGraph("atomic-api-uses")).uses).toEqual([{ outputStepNum: 1, inputStepNum: 3 }]);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await expect(replaceNativeRecipeStepOutputUses(prisma, CHEF, "atomic-api-uses", input, { d1: database() }))
        .resolves.toMatchObject({ ok: true });
      expect((await recipeGraph("atomic-api-uses")).uses).toEqual([{ outputStepNum: 2, inputStepNum: 3 }]);
    });

    it("rolls back a REST recipe create end to end and completes it on retry", async () => {
      const requestId = "req_atomic_recipe_create";
      const batchError = new Error(FAILURE);
      const realDatabase = database();
      const failingDatabase = {
        prepare: realDatabase.prepare.bind(realDatabase),
        exec: realDatabase.exec.bind(realDatabase),
        async batch(statements: D1PreparedStatement[]) {
          try {
            return await realDatabase.batch(statements);
          } catch {
            throw batchError;
          }
        },
      };
      const routeEnv = (DB: unknown) => new Proxy(env as object, {
        get: (target, property, receiver) => (property === "DB" ? DB : Reflect.get(target, property, receiver)),
      });
      const post = (id: string, DB: unknown) => apiV1Action({
        request: new Request(`${ORIGIN}/api/v1/recipes`, {
          method: "POST",
          headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "X-Request-Id": id },
          body: JSON.stringify({
            clientMutationId: "atomic-rest-create",
            title: "Atomic REST Loaf",
            steps: draftSteps.map((step) => ({
              ...step,
              ingredients: step.ingredients.map(({ ingredientName, ...ingredient }) => ({ ...ingredient, name: ingredientName })),
            })),
          }),
        }),
        params: { "*": "recipes" },
        context: { cloudflare: { env: routeEnv(DB), ctx: createExecutionContext() } },
      } as never);
      await failOn("INSERT", "Ingredient", `NEW."quantity" = 3`);
      expectConsoleError("[api-v1] internal_error", {
        requestId,
        method: "POST",
        path: "/api/v1/recipes",
        error: { name: batchError.name, message: batchError.message, stack: batchError.stack },
      });

      const blocked = await post(requestId, failingDatabase);
      expect(blocked.status).toBe(500);
      expect(await count(`SELECT COUNT(*) AS "count" FROM "Recipe" WHERE "title" = 'Atomic REST Loaf'`)).toBe(0);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      const retry = await post("req_atomic_recipe_create_retry", realDatabase);
      expect(retry.status).toBe(201);
      const [created] = await rows<{ id: string }>(`SELECT "id" FROM "Recipe" WHERE "title" = 'Atomic REST Loaf'`);
      const graph = await recipeGraph(created!.id);
      expect(graph.steps).toHaveLength(2);
      expect(graph.ingredients).toHaveLength(3);
    });
  });

  describe("MCP recipe tools", () => {
    const context = () => ({
      db: prisma,
      env: { DB: database() },
      principal: {
        id: CHEF, email: `${CHEF}@example.com`, username: "atomic_chef", source: "bearer" as const, scopes: ["kitchen:read", "kitchen:write"],
      },
    });

    it("replaces a recipe's steps and fields together, never leaving it without steps", async () => {
      await seedRecipe("atomic-mcp-update");
      const args = {
        id: "atomic-mcp-update",
        title: "Atomic MCP Title",
        steps: [{ title: "Only", description: "One step now", ingredients: [{ name: "Atomic Salt", quantity: 1, unit: "atomic tbsp" }] }],
      };
      await failOn("INSERT", "Ingredient", `NEW."recipeId" = 'atomic-mcp-update'`);

      expect(String(await rejection(callSpoonjoyApiOperation("update_recipe", args, context())))).toContain(FAILURE);
      const unchanged = await recipeGraph("atomic-mcp-update");
      expect(unchanged.recipe).toMatchObject({ title: "Recipe atomic-mcp-update" });
      expect(unchanged.steps).toHaveLength(3);
      expect(unchanged.ingredients).toHaveLength(3);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await callSpoonjoyApiOperation("update_recipe", args, context());
      const updated = await recipeGraph("atomic-mcp-update");
      expect(updated.recipe).toMatchObject({ title: "Atomic MCP Title" });
      expect(updated.steps).toEqual([{ stepNum: 1, stepTitle: "Only", description: "One step now", duration: null }]);
      expect(updated.ingredients).toEqual([{ stepNum: 1, quantity: 1, unit: "atomic tbsp", ingredient: "atomic salt" }]);
      expect(updated.uses).toEqual([]);
    });

    it("soft-deletes a recipe with its sync tombstone, updatedAt bump and cookbook touch together, or none of them", async () => {
      await seedRecipe("atomic-mcp-delete");
      await run(`UPDATE "Cookbook" SET "updatedAt" = ? WHERE "id" = ?`, OLD, COOKBOOK);
      await failOn("INSERT", "NativeSyncTombstone", `NEW."resourceId" = 'atomic-mcp-delete'`);

      expect(String(await rejection(callSpoonjoyApiOperation("delete_recipe", { id: "atomic-mcp-delete" }, context())))).toContain(FAILURE);
      expect((await recipeGraph("atomic-mcp-delete")).recipe).toMatchObject({ deleted: 0 });
      expect(await recipeUpdatedAt("atomic-mcp-delete")).toBe(OLD);
      expect(await cookbookUpdatedAt()).toBe(OLD);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await expect(callSpoonjoyApiOperation("delete_recipe", { id: "atomic-mcp-delete" }, context()))
        .resolves.toMatchObject({ deleted: true, recipe: { id: "atomic-mcp-delete" } });
      const [recipe] = await rows<{ deletedAt: string; updatedAt: string }>(
        `SELECT "deletedAt", "updatedAt" FROM "Recipe" WHERE "id" = 'atomic-mcp-delete'`,
      );
      expect(recipe!.updatedAt).toBe(recipe!.deletedAt);
      expect(await cookbookUpdatedAt()).toBe(recipe!.deletedAt);
      expect(await rows(`SELECT "accountId", "resourceType", "title", "deletedAt" FROM "NativeSyncTombstone" WHERE "resourceId" = 'atomic-mcp-delete'`))
        .toEqual([{ accountId: CHEF, resourceType: "recipe", title: "Recipe atomic-mcp-delete", deletedAt: recipe!.deletedAt }]);
    });

    it("creates a recipe with its steps together, or nothing", async () => {
      const args = {
        title: "Atomic MCP Stew",
        sourceUrl: "https://example.com/stew",
        steps: [{ description: "Simmer", duration: 30, ingredients: [{ name: "Atomic Egg", quantity: 2, unit: "atomic cup" }] }],
      };
      await failOn("INSERT", "Ingredient", `NEW."quantity" = 2 AND NEW."ingredientRefId" = 'atomic-egg'`);

      expect(String(await rejection(callSpoonjoyApiOperation("create_recipe", args, context())))).toContain(FAILURE);
      expect(await count(`SELECT COUNT(*) AS "count" FROM "Recipe" WHERE "title" = 'Atomic MCP Stew'`)).toBe(0);

      await run(`DROP TRIGGER "${TRIGGER}"`);
      await callSpoonjoyApiOperation("create_recipe", args, context());
      const [created] = await rows<{ id: string }>(`SELECT "id" FROM "Recipe" WHERE "title" = 'Atomic MCP Stew'`);
      expect(await recipeGraph(created!.id)).toMatchObject({
        recipe: { sourceUrl: "https://example.com/stew", chefId: CHEF },
        steps: [{ stepNum: 1, stepTitle: null, description: "Simmer", duration: 30 }],
        ingredients: [{ stepNum: 1, quantity: 2, unit: "atomic cup", ingredient: "atomic egg" }],
      });
    });
  });
});
