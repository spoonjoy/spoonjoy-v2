import type { PrismaClient as PrismaClientType } from "@prisma/client";
import type { ApiV1ErrorCode } from "~/lib/api-v1-contract.server";
import {
  createRecipeDraft,
  type RecipeStepDraft,
} from "~/lib/recipe-create.server";
import {
  forkRecipe,
  ForkSourceNotFoundError,
  ForkTitleExhaustedError,
} from "~/lib/recipe-fork.server";
import { validateActiveRecipeTitleUnique } from "~/lib/recipe-title-uniqueness.server";
import {
  validateDescription,
  validateIngredientName,
  validateQuantity,
  validateServings,
  validateStepDescription,
  validateStepTitle,
  validateTitle,
  validateUnitName,
} from "~/lib/validation";

type Database = PrismaClientType;
type MutableRecipeFields = {
  title?: string;
  description?: string | null;
  servings?: string | null;
};

export type ApiV1RecipeWriteResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; code: ApiV1ErrorCode; message: string; details?: unknown };

export interface NativeRecipeCreateInput {
  clientMutationId: string;
  title: string;
  description: string | null;
  servings: string | null;
  steps: RecipeStepDraft[];
}

export interface NativeRecipePatchInput {
  clientMutationId: string;
  fields: MutableRecipeFields;
}

export interface NativeRecipeDeleteInput {
  clientMutationId: string;
}

export interface NativeRecipeForkInput {
  clientMutationId: string;
  titleOverride: string | null;
}

function success<T>(data: T, status = 200): ApiV1RecipeWriteResult<T> {
  return { ok: true, status, data };
}

function failure<T>(
  code: ApiV1ErrorCode,
  message: string,
  details?: unknown,
): ApiV1RecipeWriteResult<T> {
  return { ok: false, code, message, details };
}

function fieldFailure<T>(field: string, message: string): ApiV1RecipeWriteResult<T> {
  return failure("validation_error", "Invalid recipe fields", { fieldErrors: { [field]: message } });
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
): ApiV1RecipeWriteResult<T> | null {
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
): ApiV1RecipeWriteResult<string> {
  if (typeof value !== "string") {
    return fieldFailure(field, `${field} must be a string`);
  }
  const validation = validate(value);
  if (!validation.valid) return fieldFailure(field, validation.error);
  return success(value.trim());
}

function optionalText(
  value: unknown,
  field: string,
  validate: (value: string | null) => { valid: true } | { valid: false; error: string },
): ApiV1RecipeWriteResult<string | null> {
  if (value === undefined || value === null) return success(null);
  if (typeof value !== "string") {
    return fieldFailure(field, `${field} must be a string or null`);
  }
  const trimmed = value.trim();
  const normalized = trimmed === "" ? null : trimmed;
  const validation = validate(normalized);
  if (!validation.valid) return fieldFailure(field, validation.error);
  return success(normalized);
}

function optionalPatchText(
  body: Record<string, unknown>,
  field: string,
  validate: (value: string | null) => { valid: true } | { valid: false; error: string },
): ApiV1RecipeWriteResult<string | null | undefined> {
  if (!hasOwn(body, field)) return success(undefined);
  return optionalText(body[field], field, validate);
}

function parseDuration(value: unknown, field: string): ApiV1RecipeWriteResult<number | null> {
  if (value === undefined || value === null || value === "") return success(null);
  const duration = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(duration) || duration <= 0) {
    return fieldFailure(field, "Duration must be a positive whole number");
  }
  return success(duration);
}

function parseQuantity(value: unknown, field: string): ApiV1RecipeWriteResult<number> {
  const quantity = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  const validation = validateQuantity(quantity);
  if (!validation.valid) return fieldFailure(field, validation.error);
  return success(quantity);
}

function parseIngredient(value: unknown, stepIndex: number, ingredientIndex: number): ApiV1RecipeWriteResult<RecipeStepDraft["ingredients"][number]> {
  const fieldPrefix = `steps.${stepIndex}.ingredients.${ingredientIndex}`;
  if (!isRecord(value)) {
    return fieldFailure(fieldPrefix, "Ingredient must be an object");
  }
  const unknown = assertKnownFields<RecipeStepDraft["ingredients"][number]>(value, ["quantity", "unit", "name"]);
  if (unknown) return unknown;

  const quantity = parseQuantity(value.quantity, `${fieldPrefix}.quantity`);
  if (!quantity.ok) return quantity;

  const unit = requiredText(value.unit, `${fieldPrefix}.unit`, validateUnitName);
  if (!unit.ok) return unit;

  const name = requiredText(value.name, `${fieldPrefix}.name`, validateIngredientName);
  if (!name.ok) return name;

  return success({
    quantity: quantity.data,
    unit: unit.data,
    ingredientName: name.data,
  });
}

function parseIngredients(value: unknown, stepIndex: number): ApiV1RecipeWriteResult<RecipeStepDraft["ingredients"]> {
  if (value === undefined || value === null) return success([]);
  if (!Array.isArray(value)) {
    return fieldFailure(`steps.${stepIndex}.ingredients`, "Ingredients must be an array");
  }

  const ingredients: RecipeStepDraft["ingredients"] = [];
  for (const [ingredientIndex, ingredient] of value.entries()) {
    const parsed = parseIngredient(ingredient, stepIndex, ingredientIndex);
    if (!parsed.ok) return parsed;
    ingredients.push(parsed.data);
  }
  return success(ingredients);
}

function parseStep(value: unknown, stepIndex: number): ApiV1RecipeWriteResult<RecipeStepDraft> {
  const fieldPrefix = `steps.${stepIndex}`;
  if (!isRecord(value)) {
    return fieldFailure(fieldPrefix, "Step must be an object");
  }
  const unknown = assertKnownFields<RecipeStepDraft>(value, ["stepTitle", "description", "duration", "ingredients"]);
  if (unknown) return unknown;

  const stepTitle = optionalText(value.stepTitle, `${fieldPrefix}.stepTitle`, validateStepTitle);
  if (!stepTitle.ok) return stepTitle;

  const description = requiredText(value.description, `${fieldPrefix}.description`, validateStepDescription);
  if (!description.ok) return description;

  const duration = parseDuration(value.duration, `${fieldPrefix}.duration`);
  if (!duration.ok) return duration;

  const ingredients = parseIngredients(value.ingredients, stepIndex);
  if (!ingredients.ok) return ingredients;

  return success({
    stepTitle: stepTitle.data,
    description: description.data,
    duration: duration.data,
    ingredients: ingredients.data,
  });
}

function parseSteps(value: unknown): ApiV1RecipeWriteResult<RecipeStepDraft[]> {
  if (value === undefined || value === null) return success([]);
  if (!Array.isArray(value)) {
    return fieldFailure("steps", "Steps must be an array");
  }

  const steps: RecipeStepDraft[] = [];
  for (const [stepIndex, step] of value.entries()) {
    const parsed = parseStep(step, stepIndex);
    if (!parsed.ok) return parsed;
    steps.push(parsed.data);
  }
  return success(steps);
}

function clientMutationIdFrom(value: unknown): ApiV1RecipeWriteResult<string> {
  return requiredText(value, "clientMutationId", (candidate) => (
    candidate.trim() ? { valid: true } : { valid: false, error: "clientMutationId must be a nonblank string" }
  ));
}

export function parseNativeRecipeCreateBody(body: Record<string, unknown>): ApiV1RecipeWriteResult<NativeRecipeCreateInput> {
  const unknown = assertKnownFields<NativeRecipeCreateInput>(body, ["clientMutationId", "title", "description", "servings", "steps"]);
  if (unknown) return unknown;

  const clientMutationId = clientMutationIdFrom(body.clientMutationId);
  if (!clientMutationId.ok) return clientMutationId;

  const title = requiredText(body.title, "title", validateTitle);
  if (!title.ok) return title;

  const description = optionalText(body.description, "description", validateDescription);
  if (!description.ok) return description;

  const servings = optionalText(body.servings, "servings", validateServings);
  if (!servings.ok) return servings;

  const steps = parseSteps(body.steps);
  if (!steps.ok) return steps;

  return success({
    clientMutationId: clientMutationId.data,
    title: title.data,
    description: description.data,
    servings: servings.data,
    steps: steps.data,
  });
}

export function parseNativeRecipePatchBody(body: Record<string, unknown>): ApiV1RecipeWriteResult<NativeRecipePatchInput> {
  const unknown = assertKnownFields<NativeRecipePatchInput>(body, ["clientMutationId", "title", "description", "servings"]);
  if (unknown) return unknown;

  const clientMutationId = clientMutationIdFrom(body.clientMutationId);
  if (!clientMutationId.ok) return clientMutationId;

  const fields: MutableRecipeFields = {};
  if (hasOwn(body, "title")) {
    const title = requiredText(body.title, "title", validateTitle);
    if (!title.ok) return title;
    fields.title = title.data;
  }

  const description = optionalPatchText(body, "description", validateDescription);
  if (!description.ok) return description;
  if (description.data !== undefined) fields.description = description.data;

  const servings = optionalPatchText(body, "servings", validateServings);
  if (!servings.ok) return servings;
  if (servings.data !== undefined) fields.servings = servings.data;

  return success({ clientMutationId: clientMutationId.data, fields });
}

export function parseNativeRecipeDeleteBody(
  body: Record<string, unknown>,
  fallbackClientMutationId: unknown,
): ApiV1RecipeWriteResult<NativeRecipeDeleteInput> {
  const unknown = assertKnownFields<NativeRecipeDeleteInput>(body, ["clientMutationId"]);
  if (unknown) return unknown;
  const clientMutationId = clientMutationIdFrom(body.clientMutationId ?? fallbackClientMutationId);
  if (!clientMutationId.ok) return clientMutationId;
  return success({ clientMutationId: clientMutationId.data });
}

export function parseNativeRecipeForkBody(body: Record<string, unknown>): ApiV1RecipeWriteResult<NativeRecipeForkInput> {
  const unknown = assertKnownFields<NativeRecipeForkInput>(body, ["clientMutationId", "title"]);
  if (unknown) return unknown;

  const clientMutationId = clientMutationIdFrom(body.clientMutationId);
  if (!clientMutationId.ok) return clientMutationId;

  const title = optionalPatchText(body, "title", (value) => (
    value === null ? { valid: true } : validateTitle(value)
  ));
  if (!title.ok) return title;

  return success({
    clientMutationId: clientMutationId.data,
    titleOverride: title.data ?? null,
  });
}

export async function createNativeRecipe(
  db: Database,
  chefId: string,
  input: NativeRecipeCreateInput,
  options: { recipeId?: string } = {},
): Promise<ApiV1RecipeWriteResult<{ recipeId: string }>> {
  const uniqueTitle = await validateActiveRecipeTitleUnique(db, {
    chefId,
    title: input.title,
  });
  if (!uniqueTitle.valid) {
    return fieldFailure("title", uniqueTitle.error);
  }

  const recipe = await createRecipeDraft(db, {
    id: options.recipeId ?? crypto.randomUUID(),
    title: input.title,
    description: input.description,
    servings: input.servings,
    chefId,
    steps: input.steps,
  });

  return success({ recipeId: recipe.id }, 201);
}

export async function updateNativeRecipe(
  db: Database,
  chefId: string,
  recipeId: string,
  input: NativeRecipePatchInput,
): Promise<ApiV1RecipeWriteResult<{ recipeId: string; updated: boolean }>> {
  const existing = await db.recipe.findUnique({
    where: { id: recipeId },
    select: { id: true, chefId: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) {
    return failure("not_found", "Recipe not found");
  }
  if (existing.chefId !== chefId) {
    return failure("insufficient_scope", "Recipe does not belong to the authenticated chef");
  }

  if (input.fields.title !== undefined) {
    const uniqueTitle = await validateActiveRecipeTitleUnique(db, {
      chefId,
      title: input.fields.title,
      excludeRecipeId: recipeId,
    });
    if (!uniqueTitle.valid) {
      return fieldFailure("title", uniqueTitle.error);
    }
  }

  const updated = Object.keys(input.fields).length > 0;
  if (updated) {
    await db.recipe.update({
      where: { id: recipeId },
      data: input.fields,
    });
  }

  return success({ recipeId, updated });
}

export async function deleteNativeRecipe(
  db: Database,
  chefId: string,
  recipeId: string,
): Promise<ApiV1RecipeWriteResult<{ recipe: { id: string; deletedAt: Date; updatedAt: Date } }>> {
  const existing = await db.recipe.findUnique({
    where: { id: recipeId },
    select: { id: true, chefId: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) {
    return failure("not_found", "Recipe not found");
  }
  if (existing.chefId !== chefId) {
    return failure("insufficient_scope", "Recipe does not belong to the authenticated chef");
  }

  const recipe = await db.recipe.update({
    where: { id: recipeId },
    data: { deletedAt: new Date() },
    select: { id: true, deletedAt: true, updatedAt: true },
  });

  return success({ recipe: { id: recipe.id, deletedAt: recipe.deletedAt!, updatedAt: recipe.updatedAt } });
}

export async function forkNativeRecipe(
  db: Database,
  chefId: string,
  sourceRecipeId: string,
  input: NativeRecipeForkInput,
  options: { recipeId?: string } = {},
): Promise<ApiV1RecipeWriteResult<{
  recipeId: string;
  fork: {
    appliedTitle: string;
    sourceChef: { id: string; username: string };
    sourceRecipeId: string;
    titleWasSuffixed: boolean;
  };
}>> {
  try {
    const result = await forkRecipe(db, {
      sourceRecipeId,
      viewerId: chefId,
      titleOverride: input.titleOverride,
      recipeId: options.recipeId,
    });

    return success({
      recipeId: result.recipe.id,
      fork: {
        appliedTitle: result.appliedTitle,
        sourceChef: result.attribution.sourceChef,
        sourceRecipeId: result.attribution.sourceRecipeId,
        titleWasSuffixed: result.titleWasSuffixed,
      },
    }, 201);
  } catch (error) {
    if (error instanceof ForkSourceNotFoundError) {
      return failure("not_found", "Source recipe not found");
    }
    if (error instanceof ForkTitleExhaustedError) {
      return failure("validation_error", "Could not resolve a unique title for the fork");
    }
    throw error;
  }
}
