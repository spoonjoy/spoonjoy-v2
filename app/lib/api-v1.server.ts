import type { ApiCredential, ApiIdempotencyKey, Prisma, RecipeCover, RecipeSpoon } from "@prisma/client";
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
  captureException,
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
  archiveRecipeCover,
  createCover,
  getRecipeCoverDisplay,
  getRecipeCoverProvenanceLabel,
  getScopedActiveCover,
  RECIPE_COVER_DISPLAY_SELECT,
  setActiveRecipeCover,
  type RecipeCoverVariant,
} from "~/lib/recipe-cover.server";
import {
  createSpoon,
  deleteSpoon,
  SpoonAuthError,
  SpoonNotFoundError,
  SpoonValidationError,
  updateSpoon,
  type UpdateSpoonPatch,
} from "~/lib/recipe-spoon.server";
import { activateSpoonCoverForDecision } from "~/lib/spoon-cover-activation.server";
import { decideSpoonCoverCreation } from "~/lib/spoon-cover-decision.server";
import { validateSpoonPhotoAssignment } from "~/lib/recipe-image-assignment.server";
import { resolveIngredientAffordance } from "~/lib/ingredient-affordances";
import { deferBackgroundTask } from "~/lib/background-task.server";
import { scheduleSpoonCoverStylization } from "~/lib/spoon-cover-stylization.server";
import {
  ImportRecipeError,
  importRecipeFromSource,
  type ImportRecipeDeps,
  type NativeRecipeImportCapture,
  type NativeRecipeImportSource,
} from "~/lib/recipe-import.server";
import type { ImageGenEnv } from "~/lib/image-gen.server";
import type { PostHogServerEnv } from "~/lib/analytics-server";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;
const MAX_JSON_BODY_BYTES = 16 * 1024;
const MAX_SHORT_TEXT_LENGTH = 160;
const MAX_IMPORT_TEXT_LENGTH = 12 * 1024;

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
    case "POST recipe-import":
      return "recipes.import";
    case "GET recipe":
      return "recipes.get";
    case "GET recipe-spoons":
      return "recipes.spoons.list";
    case "POST recipe-spoons-create":
      return "recipes.spoons.create";
    case "PATCH recipe-spoon":
      return "recipes.spoons.update";
    case "DELETE recipe-spoon":
      return "recipes.spoons.delete";
    case "GET recipe-covers":
      return "recipes.covers.list";
    case "PATCH recipe-covers":
      return "recipes.covers.set-no-cover";
    case "PATCH recipe-cover":
      return "recipes.covers.activate";
    case "DELETE recipe-cover":
      return "recipes.covers.archive";
    case "POST recipe-cover-regenerate":
      return "recipes.covers.regenerate";
    case "POST recipe-cover-from-spoon":
      return "recipes.covers.from-spoon";
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
    case "POST shopping-list-add-from-recipe":
      return "shopping-list.add-from-recipe";
    case "POST shopping-list-clear-completed":
      return "shopping-list.clear-completed";
    case "POST shopping-list-clear-all":
      return "shopping-list.clear-all";
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
  if (
    !operation.startsWith("shopping-list.items.") &&
    operation !== "shopping-list.add-from-recipe" &&
    operation !== "shopping-list.clear-completed" &&
    operation !== "shopping-list.clear-all" &&
    operation !== "recipes.import" &&
    !operation.startsWith("recipes.spoons.") &&
    !operation.startsWith("recipes.covers.")
  ) {
    return undefined;
  }
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
  const methods = API_V1_RESOURCES
    .filter((candidate) => pathTemplateMatches(candidate.path, path))
    .flatMap((resource) => [...resource.methods]);
  return methods.length > 0 ? Array.from(new Set(methods)).join(", ") : null;
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

type SpoonListCursor = { cookedAt: Date; id: string; raw: string };

function spoonListCursorFor(row: Pick<RecipeSpoon, "cookedAt" | "id">): string {
  return `v1.${base64UrlEncodeText(JSON.stringify({ cookedAt: row.cookedAt.toISOString(), id: row.id }))}`;
}

function parseSpoonListCursor(url: URL): SpoonListCursor | null {
  const raw = url.searchParams.get("cursor");
  if (raw === null || raw.trim() === "") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("v1.")) {
    throw new ApiV1Error("invalid_cursor", "cursor must be a Spoonjoy spoon list cursor");
  }
  try {
    const parsed = JSON.parse(base64UrlDecodeText(trimmed.slice(3))) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { cookedAt?: unknown }).cookedAt === "string" &&
      typeof (parsed as { id?: unknown }).id === "string"
    ) {
      const cookedAt = new Date((parsed as { cookedAt: string }).cookedAt);
      if (!Number.isNaN(cookedAt.getTime()) && cookedAt.toISOString() === (parsed as { cookedAt: string }).cookedAt) {
        return { cookedAt, id: (parsed as { id: string }).id, raw: trimmed };
      }
    }
  } catch {
    throw new ApiV1Error("invalid_cursor", "cursor must be a Spoonjoy spoon list cursor");
  }
  throw new ApiV1Error("invalid_cursor", "cursor must be a Spoonjoy spoon list cursor");
}

function spoonListCursorWhere(cursor: SpoonListCursor | null): Prisma.RecipeSpoonWhereInput {
  if (!cursor) return {};
  return {
    OR: [
      { cookedAt: { lt: cursor.cookedAt } },
      { cookedAt: cursor.cookedAt, id: { lt: cursor.id } },
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

const API_V1_SPOON_CHEF_SELECT = { id: true, username: true, photoUrl: true } as const;

type ApiV1SpoonWithChef = Prisma.RecipeSpoonGetPayload<{
  include: { chef: { select: typeof API_V1_SPOON_CHEF_SELECT } };
}>;

function spoonPayload(spoon: ApiV1SpoonWithChef, origin: string) {
  return {
    id: spoon.id,
    chefId: spoon.chefId,
    recipeId: spoon.recipeId,
    cookedAt: spoon.cookedAt.toISOString(),
    photoUrl: publicAssetUrl(origin, spoon.photoUrl),
    note: spoon.note,
    nextTime: spoon.nextTime,
    deletedAt: spoon.deletedAt?.toISOString() ?? null,
    createdAt: spoon.createdAt.toISOString(),
    updatedAt: spoon.updatedAt.toISOString(),
    chef: {
      ...spoon.chef,
      photoUrl: publicAssetUrl(origin, spoon.chef.photoUrl),
    },
  };
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

type RecipeCoverOwnerRow = {
  id: string;
  title: string;
  chefId: string;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  coverMode: string;
};

type RecipeForApiV1SpoonCoverRow = RecipeCoverOwnerRow & {
  activeCover: {
    id: string;
    recipeId: string;
    imageUrl: string | null;
    stylizedImageUrl: string | null;
    sourceType: string;
    status: string;
    archivedAt: Date | null;
  } | null;
};

function preferredCoverVariant(cover: Pick<RecipeCover, "imageUrl" | "stylizedImageUrl">): RecipeCoverVariant | null {
  if (cover.stylizedImageUrl) return "stylized";
  if (cover.imageUrl) return "image";
  return null;
}

function coverURLForVariant(cover: Pick<RecipeCover, "imageUrl" | "stylizedImageUrl">, variant: RecipeCoverVariant): string | null {
  return variant === "stylized" ? cover.stylizedImageUrl : cover.imageUrl;
}

function fullCoverPayload(
  cover: RecipeCover,
  recipe: Pick<RecipeCoverOwnerRow, "activeCoverId" | "activeCoverVariant">,
  origin: string,
) {
  const activeVariant = recipe.activeCoverId === cover.id &&
    (recipe.activeCoverVariant === "image" || recipe.activeCoverVariant === "stylized")
    ? recipe.activeCoverVariant
    : null;
  const displayVariant = activeVariant ?? preferredCoverVariant(cover);
  const displayUrl = displayVariant ? publicAssetUrl(origin, coverURLForVariant(cover, displayVariant)) : null;
  return {
    id: cover.id,
    recipeId: cover.recipeId,
    status: cover.status,
    sourceType: cover.sourceType,
    imageUrl: publicAssetUrl(origin, cover.imageUrl),
    stylizedImageUrl: publicAssetUrl(origin, cover.stylizedImageUrl),
    displayUrl,
    activeVariant,
    provenanceLabel: displayVariant ? getRecipeCoverProvenanceLabel(cover.sourceType, displayVariant) : null,
    sourceSpoonId: cover.sourceSpoonId,
    createdById: cover.createdById,
    archivedAt: cover.archivedAt?.toISOString() ?? null,
    generationStatus: cover.generationStatus,
    failureReason: cover.failureReason,
    sourceImageUrl: publicAssetUrl(origin, cover.sourceImageUrl),
    createdAt: cover.createdAt.toISOString(),
  };
}

async function loadOwnedCoverRecipe(db: ApiV1Db, principal: ApiPrincipal, recipeId: string): Promise<RecipeCoverOwnerRow> {
  const recipe = await db.recipe.findFirst({
    where: { id: recipeId, deletedAt: null },
    select: {
      id: true,
      title: true,
      chefId: true,
      activeCoverId: true,
      activeCoverVariant: true,
      coverMode: true,
    },
  });
  if (!recipe) {
    throw new ApiV1Error("not_found", "Recipe not found", { resource: "recipe", recipeId });
  }
  if (recipe.chefId !== principal.id) {
    throw new ApiV1Error("insufficient_scope", "Only the recipe owner can manage covers", { resource: "recipe", recipeId });
  }
  return recipe;
}

async function loadActiveRecipeForSpoons(db: ApiV1Db, recipeId: string): Promise<RecipeForApiV1SpoonCoverRow> {
  const recipe = await db.recipe.findFirst({
    where: { id: recipeId, deletedAt: null },
    select: {
      id: true,
      title: true,
      chefId: true,
      activeCoverId: true,
      activeCoverVariant: true,
      coverMode: true,
      activeCover: {
        select: {
          id: true,
          recipeId: true,
          imageUrl: true,
          stylizedImageUrl: true,
          sourceType: true,
          status: true,
          archivedAt: true,
        },
      },
    },
  });
  if (!recipe) {
    throw new ApiV1Error("not_found", "Recipe not found", { resource: "recipe", recipeId });
  }
  return recipe;
}

async function loadSpoonInRecipe(db: ApiV1Db, recipeId: string, spoonId: string): Promise<ApiV1SpoonWithChef> {
  const spoon = await db.recipeSpoon.findFirst({
    where: { id: spoonId, recipeId, deletedAt: null },
    include: { chef: { select: API_V1_SPOON_CHEF_SELECT } },
  });
  if (!spoon) {
    throw new ApiV1Error("not_found", "Spoon not found", { resource: "recipe_spoon", spoonId, recipeId });
  }
  return spoon;
}

export function mapSpoonDomainErrorForApiV1(error: unknown, spoonId?: string): ApiV1Error {
  if (error instanceof SpoonValidationError) {
    return new ApiV1Error("validation_error", error.message);
  }
  if (error instanceof SpoonAuthError) {
    return new ApiV1Error("insufficient_scope", error.message);
  }
  if (error instanceof SpoonNotFoundError) {
    return new ApiV1Error("not_found", "Spoon not found", { resource: "recipe_spoon", spoonId });
  }
  throw error;
}

function parseCoverOffset(url: URL): number {
  const raw = url.searchParams.get("offset");
  if (raw === null || raw.trim() === "") return 0;
  const offset = Number(raw);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ApiV1Error("validation_error", "offset must be an integer greater than or equal to 0");
  }
  return offset;
}

function requiredCoverVariant(value: unknown): RecipeCoverVariant {
  if (value === "image" || value === "stylized") return value;
  throw new ApiV1Error("validation_error", "variant must be image or stylized");
}

function optionalCoverVariant(value: unknown): RecipeCoverVariant | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredCoverVariant(value);
}

function coverMutationError(error: unknown, coverId: string): ApiV1Error {
  const message = error instanceof Error ? error.message : "Cover mutation failed";
  if (/cover was not found/i.test(message)) {
    return new ApiV1Error("not_found", "Cover not found", { resource: "recipe_cover", coverId });
  }
  return new ApiV1Error("validation_error", message);
}

async function activeFullCoverPayload(db: ApiV1Db, recipe: RecipeCoverOwnerRow, origin: string) {
  if (!recipe.activeCoverId) return null;
  const cover = await db.recipeCover.findFirst({
    where: { id: recipe.activeCoverId, recipeId: recipe.id },
  });
  return cover ? fullCoverPayload(cover, recipe, origin) : null;
}

function coverCloudflare(args: ApiV1RouteArgs) {
  const cf = apiV1CloudflareFor(args);
  return {
    bucket: cf?.env?.PHOTOS,
    env: (cf?.env ?? null) as (ImageGenEnv & PostHogServerEnv) | null,
    waitUntil: apiV1WaitUntilFor(args),
  };
}

async function validateApiV1SpoonPhotoUrl(args: ApiV1RouteArgs, principal: ApiPrincipal, photoUrl: string) {
  const cf = apiV1CloudflareFor(args);
  try {
    await validateSpoonPhotoAssignment({
      photoUrl,
      ownerId: principal.id,
      bucket: cf?.env?.PHOTOS,
      allowLocalImageFallback: false,
      allowExternal: false,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      if (error.status === 400) {
        throw new ApiV1Error("validation_error", error.message);
      }
      throw new ApiV1Error("internal_error", error.message);
    }
    throw error;
  }
}

async function validateApiV1SpoonPhotoUrlForWrite(input: {
  args: ApiV1RouteArgs;
  principal: ApiPrincipal;
  photoUrl: string | null;
}) {
  if (!input.photoUrl) return;
  await validateApiV1SpoonPhotoUrl(input.args, input.principal, input.photoUrl);
}

async function runOrQueueCoverStylization(
  args: ApiV1RouteArgs,
  input: {
    db: ApiV1Db;
    userId: string;
    recipeId: string;
    coverId: string;
    rawPhotoUrl: string;
    recipeTitle: string;
    sourceType: "chef-upload" | "spoon";
    activateWhenReady: boolean;
    suppressAutoActivation: boolean;
    activationGuard?: { activeCoverId: string | null; activeCoverVariant: string | null; coverMode: string };
  },
) {
  const { bucket, env, waitUntil } = coverCloudflare(args);
  const task = deferBackgroundTask(() => scheduleSpoonCoverStylization({
    db: input.db,
    userId: input.userId,
    recipeId: input.recipeId,
    coverId: input.coverId,
    rawPhotoUrl: input.rawPhotoUrl,
    recipeTitle: input.recipeTitle,
    env,
    bucket,
    sourceType: input.sourceType,
    activateWhenReady: input.activateWhenReady,
    suppressAutoActivation: input.suppressAutoActivation,
    activationGuard: input.activationGuard,
  }));
  if (waitUntil) {
    waitUntil(task);
    return;
  }
  await task;
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

function objectBody(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiV1Error("validation_error", `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function importText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiV1Error("validation_error", `${field} must be a nonblank string`);
  }
  if (value.length > MAX_IMPORT_TEXT_LENGTH) {
    throw new ApiV1Error("validation_error", `${field} must be at most ${MAX_IMPORT_TEXT_LENGTH} characters`);
  }
  return value;
}

function optionalImportSourceUrl(value: unknown): string | null {
  return optionalNullableString(value, "source.url", 2048);
}

function parseRecipeImportCapture(value: unknown): NativeRecipeImportCapture | null {
  if (value === undefined || value === null) return null;
  const capture = objectBody(value, "source.capture");
  assertKnownFields(capture, ["source", "assetIdentifier"]);
  const source = nonblankString(capture.source, "source.capture.source", 64);
  if (source !== "camera" && source !== "photo-library") {
    throw new ApiV1Error("validation_error", "source.capture.source must be camera or photo-library");
  }
  return {
    source,
    assetIdentifier: optionalNullableString(capture.assetIdentifier, "source.capture.assetIdentifier", 512),
  };
}

function parseRecipeImportSource(value: unknown): NativeRecipeImportSource {
  const source = objectBody(value, "source");
  assertKnownFields(source, ["type", "url", "text", "jsonLd", "capture"]);
  const type = nonblankString(source.type, "source.type", 32);
  switch (type) {
    case "url":
      return { type, url: nonblankString(source.url, "source.url", 2048) };
    case "video-url":
      return { type, url: nonblankString(source.url, "source.url", 2048) };
    case "text":
      return {
        type,
        text: importText(source.text, "source.text"),
        sourceUrl: optionalImportSourceUrl(source.url),
        capture: parseRecipeImportCapture(source.capture),
      };
    case "json-ld":
      if (!hasOwnField(source, "jsonLd") || source.jsonLd === null || source.jsonLd === undefined) {
        throw new ApiV1Error("validation_error", "source.jsonLd is required");
      }
      return {
        type,
        jsonLd: source.jsonLd,
        sourceUrl: optionalImportSourceUrl(source.url),
      };
    default:
      throw new ApiV1Error("validation_error", "source.type must be url, video-url, text, or json-ld");
  }
}

function recipeImportProvidersConfigured(args: ApiV1RouteArgs): boolean {
  return Boolean(apiV1CloudflareFor(args)?.env?.OPENAI_API_KEY?.trim());
}

function providerSecretImportData(clientMutationId: string) {
  return {
    recipe: null,
    importCode: "provider_secret_required",
    blockers: [{
      capability: "ProviderSecret",
      provider: "openai",
      resource: "recipe-import",
    }],
    mutation: { clientMutationId, replayed: false },
  };
}

function mapRecipeImportErrorForApiV1(error: ImportRecipeError): ApiV1Error {
  if (error.code === "rate-limited") {
    return new ApiV1Error("rate_limited", error.message, {
      importCode: error.code,
      upstreamStatus: error.status,
    });
  }
  return new ApiV1Error("validation_error", error.message, {
    importCode: error.code,
    upstreamStatus: error.status,
  });
}

async function handleRecipeImport(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId", "source", "dryRun"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const source = parseRecipeImportSource(body.source);
  const dryRun = optionalBoolean(body.dryRun, "dryRun");

  return await runIdempotentShoppingMutation(args, requestId, principal, body, clientMutationId, "recipes.import", async (db) => {
    if (!recipeImportProvidersConfigured(args)) {
      return {
        status: 200,
        data: providerSecretImportData(clientMutationId),
      };
    }

    try {
      const cloudflare = apiV1CloudflareFor(args)!;
      const rawEnv = cloudflare.env!;
      const env = rawEnv as NonNullable<ImportRecipeDeps["env"]>;
      const deps: ImportRecipeDeps = {
        db,
        env,
        bucket: (rawEnv as { PHOTOS?: R2Bucket }).PHOTOS,
        waitUntil: apiV1WaitUntilFor(args),
        imageGenRunner: (args.context as { imageGenRunner?: ImportRecipeDeps["imageGenRunner"] }).imageGenRunner,
        logger: console,
      };
      const importOptions = dryRun
        ? { chefId: principal.id, source, dryRun }
        : { chefId: principal.id, source };
      const result = await importRecipeFromSource(importOptions, deps);
      const origin = publicContentOrigin(args);
      const recipe = result.recipeId ? await loadRecipeById(db, result.recipeId) : null;
      return {
        status: result.recipeId ? 201 : 200,
        data: {
          recipe: recipe ? recipeDetail(recipe, origin) : null,
          importCode: null,
          blockers: [],
          confidence: result.confidence,
          source: result.source,
          existingRecipeId: result.existingRecipeId,
          coverPending: result.coverPending,
          mutation: { clientMutationId, replayed: false },
        },
      };
    } catch (error) {
      if (error instanceof ImportRecipeError) {
        throw mapRecipeImportErrorForApiV1(error);
      }
      throw error;
    }
  });
}

async function handleRecipeSpoonList(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal | null, recipeId: string) {
  const db = await getRequestDb(args.context);
  const origin = publicContentOrigin(args);
  const url = new URL(args.request.url);
  const limit = parseListLimit(url);
  const cursor = parseSpoonListCursor(url);
  await loadActiveRecipeForSpoons(db, recipeId);
  const spoons = await db.recipeSpoon.findMany({
    where: {
      recipeId,
      deletedAt: null,
      AND: [spoonListCursorWhere(cursor)],
    },
    orderBy: [{ cookedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: { chef: { select: API_V1_SPOON_CHEF_SELECT } },
  });
  const page = spoons.slice(0, limit);
  const hasMore = spoons.length > limit;
  const nextCursor = hasMore && page.length > 0 ? spoonListCursorFor(page[page.length - 1]!) : null;

  return apiV1Success(requestId, {
    limit,
    cursor: cursor?.raw ?? null,
    nextCursor,
    hasMore,
    spoons: page.map((spoon) => spoonPayload(spoon, origin)),
  }, 200, principal ? authenticatedPublicCacheHeaders() : publicCacheHeaders());
}

async function maybeCreateSpoonCover(
  args: ApiV1RouteArgs,
  input: {
    db: ApiV1Db;
    origin: string;
    principal: ApiPrincipal;
    recipe: RecipeForApiV1SpoonCoverRow;
    spoon: RecipeSpoon;
    isOriginCook: boolean;
    useAsRecipeCover: boolean;
  },
) {
  if (!input.spoon.photoUrl) {
    return {
      activeCover: await activeFullCoverPayload(input.db, input.recipe, input.origin),
      previousActiveCover: null,
      createdCover: null,
      generationStatus: null,
    };
  }
  const decision = decideSpoonCoverCreation({
    recipe: input.recipe,
    userId: input.principal.id,
    isOriginCook: input.isOriginCook,
    hasPhoto: true,
    useAsRecipeCover: input.useAsRecipeCover,
  });
  if (!decision.shouldCreateCover) {
    return {
      activeCover: await activeFullCoverPayload(input.db, input.recipe, input.origin),
      previousActiveCover: null,
      createdCover: null,
      generationStatus: null,
    };
  }

  const previousActiveCover = await activeFullCoverPayload(input.db, input.recipe, input.origin);
  const cover = await createCover(input.db, {
    recipeId: input.recipe.id,
    imageUrl: input.spoon.photoUrl,
    sourceType: "spoon",
    sourceSpoonId: input.spoon.id,
    status: "processing",
    createdById: input.principal.id,
    sourceImageUrl: input.spoon.photoUrl,
    generationStatus: "processing",
  });
  await activateSpoonCoverForDecision(input.db, {
    recipeId: input.recipe.id,
    coverId: cover.id,
    decision,
    previousActiveCoverId: input.recipe.activeCoverId,
  });
  await runOrQueueCoverStylization(args, {
    db: input.db,
    userId: input.principal.id,
    recipeId: input.recipe.id,
    coverId: cover.id,
    rawPhotoUrl: input.spoon.photoUrl,
    recipeTitle: input.recipe.title,
    sourceType: "spoon",
    activateWhenReady: false,
    suppressAutoActivation: false,
  });

  const nextRecipe = await loadActiveRecipeForSpoons(input.db, input.recipe.id);
  const createdCover = await input.db.recipeCover.findFirstOrThrow({ where: { id: cover.id, recipeId: input.recipe.id } });
  return {
    activeCover: await activeFullCoverPayload(input.db, nextRecipe, input.origin),
    previousActiveCover,
    createdCover: fullCoverPayload(createdCover, nextRecipe, input.origin),
    generationStatus: createdCover.generationStatus,
  };
}

async function isRecoveredOriginCook(db: ApiV1Db, recipe: RecipeForApiV1SpoonCoverRow, spoon: RecipeSpoon, principal: ApiPrincipal) {
  if (recipe.chefId !== principal.id || spoon.chefId !== principal.id || spoon.recipeId !== recipe.id) return false;
  const earlierSpoon = await db.recipeSpoon.findFirst({
    where: {
      id: { not: spoon.id },
      chefId: principal.id,
      recipeId: recipe.id,
      deletedAt: null,
      createdAt: { lte: spoon.createdAt },
    },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return !earlierSpoon;
}

async function existingSpoonCoverPayload(db: ApiV1Db, recipe: RecipeForApiV1SpoonCoverRow, spoon: RecipeSpoon, origin: string) {
  const existingCover = await db.recipeCover.findFirst({
    where: {
      recipeId: recipe.id,
      sourceSpoonId: spoon.id,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!existingCover) return null;
  const nextRecipe = await loadActiveRecipeForSpoons(db, recipe.id);
  return {
    activeCover: await activeFullCoverPayload(db, nextRecipe, origin),
    previousActiveCover: null,
    createdCover: fullCoverPayload(existingCover, nextRecipe, origin),
    generationStatus: existingCover.generationStatus,
  };
}

async function recipeSpoonCreateData(
  args: ApiV1RouteArgs,
  input: {
    db: ApiV1Db;
    principal: ApiPrincipal;
    recipeId: string;
    spoonId: string;
    clientMutationId: string;
    isOriginCook: boolean;
    useAsRecipeCover: boolean;
  },
) {
  const origin = publicContentOrigin(args);
  const recipe = await loadActiveRecipeForSpoons(input.db, input.recipeId);
  const spoon = await input.db.recipeSpoon.findFirstOrThrow({
    where: { id: input.spoonId, recipeId: input.recipeId },
    include: { chef: { select: API_V1_SPOON_CHEF_SELECT } },
  });
  const existingCoverData = await existingSpoonCoverPayload(input.db, recipe, spoon, origin);
  const coverData = existingCoverData ?? await maybeCreateSpoonCover(args, {
    db: input.db,
    origin,
    principal: input.principal,
    recipe,
    spoon,
    isOriginCook: input.isOriginCook,
    useAsRecipeCover: input.useAsRecipeCover,
  });
  return {
    spoon: spoonPayload(spoon, origin),
    isOriginCook: input.isOriginCook,
    ...coverData,
    mutation: { clientMutationId: input.clientMutationId, replayed: false },
  };
}

async function recoverRecipeSpoonCreate(
  args: ApiV1RouteArgs,
  input: {
    db: ApiV1Db;
    principal: ApiPrincipal;
    recipeId: string;
    clientMutationId: string;
    useAsRecipeCover: boolean;
    record: ApiIdempotencyKey;
  },
) {
  const spoon = await input.db.recipeSpoon.findFirst({
    where: {
      id: input.record.id,
      chefId: input.principal.id,
      recipeId: input.recipeId,
      deletedAt: null,
    },
  });
  if (!spoon) return null;
  const recipe = await loadActiveRecipeForSpoons(input.db, input.recipeId);
  return {
    status: 201,
    data: await recipeSpoonCreateData(args, {
      db: input.db,
      principal: input.principal,
      recipeId: input.recipeId,
      spoonId: spoon.id,
      clientMutationId: input.clientMutationId,
      isOriginCook: await isRecoveredOriginCook(input.db, recipe, spoon, input.principal),
      useAsRecipeCover: input.useAsRecipeCover,
    }),
  };
}

async function handleRecipeSpoonCreate(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId", "note", "nextTime", "cookedAt", "photoUrl", "useAsRecipeCover"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const note = optionalNullableString(body.note, "note");
  const nextTime = optionalNullableString(body.nextTime, "nextTime");
  const cookedAt = optionalIsoDate(body.cookedAt, "cookedAt");
  const photoUrl = optionalNullableString(body.photoUrl, "photoUrl", 2048);
  const useAsRecipeCover = optionalBoolean(body.useAsRecipeCover, "useAsRecipeCover");
  return await runIdempotentShoppingMutation(args, requestId, principal, body, clientMutationId, "recipes.spoons.create", async (db, reservation) => {
    await loadActiveRecipeForSpoons(db, recipeId);
    let created: Awaited<ReturnType<typeof createSpoon>>;
    try {
      created = await createSpoon(db, {
        id: reservation.id,
        chefId: principal.id,
        recipeId,
        note,
        nextTime,
        cookedAt,
        photoUrl,
      });
    } catch (error) {
      throw mapSpoonDomainErrorForApiV1(error);
    }
    return {
      status: 201,
      data: await recipeSpoonCreateData(args, {
        db,
        principal,
        recipeId,
        spoonId: created.spoon.id,
        clientMutationId,
        isOriginCook: created.isOriginCook,
        useAsRecipeCover,
      }),
    };
  }, {
    beforeWrite: async () => validateApiV1SpoonPhotoUrlForWrite({
      args,
      principal,
      photoUrl,
    }),
    deleteReservationOnWriteError: false,
    hasRecoverableWrite: async (db, record) => Boolean(await db.recipeSpoon.findFirst({
      where: {
        id: record.id,
        chefId: principal.id,
        recipeId,
      },
      select: { id: true },
    })),
    recoverInFlight: async (db, record) => recoverRecipeSpoonCreate(args, {
      db,
      principal,
      recipeId,
      clientMutationId,
      useAsRecipeCover,
      record,
    }),
  });
}

async function handleRecipeSpoonUpdate(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string, spoonId: string) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId", "note", "nextTime", "cookedAt", "photoUrl"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const patch: UpdateSpoonPatch = {};
  if (hasOwnField(body, "note")) patch.note = optionalNullableString(body.note, "note");
  if (hasOwnField(body, "nextTime")) patch.nextTime = optionalNullableString(body.nextTime, "nextTime");
  if (hasOwnField(body, "cookedAt")) patch.cookedAt = optionalIsoDate(body.cookedAt, "cookedAt");
  if (hasOwnField(body, "photoUrl")) patch.photoUrl = optionalNullableString(body.photoUrl, "photoUrl", 2048);
  return await runIdempotentShoppingMutation(args, requestId, principal, body, clientMutationId, "recipes.spoons.update", async (db) => {
    const origin = publicContentOrigin(args);
    await loadSpoonInRecipe(db, recipeId, spoonId);
    try {
      await updateSpoon(db, spoonId, principal.id, patch);
    } catch (error) {
      throw mapSpoonDomainErrorForApiV1(error, spoonId);
    }
    const spoon = await loadSpoonInRecipe(db, recipeId, spoonId);
    return {
      status: 200,
      data: {
        spoon: spoonPayload(spoon, origin),
        mutation: { clientMutationId, replayed: false },
      },
    };
  }, {
    beforeWrite: async () => validateApiV1SpoonPhotoUrlForWrite({
      args,
      principal,
      photoUrl: typeof patch.photoUrl === "string" ? patch.photoUrl : null,
    }),
  });
}

async function handleRecipeSpoonDelete(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string, spoonId: string) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId"]);
  const url = new URL(args.request.url);
  const clientMutationId = nonblankString(
    body.clientMutationId ?? args.request.headers.get("X-Client-Mutation-Id") ?? url.searchParams.get("clientMutationId"),
    "clientMutationId",
  );
  const idempotencyBody = { clientMutationId };

  return await runIdempotentShoppingMutation(args, requestId, principal, idempotencyBody, clientMutationId, "recipes.spoons.delete", async (db) => {
    const origin = publicContentOrigin(args);
    await loadSpoonInRecipe(db, recipeId, spoonId);
    let deleted: RecipeSpoon;
    try {
      deleted = await deleteSpoon(db, spoonId, principal.id);
    } catch (error) {
      throw mapSpoonDomainErrorForApiV1(error, spoonId);
    }
    const spoon = await db.recipeSpoon.findFirstOrThrow({
      where: { id: deleted.id, recipeId },
      include: { chef: { select: API_V1_SPOON_CHEF_SELECT } },
    });
    return {
      status: 200,
      data: {
        removed: true,
        spoon: spoonPayload(spoon, origin),
        mutation: { clientMutationId, replayed: false },
      },
    };
  });
}

async function handleRecipeCoverList(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string) {
  const db = await getRequestDb(args.context);
  const origin = publicContentOrigin(args);
  const url = new URL(args.request.url);
  const includeArchived = url.searchParams.get("includeArchived") === "true";
  const limit = parseListLimit(url);
  const offset = parseCoverOffset(url);
  const recipe = await loadOwnedCoverRecipe(db, principal, recipeId);
  const covers = await db.recipeCover.findMany({
    where: {
      recipeId,
      ...(includeArchived ? {} : { status: { not: "archived" }, archivedAt: null }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    skip: offset,
  });
  const page = covers.slice(0, limit);
  const spoonImages = await db.recipeSpoon.findMany({
    where: {
      recipeId,
      deletedAt: null,
      photoUrl: { not: null },
      NOT: { photoUrl: "" },
    },
    select: {
      id: true,
      recipeId: true,
      chefId: true,
      photoUrl: true,
      cookedAt: true,
      createdAt: true,
      updatedAt: true,
      chef: { select: { id: true, username: true, photoUrl: true } },
    },
    orderBy: [{ cookedAt: "desc" }, { id: "desc" }],
    take: 20,
  });

  return apiV1PrivateSuccess(requestId, {
    covers: page.map((cover) => fullCoverPayload(cover, recipe, origin)),
    activeCover: await activeFullCoverPayload(db, recipe, origin),
    spoonImages: spoonImages
      .filter((spoon): spoon is typeof spoon & { photoUrl: string } => Boolean(spoon.photoUrl))
      .map((spoon) => ({
        id: spoon.id,
        recipeId: spoon.recipeId,
        chefId: spoon.chefId,
        photoUrl: publicAssetUrl(origin, spoon.photoUrl),
        cookedAt: spoon.cookedAt.toISOString(),
        createdAt: spoon.createdAt.toISOString(),
        updatedAt: spoon.updatedAt.toISOString(),
        chef: spoon.chef,
      })),
    pagination: {
      limit,
      offset,
      nextOffset: covers.length > limit ? offset + page.length : null,
      hasMore: covers.length > limit,
    },
  });
}

async function handleRecipeCoverSetNoCover(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId", "confirmNoCover"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const confirmNoCover = requiredBoolean(body.confirmNoCover, "confirmNoCover");
  if (!confirmNoCover) {
    throw new ApiV1Error("validation_error", "confirmNoCover must be true");
  }

  return await runIdempotentShoppingMutation(args, requestId, principal, body, clientMutationId, "recipes.covers.set-no-cover", async (db) => {
    const origin = publicContentOrigin(args);
    const recipe = await loadOwnedCoverRecipe(db, principal, recipeId);
    const previousActiveCover = await activeFullCoverPayload(db, recipe, origin);
    const nextRecipe = await db.recipe.update({
      where: { id: recipe.id },
      data: {
        activeCoverId: null,
        activeCoverVariant: null,
        coverMode: "none",
      },
      select: {
        id: true,
        title: true,
        chefId: true,
        activeCoverId: true,
        activeCoverVariant: true,
        coverMode: true,
      },
    });
    return {
      status: 200,
      data: {
        activeCover: await activeFullCoverPayload(db, nextRecipe, origin),
        previousActiveCover,
        mutation: { clientMutationId, replayed: false },
      },
    };
  });
}

async function handleRecipeCoverActivate(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string, coverId: string) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId", "variant"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const variant = requiredCoverVariant(body.variant);

  return await runIdempotentShoppingMutation(args, requestId, principal, body, clientMutationId, "recipes.covers.activate", async (db) => {
    const origin = publicContentOrigin(args);
    const recipe = await loadOwnedCoverRecipe(db, principal, recipeId);
    const previousActiveCover = await activeFullCoverPayload(db, recipe, origin);
    try {
      await setActiveRecipeCover(db, { recipeId, coverId, variant });
    } catch (error) {
      throw coverMutationError(error, coverId);
    }
    const nextRecipe = await loadOwnedCoverRecipe(db, principal, recipeId);
    return {
      status: 200,
      data: {
        activeCover: await activeFullCoverPayload(db, nextRecipe, origin),
        previousActiveCover,
        mutation: { clientMutationId, replayed: false },
      },
    };
  });
}

async function handleRecipeCoverArchive(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string, coverId: string) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId", "replacementCoverId", "replacementVariant", "confirmNoCover", "deleteSafeObjects"]);
  const url = new URL(args.request.url);
  const clientMutationId = nonblankString(
    body.clientMutationId ?? args.request.headers.get("X-Client-Mutation-Id") ?? url.searchParams.get("clientMutationId"),
    "clientMutationId",
  );
  const idempotencyBody = { ...body, clientMutationId };
  const replacementCoverId = optionalNullableString(body.replacementCoverId, "replacementCoverId");
  const replacementVariant = optionalCoverVariant(body.replacementVariant);
  const confirmNoCover = optionalBoolean(body.confirmNoCover, "confirmNoCover");
  const deleteSafeObjects = optionalBoolean(body.deleteSafeObjects, "deleteSafeObjects");

  return await runIdempotentShoppingMutation(args, requestId, principal, idempotencyBody, clientMutationId, "recipes.covers.archive", async (db) => {
    const origin = publicContentOrigin(args);
    const recipe = await loadOwnedCoverRecipe(db, principal, recipeId);
    const previousActiveCover = await activeFullCoverPayload(db, recipe, origin);
    let archivedCoverId: string;
    try {
      const result = await archiveRecipeCover(db, {
        recipeId,
        coverId,
        replacementCoverId,
        replacementVariant,
        confirmNoCover,
      });
      archivedCoverId = result.archivedCover.id;
    } catch (error) {
      throw coverMutationError(error, coverId);
    }
    const nextRecipe = await loadOwnedCoverRecipe(db, principal, recipeId);
    const archivedCover = await db.recipeCover.findFirstOrThrow({ where: { id: archivedCoverId, recipeId } });
    return {
      status: 200,
      data: {
        activeCover: await activeFullCoverPayload(db, nextRecipe, origin),
        previousActiveCover,
        archivedCover: fullCoverPayload(archivedCover, nextRecipe, origin),
        warnings: deleteSafeObjects ? ["deleteSafeObjects is not implemented; the cover record was archived without deleting image objects."] : [],
        mutation: { clientMutationId, replayed: false },
      },
    };
  });
}

async function handleRecipeCoverRegenerate(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId", "coverId", "activateWhenReady"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const coverId = nonblankString(body.coverId, "coverId");
  const activateWhenReady = optionalBoolean(body.activateWhenReady, "activateWhenReady");

  return await runIdempotentShoppingMutation(args, requestId, principal, body, clientMutationId, "recipes.covers.regenerate", async (db) => {
    const origin = publicContentOrigin(args);
    const recipe = await loadOwnedCoverRecipe(db, principal, recipeId);
    const previousActiveCover = await activeFullCoverPayload(db, recipe, origin);
    const cover = await db.recipeCover.findFirst({ where: { id: coverId, recipeId } });
    if (!cover) {
      throw new ApiV1Error("not_found", "Cover not found", { resource: "recipe_cover", coverId });
    }
    if (cover.status === "archived" || cover.archivedAt) {
      throw new ApiV1Error("validation_error", "Archived covers cannot be regenerated");
    }
    const rawPhotoUrl = cover.sourceImageUrl || cover.imageUrl;
    if (!rawPhotoUrl.trim()) {
      throw new ApiV1Error("validation_error", "Cover has no source image");
    }
    await db.recipeCover.update({
      where: { id: cover.id },
      data: {
        status: "processing",
        generationStatus: "processing",
        failureReason: null,
        sourceImageUrl: cover.sourceImageUrl ?? rawPhotoUrl,
      },
    });
    await runOrQueueCoverStylization(args, {
      db,
      userId: principal.id,
      recipeId,
      coverId: cover.id,
      rawPhotoUrl,
      recipeTitle: recipe.title,
      sourceType: cover.sourceType === "spoon" ? "spoon" : "chef-upload",
      activateWhenReady,
      suppressAutoActivation: !activateWhenReady,
      activationGuard: activateWhenReady ? {
        activeCoverId: recipe.activeCoverId,
        activeCoverVariant: recipe.activeCoverVariant,
        coverMode: recipe.coverMode,
      } : undefined,
    });
    const nextRecipe = await loadOwnedCoverRecipe(db, principal, recipeId);
    const regeneratedCover = await db.recipeCover.findFirstOrThrow({ where: { id: cover.id, recipeId } });
    return {
      status: 200,
      data: {
        activeCover: await activeFullCoverPayload(db, nextRecipe, origin),
        previousActiveCover,
        createdCover: fullCoverPayload(regeneratedCover, nextRecipe, origin),
        generationStatus: regeneratedCover.generationStatus,
        mutation: { clientMutationId, replayed: false },
      },
    };
  });
}

async function handleRecipeCoverFromSpoon(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string, spoonId: string) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId", "activate", "generateEditorial"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const activate = optionalBoolean(body.activate, "activate");
  const generateEditorial = optionalBoolean(body.generateEditorial, "generateEditorial", true);

  return await runIdempotentShoppingMutation(args, requestId, principal, body, clientMutationId, "recipes.covers.from-spoon", async (db) => {
    const origin = publicContentOrigin(args);
    const recipe = await loadOwnedCoverRecipe(db, principal, recipeId);
    const previousActiveCover = await activeFullCoverPayload(db, recipe, origin);
    const spoon = await db.recipeSpoon.findFirst({
      where: { id: spoonId, recipeId, deletedAt: null, photoUrl: { not: null } },
      select: { id: true, photoUrl: true },
    });
    if (!spoon?.photoUrl) {
      throw new ApiV1Error("not_found", "Spoon photo not found", { resource: "recipe_spoon", spoonId });
    }
    const cover = await createCover(db, {
      recipeId,
      imageUrl: spoon.photoUrl,
      sourceType: "spoon",
      sourceSpoonId: spoon.id,
      status: generateEditorial ? "processing" : "ready",
      createdById: principal.id,
      sourceImageUrl: spoon.photoUrl,
      generationStatus: generateEditorial ? "processing" : "none",
    });
    if (generateEditorial) {
      await runOrQueueCoverStylization(args, {
        db,
        userId: principal.id,
        recipeId,
        coverId: cover.id,
        rawPhotoUrl: spoon.photoUrl,
        recipeTitle: recipe.title,
        sourceType: "spoon",
        activateWhenReady: activate,
        suppressAutoActivation: !activate,
        activationGuard: activate ? {
          activeCoverId: recipe.activeCoverId,
          activeCoverVariant: recipe.activeCoverVariant,
          coverMode: recipe.coverMode,
        } : undefined,
      });
    } else if (activate) {
      await setActiveRecipeCover(db, { recipeId, coverId: cover.id, variant: "image" });
    }
    const nextRecipe = await loadOwnedCoverRecipe(db, principal, recipeId);
    const createdCover = await db.recipeCover.findFirstOrThrow({ where: { id: cover.id, recipeId } });
    return {
      status: 201,
      data: {
        activeCover: await activeFullCoverPayload(db, nextRecipe, origin),
        previousActiveCover,
        createdCover: fullCoverPayload(createdCover, nextRecipe, origin),
        generationStatus: createdCover.generationStatus,
        mutation: { clientMutationId, replayed: false },
      },
    };
  });
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

function optionalIsoDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ApiV1Error("validation_error", `${field} must be an ISO datetime string`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new ApiV1Error("validation_error", `${field} must be an ISO datetime string`);
  }
  return parsed;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ApiV1Error("validation_error", `${field} must be a boolean`);
  }
  return value;
}

function optionalBoolean(value: unknown, field: string, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  return requiredBoolean(value, field);
}

function idempotentMutationBody(
  requestId: string,
  data: Record<string, unknown>,
) {
  return { ok: true, requestId, data };
}

export async function shouldKeepIdempotencyReservationForRecovery(input: {
  deleteReservationOnWriteError?: boolean;
  hasRecoverableWrite?: () => Promise<boolean>;
}): Promise<boolean> {
  if (input.deleteReservationOnWriteError !== false || !input.hasRecoverableWrite) return false;
  try {
    return await input.hasRecoverableWrite();
  } catch {
    return false;
  }
}

export async function deleteIdempotencyReservationAfterWriteError(input: {
  keepReservationForRecovery: boolean;
  deleteReservation: () => Promise<unknown>;
}): Promise<void> {
  if (input.keepReservationForRecovery) return;
  try {
    await input.deleteReservation();
  } catch {
    // The original write error is more useful than a best-effort cleanup miss.
  }
}

async function runIdempotentShoppingMutation(
  args: ApiV1RouteArgs,
  requestId: string,
  principal: ApiPrincipal,
  body: Record<string, unknown>,
  clientMutationId: string,
  operation: string,
  write: (db: ApiV1WriteDb, reservation: ApiIdempotencyKey) => Promise<{ status: number; data: Record<string, unknown> }>,
  options: {
    beforeWrite?: (
      db: ApiV1WriteDb,
      record: ApiIdempotencyKey,
    ) => Promise<void>;
    deleteReservationOnWriteError?: boolean;
    hasRecoverableWrite?: (
      db: ApiV1WriteDb,
      record: ApiIdempotencyKey,
    ) => Promise<boolean>;
    recoverInFlight?: (
      db: ApiV1WriteDb,
      record: ApiIdempotencyKey,
    ) => Promise<{ status: number; data: Record<string, unknown> } | null>;
  } = {},
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
    const recovered = await options.recoverInFlight?.(db, reservation.record);
    if (recovered) {
      const storedBody = idempotentMutationBody(requestId, recovered.data);
      await completeIdempotencyKey(db, reservation.record.id, {
        status: recovered.status,
        body: storedBody,
      });
      const replay = replayIdempotencyResponse({
        responseStatus: recovered.status,
        responseBody: JSON.stringify(storedBody),
      }, requestId);
      return withApiV1Telemetry(Response.json(replay.body, {
        status: replay.status,
        headers: apiV1PrivateHeaders(requestId),
      }), { idempotencyOutcome: "replayed", operation });
    }
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
    await options.beforeWrite?.(db, reservation.record);
    result = await write(db, reservation.record);
  } catch (error) {
    const keepReservationForRecovery = await shouldKeepIdempotencyReservationForRecovery({
      deleteReservationOnWriteError: options.deleteReservationOnWriteError,
      hasRecoverableWrite: options.hasRecoverableWrite
        ? () => options.hasRecoverableWrite!(db, reservation.record)
        : undefined,
    });
    await deleteIdempotencyReservationAfterWriteError({
      keepReservationForRecovery,
      deleteReservation: () => db.apiIdempotencyKey.delete({ where: { id: reservation.record.id } }),
    });
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

async function handleShoppingAddFromRecipe(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId", "recipeId", "scaleFactor"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const recipeId = nonblankString(body.recipeId, "recipeId");
  const scaleFactor = optionalPositiveNumber(body.scaleFactor, "scaleFactor") ?? 1;

  return await runIdempotentShoppingMutation(args, requestId, principal, body, clientMutationId, "shopping-list.add-from-recipe", async (db) => {
    const list = await loadShoppingListForUser(db, principal.id);
    const recipe = await db.recipe.findFirst({
      where: { id: recipeId, deletedAt: null },
      include: {
        steps: {
          orderBy: { stepNum: "asc" },
          include: {
            ingredients: {
              orderBy: { id: "asc" },
              include: { unit: true, ingredientRef: true },
            },
          },
        },
      },
    });
    if (!recipe) {
      throw new ApiV1Error("not_found", "Recipe not found", { resource: "recipe", recipeId });
    }

    const requestedRows = new Map<string, {
      unitId: string;
      ingredientRefId: string;
      ingredientName: string;
      quantity: number;
    }>();
    for (const step of recipe.steps) {
      for (const ingredient of step.ingredients) {
        const key = `${ingredient.unitId}:${ingredient.ingredientRefId}`;
        const requested = requestedRows.get(key);
        const scaledQuantity = ingredient.quantity * scaleFactor;
        if (requested) {
          requested.quantity += scaledQuantity;
        } else {
          requestedRows.set(key, {
            unitId: ingredient.unitId,
            ingredientRefId: ingredient.ingredientRefId,
            ingredientName: ingredient.ingredientRef.name,
            quantity: scaledQuantity,
          });
        }
      }
    }

    const ingredientRefIds = Array.from(new Set(Array.from(requestedRows.values()).map((row) => row.ingredientRefId)));
    const existingRows = ingredientRefIds.length > 0
      ? await db.shoppingListItem.findMany({
          where: {
            shoppingListId: list.id,
            ingredientRefId: { in: ingredientRefIds },
          },
          include: { unit: true, ingredientRef: true },
        })
      : [];
    const existingByKey = new Map(existingRows.map((row) => [`${row.unitId ?? ""}:${row.ingredientRefId}`, row]));
    let nextSortIndexValue = await nextShoppingSortIndex(db, list.id);
    let created = 0;
    let updated = 0;
    const operations: Prisma.PrismaPromise<ShoppingItemRow>[] = [];
    for (const requested of requestedRows.values()) {
      const existing = existingByKey.get(`${requested.unitId}:${requested.ingredientRefId}`);
      const affordance = resolveIngredientAffordance(requested.ingredientName, null, null);
      if (existing) {
        const sortIndex = existing.deletedAt || existing.checkedAt || existing.checked
          ? nextSortIndexValue++
          : existing.sortIndex;
        operations.push(db.shoppingListItem.update({
          where: { id: existing.id },
          data: {
            quantity: (existing.quantity ?? 0) + requested.quantity,
            checked: false,
            checkedAt: null,
            deletedAt: null,
            sortIndex,
            categoryKey: existing.categoryKey ?? affordance.categoryKey,
            iconKey: existing.iconKey ?? affordance.iconKey,
          },
          include: { unit: true, ingredientRef: true },
        }));
        updated += 1;
      } else {
        operations.push(db.shoppingListItem.create({
          data: {
            shoppingListId: list.id,
            quantity: requested.quantity,
            unitId: requested.unitId,
            ingredientRefId: requested.ingredientRefId,
            sortIndex: nextSortIndexValue++,
            categoryKey: affordance.categoryKey,
            iconKey: affordance.iconKey,
          },
          include: { unit: true, ingredientRef: true },
        }));
        created += 1;
      }
    }
    const changedItems = operations.length > 0 ? await db.$transaction(operations) : [];

    return {
      status: 200,
      data: {
        recipe: { id: recipe.id, title: recipe.title },
        created,
        updated,
        items: changedItems.map(shoppingItem),
        mutation: { clientMutationId, replayed: false },
      },
    };
  });
}

async function handleShoppingClear(
  args: ApiV1RouteArgs,
  requestId: string,
  principal: ApiPrincipal,
  mode: "completed" | "all",
) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const operation = mode === "completed" ? "shopping-list.clear-completed" : "shopping-list.clear-all";

  return await runIdempotentShoppingMutation(args, requestId, principal, body, clientMutationId, operation, async (db) => {
    const list = await loadShoppingListForUser(db, principal.id);
    const items = await db.shoppingListItem.findMany({
      where: {
        shoppingListId: list.id,
        deletedAt: null,
        ...(mode === "completed" ? { OR: [{ checkedAt: { not: null } }, { checked: true }] } : {}),
      },
      include: { unit: true, ingredientRef: true },
      orderBy: [{ sortIndex: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
    });

    const deletedAt = new Date();
    const removedItems = items.length > 0
      ? await db.$transaction(items.map((item) => db.shoppingListItem.update({
        where: { id: item.id },
        data: { deletedAt },
        include: { unit: true, ingredientRef: true },
      })))
      : [];

    return {
      status: 200,
      data: {
        removed: removedItems.length,
        items: removedItems.map(shoppingItem),
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

function hasOwnField(body: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, field);
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
    if (path === "recipes/import" && args.request.method !== "POST") {
      throw new ApiV1Error("method_not_allowed", "Method not allowed", { allow: "POST" });
    }

    if (args.request.method === "POST" && path === "recipes/import") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeImport(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && segments[0] === "recipes" && segments.length === 2) {
      const principal = await authorize(path);
      const response = await handleRecipeDetail(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && segments[0] === "recipes" && segments[2] === "spoons" && segments.length === 3) {
      const principal = await authorize(path);
      const response = await handleRecipeSpoonList(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "POST" && segments[0] === "recipes" && segments[2] === "spoons" && segments.length === 3) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeSpoonCreate(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "PATCH" && segments[0] === "recipes" && segments[2] === "spoons" && segments.length === 4) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeSpoonUpdate(args, requestId, principal, segments[1], segments[3]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "DELETE" && segments[0] === "recipes" && segments[2] === "spoons" && segments.length === 4) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeSpoonDelete(args, requestId, principal, segments[1], segments[3]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && segments[0] === "recipes" && segments[2] === "covers" && segments.length === 3) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeCoverList(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "PATCH" && segments[0] === "recipes" && segments[2] === "covers" && segments.length === 3) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeCoverSetNoCover(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "PATCH" && segments[0] === "recipes" && segments[2] === "covers" && segments.length === 4) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeCoverActivate(args, requestId, principal, segments[1], segments[3]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "DELETE" && segments[0] === "recipes" && segments[2] === "covers" && segments.length === 4) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeCoverArchive(args, requestId, principal, segments[1], segments[3]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "POST" && segments[0] === "recipes" && segments[2] === "covers" && segments[3] === "regenerate" && segments.length === 4) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeCoverRegenerate(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "POST" && segments[0] === "recipes" && segments[2] === "covers" && segments[3] === "from-spoon" && segments.length === 5) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeCoverFromSpoon(args, requestId, principal, segments[1], segments[4]);
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

    if (args.request.method === "POST" && path === "shopping-list/add-from-recipe") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleShoppingAddFromRecipe(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "POST" && path === "shopping-list/clear-completed") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleShoppingClear(args, requestId, principal, "completed");
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "POST" && path === "shopping-list/clear-all") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleShoppingClear(args, requestId, principal, "all");
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
    captureApiV1InternalException(args, error);
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

/**
 * Capture the stack for an unexpected (non-`ApiV1Error`) internal failure.
 * The lifecycle `spoonjoy.api_v1.request` event records only `error_code:
 * "internal_error"` with no stack, so without this an infra/bug failure on a
 * v1 route is invisible in exception telemetry. Wrapped in `ctx.waitUntil` so
 * capture never blocks or breaks the 500 response.
 */
function captureApiV1InternalException(args: ApiV1RouteArgs, error: unknown): void {
  const cloudflare = apiV1CloudflareFor(args);
  const env = cloudflare?.env;
  const waitUntil = apiV1WaitUntilFor(args);
  if (!env || !waitUntil) return;

  const postHogConfig = resolvePostHogServerConfig(env);
  if (!postHogConfig.enabled) return;

  waitUntil(
    captureException(postHogConfig, {
      error,
      distinctId: "server",
      route: new URL(args.request.url).pathname,
      method: args.request.method,
    }),
  );
}
