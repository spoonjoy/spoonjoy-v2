import type { Prisma, PrismaClient as PrismaClientType } from "@prisma/client";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { d1WriteBatch, isD1GuardFailure } from "~/lib/d1-write.server";
import type { ParsedIngredient } from "~/lib/ingredient-parse.server";
import { coverInsertStatement, createCover, setActiveRecipeCover, type CreateCoverInput } from "~/lib/recipe-cover.server";
import type { D1Query } from "~/lib/d1-read.server";
import {
  activeRecipeTitleFreeGuard,
  recipeUpdateStatement,
  nameUpsertStatements,
  namedIngredientInsertStatement,
  recipeInsertStatement,
  stepInsertStatement,
  stepOutputUseInsertStatement,
} from "~/lib/recipe-d1-writes.server";
import { ActiveRecipeTitleConflictError } from "~/lib/recipe-title-uniqueness.server";
import {
  validateIngredientName,
  validateQuantity,
  validateStepDescription,
  validateStepTitle,
  validateUnitName,
} from "~/lib/validation";

type TransactionClient = Prisma.TransactionClient;
type Database = PrismaClientType | TransactionClient;

export interface RecipeStepDraft {
  stepTitle: string | null;
  description: string;
  duration: number | null;
  ingredients: ParsedIngredient[];
  /**
   * Earlier steps (by step number) whose output this step uses. Callers validate that each
   * points at an earlier step of the same draft; the writes create one StepOutputUse each.
   */
  outputStepNums?: number[];
}

export type RecipeStepsValidationResult =
  | { valid: true; steps: RecipeStepDraft[] }
  | { valid: false; error: string };

type ValueValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; error: string };

export interface CreateRecipeDraftInput {
  id: string;
  title: string;
  description: string | null;
  servings: string | null;
  chefId: string;
  steps: RecipeStepDraft[];
  /**
   * A cover to create with the recipe; `activeVariant` also makes it the active cover, as
   * `setActiveRecipeCover` does. On D1 it is part of the recipe's batch.
   */
  cover?: Omit<CreateCoverInput, "recipeId"> & { id: string; activeVariant?: "image" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function label(stepIndex: number, message: string, ingredientIndex?: number): string {
  const stepLabel = `Step ${stepIndex + 1}`;
  if (ingredientIndex === undefined) return `${stepLabel}: ${message}`;
  return `${stepLabel}, ingredient ${ingredientIndex + 1}: ${message}`;
}

function normalizeText(value: string): string {
  return value.trim();
}

function parseOptionalStepTitle(value: unknown, stepIndex: number): ValueValidationResult<string | null> {
  if (value == null) {
    return { valid: true, value: null };
  }

  if (value === "") {
    return { valid: true, value: null };
  }

  if (typeof value !== "string") {
    return { valid: false, error: label(stepIndex, "Step title must be text") };
  }

  const result = validateStepTitle(value);
  if (!result.valid) {
    return { valid: false, error: label(stepIndex, result.error) };
  }

  return { valid: true, value: normalizeText(value) || null };
}

function parseDuration(value: unknown, stepIndex: number): ValueValidationResult<number | null> {
  if (value == null) {
    return { valid: true, value: null };
  }

  if (value === "") {
    return { valid: true, value: null };
  }

  const duration = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(duration) || duration <= 0) {
    return { valid: false, error: label(stepIndex, "Duration must be a positive whole number") };
  }

  return { valid: true, value: duration };
}

function parseQuantity(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return NaN;
}

function validateIngredient(
  value: unknown,
  stepIndex: number,
  ingredientIndex: number
): ValueValidationResult<ParsedIngredient> {
  if (!isRecord(value)) {
    return { valid: false, error: label(stepIndex, "Ingredient must be an object", ingredientIndex) };
  }

  const quantity = parseQuantity(value.quantity);
  const quantityResult = validateQuantity(quantity);
  if (!quantityResult.valid) {
    return { valid: false, error: label(stepIndex, quantityResult.error, ingredientIndex) };
  }

  const unit = typeof value.unit === "string" ? value.unit : "";
  const unitResult = validateUnitName(unit);
  if (!unitResult.valid) {
    return { valid: false, error: label(stepIndex, unitResult.error, ingredientIndex) };
  }

  const ingredientName = typeof value.ingredientName === "string" ? value.ingredientName : "";
  const ingredientNameResult = validateIngredientName(ingredientName);
  if (!ingredientNameResult.valid) {
    return { valid: false, error: label(stepIndex, ingredientNameResult.error, ingredientIndex) };
  }

  return {
    valid: true,
    value: {
      quantity,
      unit: normalizeText(unit),
      ingredientName: normalizeText(ingredientName),
    },
  };
}

function validateIngredients(value: unknown, stepIndex: number): ValueValidationResult<ParsedIngredient[]> {
  if (value == null) {
    return { valid: true, value: [] };
  }

  if (!Array.isArray(value)) {
    return { valid: false, error: label(stepIndex, "Ingredients must be an array") };
  }

  const ingredients: ParsedIngredient[] = [];
  for (const [ingredientIndex, ingredient] of value.entries()) {
    const result = validateIngredient(ingredient, stepIndex, ingredientIndex);
    if (!result.valid) return result;
    ingredients.push(result.value);
  }

  return { valid: true, value: ingredients };
}

function validateStep(value: unknown, stepIndex: number): ValueValidationResult<RecipeStepDraft> {
  if (!isRecord(value)) {
    return { valid: false, error: label(stepIndex, "Step must be an object") };
  }

  const stepTitleResult = parseOptionalStepTitle(value.stepTitle, stepIndex);
  if (!stepTitleResult.valid) return stepTitleResult;

  const description = typeof value.description === "string" ? value.description : "";
  const descriptionResult = validateStepDescription(description);
  if (!descriptionResult.valid) {
    return { valid: false, error: label(stepIndex, descriptionResult.error) };
  }

  const durationResult = parseDuration(value.duration, stepIndex);
  if (!durationResult.valid) return durationResult;

  const ingredientsResult = validateIngredients(value.ingredients, stepIndex);
  if (!ingredientsResult.valid) return ingredientsResult;

  return {
    valid: true,
    value: {
      stepTitle: stepTitleResult.value,
      description: normalizeText(description),
      duration: durationResult.value,
      ingredients: ingredientsResult.value,
    },
  };
}

export function parseRecipeStepsJson(stepsJson: string): RecipeStepsValidationResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(stepsJson);
  } catch {
    return { valid: false, error: "Recipe steps must be valid JSON" };
  }

  if (!Array.isArray(parsed)) {
    return { valid: false, error: "Recipe steps must be an array" };
  }

  const steps: RecipeStepDraft[] = [];
  for (const [stepIndex, step] of parsed.entries()) {
    const result = validateStep(step, stepIndex);
    if (!result.valid) return result;
    steps.push(result.value);
  }

  return { valid: true, steps };
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

async function getOrCreateUnit(db: Database, name: string) {
  const normalized = normalizeName(name);
  return db.unit.upsert({
    where: { name: normalized },
    update: {},
    create: { name: normalized },
  });
}

async function getOrCreateIngredientRef(db: Database, name: string) {
  const normalized = normalizeName(name);
  return db.ingredientRef.upsert({
    where: { name: normalized },
    update: {},
    create: { name: normalized },
  });
}

/** Each step's output uses as (input, output) step-number pairs, without repeats. */
function stepOutputUses(steps: RecipeStepDraft[]): { inputStepNum: number; outputStepNum: number }[] {
  return steps.flatMap((step, stepIndex) =>
    [...new Set(step.outputStepNums ?? [])].map((outputStepNum) => ({ inputStepNum: stepIndex + 1, outputStepNum })),
  );
}

/**
 * The recipe graph (recipe, steps, units, ingredient refs, ingredients, step output uses, and a
 * cover if one is given) as one atomic D1 batch, so a failure part way leaves no partial recipe. The batch also re-checks, as it
 * writes, that the chef has no active recipe with this title.
 */
function coverStatements(input: CreateRecipeDraftInput, now: Date): D1Query[] {
  if (!input.cover) return [];
  const { activeVariant, ...cover } = input.cover;
  return [
    coverInsertStatement({ ...cover, recipeId: input.id }, now),
    ...(activeVariant
      ? [recipeUpdateStatement(input.id, { activeCoverId: cover.id, activeCoverVariant: activeVariant, coverMode: "manual" }, now)]
      : []),
  ];
}

async function createRecipeDraftOnD1(d1: D1ReadDatabase, input: CreateRecipeDraftInput): Promise<{ id: string }> {
  const now = new Date();
  const ingredients = input.steps.flatMap((step, stepIndex) =>
    step.ingredients.map((ingredient) => ({
      recipeId: input.id,
      stepNum: stepIndex + 1,
      quantity: ingredient.quantity,
      unitName: normalizeName(ingredient.unit),
      ingredientName: normalizeName(ingredient.ingredientName),
      now,
    })),
  );
  try {
    await d1WriteBatch(d1, [
      activeRecipeTitleFreeGuard(input.chefId, input.title),
      recipeInsertStatement({ ...input, now }),
      ...input.steps.map((step, stepIndex) => stepInsertStatement({
        recipeId: input.id,
        stepNum: stepIndex + 1,
        stepTitle: step.stepTitle,
        description: step.description,
        duration: step.duration,
        now,
      })),
      ...nameUpsertStatements(ingredients, now),
      ...ingredients.map(namedIngredientInsertStatement),
      ...stepOutputUses(input.steps).map((use) =>
        stepOutputUseInsertStatement(input.id, use.inputStepNum, use.outputStepNum, now)),
      ...coverStatements(input, now),
    ]);
  } catch (error) {
    // The batch's only guard is the title check.
    if (isD1GuardFailure(error)) throw new ActiveRecipeTitleConflictError();
    throw error;
  }
  return { id: input.id };
}

/**
 * Creates the recipe with its steps and ingredients. With a D1 binding it is one atomic
 * batch; without one (unit tests, scripts) it runs through Prisma.
 */
export async function createRecipeDraft(
  db: PrismaClientType,
  input: CreateRecipeDraftInput,
  d1: D1ReadDatabase | null = null,
): Promise<{ id: string }> {
  if (d1) return createRecipeDraftOnD1(d1, input);

  // Prisma (no D1 binding): the writes run in sequence against the top-level client.
  const recipe = await db.recipe.create({
    data: {
      id: input.id,
      title: input.title,
      description: input.description,
      servings: input.servings,
      chefId: input.chefId,
    },
  });

  for (const [stepIndex, step] of input.steps.entries()) {
    const stepNum = stepIndex + 1;
    await db.recipeStep.create({
      data: {
        recipeId: recipe.id,
        stepNum,
        stepTitle: step.stepTitle,
        description: step.description,
        duration: step.duration,
      },
    });

    for (const ingredient of step.ingredients) {
      const unit = await getOrCreateUnit(db, ingredient.unit);
      const ingredientRef = await getOrCreateIngredientRef(db, ingredient.ingredientName);
      await db.ingredient.create({
        data: {
          recipeId: recipe.id,
          stepNum,
          quantity: ingredient.quantity,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });
    }
  }

  for (const use of stepOutputUses(input.steps)) {
    await db.stepOutputUse.create({ data: { recipeId: recipe.id, ...use } });
  }

  if (input.cover) {
    const { activeVariant, ...cover } = input.cover;
    await createCover(db, { ...cover, recipeId: recipe.id });
    if (activeVariant) {
      await setActiveRecipeCover(db, { recipeId: recipe.id, coverId: cover.id, variant: activeVariant });
    }
  }

  return recipe;
}
