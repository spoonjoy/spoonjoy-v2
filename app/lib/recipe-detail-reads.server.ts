import type { Prisma, PrismaClient, RecipeCover } from "@prisma/client";
import { d1ReadBatch, groupRows, type D1Query, type D1ReadDatabase, type D1Row } from "~/lib/d1-read.server";
import {
  CHEF_CARD_COLUMNS,
  INGREDIENT_COLUMNS,
  INGREDIENT_REF_COLUMNS,
  mapModel,
  RECIPE_COLUMNS,
  RECIPE_COVER_COLUMNS,
  RECIPE_SPOON_COLUMNS,
  RECIPE_STEP_COLUMNS,
  selectColumns,
  STEP_OUTPUT_USE_COLUMNS,
  UNIT_COLUMNS,
  type ColumnSpec,
} from "~/lib/d1-models.server";
import { RECIPE_COVER_DISPLAY_SELECT } from "~/lib/recipe-cover.server";
import { isOriginCookCandidate, listSpoonsForRecipe, type SpoonWithChef } from "~/lib/recipe-spoon.server";

// Reads behind the recipe page (`/recipes/:id`). The Prisma reader is the original
// sequence of queries; the D1 reader returns the same data in one batch.

export const RECIPE_DETAIL_INCLUDE = {
  chef: { select: { id: true, username: true, photoUrl: true } },
  sourceRecipe: {
    select: {
      id: true,
      title: true,
      deletedAt: true,
      chef: { select: { username: true } },
    },
  },
  activeCover: { select: RECIPE_COVER_DISPLAY_SELECT },
  steps: {
    orderBy: { stepNum: "asc" },
    include: {
      ingredients: { include: { unit: true, ingredientRef: true } },
      usingSteps: {
        include: { outputOfStep: { select: { stepNum: true, stepTitle: true } } },
        orderBy: { outputStepNum: "asc" },
      },
    },
  },
} satisfies Prisma.RecipeInclude;

export type RecipeDetailRecipe = Prisma.RecipeGetPayload<{ include: typeof RECIPE_DETAIL_INCLUDE }>;

export interface RecipeSpoonImage {
  id: string;
  photoUrl: string | null;
  cookedAt: Date;
  chef: { id: string; username: string; photoUrl: string | null };
}

export interface RecipeDetailReads {
  // Null when the recipe does not exist or is deleted; nothing else is read then.
  recipe: RecipeDetailRecipe | null;
  // The viewer's cookbooks by title, each with the viewer's membership for this recipe.
  userCookbooks: Array<{ id: string; title: string; recipes: Array<{ id: string }> }>;
  // The viewer's shopping-list items (not deleted) for this recipe's ingredients.
  shoppingListItems: Array<{ ingredientRefId: string; unitId: string | null }>;
  spoons: SpoonWithChef[];
  isOriginCookCandidate: boolean;
  // Owner-only: every cover of the recipe, newest first.
  coverHistoryCovers: RecipeCover[];
  // Owner-only: spoons with photos, newest first.
  spoonImages: RecipeSpoonImage[];
}

export interface RecipeDetailReadInput {
  recipeId: string;
  userId: string | null;
}

const SPOON_LIST_LIMIT = 10;

const NO_READS: Omit<RecipeDetailReads, "recipe"> = {
  userCookbooks: [],
  shoppingListItems: [],
  spoons: [],
  isOriginCookCandidate: false,
  coverHistoryCovers: [],
  spoonImages: [],
};

export async function readRecipeDetailWithPrisma(
  database: PrismaClient,
  { recipeId, userId }: RecipeDetailReadInput,
): Promise<RecipeDetailReads> {
  const recipe = await database.recipe.findUnique({ where: { id: recipeId }, include: RECIPE_DETAIL_INCLUDE });
  if (!recipe || recipe.deletedAt) {
    return { recipe: null, ...NO_READS };
  }

  const isOwner = userId !== null && recipe.chefId === userId;
  const userCookbooks = userId
    ? await database.cookbook.findMany({
        where: { authorId: userId },
        select: { id: true, title: true, recipes: { where: { recipeId }, select: { id: true } } },
        orderBy: { title: "asc" },
      })
    : [];

  const recipeIngredientRefIds = Array.from(
    new Set(recipe.steps.flatMap((step) => step.ingredients.map((ingredient) => ingredient.ingredientRefId))),
  );
  const shoppingList = userId && recipeIngredientRefIds.length > 0
    ? await database.shoppingList.findUnique({
        where: { authorId: userId },
        select: {
          items: {
            where: { deletedAt: null, ingredientRefId: { in: recipeIngredientRefIds } },
            select: { ingredientRefId: true, unitId: true },
          },
        },
      })
    : null;

  const [spoons, originCookCandidate] = await Promise.all([
    listSpoonsForRecipe(database, recipeId, { limit: SPOON_LIST_LIMIT }),
    userId ? isOriginCookCandidate(database, userId, recipeId) : Promise.resolve(false),
  ]);
  const coverHistoryCovers = isOwner
    ? await database.recipeCover.findMany({
        where: { recipeId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    : [];
  const spoonImages = isOwner
    ? await database.recipeSpoon.findMany({
        where: { recipeId, deletedAt: null, photoUrl: { not: null } },
        select: {
          id: true,
          photoUrl: true,
          cookedAt: true,
          chef: { select: { id: true, username: true, photoUrl: true } },
        },
        orderBy: [{ cookedAt: "desc" }, { id: "desc" }],
      })
    : [];

  return {
    recipe,
    userCookbooks,
    shoppingListItems: shoppingList?.items ?? [],
    spoons,
    isOriginCookCandidate: originCookCandidate,
    coverHistoryCovers,
    spoonImages,
  };
}

function presentId(row: D1Row, prefix: string, what: string): boolean {
  const id = row[`${prefix}id`];
  if (id === null) return false;
  if (typeof id !== "string") throw new Error(`D1 ${what} id is not a string`);
  return true;
}

const SOURCE_RECIPE_COLUMNS: ColumnSpec<{ id: string; title: string; deletedAt: Date | null }> = {
  id: "string",
  title: "string",
  deletedAt: "dateTime?",
};

const SOURCE_CHEF_COLUMNS: ColumnSpec<{ username: string }> = { username: "string" };

const OUTPUT_STEP_COLUMNS: ColumnSpec<{ stepNum: number; stepTitle: string | null }> = {
  stepNum: "int",
  stepTitle: "string?",
};

const USER_COOKBOOK_COLUMNS: ColumnSpec<{ id: string; title: string; membershipId: string | null }> = {
  id: "string",
  title: "string",
  membershipId: "string?",
};

const SHOPPING_ITEM_COLUMNS: ColumnSpec<{ ingredientRefId: string; unitId: string | null }> = {
  ingredientRefId: "string",
  unitId: "string?",
};

const SPOON_IMAGE_COLUMNS: ColumnSpec<{ id: string; photoUrl: string | null; cookedAt: Date }> = {
  id: "string",
  photoUrl: "string?",
  cookedAt: "dateTime",
};

// Owner-only statements carry this guard, so they return rows only when the viewer owns
// the recipe (the same condition as the Prisma reader's isOwner).
const VIEWER_OWNS_RECIPE = `EXISTS (SELECT 1 FROM "Recipe" o WHERE o."id" = ? AND o."chefId" = ?)`;

// A statement that returns no rows, keeping batch positions stable when a read does not
// apply (a signed-out viewer).
const NO_ROWS: D1Query = [`SELECT NULL AS "id" WHERE 0`];

/**
 * The recipe page reads as one D1 batch. Results match `readRecipeDetailWithPrisma`:
 * viewer-scoped reads (cookbooks, shopping list, origin cook) are filtered by the
 * viewer's id, and owner-only reads (cover history, spoon images) return rows only when
 * the viewer owns the recipe.
 */
export async function readRecipeDetailFromD1(
  db: D1ReadDatabase,
  { recipeId, userId }: RecipeDetailReadInput,
): Promise<RecipeDetailReads> {
  const [
    recipeRows,
    stepRows,
    ingredientRows,
    usingStepRows,
    cookbookRows,
    shoppingRows,
    spoonRows,
    priorSpoonRows,
    coverRows,
    spoonImageRows,
  ] = await d1ReadBatch(db, [
    [
      `SELECT ${selectColumns(RECIPE_COLUMNS, "r")},
         ${selectColumns(CHEF_CARD_COLUMNS, "u", "chef_")},
         ${selectColumns(RECIPE_COVER_COLUMNS, "ac", "cover_")},
         ${selectColumns(SOURCE_RECIPE_COLUMNS, "s", "source_")},
         su."username" AS "source_chef_username"
       FROM "Recipe" r
       LEFT JOIN "User" u ON u."id" = r."chefId"
       LEFT JOIN "RecipeCover" ac ON ac."id" = r."activeCoverId"
       LEFT JOIN "Recipe" s ON s."id" = r."sourceRecipeId"
       LEFT JOIN "User" su ON su."id" = s."chefId"
       WHERE r."id" = ?
       LIMIT 1`,
      recipeId,
    ],
    [
      `SELECT ${selectColumns(RECIPE_STEP_COLUMNS, "st")} FROM "RecipeStep" st WHERE st."recipeId" = ? ORDER BY st."stepNum" ASC`,
      recipeId,
    ],
    [
      // Within a step, ingredients come back in the order Prisma returned them: the
      // (recipeId, stepNum) index order, which is insertion (rowid) order.
      `SELECT ${selectColumns(INGREDIENT_COLUMNS, "i")},
         ${selectColumns(UNIT_COLUMNS, "un", "unit_")},
         ${selectColumns(INGREDIENT_REF_COLUMNS, "ir", "ref_")}
       FROM "Ingredient" i
       JOIN "Unit" un ON un."id" = i."unitId"
       JOIN "IngredientRef" ir ON ir."id" = i."ingredientRefId"
       WHERE i."recipeId" = ?
       ORDER BY i."stepNum" ASC, i.rowid ASC`,
      recipeId,
    ],
    [
      `SELECT ${selectColumns(STEP_OUTPUT_USE_COLUMNS, "sou")},
         os."stepNum" AS "output_stepNum", os."stepTitle" AS "output_stepTitle"
       FROM "StepOutputUse" sou
       JOIN "RecipeStep" os ON os."recipeId" = sou."recipeId" AND os."stepNum" = sou."outputStepNum"
       WHERE sou."recipeId" = ?
       ORDER BY sou."outputStepNum" ASC`,
      recipeId,
    ],
    userId
      ? [
          `SELECT c."id", c."title", ric."id" AS "membershipId"
           FROM "Cookbook" c
           LEFT JOIN "RecipeInCookbook" ric ON ric."cookbookId" = c."id" AND ric."recipeId" = ?
           WHERE c."authorId" = ?
           ORDER BY c."title" ASC`,
          recipeId,
          userId,
        ]
      : NO_ROWS,
    userId
      ? [
          `SELECT sli."ingredientRefId", sli."unitId"
           FROM "ShoppingListItem" sli
           JOIN "ShoppingList" sl ON sl."id" = sli."shoppingListId"
           WHERE sl."authorId" = ?
             AND sli."deletedAt" IS NULL
             AND sli."ingredientRefId" IN (SELECT "ingredientRefId" FROM "Ingredient" WHERE "recipeId" = ?)`,
          userId,
          recipeId,
        ]
      : NO_ROWS,
    [
      `SELECT ${selectColumns(RECIPE_SPOON_COLUMNS, "sp")}, ${selectColumns(CHEF_CARD_COLUMNS, "u", "chef_")}
       FROM "RecipeSpoon" sp
       JOIN "User" u ON u."id" = sp."chefId"
       WHERE sp."recipeId" = ? AND sp."deletedAt" IS NULL
       ORDER BY sp."cookedAt" DESC, sp."id" DESC
       LIMIT ${SPOON_LIST_LIMIT}`,
      recipeId,
    ],
    userId
      ? [
          `SELECT EXISTS (
             SELECT 1 FROM "RecipeSpoon" WHERE "chefId" = ? AND "recipeId" = ? AND "deletedAt" IS NULL
           ) AS "hasSpoon"`,
          userId,
          recipeId,
        ]
      : NO_ROWS,
    userId
      ? [
          `SELECT ${selectColumns(RECIPE_COVER_COLUMNS, "rc")}
           FROM "RecipeCover" rc
           WHERE rc."recipeId" = ? AND ${VIEWER_OWNS_RECIPE}
           ORDER BY rc."createdAt" DESC, rc."id" DESC`,
          recipeId,
          recipeId,
          userId,
        ]
      : NO_ROWS,
    userId
      ? [
          `SELECT ${selectColumns(SPOON_IMAGE_COLUMNS, "sp")}, ${selectColumns(CHEF_CARD_COLUMNS, "u", "chef_")}
           FROM "RecipeSpoon" sp
           JOIN "User" u ON u."id" = sp."chefId"
           WHERE sp."recipeId" = ? AND sp."deletedAt" IS NULL AND sp."photoUrl" IS NOT NULL AND ${VIEWER_OWNS_RECIPE}
           ORDER BY sp."cookedAt" DESC, sp."id" DESC`,
          recipeId,
          recipeId,
          userId,
        ]
      : NO_ROWS,
  ]);

  const recipeRow = recipeRows[0];
  if (!recipeRow) {
    return { recipe: null, ...NO_READS };
  }
  const base = mapModel(RECIPE_COLUMNS, recipeRow);
  if (base.deletedAt) {
    return { recipe: null, ...NO_READS };
  }
  if (!presentId(recipeRow, "chef_", "recipe chef")) throw new Error("D1 recipe chef is missing");

  const ingredientsByStep = groupRows(ingredientRows, (row) => String(row.stepNum));
  const usingStepsByStep = groupRows(usingStepRows, (row) => String(row.inputStepNum));
  const recipe: RecipeDetailRecipe = {
    ...base,
    chef: mapModel(CHEF_CARD_COLUMNS, recipeRow, "chef_"),
    sourceRecipe: presentId(recipeRow, "source_", "source recipe")
      ? {
          ...mapModel(SOURCE_RECIPE_COLUMNS, recipeRow, "source_"),
          chef: mapModel(SOURCE_CHEF_COLUMNS, recipeRow, "source_chef_"),
        }
      : null,
    activeCover: presentId(recipeRow, "cover_", "active cover") ? mapModel(RECIPE_COVER_COLUMNS, recipeRow, "cover_") : null,
    steps: stepRows.map((row) => {
      const step = mapModel(RECIPE_STEP_COLUMNS, row);
      return {
        ...step,
        ingredients: (ingredientsByStep.get(String(step.stepNum)) ?? []).map((ingredientRow) => ({
          ...mapModel(INGREDIENT_COLUMNS, ingredientRow),
          unit: mapModel(UNIT_COLUMNS, ingredientRow, "unit_"),
          ingredientRef: mapModel(INGREDIENT_REF_COLUMNS, ingredientRow, "ref_"),
        })),
        usingSteps: (usingStepsByStep.get(String(step.stepNum)) ?? []).map((useRow) => ({
          ...mapModel(STEP_OUTPUT_USE_COLUMNS, useRow),
          outputOfStep: mapModel(OUTPUT_STEP_COLUMNS, useRow, "output_"),
        })),
      };
    }),
  };

  const isOwner = userId !== null && recipe.chefId === userId;
  const hasPriorSpoon = priorSpoonRows[0]?.hasSpoon;
  if (userId && hasPriorSpoon !== 0 && hasPriorSpoon !== 1) {
    throw new Error("D1 prior spoon check returned no answer");
  }

  return {
    recipe,
    userCookbooks: cookbookRows.map((row) => {
      const { id, title, membershipId } = mapModel(USER_COOKBOOK_COLUMNS, row);
      return { id, title, recipes: membershipId === null ? [] : [{ id: membershipId }] };
    }),
    shoppingListItems: shoppingRows.map((row) => mapModel(SHOPPING_ITEM_COLUMNS, row)),
    spoons: spoonRows.map((row) => ({
      ...mapModel(RECIPE_SPOON_COLUMNS, row),
      chef: mapModel(CHEF_CARD_COLUMNS, row, "chef_"),
    })),
    isOriginCookCandidate: isOwner && hasPriorSpoon === 0,
    coverHistoryCovers: isOwner ? coverRows.map((row) => mapModel(RECIPE_COVER_COLUMNS, row)) : [],
    spoonImages: isOwner
      ? spoonImageRows.map((row) => ({
          ...mapModel(SPOON_IMAGE_COLUMNS, row),
          chef: mapModel(CHEF_CARD_COLUMNS, row, "chef_"),
        }))
      : [],
  };
}
