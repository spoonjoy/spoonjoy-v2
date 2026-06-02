import type { ApiCredential } from "@prisma/client";
import {
  ApiAuthError,
  authenticateApiRequest,
  createApiCredential,
  expandCredentialScopes,
  normalizeCredentialScopes,
  type ApiPrincipal,
} from "~/lib/api-auth.server";
import {
  completeIdempotencyKey,
  hashIdempotencyRequest,
  idempotencyClientKey,
  replayIdempotencyResponse,
  reserveIdempotencyKey,
} from "~/lib/api-idempotency.server";
import { buildApiV1OpenApiDocument } from "~/lib/api-v1-openapi.server";
import { enforceRateLimit } from "~/lib/rate-limit.server";
import { getRequestDb } from "~/lib/route-platform.server";
import {
  API_V1_DISCOVERY_DATA,
  API_V1_ERROR_STATUS,
  API_V1_RESOURCES,
  API_V1_SCOPE_REQUIREMENTS,
  type ApiV1ErrorCode,
} from "~/lib/api-v1-contract.server";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

export interface ApiV1ScopeRequirement {
  auth: "optional" | "bearer";
  scopes: readonly string[];
}

type ApiV1ScopeRule = ApiV1ScopeRequirement & {
  method: string;
  path: string;
};

const API_V1_SCOPE_RULES: readonly ApiV1ScopeRule[] = API_V1_SCOPE_REQUIREMENTS;

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

async function enforceApiV1RateLimit(args: ApiV1RouteArgs, requestId: string): Promise<Response | null> {
  const env = args.context.cloudflare?.env;
  const rateLimit = await enforceRateLimit({
    authorization: args.request.headers.get("Authorization"),
    ip: args.request.headers.get("CF-Connecting-IP"),
    tokenLimiter: env?.API_TOKEN_RATE_LIMITER,
    ipLimiter: env?.API_IP_RATE_LIMITER,
  });
  if (rateLimit.allowed) return null;

  const response = apiV1ErrorResponse(
    requestId,
    new ApiV1Error("rate_limited", "Too many requests. Try again later.", {
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    }),
  );
  response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
  return response;
}

function normalizeApiV1Path(path: string): string {
  return path.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean).join("/");
}

function pathTemplateMatches(template: string, path: string): boolean {
  const templateSegments = normalizeApiV1Path(template).split("/").filter(Boolean);
  const pathSegments = normalizeApiV1Path(path).split("/").filter(Boolean);
  if (templateSegments.length !== pathSegments.length) return false;
  return templateSegments.every((segment, index) => {
    if (segment.startsWith("{") && segment.endsWith("}")) return pathSegments[index].length > 0;
    return segment === pathSegments[index];
  });
}

export function resolveApiV1ScopeRequirement(method: string, path: string): ApiV1ScopeRequirement | null {
  const normalizedPath = normalizeApiV1Path(path);
  const normalizedMethod = method.toUpperCase();
  const rule = API_V1_SCOPE_RULES.find((candidate) => (
    candidate.method === normalizedMethod && pathTemplateMatches(candidate.path, normalizedPath)
  ));
  return rule ? { auth: rule.auth, scopes: [...rule.scopes] } : null;
}

function isKnownApiV1Path(path: string): boolean {
  return API_V1_RESOURCES.some((resource) => pathTemplateMatches(resource.path, path));
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

async function authorizeApiV1Route(args: ApiV1RouteArgs, path: string): Promise<ApiPrincipal | null> {
  const requirement = resolveApiV1ScopeRequirement(args.request.method, path);
  if (!requirement) {
    throw new ApiV1Error("not_found", `Unknown Spoonjoy API v1 endpoint: /api/v1/${path}`);
  }

  const principal = await optionalPrincipal(args);
  if (requirement.auth === "bearer" && !principal) {
    throw new ApiV1Error("authentication_required", "Authentication required");
  }
  for (const scope of requirement.scopes) {
    assertScope(principal, scope);
  }
  return principal;
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
    select: {
      id: true,
      title: true,
      description: true,
      servings: true,
      createdAt: true,
      updatedAt: true,
      chef: { select: { id: true, username: true } },
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
  const db = await getRequestDb(args.context);
  const cookbook = await loadCookbookById(db, id);
  if (!cookbook) {
    throw new ApiV1Error("not_found", "Cookbook not found");
  }

  return apiV1Success(requestId, { cookbook: cookbookDetail(cookbook) });
}

async function loadShoppingListForUser(db: Awaited<ReturnType<typeof getRequestDb>>, userId: string) {
  const include = {
    author: { select: { id: true, username: true } },
    items: {
      include: { unit: true, ingredientRef: true },
      orderBy: [{ sortIndex: "asc" as const }, { updatedAt: "asc" as const }, { id: "asc" as const }],
    },
  };
  const existing = await db.shoppingList.findUnique({
    where: { authorId: userId },
    include,
  });
  if (existing) return existing;
  return await db.shoppingList.create({
    data: { authorId: userId },
    include,
  });
}

type ShoppingListRow = NonNullable<Awaited<ReturnType<typeof loadShoppingListForUser>>>;
type ShoppingItemRow = ShoppingListRow["items"][number];

function shoppingItem(item: ShoppingItemRow) {
  return {
    id: item.id,
    name: item.ingredientRef.name,
    quantity: item.quantity,
    unit: item.unit?.name ?? null,
    checked: item.checked,
    checkedAt: item.checkedAt?.toISOString() ?? null,
    deletedAt: item.deletedAt?.toISOString() ?? null,
    categoryKey: item.categoryKey,
    iconKey: item.iconKey,
    sortIndex: item.sortIndex,
    updatedAt: item.updatedAt.toISOString(),
  };
}

function maxUpdatedAt(items: ShoppingItemRow[], fallback: Date) {
  return items.reduce((latest, item) => (
    item.updatedAt.getTime() > latest.getTime() ? item.updatedAt : latest
  ), fallback);
}

function shoppingListPayload(list: ShoppingListRow) {
  const activeItems = list.items.filter((item) => !item.deletedAt);
  return {
    shoppingList: {
      id: list.id,
      chef: { id: list.author.id, username: list.author.username },
      items: activeItems.map(shoppingItem),
      updatedAt: list.updatedAt.toISOString(),
    },
    nextCursor: maxUpdatedAt(activeItems, list.updatedAt).toISOString(),
  };
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

async function getOrCreateApiV1Unit(db: Awaited<ReturnType<typeof getRequestDb>>, name: string) {
  const normalized = normalizeName(name);
  const existing = await db.unit.findUnique({ where: { name: normalized } });
  if (existing) return existing;
  return await db.unit.create({ data: { name: normalized } });
}

async function getOrCreateApiV1IngredientRef(db: Awaited<ReturnType<typeof getRequestDb>>, name: string) {
  const normalized = normalizeName(name);
  const existing = await db.ingredientRef.findUnique({ where: { name: normalized } });
  if (existing) return existing;
  return await db.ingredientRef.create({ data: { name: normalized } });
}

async function nextShoppingSortIndex(db: Awaited<ReturnType<typeof getRequestDb>>, shoppingListId: string) {
  const maxItem = await db.shoppingListItem.findFirst({
    where: { shoppingListId, deletedAt: null },
    orderBy: { sortIndex: "desc" },
    select: { sortIndex: true },
  });
  return (maxItem?.sortIndex ?? -1) + 1;
}

async function reloadShoppingListForUser(db: Awaited<ReturnType<typeof getRequestDb>>, userId: string) {
  return await db.shoppingList.findUniqueOrThrow({
    where: { authorId: userId },
    include: {
      author: { select: { id: true, username: true } },
      items: {
        include: { unit: true, ingredientRef: true },
        orderBy: [{ sortIndex: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
      },
    },
  });
}

function shoppingListObject(list: ShoppingListRow) {
  return shoppingListPayload(list).shoppingList;
}

function parseSyncCursor(url: URL): Date | null {
  const raw = url.searchParams.get("cursor");
  if (raw === null || raw.trim() === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) {
    throw new ApiV1Error("invalid_cursor", "cursor must be an ISO datetime");
  }
  const cursor = new Date(raw);
  if (Number.isNaN(cursor.getTime()) || cursor.toISOString() !== raw) {
    throw new ApiV1Error("invalid_cursor", "cursor must be an ISO datetime");
  }
  return cursor;
}

async function handleShoppingListRead(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const db = await getRequestDb(args.context);
  const list = await loadShoppingListForUser(db, principal.id);
  return apiV1Success(requestId, shoppingListPayload(list));
}

async function handleShoppingListSync(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const db = await getRequestDb(args.context);
  const url = new URL(args.request.url);
  const cursor = parseSyncCursor(url);
  const list = await loadShoppingListForUser(db, principal.id);
  const items = list.items
    .filter((item) => cursor === null || item.updatedAt.getTime() > cursor.getTime())
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.id.localeCompare(b.id));
  const nextCursor = (items.length > 0 ? maxUpdatedAt(items, list.updatedAt) : cursor ?? list.updatedAt).toISOString();

  return apiV1Success(requestId, {
    items: items.map(shoppingItem),
    nextCursor,
    hasMore: false,
  });
}

function optionalPositiveNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ApiV1Error("validation_error", `${field} must be a number greater than 0`);
  }
  return value;
}

function optionalNullableString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiV1Error("validation_error", `${field} must be a string or null`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ApiV1Error("validation_error", `${field} must be a boolean`);
  }
  return value;
}

function idempotentMutationBody(
  requestId: string,
  data: Record<string, unknown>,
) {
  return { ok: true, requestId, data };
}

async function runIdempotentShoppingMutation(
  args: ApiV1RouteArgs,
  requestId: string,
  principal: ApiPrincipal,
  body: Record<string, unknown>,
  clientMutationId: string,
  operation: string,
  write: () => Promise<{ status: number; data: Record<string, unknown> }>,
) {
  const db = await getRequestDb(args.context);
  const path = normalizeApiV1Path(args.params["*"]);
  const requestHash = await hashIdempotencyRequest({
    method: args.request.method,
    path: `/api/v1/${path}`,
    body,
  });
  const reservation = await reserveIdempotencyKey(db, {
    userId: principal.id,
    credentialId: principal.source === "bearer" ? principal.credentialId : null,
    clientKey: idempotencyClientKey(principal),
    key: clientMutationId,
    operation,
    requestHash,
  });

  if (reservation.status === "replay") {
    const replay = replayIdempotencyResponse(reservation.record, requestId);
    return Response.json(replay.body, {
      status: replay.status,
      headers: apiV1Headers(requestId),
    });
  }

  if (reservation.status === "conflict") {
    throw new ApiV1Error("idempotency_conflict", "clientMutationId was already used for a different request");
  }

  const result = await write();
  const responseBody = idempotentMutationBody(requestId, result.data);
  await completeIdempotencyKey(db, reservation.record.id, {
    status: result.status,
    body: responseBody,
  });

  return Response.json(responseBody, {
    status: result.status,
    headers: apiV1Headers(requestId),
  });
}

async function handleShoppingItemCreate(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId", "name", "quantity", "unit", "categoryKey", "iconKey"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const name = nonblankString(body.name, "name");
  const quantity = optionalPositiveNumber(body.quantity, "quantity");
  const unitName = optionalNullableString(body.unit, "unit");
  const categoryKey = optionalNullableString(body.categoryKey, "categoryKey");
  const iconKey = optionalNullableString(body.iconKey, "iconKey");

  return await runIdempotentShoppingMutation(args, requestId, principal, body, clientMutationId, "shopping-list.items.create", async () => {
    const db = await getRequestDb(args.context);
    const list = await loadShoppingListForUser(db, principal.id);
    const ingredientRef = await getOrCreateApiV1IngredientRef(db, name);
    const unit = unitName ? await getOrCreateApiV1Unit(db, unitName) : null;
    const existing = await db.shoppingListItem.findFirst({
      where: {
        shoppingListId: list.id,
        ingredientRefId: ingredientRef.id,
        unitId: unit?.id ?? null,
      },
    });

    const item = existing
      ? await db.shoppingListItem.update({
          where: { id: existing.id },
          data: {
            quantity: quantity === null ? existing.quantity : (existing.quantity ?? 0) + quantity,
            checked: false,
            checkedAt: null,
            deletedAt: null,
            sortIndex: existing.checked || existing.checkedAt || existing.deletedAt
              ? await nextShoppingSortIndex(db, list.id)
              : existing.sortIndex,
            categoryKey: categoryKey ?? existing.categoryKey,
            iconKey: iconKey ?? existing.iconKey,
          },
          include: { unit: true, ingredientRef: true },
        })
      : await db.shoppingListItem.create({
          data: {
            shoppingListId: list.id,
            ingredientRefId: ingredientRef.id,
            unitId: unit?.id ?? null,
            quantity,
            sortIndex: await nextShoppingSortIndex(db, list.id),
            categoryKey,
            iconKey,
          },
          include: { unit: true, ingredientRef: true },
        });
    const reloaded = await reloadShoppingListForUser(db, principal.id);

    return {
      status: existing ? 200 : 201,
      data: {
        created: !existing,
        updated: Boolean(existing),
        item: shoppingItem(item),
        shoppingList: shoppingListObject(reloaded),
        mutation: { clientMutationId, replayed: false },
      },
    };
  });
}

async function handleShoppingItemCheck(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, itemId: string) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId", "checked", "updatedAt", "checkedAt", "deletedAt"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const checked = requiredBoolean(body.checked, "checked");

  return await runIdempotentShoppingMutation(args, requestId, principal, body, clientMutationId, "shopping-list.items.check", async () => {
    const db = await getRequestDb(args.context);
    const list = await loadShoppingListForUser(db, principal.id);
    const existing = await db.shoppingListItem.findFirst({
      where: { id: itemId, shoppingListId: list.id },
    });
    if (!existing) {
      throw new ApiV1Error("not_found", "Shopping list item not found", { resource: "shopping_list_item", itemId });
    }

    const item = await db.shoppingListItem.update({
      where: { id: existing.id },
      data: {
        checked,
        checkedAt: checked ? new Date() : null,
        deletedAt: null,
        sortIndex: checked ? await nextShoppingSortIndex(db, list.id) : existing.sortIndex,
      },
      include: { unit: true, ingredientRef: true },
    });
    const reloaded = await reloadShoppingListForUser(db, principal.id);

    return {
      status: 200,
      data: {
        item: shoppingItem(item),
        shoppingList: shoppingListObject(reloaded),
        mutation: { clientMutationId, replayed: false },
      },
    };
  });
}

async function handleShoppingItemDelete(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, itemId: string) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId", "updatedAt", "deletedAt"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");

  return await runIdempotentShoppingMutation(args, requestId, principal, body, clientMutationId, "shopping-list.items.delete", async () => {
    const db = await getRequestDb(args.context);
    const list = await loadShoppingListForUser(db, principal.id);
    const existing = await db.shoppingListItem.findFirst({
      where: { id: itemId, shoppingListId: list.id },
    });
    if (!existing) {
      throw new ApiV1Error("not_found", "Shopping list item not found", { resource: "shopping_list_item", itemId });
    }

    const item = await db.shoppingListItem.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
      include: { unit: true, ingredientRef: true },
    });
    const reloaded = await reloadShoppingListForUser(db, principal.id);

    return {
      status: 200,
      data: {
        removed: true,
        item: shoppingItem(item),
        shoppingList: shoppingListObject(reloaded),
        mutation: { clientMutationId, replayed: false },
      },
    };
  });
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

async function handleTokenList(args: ApiV1RouteArgs, requestId: string, authenticated: ApiPrincipal) {
  const db = await getRequestDb(args.context);
  const credentials = await db.apiCredential.findMany({
    where: { userId: authenticated.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  return apiV1Success(requestId, { tokens: credentials.map(credentialMetadata) });
}

async function handleTokenCreate(args: ApiV1RouteArgs, requestId: string, authenticated: ApiPrincipal) {
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

async function handleTokenRevoke(args: ApiV1RouteArgs, requestId: string, authenticated: ApiPrincipal, credentialId: string) {
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

    const throttled = await enforceApiV1RateLimit(args, requestId);
    if (throttled) return throttled;

    const path = args.params["*"] ?? "";
    if (args.request.method === "GET" && path === "") {
      await authorizeApiV1Route(args, path);
      return apiV1Success(requestId, API_V1_DISCOVERY_DATA);
    }

    if (args.request.method === "GET" && path === "health") {
      const principal = await authorizeApiV1Route(args, path);
      return apiV1Success(requestId, {
        ok: true,
        version: "v1",
        authenticated: Boolean(principal),
        principal: principalSummary(principal),
        scopes: principal?.scopes ?? [],
      });
    }

    if (args.request.method === "GET" && path === "openapi.json") {
      await authorizeApiV1Route(args, path);
      return Response.json(buildApiV1OpenApiDocument(), {
        headers: apiV1Headers(requestId),
      });
    }

    if (args.request.method === "GET" && path === "recipes") {
      const principal = await authorizeApiV1Route(args, path);
      return await handleRecipeList(args, requestId, principal);
    }

    const segments = path.split("/").filter(Boolean);
    if (args.request.method === "GET" && segments[0] === "recipes" && segments.length === 2) {
      const principal = await authorizeApiV1Route(args, path);
      return await handleRecipeDetail(args, requestId, principal, segments[1]);
    }

    if (args.request.method === "GET" && path === "cookbooks") {
      const principal = await authorizeApiV1Route(args, path);
      return await handleCookbookList(args, requestId, principal);
    }

    if (args.request.method === "GET" && segments[0] === "cookbooks" && segments.length === 2) {
      const principal = await authorizeApiV1Route(args, path);
      return await handleCookbookDetail(args, requestId, principal, segments[1]);
    }

    if (args.request.method === "GET" && path === "shopping-list") {
      const principal = await authorizeApiV1Route(args, path);
      return await handleShoppingListRead(args, requestId, principal as ApiPrincipal);
    }

    if (args.request.method === "GET" && path === "shopping-list/sync") {
      const principal = await authorizeApiV1Route(args, path);
      return await handleShoppingListSync(args, requestId, principal as ApiPrincipal);
    }

    if (args.request.method === "POST" && path === "shopping-list/items") {
      const principal = await authorizeApiV1Route(args, path);
      return await handleShoppingItemCreate(args, requestId, principal as ApiPrincipal);
    }

    if (args.request.method === "PATCH" && segments[0] === "shopping-list" && segments[1] === "items" && segments.length === 3) {
      const principal = await authorizeApiV1Route(args, path);
      return await handleShoppingItemCheck(args, requestId, principal as ApiPrincipal, segments[2]);
    }

    if (args.request.method === "DELETE" && segments[0] === "shopping-list" && segments[1] === "items" && segments.length === 3) {
      const principal = await authorizeApiV1Route(args, path);
      return await handleShoppingItemDelete(args, requestId, principal as ApiPrincipal, segments[2]);
    }

    if (args.request.method === "GET" && path === "tokens") {
      const principal = await authorizeApiV1Route(args, path);
      return await handleTokenList(args, requestId, principal as ApiPrincipal);
    }

    if (args.request.method === "POST" && path === "tokens") {
      const principal = await authorizeApiV1Route(args, path);
      return await handleTokenCreate(args, requestId, principal as ApiPrincipal);
    }

    if (args.request.method === "DELETE" && segments[0] === "tokens" && segments.length === 2) {
      const principal = await authorizeApiV1Route(args, path);
      return await handleTokenRevoke(args, requestId, principal as ApiPrincipal, segments[1]);
    }

    if (args.request.method !== "GET" && args.request.method !== "POST" && args.request.method !== "PATCH" && args.request.method !== "DELETE") {
      throw new ApiV1Error("method_not_allowed", "Method not allowed");
    }

    if (isKnownApiV1Path(path)) {
      throw new ApiV1Error("method_not_allowed", "Method not allowed");
    }

    if (args.request.method === "GET") {
      await authorizeApiV1Route(args, path);
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
