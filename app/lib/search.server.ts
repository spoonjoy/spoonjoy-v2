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
import { toDate, toNumber } from "~/lib/d1-coerce.server";
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

interface SearchIndexCountRow {
  documentCount: number | bigint;
}

interface RecipeCoverFingerprintRow {
  recipeId: string;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  coverMode: string | null;
  id: string | null;
  createdAt: Date | string | number | bigint | null;
  imageUrl: string | null;
  stylizedImageUrl: string | null;
  sourceType: string | null;
  status: string | null;
  archivedAt: Date | string | number | bigint | null;
}

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const SEARCH_METADATA_ID = "current";
// A pantry query binds one parameter per term; D1 allows 100 bound parameters per query.
const MAX_PANTRY_TERMS = 12;

const SEARCH_SOURCE_TABLES = [
  { tableName: "User", countKey: "userCount", latestKey: "userLatestAt" },
  { tableName: "Recipe", countKey: "recipeCount", latestKey: "recipeLatestAt" },
  { tableName: "RecipeCover", countKey: "recipeCoverCount", latestKey: "recipeCoverLatestAt" },
  { tableName: "RecipeStep", countKey: "recipeStepCount", latestKey: "recipeStepLatestAt" },
  { tableName: "Ingredient", countKey: "ingredientCount", latestKey: "ingredientLatestAt" },
  { tableName: "IngredientRef", countKey: "ingredientRefCount", latestKey: "ingredientRefLatestAt" },
  { tableName: "Unit", countKey: "unitCount", latestKey: "unitLatestAt" },
  { tableName: "Cookbook", countKey: "cookbookCount", latestKey: "cookbookLatestAt" },
  { tableName: "RecipeInCookbook", countKey: "recipeInCookbookCount", latestKey: "recipeInCookbookLatestAt" },
  { tableName: "ShoppingListItem", countKey: "shoppingListItemCount", latestKey: "shoppingListItemLatestAt" },
] as const;

type SearchSourceFingerprintKey = (typeof SEARCH_SOURCE_TABLES)[number]["countKey" | "latestKey"];

type SearchSourceFingerprintRow = Record<SearchSourceFingerprintKey, number | bigint | string | Date | null>;

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

const SEARCH_SOURCE_FINGERPRINT_SQL = `SELECT
  (SELECT COUNT(*) FROM "User") AS userCount,
  (SELECT MAX("updatedAt") FROM "User") AS userLatestAt,
  (SELECT COUNT(*) FROM "Recipe") AS recipeCount,
  (SELECT MAX("updatedAt") FROM "Recipe") AS recipeLatestAt,
  (SELECT COUNT(*) FROM "RecipeCover") AS recipeCoverCount,
  (SELECT MAX("createdAt") FROM "RecipeCover") AS recipeCoverLatestAt,
  (SELECT COUNT(*) FROM "RecipeStep") AS recipeStepCount,
  (SELECT MAX("updatedAt") FROM "RecipeStep") AS recipeStepLatestAt,
  (SELECT COUNT(*) FROM "Ingredient") AS ingredientCount,
  (SELECT MAX("updatedAt") FROM "Ingredient") AS ingredientLatestAt,
  (SELECT COUNT(*) FROM "IngredientRef") AS ingredientRefCount,
  (SELECT MAX("updatedAt") FROM "IngredientRef") AS ingredientRefLatestAt,
  (SELECT COUNT(*) FROM "Unit") AS unitCount,
  (SELECT MAX("updatedAt") FROM "Unit") AS unitLatestAt,
  (SELECT COUNT(*) FROM "Cookbook") AS cookbookCount,
  (SELECT MAX("updatedAt") FROM "Cookbook") AS cookbookLatestAt,
  (SELECT COUNT(*) FROM "RecipeInCookbook") AS recipeInCookbookCount,
  (SELECT MAX("updatedAt") FROM "RecipeInCookbook") AS recipeInCookbookLatestAt,
  (SELECT COUNT(*) FROM "ShoppingListItem") AS shoppingListItemCount,
  (SELECT MAX("updatedAt") FROM "ShoppingListItem") AS shoppingListItemLatestAt
`;

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


async function ensureSearchIndex(database: PrismaClient) {
  await database.$executeRawUnsafe(SEARCH_SCHEMA_SQL);
  await database.$executeRawUnsafe(SEARCH_METADATA_SCHEMA_SQL);
}

function aggregateDateString(value: Date | string | number | bigint | null): string | null {
  if (value === null) {
    return null;
  }

  return toDate(value).toISOString();
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const RECIPE_COVER_FINGERPRINT_SQL = `SELECT
    r."id" AS "recipeId",
    r."activeCoverId" AS "activeCoverId",
    r."activeCoverVariant" AS "activeCoverVariant",
    r."coverMode" AS "coverMode",
    rc."id" AS "id",
    rc."createdAt" AS "createdAt",
    rc."imageUrl" AS "imageUrl",
    rc."stylizedImageUrl" AS "stylizedImageUrl",
    rc."sourceType" AS "sourceType",
    rc."status" AS "status",
    rc."archivedAt" AS "archivedAt"
  FROM "Recipe" r
  LEFT JOIN "RecipeCover" rc
    ON rc."id" = r."activeCoverId"
    AND rc."recipeId" = r."id"
  WHERE r."deletedAt" IS NULL
  ORDER BY r."id" ASC`;

const SEARCH_DOCUMENT_COUNT_SQL = `SELECT COUNT(*) AS documentCount FROM "SearchDocument"`;

const SEARCH_METADATA_SQL = `SELECT "sourceFingerprint", "documentCount" FROM "SearchIndexMetadata" WHERE "id" = ? LIMIT 1`;

const WRITE_SEARCH_METADATA_SQL = `INSERT INTO "SearchIndexMetadata" ("id", "sourceFingerprint", "documentCount", "rebuiltAt")
  VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT("id") DO UPDATE SET
    "sourceFingerprint" = excluded."sourceFingerprint",
    "documentCount" = excluded."documentCount",
    "rebuiltAt" = excluded."rebuiltAt"`;

const DELETE_SEARCH_DOCUMENTS_SQL = `DELETE FROM "SearchDocument"`;

async function recipeCoverContentHash(rows: RecipeCoverFingerprintRow[]): Promise<string> {
  const payload = JSON.stringify(
    rows.map((row) => ({
      recipeId: row.recipeId,
      activeCoverId: row.activeCoverId,
      activeCoverVariant: row.activeCoverVariant,
      coverMode: row.coverMode,
      id: row.id,
      createdAt: aggregateDateString(row.createdAt),
      imageUrl: row.imageUrl,
      stylizedImageUrl: row.stylizedImageUrl,
      sourceType: row.sourceType,
      status: row.status,
      archivedAt: aggregateDateString(row.archivedAt),
    })),
  );
  return `sha256:${await sha256Hex(payload)}`;
}

function fingerprintFromRows(row: SearchSourceFingerprintRow, recipeCoverHash: string): string {
  const normalizedRows = SEARCH_SOURCE_TABLES.map((sourceTable) => ({
    tableName: sourceTable.tableName,
    rowCount: toNumber(row[sourceTable.countKey] as number | bigint),
    latestAt: aggregateDateString(row[sourceTable.latestKey] as Date | string | number | bigint | null),
    contentHash: sourceTable.tableName === "RecipeCover" ? recipeCoverHash : null,
  }));

  return JSON.stringify(normalizedRows);
}

/** What the search index was built from: row counts, latest updates and active cover content. */
export async function searchSourceFingerprint(database: PrismaClient): Promise<string> {
  const [rows, coverRows] = await Promise.all([
    database.$queryRawUnsafe<SearchSourceFingerprintRow[]>(SEARCH_SOURCE_FINGERPRINT_SQL),
    database.$queryRawUnsafe<RecipeCoverFingerprintRow[]>(RECIPE_COVER_FINGERPRINT_SQL),
  ]);
  return fingerprintFromRows(rows[0]!, await recipeCoverContentHash(coverRows));
}

/** `searchSourceFingerprint` read through a D1 binding; the two agree on the same data. */
export async function searchSourceFingerprintFromD1(db: D1ReadDatabase): Promise<string> {
  const [rows, coverRows] = await d1ReadBatch(db, [[SEARCH_SOURCE_FINGERPRINT_SQL], [RECIPE_COVER_FINGERPRINT_SQL]]);
  return fingerprintFromD1Rows(rows!, coverRows!);
}

async function fingerprintFromD1Rows(rows: D1Row[], coverRows: D1Row[]): Promise<string> {
  const row = rows[0];
  if (!row) throw new Error("D1 search fingerprint returned no row");
  return fingerprintFromRows(
    row as SearchSourceFingerprintRow,
    await recipeCoverContentHash(coverRows as unknown as RecipeCoverFingerprintRow[]),
  );
}

function isSearchIndexFresh(
  metadata: SearchIndexMetadataRow | null | undefined,
  documentCount: number,
  sourceFingerprint: string,
): boolean {
  return Boolean(
    metadata &&
    metadata.sourceFingerprint === sourceFingerprint &&
    toNumber(metadata.documentCount) === documentCount,
  );
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

async function loadSearchSourcesWithPrisma(database: PrismaClient): Promise<SearchSources> {
  const users = await database.user.findMany({
    include: {
      _count: { select: { recipes: true, cookbooks: true } },
    },
  });
  const recipes = await database.recipe.findMany({ orderBy: { id: "asc" } });
  const covers = await database.recipeCover.findMany();
  const steps = await database.recipeStep.findMany({
    orderBy: [{ recipeId: "asc" }, { stepNum: "asc" }],
  });
  const ingredients = await database.ingredient.findMany({
    orderBy: [{ recipeId: "asc" }, { stepNum: "asc" }],
  });
  const units = await database.unit.findMany();
  const ingredientRefs = await database.ingredientRef.findMany();
  const recipeCookbooks = await database.recipeInCookbook.findMany();
  const cookbooks = await database.cookbook.findMany();
  const items = await database.shoppingListItem.findMany({
    where: { deletedAt: null },
    include: {
      unit: true,
      ingredientRef: true,
      shoppingList: { include: { author: { select: { id: true, username: true } } } },
    },
  });

  return {
    users: users.map((user) => ({
      id: user.id,
      username: user.username,
      photoUrl: user.photoUrl,
      updatedAt: user.updatedAt,
      recipeCount: user._count.recipes,
      cookbookCount: user._count.cookbooks,
    })),
    recipes,
    covers,
    steps,
    ingredients,
    units,
    ingredientRefs,
    recipeCookbooks,
    cookbooks,
    shoppingItems: items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      checked: item.checked,
      categoryKey: item.categoryKey,
      iconKey: item.iconKey,
      sortIndex: item.sortIndex,
      updatedAt: item.updatedAt,
      unitName: item.unit?.name ?? null,
      ingredientName: item.ingredientRef.name,
      ownerId: item.shoppingList.authorId,
      ownerUsername: item.shoppingList.author.username,
    })),
  };
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
  [`SELECT "recipeId", "stepNum", "stepTitle", "description" FROM "RecipeStep" ORDER BY "recipeId" ASC, "stepNum" ASC`],
  [`SELECT "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId" FROM "Ingredient" ORDER BY "recipeId" ASC, "stepNum" ASC`],
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

async function loadSearchSourcesFromD1(db: D1ReadDatabase): Promise<SearchSources> {
  const [users, recipes, covers, steps, ingredients, units, ingredientRefs, recipeCookbooks, cookbooks, shoppingItems] =
    await d1ReadBatch(db, SEARCH_SOURCE_QUERIES);

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
const SEARCH_INSERT_CHUNK_BYTES = 64 * 1024;

const INSERT_SEARCH_DOCUMENTS_SQL = `INSERT INTO "SearchDocument" (
    entityType, entityId, ownerId, ownerUsername, sortAt, title, subtitle, body, href, imageUrl, metadata
  )
  SELECT
    json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'),
    json_extract(value, '$[3]'), json_extract(value, '$[4]'), json_extract(value, '$[5]'),
    json_extract(value, '$[6]'), json_extract(value, '$[7]'), json_extract(value, '$[8]'),
    json_extract(value, '$[9]'), json_extract(value, '$[10]')
  FROM json_each(?)
  ORDER BY key`;

function searchInsertStatements(documents: SearchDocumentInput[]): D1Query[] {
  const statements: D1Query[] = [];
  let chunk: string[] = [];
  let chunkBytes = 0;
  for (const document of documents) {
    const encoded = JSON.stringify(searchDocumentSqlValues(document));
    if (chunk.length > 0 && chunkBytes + encoded.length > SEARCH_INSERT_CHUNK_BYTES) {
      statements.push([INSERT_SEARCH_DOCUMENTS_SQL, `[${chunk.join(",")}]`]);
      chunk = [];
      chunkBytes = 0;
    }
    chunk.push(encoded);
    chunkBytes += encoded.length + 1;
  }
  if (chunk.length > 0) {
    statements.push([INSERT_SEARCH_DOCUMENTS_SQL, `[${chunk.join(",")}]`]);
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

async function runPrismaStatements(database: PrismaClient, statements: readonly D1Query[]) {
  for (const [sql, ...values] of statements) {
    await database.$executeRawUnsafe(sql, ...values);
  }
}

export async function rebuildSearchIndex(database: PrismaClient): Promise<number> {
  await ensureSearchIndex(database);

  const sourceFingerprint = await searchSourceFingerprint(database);
  const documents = buildSearchDocuments(await loadSearchSourcesWithPrisma(database));

  await runPrismaStatements(database, [
    [DELETE_SEARCH_DOCUMENTS_SQL],
    ...searchInsertStatements(documents),
    [WRITE_SEARCH_METADATA_SQL, SEARCH_METADATA_ID, sourceFingerprint, documents.length],
  ]);

  return documents.length;
}

// The D1 rebuild replaces the index in one batch, so a concurrent search never sees a
// half-built index.
async function rebuildSearchIndexFromD1(db: D1ReadDatabase, sourceFingerprint: string): Promise<number> {
  const documents = buildSearchDocuments(await loadSearchSourcesFromD1(db));
  await d1ReadBatch(db, [
    [DELETE_SEARCH_DOCUMENTS_SQL],
    ...searchInsertStatements(documents),
    [WRITE_SEARCH_METADATA_SQL, SEARCH_METADATA_ID, sourceFingerprint, documents.length],
  ]);
  return documents.length;
}

export async function ensureSearchIndexFresh(database: PrismaClient): Promise<number> {
  await ensureSearchIndex(database);

  const sourceFingerprint = await searchSourceFingerprint(database);
  const [metadataRows, countRows] = await Promise.all([
    database.$queryRawUnsafe<SearchIndexMetadataRow[]>(SEARCH_METADATA_SQL, SEARCH_METADATA_ID),
    database.$queryRawUnsafe<SearchIndexCountRow[]>(SEARCH_DOCUMENT_COUNT_SQL),
  ]);
  const documentCount = toNumber(countRows[0]!.documentCount);

  if (isSearchIndexFresh(metadataRows[0], documentCount, sourceFingerprint)) {
    return documentCount;
  }

  return rebuildSearchIndex(database);
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

export async function searchSpoonjoy(database: PrismaClient, options: SearchOptions = {}): Promise<SearchResult[]> {
  const plan = planSearch(options);
  if (!plan) {
    return [];
  }

  await ensureSearchIndexFresh(database);

  const [sql, ...values] = plan.statement;
  const rows = await database.$queryRawUnsafe<SearchRow[]>(sql, ...values);
  return rows.map(parseRow);
}

/**
 * `searchSpoonjoy` on a D1 binding. The freshness check and the search itself go out as
 * one batch; only when the index is stale does it rebuild (one batch of reads, one batch
 * that replaces the index) and search again.
 */
export async function searchSpoonjoyFromD1(db: D1ReadDatabase, options: SearchOptions = {}): Promise<SearchResult[]> {
  const plan = planSearch(options);
  if (!plan) {
    return [];
  }

  const [, , fingerprintRows, coverRows, metadataRows, countRows, resultRows] = await d1ReadBatch(db, [
    [SEARCH_SCHEMA_SQL],
    [SEARCH_METADATA_SCHEMA_SQL],
    [SEARCH_SOURCE_FINGERPRINT_SQL],
    [RECIPE_COVER_FINGERPRINT_SQL],
    [SEARCH_METADATA_SQL, SEARCH_METADATA_ID],
    [SEARCH_DOCUMENT_COUNT_SQL],
    plan.statement,
  ]);
  const sourceFingerprint = await fingerprintFromD1Rows(fingerprintRows!, coverRows!);
  const documentCount = d1Count(countRows![0]?.documentCount, "documentCount");

  if (isSearchIndexFresh(metadataRows![0] as unknown as SearchIndexMetadataRow | undefined, documentCount, sourceFingerprint)) {
    return (resultRows as unknown as SearchRow[]).map(parseRow);
  }

  await rebuildSearchIndexFromD1(db, sourceFingerprint);
  const [rows] = await d1ReadBatch(db, [plan.statement]);
  return (rows as unknown as SearchRow[]).map(parseRow);
}
