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
  User,
} from "@prisma/client";
import { resolveChefAvatarUrl } from "~/lib/chef-avatar";
import { toDate, toNumber } from "~/lib/d1-coerce.server";
import { getRecipeCoverImageUrl } from "~/lib/recipe-cover.server";

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
  id: string;
  recipeId: string;
  createdAt: Date | string | number | bigint | null;
  imageUrl: string;
  stylizedImageUrl: string | null;
}

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const SEARCH_INSERT_COLUMN_COUNT = 11;
const SEARCH_INSERT_BATCH_SIZE = 8;
const SEARCH_METADATA_ID = "current";

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

async function currentRecipeCoverContentHash(database: PrismaClient): Promise<string> {
  const rows = await database.$queryRawUnsafe<RecipeCoverFingerprintRow[]>(
    `SELECT
        "id",
        "recipeId",
        "createdAt",
        "imageUrl",
        "stylizedImageUrl"
      FROM (
        SELECT
          rc."id" AS "id",
          rc."recipeId" AS "recipeId",
          rc."createdAt" AS "createdAt",
          rc."imageUrl" AS "imageUrl",
          rc."stylizedImageUrl" AS "stylizedImageUrl",
          ROW_NUMBER() OVER (
            PARTITION BY rc."recipeId"
            ORDER BY rc."createdAt" DESC, rc."id" DESC
          ) AS rn
        FROM "RecipeCover" rc
        INNER JOIN "Recipe" r ON r."id" = rc."recipeId"
        WHERE r."deletedAt" IS NULL
      )
      WHERE rn = 1
      ORDER BY "recipeId" ASC`
  );
  const payload = JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      recipeId: row.recipeId,
      createdAt: aggregateDateString(row.createdAt),
      imageUrl: row.imageUrl,
      stylizedImageUrl: row.stylizedImageUrl,
    })),
  );
  return `sha256:${await sha256Hex(payload)}`;
}

async function searchSourceFingerprint(database: PrismaClient): Promise<string> {
  const [rows, recipeCoverContentHash] = await Promise.all([
    database.$queryRawUnsafe<SearchSourceFingerprintRow[]>(SEARCH_SOURCE_FINGERPRINT_SQL),
    currentRecipeCoverContentHash(database),
  ]);
  const row = rows[0]!;
  const normalizedRows = SEARCH_SOURCE_TABLES.map((sourceTable) => ({
    tableName: sourceTable.tableName,
    rowCount: toNumber(row[sourceTable.countKey] as number | bigint),
    latestAt: aggregateDateString(row[sourceTable.latestKey] as Date | string | number | bigint | null),
    contentHash: sourceTable.tableName === "RecipeCover" ? recipeCoverContentHash : null,
  }));

  return JSON.stringify(normalizedRows);
}

async function searchDocumentCount(database: PrismaClient): Promise<number> {
  const rows = await database.$queryRawUnsafe<SearchIndexCountRow[]>(
    `SELECT COUNT(*) AS documentCount FROM "SearchDocument"`
  );

  return toNumber(rows[0]!.documentCount);
}

async function currentSearchIndexMetadata(database: PrismaClient): Promise<SearchIndexMetadataRow | null> {
  const rows = await database.$queryRawUnsafe<SearchIndexMetadataRow[]>(
    `SELECT "sourceFingerprint", "documentCount" FROM "SearchIndexMetadata" WHERE "id" = ? LIMIT 1`,
    SEARCH_METADATA_ID
  );

  return rows[0] ?? null;
}

async function writeSearchIndexMetadata(database: PrismaClient, sourceFingerprint: string, documentCount: number) {
  await database.$executeRawUnsafe(
    `INSERT INTO "SearchIndexMetadata" ("id", "sourceFingerprint", "documentCount", "rebuiltAt")
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT("id") DO UPDATE SET
        "sourceFingerprint" = excluded."sourceFingerprint",
        "documentCount" = excluded."documentCount",
        "rebuiltAt" = excluded."rebuiltAt"`,
    SEARCH_METADATA_ID,
    sourceFingerprint,
    documentCount
  );
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

async function insertSearchDocuments(database: PrismaClient, documents: SearchDocumentInput[]) {
  const columns = `(
      entityType,
      entityId,
      ownerId,
      ownerUsername,
      sortAt,
      title,
      subtitle,
      body,
      href,
      imageUrl,
      metadata
    )`;

  for (let offset = 0; offset < documents.length; offset += SEARCH_INSERT_BATCH_SIZE) {
    const batch = documents.slice(offset, offset + SEARCH_INSERT_BATCH_SIZE);
    const rowPlaceholders = `(${Array.from({ length: SEARCH_INSERT_COLUMN_COUNT }, () => "?").join(", ")})`;
    const placeholders = Array.from({ length: batch.length }, () => rowPlaceholders).join(", ");
    const values = batch.flatMap(searchDocumentSqlValues);

    await database.$executeRawUnsafe(
      `INSERT INTO "SearchDocument" ${columns} VALUES ${placeholders}`,
      ...values
    );
  }
}

async function recipeDocuments(database: PrismaClient): Promise<SearchDocumentInput[]> {
  const users = await database.user.findMany();
  const recipes = await database.recipe.findMany({
    where: { deletedAt: null },
    orderBy: { id: "asc" },
  });
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

  const userById = new Map(users.map((user: User) => [user.id, user]));
  const coversByRecipeId = groupedBy(covers, (cover: RecipeCover) => cover.recipeId);
  const stepsByRecipeId = groupedBy(steps, (step: RecipeStep) => step.recipeId);
  const ingredientsByStep = groupedBy(
    ingredients,
    (ingredient: Ingredient) => `${ingredient.recipeId}:${ingredient.stepNum}`
  );
  const unitById = new Map(units.map((unit: Unit) => [unit.id, unit]));
  const ingredientRefById = new Map(ingredientRefs.map((ingredientRef: IngredientRef) => [ingredientRef.id, ingredientRef]));
  const cookbookById = new Map(cookbooks.map((cookbook: Cookbook) => [cookbook.id, cookbook]));
  const cookbookLinksByRecipeId = groupedBy(recipeCookbooks, (link: RecipeInCookbook) => link.recipeId);

  return recipes.map((recipe: Recipe) => {
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
      imageUrl: getRecipeCoverImageUrl(recipe, coversByRecipeId.get(recipe.id) ?? []),
      metadata: {
        servings: recipe.servings,
        chefUsername: chef.username,
        ingredientNames,
        stepCount: recipeSteps.length,
        cookbookTitles,
      },
    };
  });
}

async function cookbookDocuments(database: PrismaClient): Promise<SearchDocumentInput[]> {
  const users = await database.user.findMany();
  const cookbooks = await database.cookbook.findMany();
  const recipeCookbooks = await database.recipeInCookbook.findMany();
  const recipes = await database.recipe.findMany();

  const userById = new Map(users.map((user: User) => [user.id, user]));
  const recipeById = new Map(recipes.map((recipe: Recipe) => [recipe.id, recipe]));
  const cookbookLinksByCookbookId = groupedBy(recipeCookbooks, (link: RecipeInCookbook) => link.cookbookId);

  return cookbooks.map((cookbook: Cookbook) => {
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

async function chefDocuments(database: PrismaClient): Promise<SearchDocumentInput[]> {
  const users = await database.user.findMany({
    include: {
      _count: { select: { recipes: true, cookbooks: true } },
    },
  });

  return users.map((user) => ({
    type: "chef",
    id: user.id,
    ownerId: user.id,
    ownerUsername: user.username,
    sortAt: user.updatedAt.toISOString(),
    title: user.username,
    subtitle: "Chef kitchen",
    body: compactText([user.username, `recipes ${user._count.recipes}`, `cookbooks ${user._count.cookbooks}`]),
    href: `/users/${user.username}`,
    imageUrl: resolveChefAvatarUrl(user.photoUrl),
    metadata: {
      username: user.username,
      recipeCount: user._count.recipes,
      cookbookCount: user._count.cookbooks,
    },
  }));
}

async function shoppingListDocuments(database: PrismaClient): Promise<SearchDocumentInput[]> {
  const items = await database.shoppingListItem.findMany({
    where: { deletedAt: null },
    include: {
      unit: true,
      ingredientRef: true,
      shoppingList: { include: { author: { select: { id: true, username: true } } } },
    },
  });

  return items.map((item) => {
    const unitName = item.unit?.name ?? null;
    const quantity = item.quantity === null ? null : String(item.quantity);

    return {
      type: "shopping-list-item",
      id: item.id,
      ownerId: item.shoppingList.authorId,
      ownerUsername: item.shoppingList.author.username,
      sortAt: item.updatedAt.toISOString(),
      title: item.ingredientRef.name,
      subtitle: `Shopping list item for ${item.shoppingList.author.username}`,
      body: compactText([
        item.ingredientRef.name,
        quantity,
        unitName,
        item.categoryKey,
        item.iconKey,
        item.checked ? "checked" : "unchecked",
      ]),
      href: "/shopping-list",
      imageUrl: null,
      metadata: {
        quantity: item.quantity,
        unit: unitName,
        checked: item.checked,
        categoryKey: item.categoryKey,
        iconKey: item.iconKey,
        sortIndex: item.sortIndex,
      },
    };
  });
}

export async function rebuildSearchIndex(database: PrismaClient): Promise<number> {
  await ensureSearchIndex(database);

  const sourceFingerprint = await searchSourceFingerprint(database);
  const documents = [
    ...(await recipeDocuments(database)),
    ...(await cookbookDocuments(database)),
    ...(await chefDocuments(database)),
    ...(await shoppingListDocuments(database)),
  ];

  await database.$executeRawUnsafe(`DELETE FROM "SearchDocument"`);

  await insertSearchDocuments(database, documents);
  await writeSearchIndexMetadata(database, sourceFingerprint, documents.length);

  return documents.length;
}

export async function ensureSearchIndexFresh(database: PrismaClient): Promise<number> {
  await ensureSearchIndex(database);

  const sourceFingerprint = await searchSourceFingerprint(database);
  const [metadata, documentCount] = await Promise.all([
    currentSearchIndexMetadata(database),
    searchDocumentCount(database),
  ]);

  if (
    metadata &&
    metadata.sourceFingerprint === sourceFingerprint &&
    toNumber(metadata.documentCount) === documentCount
  ) {
    return documentCount;
  }

  return rebuildSearchIndex(database);
}

export async function searchSpoonjoy(database: PrismaClient, options: SearchOptions = {}): Promise<SearchResult[]> {
  const scope = options.scope ?? "all";
  const query = options.query?.trim() ?? "";
  const limit = normalizeSearchLimit(options.limit);
  const entityTypes = entityTypesForSearch(scope, options.viewerId);

  if (entityTypes.length === 0) {
    return [];
  }

  const ftsQuery = toFtsQuery(query);
  if (query && !ftsQuery) {
    return [];
  }

  await ensureSearchIndexFresh(database);

  const where = buildWhereClause(entityTypes, options.ownerId, options.viewerId);

  if (ftsQuery) {
    const rows = await database.$queryRawUnsafe<SearchRow[]>(
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
      ftsQuery,
      ...where.values,
      limit
    );

    return rows.map(parseRow);
  }

  const rows = await database.$queryRawUnsafe<SearchRow[]>(
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
    limit
  );

  return rows.map(parseRow);
}
