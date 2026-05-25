import type { PrismaClient } from "@prisma/client";
import { resolveChefAvatarUrl } from "~/lib/chef-avatar";
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

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
// D1 has a lower SQL variable limit than local SQLite. A single migrated v1
// recipe can have many steps, so keep Prisma's nested relation loads narrow.
const SEARCH_INDEX_PAGE_SIZE = 1;

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
}

async function insertSearchDocument(database: PrismaClient, document: SearchDocumentInput) {
  await database.$executeRawUnsafe(
    `INSERT INTO "SearchDocument" (
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    JSON.stringify(document.metadata)
  );
}

async function recipeDocuments(database: PrismaClient): Promise<SearchDocumentInput[]> {
  const documents: SearchDocumentInput[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const recipes = await database.recipe.findMany({
      where: { deletedAt: null },
      orderBy: { id: "asc" },
      take: SEARCH_INDEX_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        chef: { select: { id: true, username: true } },
        cookbooks: { include: { cookbook: { select: { title: true } } } },
        covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
        steps: {
          orderBy: { stepNum: "asc" },
          include: { ingredients: { include: { unit: true, ingredientRef: true } } },
        },
      },
    });

    documents.push(
      ...recipes.map((recipe) => {
        const ingredientNames = uniqueSorted(
          recipe.steps.flatMap((step) => step.ingredients.map((ingredient) => ingredient.ingredientRef.name))
        );
        const cookbookTitles = uniqueSorted(recipe.cookbooks.map((item) => item.cookbook.title));
        const stepText = recipe.steps.flatMap((step) => [
          step.stepTitle,
          step.description,
          ...step.ingredients.map((ingredient) =>
            compactText([String(ingredient.quantity), ingredient.unit.name, ingredient.ingredientRef.name])
          ),
        ]);

        return {
          type: "recipe" as const,
          id: recipe.id,
          ownerId: recipe.chefId,
          ownerUsername: recipe.chef.username,
          sortAt: recipe.updatedAt.toISOString(),
          title: recipe.title,
          subtitle: `Recipe by ${recipe.chef.username}`,
          body: compactText([
            recipe.description,
            recipe.sourceUrl,
            recipe.chef.username,
            ...cookbookTitles,
            ...stepText,
          ]),
          href: `/recipes/${recipe.id}`,
          imageUrl: getRecipeCoverImageUrl(recipe, recipe.covers),
          metadata: {
            servings: recipe.servings,
            chefUsername: recipe.chef.username,
            ingredientNames,
            stepCount: recipe.steps.length,
            cookbookTitles,
          },
        };
      })
    );

    hasMore = recipes.length === SEARCH_INDEX_PAGE_SIZE;
    cursor = recipes.at(-1)?.id;
  }

  return documents;
}

async function cookbookDocuments(database: PrismaClient): Promise<SearchDocumentInput[]> {
  const cookbooks = await database.cookbook.findMany({
    include: {
      author: { select: { id: true, username: true } },
      recipes: {
        include: {
          recipe: { select: { title: true, deletedAt: true } },
        },
      },
    },
  });

  return cookbooks.map((cookbook) => {
    const activeRecipeTitles = uniqueSorted(
      cookbook.recipes.filter((item) => !item.recipe.deletedAt).map((item) => item.recipe.title)
    );

    return {
      type: "cookbook",
      id: cookbook.id,
      ownerId: cookbook.authorId,
      ownerUsername: cookbook.author.username,
      sortAt: cookbook.updatedAt.toISOString(),
      title: cookbook.title,
      subtitle: `Cookbook by ${cookbook.author.username}`,
      body: compactText([cookbook.title, cookbook.author.username, ...activeRecipeTitles]),
      href: `/cookbooks/${cookbook.id}`,
      imageUrl: null,
      metadata: {
        authorUsername: cookbook.author.username,
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

  const documents = [
    ...(await recipeDocuments(database)),
    ...(await cookbookDocuments(database)),
    ...(await chefDocuments(database)),
    ...(await shoppingListDocuments(database)),
  ];

  await database.$executeRawUnsafe(`DELETE FROM "SearchDocument"`);

  for (const document of documents) {
    await insertSearchDocument(database, document);
  }

  return documents.length;
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

  await rebuildSearchIndex(database);

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
