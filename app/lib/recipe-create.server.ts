import type { Prisma, PrismaClient as PrismaClientType, Recipe } from "@prisma/client";
import type { ParsedIngredient } from "~/lib/ingredient-parse.server";
import {
  buildRecipeAuthoringCoverOperations,
  type RecipeAuthoringCoverMutation,
  type RecipeAuthoringCoverOperation,
} from "~/lib/recipe-authoring-cover.server";
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
  sourceUrl?: string | null;
  chefId: string;
  course?: RecipeCourse | null;
  tags?: unknown;
  steps: RecipeStepDraft[];
}

export interface CreateRecipeDraftOptions {
  coverMutation?: RecipeAuthoringCoverMutation | null;
  nativeDatabase: CompatibleRecipeTagD1Database | null;
  now?: () => Date;
  randomId?: () => string;
}

export interface UpdateRecipeDraftInput {
  id: string;
  chefId: string;
  title?: string;
  description?: string | null;
  servings?: string | null;
  sourceUrl?: string | null;
  steps?: RecipeStepDraft[];
}

export type UpdateRecipeDraftOptions = CreateRecipeDraftOptions;

export class RecipeDraftNotFoundError extends Error {
  readonly recipeId: string;

  constructor(recipeId: string) {
    super("Recipe not found");
    this.name = "RecipeDraftNotFoundError";
    this.recipeId = recipeId;
  }
}

export const MAX_RECIPE_AUTHORING_OPERATIONS = 900;

export class RecipeGraphTooLargeError extends Error {
  readonly operationCount: number;

  constructor(operationCount: number) {
    super("Recipe contains too many steps or ingredients");
    this.name = "RecipeGraphTooLargeError";
    this.operationCount = operationCount;
  }
}

export type CommittedRecipeGraph = Prisma.RecipeGetPayload<{
  include: {
    chef: { select: { id: true; email: true; username: true } };
    covers: true;
    steps: {
      include: {
        ingredients: { include: { unit: true; ingredientRef: true } };
      };
    };
  };
}>;

interface CreationTag {
  id: string;
  label: string;
  normalizedLabel: string;
}

interface CreationStep extends RecipeStepDraft {
  id: string;
  stepNum: number;
}

interface CreationLookup {
  id: string;
  name: string;
}

interface CreationIngredient {
  id: string;
  stepNum: number;
  quantity: number;
  unitName: string;
  ingredientRefName: string;
}

type CreationOperation =
  | { kind: "recipe"; sql: string; values: unknown[] }
  | { kind: "tag"; sql: string; values: unknown[]; tag: CreationTag }
  | { kind: "step"; sql: string; values: unknown[]; step: CreationStep }
  | { kind: "unit"; sql: string; values: unknown[]; lookup: CreationLookup }
  | { kind: "ingredient-ref"; sql: string; values: unknown[]; lookup: CreationLookup }
  | { kind: "ingredient"; sql: string; values: unknown[]; ingredient: CreationIngredient }
  | RecipeAuthoringCoverOperation;

interface CreationPlan {
  course: RecipeCourse | null;
  timestamp: Date;
  boundTimestamp: string;
  operations: CreationOperation[];
}

const INSERT_RECIPE_SQL = `
  INSERT INTO "Recipe" (
    "id", "title", "description", "servings", "sourceUrl", "chefId", "course", "createdAt", "updatedAt"
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING
    "id", "title", "description", "servings", "sourceUrl", "chefId", "course", "createdAt", "updatedAt"
`;

const INSERT_RECIPE_TAG_SQL = `
  INSERT INTO "RecipeTag" ("id", "recipeId", "label", "normalizedLabel", "createdAt", "updatedAt")
  VALUES (?, ?, ?, ?, ?, ?)
  RETURNING
    "recipeId", "id" AS "tagId", "label", "normalizedLabel", "createdAt", "updatedAt"
`;

const INSERT_RECIPE_STEP_SQL = `
  INSERT INTO "RecipeStep" (
    "id", "recipeId", "stepNum", "stepTitle", "description", "duration", "updatedAt"
  )
  VALUES (?, ?, ?, ?, ?, ?, ?)
  RETURNING "id", "recipeId", "stepNum", "stepTitle", "description", "duration", "updatedAt"
`;

const UPSERT_UNIT_SQL = `
  INSERT INTO "Unit" ("id", "name", "updatedAt")
  VALUES (?, ?, ?)
  ON CONFLICT("name") DO UPDATE SET "name" = excluded."name"
  RETURNING "id", "name", "updatedAt"
`;

const UPSERT_INGREDIENT_REF_SQL = `
  INSERT INTO "IngredientRef" ("id", "name", "updatedAt")
  VALUES (?, ?, ?)
  ON CONFLICT("name") DO UPDATE SET "name" = excluded."name"
  RETURNING "id", "name", "updatedAt"
`;

const INSERT_INGREDIENT_SQL = `
  INSERT INTO "Ingredient" (
    "id", "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId", "updatedAt"
  )
  VALUES (
    ?, ?, ?, ?,
    (SELECT "id" FROM "Unit" WHERE "name" = ?),
    (SELECT "id" FROM "IngredientRef" WHERE "name" = ?),
    ?
  )
  RETURNING
    "id", "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId", "updatedAt"
`;

const DELETE_STEP_OUTPUT_USES_SQL = `
  DELETE FROM "StepOutputUse"
  WHERE "recipeId" = ? AND EXISTS (
    SELECT 1 FROM "Recipe"
    WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL
  )
  RETURNING "id"
`;

const DELETE_INGREDIENTS_SQL = `
  DELETE FROM "Ingredient"
  WHERE "recipeId" = ? AND EXISTS (
    SELECT 1 FROM "Recipe"
    WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL
  )
  RETURNING "id"
`;

const DELETE_RECIPE_STEPS_SQL = `
  DELETE FROM "RecipeStep"
  WHERE "recipeId" = ? AND EXISTS (
    SELECT 1 FROM "Recipe"
    WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL
  )
  RETURNING "id"
`;

const INSERT_GUARDED_RECIPE_STEP_SQL = `
  INSERT INTO "RecipeStep" (
    "id", "recipeId", "stepNum", "stepTitle", "description", "duration", "updatedAt"
  )
  SELECT ?, recipe."id", ?, ?, ?, ?, ?
  FROM "Recipe" AS recipe
  WHERE recipe."id" = ? AND recipe."chefId" = ? AND recipe."deletedAt" IS NULL
  RETURNING "id"
`;

const UPSERT_GUARDED_UNIT_SQL = `
  INSERT INTO "Unit" ("id", "name", "updatedAt")
  SELECT ?, ?, ? FROM "Recipe"
  WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL
  ON CONFLICT("name") DO UPDATE SET "name" = excluded."name"
  RETURNING "id"
`;

const UPSERT_GUARDED_INGREDIENT_REF_SQL = `
  INSERT INTO "IngredientRef" ("id", "name", "updatedAt")
  SELECT ?, ?, ? FROM "Recipe"
  WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL
  ON CONFLICT("name") DO UPDATE SET "name" = excluded."name"
  RETURNING "id"
`;

const INSERT_GUARDED_INGREDIENT_SQL = `
  INSERT INTO "Ingredient" (
    "id", "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId", "updatedAt"
  )
  SELECT ?, recipe."id", ?, ?, unit."id", ingredientRef."id", ?
  FROM "Recipe" AS recipe
  JOIN "Unit" AS unit ON unit."name" = ?
  JOIN "IngredientRef" AS ingredientRef ON ingredientRef."name" = ?
  WHERE recipe."id" = ? AND recipe."chefId" = ? AND recipe."deletedAt" IS NULL
  RETURNING "id"
`;

const READ_GUARDED_RECIPE_COOKBOOKS_SQL = `
  SELECT membership."cookbookId"
  FROM "RecipeInCookbook" AS membership
  WHERE membership."recipeId" = ? AND EXISTS (
    SELECT 1 FROM "Recipe"
    WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL
  )
`;

const UPDATE_GUARDED_RECIPE_COOKBOOKS_SQL = `
  UPDATE "Cookbook"
  SET "updatedAt" = ?
  WHERE "id" IN (
    SELECT membership."cookbookId" FROM "RecipeInCookbook" AS membership
    WHERE membership."recipeId" = ? AND EXISTS (
      SELECT 1 FROM "Recipe"
      WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL
    )
  )
  RETURNING "id"
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

function createLookupRows(names: string[], randomId: () => string): CreationLookup[] {
  return [...new Set(names)].map((name) => ({ id: randomId(), name }));
}

function buildCreationPlan(
  input: CreateRecipeDraftInput,
  options: CreateRecipeDraftOptions,
): CreationPlan {
  const course = normalizeRecipeCourse(input.course ?? null);
  const timestamp = options.now?.() ?? new Date();
  const boundTimestamp = timestamp.toISOString();
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const tags = normalizeRecipeTags(input.tags ?? []).map((tag) => ({ ...tag, id: randomId() }));
  const steps = input.steps.map<CreationStep>((step, index) => ({
    ...step,
    id: randomId(),
    stepNum: index + 1,
  }));
  const ingredientDrafts = steps.flatMap((step) => step.ingredients.map((ingredient) => ({
    stepNum: step.stepNum,
    quantity: ingredient.quantity,
    unitName: normalizeName(ingredient.unit),
    ingredientRefName: normalizeName(ingredient.ingredientName),
  })));
  const units = createLookupRows(ingredientDrafts.map(({ unitName }) => unitName), randomId);
  const ingredientRefs = createLookupRows(
    ingredientDrafts.map(({ ingredientRefName }) => ingredientRefName),
    randomId,
  );
  const ingredients = ingredientDrafts.map<CreationIngredient>((ingredient) => ({
    ...ingredient,
    id: randomId(),
  }));
  const recipeValues = [
    input.id,
    input.title,
    input.description,
    input.servings,
    input.sourceUrl ?? null,
    input.chefId,
    course,
    boundTimestamp,
    boundTimestamp,
  ];
  const operations: CreationOperation[] = [
    { kind: "recipe", sql: INSERT_RECIPE_SQL, values: recipeValues },
    ...tags.map<CreationOperation>((tag) => ({
      kind: "tag",
      sql: INSERT_RECIPE_TAG_SQL,
      tag,
      values: [
        tag.id,
        input.id,
        tag.label,
        tag.normalizedLabel,
        boundTimestamp,
        boundTimestamp,
      ],
    })),
    ...steps.map<CreationOperation>((step) => ({
      kind: "step",
      sql: INSERT_RECIPE_STEP_SQL,
      step,
      values: [
        step.id,
        input.id,
        step.stepNum,
        step.stepTitle,
        step.description,
        step.duration,
        boundTimestamp,
      ],
    })),
    ...units.map<CreationOperation>((lookup) => ({
      kind: "unit",
      sql: UPSERT_UNIT_SQL,
      lookup,
      values: [lookup.id, lookup.name, boundTimestamp],
    })),
    ...ingredientRefs.map<CreationOperation>((lookup) => ({
      kind: "ingredient-ref",
      sql: UPSERT_INGREDIENT_REF_SQL,
      lookup,
      values: [lookup.id, lookup.name, boundTimestamp],
    })),
    ...ingredients.map<CreationOperation>((ingredient) => ({
      kind: "ingredient",
      sql: INSERT_INGREDIENT_SQL,
      ingredient,
      values: [
        ingredient.id,
        input.id,
        ingredient.stepNum,
        ingredient.quantity,
        ingredient.unitName,
        ingredient.ingredientRefName,
        boundTimestamp,
      ],
    })),
    ...buildRecipeAuthoringCoverOperations({
      boundTimestamp,
      mutation: options.coverMutation ?? null,
      recipeId: input.id,
      userId: input.chefId,
    }),
  ];

  if (operations.length > MAX_RECIPE_AUTHORING_OPERATIONS) {
    throw new RecipeGraphTooLargeError(operations.length);
  }
  return { course, timestamp, boundTimestamp, operations };
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
    || row.sourceUrl !== (input.sourceUrl ?? null)
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

function validTimestamp(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function validateCreationStepRow(
  value: unknown,
  recipeId: string,
  step: CreationStep,
  timestamp: string,
) {
  const row = resultRecord(value);
  if (
    row.id !== step.id
    || row.recipeId !== recipeId
    || row.stepNum !== step.stepNum
    || row.stepTitle !== step.stepTitle
    || row.description !== step.description
    || row.duration !== step.duration
    || !matchingTimestamp(row.updatedAt, timestamp)
  ) {
    throw new Error("Invalid recipe step creation row");
  }
}

function validateCreationLookupRow(
  value: unknown,
  lookup: CreationLookup,
  lookupIds: Map<string, string>,
  entity: "unit" | "ingredient reference",
) {
  const row = resultRecord(value);
  if (
    typeof row.id !== "string"
    || row.id.length === 0
    || row.name !== lookup.name
    || !validTimestamp(row.updatedAt)
  ) {
    throw new Error(`Invalid recipe ${entity} creation row`);
  }
  lookupIds.set(lookup.name, row.id);
}

function validateCreationIngredientRow(
  value: unknown,
  input: CreateRecipeDraftInput,
  ingredient: CreationIngredient,
  timestamp: string,
  unitIds: Map<string, string>,
  ingredientRefIds: Map<string, string>,
) {
  const row = resultRecord(value);
  if (
    row.id !== ingredient.id
    || row.recipeId !== input.id
    || row.stepNum !== ingredient.stepNum
    || row.quantity !== ingredient.quantity
    || row.unitId !== unitIds.get(ingredient.unitName)
    || row.ingredientRefId !== ingredientRefIds.get(ingredient.ingredientRefName)
    || !matchingTimestamp(row.updatedAt, timestamp)
  ) {
    throw new Error("Invalid ingredient creation row");
  }
}

function validateCreationCoverRow(
  value: unknown,
  operation: RecipeAuthoringCoverOperation,
  input: CreateRecipeDraftInput,
  timestamp: string,
) {
  const row = resultRecord(value);
  if (operation.kind === "insert-cover") {
    if (
      row.id !== operation.values[0]
      || row.recipeId !== input.id
      || row.imageUrl !== operation.values[1]
      || row.sourceType !== operation.values[2]
      || row.status !== operation.values[3]
      || row.createdById !== operation.values[4]
      || row.sourceImageUrl !== operation.values[5]
      || row.generationStatus !== operation.values[6]
      || !matchingTimestamp(row.createdAt, timestamp)
    ) {
      throw new Error("Invalid recipe cover creation row");
    }
    return;
  }
  const expectedCoverId = operation.kind === "activate-cover" ? operation.values[0] : null;
  const expectedVariant = operation.kind === "activate-cover" ? "image" : null;
  const expectedMode = operation.kind === "activate-cover" ? "manual" : "none";
  if (
    row.recipeId !== input.id
    || row.activeCoverId !== expectedCoverId
    || row.activeCoverVariant !== expectedVariant
    || row.coverMode !== expectedMode
    || !matchingTimestamp(row.updatedAt, timestamp)
  ) {
    throw new Error("Invalid recipe cover activation row");
  }
}

function validateCreationOperationRow(
  value: unknown,
  operation: CreationOperation,
  input: CreateRecipeDraftInput,
  plan: CreationPlan,
  unitIds: Map<string, string>,
  ingredientRefIds: Map<string, string>,
) {
  switch (operation.kind) {
    case "recipe":
      validateCreationRecipeRow(value, input, plan.course, plan.boundTimestamp);
      break;
    case "tag":
      validateCreationTagRow(value, input.id, operation.tag, plan.boundTimestamp);
      break;
    case "step":
      validateCreationStepRow(value, input.id, operation.step, plan.boundTimestamp);
      break;
    case "unit":
      validateCreationLookupRow(value, operation.lookup, unitIds, "unit");
      break;
    case "ingredient-ref":
      validateCreationLookupRow(
        value,
        operation.lookup,
        ingredientRefIds,
        "ingredient reference",
      );
      break;
    case "ingredient":
      validateCreationIngredientRow(
        value,
        input,
        operation.ingredient,
        plan.boundTimestamp,
        unitIds,
        ingredientRefIds,
      );
      break;
    case "insert-cover":
    case "activate-cover":
    case "clear-cover":
      validateCreationCoverRow(value, operation, input, plan.boundTimestamp);
      break;
  }
}

function invalidCreationResultMessage(operation: CreationOperation): string {
  if (operation.kind === "tag") return "Invalid recipe tag creation result";
  if (operation.kind === "step") return "Invalid recipe step creation result";
  if (operation.kind === "unit") return "Invalid recipe unit creation result";
  if (operation.kind === "ingredient-ref") {
    return "Invalid recipe ingredient reference creation result";
  }
  if (operation.kind === "ingredient") return "Invalid ingredient creation result";
  if (operation.kind === "insert-cover") return "Invalid recipe cover creation result";
  if (operation.kind === "activate-cover" || operation.kind === "clear-cover") {
    return "Invalid recipe cover activation result";
  }
  return "Invalid recipe creation result";
}

function validateLocalCreationResults(
  results: unknown,
  input: CreateRecipeDraftInput,
  plan: CreationPlan,
) {
  if (!Array.isArray(results) || results.length !== plan.operations.length) {
    throw new Error("Invalid recipe creation result");
  }
  const unitIds = new Map<string, string>();
  const ingredientRefIds = new Map<string, string>();
  plan.operations.forEach((operation, index) => {
    const rows = resultRows(results[index]);
    if (rows.length !== 1) throw new Error(invalidCreationResultMessage(operation));
    validateCreationOperationRow(
      rows[0],
      operation,
      input,
      plan,
      unitIds,
      ingredientRefIds,
    );
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
  plan: CreationPlan,
) {
  if (!Array.isArray(results) || results.length !== plan.operations.length) {
    throw new Error("Invalid recipe creation result");
  }
  const unitIds = new Map<string, string>();
  const ingredientRefIds = new Map<string, string>();
  plan.operations.forEach((operation, index) => {
    const rows = nativeCreationRows(results[index]);
    if (rows.length !== 1) throw new Error(invalidCreationResultMessage(operation));
    validateCreationOperationRow(
      rows[0],
      operation,
      input,
      plan,
      unitIds,
      ingredientRefIds,
    );
  });
}

function creationRecipe(
  input: CreateRecipeDraftInput,
  course: RecipeCourse | null,
  timestamp: Date,
  coverMutation: RecipeAuthoringCoverMutation | null,
): Recipe {
  const uploadedCover = coverMutation?.kind === "uploaded" ? coverMutation : null;
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    servings: input.servings,
    chefId: input.chefId,
    deletedAt: null,
    course,
    activeCoverId: uploadedCover?.coverId ?? null,
    activeCoverVariant: uploadedCover ? "image" : null,
    coverMode: uploadedCover ? "manual" : "auto",
    sourceRecipeId: null,
    sourceUrl: input.sourceUrl ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function createRecipeGraph(
  db: PrismaClientType,
  input: CreateRecipeDraftInput,
  options: CreateRecipeDraftOptions,
): Promise<Recipe> {
  const plan = buildCreationPlan(input, options);
  const nativeDatabase = asCompatibleRecipeTagD1Database(options.nativeDatabase);

  if (nativeDatabase) {
    const operations = plan.operations.map((operation) => (
      nativeDatabase.prepare(operation.sql).bind(...operation.values)
    ));
    const results = await nativeDatabase.batch(operations);
    try {
      validateNativeCreationResults(results, input, plan);
    } catch {
      // A resolved D1 batch is already committed. Echo validation is diagnostic
      // and must not turn a successful atomic write into a false failure.
    }
  } else {
    const operations = plan.operations.map((operation) => (
      db.$queryRawUnsafe(operation.sql, ...operation.values)
    ));
    const results = await db.$transaction(operations);
    try {
      validateLocalCreationResults(results, input, plan);
    } catch {
      // Prisma array transactions also resolve only after commit.
    }
  }

  return creationRecipe(input, plan.course, plan.timestamp, options.coverMutation ?? null);
}

export async function createRecipeDraft(
  db: PrismaClientType,
  input: CreateRecipeDraftInput,
  options: CreateRecipeDraftOptions,
): Promise<Recipe> {
  // D1 does not support Prisma interactive transactions. Build one ordered SQL
  // graph and execute it through either native D1 batch or Prisma's raw array
  // transaction so every legacy and metadata-aware caller gets all-or-nothing
  // recipe creation.
  return createRecipeGraph(db, input, options);
}

interface UpdateOperation {
  sql: string;
  values: unknown[];
}

function buildUpdateRecipeOperation(
  input: UpdateRecipeDraftInput,
  boundTimestamp: string,
): UpdateOperation {
  const assignments: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    assignments.push(`"${column}" = ?`);
    values.push(value);
  };
  if (input.title !== undefined) add("title", input.title);
  if (input.description !== undefined) add("description", input.description);
  if (input.servings !== undefined) add("servings", input.servings);
  if (input.sourceUrl !== undefined) add("sourceUrl", input.sourceUrl);
  add("updatedAt", boundTimestamp);
  values.push(input.id, input.chefId);
  return {
    sql: `
      UPDATE "Recipe"
      SET ${assignments.join(", ")}
      WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL
      RETURNING "id"
    `,
    values,
  };
}

function buildUpdateRecipeOperations(
  input: UpdateRecipeDraftInput,
  options: UpdateRecipeDraftOptions,
): UpdateOperation[] {
  const boundTimestamp = (options.now?.() ?? new Date()).toISOString();
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const operations: UpdateOperation[] = [buildUpdateRecipeOperation(input, boundTimestamp)];
  const ownershipValues = [input.id, input.id, input.chefId];

  if (input.steps !== undefined) {
    operations.push(
      { sql: DELETE_STEP_OUTPUT_USES_SQL, values: ownershipValues },
      { sql: DELETE_INGREDIENTS_SQL, values: ownershipValues },
      { sql: DELETE_RECIPE_STEPS_SQL, values: ownershipValues },
    );
    const steps = input.steps.map((step, index) => ({
      ...step,
      id: randomId(),
      stepNum: index + 1,
    }));
    const ingredientDrafts = steps.flatMap((step) => step.ingredients.map((ingredient) => ({
      ingredientRefName: normalizeName(ingredient.ingredientName),
      quantity: ingredient.quantity,
      stepNum: step.stepNum,
      unitName: normalizeName(ingredient.unit),
    })));
    const units = createLookupRows(ingredientDrafts.map(({ unitName }) => unitName), randomId);
    const ingredientRefs = createLookupRows(
      ingredientDrafts.map(({ ingredientRefName }) => ingredientRefName),
      randomId,
    );
    operations.push(
      ...steps.map((step) => ({
        sql: INSERT_GUARDED_RECIPE_STEP_SQL,
        values: [
          step.id,
          step.stepNum,
          step.stepTitle,
          step.description,
          step.duration,
          boundTimestamp,
          input.id,
          input.chefId,
        ],
      })),
      ...units.map((unit) => ({
        sql: UPSERT_GUARDED_UNIT_SQL,
        values: [unit.id, unit.name, boundTimestamp, input.id, input.chefId],
      })),
      ...ingredientRefs.map((ingredientRef) => ({
        sql: UPSERT_GUARDED_INGREDIENT_REF_SQL,
        values: [ingredientRef.id, ingredientRef.name, boundTimestamp, input.id, input.chefId],
      })),
      ...ingredientDrafts.map((ingredient) => ({
        sql: INSERT_GUARDED_INGREDIENT_SQL,
        values: [
          randomId(),
          ingredient.stepNum,
          ingredient.quantity,
          boundTimestamp,
          ingredient.unitName,
          ingredient.ingredientRefName,
          input.id,
          input.chefId,
        ],
      })),
    );
  }

  operations.push(...buildRecipeAuthoringCoverOperations({
    boundTimestamp,
    mutation: options.coverMutation ?? null,
    recipeId: input.id,
    userId: input.chefId,
  }));
  operations.push(
    {
      sql: READ_GUARDED_RECIPE_COOKBOOKS_SQL,
      values: [input.id, input.id, input.chefId],
    },
    {
      sql: UPDATE_GUARDED_RECIPE_COOKBOOKS_SQL,
      values: [boundTimestamp, input.id, input.id, input.chefId],
    },
  );
  if (operations.length > MAX_RECIPE_AUTHORING_OPERATIONS) {
    throw new RecipeGraphTooLargeError(operations.length);
  }
  return operations;
}

function isCanonicalNativeZeroResult(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.success !== true || !Array.isArray(result.results) || result.results.length !== 0) {
    return false;
  }
  const meta = result.meta;
  return Boolean(meta)
    && typeof meta === "object"
    && !Array.isArray(meta)
    && (meta as Record<string, unknown>).changes === 0;
}

function isCanonicalAllZeroUpdate(
  results: unknown,
  operationCount: number,
  native: boolean,
): boolean {
  if (!Array.isArray(results) || results.length !== operationCount) return false;
  return native
    ? results.every(isCanonicalNativeZeroResult)
    : results.every((result) => Array.isArray(result) && result.length === 0);
}

export async function updateRecipeDraft(
  db: PrismaClientType,
  input: UpdateRecipeDraftInput,
  options: UpdateRecipeDraftOptions,
): Promise<void> {
  const operations = buildUpdateRecipeOperations(input, options);
  const nativeDatabase = asCompatibleRecipeTagD1Database(options.nativeDatabase);
  const results = nativeDatabase
    ? await nativeDatabase.batch(operations.map((operation) => (
        nativeDatabase.prepare(operation.sql).bind(...operation.values)
      )))
    : await db.$transaction(operations.map((operation) => (
        db.$queryRawUnsafe(operation.sql, ...operation.values)
      )));

  if (isCanonicalAllZeroUpdate(results, operations.length, Boolean(nativeDatabase))) {
    throw new RecipeDraftNotFoundError(input.id);
  }
}

const READ_COMMITTED_RECIPE_SQL = `
  SELECT recipe.*, chef."email" AS "chefEmail", chef."username" AS "chefUsername"
  FROM "Recipe" AS recipe
  JOIN "User" AS chef ON chef."id" = recipe."chefId"
  WHERE recipe."id" = ? AND recipe."chefId" = ? AND recipe."deletedAt" IS NULL
`;

const READ_COMMITTED_COVERS_SQL = `
  SELECT * FROM "RecipeCover"
  WHERE "recipeId" = ?
  ORDER BY "createdAt" DESC, "id" DESC
`;

const READ_COMMITTED_STEPS_SQL = `
  SELECT * FROM "RecipeStep"
  WHERE "recipeId" = ?
  ORDER BY "stepNum" ASC
`;

const READ_COMMITTED_INGREDIENTS_SQL = `
  SELECT
    ingredient.*,
    unit."name" AS "unitName",
    unit."updatedAt" AS "unitUpdatedAt",
    ingredientRef."name" AS "ingredientRefName",
    ingredientRef."updatedAt" AS "ingredientRefUpdatedAt"
  FROM "Ingredient" AS ingredient
  JOIN "Unit" AS unit ON unit."id" = ingredient."unitId"
  JOIN "IngredientRef" AS ingredientRef ON ingredientRef."id" = ingredient."ingredientRefId"
  WHERE ingredient."recipeId" = ?
  ORDER BY ingredient."stepNum" ASC, ingredientRef."name" ASC, ingredient."id" ASC
`;

function committedRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error("Invalid committed recipe graph result");
  return value.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("Invalid committed recipe graph row");
    }
    return row as Record<string, unknown>;
  });
}

export async function readCommittedRecipeGraph(
  db: PrismaClientType,
  recipeId: string,
  options: {
    chefId: string;
    nativeDatabase?: CompatibleRecipeTagD1Database | null;
  },
): Promise<CommittedRecipeGraph | null> {
  const operations = [
    { sql: READ_COMMITTED_RECIPE_SQL, values: [recipeId, options.chefId] },
    { sql: READ_COMMITTED_COVERS_SQL, values: [recipeId] },
    { sql: READ_COMMITTED_STEPS_SQL, values: [recipeId] },
    { sql: READ_COMMITTED_INGREDIENTS_SQL, values: [recipeId] },
  ];
  const nativeDatabase = asCompatibleRecipeTagD1Database(options.nativeDatabase);
  const rawResults = nativeDatabase
    ? await nativeDatabase.batch(operations.map((operation) => (
        nativeDatabase.prepare(operation.sql).bind(...operation.values)
      )))
    : await db.$transaction(operations.map((operation) => (
        db.$queryRawUnsafe(operation.sql, ...operation.values)
      )));
  if (!Array.isArray(rawResults) || rawResults.length !== operations.length) {
    throw new Error("Invalid committed recipe graph result");
  }
  const results = nativeDatabase
    ? rawResults.map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("Invalid committed recipe graph result");
        }
        const result = value as Record<string, unknown>;
        if (result.success !== true || !Array.isArray(result.results)) {
          throw new Error("Invalid committed recipe graph result");
        }
        return result.results;
      })
    : rawResults;
  const [recipeResult, coversResult, stepsResult, ingredientsResult] = results;
  const recipeRows = committedRows(recipeResult);
  if (recipeRows.length === 0) return null;
  if (recipeRows.length !== 1) throw new Error("Invalid committed recipe graph result");
  const recipe = recipeRows[0];
  const covers = committedRows(coversResult);
  const steps = committedRows(stepsResult);
  const ingredients = committedRows(ingredientsResult);
  const ingredientsByStep = new Map<number, Record<string, unknown>[]>();
  for (const ingredient of ingredients) {
    const stepNum = ingredient.stepNum;
    if (typeof stepNum !== "number") throw new Error("Invalid committed recipe ingredient row");
    const list = ingredientsByStep.get(stepNum) ?? [];
    list.push({
      ...ingredient,
      unit: {
        id: ingredient.unitId,
        name: ingredient.unitName,
        updatedAt: ingredient.unitUpdatedAt,
      },
      ingredientRef: {
        id: ingredient.ingredientRefId,
        name: ingredient.ingredientRefName,
        updatedAt: ingredient.ingredientRefUpdatedAt,
      },
    });
    ingredientsByStep.set(stepNum, list);
  }
  const graph = {
    ...recipe,
    chef: {
      id: recipe.chefId,
      email: recipe.chefEmail,
      username: recipe.chefUsername,
    },
    covers,
    steps: steps.map((step) => ({
      ...step,
      ingredients: ingredientsByStep.get(step.stepNum as number) ?? [],
    })),
  };
  return graph as unknown as CommittedRecipeGraph;
}
