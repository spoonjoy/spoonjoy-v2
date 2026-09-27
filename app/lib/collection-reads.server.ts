import type { PrismaClient } from "@prisma/client";
import { d1Count, d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";
import {
  COOKBOOK_COLUMNS,
  mapModel,
  RECIPE_COVER_COLUMNS,
  selectColumns,
  type ColumnSpec,
} from "~/lib/d1-models.server";
import {
  COOKBOOK_PREVIEW_RECIPES,
  cookbookPreviewQuery,
  cookbookPreviewsById,
  type CookbookPreviewEntry,
} from "~/lib/cookbook-previews.server";
import { getRecipeCoverDisplay } from "~/lib/recipe-cover.server";
import { searchSpoonjoy, searchSpoonjoyFromD1 } from "~/lib/search.server";

// Reads behind the recipe, saved-recipe and cookbook lists (`/recipes`, `/saved-recipes`,
// `/cookbooks`). Each page has the original Prisma reads, used where there is no D1
// binding (unit tests, scripts), and a D1 reader that returns the same result from one
// batch of raw statements.

// ---------------------------------------------------------------------------------------
// `/recipes`: public recipes from every kitchen, newest first, or the search results.

export interface PublicRecipe {
  id: string;
  title: string;
  description: string | null;
  servings: string | null;
  chef: { username: string };
  coverImageUrl: string | null;
  coverProvenanceLabel: string | null;
}

export interface PublicRecipesInput {
  query: string;
  limit: number;
}

type CoverDisplayRecipe = Parameters<typeof getRecipeCoverDisplay>[0];
type CoverList = Parameters<typeof getRecipeCoverDisplay>[1];

function toPublicRecipe(
  recipe: CoverDisplayRecipe & { title: string; description: string | null; servings: string | null; chef: { username: string } },
  covers: CoverList,
): PublicRecipe {
  const coverDisplay = getRecipeCoverDisplay(recipe, covers);
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    chef: recipe.chef,
    coverImageUrl: coverDisplay?.displayUrl ?? null,
    coverProvenanceLabel: coverDisplay?.provenanceLabel ?? null,
  };
}

// Search results keep the search's order.
function inSearchOrder<T extends { id: string }>(recipes: T[], recipeIds: string[]): T[] {
  const order = new Map(recipeIds.map((id, index) => [id, index]));
  return [...recipes].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

export async function readPublicRecipesWithPrisma(
  database: PrismaClient,
  { query, limit }: PublicRecipesInput,
): Promise<PublicRecipe[]> {
  const recipeIds = query
    ? (await searchSpoonjoy(database, { query, scope: "recipes", limit })).map((result) => result.id)
    : [];

  const recipes = await database.recipe.findMany({
    where: {
      deletedAt: null,
      ...(query ? { id: { in: recipeIds } } : {}),
    },
    include: {
      chef: { select: { username: true } },
      covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
    },
    orderBy: query ? undefined : { updatedAt: "desc" },
    take: limit,
  });

  return (query ? inSearchOrder(recipes, recipeIds) : recipes).map(({ covers, ...recipe }) =>
    toPublicRecipe(recipe, covers));
}

const PUBLIC_RECIPE_COLUMNS: ColumnSpec<{
  id: string;
  title: string;
  description: string | null;
  servings: string | null;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  coverMode: string;
  chefUsername: string;
}> = {
  id: "string",
  title: "string",
  description: "string?",
  servings: "string?",
  activeCoverId: "string?",
  activeCoverVariant: "string?",
  coverMode: "string",
  chefUsername: "string",
};

const PUBLIC_RECIPE_SELECT = `SELECT r."id", r."title", r."description", r."servings",
    r."activeCoverId", r."activeCoverVariant", r."coverMode", u."username" AS "chefUsername",
    ${selectColumns(RECIPE_COVER_COLUMNS, "rc", "cover_")}
  FROM "Recipe" r
  JOIN "User" u ON u."id" = r."chefId"
  LEFT JOIN "RecipeCover" rc ON rc."id" = r."activeCoverId" AND rc."recipeId" = r."id"`;

/**
 * `/recipes` on D1. Without a query: one batch. With a query: the search (its own batch),
 * then one statement for the matching recipes. Deleted recipes never appear.
 */
export async function readPublicRecipesFromD1(
  db: D1ReadDatabase,
  { query, limit }: PublicRecipesInput,
): Promise<PublicRecipe[]> {
  const recipeIds = query
    ? (await searchSpoonjoyFromD1(db, { query, scope: "recipes", limit })).map((result) => result.id)
    : [];
  if (query && recipeIds.length === 0) return [];

  const [rows] = await d1ReadBatch(db, [
    query
      ? [
          `${PUBLIC_RECIPE_SELECT} WHERE r."deletedAt" IS NULL AND r."id" IN (${recipeIds.map(() => "?").join(", ")}) LIMIT ?`,
          ...recipeIds,
          limit,
        ]
      : [`${PUBLIC_RECIPE_SELECT} WHERE r."deletedAt" IS NULL ORDER BY r."updatedAt" DESC LIMIT ?`, limit],
  ]);
  const recipes = rows!.map((row) => {
    const { chefUsername, ...recipe } = mapModel(PUBLIC_RECIPE_COLUMNS, row);
    // Display uses only the active cover, and the join requires it to belong to the recipe.
    const covers = row.cover_id === null ? [] : [mapModel(RECIPE_COVER_COLUMNS, row, "cover_")];
    return { ...recipe, chef: { username: chefUsername }, covers };
  });

  return (query ? inSearchOrder(recipes, recipeIds) : recipes).map(({ covers, ...recipe }) =>
    toPublicRecipe(recipe, covers));
}

// ---------------------------------------------------------------------------------------
// `/saved-recipes`: recipes (not deleted) in the signed-in user's cookbooks.

export interface SavedRecipe {
  id: string;
  title: string;
  description: string | null;
  servings: string | null;
  chef: { id: string; username: string };
  savedCookbookTitles: string[];
}

interface SavedMembership {
  recipeId: string;
  cookbook: { title: string };
  recipe: Omit<SavedRecipe, "savedCookbookTitles">;
}

// One entry per recipe, in the order of its most recently updated membership, listing
// every cookbook it is saved in.
function savedRecipesFrom(memberships: SavedMembership[]): SavedRecipe[] {
  const byRecipeId = new Map<string, SavedRecipe>();
  for (const membership of memberships) {
    const existing = byRecipeId.get(membership.recipeId);
    if (existing) {
      existing.savedCookbookTitles.push(membership.cookbook.title);
      continue;
    }

    byRecipeId.set(membership.recipeId, {
      id: membership.recipe.id,
      title: membership.recipe.title,
      description: membership.recipe.description,
      servings: membership.recipe.servings,
      chef: membership.recipe.chef,
      savedCookbookTitles: [membership.cookbook.title],
    });
  }
  return Array.from(byRecipeId.values());
}

export async function readSavedRecipesWithPrisma(database: PrismaClient, userId: string): Promise<SavedRecipe[]> {
  const memberships = await database.recipeInCookbook.findMany({
    where: {
      cookbook: { authorId: userId },
      recipe: { deletedAt: null },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    include: {
      cookbook: {
        select: { title: true },
      },
      recipe: {
        include: {
          chef: {
            select: { id: true, username: true },
          },
        },
      },
    },
  });
  return savedRecipesFrom(memberships);
}

const SAVED_MEMBERSHIP_COLUMNS: ColumnSpec<{
  recipeId: string;
  cookbookTitle: string;
  title: string;
  description: string | null;
  servings: string | null;
  chefId: string;
  chefUsername: string;
}> = {
  recipeId: "string",
  cookbookTitle: "string",
  title: "string",
  description: "string?",
  servings: "string?",
  chefId: "string",
  chefUsername: "string",
};

/** `/saved-recipes` on D1: one statement, filtered by the signed-in user's cookbooks. */
export async function readSavedRecipesFromD1(db: D1ReadDatabase, userId: string): Promise<SavedRecipe[]> {
  const [rows] = await d1ReadBatch(db, [
    [
      `SELECT ric."recipeId", c."title" AS "cookbookTitle", r."title", r."description", r."servings",
         u."id" AS "chefId", u."username" AS "chefUsername"
       FROM "RecipeInCookbook" ric
       JOIN "Cookbook" c ON c."id" = ric."cookbookId"
       JOIN "Recipe" r ON r."id" = ric."recipeId"
       JOIN "User" u ON u."id" = r."chefId"
       WHERE c."authorId" = ? AND r."deletedAt" IS NULL
       ORDER BY ric."updatedAt" DESC, ric."id" DESC`,
      userId,
    ],
  ]);
  return savedRecipesFrom(rows!.map((row) => {
    const membership = mapModel(SAVED_MEMBERSHIP_COLUMNS, row);
    return {
      recipeId: membership.recipeId,
      cookbook: { title: membership.cookbookTitle },
      recipe: {
        id: membership.recipeId,
        title: membership.title,
        description: membership.description,
        servings: membership.servings,
        chef: { id: membership.chefId, username: membership.chefUsername },
      },
    };
  }));
}

// ---------------------------------------------------------------------------------------
// `/cookbooks`: the signed-in user's cookbooks, each with its newest recipes (not
// deleted) and the titles its search matches against.

export interface CookbookListItem {
  id: string;
  title: string;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
  _count: { recipes: number };
  searchableRecipeTitles: string[];
  recipes: Array<{
    id: string;
    cookbookId: string;
    recipeId: string;
    addedById: string;
    createdAt: Date;
    updatedAt: Date;
    recipe: { id: string; title: string; coverImageUrl: string | null; coverProvenanceLabel: string | null };
  }>;
}

function toCookbookListItem(
  cookbook: Omit<CookbookListItem, "recipes" | "searchableRecipeTitles">,
  previews: CookbookPreviewEntry[],
  searchableRecipeTitles: string[],
): CookbookListItem {
  return {
    ...cookbook,
    searchableRecipeTitles,
    recipes: previews.map(({ recipe, ...entry }) => {
      const coverDisplay = getRecipeCoverDisplay(recipe, recipe.covers);
      return {
        ...entry,
        recipe: {
          id: recipe.id,
          title: recipe.title,
          coverImageUrl: coverDisplay?.displayUrl ?? null,
          coverProvenanceLabel: coverDisplay?.provenanceLabel ?? null,
        },
      };
    }),
  };
}

export async function readCookbookListWithPrisma(database: PrismaClient, userId: string): Promise<CookbookListItem[]> {
  const cookbooks = await database.cookbook.findMany({
    where: { authorId: userId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    include: {
      _count: { select: { recipes: true } },
      recipes: {
        take: COOKBOOK_PREVIEW_RECIPES,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        where: {
          recipe: { deletedAt: null },
        },
        include: {
          recipe: {
            select: {
              id: true,
              title: true,
              activeCoverId: true,
              activeCoverVariant: true,
              coverMode: true,
              covers: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              },
            },
          },
        },
      },
    },
  });
  const titlesByCookbookId = new Map<string, string[]>();

  if (cookbooks.length > 0) {
    const recipeTitleRows = await database.recipeInCookbook.findMany({
      where: {
        cookbookId: { in: cookbooks.map((cookbook) => cookbook.id) },
        recipe: { deletedAt: null },
      },
      // Only the page's search reads these titles; a fixed order keeps both readers equal.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        cookbookId: true,
        recipe: {
          select: { title: true },
        },
      },
    });

    for (const row of recipeTitleRows) {
      const titles = titlesByCookbookId.get(row.cookbookId) ?? [];
      titles.push(row.recipe.title);
      titlesByCookbookId.set(row.cookbookId, titles);
    }
  }

  return cookbooks.map(({ recipes, ...cookbook }) =>
    toCookbookListItem(cookbook, recipes, titlesByCookbookId.get(cookbook.id) ?? []));
}

const RECIPE_TITLE_COLUMNS: ColumnSpec<{ cookbookId: string; title: string }> = {
  cookbookId: "string",
  title: "string",
};

/**
 * `/cookbooks` on D1: one batch of three statements, all filtered by the signed-in
 * user's cookbooks. As before, a card's count includes entries whose recipe was deleted,
 * while its preview and search titles skip them.
 */
export async function readCookbookListFromD1(db: D1ReadDatabase, userId: string): Promise<CookbookListItem[]> {
  const userCookbookIds = `SELECT "id" FROM "Cookbook" WHERE "authorId" = ?`;
  const [cookbookRows, previewRows, titleRows] = await d1ReadBatch(db, [
    [
      `SELECT ${selectColumns(COOKBOOK_COLUMNS, "c")},
         (SELECT COUNT(*) FROM "RecipeInCookbook" ric WHERE ric."cookbookId" = c."id") AS "recipeCount"
       FROM "Cookbook" c
       WHERE c."authorId" = ?
       ORDER BY c."updatedAt" DESC, c."id" DESC`,
      userId,
    ],
    cookbookPreviewQuery(userCookbookIds, userId),
    [
      `SELECT ric."cookbookId", r."title"
       FROM "RecipeInCookbook" ric
       JOIN "Recipe" r ON r."id" = ric."recipeId" AND r."deletedAt" IS NULL
       WHERE ric."cookbookId" IN (${userCookbookIds})
       ORDER BY ric."createdAt" ASC, ric."id" ASC`,
      userId,
    ],
  ]);

  const previews = cookbookPreviewsById(previewRows!);
  const titlesByCookbookId = new Map<string, string[]>();
  for (const row of titleRows!) {
    const { cookbookId, title } = mapModel(RECIPE_TITLE_COLUMNS, row);
    const titles = titlesByCookbookId.get(cookbookId) ?? [];
    titles.push(title);
    titlesByCookbookId.set(cookbookId, titles);
  }

  return cookbookRows!.map((row) => {
    const cookbook = mapModel(COOKBOOK_COLUMNS, row);
    return toCookbookListItem(
      { ...cookbook, _count: { recipes: d1Count(row.recipeCount, "recipeCount") } },
      previews.get(cookbook.id) ?? [],
      titlesByCookbookId.get(cookbook.id) ?? [],
    );
  });
}
