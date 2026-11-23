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

// Whether the recipe's cook shares a household with the viewer, found from HouseholdMember in the same statement.
function sharesHouseholdSql(chefIdColumn: string, viewer: string): string {
  return `EXISTS (SELECT 1 FROM "HouseholdMember" hv JOIN "HouseholdMember" hc ON hc."householdId" = hv."householdId"
    WHERE hv."userId" = ${viewer} AND hc."userId" = ${chefIdColumn})`;
}

function readableForViewerSql(columns: { visibility: string; chefId: string }, viewer: string): string {
  return `(${columns.visibility} = 'public' OR ${columns.chefId} = ${viewer} OR (${columns.visibility} = 'household' AND ${sharesHouseholdSql(columns.chefId, viewer)}))`;
}

/**
 * readableRecipeSqlOn for a signed-in viewer known only by id: the statement finds their household itself, so a D1
 * reader that filters in SQL needs no extra round trip to look it up. A null or empty id is signed out.
 */
export function readableRecipeSqlOnForViewerId(
  columns: { visibility: string; chefId: string },
  viewerId: string | null | undefined,
): { sql: string; params: string[] } {
  if (!viewerId) return { sql: `${columns.visibility} = 'public'`, params: [] };
  return { sql: readableForViewerSql(columns, "?"), params: [viewerId, viewerId] };
}

/** readableRecipeSqlOnForViewerId on the Recipe table. alias names it. */
export function readableRecipeSqlForViewerId(alias: string | undefined, viewerId: string | null | undefined): { sql: string; params: string[] } {
  const table = alias ?? `"Recipe"`;
  return readableRecipeSqlOnForViewerId({ visibility: `${table}."visibility"`, chefId: `${table}."chefId"` }, viewerId);
}

/**
 * readableRecipeSql for a viewer named by a column of the same row (a cook's own list joined to recipes), with no
 * bound values. Like readableRecipeSqlForViewerId, it finds the viewer's household from HouseholdMember.
 */
export function readableRecipeSqlForViewerColumn(alias: string, viewerColumn: string): string {
  return readableForViewerSql({ visibility: `${alias}."visibility"`, chefId: `${alias}."chefId"` }, viewerColumn);
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
