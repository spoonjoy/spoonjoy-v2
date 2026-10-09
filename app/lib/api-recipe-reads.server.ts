import type { Prisma, PrismaClient } from "@prisma/client";
import { d1ReadBatch, groupRows, type D1ReadDatabase } from "~/lib/d1-read.server";
import { mapModel, RECIPE_COVER_COLUMNS, selectColumns, type ColumnSpec } from "~/lib/d1-models.server";
import { RECIPE_COVER_DISPLAY_SELECT } from "~/lib/recipe-cover.server";

// The recipe that `GET /api/v1/recipes/:id` returns (and that the API's write handlers
// echo back). Prisma resolves this nested select as one query per relation level, issued
// in sequence; the D1 reader returns the same rows in one batch. Rows that the API
// serializer orders itself (steps by number, ingredients by name, step uses by output
// step) come back in the order Prisma's queries return them: steps by number, other
// rows in table order.

export const API_RECIPE_SELECT = {
  id: true,
  title: true,
  description: true,
  servings: true,
  sourceUrl: true,
  activeCoverId: true,
  activeCoverVariant: true,
  coverMode: true,
  createdAt: true,
  updatedAt: true,
  chef: { select: { id: true, username: true } },
  sourceRecipe: {
    select: {
      id: true,
      title: true,
      deletedAt: true,
      chef: { select: { id: true, username: true } },
    },
  },
  activeCover: { select: RECIPE_COVER_DISPLAY_SELECT },
  steps: {
    select: {
      id: true,
      stepNum: true,
      stepTitle: true,
      description: true,
      duration: true,
      ingredients: {
        select: {
          id: true,
          quantity: true,
          ingredientRef: { select: { name: true } },
          unit: { select: { name: true } },
        },
      },
      usingSteps: {
        select: {
          id: true,
          inputStepNum: true,
          outputStepNum: true,
          outputOfStep: { select: { stepNum: true, stepTitle: true } },
        },
        orderBy: { outputStepNum: "asc" },
      },
    },
  },
  cookbooks: {
    select: { cookbook: { select: { id: true, title: true } } },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.RecipeSelect;

export type ApiRecipeRow = Prisma.RecipeGetPayload<{ select: typeof API_RECIPE_SELECT }>;

type ApiStep = ApiRecipeRow["steps"][number];
type ApiChef = ApiRecipeRow["chef"];

export async function loadApiRecipeWithPrisma(db: PrismaClient, id: string): Promise<ApiRecipeRow | null> {
  return db.recipe.findFirst({ where: { id, deletedAt: null }, select: API_RECIPE_SELECT });
}

const RECIPE_FIELDS: ColumnSpec<Omit<ApiRecipeRow, "chef" | "sourceRecipe" | "activeCover" | "steps" | "cookbooks">> = {
  id: "string",
  title: "string",
  description: "string?",
  servings: "string?",
  sourceUrl: "string?",
  activeCoverId: "string?",
  activeCoverVariant: "string?",
  coverMode: "string",
  createdAt: "dateTime",
  updatedAt: "dateTime",
};

const CHEF_FIELDS: ColumnSpec<ApiChef> = { id: "string", username: "string" };

const SOURCE_FIELDS: ColumnSpec<Omit<NonNullable<ApiRecipeRow["sourceRecipe"]>, "chef">> = {
  id: "string",
  title: "string",
  deletedAt: "dateTime?",
};

const STEP_FIELDS: ColumnSpec<Omit<ApiStep, "ingredients" | "usingSteps">> = {
  id: "string",
  stepNum: "int",
  stepTitle: "string?",
  description: "string",
  duration: "int?",
};

const INGREDIENT_FIELDS: ColumnSpec<{ id: string; stepNum: number; quantity: number; refName: string; unitName: string }> = {
  id: "string",
  stepNum: "int",
  quantity: "float",
  refName: "string",
  unitName: "string",
};

const STEP_USE_FIELDS: ColumnSpec<{
  id: string;
  inputStepNum: number;
  outputStepNum: number;
  outputStepTitle: string | null;
}> = {
  id: "string",
  inputStepNum: "int",
  outputStepNum: "int",
  outputStepTitle: "string?",
};

const COOKBOOK_FIELDS: ColumnSpec<{ id: string; title: string }> = { id: "string", title: "string" };

/** The API recipe as one D1 batch; the same value `loadApiRecipeWithPrisma` returns. */
export async function loadApiRecipeFromD1(db: D1ReadDatabase, id: string): Promise<ApiRecipeRow | null> {
  const [recipeRows, stepRows, ingredientRows, useRows, cookbookRows] = await d1ReadBatch(db, [
    [
      `SELECT ${selectColumns(RECIPE_FIELDS, "r")},
         ${selectColumns(CHEF_FIELDS, "chef", "chef_")},
         ${selectColumns(SOURCE_FIELDS, "src", "source_")},
         ${selectColumns(CHEF_FIELDS, "srcChef", "sourceChef_")},
         ${selectColumns(RECIPE_COVER_COLUMNS, "ac", "cover_")}
       FROM "Recipe" r
       JOIN "User" chef ON chef."id" = r."chefId"
       LEFT JOIN "Recipe" src ON src."id" = r."sourceRecipeId"
       LEFT JOIN "User" srcChef ON srcChef."id" = src."chefId"
       LEFT JOIN "RecipeCover" ac ON ac."id" = r."activeCoverId"
       WHERE r."id" = ? AND r."deletedAt" IS NULL`,
      id,
    ],
    [`SELECT ${selectColumns(STEP_FIELDS, "s")} FROM "RecipeStep" s WHERE s."recipeId" = ? ORDER BY s."stepNum"`, id],
    [
      `SELECT i."id" AS "id", i."stepNum" AS "stepNum", i."quantity" AS "quantity",
         ref."name" AS "refName", unit."name" AS "unitName"
       FROM "Ingredient" i
       JOIN "IngredientRef" ref ON ref."id" = i."ingredientRefId"
       JOIN "Unit" unit ON unit."id" = i."unitId"
       WHERE i."recipeId" = ?
       ORDER BY i."rowid"`,
      id,
    ],
    [
      `SELECT u."id" AS "id", u."inputStepNum" AS "inputStepNum", u."outputStepNum" AS "outputStepNum",
         os."stepTitle" AS "outputStepTitle"
       FROM "StepOutputUse" u
       JOIN "RecipeStep" os ON os."recipeId" = u."recipeId" AND os."stepNum" = u."outputStepNum"
       WHERE u."recipeId" = ?
       ORDER BY u."outputStepNum" ASC, u."rowid"`,
      id,
    ],
    [
      `SELECT ${selectColumns(COOKBOOK_FIELDS, "c")}
       FROM "RecipeInCookbook" e JOIN "Cookbook" c ON c."id" = e."cookbookId"
       WHERE e."recipeId" = ?
       ORDER BY e."createdAt" ASC, e."rowid"`,
      id,
    ],
  ]);

  const row = recipeRows[0];
  if (!row) return null;

  const ingredientsByStep = groupRows(ingredientRows.map((ingredient) => mapModel(INGREDIENT_FIELDS, ingredient)), (i) => String(i.stepNum));
  const usesByStep = groupRows(useRows.map((use) => mapModel(STEP_USE_FIELDS, use)), (use) => String(use.inputStepNum));

  return {
    ...mapModel(RECIPE_FIELDS, row),
    chef: mapModel(CHEF_FIELDS, row, "chef_"),
    sourceRecipe: row.source_id === null
      ? null
      : { ...mapModel(SOURCE_FIELDS, row, "source_"), chef: mapModel(CHEF_FIELDS, row, "sourceChef_") },
    activeCover: row.cover_id === null ? null : mapModel(RECIPE_COVER_COLUMNS, row, "cover_"),
    steps: stepRows.map((stepRow) => {
      const step = mapModel(STEP_FIELDS, stepRow);
      return {
        ...step,
        ingredients: (ingredientsByStep.get(String(step.stepNum)) ?? []).map(({ id: ingredientId, quantity, refName, unitName }) => ({
          id: ingredientId,
          quantity,
          ingredientRef: { name: refName },
          unit: { name: unitName },
        })),
        usingSteps: (usesByStep.get(String(step.stepNum)) ?? []).map(({ outputStepTitle, ...use }) => ({
          ...use,
          outputOfStep: { stepNum: use.outputStepNum, stepTitle: outputStepTitle },
        })),
      };
    }),
    cookbooks: cookbookRows.map((cookbookRow) => ({ cookbook: mapModel(COOKBOOK_FIELDS, cookbookRow) })),
  };
}
