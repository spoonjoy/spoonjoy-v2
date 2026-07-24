import type { Prisma, PrismaClient as PrismaClientType, Recipe } from "@prisma/client";
import type { ParsedIngredient } from "~/lib/ingredient-parse.server";
import {
  asCompatibleRecipeTagD1Database,
  normalizeRecipeCourse,
  normalizeRecipeTags,
  type CompatibleRecipeTagD1Database,
  type RecipeCourse,
} from "~/lib/recipe-tags.server";
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
  course?: RecipeCourse | null;
  tags?: unknown;
  steps: RecipeStepDraft[];
}

export interface CreateRecipeDraftOptions {
  nativeDatabase?: CompatibleRecipeTagD1Database | null;
  now?: () => Date;
  randomId?: () => string;
}

interface CreationTag {
  id: string;
  label: string;
  normalizedLabel: string;
}

const INSERT_RECIPE_SQL = `
  INSERT INTO "Recipe" ("id", "title", "description", "servings", "chefId", "course", "createdAt", "updatedAt")
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING "id", "title", "description", "servings", "chefId", "course", "createdAt", "updatedAt"
`;

const INSERT_RECIPE_TAG_SQL = `
  INSERT INTO "RecipeTag" ("id", "recipeId", "label", "normalizedLabel", "createdAt", "updatedAt")
  VALUES (?, ?, ?, ?, ?, ?)
  RETURNING
    "recipeId", "id" AS "tagId", "label", "normalizedLabel", "createdAt", "updatedAt"
`;

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

function resultRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid recipe creation result");
  }
  return value as Record<string, unknown>;
}

function resultRows(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid recipe creation result");
  return value;
}

function matchingTimestamp(value: unknown, expected: string): boolean {
  if (value === expected) return true;
  return value instanceof Date
    && Number.isFinite(value.getTime())
    && value.toISOString() === expected;
}

function validateCreationRecipeRow(
  value: unknown,
  input: CreateRecipeDraftInput,
  course: RecipeCourse | null,
  timestamp: string,
) {
  const row = resultRecord(value);
  if (
    row.id !== input.id
    || row.title !== input.title
    || row.description !== input.description
    || row.servings !== input.servings
    || row.chefId !== input.chefId
    || row.course !== course
    || !matchingTimestamp(row.createdAt, timestamp)
    || !matchingTimestamp(row.updatedAt, timestamp)
  ) {
    throw new Error("Invalid recipe creation row");
  }
}

function validateCreationTagRow(
  value: unknown,
  recipeId: string,
  tag: CreationTag,
  timestamp: string,
) {
  const row = resultRecord(value);
  if (
    row.recipeId !== recipeId
    || row.tagId !== tag.id
    || row.label !== tag.label
    || row.normalizedLabel !== tag.normalizedLabel
    || !matchingTimestamp(row.createdAt, timestamp)
    || !matchingTimestamp(row.updatedAt, timestamp)
  ) {
    throw new Error("Invalid recipe tag creation row");
  }
}

function validateLocalCreationResults(
  results: unknown,
  input: CreateRecipeDraftInput,
  course: RecipeCourse | null,
  tags: CreationTag[],
  timestamp: string,
) {
  if (!Array.isArray(results) || results.length !== tags.length + 1) {
    throw new Error("Invalid recipe creation result");
  }
  const recipeRows = resultRows(results[0]);
  if (recipeRows.length !== 1) throw new Error("Invalid recipe creation result");
  validateCreationRecipeRow(recipeRows[0], input, course, timestamp);

  tags.forEach((tag, index) => {
    const rows = resultRows(results[index + 1]);
    if (rows.length !== 1) throw new Error("Invalid recipe tag creation result");
    validateCreationTagRow(rows[0], input.id, tag, timestamp);
  });
}

function nativeCreationRows(value: unknown): unknown[] {
  const result = resultRecord(value);
  if (result.success !== true) throw new Error("Recipe creation batch statement failed");
  const meta = resultRecord(result.meta);
  if (meta.changes !== 1) throw new Error("Invalid recipe creation result");
  return resultRows(result.results);
}

function validateNativeCreationResults(
  results: unknown,
  input: CreateRecipeDraftInput,
  course: RecipeCourse | null,
  tags: CreationTag[],
  timestamp: string,
) {
  if (!Array.isArray(results) || results.length !== tags.length + 1) {
    throw new Error("Invalid recipe creation result");
  }
  const recipeRows = nativeCreationRows(results[0]);
  if (recipeRows.length !== 1) throw new Error("Invalid recipe creation result");
  validateCreationRecipeRow(recipeRows[0], input, course, timestamp);

  tags.forEach((tag, index) => {
    const rows = nativeCreationRows(results[index + 1]);
    if (rows.length !== 1) throw new Error("Invalid recipe tag creation result");
    validateCreationTagRow(rows[0], input.id, tag, timestamp);
  });
}

function creationRecipe(
  input: CreateRecipeDraftInput,
  course: RecipeCourse | null,
  timestamp: Date,
): Recipe {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    servings: input.servings,
    chefId: input.chefId,
    deletedAt: null,
    course,
    activeCoverId: null,
    activeCoverVariant: null,
    coverMode: "auto",
    sourceRecipeId: null,
    sourceUrl: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function createRecipeWithMetadata(
  db: PrismaClientType,
  input: CreateRecipeDraftInput,
  options: CreateRecipeDraftOptions,
): Promise<Recipe> {
  const course = normalizeRecipeCourse(input.course ?? null);
  const normalizedTags = normalizeRecipeTags(input.tags ?? []);
  const timestamp = (options.now?.() ?? new Date());
  const boundTimestamp = timestamp.toISOString();
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const tags = normalizedTags.map((tag) => ({ ...tag, id: randomId() }));
  const recipeValues = [
    input.id,
    input.title,
    input.description,
    input.servings,
    input.chefId,
    course,
    boundTimestamp,
    boundTimestamp,
  ];
  const tagValues = tags.map((tag) => [
    tag.id,
    input.id,
    tag.label,
    tag.normalizedLabel,
    boundTimestamp,
    boundTimestamp,
  ]);
  const nativeDatabase = asCompatibleRecipeTagD1Database(options.nativeDatabase);

  if (nativeDatabase) {
    const operations = [
      nativeDatabase.prepare(INSERT_RECIPE_SQL).bind(...recipeValues),
      ...tagValues.map((values) => nativeDatabase.prepare(INSERT_RECIPE_TAG_SQL).bind(...values)),
    ];
    const results = await nativeDatabase.batch(operations);
    validateNativeCreationResults(results, input, course, tags, boundTimestamp);
  } else {
    const operations = [
      db.$queryRawUnsafe(INSERT_RECIPE_SQL, ...recipeValues),
      ...tagValues.map((values) => db.$queryRawUnsafe(INSERT_RECIPE_TAG_SQL, ...values)),
    ];
    const results = await db.$transaction(operations);
    validateLocalCreationResults(results, input, course, tags, boundTimestamp);
  }

  return creationRecipe(input, course, timestamp);
}

export async function createRecipeDraft(
  db: PrismaClientType,
  input: CreateRecipeDraftInput,
  options: CreateRecipeDraftOptions = {},
): Promise<Recipe> {
  // Cloudflare D1 (used in both local dev and production) does not support
  // Prisma's interactive `$transaction(async (tx) => ...)` form. Mirror the
  // F1 forkRecipe pattern (see `recipe-fork.server.ts`) and persist the
  // recipe graph as a sequence of writes against the top-level client.
  //
  // Metadata-aware web creation atomically commits the initial Recipe and its
  // requested tags below. The remaining step graph still follows the legacy
  // sequential path, so a later step failure can leave that initial graph.
  const hasAuthoringMetadata = Object.prototype.hasOwnProperty.call(input, "course")
    || Object.prototype.hasOwnProperty.call(input, "tags");
  const recipe = hasAuthoringMetadata
    ? await createRecipeWithMetadata(db, input, options)
    : await db.recipe.create({
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

  return recipe;
}
