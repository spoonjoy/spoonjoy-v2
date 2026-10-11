import type { PrismaClient } from "@prisma/client";
import { d1EpochMsSql, d1ReadBatch, type D1Query, type D1ReadDatabase } from "~/lib/d1-read.server";
import { validateStepDeletion } from "~/lib/step-deletion-validation.server";
import { validateStepReorderComplete } from "~/lib/step-reorder-validation.server";
import { d1Guard, d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";
import { D1_WRITE_UNAVAILABLE_CODE, D1_WRITE_UNAVAILABLE_MESSAGE, d1UnavailableHeaders, isD1Unavailable, retryD1Write } from "~/lib/d1-write-retry.server";
import { data } from "react-router";
import { coverInsertStatement } from "~/lib/recipe-cover.server";
import {
  activeRecipeTitleFreeGuard,
  cookbooksForRecipeTouchStatement,
  ingredientNamesFreeGuard,
  namedIngredientInsertStatement,
  nameUpsertStatements,
  recipeActiveGuard,
  recipeUpdatedAtGuard,
  recipeUpdateStatement,
  stepAtGuard,
  stepDeleteStatement,
  stepNumUpdateStatement,
  stepOutputUseInsertStatement,
  stepInsertStatement,
  stepOutputUsesDeleteStatement,
  stepReorderDependencyFreeGuard,
  type RecipeFields,
} from "~/lib/recipe-d1-writes.server";

// The recipe editor's writes (recipe edit page and step edit page) as atomic D1 batches.
// Each batch starts with guards that re-check, as it writes, what the action read and
// validated first; if another request changed those rows in between, the batch fails and
// nothing in it applies. The Prisma versions stay in the routes for when there is no binding.
//
// Each batch runs again after a transient D1 error (retryD1Write). A batch that sets fixed values
// simply runs again. A batch whose guards its own commit would fail (a moved or deleted step, an
// added ingredient, a changed updatedAt) chooses its marks before the first try (ids, its time)
// and, after an ambiguous failure, reads them back: if the earlier try committed, that is the
// answer, and a retry stopped by its own commit is not mistaken for a race.

/** The time a batch wrote, as SQL comparable whatever format the column holds. */
function writtenAt(column: string): string {
  return `${d1EpochMsSql(column)} = ?`;
}

/** Whether `query` finds a row; for an `applied` check. */
async function found(d1: D1ReadDatabase, query: D1Query): Promise<true | null> {
  const [rows] = await d1ReadBatch(d1, [query]);
  return rows.length > 0 ? true : null;
}

/**
 * The editor pages' answer when the database was briefly unavailable and every try failed: a
 * retryable 503 that shows the message in `field` and keeps what the cook entered. Null for any
 * other error.
 */
export function recipeEditorUnavailable(error: unknown, field: string = "general") {
  if (!isD1Unavailable(error)) return null;
  return data(
    { errors: { [field]: D1_WRITE_UNAVAILABLE_MESSAGE }, errorCode: D1_WRITE_UNAVAILABLE_CODE, retryable: true as const },
    { status: 503, headers: d1UnavailableHeaders() },
  );
}

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
 * What the step-move checks answer now, for a swap whose batch was stopped because a step
 * moved or went away, or the moved step gained an output dependency, in between.
 */
export async function stepSwapRaceAnswer(
  db: PrismaClient,
  recipeId: string,
  stepId: string,
  direction: "up" | "down",
): Promise<{ error: string; status: number }> {
  const step = await db.recipeStep.findUnique({ where: { id: stepId }, select: { recipeId: true, stepNum: true } });
  if (!step || step.recipeId !== recipeId) return { error: RECIPE_CHANGED_MESSAGE, status: 409 };
  const targetStepNum = direction === "up" ? step.stepNum - 1 : step.stepNum + 1;
  const validation = await validateStepReorderComplete(db, recipeId, step.stepNum, targetStepNum);
  return validation.valid ? { error: RECIPE_CHANGED_MESSAGE, status: 409 } : { error: validation.error, status: 400 };
}

/**
 * For an ingredient add whose batch was stopped: the name of one of the ingredients another
 * request added to the recipe in between, or null when the step changed instead.
 */
export async function ingredientAlreadyInRecipe(
  db: PrismaClient,
  recipeId: string,
  ingredientNames: readonly string[],
): Promise<string | null> {
  const existing = await db.ingredient.findFirst({
    where: { recipeId, ingredientRef: { name: { in: [...ingredientNames] } } },
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
    /** When given, the save applies only if the recipe's updatedAt is still this. */
    expectedUpdatedAt?: Date;
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
  const statements: D1Query[] = [
    recipeActiveGuard(recipeId),
    activeRecipeTitleFreeGuard(input.chefId, input.fields.title, recipeId),
    ...(input.expectedUpdatedAt ? [recipeUpdatedAtGuard(recipeId, input.expectedUpdatedAt)] : []),
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
  ];
  // A retry after the earlier try committed fails its updatedAt guard (and an upload's cover id
  // is taken): the recipe at this save's time and title, with its cover, says it committed.
  await retryD1Write(
    {
      scope: "recipe.edit",
      applied: () => found(d1, [
        `SELECT 1 FROM "Recipe" WHERE "id" = ? AND "title" = ? AND ${writtenAt('"updatedAt"')}${
          cover?.kind === "upload" ? ` AND "activeCoverId" = ?` : ""}`,
        recipeId,
        input.fields.title,
        now.getTime(),
        ...(cover?.kind === "upload" ? [cover.coverId] : []),
      ]),
    },
    () => d1WriteBatch(d1, statements).then(() => true as const),
  );
}

/** Swaps a step with its neighbour through a temporary step number, then touches the recipe. */
export async function swapRecipeStepsOnD1(
  d1: D1ReadDatabase,
  input: { recipeId: string; stepId: string; stepNum: number; targetStepId: string; targetStepNum: number },
): Promise<void> {
  const now = new Date();
  // A swap is a flip: run again after it committed, its step guards stop it. Both steps at their
  // swapped numbers, at this swap's time, say the earlier try committed.
  await retryD1Write(
    {
      scope: "recipe.swap_steps",
      applied: async () => {
        const [rows] = await d1ReadBatch(d1, [[
          `SELECT "id" FROM "RecipeStep"
           WHERE "recipeId" = ? AND ${writtenAt('"updatedAt"')}
             AND (("id" = ? AND "stepNum" = ?) OR ("id" = ? AND "stepNum" = ?))`,
          input.recipeId,
          now.getTime(),
          input.stepId,
          input.targetStepNum,
          input.targetStepId,
          input.stepNum,
        ]]);
        return rows.length === 2 ? true : null;
      },
    },
    () => d1WriteBatch(d1, [
      stepAtGuard(input.stepId, input.recipeId, input.stepNum),
      stepAtGuard(input.targetStepId, input.recipeId, input.targetStepNum),
      stepReorderDependencyFreeGuard(input.recipeId, input.stepNum, input.targetStepNum),
      stepNumUpdateStatement(input.stepId, -1, now),
      stepNumUpdateStatement(input.targetStepId, input.stepNum, now),
      stepNumUpdateStatement(input.stepId, input.targetStepNum, now),
      recipeUpdateStatement(input.recipeId, {}, now),
    ]).then(() => true as const),
  );
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
  // Run again after it committed, its step guard stops it: the step gone and the recipe touched
  // at this delete's time say the earlier try committed.
  await retryD1Write(
    {
      scope: "recipe.delete_step",
      applied: () => found(d1, [
        `SELECT 1 FROM "Recipe" WHERE "id" = ? AND ${writtenAt('"updatedAt"')}
           AND NOT EXISTS (SELECT 1 FROM "RecipeStep" WHERE "id" = ?)`,
        input.recipeId,
        now.getTime(),
        input.stepId,
      ]),
    },
    () => d1WriteBatch(d1, [
      stepAtGuard(input.stepId, input.recipeId, input.stepNum),
      d1Guard(
        `NOT EXISTS (SELECT 1 FROM "StepOutputUse" WHERE "recipeId" = ? AND "outputStepNum" = ?)`,
        input.recipeId,
        input.stepNum,
      ),
      stepDeleteStatement(input.stepId),
      recipeUpdateStatement(input.recipeId, {}, now),
    ]).then(() => true as const),
  );
}

/**
 * The step page's ingredient add: the ingredients, with their units and ingredient names
 * created in the same batch when they are new, then the recipe touch. The guards re-check
 * that the step is still where it was and that none of the names is in the recipe yet, so a
 * stopped or failed batch leaves no new unit or ingredient name behind either.
 */
export async function addStepIngredientsOnD1(
  d1: D1ReadDatabase,
  input: {
    recipeId: string;
    stepId: string;
    stepNum: number;
    rows: ReadonlyArray<{ quantity: number; unitName: string; ingredientName: string }>;
  },
): Promise<void> {
  const now = new Date();
  // The ingredients' ids are chosen before the first try. Run again after it committed, the
  // names-free guard stops it: every one of those ids on the step says the earlier try committed.
  const named = input.rows.map((row) => ({
    ...row,
    id: crypto.randomUUID(),
    recipeId: input.recipeId,
    stepNum: input.stepNum,
    now,
  }));
  await retryD1Write(
    {
      scope: "recipe.add_step_ingredients",
      applied: async () => {
        const [rows] = await d1ReadBatch(d1, [[
          `SELECT "id" FROM "Ingredient" WHERE "recipeId" = ? AND "stepNum" = ? AND "id" IN (SELECT "value" FROM json_each(?))`,
          input.recipeId,
          input.stepNum,
          JSON.stringify(named.map((row) => row.id)),
        ]]);
        return rows.length === named.length ? true : null;
      },
    },
    () => d1WriteBatch(d1, [
      stepAtGuard(input.stepId, input.recipeId, input.stepNum),
      ingredientNamesFreeGuard(input.recipeId, input.rows.map((row) => row.ingredientName)),
      ...nameUpsertStatements(named, now),
      ...named.map(namedIngredientInsertStatement),
      recipeUpdateStatement(input.recipeId, {}, now),
    ]).then(() => true as const),
  );
}

/**
 * The new-step page's save: the step, its step output uses and its ingredients, with their
 * units and ingredient names created in the same batch when they are new, then the recipe
 * touch, all or none. The guards re-check that the recipe is still live, that `stepNum` is
 * still the next step number and that none of the ingredients is in the recipe yet; the
 * action validated all of that before writing anything.
 */
export async function createRecipeStepOnD1(
  d1: D1ReadDatabase,
  input: {
    recipeId: string;
    stepId: string;
    stepNum: number;
    stepTitle: string | null;
    description: string;
    usesSteps: readonly number[];
    rows: ReadonlyArray<{ quantity: number; unitName: string; ingredientName: string }>;
  },
): Promise<void> {
  const now = new Date();
  const named = input.rows.map((row) => ({ ...row, recipeId: input.recipeId, stepNum: input.stepNum, now }));
  await d1WriteBatch(d1, [
    recipeActiveGuard(input.recipeId),
    d1Guard(
      `NOT EXISTS (SELECT 1 FROM "RecipeStep" WHERE "recipeId" = ? AND "stepNum" >= ?)`,
      input.recipeId,
      input.stepNum,
    ),
    ingredientNamesFreeGuard(input.recipeId, input.rows.map((row) => row.ingredientName)),
    stepInsertStatement({
      id: input.stepId,
      recipeId: input.recipeId,
      stepNum: input.stepNum,
      stepTitle: input.stepTitle,
      description: input.description,
      duration: null,
      now,
    }),
    ...[...new Set(input.usesSteps)].map((outputStepNum) =>
      stepOutputUseInsertStatement(input.recipeId, input.stepNum, outputStepNum, now)),
    ...nameUpsertStatements(named, now),
    ...named.map(namedIngredientInsertStatement),
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
  // Sets fixed values and replaces the output uses: run again after it committed, its guards still
  // pass and it leaves the same rows.
  await retryD1Write({ scope: "recipe.update_step" }, () => d1WriteBatch(d1, [
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
  ]));
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
  // Run again after it committed, the delete finds nothing. The recipe touched at this delete's
  // time (the touch runs only when the ingredient was there) says an earlier try deleted it. Only
  // a later try may read it that way: the first try's own touch sets the same time.
  let tries = 0;
  return retryD1Write({ scope: "recipe.delete_step_ingredient" }, async () => {
    tries += 1;
    const [, deletion, touched] = await d1WriteBatch(d1, [
      [
        `UPDATE "Recipe" SET "updatedAt" = ? WHERE "id" = ? AND EXISTS (SELECT 1 FROM "Ingredient" WHERE ${ingredient})`,
        d1Timestamp(now),
        input.recipeId,
        input.ingredientId,
        input.recipeId,
        input.stepNum,
      ],
      [`DELETE FROM "Ingredient" WHERE ${ingredient}`, input.ingredientId, input.recipeId, input.stepNum],
      [`SELECT 1 FROM "Recipe" WHERE "id" = ? AND ${writtenAt('"updatedAt"')}`, input.recipeId, now.getTime()],
    ]);
    return deletion!.changes > 0 || (tries > 1 && touched!.rows.length > 0);
  });
}
