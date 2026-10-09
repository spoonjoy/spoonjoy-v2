import type { D1Query } from "~/lib/d1-read.server";
import { d1Guard, d1Timestamp } from "~/lib/d1-write.server";

// Statements for recipe writes that go to D1 as one atomic batch (see d1-write.server.ts).
// Each mirrors the Prisma write it replaces, including the `@updatedAt` columns Prisma sets
// on every create and update. Ids Prisma would generate as cuids are random UUIDs here, as
// in the other D1 write paths.

export interface RecipeInsert {
  id: string;
  title: string;
  description: string | null;
  servings: string | null;
  chefId: string;
  sourceRecipeId?: string | null;
  sourceUrl?: string | null;
  coverMode?: string;
  now: Date;
}

export function recipeInsertStatement(recipe: RecipeInsert): D1Query {
  const at = d1Timestamp(recipe.now);
  return [
    `INSERT INTO "Recipe" (
       "id", "title", "description", "servings", "chefId", "sourceRecipeId", "sourceUrl", "coverMode", "createdAt",
       "updatedAt"
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    recipe.id,
    recipe.title,
    recipe.description,
    recipe.servings,
    recipe.chefId,
    recipe.sourceRecipeId ?? null,
    recipe.sourceUrl ?? null,
    recipe.coverMode ?? "auto",
    at,
    at,
  ];
}

/**
 * Fails the batch if the chef already has an active recipe with this title. SQLite treats
 * NULL `deletedAt` values as distinct, so the `(chefId, title, deletedAt)` unique index does
 * not stop two active recipes sharing a title; the app checks first, and this guard makes
 * the check hold at the moment of the write.
 */
export function activeRecipeTitleFreeGuard(chefId: string, title: string, excludeRecipeId?: string): D1Query {
  return excludeRecipeId === undefined
    ? d1Guard(
      `NOT EXISTS (SELECT 1 FROM "Recipe" WHERE "chefId" = ? AND "title" = ? AND "deletedAt" IS NULL)`,
      chefId,
      title,
    )
    : d1Guard(
      `NOT EXISTS (SELECT 1 FROM "Recipe" WHERE "chefId" = ? AND "title" = ? AND "deletedAt" IS NULL AND "id" <> ?)`,
      chefId,
      title,
      excludeRecipeId,
    );
}

/** `unit.upsert({ where: { name }, update: {}, create: { name } })`. */
function unitUpsertStatement(name: string, now: Date): D1Query {
  return [
    `INSERT INTO "Unit" ("id", "name", "updatedAt") VALUES (?, ?, ?) ON CONFLICT ("name") DO NOTHING`,
    crypto.randomUUID(),
    name,
    d1Timestamp(now),
  ];
}

/** `ingredientRef.upsert({ where: { name }, update: {}, create: { name } })`. */
function ingredientRefUpsertStatement(name: string, now: Date): D1Query {
  return [
    `INSERT INTO "IngredientRef" ("id", "name", "updatedAt") VALUES (?, ?, ?) ON CONFLICT ("name") DO NOTHING`,
    crypto.randomUUID(),
    name,
    d1Timestamp(now),
  ];
}

export interface StepInsert {
  id?: string;
  recipeId: string;
  stepNum: number;
  stepTitle: string | null;
  description: string;
  duration: number | null;
  now: Date;
}

export function stepInsertStatement(step: StepInsert): D1Query {
  return [
    `INSERT INTO "RecipeStep" ("id", "recipeId", "stepNum", "stepTitle", "description", "duration", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    step.id ?? crypto.randomUUID(),
    step.recipeId,
    step.stepNum,
    step.stepTitle,
    step.description,
    step.duration,
    d1Timestamp(step.now),
  ];
}

export interface IngredientInsert {
  id?: string;
  recipeId: string;
  stepNum: number;
  quantity: number;
  unitId: string;
  ingredientRefId: string;
  now: Date;
}

export function ingredientInsertStatement(ingredient: IngredientInsert): D1Query {
  return [
    `INSERT INTO "Ingredient" ("id", "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ingredient.id ?? crypto.randomUUID(),
    ingredient.recipeId,
    ingredient.stepNum,
    ingredient.quantity,
    ingredient.unitId,
    ingredient.ingredientRefId,
    d1Timestamp(ingredient.now),
  ];
}

export interface NamedIngredientInsert {
  id?: string;
  recipeId: string;
  stepNum: number;
  quantity: number;
  unitName: string;
  ingredientName: string;
  now: Date;
}

/**
 * Get-or-create statements for the named units and ingredient refs, once per distinct name.
 * Put them before the `namedIngredientInsertStatement`s that use the names.
 */
export function nameUpsertStatements(
  ingredients: ReadonlyArray<Pick<NamedIngredientInsert, "unitName" | "ingredientName">>,
  now: Date,
): D1Query[] {
  const unitNames = [...new Set(ingredients.map((ingredient) => ingredient.unitName))];
  const ingredientNames = [...new Set(ingredients.map((ingredient) => ingredient.ingredientName))];
  return [
    ...unitNames.map((name) => unitUpsertStatement(name, now)),
    ...ingredientNames.map((name) => ingredientRefUpsertStatement(name, now)),
  ];
}

/**
 * An ingredient whose unit and ingredient ref are given by name. With the names' upserts
 * earlier in the same batch, both resolve to exactly one row and this inserts exactly one
 * ingredient.
 */
export function namedIngredientInsertStatement(ingredient: NamedIngredientInsert): D1Query {
  return [
    `INSERT INTO "Ingredient" ("id", "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId", "updatedAt")
     SELECT ?, ?, ?, ?, "Unit"."id", "IngredientRef"."id", ?
     FROM "Unit", "IngredientRef"
     WHERE "Unit"."name" = ? AND "IngredientRef"."name" = ?`,
    ingredient.id ?? crypto.randomUUID(),
    ingredient.recipeId,
    ingredient.stepNum,
    ingredient.quantity,
    d1Timestamp(ingredient.now),
    ingredient.unitName,
    ingredient.ingredientName,
  ];
}

export function stepOutputUseInsertStatement(
  recipeId: string,
  inputStepNum: number,
  outputStepNum: number,
  now: Date,
): D1Query {
  return [
    `INSERT INTO "StepOutputUse" ("id", "recipeId", "outputStepNum", "inputStepNum", "updatedAt") VALUES (?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    recipeId,
    outputStepNum,
    inputStepNum,
    d1Timestamp(now),
  ];
}

/** `stepOutputUse.deleteMany({ where: { recipeId, inputStepNum } })`. */
export function stepOutputUsesDeleteStatement(recipeId: string, inputStepNum: number): D1Query {
  return [`DELETE FROM "StepOutputUse" WHERE "recipeId" = ? AND "inputStepNum" = ?`, recipeId, inputStepNum];
}

/** The Recipe columns the D1 write paths update. */
export interface RecipeFields {
  title?: string;
  description?: string | null;
  servings?: string | null;
  sourceUrl?: string | null;
  activeCoverId?: string | null;
  activeCoverVariant?: string | null;
  coverMode?: string;
}

const RECIPE_FIELD_COLUMNS = [
  "title",
  "description",
  "servings",
  "sourceUrl",
  "activeCoverId",
  "activeCoverVariant",
  "coverMode",
] as const satisfies ReadonlyArray<keyof RecipeFields>;

/** `recipe.update({ where: { id }, data: { ...fields, updatedAt } })`. */
export function recipeUpdateStatement(recipeId: string, fields: RecipeFields, updatedAt: Date): D1Query {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const column of RECIPE_FIELD_COLUMNS) {
    if (!(column in fields)) continue;
    assignments.push(`"${column}" = ?`);
    values.push(fields[column]);
  }
  assignments.push(`"updatedAt" = ?`);
  values.push(d1Timestamp(updatedAt));
  return [`UPDATE "Recipe" SET ${assignments.join(", ")} WHERE "id" = ?`, ...values, recipeId];
}

/** `touchNativeSyncCookbooksForRecipeOperation`: every cookbook holding the recipe. */
export function cookbooksForRecipeTouchStatement(recipeId: string, updatedAt: Date): D1Query {
  return [
    `UPDATE "Cookbook" SET "updatedAt" = ?
     WHERE "id" IN (SELECT "cookbookId" FROM "RecipeInCookbook" WHERE "recipeId" = ?)`,
    d1Timestamp(updatedAt),
    recipeId,
  ];
}

/**
 * Fails the batch unless the recipe still exists and is not soft-deleted, as the action's
 * checks found it. (Prisma's `recipe.update` only threw for a recipe that was gone.)
 */
export function recipeActiveGuard(recipeId: string): D1Query {
  return d1Guard(`EXISTS (SELECT 1 FROM "Recipe" WHERE "id" = ? AND "deletedAt" IS NULL)`, recipeId);
}

/** Fails the batch unless the step is still the recipe's step `stepNum`. */
export function stepAtGuard(stepId: string, recipeId: string, stepNum: number): D1Query {
  return d1Guard(
    `EXISTS (SELECT 1 FROM "RecipeStep" WHERE "id" = ? AND "recipeId" = ? AND "stepNum" = ?)`,
    stepId,
    recipeId,
    stepNum,
  );
}

/**
 * Fails the batch if the recipe now has a step output use that moving step `fromStepNum` to
 * position `toStepNum` would break, as `validateStepReorderComplete` checks: a step at or
 * before the new position that uses the moved step's output (moving later), or a step at or
 * after the new position whose output the moved step uses (moving earlier). The step-number
 * guards beside it keep those numbers the ones the check read.
 */
export function stepReorderDependencyFreeGuard(recipeId: string, fromStepNum: number, toStepNum: number): D1Query {
  return toStepNum > fromStepNum
    ? d1Guard(
      `NOT EXISTS (SELECT 1 FROM "StepOutputUse" WHERE "recipeId" = ? AND "outputStepNum" = ? AND "inputStepNum" <= ?)`,
      recipeId,
      fromStepNum,
      toStepNum,
    )
    : d1Guard(
      `NOT EXISTS (SELECT 1 FROM "StepOutputUse" WHERE "recipeId" = ? AND "inputStepNum" = ? AND "outputStepNum" >= ?)`,
      recipeId,
      fromStepNum,
      toStepNum,
    );
}

/** `recipeStep.update({ where: { id }, data: { stepNum } })`, which also sets `updatedAt`. */
export function stepNumUpdateStatement(stepId: string, stepNum: number, now: Date): D1Query {
  return [
    `UPDATE "RecipeStep" SET "stepNum" = ?, "updatedAt" = ? WHERE "id" = ?`,
    stepNum,
    d1Timestamp(now),
    stepId,
  ];
}

/** `recipeStep.delete({ where: { id } })`; ingredients and output uses cascade. */
export function stepDeleteStatement(stepId: string): D1Query {
  return [`DELETE FROM "RecipeStep" WHERE "id" = ?`, stepId];
}

export interface ReplacementStep {
  title?: string | null;
  description: string;
  duration?: number | null;
  ingredients: ReadonlyArray<{ name: string; quantity: number; unit: string }>;
}

/**
 * Replaces all of a recipe's steps (and so its ingredients and step output uses) with
 * `steps`, numbered from 1. Unit and ingredient names must already be normalized. In one
 * batch the clear and the rebuild apply together, so a failure cannot leave the recipe
 * without its steps.
 */
export function recipeStepsReplaceStatements(
  recipeId: string,
  steps: readonly ReplacementStep[],
  now: Date,
): D1Query[] {
  const ingredients = steps.flatMap((step, index) => step.ingredients.map((ingredient) => ({
    recipeId,
    stepNum: index + 1,
    quantity: ingredient.quantity,
    unitName: ingredient.unit,
    ingredientName: ingredient.name,
    now,
  })));
  return [
    ...nameUpsertStatements(ingredients, now),
    [`DELETE FROM "StepOutputUse" WHERE "recipeId" = ?`, recipeId],
    [`DELETE FROM "Ingredient" WHERE "recipeId" = ?`, recipeId],
    [`DELETE FROM "RecipeStep" WHERE "recipeId" = ?`, recipeId],
    ...steps.map((step, index) => stepInsertStatement({
      recipeId,
      stepNum: index + 1,
      stepTitle: step.title ?? null,
      description: step.description,
      duration: step.duration ?? null,
      now,
    })),
    ...ingredients.map(namedIngredientInsertStatement),
  ];
}
