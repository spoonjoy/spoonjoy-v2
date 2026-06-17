import type { PrismaClient } from "@prisma/client";
import {
  countFellowChefs,
  countKitchenVisitors,
  listFellowChefs,
  listKitchenVisitors,
} from "~/lib/fellow-chefs.server";
import { getRecipeCoverDisplay } from "~/lib/recipe-cover.server";
import { listSpoonsByChef } from "~/lib/recipe-spoon.server";
import {
  normalizeSearchScope,
  searchSpoonjoy,
  type SearchResult,
  type SearchScope,
} from "~/lib/search.server";
import type { ApiV1ErrorCode } from "~/lib/api-v1-contract.server";

const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_GRAPH_PAGE_SIZE = 50;
const MAX_API_V1_LIMIT = 50;

export type ApiV1UsersSearchResult<T> =
  | { ok: true; status: number; data: T; private?: boolean }
  | { ok: false; code: ApiV1ErrorCode; message: string; details?: unknown };

export interface ApiV1SearchAccess {
  authenticated: boolean;
  viewerId: string | null;
  canReadShoppingList: boolean;
}

type ProfileUser = NonNullable<Awaited<ReturnType<typeof loadProfileUser>>>;

function apiV1UsersSearchError(
  code: ApiV1ErrorCode,
  message: string,
  details?: unknown,
): ApiV1UsersSearchResult<never> {
  return { ok: false, code, message, details };
}

function canonicalUrl(origin: string, href: string): string {
  return new URL(href, origin).toString();
}

function joinedLabel(createdAt: Date) {
  return `Joined ${createdAt.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  })}`;
}

function parseBoundedInteger(
  raw: string | null,
  field: string,
  fallback: number,
  max: number,
): ApiV1UsersSearchResult<number> {
  if (raw === null || raw.trim() === "") {
    return { ok: true, status: 200, data: fallback };
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    return apiV1UsersSearchError(
      "validation_error",
      `${field} must be an integer between 1 and ${max}`,
      { field, min: 1, max },
    );
  }

  return { ok: true, status: 200, data: value };
}

async function loadProfileUser(db: PrismaClient, identifier: string) {
  const userByUsername = await db.user.findUnique({
    where: { username: identifier },
    select: {
      id: true,
      username: true,
      photoUrl: true,
      createdAt: true,
    },
  });

  return userByUsername ?? await db.user.findUnique({
    where: { id: identifier },
    select: {
      id: true,
      username: true,
      photoUrl: true,
      createdAt: true,
    },
  });
}

function profileSummary(profileUser: ProfileUser, origin: string) {
  const href = `/users/${profileUser.username}`;
  return {
    id: profileUser.id,
    username: profileUser.username,
    photoUrl: profileUser.photoUrl,
    joinedLabel: joinedLabel(profileUser.createdAt),
    href,
    canonicalUrl: canonicalUrl(origin, href),
  };
}

function profileLink(profileUser: ProfileUser, origin: string) {
  const href = `/users/${profileUser.username}`;
  return {
    id: profileUser.id,
    username: profileUser.username,
    href,
    canonicalUrl: canonicalUrl(origin, href),
  };
}

function recipeCoverFields(recipe: {
  id: string;
  title: string;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  coverMode: string | null;
  covers: Array<{
    id: string;
    recipeId: string;
    imageUrl: string;
    stylizedImageUrl: string | null;
    sourceType: string;
    sourceSpoonId: string | null;
    activeForRecipes?: unknown;
    status: string;
    createdById: string | null;
    sourceImageUrl: string | null;
    generationStatus: string;
    failureReason: string | null;
    promptVersion: string | null;
    styleVersion: string | null;
    archivedAt: Date | null;
    createdAt: Date;
  }>;
}) {
  const display = getRecipeCoverDisplay(recipe, recipe.covers);
  return {
    coverImageUrl: display?.displayUrl ?? null,
    coverProvenanceLabel: display?.provenanceLabel ?? null,
  };
}

function profileRecipe(recipe: Awaited<ReturnType<typeof loadProfileRecipes>>[number], origin: string) {
  const href = `/recipes/${recipe.id}`;
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    ...recipeCoverFields(recipe),
    href,
    canonicalUrl: canonicalUrl(origin, href),
  };
}

async function loadProfileRecipes(db: PrismaClient, profileUserId: string) {
  return db.recipe.findMany({
    where: {
      chefId: profileUserId,
      deletedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      servings: true,
      activeCoverId: true,
      activeCoverVariant: true,
      coverMode: true,
      covers: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
    },
  });
}

async function loadProfileCookbooks(db: PrismaClient, profileUserId: string) {
  return db.cookbook.findMany({
    where: { authorId: profileUserId },
    orderBy: { updatedAt: "desc" },
    include: {
      recipes: {
        orderBy: { createdAt: "desc" },
        include: {
          recipe: {
            select: {
              id: true,
              title: true,
              deletedAt: true,
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
}

function profileCookbook(cookbook: Awaited<ReturnType<typeof loadProfileCookbooks>>[number], origin: string) {
  const activeRecipeEntries = cookbook.recipes.filter((entry) => !entry.recipe.deletedAt);
  const href = `/cookbooks/${cookbook.id}`;
  return {
    id: cookbook.id,
    title: cookbook.title,
    recipeCount: activeRecipeEntries.length,
    recipes: activeRecipeEntries.slice(0, 4).map((entry) => ({
      id: entry.recipe.id,
      title: entry.recipe.title,
      ...recipeCoverFields(entry.recipe),
      href: `/recipes/${entry.recipe.id}`,
      canonicalUrl: canonicalUrl(origin, `/recipes/${entry.recipe.id}`),
    })),
    href,
    canonicalUrl: canonicalUrl(origin, href),
  };
}

function recentSpoon(spoon: Awaited<ReturnType<typeof listSpoonsByChef>>[number]) {
  const display = getRecipeCoverDisplay(spoon.recipe, spoon.recipe.covers);
  return {
    id: spoon.id,
    cookedAt: spoon.cookedAt.toISOString(),
    photoUrl: spoon.photoUrl,
    note: spoon.note,
    nextTime: spoon.nextTime,
    chef: {
      id: spoon.chef.id,
      username: spoon.chef.username,
      photoUrl: spoon.chef.photoUrl,
    },
    recipe: {
      id: spoon.recipe.id,
      title: spoon.recipe.title,
      chefId: spoon.recipe.chefId,
    },
    coverImageUrl: display?.displayUrl ?? null,
    coverProvenanceLabel: display?.provenanceLabel ?? null,
  };
}

export async function loadNativeUserProfile(
  db: PrismaClient,
  identifier: string,
  origin: string,
  viewerId: string | null,
): Promise<ApiV1UsersSearchResult<unknown>> {
  const profileUser = await loadProfileUser(db, identifier);
  if (!profileUser) {
    return apiV1UsersSearchError("not_found", "Chef profile not found", {
      resource: "user_profile",
      identifier,
    });
  }

  const [recipes, cookbooks, recentSpoons, fellowChefsCount, kitchenVisitorsCount] = await Promise.all([
    loadProfileRecipes(db, profileUser.id),
    loadProfileCookbooks(db, profileUser.id),
    listSpoonsByChef(db, profileUser.id, { limit: 10 }),
    countFellowChefs(db, profileUser.id),
    countKitchenVisitors(db, profileUser.id),
  ]);

  return {
    ok: true,
    status: 200,
    data: {
      profile: profileSummary(profileUser, origin),
      isOwner: viewerId === profileUser.id,
      recipes: recipes.map((recipe) => profileRecipe(recipe, origin)),
      cookbooks: cookbooks.map((cookbook) => profileCookbook(cookbook, origin)),
      recentSpoons: recentSpoons.map(recentSpoon),
      fellowChefsCount,
      kitchenVisitorsCount,
    },
  };
}

function graphRow(row: Awaited<ReturnType<typeof listFellowChefs>>["rows"][number], origin: string) {
  const href = `/users/${row.username}`;
  return {
    chefId: row.chefId,
    username: row.username,
    photoUrl: row.photoUrl,
    href,
    canonicalUrl: canonicalUrl(origin, href),
    interactionCounts: row.interactionCounts,
    latestInteractionAt: row.latestInteractionAt.toISOString(),
  };
}

export async function listNativeProfileGraph(
  db: PrismaClient,
  identifier: string,
  origin: string,
  url: URL,
  direction: "fellow-chefs" | "kitchen-visitors",
): Promise<ApiV1UsersSearchResult<unknown>> {
  const profileUser = await loadProfileUser(db, identifier);
  if (!profileUser) {
    return apiV1UsersSearchError("not_found", "Chef profile not found", {
      resource: "user_profile",
      identifier,
    });
  }

  const pageResult = parseBoundedInteger(url.searchParams.get("page"), "page", 1, Number.MAX_SAFE_INTEGER);
  if (!pageResult.ok) return pageResult;
  const pageSizeResult = parseBoundedInteger(
    url.searchParams.get("limit") ?? url.searchParams.get("pageSize"),
    "limit",
    DEFAULT_GRAPH_PAGE_SIZE,
    MAX_API_V1_LIMIT,
  );
  if (!pageSizeResult.ok) return pageSizeResult;

  const page = pageResult.data;
  const pageSize = pageSizeResult.data;
  const offset = (page - 1) * pageSize;
  const graph = direction === "fellow-chefs"
    ? await listFellowChefs(db, profileUser.id, { limit: pageSize, offset })
    : await listKitchenVisitors(db, profileUser.id, { limit: pageSize, offset });

  return {
    ok: true,
    status: 200,
    data: {
      profile: profileLink(profileUser, origin),
      page,
      pageSize,
      total: graph.total,
      nextCursor: offset + graph.rows.length < graph.total ? String(page + 1) : null,
      rows: graph.rows.map((row) => graphRow(row, origin)),
    },
  };
}

function parseSearchLimit(url: URL): ApiV1UsersSearchResult<number> {
  return parseBoundedInteger(url.searchParams.get("limit"), "limit", DEFAULT_SEARCH_LIMIT, MAX_API_V1_LIMIT);
}

function searchResultPayload(result: SearchResult, origin: string) {
  return {
    type: result.type,
    id: result.id,
    ownerId: result.ownerId,
    ownerUsername: result.ownerUsername,
    owner: {
      id: result.ownerId,
      username: result.ownerUsername,
    },
    title: result.title,
    subtitle: result.subtitle,
    snippet: result.snippet,
    href: result.href,
    canonicalUrl: canonicalUrl(origin, result.href),
    imageUrl: result.imageUrl,
    score: result.score,
    metadata: result.metadata,
  };
}

export async function searchNativeSpoonjoy(
  db: PrismaClient,
  url: URL,
  origin: string,
  access: ApiV1SearchAccess,
): Promise<ApiV1UsersSearchResult<unknown>> {
  const query = (url.searchParams.get("query") ?? url.searchParams.get("q") ?? "").trim();
  const scope: SearchScope = normalizeSearchScope(url.searchParams.get("scope"));
  const limitResult = parseSearchLimit(url);
  if (!limitResult.ok) return limitResult;
  if (scope === "shopping-list" && !access.canReadShoppingList) {
    return apiV1UsersSearchError(
      access.authenticated ? "insufficient_scope" : "authentication_required",
      access.authenticated ? "Missing required scope: shopping_list:read" : "Authentication required",
      { scopes: ["shopping_list:read", "kitchen:read"] },
    );
  }

  const results = await searchSpoonjoy(db, {
    query,
    scope,
    limit: limitResult.data,
    viewerId: access.canReadShoppingList ? access.viewerId : null,
  });
  const containsPrivateShoppingList = results.some((result) => result.type === "shopping-list-item");

  return {
    ok: true,
    status: 200,
    private: access.canReadShoppingList && (scope === "shopping-list" || containsPrivateShoppingList),
    data: {
      query,
      scope,
      limit: limitResult.data,
      isAuthenticated: access.authenticated,
      results: results.map((result) => searchResultPayload(result, origin)),
    },
  };
}
