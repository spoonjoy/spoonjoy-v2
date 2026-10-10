import type { Cookbook, PrismaClient, Recipe, RecipeCover, RecipeInCookbook } from "@prisma/client";
import { d1ReadBatch, type D1ReadDatabase, type D1Row } from "~/lib/d1-read.server";
import {
  COOKBOOK_COLUMNS,
  mapModel,
  RECIPE_COVER_COLUMNS,
  RECIPE_IN_COOKBOOK_COLUMNS,
  selectColumns,
  type ColumnSpec,
} from "~/lib/d1-models.server";

// Reads behind a cookbook's page (`/cookbooks/:id`). The Prisma reader is the fallback
// where there is no D1 binding (unit tests, scripts); the D1 reader returns the same data
// in one batch. Before this, the page's nested Prisma read ran six queries one round trip
// at a time (seven for the owner) and loaded every cover in each recipe's history.

type CookbookPageRecipe = Pick<
  Recipe,
  "id" | "title" | "description" | "servings" | "activeCoverId" | "activeCoverVariant" | "coverMode"
> & {
  covers: RecipeCover[];
  chef: { username: string };
};

export type CookbookPageEntry = RecipeInCookbook & { recipe: CookbookPageRecipe };

export type CookbookPageCookbook = Cookbook & {
  author: { id: string; username: string };
  recipes: CookbookPageEntry[];
};

export interface CookbookPageRows {
  /** Null when no cookbook has this id. */
  cookbook: CookbookPageCookbook | null;
  /** For the cookbook's owner, their live recipes not in it, by title; empty for anyone else. */
  availableRecipes: Array<{ id: string; title: string }>;
}

export interface CookbookPageInput {
  cookbookId: string;
  /** The signed-in viewer, or null when signed out. */
  viewerId: string | null;
}

export async function readCookbookPageWithPrisma(
  database: PrismaClient,
  { cookbookId, viewerId }: CookbookPageInput,
): Promise<CookbookPageRows> {
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
  });
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

const AUTHOR_COLUMNS: ColumnSpec<CookbookPageCookbook["author"]> = { id: "string", username: "string" };

const PAGE_RECIPE_COLUMNS: ColumnSpec<Omit<CookbookPageRecipe, "covers" | "chef">> = {
  id: "string",
  title: "string",
  description: "string?",
  servings: "string?",
  activeCoverId: "string?",
  activeCoverVariant: "string?",
  coverMode: "string",
};

const CHEF_COLUMNS: ColumnSpec<CookbookPageRecipe["chef"]> = { username: "string" };

const AVAILABLE_RECIPE_COLUMNS: ColumnSpec<CookbookPageRows["availableRecipes"][number]> = { id: "string", title: "string" };

function mapEntry(row: D1Row): CookbookPageEntry {
  return {
    ...mapModel(RECIPE_IN_COOKBOOK_COLUMNS, row),
    recipe: {
      ...mapModel(PAGE_RECIPE_COLUMNS, row, "recipe_"),
      // Display only uses the active cover (getRecipeCoverDisplay finds the cover whose id
      // is activeCoverId and shows nothing when there is none), and the join requires the
      // cover to belong to the recipe, as the `covers` relation did.
      covers: row.cover_id === null ? [] : [mapModel(RECIPE_COVER_COLUMNS, row, "cover_")],
      chef: mapModel(CHEF_COLUMNS, row, "chef_"),
    },
  };
}

/**
 * The cookbook page as one D1 batch: the cookbook with its author, its entries for recipes
 * that are not deleted (oldest entry first) with each recipe's chef and active cover, and,
 * when the viewer owns the cookbook, the viewer's other live recipes. Results match
 * `readCookbookPageWithPrisma`, except that a recipe's `covers` holds only its active cover.
 */
export async function readCookbookPageFromD1(
  db: D1ReadDatabase,
  { cookbookId, viewerId }: CookbookPageInput,
): Promise<CookbookPageRows> {
  const [cookbookRows, entryRows, availableRows] = await d1ReadBatch(db, [
    [
      `SELECT ${selectColumns(COOKBOOK_COLUMNS, "c")}, ${selectColumns(AUTHOR_COLUMNS, "a", "author_")}
       FROM "Cookbook" c
       JOIN "User" a ON a."id" = c."authorId"
       WHERE c."id" = ?`,
      cookbookId,
    ],
    [
      `SELECT ${selectColumns(RECIPE_IN_COOKBOOK_COLUMNS, "e")},
         ${selectColumns(PAGE_RECIPE_COLUMNS, "r", "recipe_")},
         ${selectColumns(CHEF_COLUMNS, "u", "chef_")},
         ${selectColumns(RECIPE_COVER_COLUMNS, "rc", "cover_")}
       FROM "RecipeInCookbook" e
       JOIN "Recipe" r ON r."id" = e."recipeId" AND r."deletedAt" IS NULL
       JOIN "User" u ON u."id" = r."chefId"
       LEFT JOIN "RecipeCover" rc ON rc."id" = r."activeCoverId" AND rc."recipeId" = r."id"
       WHERE e."cookbookId" = ?
       ORDER BY e."createdAt" ASC, e."id" ASC`,
      cookbookId,
    ],
    // Only the cookbook's author gets recipes to add: a signed-out viewer binds NULL,
    // which matches no chef, and anyone else is not the cookbook's author.
    [
      `SELECT ${selectColumns(AVAILABLE_RECIPE_COLUMNS, "r")}
       FROM "Recipe" r
       WHERE r."chefId" = ?
         AND r."chefId" = (SELECT "authorId" FROM "Cookbook" WHERE "id" = ?)
         AND r."deletedAt" IS NULL
         AND NOT EXISTS (SELECT 1 FROM "RecipeInCookbook" ric WHERE ric."recipeId" = r."id" AND ric."cookbookId" = ?)
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
      recipes: entryRows.map(mapEntry),
    },
    availableRecipes: availableRows.map((row) => mapModel(AVAILABLE_RECIPE_COLUMNS, row)),
  };
}
