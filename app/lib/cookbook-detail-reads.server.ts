import type { Cookbook, Prisma, PrismaClient, Recipe, RecipeCover, RecipeInCookbook } from "@prisma/client";
import { d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";
import {
  COOKBOOK_COLUMNS,
  mapModel,
  RECIPE_COVER_COLUMNS,
  RECIPE_IN_COOKBOOK_COLUMNS,
  selectColumns,
  type ColumnSpec,
} from "~/lib/d1-models.server";

// Reads behind a cookbook page (`/cookbooks/:id`). The Prisma reader is the fallback
// where there is no D1 binding (unit tests, scripts); the D1 reader returns the same
// data in one batch, where the page used to wait on the cookbook and then, for its
// owner, on a second query for the recipes that could still be added.

type EntryRecipe = Pick<
  Recipe,
  "id" | "title" | "description" | "servings" | "activeCoverId" | "activeCoverVariant" | "coverMode"
> & { covers: RecipeCover[]; chef: { username: string } };

export type CookbookDetail = Cookbook & {
  author: { id: string; username: string };
  recipes: Array<RecipeInCookbook & { recipe: EntryRecipe }>;
};

export interface CookbookDetailRows {
  cookbook: CookbookDetail | null;
  /** The viewer's own recipes not yet in the cookbook, by title; empty unless the viewer owns it. */
  availableRecipes: Array<{ id: string; title: string }>;
}

export interface CookbookDetailInput {
  cookbookId: string;
  viewerId: string | null;
}

export async function readCookbookDetailWithPrisma(
  database: PrismaClient,
  { cookbookId, viewerId }: CookbookDetailInput,
): Promise<CookbookDetailRows> {
  const cookbook = await database.cookbook.findUnique({
    where: { id: cookbookId },
    include: {
      author: { select: { id: true, username: true } },
      recipes: {
        where: { recipe: { deletedAt: null } },
        include: {
          recipe: {
            select: {
              id: true,
              title: true,
              description: true,
              servings: true,
              activeCoverId: true,
              activeCoverVariant: true,
              coverMode: true,
              covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
              chef: { select: { username: true } },
            },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  } satisfies Prisma.CookbookFindUniqueArgs);
  if (!cookbook) return { cookbook: null, availableRecipes: [] };

  const availableRecipes = viewerId !== null && cookbook.authorId === viewerId
    ? await database.recipe.findMany({
        where: { chefId: viewerId, deletedAt: null, NOT: { cookbooks: { some: { cookbookId } } } },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
      })
    : [];
  return { cookbook, availableRecipes };
}

const ENTRY_RECIPE_COLUMNS: ColumnSpec<Omit<EntryRecipe, "covers" | "chef">> = {
  id: "string",
  title: "string",
  description: "string?",
  servings: "string?",
  activeCoverId: "string?",
  activeCoverVariant: "string?",
  coverMode: "string",
};

const AUTHOR_COLUMNS: ColumnSpec<CookbookDetail["author"]> = { id: "string", username: "string" };
const CHEF_NAME_COLUMNS: ColumnSpec<EntryRecipe["chef"]> = { username: "string" };

const AVAILABLE_RECIPE_COLUMNS: ColumnSpec<{ id: string; title: string }> = { id: "string", title: "string" };

/**
 * The cookbook page as one D1 batch. Results match `readCookbookDetailWithPrisma`,
 * except that a recipe's `covers` holds only its active cover, which is the only one
 * the page displays (getRecipeCoverDisplay).
 */
export async function readCookbookDetailFromD1(
  db: D1ReadDatabase,
  { cookbookId, viewerId }: CookbookDetailInput,
): Promise<CookbookDetailRows> {
  const [cookbookRows, entryRows, availableRows] = await d1ReadBatch(db, [
    [
      `SELECT ${selectColumns(COOKBOOK_COLUMNS, "c")}, u."id" AS "author_id", u."username" AS "author_username"
       FROM "Cookbook" c JOIN "User" u ON u."id" = c."authorId"
       WHERE c."id" = ?`,
      cookbookId,
    ],
    [
      `SELECT ${selectColumns(RECIPE_IN_COOKBOOK_COLUMNS, "e")},
         ${selectColumns(ENTRY_RECIPE_COLUMNS, "r", "recipe_")},
         ${selectColumns(RECIPE_COVER_COLUMNS, "rc", "cover_")},
         chef."username" AS "chef_username"
       FROM "RecipeInCookbook" e
       JOIN "Recipe" r ON r."id" = e."recipeId" AND r."deletedAt" IS NULL
       JOIN "User" chef ON chef."id" = r."chefId"
       LEFT JOIN "RecipeCover" rc ON rc."id" = r."activeCoverId" AND rc."recipeId" = r."id"
       WHERE e."cookbookId" = ?
       ORDER BY e."createdAt" ASC, e."id" ASC`,
      cookbookId,
    ],
    // Only the cookbook's owner sees recipes to add, so the statement returns rows
    // only when the viewer is its author.
    [
      `SELECT ${selectColumns(AVAILABLE_RECIPE_COLUMNS, "r")}
       FROM "Recipe" r
       WHERE r."chefId" = ? AND r."deletedAt" IS NULL
         AND EXISTS (SELECT 1 FROM "Cookbook" c WHERE c."id" = ? AND c."authorId" = r."chefId")
         AND NOT EXISTS (SELECT 1 FROM "RecipeInCookbook" e WHERE e."cookbookId" = ? AND e."recipeId" = r."id")
       ORDER BY r."title" ASC`,
      viewerId,
      cookbookId,
      cookbookId,
    ],
  ]);

  const cookbookRow = cookbookRows[0];
  if (!cookbookRow) return { cookbook: null, availableRecipes: [] };

  return {
    cookbook: {
      ...mapModel(COOKBOOK_COLUMNS, cookbookRow),
      author: mapModel(AUTHOR_COLUMNS, cookbookRow, "author_"),
      recipes: entryRows.map((row) => ({
        ...mapModel(RECIPE_IN_COOKBOOK_COLUMNS, row),
        recipe: {
          ...mapModel(ENTRY_RECIPE_COLUMNS, row, "recipe_"),
          covers: row.cover_id === null ? [] : [mapModel(RECIPE_COVER_COLUMNS, row, "cover_")],
          chef: mapModel(CHEF_NAME_COLUMNS, row, "chef_"),
        },
      })),
    },
    availableRecipes: availableRows.map((row) => mapModel(AVAILABLE_RECIPE_COLUMNS, row)),
  };
}
