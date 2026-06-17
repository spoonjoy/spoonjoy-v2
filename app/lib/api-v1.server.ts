import type { ApiCredential, ApiIdempotencyKey, RecipeCover } from "@prisma/client";
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
import {
  disconnectNativeOAuthConnection,
  listNativeOAuthConnections,
  loadNativeAccountSnapshot,
  readNativeNotificationPreferences,
  registerNativePushDevice,
  removeNativeAccountPhoto,
  revokeNativePushDevice,
  updateNativeAccountProfile,
  updateNativeNotificationPreferences,
  uploadNativeAccountPhoto,
  type ApiV1AccountResult,
} from "~/lib/api-v1-account.server";
import {
  listNativeProfileGraph,
  loadNativeUserProfile,
  searchNativeSpoonjoy,
  type ApiV1UsersSearchResult,
} from "~/lib/api-v1-users-search.server";
import {
  createNativeRecipe,
  deleteNativeRecipe,
  forkNativeRecipe,
  parseNativeRecipeCreateBody,
  parseNativeRecipeDeleteBody,
  parseNativeRecipeForkBody,
  parseNativeRecipePatchBody,
  updateNativeRecipe,
  type ApiV1RecipeWriteResult,
} from "~/lib/api-v1-recipe-writes.server";
import {
  createNativeRecipeStep,
  createNativeRecipeStepIngredient,
  deleteNativeRecipeStep,
  deleteNativeRecipeStepIngredient,
  parseNativeRecipeStepCreateBody,
  parseNativeRecipeStepDeleteBody,
  parseNativeRecipeStepIngredientCreateBody,
  parseNativeRecipeStepIngredientDeleteBody,
  parseNativeRecipeStepOutputUsesBody,
  parseNativeRecipeStepPatchBody,
  parseNativeRecipeStepReorderBody,
  reorderNativeRecipeStep,
  replaceNativeRecipeStepOutputUses,
  updateNativeRecipeStep,
  type ApiV1RecipeStepResult,
  type NativeRecipeStepCreateInput,
  type NativeRecipeStepIngredientInput,
  type NativeRecipeStepIngredientCreateInput,
} from "~/lib/api-v1-recipe-steps.server";
import { getVapidConfig, type VapidEnv } from "~/lib/env.server";
import { notifyForkOfMyRecipe } from "~/lib/notification-triggers.server";
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
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
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

function apiV1AccountResponse<T>(requestId: string, result: ApiV1AccountResult<T>): Response {
  if (!result.ok) {
    throw new ApiV1Error(result.code, result.message, result.details);
  }
  return apiV1PrivateSuccess(requestId, result.data, result.status);
}

function apiV1UsersSearchResponse<T>(
  requestId: string,
  result: ApiV1UsersSearchResult<T>,
  principal: ApiPrincipal | null,
): Response {
  if (!result.ok) {
    throw new ApiV1Error(result.code, result.message, result.details);
  }
  if (result.private) {
    return apiV1PrivateSuccess(requestId, result.data, result.status);
  }
  return apiV1Success(
    requestId,
    result.data,
    result.status,
    principal ? authenticatedPublicCacheHeaders() : publicCacheHeaders(),
  );
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
    case "POST recipe-create":
      return "recipes.create";
    case "PATCH recipe-write":
      return "recipes.update";
    case "DELETE recipe-write":
      return "recipes.delete";
    case "POST recipe-fork":
      return "recipes.fork";
    case "POST recipe-steps":
      return "recipes.steps.create";
    case "PATCH recipe-step":
      return "recipes.steps.update";
    case "DELETE recipe-step":
      return "recipes.steps.delete";
    case "POST recipe-step-reorder":
      return "recipes.steps.reorder";
    case "POST recipe-step-ingredients":
      return "recipes.steps.ingredients.create";
    case "DELETE recipe-step-ingredient":
      return "recipes.steps.ingredients.delete";
    case "PUT recipe-step-output-uses":
      return "recipes.steps.output-uses.replace";
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
    case "GET me":
      return "account.read";
    case "PATCH me":
      return "account.update";
    case "POST me-photo":
      return "account.photo.upload";
    case "DELETE me-photo":
      return "account.photo.remove";
    case "GET me-kitchen":
      return "account.kitchen.bootstrap";
    case "GET me-notification-preferences":
      return "account.notifications.read";
    case "PATCH me-notification-preferences":
      return "account.notifications.update";
    case "POST me-apns-devices":
      return "account.apns.register";
    case "DELETE me-apns-device":
      return "account.apns.revoke";
    case "GET me-connections":
      return "account.connections.list";
    case "DELETE me-connection":
      return "account.connections.disconnect";
    case "GET tokens":
      return "tokens.list";
    case "POST tokens":
      return "tokens.create";
    case "DELETE token":
      return "tokens.revoke";
    case "GET user-profile":
      return "profiles.read";
    case "GET user-fellow-chefs":
      return "profiles.fellow-chefs.list";
    case "GET user-kitchen-visitors":
      return "profiles.kitchen-visitors.list";
    case "GET search":
      return "search.read";
    /* istanbul ignore next -- @preserve API_V1_RESOURCES only defines the method/resource combinations above. */
    default:
      return undefined;
  }
}

function defaultIdempotencyOutcome(operation: string | undefined, errorCode: ApiV1ErrorCode | undefined) {
  if (!operation) return undefined;
  if (operation.startsWith("tokens.")) return "none";
  if (!operation.startsWith("shopping-list.items.") && !operation.startsWith("recipes.")) return undefined;
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
  const methods = new Set<string>();
  for (const resource of API_V1_RESOURCES) {
    if (!pathTemplateMatches(resource.path, path)) continue;
    for (const method of resource.methods) {
      methods.add(method);
    }
  }
  return methods.size > 0 ? Array.from(methods).join(", ") : null;
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
  if (principal.source !== "bearer") return true;
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

function canReadShoppingListSearch(principal: ApiPrincipal | null): boolean {
  return Boolean(principal?.scopes.includes("shopping_list:read") || principal?.scopes.includes("kitchen:read"));
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
        usingSteps: [...step.usingSteps]
          .sort((a, b) => a.outputStepNum - b.outputStepNum)
          .map((use) => ({
            id: use.id,
            inputStepNum: use.inputStepNum,
            outputStepNum: use.outputStepNum,
            outputOfStep: {
              stepNum: use.outputOfStep.stepNum,
              stepTitle: use.outputOfStep.stepTitle,
            },
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
          usingSteps: {
            select: {
              id: true,
              inputStepNum: true,
              outputStepNum: true,
              outputOfStep: { select: { stepNum: true, stepTitle: true } },
            },
            orderBy: { outputStepNum: "asc" },
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

type ApiV1IdempotentMutationResult = { status: number; data: Record<string, unknown> };
type ApiV1IdempotentRecovery = (
  db: ApiV1WriteDb,
  reservation: ApiIdempotencyKey,
) => Promise<ApiV1IdempotentMutationResult | null>;

function apiV1IdempotentResponse(
  requestId: string,
  operation: string,
  result: ApiV1IdempotentMutationResult,
  idempotencyOutcome: ApiV1TelemetryMetadata["idempotencyOutcome"],
): Response {
  const responseBody = idempotentMutationBody(requestId, result.data);
  return withApiV1Telemetry(Response.json(responseBody, {
    status: result.status,
    headers: apiV1PrivateHeaders(requestId),
  }), { idempotencyOutcome, operation });
}

function apiV1RecoveredReplayResponse(
  requestId: string,
  operation: string,
  result: ApiV1IdempotentMutationResult,
): Response {
  const responseBody = idempotentMutationBody(requestId, result.data);
  const replay = replayIdempotencyResponse({
    responseStatus: result.status,
    responseBody: JSON.stringify(responseBody),
  }, requestId);
  return withApiV1Telemetry(Response.json(replay.body, {
    status: replay.status,
    headers: apiV1PrivateHeaders(requestId),
  }), { idempotencyOutcome: "replayed", operation });
}

async function completeRecoveredIdempotencyKey(
  db: ApiV1WriteDb,
  reservation: ApiIdempotencyKey,
  requestId: string,
  result: ApiV1IdempotentMutationResult,
) {
  await completeIdempotencyKey(db, reservation.id, {
    status: result.status,
    body: idempotentMutationBody(requestId, result.data),
  });
}

export async function runIdempotentApiV1Mutation(
  args: ApiV1RouteArgs,
  requestId: string,
  principal: ApiPrincipal,
  body: Record<string, unknown>,
  clientMutationId: string,
  operation: string,
  write: (db: ApiV1WriteDb, reservation: ApiIdempotencyKey) => Promise<ApiV1IdempotentMutationResult>,
  recoverIncomplete?: ApiV1IdempotentRecovery,
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
    const recovered = recoverIncomplete ? await recoverIncomplete(db, reservation.record) : null;
    if (recovered) {
      await completeRecoveredIdempotencyKey(db, reservation.record, requestId, recovered);
      return apiV1RecoveredReplayResponse(requestId, operation, recovered);
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
    result = await write(db, reservation.record);
  } catch (error) {
    const recovered = recoverIncomplete && !(error instanceof ApiV1Error)
      ? await recoverIncomplete(db, reservation.record)
      : null;
    if (recovered) {
      await completeRecoveredIdempotencyKey(db, reservation.record, requestId, recovered);
      return apiV1IdempotentResponse(requestId, operation, recovered, "committed");
    }
    await db.apiIdempotencyKey.delete({ where: { id: reservation.record.id } }).catch(() => undefined);
    throw error;
  }

  const responseBody = idempotentMutationBody(requestId, result.data);
  try {
    await completeIdempotencyKey(db, reservation.record.id, {
      status: result.status,
      body: responseBody,
    });
  } catch (error) {
    if (!recoverIncomplete) throw error;
  }

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

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, clientMutationId, "shopping-list.items.create", async (db) => {
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

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, clientMutationId, "shopping-list.items.check", async (db) => {
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

  return await runIdempotentApiV1Mutation(args, requestId, principal, idempotencyBody, clientMutationId, "shopping-list.items.delete", async (db) => {
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

function recipeWriteResultOrThrow<T>(
  result: ApiV1RecipeWriteResult<T>,
): { status: number; data: T } {
  if (!result.ok) {
    throw new ApiV1Error(result.code, result.message, result.details);
  }
  return result;
}

function recipeStepResultOrThrow<T>(
  result: ApiV1RecipeStepResult<T>,
): { status: number; data: T } {
  if (!result.ok) {
    throw new ApiV1Error(result.code, result.message, result.details);
  }
  return result;
}

async function serializedRecipeOrThrow(db: ApiV1WriteDb, recipeId: string, origin: string) {
  const recipe = await loadRecipeById(db, recipeId);
  /* istanbul ignore next -- @preserve post-write reads are covered on every recipe write path; this is a defensive invariant tripwire. */
  if (!recipe) {
    throw new Error(`Recipe ${recipeId} was not readable after write`);
  }
  return recipeDetail(recipe, origin);
}

type SerializedRecipe = Awaited<ReturnType<typeof serializedRecipeOrThrow>>;
type SerializedRecipeStep = SerializedRecipe["steps"][number];

function findSerializedStep(recipe: SerializedRecipe, stepId: string): SerializedRecipeStep | null {
  return recipe.steps.find((step) => step.id === stepId) ?? null;
}

function findSerializedIngredient(recipe: SerializedRecipe, stepId: string, ingredientId: string) {
  const step = findSerializedStep(recipe, stepId);
  const ingredient = step?.ingredients.find((candidate) => candidate.id === ingredientId) ?? null;
  return step && ingredient ? { step, ingredient } : null;
}

async function serializedRecipeStepOrThrow(
  db: ApiV1WriteDb,
  recipeId: string,
  stepId: string,
  origin: string,
) {
  const recipe = await serializedRecipeOrThrow(db, recipeId, origin);
  const step = findSerializedStep(recipe, stepId);
  /* istanbul ignore next -- @preserve post-write reads are covered on every step write path; this is a defensive invariant tripwire. */
  if (!step) {
    throw new Error(`Recipe step ${stepId} was not readable after write`);
  }
  return { recipe, step };
}

async function serializedRecipeStepIngredientOrThrow(
  db: ApiV1WriteDb,
  recipeId: string,
  stepId: string,
  ingredientId: string,
  origin: string,
) {
  const recipe = await serializedRecipeOrThrow(db, recipeId, origin);
  const match = findSerializedIngredient(recipe, stepId, ingredientId);
  /* istanbul ignore next -- @preserve post-write reads are covered on every step ingredient write path; this is a defensive invariant tripwire. */
  if (!match) {
    throw new Error(`Recipe step ingredient ${ingredientId} was not readable after write`);
  }
  return { recipe, step: match.step, ingredient: match.ingredient };
}

function numericArraysEqual(actual: number[], expected: number[]) {
  if (actual.length !== expected.length) return false;
  return actual.every((value, index) => value === expected[index]);
}

function normalizedText(value: string) {
  return value.trim().toLowerCase();
}

function outputStepNumsForSerializedStep(step: SerializedRecipeStep) {
  return step.usingSteps.map((use) => use.outputStepNum).sort((a, b) => a - b);
}

function requestedOutputStepNums(outputStepNums: number[]) {
  return [...new Set(outputStepNums)].sort((a, b) => a - b);
}

function ingredientInputsMatch(
  actual: SerializedRecipeStep["ingredients"],
  expected: NativeRecipeStepIngredientInput[],
) {
  if (actual.length !== expected.length) return false;
  const actualKeys = actual
    .map((ingredient) => `${normalizedText(ingredient.name)}\u0000${normalizedText(ingredient.unit)}\u0000${ingredient.quantity}`)
    .sort();
  const expectedKeys = expected
    .map((ingredient) => `${normalizedText(ingredient.ingredientName)}\u0000${normalizedText(ingredient.unit)}\u0000${ingredient.quantity}`)
    .sort();
  return actualKeys.every((key, index) => key === expectedKeys[index]);
}

function stepMatchesCreateInput(step: SerializedRecipeStep, input: NativeRecipeStepCreateInput) {
  if (input.stepNum !== undefined && step.stepNum !== input.stepNum) return false;
  if (step.stepTitle !== input.stepTitle) return false;
  if (step.description !== input.description) return false;
  if (step.duration !== input.duration) return false;
  if (!numericArraysEqual(outputStepNumsForSerializedStep(step), requestedOutputStepNums(input.outputStepNums))) return false;
  if (!ingredientInputsMatch(step.ingredients, input.ingredients)) return false;
  return true;
}

function ingredientMatchesCreateInput(
  actual: SerializedRecipeStep["ingredients"][number],
  expected: NativeRecipeStepIngredientCreateInput,
) {
  return actual.quantity === expected.quantity &&
    normalizedText(actual.unit) === normalizedText(expected.unit) &&
    normalizedText(actual.name) === normalizedText(expected.ingredientName);
}

async function findMutationTombstone(
  db: ApiV1WriteDb,
  reservation: ApiIdempotencyKey,
  input: { operation: string; resourceType: string; resourceId: string; parentResourceId?: string },
) {
  const tombstone = await db.apiMutationTombstone.findUnique({
    where: {
      idempotencyKeyId_resourceType_resourceId: {
        idempotencyKeyId: reservation.id,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
      },
    },
  });
  if (!tombstone || tombstone.operation !== input.operation) return null;
  if (input.parentResourceId !== undefined && tombstone.parentResourceId !== input.parentResourceId) return null;
  return tombstone;
}

async function recoverNativeRecipeCreate(
  db: ApiV1WriteDb,
  reservation: ApiIdempotencyKey,
  input: { clientMutationId: string; origin: string; principalId: string },
): Promise<ApiV1IdempotentMutationResult | null> {
  const recipe = await loadRecipeById(db, reservation.id);
  if (!recipe || recipe.chef.id !== input.principalId) return null;
  return {
    status: 201,
    data: {
      created: true,
      recipe: recipeDetail(recipe, input.origin),
      mutation: { clientMutationId: input.clientMutationId, replayed: false },
    },
  };
}

async function recoverNativeRecipeUpdate(
  db: ApiV1WriteDb,
  _reservation: ApiIdempotencyKey,
  input: {
    clientMutationId: string;
    fields: {
      title?: string;
      description?: string | null;
      servings?: string | null;
    };
    origin: string;
    principalId: string;
    recipeId: string;
    updated: boolean;
  },
): Promise<ApiV1IdempotentMutationResult | null> {
  const recipe = await loadRecipeById(db, input.recipeId);
  if (!recipe || recipe.chef.id !== input.principalId) return null;
  if (input.fields.title !== undefined && recipe.title !== input.fields.title) return null;
  if (input.fields.description !== undefined && recipe.description !== input.fields.description) return null;
  if (input.fields.servings !== undefined && recipe.servings !== input.fields.servings) return null;
  return {
    status: 200,
    data: {
      updated: input.updated,
      recipe: recipeDetail(recipe, input.origin),
      mutation: { clientMutationId: input.clientMutationId, replayed: false },
    },
  };
}

async function recoverNativeRecipeDelete(
  db: ApiV1WriteDb,
  reservation: ApiIdempotencyKey,
  input: { clientMutationId: string; principalId: string; recipeId: string },
): Promise<ApiV1IdempotentMutationResult | null> {
  const recipe = await db.recipe.findUnique({
    where: { id: input.recipeId },
    select: { id: true, chefId: true, deletedAt: true, updatedAt: true },
  });
  if (!recipe || recipe.chefId !== input.principalId || !recipe.deletedAt) return null;
  if (recipe.deletedAt.getTime() < reservation.createdAt.getTime()) return null;
  return {
    status: 200,
    data: {
      deleted: true,
      recipe: {
        id: recipe.id,
        deletedAt: recipe.deletedAt.toISOString(),
        updatedAt: recipe.updatedAt.toISOString(),
      },
      mutation: { clientMutationId: input.clientMutationId, replayed: false },
    },
  };
}

async function recoverNativeRecipeFork(
  db: ApiV1WriteDb,
  reservation: ApiIdempotencyKey,
  input: {
    clientMutationId: string;
    origin: string;
    principalId: string;
    sourceRecipeId: string;
    titleOverride: string | null;
  },
): Promise<ApiV1IdempotentMutationResult | null> {
  const recipe = await loadRecipeById(db, reservation.id);
  if (
    !recipe ||
    recipe.chef.id !== input.principalId ||
    recipe.sourceRecipe?.id !== input.sourceRecipeId ||
    !recipe.sourceRecipe.chef
  ) {
    return null;
  }

  const baseTitle = input.titleOverride ?? recipe.sourceRecipe.title;
  return {
    status: 201,
    data: {
      fork: {
        appliedTitle: recipe.title,
        sourceChef: {
          id: recipe.sourceRecipe.chef.id,
          username: recipe.sourceRecipe.chef.username,
        },
        sourceRecipeId: recipe.sourceRecipe.id,
        titleWasSuffixed: recipe.title !== baseTitle,
      },
      recipe: recipeDetail(recipe, input.origin),
      mutation: { clientMutationId: input.clientMutationId, replayed: false },
    },
  };
}

async function handleRecipeCreate(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const body = await parseApiV1JsonBody(args.request);
  const parsed = parseNativeRecipeCreateBody(body);
  if (!parsed.ok) {
    throw new ApiV1Error(parsed.code, parsed.message, parsed.details);
  }
  const origin = publicContentOrigin(args);

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, parsed.data.clientMutationId, "recipes.create", async (db, reservation) => {
    const created = recipeWriteResultOrThrow(await createNativeRecipe(db, principal.id, parsed.data, { recipeId: reservation.id }));
    const recipe = await serializedRecipeOrThrow(db, created.data.recipeId, origin);
    return {
      status: created.status,
      data: {
        created: true,
        recipe,
        mutation: { clientMutationId: parsed.data.clientMutationId, replayed: false },
      },
    };
  }, (db, reservation) => recoverNativeRecipeCreate(db, reservation, {
    clientMutationId: parsed.data.clientMutationId,
    origin,
    principalId: principal.id,
  }));
}

async function handleRecipeUpdate(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string) {
  const body = await parseApiV1JsonBody(args.request);
  const parsed = parseNativeRecipePatchBody(body);
  if (!parsed.ok) {
    throw new ApiV1Error(parsed.code, parsed.message, parsed.details);
  }
  const origin = publicContentOrigin(args);
  const updated = Object.keys(parsed.data.fields).length > 0;

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, parsed.data.clientMutationId, "recipes.update", async (db) => {
    const updated = recipeWriteResultOrThrow(await updateNativeRecipe(db, principal.id, recipeId, parsed.data));
    const recipe = await serializedRecipeOrThrow(db, updated.data.recipeId, origin);
    return {
      status: updated.status,
      data: {
        updated: updated.data.updated,
        recipe,
        mutation: { clientMutationId: parsed.data.clientMutationId, replayed: false },
      },
    };
  }, (db, reservation) => recoverNativeRecipeUpdate(db, reservation, {
    clientMutationId: parsed.data.clientMutationId,
    origin,
    principalId: principal.id,
    recipeId,
    fields: parsed.data.fields,
    updated,
  }));
}

async function handleRecipeDelete(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string) {
  const body = await parseApiV1JsonBody(args.request);
  const url = new URL(args.request.url);
  const parsed = parseNativeRecipeDeleteBody(
    body,
    args.request.headers.get("X-Client-Mutation-Id") ?? url.searchParams.get("clientMutationId"),
  );
  if (!parsed.ok) {
    throw new ApiV1Error(parsed.code, parsed.message, parsed.details);
  }

  const idempotencyBody = { clientMutationId: parsed.data.clientMutationId };
  return await runIdempotentApiV1Mutation(args, requestId, principal, idempotencyBody, parsed.data.clientMutationId, "recipes.delete", async (db) => {
    const deleted = recipeWriteResultOrThrow(await deleteNativeRecipe(db, principal.id, recipeId));
    return {
      status: deleted.status,
      data: {
        deleted: true,
        recipe: {
          id: deleted.data.recipe.id,
          deletedAt: deleted.data.recipe.deletedAt.toISOString(),
          updatedAt: deleted.data.recipe.updatedAt.toISOString(),
        },
        mutation: { clientMutationId: parsed.data.clientMutationId, replayed: false },
      },
    };
  }, (db, reservation) => recoverNativeRecipeDelete(db, reservation, {
    clientMutationId: parsed.data.clientMutationId,
    principalId: principal.id,
    recipeId,
  }));
}

async function notifyNativeRecipeFork(
  args: ApiV1RouteArgs,
  db: ApiV1WriteDb,
  input: {
    appliedTitle: string;
    forkerId: string;
    forkedRecipeId: string;
    sourceChefId: string;
    sourceRecipeId: string;
  },
) {
  try {
    const vapid = getVapidConfig((args.context.cloudflare?.env ?? {}) as VapidEnv);
    const waitUntil = apiV1WaitUntilFor(args);
    const notifyTask = notifyForkOfMyRecipe(
      db,
      {
        forkedRecipeId: input.forkedRecipeId,
        sourceRecipeId: input.sourceRecipeId,
        forkerId: input.forkerId,
        sourceChefId: input.sourceChefId,
        appliedTitle: input.appliedTitle,
      },
      { vapid, waitUntil },
    );
    if (waitUntil) {
      waitUntil(notifyTask);
    } else {
      await notifyTask;
    }
  } catch {
    // VAPID is optional in local/dev environments; missing push config must not break a fork.
  }
}

async function handleRecipeFork(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, sourceRecipeId: string) {
  const body = await parseApiV1JsonBody(args.request);
  const parsed = parseNativeRecipeForkBody(body);
  if (!parsed.ok) {
    throw new ApiV1Error(parsed.code, parsed.message, parsed.details);
  }
  const origin = publicContentOrigin(args);

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, parsed.data.clientMutationId, "recipes.fork", async (db, reservation) => {
    const forked = recipeWriteResultOrThrow(await forkNativeRecipe(db, principal.id, sourceRecipeId, parsed.data, { recipeId: reservation.id }));
    await notifyNativeRecipeFork(args, db, {
      appliedTitle: forked.data.fork.appliedTitle,
      forkerId: principal.id,
      forkedRecipeId: forked.data.recipeId,
      sourceChefId: forked.data.fork.sourceChef.id,
      sourceRecipeId: forked.data.fork.sourceRecipeId,
    });
    const recipe = await serializedRecipeOrThrow(db, forked.data.recipeId, origin);
    return {
      status: forked.status,
      data: {
        fork: forked.data.fork,
        recipe,
        mutation: { clientMutationId: parsed.data.clientMutationId, replayed: false },
      },
    };
  }, (db, reservation) => recoverNativeRecipeFork(db, reservation, {
    clientMutationId: parsed.data.clientMutationId,
    origin,
    principalId: principal.id,
    sourceRecipeId,
    titleOverride: parsed.data.titleOverride,
  }));
}

async function recoverNativeRecipeStepCreate(
  db: ApiV1WriteDb,
  reservation: ApiIdempotencyKey,
  input: { clientMutationId: string; origin: string; principalId: string; recipeId: string; request: NativeRecipeStepCreateInput },
): Promise<ApiV1IdempotentMutationResult | null> {
  const recipeRow = await loadRecipeById(db, input.recipeId);
  if (!recipeRow || recipeRow.chef.id !== input.principalId) return null;
  const recipe = recipeDetail(recipeRow, input.origin);
  const step = findSerializedStep(recipe, reservation.id);
  if (!step || !stepMatchesCreateInput(step, input.request)) return null;
  return {
    status: 201,
    data: {
      created: true,
      step,
      recipe,
      mutation: { clientMutationId: input.clientMutationId, replayed: false },
    },
  };
}

async function recoverNativeRecipeStepUpdate(
  db: ApiV1WriteDb,
  _reservation: ApiIdempotencyKey,
  input: {
    clientMutationId: string;
    origin: string;
    principalId: string;
    recipeId: string;
    stepId: string;
    fields: {
      stepTitle?: string | null;
      description?: string;
      duration?: number | null;
      outputStepNums?: number[];
    };
    updated: boolean;
  },
): Promise<ApiV1IdempotentMutationResult | null> {
  const recipeRow = await loadRecipeById(db, input.recipeId);
  if (!recipeRow || recipeRow.chef.id !== input.principalId) return null;
  const recipe = recipeDetail(recipeRow, input.origin);
  const step = findSerializedStep(recipe, input.stepId);
  if (!step) return null;
  if (input.fields.stepTitle !== undefined && step.stepTitle !== input.fields.stepTitle) return null;
  if (input.fields.description !== undefined && step.description !== input.fields.description) return null;
  if (input.fields.duration !== undefined && step.duration !== input.fields.duration) return null;
  if (
    input.fields.outputStepNums !== undefined &&
    !numericArraysEqual(
      outputStepNumsForSerializedStep(step),
      requestedOutputStepNums(input.fields.outputStepNums),
    )
  ) {
    return null;
  }
  return {
    status: 200,
    data: {
      updated: input.updated,
      step,
      recipe,
      mutation: { clientMutationId: input.clientMutationId, replayed: false },
    },
  };
}

async function recoverNativeRecipeStepDelete(
  db: ApiV1WriteDb,
  reservation: ApiIdempotencyKey,
  input: { clientMutationId: string; origin: string; principalId: string; recipeId: string; stepId: string },
): Promise<ApiV1IdempotentMutationResult | null> {
  const tombstone = await findMutationTombstone(db, reservation, {
    operation: "recipes.steps.delete",
    resourceType: "recipe_step",
    resourceId: input.stepId,
    parentResourceId: input.recipeId,
  });
  if (!tombstone) return null;

  const recipeRow = await loadRecipeById(db, input.recipeId);
  if (!recipeRow || recipeRow.chef.id !== input.principalId) return null;
  const recipe = recipeDetail(recipeRow, input.origin);
  if (findSerializedStep(recipe, input.stepId)) return null;
  return {
    status: 200,
    data: {
      deleted: true,
      step: { id: input.stepId },
      recipe,
      mutation: { clientMutationId: input.clientMutationId, replayed: false },
    },
  };
}

async function recoverNativeRecipeStepIngredientCreate(
  db: ApiV1WriteDb,
  reservation: ApiIdempotencyKey,
  input: { clientMutationId: string; origin: string; principalId: string; recipeId: string; stepId: string; request: NativeRecipeStepIngredientCreateInput },
): Promise<ApiV1IdempotentMutationResult | null> {
  const recipeRow = await loadRecipeById(db, input.recipeId);
  if (!recipeRow || recipeRow.chef.id !== input.principalId) return null;
  const recipe = recipeDetail(recipeRow, input.origin);
  const match = findSerializedIngredient(recipe, input.stepId, reservation.id);
  if (!match || !ingredientMatchesCreateInput(match.ingredient, input.request)) return null;
  return {
    status: 201,
    data: {
      created: true,
      ingredient: match.ingredient,
      step: match.step,
      recipe,
      mutation: { clientMutationId: input.clientMutationId, replayed: false },
    },
  };
}

async function recoverNativeRecipeStepIngredientDelete(
  db: ApiV1WriteDb,
  reservation: ApiIdempotencyKey,
  input: { clientMutationId: string; origin: string; principalId: string; recipeId: string; stepId: string; ingredientId: string },
): Promise<ApiV1IdempotentMutationResult | null> {
  const tombstone = await findMutationTombstone(db, reservation, {
    operation: "recipes.steps.ingredients.delete",
    resourceType: "recipe_step_ingredient",
    resourceId: input.ingredientId,
    parentResourceId: input.stepId,
  });
  if (!tombstone) return null;

  const recipeRow = await loadRecipeById(db, input.recipeId);
  if (!recipeRow || recipeRow.chef.id !== input.principalId) return null;
  const recipe = recipeDetail(recipeRow, input.origin);
  const step = findSerializedStep(recipe, input.stepId);
  if (!step || step.ingredients.some((ingredient) => ingredient.id === input.ingredientId)) return null;
  return {
    status: 200,
    data: {
      deleted: true,
      ingredient: { id: input.ingredientId },
      step,
      recipe,
      mutation: { clientMutationId: input.clientMutationId, replayed: false },
    },
  };
}

async function recoverNativeRecipeStepReorder(
  db: ApiV1WriteDb,
  _reservation: ApiIdempotencyKey,
  input: { clientMutationId: string; origin: string; principalId: string; recipeId: string; stepId: string; toStepNum: number; reordered: boolean },
): Promise<ApiV1IdempotentMutationResult | null> {
  const recipeRow = await loadRecipeById(db, input.recipeId);
  if (!recipeRow || recipeRow.chef.id !== input.principalId) return null;
  const recipe = recipeDetail(recipeRow, input.origin);
  const step = findSerializedStep(recipe, input.stepId);
  if (!step || step.stepNum !== input.toStepNum) return null;
  return {
    status: 200,
    data: {
      reordered: input.reordered,
      step,
      recipe,
      mutation: { clientMutationId: input.clientMutationId, replayed: false },
    },
  };
}

async function recoverNativeRecipeStepOutputUses(
  db: ApiV1WriteDb,
  _reservation: ApiIdempotencyKey,
  input: { clientMutationId: string; origin: string; principalId: string; recipeId: string; stepId: string; outputStepNums: number[] },
): Promise<ApiV1IdempotentMutationResult | null> {
  const recipeRow = await loadRecipeById(db, input.recipeId);
  if (!recipeRow || recipeRow.chef.id !== input.principalId) return null;
  const recipe = recipeDetail(recipeRow, input.origin);
  const step = findSerializedStep(recipe, input.stepId);
  if (!step) return null;
  if (!numericArraysEqual(
    outputStepNumsForSerializedStep(step),
    requestedOutputStepNums(input.outputStepNums),
  )) {
    return null;
  }
  return {
    status: 200,
    data: {
      replaced: true,
      step,
      recipe,
      mutation: { clientMutationId: input.clientMutationId, replayed: false },
    },
  };
}

async function handleRecipeStepCreate(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string) {
  const body = await parseApiV1JsonBody(args.request);
  const parsed = parseNativeRecipeStepCreateBody(body);
  if (!parsed.ok) {
    throw new ApiV1Error(parsed.code, parsed.message, parsed.details);
  }
  const origin = publicContentOrigin(args);

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, parsed.data.clientMutationId, "recipes.steps.create", async (db, reservation) => {
    const created = recipeStepResultOrThrow(await createNativeRecipeStep(db, principal.id, recipeId, parsed.data, { stepId: reservation.id }));
    const { recipe, step } = await serializedRecipeStepOrThrow(db, created.data.recipeId, created.data.stepId, origin);
    return {
      status: created.status,
      data: {
        created: true,
        step,
        recipe,
        mutation: { clientMutationId: parsed.data.clientMutationId, replayed: false },
      },
    };
  }, (db, reservation) => recoverNativeRecipeStepCreate(db, reservation, {
    clientMutationId: parsed.data.clientMutationId,
    origin,
    principalId: principal.id,
    recipeId,
    request: parsed.data,
  }));
}

async function handleRecipeStepUpdate(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string, stepId: string) {
  const body = await parseApiV1JsonBody(args.request);
  const parsed = parseNativeRecipeStepPatchBody(body);
  if (!parsed.ok) {
    throw new ApiV1Error(parsed.code, parsed.message, parsed.details);
  }
  const origin = publicContentOrigin(args);
  const updated = Object.keys(parsed.data.fields).length > 0;

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, parsed.data.clientMutationId, "recipes.steps.update", async (db) => {
    const saved = recipeStepResultOrThrow(await updateNativeRecipeStep(db, principal.id, recipeId, stepId, parsed.data));
    const { recipe, step } = await serializedRecipeStepOrThrow(db, saved.data.recipeId, saved.data.stepId, origin);
    return {
      status: saved.status,
      data: {
        updated: saved.data.updated,
        step,
        recipe,
        mutation: { clientMutationId: parsed.data.clientMutationId, replayed: false },
      },
    };
  }, (db, reservation) => recoverNativeRecipeStepUpdate(db, reservation, {
    clientMutationId: parsed.data.clientMutationId,
    origin,
    principalId: principal.id,
    recipeId,
    stepId,
    fields: parsed.data.fields,
    updated,
  }));
}

async function handleRecipeStepDelete(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string, stepId: string) {
  const body = await parseApiV1JsonBody(args.request);
  const url = new URL(args.request.url);
  const parsed = parseNativeRecipeStepDeleteBody(
    body,
    args.request.headers.get("X-Client-Mutation-Id") ?? url.searchParams.get("clientMutationId"),
  );
  if (!parsed.ok) {
    throw new ApiV1Error(parsed.code, parsed.message, parsed.details);
  }

  const origin = publicContentOrigin(args);
  const idempotencyBody = { clientMutationId: parsed.data.clientMutationId };
  return await runIdempotentApiV1Mutation(args, requestId, principal, idempotencyBody, parsed.data.clientMutationId, "recipes.steps.delete", async (db, reservation) => {
    const deleted = recipeStepResultOrThrow(await deleteNativeRecipeStep(db, principal.id, recipeId, stepId, {
      tombstone: { idempotencyKeyId: reservation.id, operation: "recipes.steps.delete" },
    }));
    const recipe = await serializedRecipeOrThrow(db, deleted.data.recipeId, origin);
    return {
      status: deleted.status,
      data: {
        deleted: true,
        step: deleted.data.step,
        recipe,
        mutation: { clientMutationId: parsed.data.clientMutationId, replayed: false },
      },
    };
  }, (db, reservation) => recoverNativeRecipeStepDelete(db, reservation, {
    clientMutationId: parsed.data.clientMutationId,
    origin,
    principalId: principal.id,
    recipeId,
    stepId,
  }));
}

async function handleRecipeStepIngredientCreate(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string, stepId: string) {
  const body = await parseApiV1JsonBody(args.request);
  const parsed = parseNativeRecipeStepIngredientCreateBody(body);
  if (!parsed.ok) {
    throw new ApiV1Error(parsed.code, parsed.message, parsed.details);
  }
  const origin = publicContentOrigin(args);

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, parsed.data.clientMutationId, "recipes.steps.ingredients.create", async (db, reservation) => {
    const created = recipeStepResultOrThrow(await createNativeRecipeStepIngredient(db, principal.id, recipeId, stepId, parsed.data, { ingredientId: reservation.id }));
    const { recipe, step, ingredient } = await serializedRecipeStepIngredientOrThrow(db, created.data.recipeId, created.data.stepId, created.data.ingredientId, origin);
    return {
      status: created.status,
      data: {
        created: true,
        ingredient,
        step,
        recipe,
        mutation: { clientMutationId: parsed.data.clientMutationId, replayed: false },
      },
    };
  }, (db, reservation) => recoverNativeRecipeStepIngredientCreate(db, reservation, {
    clientMutationId: parsed.data.clientMutationId,
    origin,
    principalId: principal.id,
    recipeId,
    stepId,
    request: parsed.data,
  }));
}

async function handleRecipeStepIngredientDelete(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string, stepId: string, ingredientId: string) {
  const body = await parseApiV1JsonBody(args.request);
  const url = new URL(args.request.url);
  const parsed = parseNativeRecipeStepIngredientDeleteBody(
    body,
    args.request.headers.get("X-Client-Mutation-Id") ?? url.searchParams.get("clientMutationId"),
  );
  if (!parsed.ok) {
    throw new ApiV1Error(parsed.code, parsed.message, parsed.details);
  }

  const origin = publicContentOrigin(args);
  const idempotencyBody = { clientMutationId: parsed.data.clientMutationId };
  return await runIdempotentApiV1Mutation(args, requestId, principal, idempotencyBody, parsed.data.clientMutationId, "recipes.steps.ingredients.delete", async (db, reservation) => {
    const deleted = recipeStepResultOrThrow(await deleteNativeRecipeStepIngredient(db, principal.id, recipeId, stepId, ingredientId, {
      tombstone: { idempotencyKeyId: reservation.id, operation: "recipes.steps.ingredients.delete" },
    }));
    const recipe = await serializedRecipeOrThrow(db, deleted.data.recipeId, origin);
    const step = findSerializedStep(recipe, deleted.data.stepId);
    if (!step) {
      throw new Error(`Recipe step ${deleted.data.stepId} was not readable after ingredient delete`);
    }
    return {
      status: deleted.status,
      data: {
        deleted: true,
        ingredient: deleted.data.ingredient,
        step,
        recipe,
        mutation: { clientMutationId: parsed.data.clientMutationId, replayed: false },
      },
    };
  }, (db, reservation) => recoverNativeRecipeStepIngredientDelete(db, reservation, {
    clientMutationId: parsed.data.clientMutationId,
    origin,
    principalId: principal.id,
    recipeId,
    stepId,
    ingredientId,
  }));
}

async function handleRecipeStepReorder(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string) {
  const body = await parseApiV1JsonBody(args.request);
  const parsed = parseNativeRecipeStepReorderBody(body);
  if (!parsed.ok) {
    throw new ApiV1Error(parsed.code, parsed.message, parsed.details);
  }
  const origin = publicContentOrigin(args);

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, parsed.data.clientMutationId, "recipes.steps.reorder", async (db) => {
    const reordered = recipeStepResultOrThrow(await reorderNativeRecipeStep(db, principal.id, recipeId, parsed.data));
    const { recipe, step } = await serializedRecipeStepOrThrow(db, reordered.data.recipeId, reordered.data.stepId, origin);
    return {
      status: reordered.status,
      data: {
        reordered: reordered.data.reordered,
        step,
        recipe,
        mutation: { clientMutationId: parsed.data.clientMutationId, replayed: false },
      },
    };
  }, (db, reservation) => recoverNativeRecipeStepReorder(db, reservation, {
    clientMutationId: parsed.data.clientMutationId,
    origin,
    principalId: principal.id,
    recipeId,
    stepId: parsed.data.stepId,
    toStepNum: parsed.data.toStepNum,
    reordered: true,
  }));
}

async function handleRecipeStepOutputUsesReplace(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string) {
  const body = await parseApiV1JsonBody(args.request);
  const parsed = parseNativeRecipeStepOutputUsesBody(body);
  if (!parsed.ok) {
    throw new ApiV1Error(parsed.code, parsed.message, parsed.details);
  }
  const origin = publicContentOrigin(args);

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, parsed.data.clientMutationId, "recipes.steps.output-uses.replace", async (db) => {
    const replaced = recipeStepResultOrThrow(await replaceNativeRecipeStepOutputUses(db, principal.id, recipeId, parsed.data));
    const { recipe, step } = await serializedRecipeStepOrThrow(db, replaced.data.recipeId, replaced.data.stepId, origin);
    return {
      status: replaced.status,
      data: {
        replaced: replaced.data.replaced,
        step,
        recipe,
        mutation: { clientMutationId: parsed.data.clientMutationId, replayed: false },
      },
    };
  }, (db, reservation) => recoverNativeRecipeStepOutputUses(db, reservation, {
    clientMutationId: parsed.data.clientMutationId,
    origin,
    principalId: principal.id,
    recipeId,
    stepId: parsed.data.inputStepId,
    outputStepNums: parsed.data.outputStepNums,
  }));
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
    where: { userId: authenticated.id, revokedAt: null, oauthClientId: null },
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

    if (args.request.method === "POST" && path === "recipes") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeCreate(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    const segments = path.split("/").filter(Boolean);
    if (args.request.method === "GET" && segments[0] === "recipes" && segments.length === 2) {
      const principal = await authorize(path);
      const response = await handleRecipeDetail(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "PATCH" && segments[0] === "recipes" && segments.length === 2) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeUpdate(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "DELETE" && segments[0] === "recipes" && segments.length === 2) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeDelete(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "POST" && segments[0] === "recipes" && segments[2] === "fork" && segments.length === 3) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeFork(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "POST" && segments[0] === "recipes" && segments[2] === "steps" && segments.length === 3) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeStepCreate(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "PATCH" && segments[0] === "recipes" && segments[2] === "steps" && segments.length === 4) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeStepUpdate(args, requestId, principal, segments[1], segments[3]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "DELETE" && segments[0] === "recipes" && segments[2] === "steps" && segments.length === 4) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeStepDelete(args, requestId, principal, segments[1], segments[3]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "POST" && segments[0] === "recipes" && segments[2] === "steps" && segments[3] === "reorder" && segments.length === 4) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeStepReorder(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "POST" && segments[0] === "recipes" && segments[2] === "steps" && segments[4] === "ingredients" && segments.length === 5) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeStepIngredientCreate(args, requestId, principal, segments[1], segments[3]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "DELETE" && segments[0] === "recipes" && segments[2] === "steps" && segments[4] === "ingredients" && segments.length === 6) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeStepIngredientDelete(args, requestId, principal, segments[1], segments[3], segments[5]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "PUT" && segments[0] === "recipes" && segments[2] === "step-output-uses" && segments.length === 3) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeStepOutputUsesReplace(args, requestId, principal, segments[1]);
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

    if (args.request.method === "GET" && path === "me") {
      const principal = await authorize(path) as ApiPrincipal;
      const db = await getRequestDb(args.context);
      const response = apiV1AccountResponse(requestId, await loadNativeAccountSnapshot(db, principal.id));
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "PATCH" && path === "me") {
      const principal = await authorize(path) as ApiPrincipal;
      const body = await parseApiV1JsonBody(args.request);
      const db = await getRequestDb(args.context);
      const response = apiV1AccountResponse(requestId, await updateNativeAccountProfile(db, principal.id, body));
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && path === "me/kitchen") {
      const principal = await authorize(path) as ApiPrincipal;
      const db = await getRequestDb(args.context);
      const response = apiV1AccountResponse(requestId, await loadNativeAccountSnapshot(db, principal.id));
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "POST" && path === "me/photo") {
      const principal = await authorize(path) as ApiPrincipal;
      const formData = await args.request.formData();
      const db = await getRequestDb(args.context);
      const response = apiV1AccountResponse(
        requestId,
        await uploadNativeAccountPhoto(db, principal.id, formData, args.context.cloudflare?.env?.PHOTOS),
      );
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "DELETE" && path === "me/photo") {
      const principal = await authorize(path) as ApiPrincipal;
      const db = await getRequestDb(args.context);
      const response = apiV1AccountResponse(
        requestId,
        await removeNativeAccountPhoto(db, principal.id, args.context.cloudflare?.env?.PHOTOS),
      );
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && path === "me/notification-preferences") {
      const principal = await authorize(path) as ApiPrincipal;
      const db = await getRequestDb(args.context);
      const response = apiV1AccountResponse(requestId, await readNativeNotificationPreferences(db, principal.id));
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "PATCH" && path === "me/notification-preferences") {
      const principal = await authorize(path) as ApiPrincipal;
      const body = await parseApiV1JsonBody(args.request);
      const db = await getRequestDb(args.context);
      const response = apiV1AccountResponse(requestId, await updateNativeNotificationPreferences(db, principal.id, body));
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "POST" && path === "me/apns-devices") {
      const principal = await authorize(path) as ApiPrincipal;
      const body = await parseApiV1JsonBody(args.request);
      const db = await getRequestDb(args.context);
      const response = apiV1AccountResponse(requestId, await registerNativePushDevice(db, principal.id, body));
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "DELETE" && segments[0] === "me" && segments[1] === "apns-devices" && segments.length === 3) {
      const principal = await authorize(path) as ApiPrincipal;
      const db = await getRequestDb(args.context);
      const response = apiV1AccountResponse(requestId, await revokeNativePushDevice(db, principal.id, segments[2]));
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && path === "me/connections") {
      const principal = await authorize(path) as ApiPrincipal;
      const db = await getRequestDb(args.context);
      const response = apiV1AccountResponse(requestId, await listNativeOAuthConnections(db, principal.id));
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "DELETE" && segments[0] === "me" && segments[1] === "connections" && segments.length === 3) {
      const principal = await authorize(path) as ApiPrincipal;
      const db = await getRequestDb(args.context);
      const response = apiV1AccountResponse(requestId, await disconnectNativeOAuthConnection(db, principal.id, segments[2]));
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

    if (args.request.method === "GET" && segments[0] === "users" && segments.length === 2) {
      const principal = await authorize(path);
      const db = await getRequestDb(args.context);
      const response = apiV1UsersSearchResponse(
        requestId,
        await loadNativeUserProfile(db, segments[1], publicContentOrigin(args), principal?.id ?? null),
        principal,
      );
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && segments[0] === "users" && segments[2] === "fellow-chefs" && segments.length === 3) {
      const principal = await authorize(path);
      const db = await getRequestDb(args.context);
      const response = apiV1UsersSearchResponse(
        requestId,
        await listNativeProfileGraph(db, segments[1], publicContentOrigin(args), new URL(args.request.url), "fellow-chefs"),
        principal,
      );
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && segments[0] === "users" && segments[2] === "kitchen-visitors" && segments.length === 3) {
      const principal = await authorize(path);
      const db = await getRequestDb(args.context);
      const response = apiV1UsersSearchResponse(
        requestId,
        await listNativeProfileGraph(db, segments[1], publicContentOrigin(args), new URL(args.request.url), "kitchen-visitors"),
        principal,
      );
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && path === "search") {
      const principal = await authorize(path);
      const db = await getRequestDb(args.context);
      const response = apiV1UsersSearchResponse(
        requestId,
        await searchNativeSpoonjoy(db, new URL(args.request.url), publicContentOrigin(args), {
          authenticated: Boolean(principal),
          viewerId: principal?.id ?? null,
          canReadShoppingList: canReadShoppingListSearch(principal),
        }),
        principal,
      );
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method !== "GET" && args.request.method !== "POST" && args.request.method !== "PATCH" && args.request.method !== "PUT" && args.request.method !== "DELETE") {
      throw new ApiV1Error("method_not_allowed", "Method not allowed", { allow: allowedApiV1Methods(path) ?? "GET, POST, PATCH, PUT, DELETE" });
    }

    if (isKnownApiV1Path(path)) {
      /* istanbul ignore next -- @preserve known paths always have an allowed-method header from API_V1_RESOURCES. */
      throw new ApiV1Error("method_not_allowed", "Method not allowed", { allow: allowedApiV1Methods(path) ?? "GET, POST, PATCH, PUT, DELETE" });
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
