import {
  normalizeRecipeCourse,
  normalizeRecipeTags,
  RecipeTagValidationError,
  type RecipeCourse,
} from "~/lib/recipe-tags.server";

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
  course: RecipeCourse | null;
  tags: string[];
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

export class MyRecipesSearchValidationError extends Error {
  readonly field: "course" | "tags" | "page";

  constructor(field: "course" | "tags" | "page", message: string) {
    super(message);
    this.name = "MyRecipesSearchValidationError";
    this.field = field;
  }
}

export function parseMyRecipesPage(value: string | null | undefined) {
  if (value === null || value === undefined) return 1;
  if (!/^\d+$/.test(value)) {
    throw new MyRecipesSearchValidationError("page", "Page must be a positive integer");
  }

  const page = Number(value);
  const offset = (page - 1) * MY_RECIPES_PAGE_SIZE;
  if (page < 1 || !Number.isSafeInteger(page) || !Number.isSafeInteger(offset)) {
    throw new MyRecipesSearchValidationError("page", "Page must be a safe positive integer");
  }
  return page;
}

export function normalizeMyRecipesFilters(
  courseValue: string | null | undefined,
  rawTags: readonly string[],
) {
  if (rawTags.length > 10) {
    throw new MyRecipesSearchValidationError("tags", "At most 10 tag filters are allowed");
  }

  try {
    const course = normalizeRecipeCourse(courseValue ? courseValue : null);
    const tags = normalizeRecipeTags([...rawTags]).map((tag) => tag.normalizedLabel);
    return { course, tags };
  } catch (error) {
    if (!(error instanceof RecipeTagValidationError)) throw error;
    const field = error.field === "course" ? "course" : "tags";
    throw new MyRecipesSearchValidationError(field, error.message);
  }
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
    course: rawCourse = null,
    tags: rawTags = [],
    page: rawPage = 1,
    pageSize: rawPageSize = MY_RECIPES_PAGE_SIZE,
  }: {
    ownerId: string;
    ownerUsername: string;
    query?: string | null;
    course?: string | null;
    tags?: string[];
    page?: number | null;
    pageSize?: number | null;
  },
): Promise<MyRecipesSearchResult> {
  const query = normalizeMyRecipesQuery(rawQuery);
  const { course, tags } = normalizeMyRecipesFilters(rawCourse, rawTags);
  const page = normalizeMyRecipesPage(String(rawPage));
  const pageSize = normalizePageSize(rawPageSize);
  const limit = pageSize + 1;
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) {
    throw new MyRecipesSearchValidationError("page", "Page offset must be a safe integer");
  }
  const owner = { id: ownerId, username: ownerUsername };

  const rows = query
    ? await searchFilteredRecipes(database, {
      ownerId,
      ownerUsername,
      query,
      course,
      tags,
      limit,
      offset,
    })
    : await searchUnfilteredRecipes(database, { ownerId, course, tags, limit, offset });
  const pageRows = rows.slice(0, pageSize);

  return {
    query,
    course,
    tags,
    page,
    pageSize,
    hasPreviousPage: page > 1,
    hasNextPage: rows.length > pageSize,
    recipes: mapRowsToRecipes(pageRows, owner),
  };
}

function canonicalRecipeFilterSql(course: RecipeCourse | null, tags: string[]) {
  const conditions: string[] = [];
  const values: string[] = [];

  if (course) {
    conditions.push('recipe."course" = ?');
    values.push(course);
  }
  for (const tag of tags) {
    conditions.push(`EXISTS (
          SELECT 1
          FROM "RecipeTag" AS tag
          WHERE tag."recipeId" = recipe."id"
            AND tag."normalizedLabel" = ?
        )`);
    values.push(tag);
  }

  return {
    sql: conditions.map((condition) => `AND ${condition}`).join("\n        "),
    values,
  };
}

async function searchUnfilteredRecipes(
  database: MyRecipesSearchDb,
  {
    ownerId,
    course,
    tags,
    limit,
    offset,
  }: {
    ownerId: string;
    course: RecipeCourse | null;
    tags: string[];
    limit: number;
    offset: number;
  },
) {
  const filters = canonicalRecipeFilterSql(course, tags);
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
        ${filters.sql}
      ORDER BY recipe."updatedAt" DESC, recipe."id" DESC
      LIMIT ? OFFSET ?
    `,
    ownerId,
    ...filters.values,
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
    course,
    tags,
    limit,
    offset,
  }: {
    ownerId: string;
    ownerUsername: string;
    query: string;
    course: RecipeCourse | null;
    tags: string[];
    limit: number;
    offset: number;
  },
) {
  const needle = query.toLowerCase();
  const ownerUsernameMatches = ownerUsername.toLowerCase().includes(needle) ? 1 : 0;
  const filters = canonicalRecipeFilterSql(course, tags);

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
        ${filters.sql}
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
    ...filters.values,
    needle,
    needle,
    needle,
    ownerUsernameMatches,
    needle,
    limit,
    offset,
  );
}
