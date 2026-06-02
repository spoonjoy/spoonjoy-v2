import type { ApiCredential } from "@prisma/client";
import {
  ApiAuthError,
  authenticateApiRequest,
  createApiCredential,
  expandCredentialScopes,
  normalizeCredentialScopes,
  type ApiPrincipal,
} from "~/lib/api-auth.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { API_V1_DISCOVERY_DATA, API_V1_ERROR_STATUS, type ApiV1ErrorCode } from "~/lib/api-v1-contract.server";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

export interface ApiV1RouteArgs {
  request: Request;
  params: { "*": string };
  context: {
    cloudflare?: {
      env?: Env | null;
    };
  };
}

export class ApiV1Error extends Error {
  code: ApiV1ErrorCode;
  status: number;
  details?: unknown;

  constructor(code: ApiV1ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiV1Error";
    this.code = code;
    this.status = API_V1_ERROR_STATUS[code];
    this.details = details;
  }
}

export function requestIdFor(request: Request): string {
  const incoming = request.headers.get("X-Request-Id")?.trim();
  return incoming || `req_${crypto.randomUUID()}`;
}

export function apiV1Headers(requestId: string, json = true): Headers {
  const headers = new Headers({
    "X-Request-Id": requestId,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-Id",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "X-Request-Id",
  });
  if (json) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  return headers;
}

export function apiV1Success(requestId: string, data: unknown, status = 200): Response {
  return Response.json({ ok: true, requestId, data }, {
    status,
    headers: apiV1Headers(requestId),
  });
}

export function apiV1ErrorResponse(requestId: string, error: ApiV1Error): Response {
  const body: {
    ok: false;
    requestId: string;
    error: { code: ApiV1ErrorCode; message: string; status: number; details?: unknown };
  } = {
    ok: false,
    requestId,
    error: {
      code: error.code,
      message: error.message,
      status: error.status,
    },
  };
  if (error.details !== undefined) {
    body.error.details = error.details;
  }
  return Response.json(body, {
    status: error.status,
    headers: apiV1Headers(requestId),
  });
}

export async function parseApiV1JsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) return {};

  const text = await request.text();
  if (!text.trim()) return {};

  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    throw new ApiV1Error("invalid_json", "Invalid JSON body");
  }

  throw new ApiV1Error("validation_error", "JSON body must be an object");
}

export function normalizeApiV1AuthError(error: ApiAuthError): ApiV1Error {
  if (error.status === 401 && error.message === "Invalid API token") {
    return new ApiV1Error("invalid_token", error.message);
  }
  if (error.status === 400) {
    return new ApiV1Error("validation_error", error.message);
  }
  if (error.status === 403) {
    return new ApiV1Error("insufficient_scope", error.message);
  }
  return new ApiV1Error("authentication_required", error.message);
}

async function optionalPrincipal(args: ApiV1RouteArgs): Promise<ApiPrincipal | null> {
  const db = await getRequestDb(args.context);
  try {
    return await authenticateApiRequest(db, args.request, args.context.cloudflare?.env ?? null);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      throw normalizeApiV1AuthError(error);
    }
    throw error;
  }
}

function principalSummary(principal: ApiPrincipal | null) {
  if (!principal) return null;
  return {
    id: principal.id,
    username: principal.username,
    source: principal.source,
  };
}

function assertScope(principal: ApiPrincipal | null, scope: string) {
  if (principal && !principal.scopes.includes(scope)) {
    throw new ApiV1Error("insufficient_scope", `Missing required scope: ${scope}`);
  }
}

function requirePrincipal(principal: ApiPrincipal | null): ApiPrincipal {
  if (!principal) {
    throw new ApiV1Error("authentication_required", "Authentication required");
  }
  return principal;
}

function assertPrincipalScope(principal: ApiPrincipal, scope: string) {
  if (!principal.scopes.includes(scope)) {
    throw new ApiV1Error("insufficient_scope", `Missing required scope: ${scope}`);
  }
}

function parseListLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw.trim() === "") return DEFAULT_LIST_LIMIT;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new ApiV1Error("validation_error", "limit must be an integer between 1 and 50");
  }
  return limit;
}

type RecipeSummaryRow = {
  id: string;
  title: string;
  description: string | null;
  servings: string | null;
  chef: { id: string; username: string };
  createdAt: Date;
  updatedAt: Date;
};

function recipeSummary(recipe: RecipeSummaryRow) {
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    chef: { id: recipe.chef.id, username: recipe.chef.username },
    href: `/recipes/${recipe.id}`,
    createdAt: recipe.createdAt.toISOString(),
    updatedAt: recipe.updatedAt.toISOString(),
  };
}

function recipeDetail(recipe: RecipeRow) {
  return {
    ...recipeSummary(recipe),
    steps: [...recipe.steps]
      .sort((a, b) => a.stepNum - b.stepNum)
      .map((step) => ({
        id: step.id,
        stepNum: step.stepNum,
        stepTitle: step.stepTitle,
        description: step.description,
        duration: step.duration,
        ingredients: [...step.ingredients]
          .sort((a, b) => a.ingredientRef.name.localeCompare(b.ingredientRef.name))
          .map((ingredient) => ({
            id: ingredient.id,
            name: ingredient.ingredientRef.name,
            quantity: ingredient.quantity,
            unit: ingredient.unit.name,
          })),
      })),
    cookbooks: recipe.cookbooks.map((entry) => ({
      id: entry.cookbook.id,
      title: entry.cookbook.title,
      href: `/cookbooks/${entry.cookbook.id}`,
    })),
  };
}

type RecipeRow = NonNullable<Awaited<ReturnType<typeof loadRecipeById>>>;
type CookbookRow = NonNullable<Awaited<ReturnType<typeof loadCookbookById>>>;

async function loadRecipeById(db: Awaited<ReturnType<typeof getRequestDb>>, id: string) {
  return db.recipe.findFirst({
    where: { id, deletedAt: null },
    include: {
      chef: { select: { id: true, username: true } },
      steps: {
        include: { ingredients: { include: { ingredientRef: true, unit: true } } },
      },
      cookbooks: {
        include: { cookbook: { select: { id: true, title: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

async function handleRecipeList(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal | null) {
  assertScope(principal, "recipes:read");
  const db = await getRequestDb(args.context);
  const url = new URL(args.request.url);
  const query = (url.searchParams.get("query") ?? url.searchParams.get("q") ?? "").trim();
  const limit = parseListLimit(url);
  const recipes = await db.recipe.findMany({
    where: {
      deletedAt: null,
      ...(query
        ? {
            OR: [
              { title: { contains: query } },
              { description: { contains: query } },
            ],
          }
        : {}),
    },
    include: {
      chef: { select: { id: true, username: true } },
      steps: {
        include: { ingredients: { include: { ingredientRef: true, unit: true } } },
      },
      cookbooks: { include: { cookbook: { select: { id: true, title: true } } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
  });

  return apiV1Success(requestId, {
    query: query || null,
    limit,
    recipes: recipes.map(recipeSummary),
  });
}

async function handleRecipeDetail(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal | null, id: string) {
  assertScope(principal, "recipes:read");
  const db = await getRequestDb(args.context);
  const recipe = await loadRecipeById(db, id);
  if (!recipe) {
    throw new ApiV1Error("not_found", "Recipe not found");
  }

  return apiV1Success(requestId, { recipe: recipeDetail(recipe) });
}

function activeCookbookRecipeEntries(cookbook: CookbookRow) {
  return cookbook.recipes.filter((entry) => !entry.recipe.deletedAt);
}

function cookbookSummary(cookbook: CookbookRow) {
  return {
    id: cookbook.id,
    title: cookbook.title,
    chef: { id: cookbook.author.id, username: cookbook.author.username },
    recipeCount: activeCookbookRecipeEntries(cookbook).length,
    href: `/cookbooks/${cookbook.id}`,
    createdAt: cookbook.createdAt.toISOString(),
    updatedAt: cookbook.updatedAt.toISOString(),
  };
}

function cookbookDetail(cookbook: CookbookRow) {
  return {
    ...cookbookSummary(cookbook),
    recipes: activeCookbookRecipeEntries(cookbook).map((entry) => recipeSummary(entry.recipe)),
  };
}

async function loadCookbookById(db: Awaited<ReturnType<typeof getRequestDb>>, id: string) {
  return db.cookbook.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, username: true } },
      recipes: {
        include: {
          recipe: {
            include: {
              chef: { select: { id: true, username: true } },
            },
          },
        },
        orderBy: [{ createdAt: "asc" }, { recipeId: "asc" }],
      },
    },
  });
}

async function handleCookbookList(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal | null) {
  assertScope(principal, "cookbooks:read");
  const db = await getRequestDb(args.context);
  const url = new URL(args.request.url);
  const query = (url.searchParams.get("query") ?? url.searchParams.get("q") ?? "").trim();
  const limit = parseListLimit(url);
  const cookbooks = await db.cookbook.findMany({
    where: query
      ? {
          OR: [
            { title: { contains: query } },
            { author: { username: { contains: query } } },
          ],
        }
      : {},
    include: {
      author: { select: { id: true, username: true } },
      recipes: {
        include: {
          recipe: {
            include: {
              chef: { select: { id: true, username: true } },
            },
          },
        },
        orderBy: [{ createdAt: "asc" }, { recipeId: "asc" }],
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
  });

  return apiV1Success(requestId, {
    query: query || null,
    limit,
    cookbooks: cookbooks.map(cookbookSummary),
  });
}

async function handleCookbookDetail(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal | null, id: string) {
  assertScope(principal, "cookbooks:read");
  const db = await getRequestDb(args.context);
  const cookbook = await loadCookbookById(db, id);
  if (!cookbook) {
    throw new ApiV1Error("not_found", "Cookbook not found");
  }

  return apiV1Success(requestId, { cookbook: cookbookDetail(cookbook) });
}

function credentialMetadata(credential: ApiCredential) {
  return {
    id: credential.id,
    name: credential.name,
    tokenPrefix: credential.tokenPrefix,
    scopes: expandCredentialScopes(credential.scopes),
    createdAt: credential.createdAt.toISOString(),
    updatedAt: credential.updatedAt.toISOString(),
    lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
    revokedAt: credential.revokedAt?.toISOString() ?? null,
    expiresAt: credential.expiresAt?.toISOString() ?? null,
  };
}

function assertKnownFields(body: Record<string, unknown>, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(body).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new ApiV1Error("validation_error", "Unknown request body fields", { fields: unknown });
  }
}

function nonblankString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiV1Error("validation_error", `${field} must be a nonblank string`);
  }
  return value.trim();
}

function normalizeCreateTokenScopes(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return normalizeScopesOrInvalidScope(value);
  if (Array.isArray(value) && value.every((scope) => typeof scope === "string")) {
    return normalizeScopesOrInvalidScope(value);
  }
  throw new ApiV1Error("validation_error", "scopes must be a string or string array");
}

function normalizeScopesOrInvalidScope(scopes: string | string[]) {
  try {
    return normalizeCredentialScopes(scopes);
  } catch (error) {
    const { message } = error as Error;
    throw new ApiV1Error("invalid_scope", message);
  }
}

function bearerDefaultCreateScopes(principal: ApiPrincipal) {
  return principal.scopes.filter((scope) => scope !== "offline_access").sort();
}

function assertBearerScopeSubset(principal: ApiPrincipal, storedScopes: string) {
  if (principal.source !== "bearer") return;
  const requestedScopes = expandCredentialScopes(storedScopes);
  const callerScopes = new Set(principal.scopes.filter((scope) => scope !== "offline_access"));
  const missing = requestedScopes.filter((scope) => !callerScopes.has(scope));
  if (missing.length > 0) {
    throw new ApiV1Error("insufficient_scope", "Cannot create a token with scopes outside the caller's scopes", { scopes: missing });
  }
}

async function handleTokenList(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal | null) {
  const authenticated = requirePrincipal(principal);
  assertPrincipalScope(authenticated, "tokens:read");
  const db = await getRequestDb(args.context);
  const credentials = await db.apiCredential.findMany({
    where: { userId: authenticated.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  return apiV1Success(requestId, { tokens: credentials.map(credentialMetadata) });
}

async function handleTokenCreate(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal | null) {
  const authenticated = requirePrincipal(principal);
  assertPrincipalScope(authenticated, "tokens:write");
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["name", "scopes"]);
  const name = nonblankString(body.name, "name");
  const normalizedScopes = normalizeCreateTokenScopes(body.scopes);
  const storedScopes = normalizedScopes ?? (
    authenticated.source === "bearer"
      ? normalizeScopesOrInvalidScope(bearerDefaultCreateScopes(authenticated))
      : undefined
  );
  if (storedScopes !== undefined) {
    assertBearerScopeSubset(authenticated, storedScopes);
  }

  const db = await getRequestDb(args.context);
  const created = await createApiCredential(db, authenticated.id, name, { scopes: storedScopes });

  return apiV1Success(requestId, {
    token: created.token,
    credential: credentialMetadata(created.credential),
  }, 201);
}

async function handleTokenRevoke(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal | null, credentialId: string) {
  const authenticated = requirePrincipal(principal);
  assertPrincipalScope(authenticated, "tokens:write");
  const db = await getRequestDb(args.context);
  const credential = await db.apiCredential.findFirst({
    where: { id: credentialId, userId: authenticated.id },
  });
  if (!credential) {
    throw new ApiV1Error("not_found", "API token not found");
  }

  const revoked = credential.revokedAt === null;
  const updated = revoked
    ? await db.apiCredential.update({
        where: { id: credential.id },
        data: { revokedAt: new Date() },
      })
    : credential;

  return apiV1Success(requestId, {
    revoked,
    credential: credentialMetadata(updated),
  });
}

export async function handleApiV1Request(args: ApiV1RouteArgs): Promise<Response> {
  const requestId = requestIdFor(args.request);

  try {
    if (args.request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: apiV1Headers(requestId, false) });
    }

    const path = args.params["*"] ?? "";
    if (args.request.method === "GET" && path === "") {
      await optionalPrincipal(args);
      return apiV1Success(requestId, API_V1_DISCOVERY_DATA);
    }

    if (args.request.method === "GET" && path === "health") {
      const principal = await optionalPrincipal(args);
      return apiV1Success(requestId, {
        ok: true,
        version: "v1",
        authenticated: Boolean(principal),
        principal: principalSummary(principal),
        scopes: principal?.scopes ?? [],
      });
    }

    if (args.request.method === "GET" && path === "openapi.json") {
      await optionalPrincipal(args);
      return apiV1Success(requestId, { openapi: "3.1.0", info: { title: "Spoonjoy API", version: "v1" } });
    }

    if (args.request.method === "GET" && path === "recipes") {
      const principal = await optionalPrincipal(args);
      return await handleRecipeList(args, requestId, principal);
    }

    const segments = path.split("/").filter(Boolean);
    if (args.request.method === "GET" && segments[0] === "recipes" && segments.length === 2) {
      const principal = await optionalPrincipal(args);
      return await handleRecipeDetail(args, requestId, principal, segments[1]);
    }

    if (args.request.method === "GET" && path === "cookbooks") {
      const principal = await optionalPrincipal(args);
      return await handleCookbookList(args, requestId, principal);
    }

    if (args.request.method === "GET" && segments[0] === "cookbooks" && segments.length === 2) {
      const principal = await optionalPrincipal(args);
      return await handleCookbookDetail(args, requestId, principal, segments[1]);
    }

    if (args.request.method === "GET" && path === "tokens") {
      const principal = await optionalPrincipal(args);
      return await handleTokenList(args, requestId, principal);
    }

    if (args.request.method === "POST" && path === "tokens") {
      const principal = await optionalPrincipal(args);
      return await handleTokenCreate(args, requestId, principal);
    }

    if (args.request.method === "DELETE" && segments[0] === "tokens" && segments.length === 2) {
      const principal = await optionalPrincipal(args);
      return await handleTokenRevoke(args, requestId, principal, segments[1]);
    }

    if (args.request.method !== "GET" && args.request.method !== "POST" && args.request.method !== "PATCH" && args.request.method !== "DELETE") {
      throw new ApiV1Error("method_not_allowed", "Method not allowed");
    }

    if (path === "health") {
      throw new ApiV1Error("method_not_allowed", "Method not allowed");
    }

    throw new ApiV1Error("not_found", `Unknown Spoonjoy API v1 endpoint: /api/v1/${path}`);
  } catch (error) {
    if (error instanceof ApiV1Error) {
      return apiV1ErrorResponse(requestId, error);
    }

    return apiV1ErrorResponse(requestId, normalizeApiV1InternalError(error));
  }
}

export function normalizeApiV1InternalError(error: unknown): ApiV1Error {
  return error instanceof Error
    ? new ApiV1Error("internal_error", error.message)
    : new ApiV1Error("internal_error", "Internal error");
}
