export const MY_RECIPES_PAGE_SIZE = 50;
const MAX_MY_RECIPES_PAGE_SIZE = 50;

type MyRecipesSearchDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

type MyRecipesRow = {
  id: string;
  title: string;
  description: string | null;
  servings: string | null;
};

export type MyRecipesSearchRecipe = MyRecipesRow & {
  chef: {
    id: string;
    username: string;
  };
  ingredientNames: string[];
};

export type MyRecipesSearchResult = {
  query: string;
  page: number;
  pageSize: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  recipes: MyRecipesSearchRecipe[];
};

export function normalizeMyRecipesQuery(value: string | null | undefined) {
  return (value ?? "").trim();
}

export function normalizeMyRecipesPage(value: string | null | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizePageSize(value: number | null | undefined) {
  if (!Number.isFinite(value) || !value) return MY_RECIPES_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_MY_RECIPES_PAGE_SIZE, Math.floor(value)));
}

function mapRowsToRecipes(
  rows: MyRecipesRow[],
  owner: { id: string; username: string },
): MyRecipesSearchRecipe[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    servings: row.servings,
    chef: owner,
    ingredientNames: [],
  }));
}

export async function searchMyRecipes(
  database: MyRecipesSearchDb,
  {
    ownerId,
    ownerUsername,
    query: rawQuery = "",
    page: rawPage = 1,
    pageSize: rawPageSize = MY_RECIPES_PAGE_SIZE,
  }: {
    ownerId: string;
    ownerUsername: string;
    query?: string | null;
    page?: number | null;
    pageSize?: number | null;
  },
): Promise<MyRecipesSearchResult> {
  const query = normalizeMyRecipesQuery(rawQuery);
  const page = normalizeMyRecipesPage(String(rawPage));
  const pageSize = normalizePageSize(rawPageSize);
  const limit = pageSize + 1;
  const offset = (page - 1) * pageSize;
  const owner = { id: ownerId, username: ownerUsername };

  const rows = query
    ? await searchFilteredRecipes(database, {
      ownerId,
      ownerUsername,
      query,
      limit,
      offset,
    })
    : await searchUnfilteredRecipes(database, { ownerId, limit, offset });
  const pageRows = rows.slice(0, pageSize);

  return {
    query,
    page,
    pageSize,
    hasPreviousPage: page > 1,
    hasNextPage: rows.length > pageSize,
    recipes: mapRowsToRecipes(pageRows, owner),
  };
}

async function searchUnfilteredRecipes(
  database: MyRecipesSearchDb,
  {
    ownerId,
    limit,
    offset,
  }: {
    ownerId: string;
    limit: number;
    offset: number;
  },
) {
  return database.$queryRawUnsafe<MyRecipesRow[]>(
    `
      SELECT
        recipe."id",
        recipe."title",
        recipe."description",
        recipe."servings"
      FROM "Recipe" AS recipe
      WHERE recipe."chefId" = ?
        AND recipe."deletedAt" IS NULL
      ORDER BY recipe."updatedAt" DESC, recipe."id" DESC
      LIMIT ? OFFSET ?
    `,
    ownerId,
    limit,
    offset,
  );
}

async function searchFilteredRecipes(
  database: MyRecipesSearchDb,
  {
    ownerId,
    ownerUsername,
    query,
    limit,
    offset,
  }: {
    ownerId: string;
    ownerUsername: string;
    query: string;
    limit: number;
    offset: number;
  },
) {
  const needle = query.toLowerCase();
  const ownerUsernameMatches = ownerUsername.toLowerCase().includes(needle) ? 1 : 0;

  return database.$queryRawUnsafe<MyRecipesRow[]>(
    `
      SELECT
        recipe."id",
        recipe."title",
        recipe."description",
        recipe."servings"
      FROM "Recipe" AS recipe
      WHERE recipe."chefId" = ?
        AND recipe."deletedAt" IS NULL
        AND (
          instr(lower(recipe."title"), ?) > 0
          OR instr(lower(coalesce(recipe."description", '')), ?) > 0
          OR instr(lower(coalesce(recipe."servings", '')), ?) > 0
          OR ? = 1
          OR EXISTS (
            SELECT 1
            FROM "Ingredient" AS ingredient
            INNER JOIN "IngredientRef" AS ingredientRef
              ON ingredientRef."id" = ingredient."ingredientRefId"
            WHERE ingredient."recipeId" = recipe."id"
              AND instr(lower(ingredientRef."name"), ?) > 0
          )
        )
      ORDER BY recipe."updatedAt" DESC, recipe."id" DESC
      LIMIT ? OFFSET ?
    `,
    ownerId,
    needle,
    needle,
    needle,
    ownerUsernameMatches,
    needle,
    limit,
    offset,
  );
}
