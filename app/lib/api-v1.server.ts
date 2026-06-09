import type { ApiCredential, RecipeCover } from "@prisma/client";
import type { AppLoadContext } from "react-router";
import {
  ApiAuthError,
  authenticateApiRequest,
  createApiCredential,
  expandCredentialScopes,
  normalizeCredentialScopes,
  type ApiPrincipal,
} from "~/lib/api-auth.server";
import {
  captureEvent,
  requestContentBytes,
  resolvePostHogServerConfig,
  safeHeaderHost,
  userAgentFamily,
} from "~/lib/analytics-server";
import {
  completeIdempotencyKey,
  hashIdempotencyRequest,
  IDEMPOTENCY_RETRY_AFTER_SECONDS,
  idempotencyClientKey,
  replayIdempotencyResponse,
  reserveIdempotencyKey,
} from "~/lib/api-idempotency.server";
import {
  buildApiV1ConnectorOpenApiDocument,
  buildApiV1OpenApiDocument,
  buildApiV1SdkOpenApiDocument,
} from "~/lib/api-v1-openapi.server";
import { enforceRateLimit } from "~/lib/rate-limit.server";
import { getRequestDb } from "~/lib/route-platform.server";
import {
  API_V1_DISCOVERY_DATA,
  API_V1_ERROR_STATUS,
  API_V1_RESOURCES,
  API_V1_SCOPE_REQUIREMENTS,
  type ApiV1ErrorCode,
} from "~/lib/api-v1-contract.server";
import {
  getRecipeCoverDisplay,
  getScopedActiveCover,
  RECIPE_COVER_DISPLAY_SELECT,
  type RecipeCoverVariant,
} from "~/lib/recipe-cover.server";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;
const MAX_JSON_BODY_BYTES = 16 * 1024;
const MAX_SHORT_TEXT_LENGTH = 160;

export interface ApiV1ScopeRequirement {
  auth: "optional" | "bearer";
  scopes: readonly string[];
}

type ApiV1ScopeRule = ApiV1ScopeRequirement & {
  method: string;
  path: string;
};

const API_V1_SCOPE_RULES: readonly ApiV1ScopeRule[] = API_V1_SCOPE_REQUIREMENTS;
type ApiV1Db = Awaited<ReturnType<typeof getRequestDb>>;
type ApiV1WriteDb = ApiV1Db;

export interface ApiV1RouteArgs {
  request: Request;
  params: { "*": string };
  context: AppLoadContext;
}

type ApiV1CloudflareContext = ApiV1RouteArgs["context"]["cloudflare"];

interface ApiV1TelemetryMetadata {
  operation?: string;
  errorCode?: ApiV1ErrorCode;
  idempotencyOutcome?: "aborted" | "committed" | "conflict" | "in_progress" | "none" | "not_attempted" | "replayed";
  rateLimitScope?: "ip" | "skip" | "token";
}

export class ApiV1Error extends Error {
  code: ApiV1ErrorCode;
  status: number;
  details?: unknown;
  principal?: ApiPrincipal | null;

  constructor(code: ApiV1ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiV1Error";
    this.code = code;
    this.status = API_V1_ERROR_STATUS[code];
    this.details = details;
  }
}

function withApiV1ErrorPrincipal(error: ApiV1Error, principal: ApiPrincipal | null): ApiV1Error {
  error.principal = principal;
  return error;
}

export function requestIdFor(request: Request): string {
  const incoming = request.headers.get("X-Request-Id")?.trim();
  return incoming || `req_${crypto.randomUUID()}`;
}

export function apiV1Headers(requestId: string, json = true): Headers {
  const headers = new Headers({
    "X-Request-Id": requestId,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-Id, X-Client-Mutation-Id",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "X-Request-Id, Retry-After",
  });
  if (json) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  return headers;
}

function apiV1PrivateHeaders(requestId: string, json = true): Headers {
  const headers = apiV1Headers(requestId, json);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Pragma", "no-cache");
  return headers;
}

export function apiV1Success(requestId: string, data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = apiV1Headers(requestId);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return Response.json({ ok: true, requestId, data }, {
    status,
    headers,
  });
}

function apiV1PrivateSuccess(requestId: string, data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = apiV1PrivateHeaders(requestId);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return Response.json({ ok: true, requestId, data }, { status, headers });
}

const TOKEN_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;

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
  const headers = apiV1PrivateHeaders(requestId);
  if (error.code === "idempotency_in_progress") {
    headers.set("Retry-After", String(IDEMPOTENCY_RETRY_AFTER_SECONDS));
  }
  if (
    error.code === "method_not_allowed" &&
    error.details &&
    typeof error.details === "object" &&
    !Array.isArray(error.details) &&
    typeof (error.details as { allow?: unknown }).allow === "string"
  ) {
    headers.set("Allow", (error.details as { allow: string }).allow);
  }
  return Response.json(body, {
    status: error.status,
    headers,
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
      scope: rateLimit.scope,
    }),
  );
  response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
  return withApiV1Telemetry(response, {
    errorCode: "rate_limited",
    rateLimitScope: rateLimit.scope,
  });
}

export function apiV1WaitUntilFor(args: ApiV1RouteArgs): ((promise: Promise<unknown>) => void) | undefined {
  const ctx = apiV1CloudflareFor(args)?.ctx;
  return ctx?.waitUntil ? ctx.waitUntil.bind(ctx) : undefined;
}

function apiV1CloudflareFor(args: ApiV1RouteArgs): ApiV1CloudflareContext | undefined {
  try {
    return args.context.cloudflare;
  } catch {
    return undefined;
  }
}

function cacheClassFor(response: Response): string {
  const cacheControl = (response.headers.get("Cache-Control") ?? "").toLowerCase();
  if (cacheControl.includes("no-store")) return "no_store";
  /* istanbul ignore next -- @preserve current private API responses also include no-store; this class remains for future cache policies. */
  if (cacheControl.includes("private")) return "private";
  if (cacheControl.includes("public")) return "public";
  return "none";
}

function apiV1RouteResource(method: string, path: string) {
  const normalizedMethod = method.toUpperCase();
  return API_V1_RESOURCES.find((resource) => (
    (resource.methods as readonly string[]).includes(normalizedMethod) &&
    pathTemplateMatches(resource.path, path)
  ));
}

function apiV1PathResource(path: string) {
  return API_V1_RESOURCES.find((resource) => pathTemplateMatches(resource.path, path));
}

function authModeForPrincipal(principal: ApiPrincipal | null): string {
  if (!principal) return "anonymous";
  if (principal.oauthClientId) return "oauth_bearer";
  return principal.source;
}

const API_V1_TELEMETRY = Symbol("apiV1Telemetry");

type ApiV1TelemetryResponse = Response & { [API_V1_TELEMETRY]?: ApiV1TelemetryMetadata };

function withApiV1Telemetry(response: Response, telemetry: ApiV1TelemetryMetadata): Response {
  Object.defineProperty(response, API_V1_TELEMETRY, {
    value: telemetry,
    configurable: true,
  });
  return response;
}

function responseTelemetry(response: Response): ApiV1TelemetryMetadata {
  return (response as ApiV1TelemetryResponse)[API_V1_TELEMETRY] ?? {};
}

function apiV1OperationFor(method: string, path: string): string | undefined {
  const resource = apiV1RouteResource(method, path);
  if (!resource) return undefined;

  switch (`${method.toUpperCase()} ${resource.name}`) {
    case "GET root":
      return "root.read";
    case "GET health":
      return "health.read";
    case "GET openapi":
      return "openapi.read";
    case "GET openapi-sdk":
      return "openapi.sdk.read";
    case "GET openapi-connector":
      return "openapi.connector.read";
    case "GET recipes":
      return "recipes.list";
    case "GET recipe":
      return "recipes.get";
    case "GET cookbooks":
      return "cookbooks.list";
    case "GET cookbook":
      return "cookbooks.get";
    case "GET shopping-list":
      return "shopping-list.read";
    case "GET shopping-list-sync":
      return "shopping-list.sync";
    case "POST shopping-list-items":
      return "shopping-list.items.create";
    case "PATCH shopping-list-item":
      return "shopping-list.items.check";
    case "DELETE shopping-list-item":
      return "shopping-list.items.delete";
    case "GET tokens":
      return "tokens.list";
    case "POST tokens":
      return "tokens.create";
    case "DELETE token":
      return "tokens.revoke";
    /* istanbul ignore next -- @preserve API_V1_RESOURCES only defines the method/resource combinations above. */
    default:
      return undefined;
  }
}

function defaultIdempotencyOutcome(operation: string | undefined, errorCode: ApiV1ErrorCode | undefined) {
  if (!operation) return undefined;
  if (operation.startsWith("tokens.")) return "none";
  if (!operation.startsWith("shopping-list.items.")) return undefined;
  if (errorCode === "idempotency_conflict") return "conflict";
  if (errorCode === "idempotency_in_progress") return "in_progress";
  if (errorCode === "invalid_json" || errorCode === "validation_error") return "not_attempted";
  /* istanbul ignore else -- @preserve successful idempotent mutations attach explicit replay/create metadata before telemetry observes them. */
  if (errorCode) return "aborted";
  /* istanbul ignore next -- @preserve successful idempotent mutations attach explicit replay/create metadata before telemetry observes them. */
  return undefined;
}

function observeApiV1Response(
  args: ApiV1RouteArgs,
  input: {
    requestId: string;
    path: string;
    response: Response;
    startedAt: number;
    principal?: ApiPrincipal | null;
    telemetry?: ApiV1TelemetryMetadata;
  },
): Response {
  const cloudflare = apiV1CloudflareFor(args);
  const env = cloudflare?.env;
  const ctx = cloudflare?.ctx;
  const waitUntil = ctx?.waitUntil ? ctx.waitUntil.bind(ctx) : undefined;
  if (!env || !waitUntil) return input.response;

  const postHogConfig = resolvePostHogServerConfig(env);
  if (!postHogConfig.enabled) return input.response;

  const resource = apiV1RouteResource(args.request.method, input.path);
  const routeResource = resource ?? apiV1PathResource(input.path);
  const principal = input.principal ?? null;
  const responseMetadata = responseTelemetry(input.response);
  const operation = input.telemetry?.operation ?? responseMetadata.operation ?? apiV1OperationFor(args.request.method, input.path);
  const errorCode = input.telemetry?.errorCode ?? responseMetadata.errorCode;
  const idempotencyOutcome = input.telemetry?.idempotencyOutcome
    ?? responseMetadata.idempotencyOutcome
    ?? defaultIdempotencyOutcome(operation, errorCode);
  const rateLimitScope = input.telemetry?.rateLimitScope ?? responseMetadata.rateLimitScope;
  waitUntil(
    captureEvent(postHogConfig, {
      event: "spoonjoy.api_v1.request",
      distinctId: principal?.id ?? "anon",
      properties: {
        route_template: routeResource?.path ?? "/api/v1/{unknown}",
        resource: routeResource?.name ?? "unknown",
        method: args.request.method,
        status: input.response.status,
        request_id: input.requestId,
        operation,
        error_code: errorCode,
        auth_mode: authModeForPrincipal(principal),
        principal_id: principal?.id,
        credential_id: principal?.credentialId,
        oauth_client_id: principal?.oauthClientId || undefined,
        oauth_resource: principal?.oauthClientId ? (principal.oauthResource ?? null) : undefined,
        scopes: principal?.scopes,
        request_bytes: requestContentBytes(args.request),
        privacy_class: principal ? "authenticated" : routeResource?.auth === "bearer" ? "private" : "public",
        cache_class: cacheClassFor(input.response),
        origin_host: safeHeaderHost(args.request.headers.get("Origin")),
        referrer_host: safeHeaderHost(args.request.headers.get("Referer")),
        user_agent_family: userAgentFamily(args.request.headers.get("User-Agent")),
        idempotency_outcome: idempotencyOutcome,
        rate_limit_scope: rateLimitScope,
        latency_ms: Math.max(0, Date.now() - input.startedAt),
      },
    }),
  );

  return input.response;
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

function allowedApiV1Methods(path: string): string | null {
  const resource = API_V1_RESOURCES.find((candidate) => pathTemplateMatches(candidate.path, path));
  return resource ? resource.methods.join(", ") : null;
}

export async function parseApiV1JsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) return {};

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw new ApiV1Error("validation_error", `JSON body must be at most ${MAX_JSON_BODY_BYTES} bytes`);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw new ApiV1Error("validation_error", `JSON body must be at most ${MAX_JSON_BODY_BYTES} bytes`);
  }
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

function principalHasScope(principal: ApiPrincipal | null, scope: string) {
  if (!principal) return true;
  if (principal.scopes.includes(scope)) return true;
  return principal.scopes.includes("public:read") && (scope === "recipes:read" || scope === "cookbooks:read");
}

function canSelfRevokeCredential(principal: ApiPrincipal | null, method: string, path: string, scope: string) {
  return (
    scope === "tokens:write" &&
    method === "DELETE" &&
    path.startsWith("tokens/") &&
    principal?.source === "bearer" &&
    principal.credentialId === path.slice("tokens/".length)
  );
}

async function authorizeApiV1Route(args: ApiV1RouteArgs, path: string): Promise<ApiPrincipal | null> {
  const requirement = resolveApiV1ScopeRequirement(args.request.method, path);
  if (!requirement) {
    throw new ApiV1Error("not_found", `Unknown Spoonjoy API v1 endpoint: /api/v1/${path}`);
  }

  const principal = await optionalPrincipal(args);
  if (principal?.oauthResource) {
    throw withApiV1ErrorPrincipal(
      new ApiV1Error("insufficient_scope", "This OAuth access token is bound to a different protected resource"),
      principal,
    );
  }
  if (requirement.auth === "bearer" && !principal) {
    throw new ApiV1Error("authentication_required", "Authentication required");
  }
  for (const scope of requirement.scopes) {
    if (!principalHasScope(principal, scope) && !canSelfRevokeCredential(principal, args.request.method, path, scope)) {
      throw withApiV1ErrorPrincipal(new ApiV1Error("insufficient_scope", `Missing required scope: ${scope}`), principal);
    }
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

function parseShoppingSyncLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw.trim() === "") return DEFAULT_LIST_LIMIT;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new ApiV1Error("validation_error", "limit must be an integer between 1 and 50");
  }
  return limit;
}

type ListCursor = { createdAt: Date; id: string; raw: string };

function listCursorFor(row: Pick<RecipeSummaryRow, "createdAt" | "id">): string {
  return `v1.${base64UrlEncodeText(JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id }))}`;
}

function parseListCursor(url: URL): ListCursor | null {
  const raw = url.searchParams.get("cursor");
  if (raw === null || raw.trim() === "") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("v1.")) {
    throw new ApiV1Error("invalid_cursor", "cursor must be a Spoonjoy list cursor");
  }
  try {
    const parsed = JSON.parse(base64UrlDecodeText(trimmed.slice(3))) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { createdAt?: unknown }).createdAt === "string" &&
      typeof (parsed as { id?: unknown }).id === "string"
    ) {
      const createdAt = new Date((parsed as { createdAt: string }).createdAt);
      if (!Number.isNaN(createdAt.getTime()) && createdAt.toISOString() === (parsed as { createdAt: string }).createdAt) {
        return { createdAt, id: (parsed as { id: string }).id, raw: trimmed };
      }
    }
  } catch {
    throw new ApiV1Error("invalid_cursor", "cursor must be a Spoonjoy list cursor");
  }
  throw new ApiV1Error("invalid_cursor", "cursor must be a Spoonjoy list cursor");
}

function listCursorWhere(cursor: ListCursor | null) {
  if (!cursor) return {};
  return {
    OR: [
      { createdAt: { gt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { gt: cursor.id } },
    ],
  };
}

function publicOrigin(args: ApiV1RouteArgs): string {
  const configured = args.context.cloudflare?.env?.SPOONJOY_BASE_URL;
  return new URL(configured || args.request.url).origin;
}

function publicContentOrigin(args: ApiV1RouteArgs): string {
  const configured = args.context.cloudflare?.env?.SPOONJOY_BASE_URL;
  return new URL(configured || "https://spoonjoy.app").origin;
}

function canonicalUrl(origin: string, href: string): string {
  return new URL(href, origin).toString();
}

function publicCacheHeaders() {
  return {
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    "Vary": "Authorization, Cookie",
    "Access-Control-Expose-Headers": "X-Request-Id, Cache-Control",
  };
}

function authenticatedPublicCacheHeaders() {
  return {
    "Cache-Control": "private, no-store",
    "Vary": "Authorization, Cookie",
    "Access-Control-Expose-Headers": "X-Request-Id, Cache-Control",
  };
}

function publicAssetUrl(origin: string, value: string | null): string | null {
  if (!value || value.startsWith("data:")) return null;
  try {
    return new URL(value, origin).toString();
  } catch {
    return null;
  }
}

type SourceRecipeRow = {
  id: string;
  title: string;
  deletedAt: Date | null;
  chef: { id: string; username: string };
} | null;

function sourceHost(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;
  try {
    return new URL(sourceUrl).hostname || null;
  } catch {
    return null;
  }
}

function recipeAttribution(recipe: {
  title: string;
  chef: { username: string };
  href: string;
  sourceUrl: string | null;
  sourceRecipe: SourceRecipeRow;
}, origin: string) {
  const sourceRecipeHref = recipe.sourceRecipe ? `/recipes/${recipe.sourceRecipe.id}` : null;
  const sourceRecipeDeleted = Boolean(recipe.sourceRecipe?.deletedAt);
  return {
    creditText: `${recipe.title} by ${recipe.chef.username} on Spoonjoy`,
    canonicalUrl: canonicalUrl(origin, recipe.href),
    sourceUrl: recipe.sourceUrl,
    sourceHost: sourceHost(recipe.sourceUrl),
    sourceRecipe: recipe.sourceRecipe ? {
      id: recipe.sourceRecipe.id,
      title: sourceRecipeDeleted ? null : recipe.sourceRecipe.title,
      chef: sourceRecipeDeleted ? null : {
        id: recipe.sourceRecipe.chef.id,
        username: recipe.sourceRecipe.chef.username,
      },
      href: sourceRecipeDeleted ? null : sourceRecipeHref,
      canonicalUrl: sourceRecipeDeleted ? null : canonicalUrl(origin, sourceRecipeHref!),
      deleted: sourceRecipeDeleted,
    } : null,
  };
}

type RecipeSummaryRow = {
  id: string;
  title: string;
  description: string | null;
  servings: string | null;
  chef: { id: string; username: string };
  sourceUrl: string | null;
  sourceRecipe: SourceRecipeRow;
  createdAt: Date;
  updatedAt: Date;
  coverImageUrl: string | null;
  coverProvenanceLabel: string | null;
  coverSourceType: string | null;
  coverVariant: RecipeCoverVariant | null;
};

type RecipeCoverFieldsInput = {
  id: string;
  title: string;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  coverMode: string | null;
  activeCover: RecipeCover | null;
};

function emptyRecipeCoverApiFields() {
  return {
    coverImageUrl: null,
    coverProvenanceLabel: null,
    coverSourceType: null,
    coverVariant: null,
  };
}

function recipeCoverApiFields(recipe: RecipeCoverFieldsInput, origin: string) {
  const activeCover = getScopedActiveCover(recipe);
  const coverDisplay = getRecipeCoverDisplay(recipe, activeCover ? [activeCover] : []);
  if (!coverDisplay) return emptyRecipeCoverApiFields();

  const coverImageUrl = publicAssetUrl(origin, coverDisplay.displayUrl);
  if (!coverImageUrl) {
    return emptyRecipeCoverApiFields();
  }
  return {
    coverImageUrl,
    coverProvenanceLabel: coverDisplay.provenanceLabel,
    coverSourceType: coverDisplay.sourceType,
    coverVariant: coverDisplay.activeVariant,
  };
}

function recipeSummary(recipe: RecipeSummaryRow, origin: string) {
  const href = `/recipes/${recipe.id}`;
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    chef: { id: recipe.chef.id, username: recipe.chef.username },
    coverImageUrl: recipe.coverImageUrl,
    coverProvenanceLabel: recipe.coverProvenanceLabel,
    coverSourceType: recipe.coverSourceType,
    coverVariant: recipe.coverVariant,
    href,
    canonicalUrl: canonicalUrl(origin, href),
    attribution: recipeAttribution({ ...recipe, href }, origin),
    createdAt: recipe.createdAt.toISOString(),
    updatedAt: recipe.updatedAt.toISOString(),
  };
}

function recipeDetail(recipe: RecipeRow, origin: string) {
  return {
    ...recipeSummary({ ...recipe, ...recipeCoverApiFields(recipe, origin) }, origin),
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
      canonicalUrl: canonicalUrl(origin, `/cookbooks/${entry.cookbook.id}`),
    })),
  };
}

type RecipeRow = NonNullable<Awaited<ReturnType<typeof loadRecipeById>>>;
type CookbookRow = NonNullable<Awaited<ReturnType<typeof loadCookbookById>>>;

async function loadRecipeById(db: Awaited<ReturnType<typeof getRequestDb>>, id: string) {
  return db.recipe.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      servings: true,
      sourceUrl: true,
      activeCoverId: true,
      activeCoverVariant: true,
      coverMode: true,
      createdAt: true,
      updatedAt: true,
      chef: { select: { id: true, username: true } },
      sourceRecipe: {
        select: {
          id: true,
          title: true,
          deletedAt: true,
          chef: { select: { id: true, username: true } },
        },
      },
      activeCover: { select: RECIPE_COVER_DISPLAY_SELECT },
      steps: {
        select: {
          id: true,
          stepNum: true,
          stepTitle: true,
          description: true,
          duration: true,
          ingredients: {
            select: {
              id: true,
              quantity: true,
              ingredientRef: { select: { name: true } },
              unit: { select: { name: true } },
            },
          },
        },
      },
      cookbooks: {
        select: { cookbook: { select: { id: true, title: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

async function handleRecipeList(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal | null) {
  const db = await getRequestDb(args.context);
  const url = new URL(args.request.url);
  const origin = publicContentOrigin(args);
  const query = (url.searchParams.get("query") ?? url.searchParams.get("q") ?? "").trim();
  const limit = parseListLimit(url);
  const cursor = parseListCursor(url);
  const cursorWhere = listCursorWhere(cursor);
  const queryWhere = query
    ? {
        OR: [
          { title: { contains: query } },
          { description: { contains: query } },
        ],
      }
    : {};
  const recipes = await db.recipe.findMany({
    where: {
      deletedAt: null,
      AND: [cursorWhere, queryWhere],
    },
    select: {
      id: true,
      title: true,
      description: true,
      servings: true,
      sourceUrl: true,
      activeCoverId: true,
      activeCoverVariant: true,
      coverMode: true,
      createdAt: true,
      updatedAt: true,
      chef: { select: { id: true, username: true } },
      sourceRecipe: {
        select: {
          id: true,
          title: true,
          deletedAt: true,
          chef: { select: { id: true, username: true } },
        },
      },
      activeCover: { select: RECIPE_COVER_DISPLAY_SELECT },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });
  const page = recipes.slice(0, limit);
  const hasMore = recipes.length > limit;
  const nextCursor = hasMore && page.length > 0 ? listCursorFor(page[page.length - 1]!) : null;

  return apiV1Success(requestId, {
    query: query || null,
    limit,
    cursor: cursor?.raw ?? null,
    nextCursor,
    hasMore,
    recipes: page.map((recipe) => recipeSummary({ ...recipe, ...recipeCoverApiFields(recipe, origin) }, origin)),
  }, 200, principal ? authenticatedPublicCacheHeaders() : publicCacheHeaders());
}

async function handleRecipeDetail(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal | null, id: string) {
  const db = await getRequestDb(args.context);
  const origin = publicContentOrigin(args);
  const recipe = await loadRecipeById(db, id);
  if (!recipe) {
    throw new ApiV1Error("not_found", "Recipe not found");
  }

  return apiV1Success(requestId, { recipe: recipeDetail(recipe, origin) }, 200, principal ? authenticatedPublicCacheHeaders() : publicCacheHeaders());
}

function activeCookbookRecipeEntries(cookbook: CookbookRow) {
  return cookbook.recipes.filter((entry) => !entry.recipe.deletedAt);
}

function cookbookSummary(cookbook: CookbookRow, origin: string) {
  const activeEntries = activeCookbookRecipeEntries(cookbook);
  const href = `/cookbooks/${cookbook.id}`;
  return {
    id: cookbook.id,
    title: cookbook.title,
    chef: { id: cookbook.author.id, username: cookbook.author.username },
    recipeCount: activeEntries.length,
    coverImageUrls: activeEntries
      .map((entry) => recipeCoverApiFields(entry.recipe, origin).coverImageUrl)
      .filter((url): url is string => Boolean(url))
      .slice(0, 4),
    href,
    canonicalUrl: canonicalUrl(origin, href),
    attribution: {
      creditText: `${cookbook.title} by ${cookbook.author.username} on Spoonjoy`,
      canonicalUrl: canonicalUrl(origin, href),
    },
    createdAt: cookbook.createdAt.toISOString(),
    updatedAt: cookbook.updatedAt.toISOString(),
  };
}

function cookbookDetail(cookbook: CookbookRow, origin: string) {
  return {
    ...cookbookSummary(cookbook, origin),
    recipes: activeCookbookRecipeEntries(cookbook).map((entry) =>
      recipeSummary({ ...entry.recipe, ...recipeCoverApiFields(entry.recipe, origin) }, origin)
    ),
  };
}

async function loadCookbookById(db: Awaited<ReturnType<typeof getRequestDb>>, id: string) {
  return db.cookbook.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, username: true } },
      recipes: {
        select: {
          createdAt: true,
          recipeId: true,
          recipe: {
            select: {
              id: true,
              title: true,
              description: true,
              servings: true,
              sourceUrl: true,
              deletedAt: true,
              activeCoverId: true,
              activeCoverVariant: true,
              coverMode: true,
              createdAt: true,
              updatedAt: true,
              sourceRecipe: {
                select: {
                  id: true,
                  title: true,
                  deletedAt: true,
                  chef: { select: { id: true, username: true } },
                },
              },
              activeCover: { select: RECIPE_COVER_DISPLAY_SELECT },
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
  const origin = publicContentOrigin(args);
  const query = (url.searchParams.get("query") ?? url.searchParams.get("q") ?? "").trim();
  const limit = parseListLimit(url);
  const cursor = parseListCursor(url);
  const cursorWhere = listCursorWhere(cursor);
  const queryWhere = query
    ? {
        OR: [
          { title: { contains: query } },
          { author: { username: { contains: query } } },
        ],
      }
    : {};
  const cookbooks = await db.cookbook.findMany({
    where: { AND: [cursorWhere, queryWhere] },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, username: true } },
      recipes: {
        select: {
          createdAt: true,
          recipeId: true,
          recipe: {
            select: {
              id: true,
              title: true,
              description: true,
              servings: true,
              sourceUrl: true,
              deletedAt: true,
              activeCoverId: true,
              activeCoverVariant: true,
              coverMode: true,
              createdAt: true,
              updatedAt: true,
              sourceRecipe: {
                select: {
                  id: true,
                  title: true,
                  deletedAt: true,
                  chef: { select: { id: true, username: true } },
                },
              },
              activeCover: { select: RECIPE_COVER_DISPLAY_SELECT },
              chef: { select: { id: true, username: true } },
            },
          },
        },
        orderBy: [{ createdAt: "asc" }, { recipeId: "asc" }],
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });
  const page = cookbooks.slice(0, limit);
  const hasMore = cookbooks.length > limit;
  const nextCursor = hasMore && page.length > 0 ? listCursorFor(page[page.length - 1]!) : null;

  return apiV1Success(requestId, {
    query: query || null,
    limit,
    cursor: cursor?.raw ?? null,
    nextCursor,
    hasMore,
    cookbooks: page.map((cookbook) => cookbookSummary(cookbook, origin)),
  }, 200, principal ? authenticatedPublicCacheHeaders() : publicCacheHeaders());
}

async function handleCookbookDetail(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal | null, id: string) {
  const db = await getRequestDb(args.context);
  const origin = publicContentOrigin(args);
  const cookbook = await loadCookbookById(db, id);
  if (!cookbook) {
    throw new ApiV1Error("not_found", "Cookbook not found");
  }

  return apiV1Success(requestId, { cookbook: cookbookDetail(cookbook, origin) }, 200, principal ? authenticatedPublicCacheHeaders() : publicCacheHeaders());
}

async function loadShoppingListForUser(db: ApiV1WriteDb, userId: string) {
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

async function getOrCreateApiV1Unit(db: ApiV1WriteDb, name: string) {
  const normalized = normalizeName(name);
  const existing = await db.unit.findUnique({ where: { name: normalized } });
  if (existing) return existing;
  return await db.unit.create({ data: { name: normalized } });
}

async function getOrCreateApiV1IngredientRef(db: ApiV1WriteDb, name: string) {
  const normalized = normalizeName(name);
  const existing = await db.ingredientRef.findUnique({ where: { name: normalized } });
  if (existing) return existing;
  return await db.ingredientRef.create({ data: { name: normalized } });
}

async function nextShoppingSortIndex(db: ApiV1WriteDb, shoppingListId: string) {
  const maxItem = await db.shoppingListItem.findFirst({
    where: { shoppingListId, deletedAt: null },
    orderBy: { sortIndex: "desc" },
    select: { sortIndex: true },
  });
  return (maxItem?.sortIndex ?? -1) + 1;
}

type SyncCursor = { updatedAt: Date; id: string | null; raw: string };

function base64UrlEncodeText(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeText(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function syncCursorForItem(item: Pick<ShoppingItemRow, "id" | "updatedAt">): string {
  return `v1.${base64UrlEncodeText(JSON.stringify({ updatedAt: item.updatedAt.toISOString(), id: item.id }))}`;
}

function syncCursorForDate(date: Date): string {
  return date.toISOString();
}

function parseSyncCursor(url: URL): SyncCursor | null {
  const raw = url.searchParams.get("cursor");
  if (raw === null || raw.trim() === "") return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("v1.")) {
    try {
      const parsed = JSON.parse(base64UrlDecodeText(trimmed.slice(3))) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        typeof (parsed as { updatedAt?: unknown }).updatedAt === "string" &&
        typeof (parsed as { id?: unknown }).id === "string"
      ) {
        const updatedAt = new Date((parsed as { updatedAt: string }).updatedAt);
        if (!Number.isNaN(updatedAt.getTime()) && updatedAt.toISOString() === (parsed as { updatedAt: string }).updatedAt) {
          return { updatedAt, id: (parsed as { id: string }).id, raw: trimmed };
        }
      }
    } catch {
      throw new ApiV1Error("invalid_cursor", "cursor must be an ISO datetime or Spoonjoy sync cursor");
    }
    throw new ApiV1Error("invalid_cursor", "cursor must be an ISO datetime or Spoonjoy sync cursor");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(trimmed)) {
    throw new ApiV1Error("invalid_cursor", "cursor must be an ISO datetime or Spoonjoy sync cursor");
  }
  const updatedAt = new Date(trimmed);
  if (Number.isNaN(updatedAt.getTime()) || updatedAt.toISOString() !== trimmed) {
    throw new ApiV1Error("invalid_cursor", "cursor must be an ISO datetime or Spoonjoy sync cursor");
  }
  return { updatedAt, id: null, raw: trimmed };
}

async function handleShoppingListRead(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const db = await getRequestDb(args.context);
  const list = await loadShoppingListForUser(db, principal.id);
  return apiV1PrivateSuccess(requestId, shoppingListPayload(list));
}

async function handleShoppingListSync(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const db = await getRequestDb(args.context);
  const url = new URL(args.request.url);
  const cursor = parseSyncCursor(url);
  const limit = parseShoppingSyncLimit(url);
  const list = await loadShoppingListForUser(db, principal.id);
  const matchingItems = list.items
    .filter((item) => {
      if (cursor === null) return true;
      const updatedAt = item.updatedAt.getTime();
      const cursorUpdatedAt = cursor.updatedAt.getTime();
      if (updatedAt > cursorUpdatedAt) return true;
      return cursor.id !== null && updatedAt === cursorUpdatedAt && item.id > cursor.id;
    })
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.id.localeCompare(b.id));
  const items = matchingItems.slice(0, limit);
  const hasMore = matchingItems.length > limit;
  const nextCursor = items.length > 0
    ? syncCursorForItem(items[items.length - 1]!)
    : cursor?.raw ?? syncCursorForDate(list.updatedAt);

  return apiV1PrivateSuccess(requestId, {
    items: items.map(shoppingItem),
    nextCursor,
    hasMore,
  });
}

function optionalPositiveNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ApiV1Error("validation_error", `${field} must be a number greater than 0`);
  }
  return value;
}

function optionalNullableString(value: unknown, field: string, maxLength = MAX_SHORT_TEXT_LENGTH): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiV1Error("validation_error", `${field} must be a string or null`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ApiV1Error("validation_error", `${field} must be at most ${maxLength} characters`);
  }
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
  write: (db: ApiV1WriteDb) => Promise<{ status: number; data: Record<string, unknown> }>,
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
    return withApiV1Telemetry(Response.json(replay.body, {
      status: replay.status,
      headers: apiV1PrivateHeaders(requestId),
    }), { idempotencyOutcome: "replayed", operation });
  }

  if (reservation.status === "in_flight") {
    throw new ApiV1Error(
      "idempotency_in_progress",
      "clientMutationId is already in progress; retry after the Retry-After header",
      { retryAfterSeconds: IDEMPOTENCY_RETRY_AFTER_SECONDS },
    );
  }

  if (reservation.status === "conflict") {
    throw new ApiV1Error("idempotency_conflict", "clientMutationId was already used for a different request");
  }

  let result: Awaited<ReturnType<typeof write>>;
  try {
    result = await write(db);
  } catch (error) {
    /* istanbul ignore next -- @preserve defensive cleanup for a write failure after reservation; integration tests cover the response path before reservation succeeds. */
    await db.apiIdempotencyKey.delete({ where: { id: reservation.record.id } }).catch(() => undefined);
    throw error;
  }

  const responseBody = idempotentMutationBody(requestId, result.data);
  await completeIdempotencyKey(db, reservation.record.id, {
    status: result.status,
    body: responseBody,
  });

  return withApiV1Telemetry(Response.json(responseBody, {
    status: result.status,
    headers: apiV1PrivateHeaders(requestId),
  }), { idempotencyOutcome: "committed", operation });
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

  return await runIdempotentShoppingMutation(args, requestId, principal, body, clientMutationId, "shopping-list.items.create", async (db) => {
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
    return {
      status: existing ? 200 : 201,
      data: {
        created: !existing,
        updated: Boolean(existing),
        item: shoppingItem(item),
        mutation: { clientMutationId, replayed: false },
      },
    };
  });
}

async function handleShoppingItemCheck(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, itemId: string) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId", "checked"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const checked = requiredBoolean(body.checked, "checked");

  return await runIdempotentShoppingMutation(args, requestId, principal, body, clientMutationId, "shopping-list.items.check", async (db) => {
    const list = await loadShoppingListForUser(db, principal.id);
    const existing = await db.shoppingListItem.findFirst({
      where: { id: itemId, shoppingListId: list.id },
    });
    if (!existing) {
      throw new ApiV1Error("not_found", "Shopping list item not found", { resource: "shopping_list_item", itemId });
    }
    if (existing.deletedAt) {
      throw new ApiV1Error("not_found", "Shopping list item has been removed; create or restore it with POST /api/v1/shopping-list/items", { resource: "shopping_list_item", itemId });
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
    return {
      status: 200,
      data: {
        item: shoppingItem(item),
        mutation: { clientMutationId, replayed: false },
      },
    };
  });
}

async function handleShoppingItemDelete(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, itemId: string) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId"]);
  const url = new URL(args.request.url);
  const clientMutationId = nonblankString(
    body.clientMutationId ?? args.request.headers.get("X-Client-Mutation-Id") ?? url.searchParams.get("clientMutationId"),
    "clientMutationId",
  );
  const idempotencyBody = { clientMutationId };

  return await runIdempotentShoppingMutation(args, requestId, principal, idempotencyBody, clientMutationId, "shopping-list.items.delete", async (db) => {
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
    return {
      status: 200,
      data: {
        removed: true,
        item: shoppingItem(item),
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

function nonblankString(value: unknown, field: string, maxLength = MAX_SHORT_TEXT_LENGTH) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiV1Error("validation_error", `${field} must be a nonblank string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ApiV1Error("validation_error", `${field} must be at most ${maxLength} characters`);
  }
  return trimmed;
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

  return withApiV1Telemetry(
    apiV1PrivateSuccess(requestId, { tokens: credentials.map(credentialMetadata) }),
    { idempotencyOutcome: "none" },
  );
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

  return withApiV1Telemetry(apiV1PrivateSuccess(requestId, {
    token: created.token,
    credential: credentialMetadata(created.credential),
  }, 201, TOKEN_RESPONSE_HEADERS), { idempotencyOutcome: "none" });
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

  return withApiV1Telemetry(apiV1PrivateSuccess(requestId, {
    revoked,
    credential: credentialMetadata(updated),
  }), { idempotencyOutcome: "none" });
}

export async function handleApiV1Request(args: ApiV1RouteArgs): Promise<Response> {
  const requestId = requestIdFor(args.request);
  const startedAt = Date.now();
  const path = args.params["*"] ?? "";
  let telemetryPrincipal: ApiPrincipal | null = null;
  const authorize = async (candidatePath: string): Promise<ApiPrincipal | null> => {
    const principal = await authorizeApiV1Route(args, candidatePath);
    telemetryPrincipal = principal;
    return principal;
  };

  try {
    if (args.request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: apiV1Headers(requestId, false) });
    }

    const throttled = await enforceApiV1RateLimit(args, requestId);
    if (throttled) {
      return observeApiV1Response(args, { requestId, path, response: throttled, startedAt });
    }

    if (args.request.method === "GET" && path === "") {
      const principal = await authorize(path);
      return observeApiV1Response(args, {
        requestId,
        path,
        response: apiV1Success(requestId, API_V1_DISCOVERY_DATA),
        startedAt,
        principal,
      });
    }

    if (args.request.method === "GET" && path === "health") {
      const principal = await authorize(path);
      const health = {
        ok: true,
        version: "v1",
        authenticated: Boolean(principal),
        principal: principalSummary(principal),
        scopes: principal?.scopes ?? [],
      };
      const response = principal
        ? apiV1PrivateSuccess(requestId, health)
        : apiV1Success(requestId, health);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && path === "openapi.json") {
      const principal = await authorize(path);
      const response = Response.json(buildApiV1OpenApiDocument({ serverUrl: publicOrigin(args) }), {
        headers: apiV1Headers(requestId),
      });
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && path === "openapi.connector.json") {
      const principal = await authorize(path);
      const response = Response.json(buildApiV1ConnectorOpenApiDocument({ serverUrl: publicOrigin(args) }), {
        headers: apiV1Headers(requestId),
      });
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && path === "openapi.sdk.json") {
      const principal = await authorize(path);
      const response = Response.json(buildApiV1SdkOpenApiDocument({ serverUrl: publicOrigin(args) }), {
        headers: apiV1Headers(requestId),
      });
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && path === "recipes") {
      const principal = await authorize(path);
      const response = await handleRecipeList(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    const segments = path.split("/").filter(Boolean);
    if (args.request.method === "GET" && segments[0] === "recipes" && segments.length === 2) {
      const principal = await authorize(path);
      const response = await handleRecipeDetail(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && path === "cookbooks") {
      const principal = await authorize(path);
      const response = await handleCookbookList(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && segments[0] === "cookbooks" && segments.length === 2) {
      const principal = await authorize(path);
      const response = await handleCookbookDetail(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && path === "shopping-list") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleShoppingListRead(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && path === "shopping-list/sync") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleShoppingListSync(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "POST" && path === "shopping-list/items") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleShoppingItemCreate(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "PATCH" && segments[0] === "shopping-list" && segments[1] === "items" && segments.length === 3) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleShoppingItemCheck(args, requestId, principal, segments[2]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "DELETE" && segments[0] === "shopping-list" && segments[1] === "items" && segments.length === 3) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleShoppingItemDelete(args, requestId, principal, segments[2]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && path === "tokens") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleTokenList(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "POST" && path === "tokens") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleTokenCreate(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "DELETE" && segments[0] === "tokens" && segments.length === 2) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleTokenRevoke(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method !== "GET" && args.request.method !== "POST" && args.request.method !== "PATCH" && args.request.method !== "DELETE") {
      throw new ApiV1Error("method_not_allowed", "Method not allowed", { allow: allowedApiV1Methods(path) ?? "GET, POST, PATCH, DELETE" });
    }

    if (isKnownApiV1Path(path)) {
      /* istanbul ignore next -- @preserve known paths always have an allowed-method header from API_V1_RESOURCES. */
      throw new ApiV1Error("method_not_allowed", "Method not allowed", { allow: allowedApiV1Methods(path) ?? "GET, POST, PATCH, DELETE" });
    }

    if (args.request.method === "GET") {
      await authorize(path);
    }

    throw new ApiV1Error("not_found", `Unknown Spoonjoy API v1 endpoint: /api/v1/${path}`);
  } catch (error) {
    if (error instanceof ApiV1Error) {
      const response = apiV1ErrorResponse(requestId, error);
      return observeApiV1Response(args, {
        requestId,
        path,
        response,
        startedAt,
        principal: error.principal ?? telemetryPrincipal,
        telemetry: { errorCode: error.code },
      });
    }

    logApiV1InternalError(args, requestId, error);
    const internalError = normalizeApiV1InternalError(error);
    const response = apiV1ErrorResponse(requestId, internalError);
    return observeApiV1Response(args, {
      requestId,
      path,
      response,
      startedAt,
      principal: telemetryPrincipal,
      telemetry: { errorCode: internalError.code },
    });
  }
}

export function normalizeApiV1InternalError(error: unknown): ApiV1Error {
  return new ApiV1Error("internal_error", "Internal error");
}

function logApiV1InternalError(args: ApiV1RouteArgs, requestId: string, error: unknown) {
  const url = new URL(args.request.url);
  console.error("[api-v1] internal_error", {
    requestId,
    method: args.request.method,
    path: url.pathname,
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : String(error),
  });
}
