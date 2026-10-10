import type {
  Cookbook,
  Ingredient,
  IngredientRef,
  Recipe,
  RecipeCover,
  RecipeInCookbook,
  RecipeSpoon,
  RecipeStep,
  StepOutputUse,
  Unit,
} from "@prisma/client";
import { d1Boolean, d1DateTime, d1NullableDateTime, type D1Row } from "~/lib/d1-read.server";

// Column specs for the models the raw D1 read paths return. Each spec lists a model's
// scalar columns in schema order with their Prisma type, so a raw row maps to exactly
// the object Prisma would have returned (dates as Date, nullable columns as null).
type ColumnKind = "string" | "string?" | "int" | "int?" | "float" | "float?" | "boolean" | "dateTime" | "dateTime?";
export type ColumnSpec<T> = { readonly [K in keyof T]: ColumnKind };

export const RECIPE_COLUMNS: ColumnSpec<Recipe> = {
  id: "string",
  title: "string",
  description: "string?",
  servings: "string?",
  chefId: "string",
  deletedAt: "dateTime?",
  activeCoverId: "string?",
  activeCoverVariant: "string?",
  coverMode: "string",
  sourceRecipeId: "string?",
  sourceUrl: "string?",
  createdAt: "dateTime",
  updatedAt: "dateTime",
};

export const RECIPE_COVER_COLUMNS: ColumnSpec<RecipeCover> = {
  id: "string",
  recipeId: "string",
  imageUrl: "string",
  stylizedImageUrl: "string?",
  sourceType: "string",
  sourceSpoonId: "string?",
  status: "string",
  createdById: "string?",
  sourceImageUrl: "string?",
  generationStatus: "string",
  generationStartedAt: "dateTime?",
  failureReason: "string?",
  promptVersion: "string?",
  styleVersion: "string?",
  promptAddition: "string?",
  parentCoverId: "string?",
  archivedAt: "dateTime?",
  createdAt: "dateTime",
};

export const RECIPE_STEP_COLUMNS: ColumnSpec<RecipeStep> = {
  id: "string",
  recipeId: "string",
  stepNum: "int",
  stepTitle: "string?",
  description: "string",
  duration: "int?",
  updatedAt: "dateTime",
};

export const INGREDIENT_COLUMNS: ColumnSpec<Ingredient> = {
  id: "string",
  recipeId: "string",
  stepNum: "int",
  quantity: "float",
  unitId: "string",
  ingredientRefId: "string",
  updatedAt: "dateTime",
};

export const UNIT_COLUMNS: ColumnSpec<Unit> = { id: "string", name: "string", updatedAt: "dateTime" };

export const INGREDIENT_REF_COLUMNS: ColumnSpec<IngredientRef> = { id: "string", name: "string", updatedAt: "dateTime" };

export const STEP_OUTPUT_USE_COLUMNS: ColumnSpec<StepOutputUse> = {
  id: "string",
  recipeId: "string",
  outputStepNum: "int",
  inputStepNum: "int",
  updatedAt: "dateTime",
};

export const COOKBOOK_COLUMNS: ColumnSpec<Cookbook> = {
  id: "string",
  title: "string",
  authorId: "string",
  createdAt: "dateTime",
  updatedAt: "dateTime",
};

export const RECIPE_IN_COOKBOOK_COLUMNS: ColumnSpec<RecipeInCookbook> = {
  id: "string",
  cookbookId: "string",
  recipeId: "string",
  addedById: "string",
  createdAt: "dateTime",
  updatedAt: "dateTime",
};

export const RECIPE_SPOON_COLUMNS: ColumnSpec<RecipeSpoon> = {
  id: "string",
  chefId: "string",
  recipeId: "string",
  cookedAt: "dateTime",
  photoUrl: "string?",
  note: "string?",
  nextTime: "string?",
  deletedAt: "dateTime?",
  createdAt: "dateTime",
  updatedAt: "dateTime",
};

/** The public identity shown next to a chef's content. */
export const CHEF_CARD_COLUMNS: ColumnSpec<{ id: string; username: string; photoUrl: string | null }> = {
  id: "string",
  username: "string",
  photoUrl: "string?",
};

/**
 * The SELECT list for a model's columns on a table alias, each aliased as
 * `<prefix><column>` so several models can share one row.
 */
export function selectColumns<T>(spec: ColumnSpec<T>, tableAlias: string, prefix = ""): string {
  return Object.keys(spec)
    .map((column) => `${tableAlias}."${column}" AS "${prefix}${column}"`)
    .join(", ");
}

function columnValue(kind: ColumnKind, value: unknown, column: string): unknown {
  const nullable = kind.endsWith("?");
  if (nullable && value === null) return null;
  switch (kind) {
    case "string":
    case "string?":
      if (typeof value === "string") return value;
      break;
    case "int":
    case "int?":
      if (typeof value === "number" && Number.isSafeInteger(value)) return value;
      break;
    case "float":
    case "float?":
      if (typeof value === "number" && Number.isFinite(value)) return value;
      break;
    case "boolean":
      return d1Boolean(value, column);
    case "dateTime":
      return d1DateTime(value, column);
    case "dateTime?":
      return d1NullableDateTime(value, column);
  }
  throw new Error(`D1 column ${column} does not hold a ${kind} value`);
}

/**
 * Maps the `<prefix><column>` values of a raw row to a model object, failing closed when
 * a column is missing or holds the wrong type.
 */
export function mapModel<T>(spec: ColumnSpec<T>, row: D1Row, prefix = ""): T {
  const model: Record<string, unknown> = {};
  for (const [column, kind] of Object.entries(spec) as Array<[string, ColumnKind]>) {
    model[column] = columnValue(kind, row[`${prefix}${column}`], `${prefix}${column}`);
  }
  return model as T;
}
