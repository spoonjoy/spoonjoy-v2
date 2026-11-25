// The recipes a smart cookbook fills with, as its page shows them: a page of the cook's matching recipes, newest
// first, each with its active cover as a regular cookbook's Contents shows it, and how many match in all. On the
// Worker it is one D1 batch; Prisma is the fallback where there is no binding (unit tests, scripts).
import type { PrismaClient } from "@prisma/client";
import { d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";
import { mapModel, RECIPE_COVER_COLUMNS, selectColumns, type ColumnSpec } from "~/lib/d1-models.server";
import { MY_RECIPES_PAGE_SIZE, organizerClauses, type OrganizerClauses } from "~/lib/my-recipes-search.server";
import { getRecipeCoverDisplay } from "~/lib/recipe-cover.server";
import type { OrganizerFilters } from "../model/organizer-filter";

export type SmartCookbookRecipe = {
  id: string;
  title: string;
  servings: string | null;
  coverImageUrl: string | null;
  coverProvenanceLabel: string | null;
};

export type SmartCookbookRecipesPage = {
  total: number;
  page: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  recipes: SmartCookbookRecipe[];
};

type RecipeRow = {
  id: string;
  title: string;
  servings: string | null;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  coverMode: string;
};

const RECIPE_COLUMNS: ColumnSpec<RecipeRow> = {
  id: "string",
  title: "string",
  servings: "string?",
  activeCoverId: "string?",
  activeCoverVariant: "string?",
  coverMode: "string",
};

// The cook's recipes (not deleted) the organizer clauses keep, after any join. Binds: owner id, then the clauses' binds.
const matching = (clauses: OrganizerClauses, join = "") => `FROM "Recipe" AS recipe${join}
      WHERE recipe."chefId" = ? AND recipe."deletedAt" IS NULL${clauses.sql}`;
// Each recipe's own active cover, which is all a cover's display reads.
const ACTIVE_COVER_JOIN = `
      LEFT JOIN "RecipeCover" rc ON rc."id" = recipe."activeCoverId" AND rc."recipeId" = recipe."id"`;
const ORDER = `ORDER BY recipe."updatedAt" DESC, recipe."id" DESC LIMIT ? OFFSET ?`;

function shown(row: RecipeRow, covers: Parameters<typeof getRecipeCoverDisplay>[1]): SmartCookbookRecipe {
  const cover = getRecipeCoverDisplay(row, covers);
  return {
    id: row.id,
    title: row.title,
    servings: row.servings,
    coverImageUrl: cover?.displayUrl ?? null,
    coverProvenanceLabel: cover?.provenanceLabel ?? null,
  };
}

/** One page of the cook's recipes that the filters keep, with their covers, and how many they keep in all. */
export async function readSmartCookbookRecipes(
  source: { d1: D1ReadDatabase | null; db: PrismaClient },
  { ownerId, filters, page }: { ownerId: string; filters: OrganizerFilters; page: number },
): Promise<SmartCookbookRecipesPage> {
  const clauses = organizerClauses(ownerId, filters);
  const binds = [ownerId, ...clauses.binds];
  const window = [MY_RECIPES_PAGE_SIZE + 1, (page - 1) * MY_RECIPES_PAGE_SIZE];
  const countSql = `SELECT COUNT(*) AS "count" ${matching(clauses)}`;
  let total: number;
  let recipes: SmartCookbookRecipe[];
  if (source.d1) {
    const [rows, counts] = await d1ReadBatch(source.d1, [
      [
        `SELECT ${selectColumns(RECIPE_COLUMNS, "recipe")}, ${selectColumns(RECIPE_COVER_COLUMNS, "rc", "cover_")}
      ${matching(clauses, ACTIVE_COVER_JOIN)}
      ${ORDER}`,
        ...binds,
        ...window,
      ],
      [countSql, ...binds],
    ]);
    total = Number(counts![0]!.count);
    recipes = rows!.map((row) => shown(mapModel(RECIPE_COLUMNS, row), row.cover_id === null ? [] : [mapModel(RECIPE_COVER_COLUMNS, row, "cover_")]));
  } else {
    const rows = await source.db.$queryRawUnsafe<RecipeRow[]>(`SELECT ${selectColumns(RECIPE_COLUMNS, "recipe")} ${matching(clauses)} ${ORDER}`, ...binds, ...window);
    const [counted] = await source.db.$queryRawUnsafe<{ count: bigint | number }[]>(countSql, ...binds);
    total = Number(counted!.count);
    const covers = await source.db.recipe.findMany({ where: { id: { in: rows.map((row) => row.id) } }, select: { id: true, activeCover: true } });
    const coverOf = new Map(covers.map((recipe) => [recipe.id, recipe.activeCover]));
    recipes = rows.map((row) => {
      const cover = coverOf.get(row.id);
      return shown(row, cover ? [cover] : []);
    });
  }
  return {
    total,
    page,
    hasPreviousPage: page > 1,
    hasNextPage: recipes.length > MY_RECIPES_PAGE_SIZE,
    recipes: recipes.slice(0, MY_RECIPES_PAGE_SIZE),
  };
}
