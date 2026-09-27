import type { PrismaClient } from "@prisma/client";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { validateStepDeletion } from "~/lib/step-deletion-validation.server";
import { d1Guard, d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";
import { coverInsertStatement } from "~/lib/recipe-cover.server";
import {
  activeRecipeTitleFreeGuard,
  cookbooksForRecipeTouchStatement,
  ingredientInsertStatement,
  recipeActiveGuard,
  recipeUpdateStatement,
  stepAtGuard,
  stepDeleteStatement,
  stepNumUpdateStatement,
  stepOutputUseInsertStatement,
  stepOutputUsesDeleteStatement,
  type RecipeFields,
} from "~/lib/recipe-d1-writes.server";

// The recipe editor's writes (recipe edit page and step edit page) as atomic D1 batches.
// Each batch starts with guards that re-check, as it writes, what the action read and
// validated first; if another request changed those rows in between, the batch fails and
// nothing in it applies. The Prisma versions stay in the routes for when there is no binding.

/** The answer for an editor write that lost a race and whose checks still pass. */
export const RECIPE_CHANGED_MESSAGE = "This recipe changed while you were editing it. Reload the page and try again.";

/**
 * What the step-delete checks answer now, for a delete whose batch was stopped because the
 * step moved, went away or gained a dependent step in between.
 */
export async function stepDeletionRaceAnswer(
  db: PrismaClient,
  recipeId: string,
  stepId: string,
): Promise<{ error: string; status: number }> {
  const step = await db.recipeStep.findUnique({ where: { id: stepId }, select: { recipeId: true, stepNum: true } });
  if (!step || step.recipeId !== recipeId) return { error: "Step not found", status: 404 };
  const validation = await validateStepDeletion(db, recipeId, step.stepNum);
  return validation.valid ? { error: RECIPE_CHANGED_MESSAGE, status: 409 } : { error: validation.error, status: 400 };
}

/**
 * For an ingredient add whose batch was stopped: the name of one of the ingredients another
 * request added to the recipe in between, or null when the step changed instead.
 */
export async function ingredientAlreadyInRecipe(
  db: PrismaClient,
  recipeId: string,
  ingredientRefIds: readonly string[],
): Promise<string | null> {
  const existing = await db.ingredient.findFirst({
    where: { recipeId, ingredientRefId: { in: [...ingredientRefIds] } },
    select: { ingredientRef: { select: { name: true } } },
  });
  return existing?.ingredientRef.name ?? null;
}

export type RecipeEditCover =
  | { kind: "upload"; coverId: string; imageUrl: string; createdById: string }
  | { kind: "clear" }
  | null;

/**
 * The edit page's save: the recipe's fields, the uploaded cover (created and made active)
 * or the cleared cover, and the touch of every cookbook holding the recipe. The guards
 * re-check that the recipe is still active and the new title still free.
 */
export async function saveRecipeEditOnD1(
  d1: D1ReadDatabase,
  input: {
    recipeId: string;
    chefId: string;
    fields: { title: string; description: string | null; servings: string | null };
    cover: RecipeEditCover;
  },
): Promise<void> {
  const now = new Date();
  const { recipeId, cover } = input;
  let coverFields: RecipeFields = {};
  if (cover?.kind === "upload") {
    coverFields = { activeCoverId: cover.coverId, activeCoverVariant: "image", coverMode: "manual" };
  } else if (cover?.kind === "clear") {
    coverFields = { activeCoverId: null, activeCoverVariant: null, coverMode: "none" };
  }
  await d1WriteBatch(d1, [
    recipeActiveGuard(recipeId),
    activeRecipeTitleFreeGuard(input.chefId, input.fields.title, recipeId),
    ...(cover?.kind === "upload"
      ? [coverInsertStatement({
        id: cover.coverId,
        recipeId,
        imageUrl: cover.imageUrl,
        sourceType: "chef-upload",
        status: "ready",
        createdById: cover.createdById,
        sourceImageUrl: cover.imageUrl,
        generationStatus: "none",
      }, now)]
      : []),
    recipeUpdateStatement(recipeId, { ...input.fields, ...coverFields }, now),
    cookbooksForRecipeTouchStatement(recipeId, now),
  ]);
}

/** Swaps a step with its neighbour through a temporary step number, then touches the recipe. */
export async function swapRecipeStepsOnD1(
  d1: D1ReadDatabase,
  input: { recipeId: string; stepId: string; stepNum: number; targetStepId: string; targetStepNum: number },
): Promise<void> {
  const now = new Date();
  await d1WriteBatch(d1, [
    stepAtGuard(input.stepId, input.recipeId, input.stepNum),
    stepAtGuard(input.targetStepId, input.recipeId, input.targetStepNum),
    stepNumUpdateStatement(input.stepId, -1, now),
    stepNumUpdateStatement(input.targetStepId, input.stepNum, now),
    stepNumUpdateStatement(input.stepId, input.targetStepNum, now),
    recipeUpdateStatement(input.recipeId, {}, now),
  ]);
}

/**
 * Deletes a step no other step uses (its ingredients and output uses cascade), then touches
 * the recipe. The guard re-checks that the step is still where it was and still unused.
 */
export async function deleteRecipeStepOnD1(
  d1: D1ReadDatabase,
  input: { recipeId: string; stepId: string; stepNum: number },
): Promise<void> {
  const now = new Date();
  await d1WriteBatch(d1, [
    stepAtGuard(input.stepId, input.recipeId, input.stepNum),
    d1Guard(
      `NOT EXISTS (SELECT 1 FROM "StepOutputUse" WHERE "recipeId" = ? AND "outputStepNum" = ?)`,
      input.recipeId,
      input.stepNum,
    ),
    stepDeleteStatement(input.stepId),
    recipeUpdateStatement(input.recipeId, {}, now),
  ]);
}

/**
 * Adds ingredients to a step, all or none, then touches the recipe. The guards re-check that
 * the step is still where it was and that none of the ingredients is in the recipe yet.
 */
export async function addStepIngredientsOnD1(
  d1: D1ReadDatabase,
  input: {
    recipeId: string;
    stepId: string;
    stepNum: number;
    rows: ReadonlyArray<{ quantity: number; unitId: string; ingredientRefId: string }>;
  },
): Promise<void> {
  const now = new Date();
  await d1WriteBatch(d1, [
    stepAtGuard(input.stepId, input.recipeId, input.stepNum),
    // The ids go in as one JSON array: D1 allows at most 100 bound values per statement.
    d1Guard(
      `NOT EXISTS (SELECT 1 FROM "Ingredient"
         WHERE "recipeId" = ? AND "ingredientRefId" IN (SELECT "value" FROM json_each(?)))`,
      input.recipeId,
      JSON.stringify(input.rows.map((row) => row.ingredientRefId)),
    ),
    ...input.rows.map((row) => ingredientInsertStatement({
      recipeId: input.recipeId,
      stepNum: input.stepNum,
      ...row,
      now,
    })),
    recipeUpdateStatement(input.recipeId, {}, now),
  ]);
}

/**
 * The step page's save: the step's title and description, and its step output uses replaced
 * by `usesSteps`, then the recipe touch. The guards re-check that the step is still where it
 * was and, when it will use no other step's output, that it still has an ingredient.
 */
export async function updateRecipeStepOnD1(
  d1: D1ReadDatabase,
  input: {
    recipeId: string;
    stepId: string;
    stepNum: number;
    stepTitle: string | null;
    description: string;
    usesSteps: readonly number[];
  },
): Promise<void> {
  const now = new Date();
  await d1WriteBatch(d1, [
    stepAtGuard(input.stepId, input.recipeId, input.stepNum),
    ...(input.usesSteps.length === 0
      ? [d1Guard(`EXISTS (SELECT 1 FROM "Ingredient" WHERE "recipeId" = ? AND "stepNum" = ?)`, input.recipeId, input.stepNum)]
      : []),
    [
      `UPDATE "RecipeStep" SET "stepTitle" = ?, "description" = ?, "updatedAt" = ? WHERE "id" = ?`,
      input.stepTitle,
      input.description,
      d1Timestamp(now),
      input.stepId,
    ],
    stepOutputUsesDeleteStatement(input.recipeId, input.stepNum),
    ...[...new Set(input.usesSteps)].map((outputStepNum) =>
      stepOutputUseInsertStatement(input.recipeId, input.stepNum, outputStepNum, now)),
    recipeUpdateStatement(input.recipeId, {}, now),
  ]);
}

/**
 * Deletes one of the step's ingredients and, only if it was there, touches the recipe.
 * Returns whether an ingredient was deleted. The touch runs first, conditioned on the
 * ingredient, so both land together or neither does.
 */
export async function deleteStepIngredientOnD1(
  d1: D1ReadDatabase,
  input: { recipeId: string; stepNum: number; ingredientId: string },
): Promise<boolean> {
  const now = new Date();
  const ingredient = `"id" = ? AND "recipeId" = ? AND "stepNum" = ?`;
  const [, deletion] = await d1WriteBatch(d1, [
    [
      `UPDATE "Recipe" SET "updatedAt" = ? WHERE "id" = ? AND EXISTS (SELECT 1 FROM "Ingredient" WHERE ${ingredient})`,
      d1Timestamp(now),
      input.recipeId,
      input.ingredientId,
      input.recipeId,
      input.stepNum,
    ],
    [`DELETE FROM "Ingredient" WHERE ${ingredient}`, input.ingredientId, input.recipeId, input.stepNum],
  ]);
  return deletion!.changes > 0;
}
