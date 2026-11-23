// canRead as a query, for readers that list recipes in SQL (D1) or through Prisma. Both select exactly the recipes
// canRead allows (test/domains/kitchen/recipe-visibility.test.ts checks them against it).
import { viewerIdOf, type RecipeViewer } from "../model/recipe-visibility";

/** A WHERE clause, with its bound values, that keeps the recipes this viewer may read. alias names the Recipe table. */
export function readableRecipeSql(alias: string | undefined, viewer: RecipeViewer): { sql: string; params: string[] } {
  const table = alias ?? `"Recipe"`;
  return readableRecipeSqlOn({ visibility: `${table}."visibility"`, chefId: `${table}."chefId"` }, viewer);
}

/** readableRecipeSql for rows that carry a recipe's visibility and cook in other columns, such as the search index. */
export function readableRecipeSqlOn(
  columns: { visibility: string; chefId: string },
  viewer: RecipeViewer,
): { sql: string; params: string[] } {
  const isPublic = `${columns.visibility} = 'public'`;
  const viewerId = viewerIdOf(viewer);
  if (!viewerId) return { sql: isPublic, params: [] };
  const household = [...(viewer?.householdChefIds ?? [])];
  if (household.length === 0) return { sql: `(${isPublic} OR ${columns.chefId} = ?)`, params: [viewerId] };
  const placeholders = household.map(() => "?").join(", ");
  return {
    sql: `(${isPublic} OR ${columns.chefId} = ? OR (${columns.visibility} = 'household' AND ${columns.chefId} IN (${placeholders})))`,
    params: [viewerId, ...household],
  };
}

type ReadableRecipeWhere =
  | { visibility: "public" }
  | { OR: Array<{ visibility: "public" } | { chefId: string } | { visibility: "household"; chefId: { in: string[] } }> };

/** A Prisma Recipe where clause that keeps the recipes this viewer may read. */
export function readableRecipeWhere(viewer: RecipeViewer): ReadableRecipeWhere {
  const viewerId = viewerIdOf(viewer);
  if (!viewerId) return { visibility: "public" };
  const household = [...(viewer?.householdChefIds ?? [])];
  return {
    OR: [
      { visibility: "public" },
      { chefId: viewerId },
      ...(household.length > 0 ? [{ visibility: "household" as const, chefId: { in: household } }] : []),
    ],
  };
}
