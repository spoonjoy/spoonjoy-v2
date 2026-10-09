import type { Prisma, PrismaClient as PrismaClientType } from "@prisma/client";
import type { ApiV1ErrorCode } from "~/lib/api-v1-contract.server";
import type { D1Query, D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Guard, d1Timestamp, d1WriteBatch, retryOnD1GuardFailure } from "~/lib/d1-write.server";
import {
  nameUpsertStatements,
  namedIngredientInsertStatement,
  recipeUpdateStatement,
  stepAtGuard,
  stepDeleteStatement,
  stepInsertStatement,
  stepNumUpdateStatement,
  stepOutputUseInsertStatement,
  stepOutputUsesDeleteStatement,
  stepReorderDependencyFreeGuard,
} from "~/lib/recipe-d1-writes.server";
import { validateStepDeletion } from "~/lib/step-deletion-validation.server";
import { checkStepUsage } from "~/lib/step-output-use-queries.server";
import { validateStepReorderComplete } from "~/lib/step-reorder-validation.server";
import {
  validateIngredientName,
  validateQuantity,
  validateStepDescription,
  validateStepReference,
  validateStepTitle,
  validateUnitName,
} from "~/lib/validation";

type Database = PrismaClientType;

export type ApiV1RecipeStepResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; code: ApiV1ErrorCode; message: string; details?: unknown };

export interface NativeRecipeStepIngredientInput {
  quantity: number;
  unit: string;
  ingredientName: string;
}

export interface NativeRecipeStepCreateInput {
  clientMutationId: string;
  stepNum?: number;
  stepTitle: string | null;
  description: string;
  duration: number | null;
  ingredients: NativeRecipeStepIngredientInput[];
  outputStepNums: number[];
}

export interface NativeRecipeStepPatchInput {
  clientMutationId: string;
  fields: {
    stepTitle?: string | null;
    description?: string;
    duration?: number | null;
    outputStepNums?: number[];
  };
}

export interface NativeRecipeStepDeleteInput {
  clientMutationId: string;
}

export interface NativeRecipeStepIngredientCreateInput {
  clientMutationId: string;
  quantity: number;
  unit: string;
  ingredientName: string;
}

export interface NativeRecipeStepIngredientDeleteInput {
  clientMutationId: string;
}

export interface NativeRecipeStepReorderInput {
  clientMutationId: string;
  stepId: string;
  toStepNum: number;
}

export interface NativeRecipeStepOutputUsesInput {
  clientMutationId: string;
  inputStepId: string;
  outputStepNums: number[];
}

interface NativeRecipeStepDeleteOptions {
  tombstone?: {
    idempotencyKeyId: string;
    operation: string;
  };
  /** The request's D1 binding: the write then goes to D1 as one atomic batch. */
  d1?: D1ReadDatabase | null;
}

interface NativeRecipeStepIngredientDeleteOptions {
  tombstone?: {
    idempotencyKeyId: string;
    operation: string;
  };
  /** The request's D1 binding: the write then goes to D1 as one atomic batch. */
  d1?: D1ReadDatabase | null;
}

interface NativeRecipeStepReorderOptions {
  tombstone?: {
    idempotencyKeyId: string;
    operation: string;
  };
  /** The request's D1 binding: the write then goes to D1 as one atomic batch. */
  d1?: D1ReadDatabase | null;
}

function success<T>(data: T, status = 200): ApiV1RecipeStepResult<T> {
  return { ok: true, status, data };
}

function failure<T>(
  code: ApiV1ErrorCode,
  message: string,
  details?: unknown,
): ApiV1RecipeStepResult<T> {
  return { ok: false, code, message, details };
}

function fieldFailure<T>(field: string, message: string): ApiV1RecipeStepResult<T> {
  return failure("validation_error", "Invalid recipe step fields", { fieldErrors: { [field]: message } });
}

/**
 * Runs a REST step write whose D1 batch re-checks what it read. When another request changed
 * those rows in between, the batch applies nothing and the write runs again, so the caller
 * gets the answer the checks now give (not found, a validation error) rather than a 500.
 */
function withRaceRetry<T>(
  d1: D1ReadDatabase | null | undefined,
  attempt: () => Promise<ApiV1RecipeStepResult<T>>,
): Promise<ApiV1RecipeStepResult<T>> {
  return d1
    ? retryOnD1GuardFailure(attempt, () => failure<T>("validation_error", "This recipe changed while you were editing it; reload and try again.", {
      reason: "concurrent_change",
    }))
    : attempt();
}

function touchRecipeOp(db: Database, recipeId: string): Prisma.PrismaPromise<unknown> {
  return db.recipe.update({
    where: { id: recipeId },
    data: { updatedAt: new Date() },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function hasOwn(body: Record<string, unknown>, field: string) {
  return Object.prototype.hasOwnProperty.call(body, field);
}

function assertKnownFields<T>(
  body: Record<string, unknown>,
  allowed: readonly string[],
): ApiV1RecipeStepResult<T> | null {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(body).filter((field) => !allowedSet.has(field));
  return unknown.length > 0
    ? failure("validation_error", "Unknown request body fields", { fields: unknown })
    : null;
}

function requiredText(
  value: unknown,
  field: string,
  validate: (value: string) => { valid: true } | { valid: false; error: string },
): ApiV1RecipeStepResult<string> {
  if (typeof value !== "string") {
    return fieldFailure(field, `${field} must be a string`);
  }
  const validation = validate(value);
  if (!validation.valid) return fieldFailure(field, validation.error);
  return success(value.trim());
}

function optionalStepTitle(value: unknown, field = "stepTitle"): ApiV1RecipeStepResult<string | null> {
  if (value === undefined || value === null) return success(null);
  if (typeof value !== "string") {
    return fieldFailure(field, `${field} must be a string or null`);
  }
  const normalized = value.trim() || null;
  const validation = validateStepTitle(normalized);
  if (!validation.valid) return fieldFailure(field, validation.error);
  return success(normalized);
}

function patchStepTitle(body: Record<string, unknown>): ApiV1RecipeStepResult<string | null | undefined> {
  if (!hasOwn(body, "stepTitle")) return success(undefined);
  return optionalStepTitle(body.stepTitle);
}

function patchDescription(body: Record<string, unknown>): ApiV1RecipeStepResult<string | undefined> {
  if (!hasOwn(body, "description")) return success(undefined);
  return requiredText(body.description, "description", validateStepDescription);
}

function parseDuration(value: unknown, field: string): ApiV1RecipeStepResult<number | null> {
  if (value === undefined || value === null || value === "") return success(null);
  const duration = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(duration) || duration <= 0) {
    return fieldFailure(field, "Duration must be a positive whole number");
  }
  return success(duration);
}

function patchDuration(body: Record<string, unknown>): ApiV1RecipeStepResult<number | null | undefined> {
  if (!hasOwn(body, "duration")) return success(undefined);
  return parseDuration(body.duration, "duration");
}

function parseQuantity(value: unknown, field: string): ApiV1RecipeStepResult<number> {
  const quantity = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  const validation = validateQuantity(quantity);
  if (!validation.valid) return fieldFailure(field, validation.error);
  return success(quantity);
}

function positiveInteger(value: unknown, field: string): ApiV1RecipeStepResult<number> {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fieldFailure(field, `${field} must be a positive integer`);
  }
  return success(parsed);
}

/** A step's `outputStepNums`: an array of positive integers, without repeats. Shared with recipe create. */
export function parseOutputStepNums(value: unknown, field = "outputStepNums"): ApiV1RecipeStepResult<number[]> {
  if (value === undefined || value === null) return success([]);
  if (!Array.isArray(value)) {
    return fieldFailure(field, `${field} must be an array`);
  }

  const outputStepNums: number[] = [];
  for (const [index, item] of value.entries()) {
    const parsed = positiveInteger(item, `${field}.${index}`);
    if (!parsed.ok) return parsed;
    outputStepNums.push(parsed.data);
  }
  return success([...new Set(outputStepNums)]);
}

function parseOutputStepNumsPatch(body: Record<string, unknown>): ApiV1RecipeStepResult<number[] | undefined> {
  if (!hasOwn(body, "outputStepNums")) return success(undefined);
  return parseOutputStepNums(body.outputStepNums);
}

function parseIngredient(
  value: unknown,
  fieldPrefix: string,
): ApiV1RecipeStepResult<NativeRecipeStepIngredientInput> {
  if (!isRecord(value)) {
    return fieldFailure(fieldPrefix, "Ingredient must be an object");
  }
  const unknown = assertKnownFields<NativeRecipeStepIngredientInput>(value, ["quantity", "unit", "name"]);
  if (unknown) return unknown;

  const quantity = parseQuantity(value.quantity, `${fieldPrefix}.quantity`);
  if (!quantity.ok) return quantity;

  const unit = requiredText(value.unit, `${fieldPrefix}.unit`, validateUnitName);
  if (!unit.ok) return unit;

  const ingredientName = requiredText(value.name, `${fieldPrefix}.name`, validateIngredientName);
  if (!ingredientName.ok) return ingredientName;

  return success({
    quantity: quantity.data,
    unit: unit.data,
    ingredientName: ingredientName.data,
  });
}

function parseIngredients(value: unknown): ApiV1RecipeStepResult<NativeRecipeStepIngredientInput[]> {
  if (value === undefined || value === null) return success([]);
  if (!Array.isArray(value)) {
    return fieldFailure("ingredients", "ingredients must be an array");
  }

  const ingredients: NativeRecipeStepIngredientInput[] = [];
  for (const [index, ingredient] of value.entries()) {
    const parsed = parseIngredient(ingredient, `ingredients.${index}`);
    if (!parsed.ok) return parsed;
    ingredients.push(parsed.data);
  }
  return success(ingredients);
}

function clientMutationIdFrom(value: unknown): ApiV1RecipeStepResult<string> {
  return requiredText(value, "clientMutationId", (candidate) => (
    candidate.trim() ? { valid: true } : { valid: false, error: "clientMutationId must be a nonblank string" }
  ));
}

export function parseNativeRecipeStepCreateBody(
  body: Record<string, unknown>,
): ApiV1RecipeStepResult<NativeRecipeStepCreateInput> {
  const unknown = assertKnownFields<NativeRecipeStepCreateInput>(body, [
    "clientMutationId",
    "stepNum",
    "stepTitle",
    "description",
    "duration",
    "ingredients",
    "outputStepNums",
  ]);
  if (unknown) return unknown;

  const clientMutationId = clientMutationIdFrom(body.clientMutationId);
  if (!clientMutationId.ok) return clientMutationId;

  const stepNum = body.stepNum === undefined || body.stepNum === null
    ? success<number | undefined>(undefined)
    : positiveInteger(body.stepNum, "stepNum");
  if (!stepNum.ok) return stepNum;

  const stepTitle = optionalStepTitle(body.stepTitle);
  if (!stepTitle.ok) return stepTitle;

  const description = requiredText(body.description, "description", validateStepDescription);
  if (!description.ok) return description;

  const duration = parseDuration(body.duration, "duration");
  if (!duration.ok) return duration;

  const ingredients = parseIngredients(body.ingredients);
  if (!ingredients.ok) return ingredients;

  const outputStepNums = parseOutputStepNums(body.outputStepNums);
  if (!outputStepNums.ok) return outputStepNums;

  return success({
    clientMutationId: clientMutationId.data,
    ...(stepNum.data === undefined ? {} : { stepNum: stepNum.data }),
    stepTitle: stepTitle.data,
    description: description.data,
    duration: duration.data,
    ingredients: ingredients.data,
    outputStepNums: outputStepNums.data,
  });
}

export function parseNativeRecipeStepPatchBody(
  body: Record<string, unknown>,
): ApiV1RecipeStepResult<NativeRecipeStepPatchInput> {
  const unknown = assertKnownFields<NativeRecipeStepPatchInput>(body, [
    "clientMutationId",
    "stepTitle",
    "description",
    "duration",
    "outputStepNums",
  ]);
  if (unknown) return unknown;

  const clientMutationId = clientMutationIdFrom(body.clientMutationId);
  if (!clientMutationId.ok) return clientMutationId;

  const stepTitle = patchStepTitle(body);
  if (!stepTitle.ok) return stepTitle;

  const description = patchDescription(body);
  if (!description.ok) return description;

  const duration = patchDuration(body);
  if (!duration.ok) return duration;

  const outputStepNums = parseOutputStepNumsPatch(body);
  if (!outputStepNums.ok) return outputStepNums;

  const fields: NativeRecipeStepPatchInput["fields"] = {};
  if (stepTitle.data !== undefined) fields.stepTitle = stepTitle.data;
  if (description.data !== undefined) fields.description = description.data;
  if (duration.data !== undefined) fields.duration = duration.data;
  if (outputStepNums.data !== undefined) fields.outputStepNums = outputStepNums.data;

  return success({ clientMutationId: clientMutationId.data, fields });
}

export function parseNativeRecipeStepDeleteBody(
  body: Record<string, unknown>,
  fallbackClientMutationId: unknown,
): ApiV1RecipeStepResult<NativeRecipeStepDeleteInput> {
  const unknown = assertKnownFields<NativeRecipeStepDeleteInput>(body, ["clientMutationId"]);
  if (unknown) return unknown;
  const clientMutationId = clientMutationIdFrom(body.clientMutationId ?? fallbackClientMutationId);
  if (!clientMutationId.ok) return clientMutationId;
  return success({ clientMutationId: clientMutationId.data });
}

export function parseNativeRecipeStepIngredientCreateBody(
  body: Record<string, unknown>,
): ApiV1RecipeStepResult<NativeRecipeStepIngredientCreateInput> {
  const clientMutationId = clientMutationIdFrom(body.clientMutationId);
  if (!clientMutationId.ok) return clientMutationId;
  const unknown = assertKnownFields<NativeRecipeStepIngredientCreateInput>(body, [
    "clientMutationId",
    "quantity",
    "unit",
    "name",
  ]);
  if (unknown) return unknown;
  const parsed = parseIngredient({
    quantity: body.quantity,
    unit: body.unit,
    name: body.name,
  }, "ingredient");
  if (!parsed.ok) return parsed;
  return success({ clientMutationId: clientMutationId.data, ...parsed.data });
}

export function parseNativeRecipeStepIngredientDeleteBody(
  body: Record<string, unknown>,
  fallbackClientMutationId: unknown,
): ApiV1RecipeStepResult<NativeRecipeStepIngredientDeleteInput> {
  const unknown = assertKnownFields<NativeRecipeStepIngredientDeleteInput>(body, ["clientMutationId"]);
  if (unknown) return unknown;
  const clientMutationId = clientMutationIdFrom(body.clientMutationId ?? fallbackClientMutationId);
  if (!clientMutationId.ok) return clientMutationId;
  return success({ clientMutationId: clientMutationId.data });
}

export function parseNativeRecipeStepReorderBody(
  body: Record<string, unknown>,
): ApiV1RecipeStepResult<NativeRecipeStepReorderInput> {
  const unknown = assertKnownFields<NativeRecipeStepReorderInput>(body, [
    "clientMutationId",
    "stepId",
    "toStepNum",
  ]);
  if (unknown) return unknown;

  const clientMutationId = clientMutationIdFrom(body.clientMutationId);
  if (!clientMutationId.ok) return clientMutationId;

  const stepId = requiredText(body.stepId, "stepId", (candidate) => (
    candidate.trim() ? { valid: true } : { valid: false, error: "stepId must be a nonblank string" }
  ));
  if (!stepId.ok) return stepId;

  const toStepNum = positiveInteger(body.toStepNum, "toStepNum");
  if (!toStepNum.ok) return toStepNum;

  return success({
    clientMutationId: clientMutationId.data,
    stepId: stepId.data,
    toStepNum: toStepNum.data,
  });
}

export function parseNativeRecipeStepOutputUsesBody(
  body: Record<string, unknown>,
): ApiV1RecipeStepResult<NativeRecipeStepOutputUsesInput> {
  const unknown = assertKnownFields<NativeRecipeStepOutputUsesInput>(body, [
    "clientMutationId",
    "inputStepId",
    "outputStepNums",
  ]);
  if (unknown) return unknown;

  const clientMutationId = clientMutationIdFrom(body.clientMutationId);
  if (!clientMutationId.ok) return clientMutationId;

  const inputStepId = requiredText(body.inputStepId, "inputStepId", (candidate) => (
    candidate.trim() ? { valid: true } : { valid: false, error: "inputStepId must be a nonblank string" }
  ));
  if (!inputStepId.ok) return inputStepId;

  const outputStepNums = parseOutputStepNums(body.outputStepNums);
  if (!outputStepNums.ok) return outputStepNums;

  return success({
    clientMutationId: clientMutationId.data,
    inputStepId: inputStepId.data,
    outputStepNums: outputStepNums.data,
  });
}

async function loadOwnedRecipe(db: Database, chefId: string, recipeId: string) {
  const recipe = await db.recipe.findUnique({
    where: { id: recipeId },
    select: { id: true, chefId: true, deletedAt: true },
  });
  if (!recipe || recipe.deletedAt) {
    return failure<NonNullable<typeof recipe>>("not_found", "Recipe not found");
  }
  if (recipe.chefId !== chefId) {
    return failure<NonNullable<typeof recipe>>("insufficient_scope", "Recipe does not belong to the authenticated chef");
  }
  return success(recipe);
}

async function loadStepForRecipe(db: Database, recipeId: string, stepId: string) {
  const step = await db.recipeStep.findUnique({
    where: { id: stepId },
    select: { id: true, recipeId: true, stepNum: true, stepTitle: true, description: true, duration: true },
  });
  if (!step || step.recipeId !== recipeId) {
    return failure<NonNullable<typeof step>>("not_found", "Recipe step not found", { resource: "recipe_step", stepId });
  }
  return success(step);
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

async function outputStepNumsFor(db: Database, recipeId: string, inputStepNum: number) {
  const rows = await db.stepOutputUse.findMany({
    where: { recipeId, inputStepNum },
    select: { outputStepNum: true },
    orderBy: { outputStepNum: "asc" },
  });
  return rows.map((row) => row.outputStepNum);
}

function createStepOutputUseOps(
  db: Database,
  recipeId: string,
  inputStepNum: number,
  outputStepNums: number[],
): Prisma.PrismaPromise<unknown>[] {
  const uniqueOutputStepNums = [...new Set(outputStepNums)];
  if (uniqueOutputStepNums.length === 0) return [];
  return [
    db.stepOutputUse.createMany({
      data: uniqueOutputStepNums.map((outputStepNum) => ({
        recipeId,
        inputStepNum,
        outputStepNum,
      })),
    }),
  ];
}

function replaceStepOutputUseOps(
  db: Database,
  recipeId: string,
  inputStepNum: number,
  outputStepNums: number[],
): Prisma.PrismaPromise<unknown>[] {
  return [
    db.stepOutputUse.deleteMany({
      where: { recipeId, inputStepNum },
    }),
    ...createStepOutputUseOps(db, recipeId, inputStepNum, outputStepNums),
  ];
}

function ingredientCreateData(
  recipeId: string,
  stepNum: number,
  ingredient: NativeRecipeStepIngredientInput,
  ingredientId: string = crypto.randomUUID(),
): Prisma.IngredientCreateInput {
  const unitName = normalizeName(ingredient.unit);
  const ingredientName = normalizeName(ingredient.ingredientName);
  return {
    id: ingredientId,
    quantity: ingredient.quantity,
    recipeStep: {
      connect: { recipeId_stepNum: { recipeId, stepNum } },
    },
    unit: {
      connectOrCreate: {
        where: { name: unitName },
        create: { name: unitName },
      },
    },
    ingredientRef: {
      connectOrCreate: {
        where: { name: ingredientName },
        create: { name: ingredientName },
      },
    },
  };
}

function createIngredientOp(
  db: Database,
  recipeId: string,
  stepNum: number,
  ingredient: NativeRecipeStepIngredientInput,
  ingredientId?: string,
): Prisma.PrismaPromise<unknown> {
  return db.ingredient.create({
    data: ingredientCreateData(recipeId, stepNum, ingredient, ingredientId),
  });
}

function createMutationTombstoneOp(
  db: Database,
  input: {
    idempotencyKeyId: string;
    operation: string;
    resourceType: string;
    resourceId: string;
    parentResourceId: string;
    payload: unknown;
  },
): Prisma.PrismaPromise<unknown> {
  const payload = JSON.stringify(input.payload);
  return db.apiMutationTombstone.upsert({
    where: {
      idempotencyKeyId_resourceType_resourceId: {
        idempotencyKeyId: input.idempotencyKeyId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
      },
    },
    update: {
      operation: input.operation,
      parentResourceId: input.parentResourceId,
      payload,
    },
    create: {
      idempotencyKeyId: input.idempotencyKeyId,
      operation: input.operation,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      parentResourceId: input.parentResourceId,
      payload,
    },
  });
}

/** `createMutationTombstoneOp` as a D1 statement, for a write batch. */
function mutationTombstoneStatement(input: Parameters<typeof createMutationTombstoneOp>[1], now: Date): D1Query {
  return [
    `INSERT INTO "ApiMutationTombstone" (
       "id", "idempotencyKeyId", "operation", "resourceType", "resourceId", "parentResourceId", "payload", "createdAt"
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT ("idempotencyKeyId", "resourceType", "resourceId") DO UPDATE SET
       "operation" = excluded."operation",
       "parentResourceId" = excluded."parentResourceId",
       "payload" = excluded."payload"`,
    crypto.randomUUID(),
    input.idempotencyKeyId,
    input.operation,
    input.resourceType,
    input.resourceId,
    input.parentResourceId,
    JSON.stringify(input.payload),
    d1Timestamp(now),
  ];
}

/** The ingredients as named inserts (with their names' upserts first) for a D1 batch. */
function namedIngredientStatements(
  recipeId: string,
  stepNum: number,
  ingredients: ReadonlyArray<NativeRecipeStepIngredientInput & { id?: string }>,
  now: Date,
): D1Query[] {
  const named = ingredients.map((ingredient) => ({
    id: ingredient.id ?? crypto.randomUUID(),
    recipeId,
    stepNum,
    quantity: ingredient.quantity,
    unitName: normalizeName(ingredient.unit),
    ingredientName: normalizeName(ingredient.ingredientName),
    now,
  }));
  return [...nameUpsertStatements(named, now), ...named.map(namedIngredientInsertStatement)];
}

/** Fails the batch if any of the named ingredients is already in the recipe. */
function noRecipeIngredientConflictsGuard(recipeId: string, ingredients: NativeRecipeStepIngredientInput[]): D1Query {
  return d1Guard(
    `NOT EXISTS (
       SELECT 1 FROM "Ingredient" JOIN "IngredientRef" ON "IngredientRef"."id" = "Ingredient"."ingredientRefId"
       WHERE "Ingredient"."recipeId" = ? AND "IngredientRef"."name" IN (SELECT "value" FROM json_each(?))
     )`,
    recipeId,
    JSON.stringify(ingredients.map((ingredient) => normalizeName(ingredient.ingredientName))),
  );
}

/**
 * Fails the batch unless the step will still have content: an ingredient, or an output use
 * (the replacement ones, or the existing ones when they are not being replaced).
 */
function stepWillHaveContentGuards(recipeId: string, stepNum: number, replacementOutputStepNums?: number[]): D1Query[] {
  if (replacementOutputStepNums && replacementOutputStepNums.length > 0) return [];
  const ingredient = `EXISTS (SELECT 1 FROM "Ingredient" WHERE "recipeId" = ? AND "stepNum" = ?)`;
  return [replacementOutputStepNums
    ? d1Guard(ingredient, recipeId, stepNum)
    : d1Guard(
      `${ingredient} OR EXISTS (SELECT 1 FROM "StepOutputUse" WHERE "recipeId" = ? AND "inputStepNum" = ?)`,
      recipeId,
      stepNum,
      recipeId,
      stepNum,
    )];
}

function stepOutputUseStatements(recipeId: string, inputStepNum: number, outputStepNums: number[], now: Date): D1Query[] {
  return [...new Set(outputStepNums)].map((outputStepNum) =>
    stepOutputUseInsertStatement(recipeId, inputStepNum, outputStepNum, now));
}

async function assertNoRecipeIngredientConflicts<T>(
  db: Database,
  recipeId: string,
  ingredients: NativeRecipeStepIngredientInput[],
): Promise<ApiV1RecipeStepResult<T> | null> {
  const normalizedNames = ingredients.map((ingredient) => normalizeName(ingredient.ingredientName));
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    return fieldFailure("ingredients", "Duplicate ingredients are not allowed in the same request");
  }

  const ingredientRefs = await db.ingredientRef.findMany({
    where: { name: { in: normalizedNames } },
    select: { id: true, name: true },
  });
  if (ingredientRefs.length === 0) return null;

  const existingIngredient = await db.ingredient.findFirst({
    where: {
      recipeId,
      ingredientRefId: { in: ingredientRefs.map((ingredientRef) => ingredientRef.id) },
    },
    include: { ingredientRef: true },
  });
  if (!existingIngredient) return null;

  return fieldFailure(
    "ingredientName",
    `Ingredient ${existingIngredient.ingredientRef.name} is already in the recipe`,
  );
}

async function validateOutputStepRefs<T>(
  db: Database,
  recipeId: string,
  inputStepNum: number,
  outputStepNums: number[],
  field: string,
): Promise<ApiV1RecipeStepResult<T> | null> {
  const uniqueOutputStepNums = [...new Set(outputStepNums)];
  for (const outputStepNum of uniqueOutputStepNums) {
    const validation = validateStepReference(outputStepNum, inputStepNum);
    if (!validation.valid) {
      return fieldFailure(field, validation.error);
    }
  }
  if (uniqueOutputStepNums.length === 0) return null;

  const existingSteps = await db.recipeStep.findMany({
    where: {
      recipeId,
      stepNum: { in: uniqueOutputStepNums },
    },
    select: { stepNum: true },
  });
  const existingStepNums = new Set(existingSteps.map((step) => step.stepNum));
  const missingStepNums = uniqueOutputStepNums.filter((stepNum) => !existingStepNums.has(stepNum));
  if (missingStepNums.length > 0) {
    return fieldFailure(field, `Referenced output steps do not exist: ${missingStepNums.join(", ")}`);
  }
  return null;
}

function hasPatchFields(fields: NativeRecipeStepPatchInput["fields"]) {
  return Object.keys(fields).length > 0;
}

async function validateStepWillHaveContent<T>(
  db: Database,
  recipeId: string,
  inputStepNum: number,
  outputStepNums: number[],
): Promise<ApiV1RecipeStepResult<T> | null> {
  const ingredientCount = await db.ingredient.count({
    where: { recipeId, stepNum: inputStepNum },
  });
  if (ingredientCount === 0 && outputStepNums.length === 0) {
    return failure("validation_error", "Add at least 1 ingredient or 1 step output use before saving this step.", {
      fieldErrors: { outputStepNums: "Add at least 1 ingredient or 1 step output use before saving this step." },
    });
  }
  return null;
}

export async function createNativeRecipeStep(
  db: Database,
  chefId: string,
  recipeId: string,
  input: NativeRecipeStepCreateInput,
  options: { stepId?: string; d1?: D1ReadDatabase | null } = {},
): Promise<ApiV1RecipeStepResult<{ recipeId: string; stepId: string; stepNum: number }>> {
  return withRaceRetry(options.d1, () => createNativeRecipeStepOnce(db, chefId, recipeId, input, options));
}

async function createNativeRecipeStepOnce(
  db: Database,
  chefId: string,
  recipeId: string,
  input: NativeRecipeStepCreateInput,
  options: { stepId?: string; d1?: D1ReadDatabase | null },
): Promise<ApiV1RecipeStepResult<{ recipeId: string; stepId: string; stepNum: number }>> {
  const recipe = await loadOwnedRecipe(db, chefId, recipeId);
  if (!recipe.ok) return recipe;

  const latestStep = await db.recipeStep.findFirst({
    where: { recipeId },
    orderBy: { stepNum: "desc" },
    select: { stepNum: true },
  });
  const nextStepNum = (latestStep?.stepNum ?? 0) + 1;
  const stepNum = input.stepNum ?? nextStepNum;

  if (input.stepNum !== undefined) {
    const existingStep = await db.recipeStep.findUnique({
      where: { recipeId_stepNum: { recipeId, stepNum: input.stepNum } },
      select: { id: true },
    });
    if (existingStep) {
      return fieldFailure("stepNum", "Step number already exists");
    }
    if (input.stepNum !== nextStepNum) {
      return fieldFailure("stepNum", `stepNum must be ${nextStepNum} for the next recipe step`);
    }
  }

  const ingredientConflict = await assertNoRecipeIngredientConflicts<{ recipeId: string; stepId: string; stepNum: number }>(
    db,
    recipeId,
    input.ingredients,
  );
  if (ingredientConflict) return ingredientConflict;

  const invalidRefs = await validateOutputStepRefs<{ recipeId: string; stepId: string; stepNum: number }>(
    db,
    recipeId,
    stepNum,
    input.outputStepNums,
    "outputStepNums",
  );
  if (invalidRefs) return invalidRefs;

  const stepId = options.stepId ?? crypto.randomUUID();
  if (options.d1) {
    // One atomic batch: the step, its output uses and ingredients, and the recipe touch.
    const now = new Date();
    await d1WriteBatch(options.d1, [
      noRecipeIngredientConflictsGuard(recipeId, input.ingredients),
      // Still the next step number: a step added in between sends the write back to its checks.
      d1Guard(`NOT EXISTS (SELECT 1 FROM "RecipeStep" WHERE "recipeId" = ? AND "stepNum" >= ?)`, recipeId, stepNum),
      stepInsertStatement({
        id: stepId,
        recipeId,
        stepNum,
        stepTitle: input.stepTitle,
        description: input.description,
        duration: input.duration,
        now,
      }),
      ...stepOutputUseStatements(recipeId, stepNum, input.outputStepNums, now),
      ...namedIngredientStatements(recipeId, stepNum, input.ingredients, now),
      recipeUpdateStatement(recipeId, {}, now),
    ]);
    return success({ recipeId, stepId, stepNum }, 201);
  }
  const ops: Prisma.PrismaPromise<unknown>[] = [
    db.recipeStep.create({
      data: {
        id: stepId,
        recipeId,
        stepNum,
        stepTitle: input.stepTitle,
        description: input.description,
        duration: input.duration,
      },
    }),
    ...createStepOutputUseOps(db, recipeId, stepNum, input.outputStepNums),
    ...input.ingredients.map((ingredient) => createIngredientOp(db, recipeId, stepNum, ingredient)),
    touchRecipeOp(db, recipeId),
  ];

  await db.$transaction(ops);

  return success({ recipeId, stepId, stepNum }, 201);
}

export async function updateNativeRecipeStep(
  db: Database,
  chefId: string,
  recipeId: string,
  stepId: string,
  input: NativeRecipeStepPatchInput,
  options: { d1?: D1ReadDatabase | null } = {},
): Promise<ApiV1RecipeStepResult<{ recipeId: string; stepId: string; updated: boolean }>> {
  return withRaceRetry(options.d1, () => updateNativeRecipeStepOnce(db, chefId, recipeId, stepId, input, options));
}

async function updateNativeRecipeStepOnce(
  db: Database,
  chefId: string,
  recipeId: string,
  stepId: string,
  input: NativeRecipeStepPatchInput,
  options: { d1?: D1ReadDatabase | null },
): Promise<ApiV1RecipeStepResult<{ recipeId: string; stepId: string; updated: boolean }>> {
  const recipe = await loadOwnedRecipe(db, chefId, recipeId);
  if (!recipe.ok) return recipe;

  const step = await loadStepForRecipe(db, recipeId, stepId);
  if (!step.ok) return step;

  const existingOutputStepNums = await outputStepNumsFor(db, recipeId, step.data.stepNum);

  if (input.fields.outputStepNums !== undefined) {
    const invalidRefs = await validateOutputStepRefs<{ recipeId: string; stepId: string; updated: boolean }>(
      db,
      recipeId,
      step.data.stepNum,
      input.fields.outputStepNums,
      "outputStepNums",
    );
    if (invalidRefs) return invalidRefs;
  }

  if (hasPatchFields(input.fields)) {
    const outputStepNums = input.fields.outputStepNums ?? existingOutputStepNums;
    const contentError = await validateStepWillHaveContent<{ recipeId: string; stepId: string; updated: boolean }>(
      db,
      recipeId,
      step.data.stepNum,
      outputStepNums,
    );
    if (contentError) return contentError;
  }

  const stepFields = {
    ...(input.fields.stepTitle !== undefined ? { stepTitle: input.fields.stepTitle } : {}),
    ...(input.fields.description !== undefined ? { description: input.fields.description } : {}),
    ...(input.fields.duration !== undefined ? { duration: input.fields.duration } : {}),
  };
  const updated = Object.keys(stepFields).length > 0 || input.fields.outputStepNums !== undefined;

  if (options.d1 && updated) {
    // One atomic batch: the step fields, the replaced output uses and the recipe touch. The
    // guards re-check that the step is where it was and will still have content.
    const now = new Date();
    const { outputStepNums } = input.fields;
    const assignments = Object.keys(stepFields).map((column) => `"${column}" = ?`);
    await d1WriteBatch(options.d1, [
      stepAtGuard(stepId, recipeId, step.data.stepNum),
      ...stepWillHaveContentGuards(recipeId, step.data.stepNum, outputStepNums),
      ...(assignments.length > 0
        ? [[
          `UPDATE "RecipeStep" SET ${assignments.join(", ")}, "updatedAt" = ? WHERE "id" = ?`,
          ...Object.values(stepFields),
          d1Timestamp(now),
          stepId,
        ] as D1Query]
        : []),
      ...(outputStepNums === undefined
        ? []
        : [
          stepOutputUsesDeleteStatement(recipeId, step.data.stepNum),
          ...stepOutputUseStatements(recipeId, step.data.stepNum, outputStepNums, now),
        ]),
      recipeUpdateStatement(recipeId, {}, now),
    ]);
    return success({ recipeId, stepId, updated });
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (Object.keys(stepFields).length > 0) {
    ops.push(
      db.recipeStep.update({
        where: { id: stepId },
        data: stepFields,
      }),
    );
  }

  if (input.fields.outputStepNums !== undefined) {
    ops.push(...replaceStepOutputUseOps(db, recipeId, step.data.stepNum, input.fields.outputStepNums));
  }

  if (ops.length > 0) {
    ops.push(touchRecipeOp(db, recipeId));
    await db.$transaction(ops);
  }

  return success({ recipeId, stepId, updated });
}

export async function deleteNativeRecipeStep(
  db: Database,
  chefId: string,
  recipeId: string,
  stepId: string,
  options: NativeRecipeStepDeleteOptions = {},
): Promise<ApiV1RecipeStepResult<{ recipeId: string; step: { id: string; stepNum: number } }>> {
  return withRaceRetry(options.d1, () => deleteNativeRecipeStepOnce(db, chefId, recipeId, stepId, options));
}

async function deleteNativeRecipeStepOnce(
  db: Database,
  chefId: string,
  recipeId: string,
  stepId: string,
  options: NativeRecipeStepDeleteOptions,
): Promise<ApiV1RecipeStepResult<{ recipeId: string; step: { id: string; stepNum: number } }>> {
  const recipe = await loadOwnedRecipe(db, chefId, recipeId);
  if (!recipe.ok) return recipe;

  const step = await loadStepForRecipe(db, recipeId, stepId);
  if (!step.ok) return step;

  const dependentSteps = await checkStepUsage(db, recipeId, step.data.stepNum);
  if (dependentSteps.length > 0) {
    const validation = await validateStepDeletion(db, recipeId, step.data.stepNum);
    const message = validation.valid ? "Cannot delete step because it is used by another step" : validation.error;
    return failure("validation_error", message, {
      reason: "step_output_dependency",
      dependentStepNums: dependentSteps.map((dependentStep) => dependentStep.inputStepNum).sort((a, b) => a - b),
    });
  }

  if (options.d1) {
    // One atomic batch: the tombstone, the step (its ingredients and output uses cascade) and
    // the recipe touch. The guards re-check that the step is where it was and still unused.
    const now = new Date();
    await d1WriteBatch(options.d1, [
      stepAtGuard(stepId, recipeId, step.data.stepNum),
      d1Guard(
        `NOT EXISTS (SELECT 1 FROM "StepOutputUse" WHERE "recipeId" = ? AND "outputStepNum" = ?)`,
        recipeId,
        step.data.stepNum,
      ),
      ...(options.tombstone
        ? [mutationTombstoneStatement({
          ...options.tombstone,
          resourceType: "recipe_step",
          resourceId: stepId,
          parentResourceId: recipeId,
          payload: { recipeId, stepNum: step.data.stepNum },
        }, now)]
        : []),
      stepDeleteStatement(stepId),
      recipeUpdateStatement(recipeId, {}, now),
    ]);
    return success({ recipeId, step: { id: stepId, stepNum: step.data.stepNum } });
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (options.tombstone) {
    ops.push(createMutationTombstoneOp(db, {
      ...options.tombstone,
      resourceType: "recipe_step",
      resourceId: stepId,
      parentResourceId: recipeId,
      payload: { recipeId, stepNum: step.data.stepNum },
    }));
  }
  ops.push(db.recipeStep.delete({ where: { id: stepId } }));
  ops.push(touchRecipeOp(db, recipeId));
  await db.$transaction(ops);

  return success({ recipeId, step: { id: stepId, stepNum: step.data.stepNum } });
}

export async function createNativeRecipeStepIngredient(
  db: Database,
  chefId: string,
  recipeId: string,
  stepId: string,
  input: NativeRecipeStepIngredientCreateInput,
  options: { ingredientId?: string; d1?: D1ReadDatabase | null } = {},
): Promise<ApiV1RecipeStepResult<{ recipeId: string; stepId: string; ingredientId: string }>> {
  return withRaceRetry(options.d1, () => createNativeRecipeStepIngredientOnce(db, chefId, recipeId, stepId, input, options));
}

async function createNativeRecipeStepIngredientOnce(
  db: Database,
  chefId: string,
  recipeId: string,
  stepId: string,
  input: NativeRecipeStepIngredientCreateInput,
  options: { ingredientId?: string; d1?: D1ReadDatabase | null },
): Promise<ApiV1RecipeStepResult<{ recipeId: string; stepId: string; ingredientId: string }>> {
  const recipe = await loadOwnedRecipe(db, chefId, recipeId);
  if (!recipe.ok) return recipe;

  const step = await loadStepForRecipe(db, recipeId, stepId);
  if (!step.ok) return step;

  const ingredientConflict = await assertNoRecipeIngredientConflicts<{ recipeId: string; stepId: string; ingredientId: string }>(
    db,
    recipeId,
    [input],
  );
  if (ingredientConflict) return ingredientConflict;

  const ingredientId = options.ingredientId ?? crypto.randomUUID();
  if (options.d1) {
    // One atomic batch: the ingredient (with its unit and ingredient ref) and the recipe touch.
    const now = new Date();
    await d1WriteBatch(options.d1, [
      stepAtGuard(stepId, recipeId, step.data.stepNum),
      noRecipeIngredientConflictsGuard(recipeId, [input]),
      ...namedIngredientStatements(recipeId, step.data.stepNum, [{ ...input, id: ingredientId }], now),
      recipeUpdateStatement(recipeId, {}, now),
    ]);
    return success({ recipeId, stepId, ingredientId }, 201);
  }
  await db.$transaction([
    createIngredientOp(db, recipeId, step.data.stepNum, input, ingredientId),
    touchRecipeOp(db, recipeId),
  ]);

  return success({ recipeId, stepId, ingredientId }, 201);
}

export async function deleteNativeRecipeStepIngredient(
  db: Database,
  chefId: string,
  recipeId: string,
  stepId: string,
  ingredientId: string,
  options: NativeRecipeStepIngredientDeleteOptions = {},
): Promise<ApiV1RecipeStepResult<{ recipeId: string; stepId: string; ingredient: { id: string } }>> {
  return withRaceRetry(options.d1, () => deleteNativeRecipeStepIngredientOnce(db, chefId, recipeId, stepId, ingredientId, options));
}

async function deleteNativeRecipeStepIngredientOnce(
  db: Database,
  chefId: string,
  recipeId: string,
  stepId: string,
  ingredientId: string,
  options: NativeRecipeStepIngredientDeleteOptions,
): Promise<ApiV1RecipeStepResult<{ recipeId: string; stepId: string; ingredient: { id: string } }>> {
  const recipe = await loadOwnedRecipe(db, chefId, recipeId);
  if (!recipe.ok) return recipe;

  const step = await loadStepForRecipe(db, recipeId, stepId);
  if (!step.ok) return step;

  const ingredient = await db.ingredient.findFirst({
    where: {
      id: ingredientId,
      recipeId,
      stepNum: step.data.stepNum,
    },
    select: { id: true },
  });
  if (!ingredient) {
    return failure("not_found", "Recipe step ingredient not found", { resource: "recipe_step_ingredient", ingredientId });
  }

  if (options.d1) {
    // One atomic batch: the tombstone, the ingredient and the recipe touch. The guard
    // re-checks that the ingredient is still on the step.
    const now = new Date();
    await d1WriteBatch(options.d1, [
      d1Guard(
        `EXISTS (SELECT 1 FROM "Ingredient" WHERE "id" = ? AND "recipeId" = ? AND "stepNum" = ?)`,
        ingredient.id,
        recipeId,
        step.data.stepNum,
      ),
      ...(options.tombstone
        ? [mutationTombstoneStatement({
          ...options.tombstone,
          resourceType: "recipe_step_ingredient",
          resourceId: ingredient.id,
          parentResourceId: stepId,
          payload: { recipeId, stepId, stepNum: step.data.stepNum },
        }, now)]
        : []),
      [`DELETE FROM "Ingredient" WHERE "id" = ?`, ingredient.id],
      recipeUpdateStatement(recipeId, {}, now),
    ]);
    return success({ recipeId, stepId, ingredient: { id: ingredient.id } });
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (options.tombstone) {
    ops.push(createMutationTombstoneOp(db, {
      ...options.tombstone,
      resourceType: "recipe_step_ingredient",
      resourceId: ingredient.id,
      parentResourceId: stepId,
      payload: { recipeId, stepId, stepNum: step.data.stepNum },
    }));
  }
  ops.push(db.ingredient.delete({ where: { id: ingredient.id } }));
  ops.push(touchRecipeOp(db, recipeId));
  await db.$transaction(ops);

  return success({ recipeId, stepId, ingredient: { id: ingredient.id } });
}

async function reorderBlockingStepNums(
  db: Database,
  recipeId: string,
  currentStepNum: number,
  toStepNum: number,
) {
  if (toStepNum > currentStepNum) {
    const dependents = await checkStepUsage(db, recipeId, currentStepNum);
    return dependents
      .filter((dependentStep) => dependentStep.inputStepNum <= toStepNum)
      .map((dependentStep) => dependentStep.inputStepNum)
      .sort((a, b) => a - b);
  }

  const dependencies = await db.stepOutputUse.findMany({
    where: { recipeId, inputStepNum: currentStepNum },
    select: { outputStepNum: true },
    orderBy: { outputStepNum: "asc" },
  });
  return dependencies
    .filter((dependency) => dependency.outputStepNum >= toStepNum)
    .map((dependency) => dependency.outputStepNum)
    .sort((a, b) => a - b);
}

export async function reorderNativeRecipeStep(
  db: Database,
  chefId: string,
  recipeId: string,
  input: NativeRecipeStepReorderInput,
  options: NativeRecipeStepReorderOptions = {},
): Promise<ApiV1RecipeStepResult<{ recipeId: string; stepId: string; reordered: boolean }>> {
  return withRaceRetry(options.d1, () => reorderNativeRecipeStepOnce(db, chefId, recipeId, input, options));
}

async function reorderNativeRecipeStepOnce(
  db: Database,
  chefId: string,
  recipeId: string,
  input: NativeRecipeStepReorderInput,
  options: NativeRecipeStepReorderOptions,
): Promise<ApiV1RecipeStepResult<{ recipeId: string; stepId: string; reordered: boolean }>> {
  const recipe = await loadOwnedRecipe(db, chefId, recipeId);
  if (!recipe.ok) return recipe;

  const step = await loadStepForRecipe(db, recipeId, input.stepId);
  if (!step.ok) return step;

  const steps = await db.recipeStep.findMany({
    where: { recipeId },
    select: { id: true, stepNum: true },
    orderBy: { stepNum: "asc" },
  });
  const currentIndex = steps.findIndex((candidate) => candidate.id === input.stepId);
  const targetIndex = input.toStepNum - 1;
  if (currentIndex === -1 || targetIndex < 0 || targetIndex >= steps.length) {
    return fieldFailure("toStepNum", "toStepNum must match an existing recipe step position");
  }

  const validation = await validateStepReorderComplete(db, recipeId, step.data.stepNum, input.toStepNum);
  if (!validation.valid) {
    return failure("validation_error", validation.error, {
      reason: "step_output_dependency",
      blockingStepNums: await reorderBlockingStepNums(db, recipeId, step.data.stepNum, input.toStepNum),
    });
  }

  if (currentIndex === targetIndex) {
    if (options.tombstone) {
      await db.$transaction([createMutationTombstoneOp(db, {
        ...options.tombstone,
        resourceType: "recipe_step_reorder",
        resourceId: input.stepId,
        parentResourceId: recipeId,
        payload: { recipeId, stepId: input.stepId, toStepNum: input.toStepNum, reordered: false },
      })]);
    }
    return success({ recipeId, stepId: input.stepId, reordered: false });
  }

  const reorderedSteps = [...steps];
  const [moved] = reorderedSteps.splice(currentIndex, 1);
  reorderedSteps.splice(targetIndex, 0, moved!);

  if (options.d1) {
    // One atomic batch: every step renumbered (through negative numbers, so no two steps
    // share a number at any point), the tombstone and the recipe touch. The guards re-check
    // that the recipe still has exactly the steps read above, at the same numbers, and that
    // no step output use the move would break was added after the dependency check.
    const now = new Date();
    await d1WriteBatch(options.d1, [
      d1Guard(
        `(SELECT COUNT(*) FROM "RecipeStep" WHERE "recipeId" = ?) = ?
         AND (SELECT COUNT(*) FROM "RecipeStep"
              WHERE "recipeId" = ? AND ("id" || ':' || "stepNum") IN (SELECT "value" FROM json_each(?))) = ?`,
        recipeId,
        steps.length,
        recipeId,
        JSON.stringify(steps.map((candidate) => `${candidate.id}:${candidate.stepNum}`)),
        steps.length,
      ),
      stepReorderDependencyFreeGuard(recipeId, step.data.stepNum, input.toStepNum),
      ...reorderedSteps.map((candidate, index) => stepNumUpdateStatement(candidate.id, -(index + 1), now)),
      ...reorderedSteps.map((candidate, index) => stepNumUpdateStatement(candidate.id, index + 1, now)),
      ...(options.tombstone
        ? [mutationTombstoneStatement({
          ...options.tombstone,
          resourceType: "recipe_step_reorder",
          resourceId: input.stepId,
          parentResourceId: recipeId,
          payload: { recipeId, stepId: input.stepId, toStepNum: input.toStepNum, reordered: true },
        }, now)]
        : []),
      recipeUpdateStatement(recipeId, {}, now),
    ]);
    return success({ recipeId, stepId: input.stepId, reordered: true });
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const [index, candidate] of reorderedSteps.entries()) {
    ops.push(
      db.recipeStep.update({
        where: { id: candidate.id },
        data: { stepNum: -(index + 1) },
      }),
    );
  }
  for (const [index, candidate] of reorderedSteps.entries()) {
    ops.push(
      db.recipeStep.update({
        where: { id: candidate.id },
        data: { stepNum: index + 1 },
      }),
    );
  }
  if (options.tombstone) {
    ops.push(createMutationTombstoneOp(db, {
      ...options.tombstone,
      resourceType: "recipe_step_reorder",
      resourceId: input.stepId,
      parentResourceId: recipeId,
      payload: { recipeId, stepId: input.stepId, toStepNum: input.toStepNum, reordered: true },
    }));
  }
  ops.push(touchRecipeOp(db, recipeId));
  await db.$transaction(ops);

  return success({ recipeId, stepId: input.stepId, reordered: true });
}

export async function replaceNativeRecipeStepOutputUses(
  db: Database,
  chefId: string,
  recipeId: string,
  input: NativeRecipeStepOutputUsesInput,
  options: { d1?: D1ReadDatabase | null } = {},
): Promise<ApiV1RecipeStepResult<{ recipeId: string; stepId: string; replaced: boolean }>> {
  return withRaceRetry(options.d1, () => replaceNativeRecipeStepOutputUsesOnce(db, chefId, recipeId, input, options));
}

async function replaceNativeRecipeStepOutputUsesOnce(
  db: Database,
  chefId: string,
  recipeId: string,
  input: NativeRecipeStepOutputUsesInput,
  options: { d1?: D1ReadDatabase | null },
): Promise<ApiV1RecipeStepResult<{ recipeId: string; stepId: string; replaced: boolean }>> {
  const recipe = await loadOwnedRecipe(db, chefId, recipeId);
  if (!recipe.ok) return recipe;

  const step = await loadStepForRecipe(db, recipeId, input.inputStepId);
  if (!step.ok) return step;

  const invalidRefs = await validateOutputStepRefs<{ recipeId: string; stepId: string; replaced: boolean }>(
    db,
    recipeId,
    step.data.stepNum,
    input.outputStepNums,
    "outputStepNums",
  );
  if (invalidRefs) return invalidRefs;

  const contentError = await validateStepWillHaveContent<{ recipeId: string; stepId: string; replaced: boolean }>(
    db,
    recipeId,
    step.data.stepNum,
    input.outputStepNums,
  );
  if (contentError) return contentError;

  if (options.d1) {
    // One atomic batch: the output uses replaced and the recipe touch. The guards re-check
    // that the step is where it was and will still have content.
    const now = new Date();
    await d1WriteBatch(options.d1, [
      stepAtGuard(input.inputStepId, recipeId, step.data.stepNum),
      ...stepWillHaveContentGuards(recipeId, step.data.stepNum, input.outputStepNums),
      stepOutputUsesDeleteStatement(recipeId, step.data.stepNum),
      ...stepOutputUseStatements(recipeId, step.data.stepNum, input.outputStepNums, now),
      recipeUpdateStatement(recipeId, {}, now),
    ]);
    return success({ recipeId, stepId: input.inputStepId, replaced: true });
  }

  await db.$transaction([
    ...replaceStepOutputUseOps(db, recipeId, step.data.stepNum, input.outputStepNums),
    touchRecipeOp(db, recipeId),
  ]);

  return success({ recipeId, stepId: input.inputStepId, replaced: true });
}
