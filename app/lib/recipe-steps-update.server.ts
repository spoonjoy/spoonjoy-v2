import type { PrismaClient } from "@prisma/client";
import type { D1Query } from "~/lib/d1-read.server";
import { d1Guard, d1Timestamp } from "~/lib/d1-write.server";
import {
  nameUpsertStatements,
  namedIngredientInsertStatement,
  stepInsertStatement,
  stepOutputUseInsertStatement,
} from "~/lib/recipe-d1-writes.server";

// Updating a recipe's steps in place, for the agent and API `update_recipe` operation. It used to
// delete every step, ingredient and step output use and insert them again, so each edit changed
// every step and ingredient id (which cook progress is keyed by) and dropped every "uses the
// output of step N" link, which the operation cannot express. Now each submitted step is matched
// to a step the recipe has, by `id` when given and otherwise by position, and only what changed is
// written: matched steps keep their id, ingredients keep their id when their name is still in the
// same matched step, and output links follow their steps through a reorder.

export interface StepUpdateIngredient {
  /** Normalized (trimmed, lower-case) ingredient name. */
  name: string;
  quantity: number;
  /** Normalized unit name. */
  unit: string;
}

export interface StepUpdate {
  /** The id of the recipe step this one updates; when absent, the step at the same position. */
  id?: string;
  title?: string | null;
  description: string;
  duration?: number | null;
  ingredients: readonly StepUpdateIngredient[];
  /**
   * The step numbers, in the submitted order, whose output this step uses. When absent, a
   * matched step keeps its links (renumbered with their steps) and a new step has none.
   */
  outputStepNums?: readonly number[];
}

export interface CurrentRecipeSteps {
  steps: ReadonlyArray<{ id: string; stepNum: number }>;
  ingredients: ReadonlyArray<{ id: string; stepNum: number; name: string }>;
  outputUses: ReadonlyArray<{ outputStepNum: number; inputStepNum: number }>;
}

/** A submitted step list that cannot be applied; the message names the field to fix. */
export class StepUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepUpdateError";
  }
}

export interface StepUpdatePlan {
  /**
   * Re-checks, inside the batch, that the recipe's steps and ingredients are still the ones the
   * plan was made from. Only for a D1 batch (a guard is a SELECT).
   */
  guard: D1Query;
  /** The writes, in order. They leave the recipe's steps numbered 1..n. */
  statements: D1Query[];
}

/** Reads what the plan needs about a recipe's current steps. */
export async function loadCurrentRecipeSteps(db: PrismaClient, recipeId: string): Promise<CurrentRecipeSteps> {
  const [steps, ingredients, outputUses] = await Promise.all([
    db.recipeStep.findMany({ where: { recipeId }, select: { id: true, stepNum: true }, orderBy: { stepNum: "asc" } }),
    db.ingredient.findMany({
      where: { recipeId },
      select: { id: true, stepNum: true, ingredientRef: { select: { name: true } } },
      orderBy: [{ stepNum: "asc" }, { id: "asc" }],
    }),
    db.stepOutputUse.findMany({ where: { recipeId }, select: { outputStepNum: true, inputStepNum: true } }),
  ]);
  return {
    steps,
    ingredients: ingredients.map((ingredient) => ({
      id: ingredient.id,
      stepNum: ingredient.stepNum,
      name: ingredient.ingredientRef.name,
    })),
    outputUses,
  };
}

function fingerprintGuard(recipeId: string, current: CurrentRecipeSteps): D1Query {
  const steps = [...current.steps]
    .sort((left, right) => left.stepNum - right.stepNum)
    .map((step) => `${step.id}:${step.stepNum}`)
    .join(",");
  const ingredients = [...current.ingredients]
    .map((ingredient) => ingredient.id)
    .sort()
    .join(",");
  return d1Guard(
    `COALESCE((SELECT group_concat("value", ',') FROM (
        SELECT "id" || ':' || "stepNum" AS "value" FROM "RecipeStep" WHERE "recipeId" = ? ORDER BY "stepNum")), '') = ?
     AND COALESCE((SELECT group_concat("id", ',') FROM (
        SELECT "id" FROM "Ingredient" WHERE "recipeId" = ? ORDER BY "id")), '') = ?`,
    recipeId,
    steps,
    recipeId,
    ingredients,
  );
}

/**
 * Plans the in-place update of a recipe's steps to `updates`, numbered from 1. Throws
 * StepUpdateError when a step id is not one of the recipe's steps or is given twice, when an
 * ingredient appears in more than one step (a recipe lists each ingredient once), or when a step
 * would use the output of a step that does not come before it.
 */
export function planRecipeStepsUpdate(
  recipeId: string,
  current: CurrentRecipeSteps,
  updates: readonly StepUpdate[],
  now: Date,
): StepUpdatePlan {
  const currentById = new Map(current.steps.map((step) => [step.id, step]));
  const currentByNum = new Map(current.steps.map((step) => [step.stepNum, step]));

  const explicit = new Set<string>();
  for (const [index, update] of updates.entries()) {
    if (update.id === undefined) continue;
    if (!currentById.has(update.id)) throw new StepUpdateError(`steps[${index}].id is not a step of this recipe`);
    if (explicit.has(update.id)) throw new StepUpdateError(`steps[${index}].id is given for more than one step`);
    explicit.add(update.id);
  }

  const seenNames = new Map<string, number>();
  for (const [index, update] of updates.entries()) {
    for (const ingredient of update.ingredients) {
      const first = seenNames.get(ingredient.name);
      if (first !== undefined) {
        throw new StepUpdateError(
          first === index
            ? `steps[${index}] lists ${ingredient.name} more than once`
            : `${ingredient.name} is in steps[${first}] and steps[${index}]; a recipe lists each ingredient once`,
        );
      }
      seenNames.set(ingredient.name, index);
    }
  }

  // Match each submitted step to a current step: its id, or else the step at its position that
  // no submitted step names. Ids are distinct and positions are distinct, so no current step is
  // matched twice.
  const matched = updates.map((update, index) => {
    if (update.id !== undefined) return currentById.get(update.id)!;
    const atPosition = currentByNum.get(index + 1);
    return atPosition && !explicit.has(atPosition.id) ? atPosition : undefined;
  });
  const claimed = new Set(matched.flatMap((step) => (step ? [step.id] : [])));
  const newNumByOldNum = new Map<number, number>();
  for (const [index, step] of matched.entries()) {
    if (step) newNumByOldNum.set(step.stepNum, index + 1);
  }
  const removed = current.steps.filter((step) => !claimed.has(step.id));

  // The output links after the update.
  const outputUses: Array<{ outputStepNum: number; inputStepNum: number }> = [];
  for (const [index, update] of updates.entries()) {
    const inputStepNum = index + 1;
    let outputs: number[];
    if (update.outputStepNums !== undefined) {
      outputs = [...new Set(update.outputStepNums)];
      for (const outputStepNum of outputs) {
        if (!Number.isInteger(outputStepNum) || outputStepNum < 1 || outputStepNum >= inputStepNum) {
          throw new StepUpdateError(`steps[${index}].outputStepNums may only name earlier steps (1 to ${inputStepNum - 1})`);
        }
      }
    } else {
      const step = matched[index];
      outputs = step
        ? current.outputUses
          .filter((use) => use.inputStepNum === step.stepNum && newNumByOldNum.has(use.outputStepNum))
          .map((use) => newNumByOldNum.get(use.outputStepNum)!)
        : [];
      for (const outputStepNum of outputs) {
        if (outputStepNum >= inputStepNum) {
          throw new StepUpdateError(
            `steps[${index}] uses the output of a step that would now come after it; give its outputStepNums`,
          );
        }
      }
    }
    for (const outputStepNum of outputs.sort((left, right) => left - right)) {
      outputUses.push({ outputStepNum, inputStepNum });
    }
  }

  // Ingredients: one already in the matched step under the same name keeps its row (and id).
  const keptIngredient = new Map<string, string>();
  const ingredientDeletes: string[] = [];
  for (const ingredient of current.ingredients) {
    const newStepNum = newNumByOldNum.get(ingredient.stepNum);
    if (newStepNum === undefined) continue; // Its step is removed, and the ingredient with it.
    const update = updates[newStepNum - 1]!;
    const key = `${newStepNum}\u0000${ingredient.name}`;
    if (update.ingredients.some((wanted) => wanted.name === ingredient.name) && !keptIngredient.has(key)) {
      keptIngredient.set(key, ingredient.id);
    } else {
      ingredientDeletes.push(ingredient.id);
    }
  }

  const stamp = d1Timestamp(now);
  const allIngredients = updates.flatMap((update, index) => update.ingredients.map((ingredient) => ({
    stepNum: index + 1,
    ...ingredient,
  })));
  const kept = matched.flatMap((step, index) => (step ? [{ step, stepNum: index + 1, update: updates[index]! }] : []));

  const statements: D1Query[] = [
    ...nameUpsertStatements(
      allIngredients.map((ingredient) => ({ unitName: ingredient.unit, ingredientName: ingredient.name })),
      now,
    ),
    // The links are rebuilt from `outputUses` at the end.
    [`DELETE FROM "StepOutputUse" WHERE "recipeId" = ?`, recipeId],
    ...(removed.length > 0
      ? [[
        `DELETE FROM "RecipeStep" WHERE "recipeId" = ? AND "id" IN (SELECT "value" FROM json_each(?))`,
        recipeId,
        JSON.stringify(removed.map((step) => step.id)),
      ] as D1Query]
      : []),
    ...(ingredientDeletes.length > 0
      ? [[
        `DELETE FROM "Ingredient" WHERE "recipeId" = ? AND "id" IN (SELECT "value" FROM json_each(?))`,
        recipeId,
        JSON.stringify(ingredientDeletes),
      ] as D1Query]
      : []),
    // Renumber through negative step numbers so no two steps share a number on the way; the
    // ingredients follow their step (ON UPDATE CASCADE).
    ...kept
      .filter(({ step, stepNum }) => step.stepNum !== stepNum)
      .map(({ step, stepNum }): D1Query => [`UPDATE "RecipeStep" SET "stepNum" = ? WHERE "id" = ?`, -stepNum, step.id]),
    ...kept.map(({ step, stepNum, update }): D1Query => [
      `UPDATE "RecipeStep" SET "stepNum" = ?, "stepTitle" = ?, "description" = ?, "duration" = ?, "updatedAt" = ? WHERE "id" = ?`,
      stepNum,
      update.title ?? null,
      update.description,
      update.duration ?? null,
      stamp,
      step.id,
    ]),
    ...updates.flatMap((update, index) => matched[index]
      ? []
      : [stepInsertStatement({
        recipeId,
        stepNum: index + 1,
        stepTitle: update.title ?? null,
        description: update.description,
        duration: update.duration ?? null,
        now,
      })]),
    ...allIngredients.map((ingredient): D1Query => {
      const keptId = keptIngredient.get(`${ingredient.stepNum}\u0000${ingredient.name}`);
      return keptId
        ? [
          `UPDATE "Ingredient" SET "quantity" = ?, "unitId" = (SELECT "id" FROM "Unit" WHERE "name" = ?), "updatedAt" = ?
           WHERE "id" = ?`,
          ingredient.quantity,
          ingredient.unit,
          stamp,
          keptId,
        ]
        : namedIngredientInsertStatement({
          recipeId,
          stepNum: ingredient.stepNum,
          quantity: ingredient.quantity,
          unitName: ingredient.unit,
          ingredientName: ingredient.name,
          now,
        });
    }),
    ...outputUses.map((use) => stepOutputUseInsertStatement(recipeId, use.inputStepNum, use.outputStepNum, now)),
  ];

  return { guard: fingerprintGuard(recipeId, current), statements };
}

/**
 * Runs a plan's statements through Prisma, for when there is no D1 binding (unit tests,
 * scripts). Prisma's array transaction is atomic on SQLite but not on D1, which is why the D1
 * path sends the plan as one batch instead.
 */
export async function applyRecipeStepsUpdateWithPrisma(db: PrismaClient, plan: StepUpdatePlan): Promise<void> {
  await db.$transaction(plan.statements.map(([sql, ...values]) => db.$executeRawUnsafe(sql, ...values)));
}
