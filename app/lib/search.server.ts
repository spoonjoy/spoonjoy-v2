import type {
  Cookbook,
  Ingredient,
  IngredientRef,
  PrismaClient,
  Recipe,
  RecipeCover,
  RecipeInCookbook,
  RecipeStep,
  Unit,
} from "@prisma/client";
import { resolveChefAvatarUrl } from "~/lib/chef-avatar";
import {
  d1Count,
  d1ReadBatch,
  type D1Query,
  type D1ReadDatabase,
  type D1Row,
} from "~/lib/d1-read.server";
import {
  mapModel,
  RECIPE_COLUMNS,
  RECIPE_COVER_COLUMNS,
  selectColumns,
  type ColumnSpec,
} from "~/lib/d1-models.server";
import { getRecipeCoverDisplay } from "~/lib/recipe-cover.server";
import {
  SEARCH_DIRTY_CLOCK_SCHEMA_SQL,
  SEARCH_DIRTY_SCHEMA_SQL,
  SEARCH_TRIGGER_COUNT_SQL,
  SEARCH_TRIGGER_NAMES,
  searchTriggerInstallStatements,
} from "~/lib/search-triggers.server";

export const SEARCH_SCOPES = ["all", "recipes", "cookbooks", "chefs", "shopping-list"] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

export type SearchEntityType = "recipe" | "cookbook" | "chef" | "shopping-list-item";

export interface SearchResult {
  type: SearchEntityType;
  id: string;
  ownerId: string;
  ownerUsername: string;
  title: string;
  subtitle: string;
  snippet: string;
  href: string;
  imageUrl: string | null;
  score: number;
  metadata: Record<string, unknown>;
}

export interface SearchOptions {
  query?: string | null;
  scope?: SearchScope;
  viewerId?: string | null;
  ownerId?: string | null;
  limit?: number;
}

interface SearchDocumentInput {
  type: SearchEntityType;
  id: string;
  ownerId: string;
  ownerUsername: string;
  sortAt: string;
  title: string;
  subtitle: string;
  body: string;
  href: string;
  imageUrl: string | null;
  metadata: Record<string, unknown>;
}

interface SearchRow {
  entityType: SearchEntityType;
  entityId: string;
  ownerId: string;
  ownerUsername: string;
  title: string;
  subtitle: string;
  body: string;
  href: string;
  imageUrl: string | null;
  metadata: string;
  rank: number;
  snippet: string;
}

interface SearchIndexMetadataRow {
  sourceFingerprint: string;
  documentCount: number | bigint;
}

interface SearchDirtyRow {
  seq: number;
  entityType: string;
  entityId: string;
}

/**
 * Marks an index kept current by the per-entity triggers. The column is still called
 * `sourceFingerprint` because earlier releases stored a whole-database fingerprint there;
 * any other value (or no row) means the triggers and index must be (re)built.
 */
const SEARCH_MAINTENANCE_VERSION = "per-entity-triggers-v1";

/** Past this many queued entities, one full rebuild is cheaper than re-indexing each. */
const MAX_DIRTY_ENTITIES_PER_SEARCH = 200;

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const SEARCH_METADATA_ID = "current";
// A pantry query binds one parameter per term; D1 allows 100 bound parameters per query.
const MAX_PANTRY_TERMS = 12;


const ENTITY_TYPES_BY_SCOPE: Record<SearchScope, readonly SearchEntityType[]> = {
  all: ["recipe", "cookbook", "chef", "shopping-list-item"],
  recipes: ["recipe"],
  cookbooks: ["cookbook"],
  chefs: ["chef"],
  "shopping-list": ["shopping-list-item"],
};

const SEARCH_SCHEMA_SQL = `CREATE VIRTUAL TABLE IF NOT EXISTS "SearchDocument" USING fts5(
  entityType UNINDEXED,
  entityId UNINDEXED,
  ownerId UNINDEXED,
  ownerUsername UNINDEXED,
  sortAt UNINDEXED,
  title,
  subtitle,
  body,
  href UNINDEXED,
  imageUrl UNINDEXED,
  metadata UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3 4'
)`;

const SEARCH_METADATA_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS "SearchIndexMetadata" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceFingerprint" TEXT NOT NULL,
  "documentCount" INTEGER NOT NULL DEFAULT 0,
  "rebuiltAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;


// Stable rowids for search documents, so re-indexing one entity deletes its document by
// rowid instead of scanning the whole full-text table for it.
const SEARCH_DOCUMENT_KEY_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS "SearchDocumentKey" (
  "docRowid" INTEGER PRIMARY KEY AUTOINCREMENT,
  "docKey" TEXT NOT NULL UNIQUE
)`;

const SEARCH_INDEX_SCHEMA_QUERIES: readonly D1Query[] = [
  [SEARCH_SCHEMA_SQL],
  [SEARCH_METADATA_SCHEMA_SQL],
  [SEARCH_DOCUMENT_KEY_SCHEMA_SQL],
  [SEARCH_DIRTY_SCHEMA_SQL],
  [SEARCH_DIRTY_CLOCK_SCHEMA_SQL],
];

const SEARCH_METADATA_SQL = `SELECT "sourceFingerprint", "documentCount" FROM "SearchIndexMetadata" WHERE "id" = ? LIMIT 1`;

const WRITE_SEARCH_METADATA_SQL = `INSERT INTO "SearchIndexMetadata" ("id", "sourceFingerprint", "documentCount", "rebuiltAt")
  VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT("id") DO UPDATE SET
    "sourceFingerprint" = excluded."sourceFingerprint",
    "documentCount" = excluded."documentCount",
    "rebuiltAt" = excluded."rebuiltAt"`;

const SEARCH_DOCUMENT_COUNT_SQL = `SELECT COUNT(*) AS documentCount FROM "SearchDocument"`;

const DELETE_SEARCH_DOCUMENTS_SQL = `DELETE FROM "SearchDocument"`;

const DELETE_SEARCH_DOCUMENT_KEYS_SQL = `DELETE FROM "SearchDocumentKey"`;

const DELETE_SEARCH_DOCUMENTS_BY_KEY_SQL = `DELETE FROM "SearchDocument"
  WHERE rowid IN (SELECT "docRowid" FROM "SearchDocumentKey" WHERE "docKey" IN (SELECT value FROM json_each(?)))`;

const SEARCH_DIRTY_SQL = `SELECT "seq", "entityType", "entityId" FROM "SearchDirtyEntity" ORDER BY "seq" ASC LIMIT ${MAX_DIRTY_ENTITIES_PER_SEARCH + 1}`;

const SEARCH_DIRTY_CLOCK_SQL = `SELECT COALESCE((SELECT "seq" FROM "SearchDirtyClock" WHERE "id" = 1), 0) AS maxSeq`;

// Clears the whole queue up to the clock value read before the sources were. A write after
// that read re-stamps its entity with a higher seq, so it survives for the next search.
const CLEAR_SEARCH_DIRTY_SQL = `DELETE FROM "SearchDirtyEntity" WHERE "seq" <= ?`;

// Clears just the entities that were re-indexed, unless a write re-stamped them since.
const CLEAR_SEARCH_DIRTY_KEYS_SQL = `DELETE FROM "SearchDirtyEntity"
  WHERE "seq" <= ?
    AND ("entityType", "entityId") IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?))`;

export function normalizeSearchScope(value: string | null | undefined): SearchScope {
  if (value === "recipes" || value === "cookbooks" || value === "chefs" || value === "shopping-list") {
    return value;
  }

  if (value === "shopping") {
    return "shopping-list";
  }

  return "all";
}

export function normalizeSearchLimit(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SEARCH_LIMIT;
  }

  return Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.floor(value)));
}

export function tokenizeSearchQuery(query: string): string[] {
  return query
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
}

export function toFtsQuery(query: string): string | null {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => `${token}*`).join(" AND ");
}

/**
 * Splits a search query into FTS5 term queries. A query without commas is one term (all of its
 * words must match). A query with commas is a pantry query: each comma-separated part is its own
 * term, matched independently. Parts with no letters or digits and repeated parts are dropped.
 */
export function toSearchTerms(query: string): string[] {
  const terms = query
    .split(",")
    .map(toFtsQuery)
    .filter((term): term is string => term !== null);

  return [...new Set(terms)].slice(0, MAX_PANTRY_TERMS);
}

function compactText(parts: Array<string | null | undefined | false>): string {
  return parts.filter((part): part is string => typeof part === "string" && part.trim().length > 0).join(" ");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function groupedBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return groups;
}

function entityTypesForSearch(scope: SearchScope, viewerId: string | null | undefined): SearchEntityType[] {
  const scopedTypes = ENTITY_TYPES_BY_SCOPE[scope];
  if (viewerId) {
    return [...scopedTypes];
  }

  return scopedTypes.filter((type) => type !== "shopping-list-item");
}

function buildWhereClause(entityTypes: SearchEntityType[], ownerId: string | null | undefined, viewerId: string | null | undefined) {
  const values: Array<string | number> = [...entityTypes];
  const placeholders = entityTypes.map(() => "?").join(", ");
  const conditions = [`entityType IN (${placeholders})`];

  if (ownerId) {
    conditions.push("ownerId = ?");
    values.push(ownerId);
  }

  if (viewerId) {
    conditions.push("(entityType != 'shopping-list-item' OR ownerId = ?)");
    values.push(viewerId);
  } else {
    conditions.push("entityType != 'shopping-list-item'");
  }

  return { sql: conditions.join(" AND "), values };
}

function parseRow(row: SearchRow): SearchResult {
  return {
    type: row.entityType,
    id: row.entityId,
    ownerId: row.ownerId,
    ownerUsername: row.ownerUsername,
    title: row.title,
    subtitle: row.subtitle,
    snippet: row.snippet,
    href: row.href,
    imageUrl: row.imageUrl,
    score: row.rank,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  };
}

// The rows search documents are built from. Both readers (Prisma and D1) fill the same
// shapes, and one set of builders turns them into documents, so both paths index
// identical documents.
interface SearchUserSource {
  id: string;
  username: string;
  photoUrl: string | null;
  updatedAt: Date;
  // Every recipe, deleted ones included, as the chef card has always counted them.
  recipeCount: number;
  cookbookCount: number;
}

interface SearchShoppingItemSource {
  id: string;
  quantity: number | null;
  checked: boolean;
  categoryKey: string | null;
  iconKey: string | null;
  sortIndex: number;
  updatedAt: Date;
  unitName: string | null;
  ingredientName: string;
  ownerId: string;
  ownerUsername: string;
}

interface SearchSources {
  users: SearchUserSource[];
  // Every recipe, deleted ones included, by id.
  recipes: Recipe[];
  covers: RecipeCover[];
  // By recipe, then step number.
  steps: Array<Pick<RecipeStep, "recipeId" | "stepNum" | "stepTitle" | "description">>;
  // By recipe, then step number.
  ingredients: Array<Pick<Ingredient, "recipeId" | "stepNum" | "quantity" | "unitId" | "ingredientRefId">>;
  units: Array<Pick<Unit, "id" | "name">>;
  ingredientRefs: Array<Pick<IngredientRef, "id" | "name">>;
  recipeCookbooks: Array<Pick<RecipeInCookbook, "recipeId" | "cookbookId">>;
  cookbooks: Array<Pick<Cookbook, "id" | "title" | "authorId" | "updatedAt">>;
  // Not deleted.
  shoppingItems: SearchShoppingItemSource[];
}

const SEARCH_USER_COLUMNS: ColumnSpec<SearchUserSource> = {
  id: "string",
  username: "string",
  photoUrl: "string?",
  updatedAt: "dateTime",
  recipeCount: "int",
  cookbookCount: "int",
};

const SEARCH_STEP_COLUMNS: ColumnSpec<SearchSources["steps"][number]> = {
  recipeId: "string",
  stepNum: "int",
  stepTitle: "string?",
  description: "string",
};

const SEARCH_INGREDIENT_COLUMNS: ColumnSpec<SearchSources["ingredients"][number]> = {
  recipeId: "string",
  stepNum: "int",
  quantity: "float",
  unitId: "string",
  ingredientRefId: "string",
};

const SEARCH_NAMED_COLUMNS: ColumnSpec<{ id: string; name: string }> = { id: "string", name: "string" };

const SEARCH_RECIPE_COOKBOOK_COLUMNS: ColumnSpec<SearchSources["recipeCookbooks"][number]> = {
  recipeId: "string",
  cookbookId: "string",
};

const SEARCH_COOKBOOK_COLUMNS: ColumnSpec<SearchSources["cookbooks"][number]> = {
  id: "string",
  title: "string",
  authorId: "string",
  updatedAt: "dateTime",
};

const SEARCH_SHOPPING_ITEM_COLUMNS: ColumnSpec<SearchShoppingItemSource> = {
  id: "string",
  quantity: "float?",
  checked: "boolean",
  categoryKey: "string?",
  iconKey: "string?",
  sortIndex: "int",
  updatedAt: "dateTime",
  unitName: "string?",
  ingredientName: "string",
  ownerId: "string",
  ownerUsername: "string",
};

// The same reads as loadSearchSourcesWithPrisma, as one D1 batch. Tables Prisma read
// without an ORDER BY are read in rowid order, which is the order a plain scan returns.

const SEARCH_SOURCE_QUERIES: readonly D1Query[] = [
  [
    `SELECT u."id", u."username", u."photoUrl", u."updatedAt",
       (SELECT COUNT(*) FROM "Recipe" r WHERE r."chefId" = u."id") AS "recipeCount",
       (SELECT COUNT(*) FROM "Cookbook" c WHERE c."authorId" = u."id") AS "cookbookCount"
     FROM "User" u ORDER BY u.rowid`,
  ],
  [`SELECT ${selectColumns(RECIPE_COLUMNS, "r")} FROM "Recipe" r ORDER BY r."id" ASC`],
  [`SELECT ${selectColumns(RECIPE_COVER_COLUMNS, "rc")} FROM "RecipeCover" rc ORDER BY rc.rowid`],
  [`SELECT "recipeId", "stepNum", "stepTitle", "description" FROM "RecipeStep" ORDER BY "recipeId" ASC, "stepNum" ASC, rowid ASC`],
  [`SELECT "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId" FROM "Ingredient" ORDER BY "recipeId" ASC, "stepNum" ASC, rowid ASC`],
  [`SELECT "id", "name" FROM "Unit" ORDER BY rowid`],
  [`SELECT "id", "name" FROM "IngredientRef" ORDER BY rowid`],
  [`SELECT "recipeId", "cookbookId" FROM "RecipeInCookbook" ORDER BY rowid`],
  [`SELECT "id", "title", "authorId", "updatedAt" FROM "Cookbook" ORDER BY rowid`],
  [
    `SELECT sli."id", sli."quantity", sli."checked", sli."categoryKey", sli."iconKey", sli."sortIndex", sli."updatedAt",
       u."name" AS "unitName", ir."name" AS "ingredientName", sl."authorId" AS "ownerId", a."username" AS "ownerUsername"
     FROM "ShoppingListItem" sli
     JOIN "ShoppingList" sl ON sl."id" = sli."shoppingListId"
     JOIN "User" a ON a."id" = sl."authorId"
     JOIN "IngredientRef" ir ON ir."id" = sli."ingredientRefId"
     LEFT JOIN "Unit" u ON u."id" = sli."unitId"
     WHERE sli."deletedAt" IS NULL
     ORDER BY sli.rowid`,
  ],
];

// Statements run either as one D1 batch or one at a time through Prisma. Both return the
// same row shapes, so one set of loaders and builders serves both paths.
type SearchRunner = (queries: readonly D1Query[]) => Promise<D1Row[][]>;

function d1SearchRunner(db: D1ReadDatabase): SearchRunner {
  return (queries) => d1ReadBatch(db, queries);
}

// Prisma's raw rows carry BigInt counts and Date objects where D1 returns plain numbers;
// normalize them so the D1 column mappers read both.
function normalizePrismaValue(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.getTime();
  return value;
}

function prismaSearchRunner(database: PrismaClient): SearchRunner {
  return async (queries) => {
    const results: D1Row[][] = [];
    for (const [sql, ...values] of queries) {
      if (/^\s*(SELECT|WITH)\b/i.test(sql)) {
        const rows = await database.$queryRawUnsafe<D1Row[]>(sql, ...values);
        results.push(
          rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizePrismaValue(value)]))),
        );
      } else {
        await database.$executeRawUnsafe(sql, ...values);
        results.push([]);
      }
    }
    return results;
  };
}

function mapSearchSources(rows: D1Row[][]): SearchSources {
  const [users, recipes, covers, steps, ingredients, units, ingredientRefs, recipeCookbooks, cookbooks, shoppingItems] = rows;

  return {
    users: users!.map((row) => mapModel(SEARCH_USER_COLUMNS, row)),
    recipes: recipes!.map((row) => mapModel(RECIPE_COLUMNS, row)),
    covers: covers!.map((row) => mapModel(RECIPE_COVER_COLUMNS, row)),
    steps: steps!.map((row) => mapModel(SEARCH_STEP_COLUMNS, row)),
    ingredients: ingredients!.map((row) => mapModel(SEARCH_INGREDIENT_COLUMNS, row)),
    units: units!.map((row) => mapModel(SEARCH_NAMED_COLUMNS, row)),
    ingredientRefs: ingredientRefs!.map((row) => mapModel(SEARCH_NAMED_COLUMNS, row)),
    recipeCookbooks: recipeCookbooks!.map((row) => mapModel(SEARCH_RECIPE_COOKBOOK_COLUMNS, row)),
    cookbooks: cookbooks!.map((row) => mapModel(SEARCH_COOKBOOK_COLUMNS, row)),
    shoppingItems: shoppingItems!.map((row) => mapModel(SEARCH_SHOPPING_ITEM_COLUMNS, row)),
  };
}

interface DirtyEntityIds {
  recipe: string[];
  cookbook: string[];
  chef: string[];
  "shopping-list-item": string[];
}

const IDS = `(SELECT value FROM json_each(?))`;

/**
 * The same reads as SEARCH_SOURCE_QUERIES, narrowed to what the documents of the given
 * entities are built from. Besides the entities themselves this loads the rows their
 * builders look up: chefs and authors, a dirty recipe's covers, steps, ingredients,
 * names and cookbooks, and a dirty cookbook's recipes. Documents built for those extra
 * rows are incomplete and are discarded by the caller.
 */
function targetedSearchSourceQueries(ids: DirtyEntityIds): D1Query[] {
  const R = JSON.stringify(ids.recipe);
  const C = JSON.stringify(ids.cookbook);
  const U = JSON.stringify(ids.chef);
  const S = JSON.stringify(ids["shopping-list-item"]);
  const recipesOfCookbooks = `SELECT "recipeId" FROM "RecipeInCookbook" WHERE "cookbookId" IN ${IDS}`;
  const cookbooksOfRecipes = `SELECT "cookbookId" FROM "RecipeInCookbook" WHERE "recipeId" IN ${IDS}`;

  return [
    [
      `SELECT u."id", u."username", u."photoUrl", u."updatedAt",
         (SELECT COUNT(*) FROM "Recipe" r WHERE r."chefId" = u."id") AS "recipeCount",
         (SELECT COUNT(*) FROM "Cookbook" c WHERE c."authorId" = u."id") AS "cookbookCount"
       FROM "User" u
       WHERE u."id" IN ${IDS}
         OR u."id" IN (SELECT "chefId" FROM "Recipe" WHERE "id" IN ${IDS} OR "id" IN (${recipesOfCookbooks}))
         OR u."id" IN (SELECT "authorId" FROM "Cookbook" WHERE "id" IN ${IDS} OR "id" IN (${cookbooksOfRecipes}))
       ORDER BY u.rowid`,
      U, R, C, C, R,
    ],
    [
      `SELECT ${selectColumns(RECIPE_COLUMNS, "r")} FROM "Recipe" r
       WHERE r."id" IN ${IDS} OR r."id" IN (${recipesOfCookbooks})
       ORDER BY r."id" ASC`,
      R, C,
    ],
    [`SELECT ${selectColumns(RECIPE_COVER_COLUMNS, "rc")} FROM "RecipeCover" rc WHERE rc."recipeId" IN ${IDS} ORDER BY rc.rowid`, R],
    [
      `SELECT "recipeId", "stepNum", "stepTitle", "description" FROM "RecipeStep"
       WHERE "recipeId" IN ${IDS} ORDER BY "recipeId" ASC, "stepNum" ASC, rowid ASC`,
      R,
    ],
    [
      `SELECT "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId" FROM "Ingredient"
       WHERE "recipeId" IN ${IDS} ORDER BY "recipeId" ASC, "stepNum" ASC, rowid ASC`,
      R,
    ],
    [`SELECT "id", "name" FROM "Unit" WHERE "id" IN (SELECT "unitId" FROM "Ingredient" WHERE "recipeId" IN ${IDS}) ORDER BY rowid`, R],
    [
      `SELECT "id", "name" FROM "IngredientRef" WHERE "id" IN (SELECT "ingredientRefId" FROM "Ingredient" WHERE "recipeId" IN ${IDS}) ORDER BY rowid`,
      R,
    ],
    [`SELECT "recipeId", "cookbookId" FROM "RecipeInCookbook" WHERE "recipeId" IN ${IDS} OR "cookbookId" IN ${IDS} ORDER BY rowid`, R, C],
    [
      `SELECT "id", "title", "authorId", "updatedAt" FROM "Cookbook"
       WHERE "id" IN ${IDS} OR "id" IN (${cookbooksOfRecipes}) ORDER BY rowid`,
      C, R,
    ],
    [
      `SELECT sli."id", sli."quantity", sli."checked", sli."categoryKey", sli."iconKey", sli."sortIndex", sli."updatedAt",
         u."name" AS "unitName", ir."name" AS "ingredientName", sl."authorId" AS "ownerId", a."username" AS "ownerUsername"
       FROM "ShoppingListItem" sli
       JOIN "ShoppingList" sl ON sl."id" = sli."shoppingListId"
       JOIN "User" a ON a."id" = sl."authorId"
       JOIN "IngredientRef" ir ON ir."id" = sli."ingredientRefId"
       LEFT JOIN "Unit" u ON u."id" = sli."unitId"
       WHERE sli."deletedAt" IS NULL AND sli."id" IN ${IDS}
       ORDER BY sli.rowid`,
      S,
    ],
  ];
}

function recipeDocuments(sources: SearchSources): SearchDocumentInput[] {
  const userById = new Map(sources.users.map((user) => [user.id, user]));
  const coversByRecipeId = groupedBy(sources.covers, (cover) => cover.recipeId);
  const stepsByRecipeId = groupedBy(sources.steps, (step) => step.recipeId);
  const ingredientsByStep = groupedBy(
    sources.ingredients,
    (ingredient) => `${ingredient.recipeId}:${ingredient.stepNum}`
  );
  const unitById = new Map(sources.units.map((unit) => [unit.id, unit]));
  const ingredientRefById = new Map(sources.ingredientRefs.map((ingredientRef) => [ingredientRef.id, ingredientRef]));
  const cookbookById = new Map(sources.cookbooks.map((cookbook) => [cookbook.id, cookbook]));
  const cookbookLinksByRecipeId = groupedBy(sources.recipeCookbooks, (link) => link.recipeId);

  return sources.recipes.filter((recipe) => recipe.deletedAt === null).map((recipe) => {
    const chef = userById.get(recipe.chefId)!;
    const recipeSteps = stepsByRecipeId.get(recipe.id) ?? [];
    const cookbookTitles = uniqueSorted(
      (cookbookLinksByRecipeId.get(recipe.id) ?? []).map((link) => cookbookById.get(link.cookbookId)!.title)
    );
    const stepText = recipeSteps.flatMap((step) => {
      const stepIngredients = ingredientsByStep.get(`${recipe.id}:${step.stepNum}`) ?? [];

      return [
        step.stepTitle,
        step.description,
        ...stepIngredients.map((ingredient) =>
          compactText([
            String(ingredient.quantity),
            unitById.get(ingredient.unitId)!.name,
            ingredientRefById.get(ingredient.ingredientRefId)!.name,
          ])
        ),
      ];
    });
    const ingredientNames = uniqueSorted(
      recipeSteps.flatMap((step) =>
        (ingredientsByStep.get(`${recipe.id}:${step.stepNum}`) ?? []).map(
          (ingredient) => ingredientRefById.get(ingredient.ingredientRefId)!.name
        )
      )
    );

    const coverDisplay = getRecipeCoverDisplay(recipe, coversByRecipeId.get(recipe.id) ?? []);

    return {
      type: "recipe" as const,
      id: recipe.id,
      ownerId: recipe.chefId,
      ownerUsername: chef.username,
      sortAt: recipe.updatedAt.toISOString(),
      title: recipe.title,
      subtitle: `Recipe by ${chef.username}`,
      body: compactText([
        recipe.description,
        recipe.sourceUrl,
        chef.username,
        ...cookbookTitles,
        ...stepText,
      ]),
      href: `/recipes/${recipe.id}`,
      imageUrl: coverDisplay?.displayUrl ?? null,
      metadata: {
        servings: recipe.servings,
        chefUsername: chef.username,
        ingredientNames,
        stepCount: recipeSteps.length,
        cookbookTitles,
        coverProvenanceLabel: coverDisplay?.provenanceLabel ?? null,
        coverSourceType: coverDisplay?.sourceType ?? null,
        coverVariant: coverDisplay?.activeVariant ?? null,
      },
    };
  });
}

function cookbookDocuments(sources: SearchSources): SearchDocumentInput[] {
  const userById = new Map(sources.users.map((user) => [user.id, user]));
  const recipeById = new Map(sources.recipes.map((recipe) => [recipe.id, recipe]));
  const cookbookLinksByCookbookId = groupedBy(sources.recipeCookbooks, (link) => link.cookbookId);

  return sources.cookbooks.map((cookbook) => {
    const author = userById.get(cookbook.authorId)!;
    const activeRecipeTitles = uniqueSorted(
      (cookbookLinksByCookbookId.get(cookbook.id) ?? [])
        .map((link) => recipeById.get(link.recipeId)!)
        .filter((recipe) => !recipe.deletedAt)
        .map((recipe) => recipe.title)
    );

    return {
      type: "cookbook",
      id: cookbook.id,
      ownerId: cookbook.authorId,
      ownerUsername: author.username,
      sortAt: cookbook.updatedAt.toISOString(),
      title: cookbook.title,
      subtitle: `Cookbook by ${author.username}`,
      body: compactText([cookbook.title, author.username, ...activeRecipeTitles]),
      href: `/cookbooks/${cookbook.id}`,
      imageUrl: null,
      metadata: {
        authorUsername: author.username,
        recipeCount: activeRecipeTitles.length,
        recipeTitles: activeRecipeTitles,
      },
    };
  });
}

function chefDocuments(sources: SearchSources): SearchDocumentInput[] {
  return sources.users.map((user) => ({
    type: "chef",
    id: user.id,
    ownerId: user.id,
    ownerUsername: user.username,
    sortAt: user.updatedAt.toISOString(),
    title: user.username,
    subtitle: "Chef kitchen",
    body: compactText([user.username, `recipes ${user.recipeCount}`, `cookbooks ${user.cookbookCount}`]),
    href: `/users/${user.username}`,
    imageUrl: resolveChefAvatarUrl(user.photoUrl),
    metadata: {
      username: user.username,
      recipeCount: user.recipeCount,
      cookbookCount: user.cookbookCount,
    },
  }));
}

function shoppingListDocuments(sources: SearchSources): SearchDocumentInput[] {
  return sources.shoppingItems.map((item) => {
    const quantity = item.quantity === null ? null : String(item.quantity);

    return {
      type: "shopping-list-item",
      id: item.id,
      ownerId: item.ownerId,
      ownerUsername: item.ownerUsername,
      sortAt: item.updatedAt.toISOString(),
      title: item.ingredientName,
      subtitle: `Shopping list item for ${item.ownerUsername}`,
      body: compactText([
        item.ingredientName,
        quantity,
        item.unitName,
        item.categoryKey,
        item.iconKey,
        item.checked ? "checked" : "unchecked",
      ]),
      href: "/shopping-list",
      imageUrl: null,
      metadata: {
        quantity: item.quantity,
        unit: item.unitName,
        checked: item.checked,
        categoryKey: item.categoryKey,
        iconKey: item.iconKey,
        sortIndex: item.sortIndex,
      },
    };
  });
}

function buildSearchDocuments(sources: SearchSources): SearchDocumentInput[] {
  return [
    ...recipeDocuments(sources),
    ...cookbookDocuments(sources),
    ...chefDocuments(sources),
    ...shoppingListDocuments(sources),
  ];
}

// Documents are inserted as JSON arrays expanded by json_each: one bound value per
// statement instead of eleven per row, so a rebuild stays within D1's bound-parameter
// limit and needs few statements. A chunk is capped at 64 Ki UTF-16 code units of JSON (up
// to about 192 KB of UTF-8 for non-ASCII text), well under D1's 2 MB limit for a bound value.

// Documents are inserted as JSON arrays expanded by json_each: one bound value per
// statement instead of eleven per row, so a rebuild stays within D1's bound-parameter
// limit and needs few statements. A chunk is capped at 64 Ki UTF-16 code units of JSON (up
// to about 192 KB of UTF-8 for non-ASCII text), well under D1's 2 MB limit for a bound value.
const SEARCH_INSERT_CHUNK_BYTES = 64 * 1024;

const DOC_KEY_SQL = `json_extract(value, '$[0]') || ':' || json_extract(value, '$[1]')`;

const INSERT_SEARCH_DOCUMENT_KEYS_SQL = `INSERT OR IGNORE INTO "SearchDocumentKey" ("docKey")
  SELECT ${DOC_KEY_SQL} FROM json_each(?) ORDER BY key`;

const INSERT_SEARCH_DOCUMENTS_SQL = `INSERT INTO "SearchDocument" (
    rowid, entityType, entityId, ownerId, ownerUsername, sortAt, title, subtitle, body, href, imageUrl, metadata
  )
  SELECT
    (SELECT k."docRowid" FROM "SearchDocumentKey" k WHERE k."docKey" = ${DOC_KEY_SQL}),
    json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'),
    json_extract(value, '$[3]'), json_extract(value, '$[4]'), json_extract(value, '$[5]'),
    json_extract(value, '$[6]'), json_extract(value, '$[7]'), json_extract(value, '$[8]'),
    json_extract(value, '$[9]'), json_extract(value, '$[10]')
  FROM json_each(?)
  ORDER BY key`;

function searchInsertStatements(documents: SearchDocumentInput[]): D1Query[] {
  const statements: D1Query[] = [];
  const flush = (chunk: string[]) => {
    const json = `[${chunk.join(",")}]`;
    statements.push([INSERT_SEARCH_DOCUMENT_KEYS_SQL, json], [INSERT_SEARCH_DOCUMENTS_SQL, json]);
  };
  let chunk: string[] = [];
  let chunkBytes = 0;
  for (const document of documents) {
    const encoded = JSON.stringify(searchDocumentSqlValues(document));
    if (chunk.length > 0 && chunkBytes + encoded.length > SEARCH_INSERT_CHUNK_BYTES) {
      flush(chunk);
      chunk = [];
      chunkBytes = 0;
    }
    chunk.push(encoded);
    chunkBytes += encoded.length + 1;
  }
  if (chunk.length > 0) {
    flush(chunk);
  }
  return statements;
}

function searchDocumentSqlValues(document: SearchDocumentInput): Array<string | null> {
  return [
    document.type,
    document.id,
    document.ownerId,
    document.ownerUsername,
    document.sortAt,
    document.title,
    document.subtitle,
    document.body,
    document.href,
    document.imageUrl,
    JSON.stringify(document.metadata),
  ];
}

// Rebuilds every document. With `installTriggers`, the triggers go in first, so a write
// that lands while the sources are read is queued and picked up by the next search.
async function rebuildAllSearchDocuments(run: SearchRunner, { installTriggers }: { installTriggers: boolean }): Promise<number> {
  await run(SEARCH_INDEX_SCHEMA_QUERIES);
  if (installTriggers) {
    await run(searchTriggerInstallStatements().map((sql): D1Query => [sql]));
  }

  const [maxSeqRows, ...sourceRows] = await run([[SEARCH_DIRTY_CLOCK_SQL], ...SEARCH_SOURCE_QUERIES]);
  const maxSeq = d1Count(maxSeqRows![0]?.maxSeq, "maxSeq");
  const documents = buildSearchDocuments(mapSearchSources(sourceRows));

  // On D1 this is one batch, so a concurrent search never sees a half-built index.
  await run([
    [DELETE_SEARCH_DOCUMENTS_SQL],
    [DELETE_SEARCH_DOCUMENT_KEYS_SQL],
    ...searchInsertStatements(documents),
    [CLEAR_SEARCH_DIRTY_SQL, maxSeq],
    [WRITE_SEARCH_METADATA_SQL, SEARCH_METADATA_ID, SEARCH_MAINTENANCE_VERSION, documents.length],
  ]);

  return documents.length;
}

function isDirtyEntityType(value: string): value is keyof DirtyEntityIds {
  return value === "recipe" || value === "cookbook" || value === "chef" || value === "shopping-list-item";
}

// Re-indexes only the queued entities: their documents are deleted and rebuilt (or just
// deleted, when the entity is gone or no longer searchable) in one batch.
async function reindexDirtySearchEntities(run: SearchRunner, dirtyRows: SearchDirtyRow[]): Promise<void> {
  const ids: DirtyEntityIds = { recipe: [], cookbook: [], chef: [], "shopping-list-item": [] };
  const keys = new Set<string>();
  for (const row of dirtyRows) {
    if (!isDirtyEntityType(row.entityType)) continue;
    ids[row.entityType].push(row.entityId);
    keys.add(`${row.entityType}:${row.entityId}`);
  }
  const claimed = JSON.stringify(dirtyRows.map((row) => [row.entityType, row.entityId]));

  const documents = keys.size === 0
    ? []
    : buildSearchDocuments(mapSearchSources(await run(targetedSearchSourceQueries(ids))))
      .filter((document) => keys.has(`${document.type}:${document.id}`));
  const lastSeq = Math.max(...dirtyRows.map((row) => row.seq));

  await run([
    [DELETE_SEARCH_DOCUMENTS_BY_KEY_SQL, JSON.stringify([...keys])],
    ...searchInsertStatements(documents),
    [CLEAR_SEARCH_DIRTY_KEYS_SQL, lastSeq, claimed],
  ]);
}

function searchDirtyRows(rows: D1Row[]): SearchDirtyRow[] {
  return rows.map((row) => ({
    seq: d1Count(row.seq, "seq"),
    entityType: String(row.entityType),
    entityId: String(row.entityId),
  }));
}

type SearchIndexState = "current" | "dirty" | "uninstalled";

// One round trip that both checks the index and (when given) runs the search: the schema
// guards, the maintenance marker, a count of the triggers and the head of the queue.
async function readSearchIndexState(
  run: SearchRunner,
  statement: D1Query | null,
): Promise<{ state: SearchIndexState; dirtyRows: SearchDirtyRow[]; resultRows: D1Row[] }> {
  const rows = await run([
    ...SEARCH_INDEX_SCHEMA_QUERIES,
    [SEARCH_METADATA_SQL, SEARCH_METADATA_ID],
    [SEARCH_TRIGGER_COUNT_SQL],
    [SEARCH_DIRTY_SQL],
    ...(statement ? [statement] : []),
  ]);
  const offset = SEARCH_INDEX_SCHEMA_QUERIES.length;
  const metadata = rows[offset]![0] as unknown as SearchIndexMetadataRow | undefined;
  const triggerCount = d1Count(rows[offset + 1]![0]?.triggerCount, "triggerCount");
  const dirtyRows = searchDirtyRows(rows[offset + 2]!);
  const installed = metadata?.sourceFingerprint === SEARCH_MAINTENANCE_VERSION && triggerCount === SEARCH_TRIGGER_NAMES.length;

  return {
    state: !installed ? "uninstalled" : dirtyRows.length > 0 ? "dirty" : "current",
    dirtyRows,
    resultRows: statement ? rows[offset + 3]! : [],
  };
}

// Brings the index up to date. Returns true when it changed anything.
async function bringSearchIndexCurrent(run: SearchRunner, state: SearchIndexState, dirtyRows: SearchDirtyRow[]): Promise<boolean> {
  if (state === "current") return false;
  if (state === "uninstalled") {
    await rebuildAllSearchDocuments(run, { installTriggers: true });
  } else if (dirtyRows.length > MAX_DIRTY_ENTITIES_PER_SEARCH) {
    await rebuildAllSearchDocuments(run, { installTriggers: false });
  } else {
    await reindexDirtySearchEntities(run, dirtyRows);
  }
  return true;
}

/** Rebuilds every search document (and reinstalls the triggers) through Prisma. */
export async function rebuildSearchIndex(database: PrismaClient): Promise<number> {
  return rebuildAllSearchDocuments(prismaSearchRunner(database), { installTriggers: true });
}

/** Brings the index up to date without searching; returns how many documents it holds. */
export async function ensureSearchIndexFresh(database: PrismaClient): Promise<number> {
  const run = prismaSearchRunner(database);
  const { state, dirtyRows } = await readSearchIndexState(run, null);
  await bringSearchIndexCurrent(run, state, dirtyRows);
  const [countRows] = await run([[SEARCH_DOCUMENT_COUNT_SQL]]);
  return d1Count(countRows![0]?.documentCount, "documentCount");
}

interface SearchPlan {
  statement: D1Query;
}

// Validates the options and builds the search statement, or returns null when the
// search cannot match anything (no entity types, or a query with no searchable words).
function planSearch(options: SearchOptions): SearchPlan | null {
  const scope = options.scope ?? "all";
  const query = options.query?.trim() ?? "";
  const limit = normalizeSearchLimit(options.limit);
  const entityTypes = entityTypesForSearch(scope, options.viewerId);

  if (entityTypes.length === 0) {
    return null;
  }

  const terms = toSearchTerms(query);
  if (query && terms.length === 0) {
    return null;
  }

  const where = buildWhereClause(entityTypes, options.ownerId, options.viewerId);

  if (terms.length === 1) {
    return {
      statement: [
        `SELECT
        entityType,
        entityId,
        ownerId,
        ownerUsername,
        title,
        subtitle,
        body,
        href,
        imageUrl,
        metadata,
        bm25("SearchDocument", 0, 0, 0, 0, 0, 8, 3, 1, 0, 0, 0) AS rank,
        snippet("SearchDocument", -1, '', '', '...', 24) AS snippet
      FROM "SearchDocument"
      WHERE "SearchDocument" MATCH ? AND ${where.sql}
      ORDER BY rank ASC, title COLLATE NOCASE ASC
      LIMIT ?`,
        terms[0],
        ...where.values,
        limit,
      ],
    };
  }

  if (terms.length > 1) {
    // Pantry query: a document matching any term is returned, ranked first by how many terms it
    // matches and then by relevance. Every term comes from toFtsQuery, so only prefix words
    // joined by AND/OR reach MATCH, never user-written FTS5 syntax.
    const matchedTermCount = terms
      .map(() => `(rowid IN (SELECT rowid FROM "SearchDocument" WHERE "SearchDocument" MATCH ?))`)
      .join(" + ");
    return {
      statement: [
        `SELECT
        entityType,
        entityId,
        ownerId,
        ownerUsername,
        title,
        subtitle,
        body,
        href,
        imageUrl,
        metadata,
        bm25("SearchDocument", 0, 0, 0, 0, 0, 8, 3, 1, 0, 0, 0) AS rank,
        snippet("SearchDocument", -1, '', '', '...', 24) AS snippet,
        ${matchedTermCount} AS matchedTermCount
      FROM "SearchDocument"
      WHERE "SearchDocument" MATCH ? AND ${where.sql}
      ORDER BY matchedTermCount DESC, rank ASC, title COLLATE NOCASE ASC
      LIMIT ?`,
        ...terms,
        terms.map((term) => `(${term})`).join(" OR "),
        ...where.values,
        limit,
      ],
    };
  }

  return {
    statement: [
      `SELECT
      entityType,
      entityId,
      ownerId,
      ownerUsername,
      title,
      subtitle,
      body,
      href,
      imageUrl,
      metadata,
      0.0 AS rank,
      body AS snippet
    FROM "SearchDocument"
    WHERE ${where.sql}
    ORDER BY sortAt DESC, title COLLATE NOCASE ASC
    LIMIT ?`,
      ...where.values,
      limit,
    ],
  };
}

// The index check and the search go out together. Only when writes are queued (or the
// triggers are missing) does it update the index and search again.
async function searchWithRunner(run: SearchRunner, plan: SearchPlan): Promise<SearchResult[]> {
  const { state, dirtyRows, resultRows } = await readSearchIndexState(run, plan.statement);
  if (!(await bringSearchIndexCurrent(run, state, dirtyRows))) {
    return (resultRows as unknown as SearchRow[]).map(parseRow);
  }
  const [rows] = await run([plan.statement]);
  return (rows as unknown as SearchRow[]).map(parseRow);
}

export async function searchSpoonjoy(database: PrismaClient, options: SearchOptions = {}): Promise<SearchResult[]> {
  const plan = planSearch(options);
  if (!plan) {
    return [];
  }
  return searchWithRunner(prismaSearchRunner(database), plan);
}

/** `searchSpoonjoy` on a D1 binding: usually one batch for the index check and the search. */
export async function searchSpoonjoyFromD1(db: D1ReadDatabase, options: SearchOptions = {}): Promise<SearchResult[]> {
  const plan = planSearch(options);
  if (!plan) {
    return [];
  }
  return searchWithRunner(d1SearchRunner(db), plan);
}
