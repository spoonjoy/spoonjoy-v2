import type { ApiCredential, ApiIdempotencyKey, NativePushDevice, Prisma, RecipeCover, RecipeSpoon } from "@prisma/client";
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
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferenceFlags,
} from "~/lib/account-settings.server";
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
import {
  normalizeSearchLimit,
  normalizeSearchScope,
  searchSpoonjoy,
  type SearchResult,
  type SearchScope,
} from "~/lib/search.server";
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
import { getAppleNativeAuthConfig, getVapidConfig, type OAuthEnv, type VapidEnv } from "~/lib/env.server";
import {
  handleNativeAppleSignIn,
  NativeAppleAuthError,
} from "~/lib/apple-native-auth.server";
import {
  handleNativePasswordSignIn,
  NativePasswordAuthError,
} from "~/lib/native-password-auth.server";
import { notifyForkOfMyRecipe } from "~/lib/notification-triggers.server";
import { DEFAULT_RETRY_AFTER_SECONDS, enforceAuthRateLimit, enforceRateLimit } from "~/lib/rate-limit.server";
import { getRequestDb } from "~/lib/route-platform.server";
import {
  nativeSyncDeletedKind,
  nativeSyncTombstoneUpsertOperation,
  recordNativeSyncTombstone,
} from "~/lib/native-sync-invalidation.server";
import {
  API_V1_DISCOVERY_DATA,
  API_V1_ERROR_STATUS,
  API_V1_RESOURCES,
  API_V1_SCOPE_REQUIREMENTS,
  type ApiV1ErrorCode,
} from "~/lib/api-v1-contract.server";
import {
  deleteStoredImageWithCapture,
  hasUploadedImageFile,
  RECIPE_IMAGE_TYPES,
  storeImage,
  validateImageFile,
  validateImageFileForStorage,
} from "~/lib/image-storage.server";
import {
  FOOD_IMAGE_SIZE_MESSAGE,
  FOOD_IMAGE_TYPE_MESSAGE,
  IMAGE_MAX_FILE_SIZE,
  PROFILE_IMAGE_TYPES,
} from "~/lib/recipe-image";
import { listUserPasskeys } from "~/lib/webauthn-route.server";
import {
  archiveRecipeCover,
  clearActiveRecipeCover,
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

type NativeTelemetryEventName =
  | "bootstrap_failed"
  | "bootstrap_offline"
  | "app_intent_completed"
  | "app_intent_failed"
  | "auth_flow_started"
  | "auth_flow_completed"
  | "auth_flow_failed"
  | "settings_refresh_failed"
  | "sync_failed";

const NATIVE_TELEMETRY_EVENTS = new Set<NativeTelemetryEventName>([
  "bootstrap_failed",
  "bootstrap_offline",
  "app_intent_completed",
  "app_intent_failed",
  "auth_flow_started",
  "auth_flow_completed",
  "auth_flow_failed",
  "settings_refresh_failed",
  "sync_failed",
]);

const NATIVE_TELEMETRY_ENVIRONMENTS = new Set(["local", "preview", "production"]);
const NATIVE_TELEMETRY_PLATFORMS = new Set(["ios", "macos"]);

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

function apiV1PrivateHeaders(requestId: string): Headers {
  const headers = apiV1Headers(requestId);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Pragma", "no-cache");
  return headers;
}

function apiV1SamePartyPrivateHeaders(requestId: string, json = true): Headers {
  const headers = new Headers({
    "X-Request-Id": requestId,
    "Cache-Control": "private, no-store",
    Pragma: "no-cache",
  });
  if (json) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
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

function apiV1SamePartyPrivateSuccess(
  requestId: string,
  data: unknown,
  status: number,
  extraHeaders: HeadersInit,
): Response {
  const headers = apiV1SamePartyPrivateHeaders(requestId);
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
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

function apiV1SamePartyErrorResponse(requestId: string, error: ApiV1Error): Response {
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
  const headers = apiV1SamePartyPrivateHeaders(requestId);
  if (error.code === "rate_limited") {
    headers.set("Retry-After", String(retryAfterSecondsFromError(error)));
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

export function retryAfterSecondsFromError(error: ApiV1Error): number {
  if (
    error.details &&
    typeof error.details === "object" &&
    !Array.isArray(error.details) &&
    typeof (error.details as { retryAfterSeconds?: unknown }).retryAfterSeconds === "number" &&
    Number.isFinite((error.details as { retryAfterSeconds: number }).retryAfterSeconds) &&
    (error.details as { retryAfterSeconds: number }).retryAfterSeconds > 0
  ) {
    return Math.ceil((error.details as { retryAfterSeconds: number }).retryAfterSeconds);
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
}

async function enforceApiV1RateLimit(
  args: ApiV1RouteArgs,
  requestId: string,
  options: { samePartyError: boolean },
): Promise<Response | null> {
  const env = args.context.cloudflare?.env;
  const rateLimit = await enforceRateLimit({
    authorization: args.request.headers.get("Authorization"),
    ip: args.request.headers.get("CF-Connecting-IP"),
    tokenLimiter: env?.API_TOKEN_RATE_LIMITER,
    ipLimiter: env?.API_IP_RATE_LIMITER,
  });
  if (rateLimit.allowed) return null;

  const response = (options.samePartyError ? apiV1SamePartyErrorResponse : apiV1ErrorResponse)(
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
    case "POST auth-apple-native":
      return "auth.apple.native.sign-in";
    case "POST auth-password-native":
      return "auth.password.native.sign-in";
    case "POST native-telemetry":
      return "native.telemetry.capture";
    case "GET search":
      return "search.read";
    case "GET recipes":
      return "recipes.list";
    case "POST recipe-import":
      return "recipes.import";
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
    case "GET recipe-spoons":
      return "recipes.spoons.list";
    case "POST recipe-spoons-create":
      return "recipes.spoons.create";
    case "PATCH recipe-spoon":
      return "recipes.spoons.update";
    case "DELETE recipe-spoon":
      return "recipes.spoons.delete";
    case "POST recipe-image":
      return "recipes.image.upload";
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
    case "POST cookbooks-create":
      return "cookbooks.create";
    case "GET cookbook":
      return "cookbooks.get";
    case "PATCH cookbook-mutate":
      return "cookbooks.update";
    case "DELETE cookbook-mutate":
      return "cookbooks.delete";
    case "POST cookbook-recipes":
      return "cookbooks.recipes.add";
    case "DELETE cookbook-recipes":
      return "cookbooks.recipes.remove";
    case "GET me":
      return "account.read";
    case "PATCH me":
      return "account.update";
    case "POST me-photo":
      return "account.photo.upload";
    case "DELETE me-photo":
      return "account.photo.remove";
    case "GET me-notification-preferences":
      return "account.notification-preferences.read";
    case "PATCH me-notification-preferences":
      return "account.notification-preferences.update";
    case "POST me-apns-devices":
      return "account.apns.register";
    case "DELETE me-apns-device":
      return "account.apns.revoke";
    case "GET me-connections":
      return "account.connections.list";
    case "DELETE me-connection":
      return "account.connections.disconnect";
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

const IDEMPOTENT_ACCOUNT_OPERATIONS = new Set([
  "account.update",
  "account.photo.upload",
  "account.photo.remove",
  "account.notification-preferences.update",
  "account.apns.register",
  "account.apns.revoke",
]);

function isIdempotentAccountOperation(operation: string): boolean {
  return IDEMPOTENT_ACCOUNT_OPERATIONS.has(operation);
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
    operation !== "recipes.create" &&
    operation !== "recipes.update" &&
    operation !== "recipes.delete" &&
    operation !== "recipes.fork" &&
    !operation.startsWith("recipes.image.") &&
    !operation.startsWith("recipes.spoons.") &&
    !operation.startsWith("recipes.covers.") &&
    !operation.startsWith("cookbooks.") &&
    !isIdempotentAccountOperation(operation)
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

function parseSearchLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw.trim() === "") return normalizeSearchLimit(null);
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new ApiV1Error("validation_error", "limit must be an integer between 1 and 50");
  }
  return normalizeSearchLimit(limit);
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

function nativeSyncEnvironment(args: ApiV1RouteArgs): "local" | "preview" | "production" {
  const env = args.context.cloudflare?.env as ({
    NODE_ENV?: unknown;
    SPOONJOY_ALLOW_INSECURE_LOCAL_SESSIONS?: unknown;
    SPOONJOY_NATIVE_ENVIRONMENT?: unknown;
    SPOONJOY_BASE_URL?: string;
  } | undefined);
  const configured = env?.SPOONJOY_NATIVE_ENVIRONMENT;
  if (configured === "local" || configured === "preview" || configured === "production") {
    return configured;
  }

  const configuredBaseUrl = env?.SPOONJOY_BASE_URL;
  if (isLocalhostUrl(configuredBaseUrl)) {
    return "local";
  }

  const requestUrl = new URL(args.request.url);
  if (
    !isProductionEnv(env?.NODE_ENV) &&
    configuredBaseUrl === undefined &&
    isLocalhostHostname(requestUrl.hostname)
  ) {
    return "local";
  }

  if (isEnabledEnvFlag(env?.SPOONJOY_ALLOW_INSECURE_LOCAL_SESSIONS) && isLocalhostHostname(requestUrl.hostname)) {
    return "local";
  }

  const host = normalizedHost(new URL(configuredBaseUrl || args.request.url).hostname);
  if (host === "spoonjoy.app" || host === "www.spoonjoy.app") {
    return "production";
  }
  return "preview";
}

function normalizedHost(hostname: string): string {
  const lowercased = hostname.toLowerCase();
  return lowercased.startsWith("[") && lowercased.endsWith("]") ? lowercased.slice(1, -1) : lowercased;
}

function isLocalhostHostname(hostname: string): boolean {
  const host = normalizedHost(hostname);
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1";
}

function isLocalhostUrl(value: string | undefined): boolean {
  return Boolean(value && URL.canParse(value) && isLocalhostHostname(new URL(value).hostname));
}

function isEnabledEnvFlag(value: unknown): boolean {
  return typeof value === "string" && /^(1|true|yes)$/i.test(value.trim());
}

function isProductionEnv(value: unknown): boolean {
  return value === "production" || process.env.NODE_ENV === "production";
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

function canReadPrivateSearch(principal: ApiPrincipal | null): principal is ApiPrincipal {
  return Boolean(principal && principalHasScope(principal, "shopping_list:read"));
}

function viewerIdForSearchScope(scope: SearchScope, principal: ApiPrincipal | null): string | null {
  if (scope === "shopping-list") {
    if (!principal) {
      throw new ApiV1Error("authentication_required", "Authentication required");
    }
    if (!canReadPrivateSearch(principal)) {
      throw withApiV1ErrorPrincipal(
        new ApiV1Error("insufficient_scope", "Missing required scope: shopping_list:read"),
        principal,
      );
    }
    return principal.id;
  }

  return canReadPrivateSearch(principal) ? principal.id : null;
}

function searchResultPayload(result: SearchResult, origin: string) {
  return {
    type: result.type,
    id: result.id,
    ownerId: result.ownerId,
    ownerUsername: result.ownerUsername,
    title: result.title,
    subtitle: result.subtitle,
    snippet: result.snippet,
    href: result.href,
    canonicalUrl: canonicalUrl(origin, result.href),
    imageUrl: publicAssetUrl(origin, result.imageUrl),
    score: result.score,
    metadata: result.metadata,
  };
}

async function handleSearch(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal | null) {
  const db = await getRequestDb(args.context);
  const url = new URL(args.request.url);
  const origin = publicContentOrigin(args);
  const query = (url.searchParams.get("query") ?? url.searchParams.get("q") ?? "").trim();
  const scope = normalizeSearchScope(url.searchParams.get("scope"));
  const limit = parseSearchLimit(url);
  const viewerId = viewerIdForSearchScope(scope, principal);
  const results = await searchSpoonjoy(db, {
    query,
    scope,
    viewerId,
    limit,
  });

  return apiV1Success(requestId, {
    query,
    scope,
    limit,
    isAuthenticated: Boolean(principal),
    results: results.map((result) => searchResultPayload(result, origin)),
  }, 200, principal ? authenticatedPublicCacheHeaders() : publicCacheHeaders());
}

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
  if (error.status === 504) {
    return new ApiV1Error("upstream_timeout", error.message, {
      importCode: error.code,
      upstreamStatus: error.status,
    });
  }
  if (error.status >= 500) {
    return new ApiV1Error("upstream_error", error.message, {
      importCode: error.code,
      upstreamStatus: error.status,
    });
  }
  return new ApiV1Error("validation_error", error.message, {
    importCode: error.code,
    upstreamStatus: error.status,
  });
}

async function recipeImportMutationData(
  args: ApiV1RouteArgs,
  input: {
    db: ApiV1Db;
    recipeId: string | null;
    clientMutationId: string;
    confidence: string | null;
    source: string | null;
    existingRecipeId: string | null;
    coverPending: boolean;
  },
) {
  const origin = publicContentOrigin(args);
  const recipe = input.recipeId ? await loadRecipeById(input.db, input.recipeId) : null;
  return {
    recipe: recipe ? recipeDetail(recipe, origin) : null,
    importCode: null,
    blockers: [],
    confidence: input.confidence,
    source: input.source,
    existingRecipeId: input.existingRecipeId,
    coverPending: input.coverPending,
    mutation: { clientMutationId: input.clientMutationId, replayed: false },
  };
}

async function recoverRecipeImport(
  args: ApiV1RouteArgs,
  input: {
    db: ApiV1Db;
    principal: ApiPrincipal;
    clientMutationId: string;
    record: ApiIdempotencyKey;
  },
) {
  const recipe = await input.db.recipe.findFirst({
    where: {
      id: input.record.id,
      chefId: input.principal.id,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!recipe) return null;
  return {
    status: 201,
    data: await recipeImportMutationData(args, {
      db: input.db,
      recipeId: recipe.id,
      clientMutationId: input.clientMutationId,
      confidence: null,
      source: null,
      existingRecipeId: null,
      coverPending: false,
    }),
  };
}

async function handleRecipeImport(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId", "source", "dryRun"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const source = parseRecipeImportSource(body.source);
  const dryRun = optionalBoolean(body.dryRun, "dryRun");

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, clientMutationId, "recipes.import", async (db, reservation) => {
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
        : { chefId: principal.id, source, recipeId: reservation.id };
      const result = await importRecipeFromSource(importOptions, deps);
      return {
        status: result.recipeId ? 201 : 200,
        data: await recipeImportMutationData(args, {
          db,
          recipeId: result.recipeId,
          clientMutationId,
          confidence: result.confidence,
          source: result.source,
          existingRecipeId: result.existingRecipeId,
          coverPending: result.coverPending,
        }),
      };
    } catch (error) {
      if (error instanceof ImportRecipeError) {
        throw mapRecipeImportErrorForApiV1(error);
      }
      throw error;
    }
  }, {
    deleteReservationOnWriteError: false,
    hasRecoverableWrite: async (db, record) => Boolean(await db.recipe.findFirst({
      where: {
        id: record.id,
        chefId: principal.id,
        deletedAt: null,
      },
      select: { id: true },
    })),
    recoverInFlight: async (db, record) => recoverRecipeImport(args, {
      db,
      principal,
      clientMutationId,
      record,
    }),
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
  return await runIdempotentApiV1Mutation(args, requestId, principal, body, clientMutationId, "recipes.spoons.create", async (db, reservation) => {
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
  return await runIdempotentApiV1Mutation(args, requestId, principal, body, clientMutationId, "recipes.spoons.update", async (db) => {
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

  return await runIdempotentApiV1Mutation(args, requestId, principal, idempotencyBody, clientMutationId, "recipes.spoons.delete", async (db) => {
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

async function handleRecipeImageUpload(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, recipeId: string) {
  const formData = await accountPhotoFormDataWithinLimit(args.request);
  assertKnownFormDataFields(formData, RECIPE_IMAGE_UPLOAD_FIELDS);
  const clientMutationId = clientMutationIdFromFormDataHeaderOrQuery(args, formData);
  const photo = singleFormDataValue(formData, "photo");
  const activate = optionalFormDataBoolean(formData, "activate", true);
  const generateEditorial = optionalFormDataBoolean(formData, "generateEditorial", true);
  const postAsSpoon = optionalFormDataBoolean(formData, "postAsSpoon", false);
  const note = optionalFormDataString(formData, "note");
  const nextTime = optionalFormDataString(formData, "nextTime");
  const cookedAt = optionalFormDataIsoDate(formData, "cookedAt");
  const idempotencyBody = {
    clientMutationId,
    photo: await accountPhotoIdempotencyValue(photo),
    activate,
    generateEditorial,
    postAsSpoon,
    note,
    nextTime,
    cookedAt: cookedAt?.toISOString() ?? null,
  };

  return await runIdempotentApiV1Mutation(args, requestId, principal, idempotencyBody, clientMutationId, "recipes.image.upload", async (db) => {
    const origin = publicContentOrigin(args);
    const recipe = await loadOwnedCoverRecipe(db, principal, recipeId);
    const previousActiveCover = await activeFullCoverPayload(db, recipe, origin);

    if (!hasUploadedImageFile(photo)) {
      throw new ApiV1Error("validation_error", "Please select a photo to upload", { field: "photo", reason: "missing" });
    }

    const photoError = await validateImageFileForStorage(photo, {
      allowedTypes: RECIPE_IMAGE_TYPES,
      messages: {
        invalidType: FOOD_IMAGE_TYPE_MESSAGE,
        fileTooLarge: FOOD_IMAGE_SIZE_MESSAGE,
      },
    });
    if (photoError) {
      throw new ApiV1Error("validation_error", photoError, { field: "photo" });
    }

    let uploadedImageUrl: string | null = null;
    let createdCoverId: string | null = null;
    let createdSpoonId: string | null = null;

    try {
      uploadedImageUrl = await storeImage({
        bucket: apiV1CloudflareFor(args)?.env?.PHOTOS,
        file: photo,
        namespace: postAsSpoon
          ? `spoons/${principal.id}/${recipeId}`
          : `recipes/${principal.id}/${recipeId}`,
      });

      const sourceType = postAsSpoon ? "spoon" : "chef-upload";
      let createdCover = await createCover(db, {
        recipeId,
        imageUrl: uploadedImageUrl,
        sourceType,
        sourceSpoonId: null,
        status: generateEditorial ? "processing" : "ready",
        createdById: principal.id,
        sourceImageUrl: uploadedImageUrl,
        generationStatus: generateEditorial ? "processing" : "none",
      });
      createdCoverId = createdCover.id;

      if (postAsSpoon) {
        let created: Awaited<ReturnType<typeof createSpoon>>;
        try {
          created = await createSpoon(db, {
            chefId: principal.id,
            recipeId,
            photoUrl: uploadedImageUrl,
            note,
            nextTime,
            cookedAt,
          });
        } catch (error) {
          throw mapSpoonDomainErrorForApiV1(error);
        }
        createdSpoonId = created.spoon.id;
        createdCover = await db.recipeCover.update({
          where: { id: createdCover.id },
          data: { sourceSpoonId: created.spoon.id },
        });
      }

      if (activate) {
        try {
          await setActiveRecipeCover(db, { recipeId, coverId: createdCover.id, variant: "image" });
        } catch (error) {
          throw coverMutationError(error, createdCover.id);
        }
      }

      if (generateEditorial) {
        await runOrQueueCoverStylization(args, {
          db,
          userId: principal.id,
          recipeId,
          coverId: createdCover.id,
          rawPhotoUrl: uploadedImageUrl,
          recipeTitle: recipe.title,
          sourceType,
          activateWhenReady: activate,
          suppressAutoActivation: !activate,
          activationGuard: activate ? {
            activeCoverId: createdCover.id,
            activeCoverVariant: "image",
            coverMode: "manual",
          } : undefined,
        });
      }

      const nextRecipe = await loadOwnedCoverRecipe(db, principal, recipeId);
      const persistedCover = await db.recipeCover.findFirstOrThrow({ where: { id: createdCover.id, recipeId } });
      const spoon = createdSpoonId
        ? await db.recipeSpoon.findFirstOrThrow({
            where: { id: createdSpoonId, recipeId },
            include: { chef: { select: API_V1_SPOON_CHEF_SELECT } },
          })
        : null;

      return {
        status: 201,
        data: {
          spoon: spoon ? spoonPayload(spoon, origin) : null,
          activeCover: await activeFullCoverPayload(db, nextRecipe, origin),
          previousActiveCover,
          createdCover: fullCoverPayload(persistedCover, nextRecipe, origin),
          generationStatus: persistedCover.generationStatus,
          mutation: { clientMutationId, replayed: false },
        },
      };
    } catch (error) {
      if (uploadedImageUrl) {
        await cleanupRecipeImageUploadRows(db, { recipe, coverId: createdCoverId, spoonId: createdSpoonId });
        await cleanupUploadedRecipeImageObject(args, principal, uploadedImageUrl);
      }
      throw error;
    }
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

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, clientMutationId, "recipes.covers.set-no-cover", async (db) => {
    const origin = publicContentOrigin(args);
    const recipe = await loadOwnedCoverRecipe(db, principal, recipeId);
    const previousActiveCover = await activeFullCoverPayload(db, recipe, origin);
    const nextRecipe = await clearActiveRecipeCover(db, recipe.id);
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

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, clientMutationId, "recipes.covers.activate", async (db) => {
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

  return await runIdempotentApiV1Mutation(args, requestId, principal, idempotencyBody, clientMutationId, "recipes.covers.archive", async (db) => {
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

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, clientMutationId, "recipes.covers.regenerate", async (db) => {
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

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, clientMutationId, "recipes.covers.from-spoon", async (db) => {
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

function nativeAccountSyncCookbookPayload(cookbook: CookbookRow, origin: string) {
  return {
    ...cookbookSummary(cookbook, origin),
    recipes: [],
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

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === code,
  );
}

async function loadExistingCookbookById(db: ApiV1Db, id: string) {
  const cookbook = await loadCookbookById(db, id);
  if (!cookbook) {
    throw new ApiV1Error("not_found", "Cookbook not found", { resource: "cookbook", cookbookId: id });
  }
  return cookbook;
}

async function loadOwnedCookbookById(db: ApiV1Db, principal: ApiPrincipal, id: string) {
  const cookbook = await loadExistingCookbookById(db, id);
  if (cookbook.author.id !== principal.id) {
    throw new ApiV1Error("insufficient_scope", "Only the cookbook owner can mutate this cookbook", { resource: "cookbook", cookbookId: id });
  }
  return cookbook;
}

function duplicateCookbookTitleError() {
  return new ApiV1Error("validation_error", "You already have a cookbook with this title", { field: "title" });
}

async function handleCookbookCreate(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId", "title"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const title = nonblankString(body.title, "title");
  const origin = publicContentOrigin(args);

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, clientMutationId, "cookbooks.create", async (db) => {
    let cookbookId: string;
    try {
      const created = await db.cookbook.create({
        data: { title, authorId: principal.id },
        select: { id: true },
      });
      cookbookId = created.id;
    } catch (error) {
      if (isPrismaErrorCode(error, "P2002")) {
        throw duplicateCookbookTitleError();
      }
      throw error;
    }

    const cookbook = await loadExistingCookbookById(db, cookbookId);
    return {
      status: 201,
      data: {
        created: true,
        cookbook: cookbookDetail(cookbook, origin),
        mutation: { clientMutationId, replayed: false },
      },
    };
  });
}

async function handleCookbookUpdate(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, id: string) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId", "title"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const title = nonblankString(body.title, "title");
  const origin = publicContentOrigin(args);

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, clientMutationId, "cookbooks.update", async (db) => {
    await loadOwnedCookbookById(db, principal, id);
    try {
      await db.cookbook.update({
        where: { id },
        data: { title },
      });
    } catch (error) {
      if (isPrismaErrorCode(error, "P2002")) {
        throw duplicateCookbookTitleError();
      }
      throw error;
    }

    const cookbook = await loadExistingCookbookById(db, id);
    return {
      status: 200,
      data: {
        updated: true,
        cookbook: cookbookDetail(cookbook, origin),
        mutation: { clientMutationId, replayed: false },
      },
    };
  });
}

async function handleCookbookDelete(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, id: string) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId"]);
  const url = new URL(args.request.url);
  const clientMutationId = nonblankString(
    body.clientMutationId ?? args.request.headers.get("X-Client-Mutation-Id") ?? url.searchParams.get("clientMutationId"),
    "clientMutationId",
  );
  const idempotencyBody = { clientMutationId };
  const origin = publicContentOrigin(args);

  return await runIdempotentApiV1Mutation(args, requestId, principal, idempotencyBody, clientMutationId, "cookbooks.delete", async (db) => {
    const cookbook = await loadOwnedCookbookById(db, principal, id);
    const deletedAt = new Date();
    await db.$transaction([
      nativeSyncTombstoneUpsertOperation(db, {
        accountId: principal.id,
        resourceType: "cookbook",
        resourceId: cookbook.id,
        title: cookbook.title,
        deletedAt,
        updatedAt: deletedAt,
      }),
      db.cookbook.delete({ where: { id } }),
    ]);
    return {
      status: 200,
      data: {
        deleted: true,
        cookbook: cookbookDetail(cookbook, origin),
        mutation: { clientMutationId, replayed: false },
      },
    };
  });
}

async function handleCookbookRecipeAdd(
  args: ApiV1RouteArgs,
  requestId: string,
  principal: ApiPrincipal,
  cookbookId: string,
  recipeId: string,
) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const origin = publicContentOrigin(args);

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, clientMutationId, "cookbooks.recipes.add", async (db) => {
    await loadOwnedCookbookById(db, principal, cookbookId);
    const recipe = await db.recipe.findFirst({
      where: { id: recipeId, deletedAt: null },
      select: { id: true },
    });
    if (!recipe) {
      throw new ApiV1Error("not_found", "Recipe not found", { resource: "recipe", recipeId });
    }

    let added = true;
    try {
      await db.$transaction(async (tx) => {
        await tx.recipeInCookbook.create({
          data: { cookbookId, recipeId, addedById: principal.id },
        });
        await tx.cookbook.update({
          where: { id: cookbookId },
          data: { updatedAt: new Date() },
        });
      });
    } catch (error) {
      if (isPrismaErrorCode(error, "P2002")) {
        added = false;
        await db.cookbook.update({
          where: { id: cookbookId },
          data: { updatedAt: new Date() },
        });
      } else {
        throw error;
      }
    }

    const cookbook = await loadExistingCookbookById(db, cookbookId);
    return {
      status: added ? 201 : 200,
      data: {
        added,
        recipeId,
        cookbook: cookbookDetail(cookbook, origin),
        mutation: { clientMutationId, replayed: false },
      },
    };
  });
}

async function handleCookbookRecipeRemove(
  args: ApiV1RouteArgs,
  requestId: string,
  principal: ApiPrincipal,
  cookbookId: string,
  recipeId: string,
) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId"]);
  const url = new URL(args.request.url);
  const clientMutationId = nonblankString(
    body.clientMutationId ?? args.request.headers.get("X-Client-Mutation-Id") ?? url.searchParams.get("clientMutationId"),
    "clientMutationId",
  );
  const idempotencyBody = { clientMutationId };
  const origin = publicContentOrigin(args);

  return await runIdempotentApiV1Mutation(args, requestId, principal, idempotencyBody, clientMutationId, "cookbooks.recipes.remove", async (db) => {
    await loadOwnedCookbookById(db, principal, cookbookId);
    const updatedAt = new Date();
    const result = await db.$transaction(async (tx) => {
      const deleted = await tx.recipeInCookbook.deleteMany({
        where: { cookbookId, recipeId },
      });
      await tx.cookbook.update({
        where: { id: cookbookId },
        data: { updatedAt },
      });
      return deleted;
    });
    const cookbook = await loadExistingCookbookById(db, cookbookId);
    return {
      status: 200,
      data: {
        removed: result.count > 0,
        recipeId,
        cookbook: cookbookDetail(cookbook, origin),
        mutation: { clientMutationId, replayed: false },
      },
    };
  });
}

async function loadShoppingListForUser(
  db: ApiV1WriteDb,
  userId: string,
  itemWhere: Prisma.ShoppingListItemWhereInput = {},
) {
  const include = {
    author: { select: { id: true, username: true } },
    items: {
      where: itemWhere,
      include: { unit: true, ingredientRef: true },
      orderBy: [{ sortIndex: "asc" as const }, { updatedAt: "asc" as const }, { id: "asc" as const }],
    },
  } satisfies Prisma.ShoppingListInclude;
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
type NativeSyncEntryKind = "profile" | "recipe" | "cookbook" | "shoppingItem";
type NativeSyncEntryAction = "upsert" | "delete";

interface NativeSyncTombstonePayload {
  resourceType: NativeSyncEntryKind;
  resourceId: string;
  parentResourceId: string | null;
  title: string | null;
  deletedAt: string;
  updatedAt: string;
}

interface NativeSyncEntry {
  action: NativeSyncEntryAction;
  kind: NativeSyncEntryKind;
  resourceId: string;
  updatedAt: string;
  payload?: unknown;
  tombstone?: NativeSyncTombstonePayload;
}

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

function nativeSyncCursorForEntry(entry: Pick<NativeSyncEntry, "resourceId" | "updatedAt" | "kind">): string {
  return `v1.${base64UrlEncodeText(JSON.stringify({ updatedAt: entry.updatedAt, id: `${entry.kind}:${entry.resourceId}` }))}`;
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

function profileSyncPayload(origin: string, user: {
  id: string;
  email: string;
  username: string;
  photoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    photoUrl: privateAccountPhotoUrl(origin, user.photoUrl),
    joinedLabel: "Joined Spoonjoy",
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function nativeSyncEntrySort(a: NativeSyncEntry, b: NativeSyncEntry) {
  const updatedAt = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
  if (updatedAt !== 0) return updatedAt;
  const kind = a.kind.localeCompare(b.kind);
  if (kind !== 0) return kind;
  return a.resourceId.localeCompare(b.resourceId);
}

function nativeSyncEntryAfterCursor(entry: NativeSyncEntry, cursor: SyncCursor | null) {
  if (cursor === null) return true;
  const updatedAt = new Date(entry.updatedAt).getTime();
  const cursorUpdatedAt = cursor.updatedAt.getTime();
  if (updatedAt > cursorUpdatedAt) return true;
  return cursor.id !== null && updatedAt === cursorUpdatedAt && `${entry.kind}:${entry.resourceId}` > cursor.id;
}

function nativeSyncUpdatedAtWhere(cursor: SyncCursor | null) {
  return cursor ? { updatedAt: { gte: cursor.updatedAt } } : {};
}

async function handleNativeAccountSync(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const db = await getRequestDb(args.context);
  const url = new URL(args.request.url);
  const cursor = parseSyncCursor(url);
  const limit = parseShoppingSyncLimit(url);
  const origin = publicContentOrigin(args);
  const environment = nativeSyncEnvironment(args);
  const generatedAt = new Date().toISOString();

  const user = await db.user.findUnique({
    where: { id: principal.id },
    select: { id: true, email: true, username: true, photoUrl: true, createdAt: true, updatedAt: true },
  });
  /* istanbul ignore if -- @preserve bearer/session auth already resolved the user; this keeps sync honest if the row disappears mid-request. */
  if (!user) {
    throw new ApiV1Error("not_found", "Account not found");
  }

  const recipeRefs = await db.recipe.findMany({
    where: { chefId: principal.id, deletedAt: null, ...nativeSyncUpdatedAtWhere(cursor) },
    select: { id: true, updatedAt: true },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
  });
  const cookbookRefs = await db.cookbook.findMany({
    where: { authorId: principal.id, ...nativeSyncUpdatedAtWhere(cursor) },
    select: { id: true, updatedAt: true },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
  });
  const tombstoneRefs = await db.nativeSyncTombstone.findMany({
    where: { accountId: principal.id, ...nativeSyncUpdatedAtWhere(cursor) },
    select: {
      resourceType: true,
      resourceId: true,
      parentResourceId: true,
      title: true,
      deletedAt: true,
      updatedAt: true,
    },
    orderBy: [{ updatedAt: "asc" }, { resourceType: "asc" }, { resourceId: "asc" }],
  });
  const shoppingList = await loadShoppingListForUser(db, principal.id, nativeSyncUpdatedAtWhere(cursor));

  const profileEntry: NativeSyncEntry = {
    action: "upsert",
    kind: "profile",
    resourceId: user.id,
    updatedAt: user.updatedAt.toISOString(),
    payload: profileSyncPayload(origin, user),
  };
  const recipeEntries = recipeRefs.map((recipe): NativeSyncEntry => ({
    action: "upsert",
    kind: "recipe",
    resourceId: recipe.id,
    updatedAt: recipe.updatedAt.toISOString(),
  }));
  const cookbookEntries = cookbookRefs.map((cookbook): NativeSyncEntry => ({
    action: "upsert",
    kind: "cookbook",
    resourceId: cookbook.id,
    updatedAt: cookbook.updatedAt.toISOString(),
  }));
  const tombstoneEntries = tombstoneRefs.flatMap((tombstone): NativeSyncEntry[] => {
    const kind = nativeSyncDeletedKind(tombstone.resourceType);
    if (!kind) return [];
    const updatedAt = tombstone.updatedAt.toISOString();
    return [{
      action: "delete",
      kind,
      resourceId: tombstone.resourceId,
      updatedAt,
      tombstone: {
        resourceType: kind,
        resourceId: tombstone.resourceId,
        parentResourceId: tombstone.parentResourceId,
        title: tombstone.title,
        deletedAt: tombstone.deletedAt.toISOString(),
        updatedAt,
      },
    }];
  });
  const shoppingEntries = shoppingList.items.map((item): NativeSyncEntry => {
      const updatedAt = item.updatedAt.toISOString();
      if (item.deletedAt) {
        return {
          action: "delete",
          kind: "shoppingItem",
          resourceId: item.id,
          updatedAt,
          tombstone: {
            resourceType: "shoppingItem",
            resourceId: item.id,
            parentResourceId: shoppingList.id,
            title: item.ingredientRef.name,
            deletedAt: item.deletedAt.toISOString(),
            updatedAt,
          },
        };
      }
      return {
        action: "upsert",
        kind: "shoppingItem",
        resourceId: item.id,
        updatedAt,
        payload: shoppingItem(item),
      };
    });
  const entries = [
    profileEntry,
    ...recipeEntries,
    ...cookbookEntries,
    ...tombstoneEntries,
    ...shoppingEntries,
  ].sort(nativeSyncEntrySort);

  const matchingEntries = entries.filter((entry) => nativeSyncEntryAfterCursor(entry, cursor));
  const pageRefs = matchingEntries.slice(0, limit);
  const hasMore = matchingEntries.length > limit;
  const pageEntries = await Promise.all(pageRefs.map(async (entry): Promise<NativeSyncEntry | null> => {
    if (entry.action === "upsert" && entry.kind === "recipe") {
      const recipe = await loadRecipeById(db, entry.resourceId);
      return recipe ? { ...entry, payload: recipeDetail(recipe, origin) } : null;
    }
    if (entry.action === "upsert" && entry.kind === "cookbook") {
      const cookbook = await loadCookbookById(db, entry.resourceId);
      return cookbook ? { ...entry, payload: nativeAccountSyncCookbookPayload(cookbook, origin) } : null;
    }
    return entry;
  }));
  const visiblePageEntries = pageEntries.filter((entry): entry is NativeSyncEntry => entry !== null);
  let nextCursor: string;
  if (pageRefs.length > 0) {
    nextCursor = nativeSyncCursorForEntry(pageRefs[pageRefs.length - 1]!);
  } else {
    // The profile entry is always present on an uncursored native account sync,
    // so an empty page only occurs when the caller asks past the latest entry.
    nextCursor = cursor!.raw;
  }

  return apiV1PrivateSuccess(requestId, {
    freshness: {
      accountId: principal.id,
      environment,
      schemaVersion: 1,
      sourceEndpoint: "/api/v1/me/sync",
      generatedAt,
      lastValidatedAt: generatedAt,
    },
    entries: visiblePageEntries,
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

const IDEMPOTENCY_RECOVERY_TIMESTAMP_TOLERANCE_MS = 1_000;

type ApiV1IdempotentMutationResult = { status: number; data: Record<string, unknown> };
type ApiV1IdempotentRecovery = (
  db: ApiV1WriteDb,
  reservation: ApiIdempotencyKey,
) => Promise<ApiV1IdempotentMutationResult | null>;
type ApiV1IdempotentMutationOptions = {
  beforeWrite?: (
    db: ApiV1WriteDb,
    record: ApiIdempotencyKey,
  ) => Promise<void>;
  deleteReservationOnWriteError?: boolean;
  hasRecoverableWrite?: (
    db: ApiV1WriteDb,
    record: ApiIdempotencyKey,
  ) => Promise<boolean>;
  recoverInFlight?: ApiV1IdempotentRecovery;
};

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

function normalizeApiV1IdempotentMutationOptions(
  optionsOrRecovery?: ApiV1IdempotentMutationOptions | ApiV1IdempotentRecovery,
): ApiV1IdempotentMutationOptions {
  return typeof optionsOrRecovery === "function"
    ? { deleteReservationOnWriteError: false, recoverInFlight: optionsOrRecovery }
    : optionsOrRecovery ?? {};
}

export async function runIdempotentApiV1Mutation(
  args: ApiV1RouteArgs,
  requestId: string,
  principal: ApiPrincipal,
  body: Record<string, unknown>,
  clientMutationId: string,
  operation: string,
  write: (db: ApiV1WriteDb, reservation: ApiIdempotencyKey) => Promise<ApiV1IdempotentMutationResult>,
  optionsOrRecovery?: ApiV1IdempotentMutationOptions | ApiV1IdempotentRecovery,
) {
  const options = normalizeApiV1IdempotentMutationOptions(optionsOrRecovery);
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
    await options.beforeWrite?.(db, reservation.record);
    result = await write(db, reservation.record);
  } catch (error) {
    const recovered = error instanceof ApiV1Error
      ? null
      : await options.recoverInFlight?.(db, reservation.record);
    if (recovered) {
      await completeRecoveredIdempotencyKey(db, reservation.record, requestId, recovered);
      return apiV1IdempotentResponse(requestId, operation, recovered, "committed");
    }
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
  try {
    await completeIdempotencyKey(db, reservation.record.id, {
      status: result.status,
      body: responseBody,
    });
  } catch (error) {
    if (!options.recoverInFlight) throw error;
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

async function handleShoppingAddFromRecipe(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId", "recipeId", "scaleFactor"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const recipeId = nonblankString(body.recipeId, "recipeId");
  const scaleFactor = optionalPositiveNumber(body.scaleFactor, "scaleFactor") ?? 1;

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, clientMutationId, "shopping-list.add-from-recipe", async (db) => {
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

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, clientMutationId, operation, async (db) => {
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

function privateAccountPhotoUrl(origin: string, value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("data:")) return value;
  return publicAssetUrl(origin, value);
}

async function accountProfilePayload(args: ApiV1RouteArgs, userId: string) {
  const db = await getRequestDb(args.context);
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      hashedPassword: true,
      photoUrl: true,
      OAuth: {
        select: {
          provider: true,
          providerUsername: true,
        },
        orderBy: [{ provider: "asc" }],
      },
    },
  });
  /* istanbul ignore if -- @preserve auth verifies the account before profile payload construction; this is a database race guard. */
  if (!user) {
    throw new ApiV1Error("not_found", "Account not found");
  }

  const passkeys = await listUserPasskeys(db, userId);
  const origin = publicContentOrigin(args);
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    photoUrl: privateAccountPhotoUrl(origin, user.photoUrl),
    hasPassword: user.hashedPassword !== null,
    oauthAccounts: user.OAuth.map((account) => ({
      provider: account.provider,
      providerUsername: account.providerUsername,
    })),
    passkeys: passkeys.map((passkey) => ({
      id: passkey.id,
      name: passkey.name ?? "Passkey",
      transports: passkey.transports,
      createdAt: passkey.createdAt?.toISOString() ?? null,
    })),
  };
}

function mutationMetadata(clientMutationId: string) {
  return { clientMutationId, replayed: false };
}

async function accountProfileMutationPayload(args: ApiV1RouteArgs, userId: string, clientMutationId: string) {
  return {
    ...await accountProfilePayload(args, userId),
    mutation: mutationMetadata(clientMutationId),
  };
}

function clientMutationIdFromBodyHeaderOrQuery(args: ApiV1RouteArgs, body: Record<string, unknown>) {
  const url = new URL(args.request.url);
  return nonblankString(
    body.clientMutationId
      ?? args.request.headers.get("X-Client-Mutation-Id")
      ?? url.searchParams.get("clientMutationId"),
    "clientMutationId",
  );
}

function clientMutationIdFromFormDataHeaderOrQuery(args: ApiV1RouteArgs, formData: FormData) {
  const formValue = formData.get("clientMutationId");
  return clientMutationIdFromBodyHeaderOrQuery(args, {
    clientMutationId: typeof formValue === "string" ? formValue : undefined,
  });
}

function isValidAccountEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function bytesStartWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

type AccountPhotoMimeType = "image/gif" | "image/jpeg" | "image/png" | "image/webp";
const ACCOUNT_PHOTO_EXTENSIONS: Record<AccountPhotoMimeType, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function detectAccountPhotoMimeType(bytes: Uint8Array): AccountPhotoMimeType | null {
  if (bytesStartWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (bytesStartWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (
    bytes.length >= 12 &&
    bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function accountPhotoExtension(mimeType: AccountPhotoMimeType) {
  return ACCOUNT_PHOTO_EXTENSIONS[mimeType];
}

const PROFILE_PHOTO_MULTIPART_MAX_BYTES = IMAGE_MAX_FILE_SIZE + 512 * 1024;
const UNKNOWN_MULTIPART_FILE_TYPES = new Set(["", "application/octet-stream"]);

function accountPhotoTooLargeError() {
  return new ApiV1Error("validation_error", "Photo must be less than 5MB", { field: "photo" });
}

async function accountPhotoFormDataWithinLimit(request: Request): Promise<FormData> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > PROFILE_PHOTO_MULTIPART_MAX_BYTES) {
    throw accountPhotoTooLargeError();
  }

  if (!request.body) {
    return request.formData();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > PROFILE_PHOTO_MULTIPART_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw accountPhotoTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const replayHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "content-length") {
      replayHeaders[key] = value;
    }
  });
  const replayBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    replayBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const RequestConstructor = request.constructor as new (input: string, init: RequestInit) => Request;
  return await new RequestConstructor(request.url, {
    method: request.method,
    headers: replayHeaders,
    body: new Blob([replayBytes.buffer]),
  }).formData();
}

async function normalizeAccountPhotoFile(photo: File): Promise<File> {
  const bytes = new Uint8Array(await photo.arrayBuffer());
  const detectedType = detectAccountPhotoMimeType(bytes);
  const declaredType = photo.type.trim();
  if (
    detectedType === null ||
    (!UNKNOWN_MULTIPART_FILE_TYPES.has(declaredType) && detectedType !== declaredType)
  ) {
    throw new ApiV1Error("validation_error", "Please upload an image file", { field: "photo" });
  }
  return new File([bytes], `profile.${accountPhotoExtension(detectedType)}`, {
    type: detectedType,
    lastModified: photo.lastModified,
  });
}

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return bytesToHex(new Uint8Array(digest));
}

async function accountPhotoIdempotencyValue(photo: FormDataEntryValue | null) {
  if (photo instanceof File) {
    const bytes = new Uint8Array(await photo.arrayBuffer());
    return {
      kind: "file",
      sha256: await sha256HexBytes(bytes),
      size: photo.size,
      type: photo.type,
    };
  }
  if (typeof photo === "string") {
    return { kind: "field", value: photo };
  }
  return { kind: "missing" };
}

const RECIPE_IMAGE_UPLOAD_FIELDS = [
  "clientMutationId",
  "photo",
  "activate",
  "generateEditorial",
  "postAsSpoon",
  "note",
  "nextTime",
  "cookedAt",
] as const;

function assertKnownFormDataFields(formData: FormData, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  const unknown = Array.from(new Set(Array.from(formData.keys())))
    .filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new ApiV1Error("validation_error", "Unknown request body fields", { fields: unknown });
  }
}

function singleFormDataValue(formData: FormData, field: string): FormDataEntryValue | null {
  const values = formData.getAll(field);
  if (values.length > 1) {
    throw new ApiV1Error("validation_error", `${field} must be provided once`, { field });
  }
  return values[0] ?? null;
}

function optionalFormDataString(formData: FormData, field: string, maxLength = MAX_SHORT_TEXT_LENGTH): string | null {
  const value = singleFormDataValue(formData, field);
  if (value === null) return null;
  if (value instanceof File) {
    throw new ApiV1Error("validation_error", `${field} must be a string or null`, { field });
  }
  return optionalNullableString(value, field, maxLength);
}

function optionalFormDataBoolean(formData: FormData, field: string, fallback = false): boolean {
  const value = singleFormDataValue(formData, field);
  if (value === null) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ApiV1Error("validation_error", `${field} must be true or false`, { field });
}

function optionalFormDataIsoDate(formData: FormData, field: string): Date | undefined {
  const value = singleFormDataValue(formData, field);
  if (value === null) return undefined;
  if (value instanceof File) {
    throw new ApiV1Error("validation_error", `${field} must be an ISO datetime string`, { field });
  }
  return optionalIsoDate(value, field);
}

function recipeImageUploadPostHogConfig(args: ApiV1RouteArgs) {
  const env = apiV1CloudflareFor(args)?.env;
  return env
    ? resolvePostHogServerConfig(env)
    : ({ enabled: false, reason: "missing-key" } as const);
}

async function cleanupUploadedRecipeImageObject(args: ApiV1RouteArgs, principal: ApiPrincipal, imageUrl: string | null) {
  await deleteStoredImageWithCapture({
    bucket: apiV1CloudflareFor(args)?.env?.PHOTOS,
    imageUrl,
    event: "spoonjoy.storage.recipe_image_upload_cleanup_failed",
    postHogConfig: recipeImageUploadPostHogConfig(args),
    waitUntil: apiV1WaitUntilFor(args),
    distinctId: principal.id,
  });
}

async function cleanupRecipeImageUploadRows(
  db: ApiV1Db,
  input: {
    recipe: RecipeCoverOwnerRow;
    coverId: string | null;
    spoonId: string | null;
  },
) {
  if (input.coverId) {
    await db.recipeCover.deleteMany({ where: { id: input.coverId, recipeId: input.recipe.id } }).catch(() => undefined);
  }
  if (input.spoonId) {
    await db.recipeSpoon.deleteMany({ where: { id: input.spoonId, recipeId: input.recipe.id } }).catch(() => undefined);
  }
  await db.recipe.update({
    where: { id: input.recipe.id },
    data: {
      activeCoverId: input.recipe.activeCoverId,
      activeCoverVariant: input.recipe.activeCoverVariant,
      coverMode: input.recipe.coverMode,
    },
  }).catch(() => undefined);
}

function booleanField(body: Record<string, unknown>, field: keyof NotificationPreferenceFlags): boolean {
  const value = body[field];
  if (typeof value !== "boolean") {
    throw new ApiV1Error("validation_error", `${field} must be a boolean`, { field });
  }
  return value;
}

async function notificationPreferencesFor(db: ApiV1Db, userId: string): Promise<NotificationPreferenceFlags> {
  const row = await db.notificationPreference.findUnique({ where: { userId } });
  return row
    ? {
        notifySpoonOnMyRecipe: row.notifySpoonOnMyRecipe,
        notifyForkOfMyRecipe: row.notifyForkOfMyRecipe,
        notifyCookbookSaveOfMine: row.notifyCookbookSaveOfMine,
        notifyFellowChefOriginCook: row.notifyFellowChefOriginCook,
      }
    : DEFAULT_NOTIFICATION_PREFERENCES;
}

async function handleAccountRead(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  return withApiV1Telemetry(
    apiV1PrivateSuccess(requestId, await accountProfilePayload(args, principal.id)),
    { idempotencyOutcome: "none" },
  );
}

async function handleAccountUpdate(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["email", "username", "clientMutationId"]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const fieldErrors: string[] = [];
  if (!email || !isValidAccountEmail(email)) fieldErrors.push("email");
  if (!username) fieldErrors.push("username");
  if (fieldErrors.length > 0) {
    throw new ApiV1Error("validation_error", "Invalid account profile fields", { fields: fieldErrors });
  }

  const normalizedEmail = email.toLowerCase();

  return await runIdempotentApiV1Mutation(args, requestId, principal, {
    clientMutationId,
    email: normalizedEmail,
    username,
  }, clientMutationId, "account.update", async (db) => {
    const currentUser = await db.user.findUnique({
      where: { id: principal.id },
      select: { email: true, username: true },
    });
    /* istanbul ignore if -- @preserve auth verifies the account before profile updates; this is a database race guard. */
    if (!currentUser) {
      throw new ApiV1Error("not_found", "Account not found");
    }

    if (normalizedEmail !== currentUser.email.toLowerCase()) {
      const existingEmail = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM User WHERE LOWER(email) = ${normalizedEmail} AND id != ${principal.id}
      `;
      if (existingEmail.length > 0) {
        throw new ApiV1Error("validation_error", "This email is already in use by another account", { field: "email" });
      }
    }

    if (username !== currentUser.username) {
      const existingUsername = await db.user.findUnique({
        where: { username },
        select: { id: true },
      });
      if (existingUsername && existingUsername.id !== principal.id) {
        throw new ApiV1Error("validation_error", "This username is already taken", { field: "username" });
      }
    }

    await db.user.update({
      where: { id: principal.id },
      data: {
        email: normalizedEmail,
        username,
      },
    });

    return {
      status: 200,
      data: await accountProfileMutationPayload(args, principal.id, clientMutationId),
    };
  });
}

async function handleAccountPhotoUpload(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const formData = await accountPhotoFormDataWithinLimit(args.request);
  const clientMutationId = clientMutationIdFromFormDataHeaderOrQuery(args, formData);
  const photo = formData.get("photo");
  const idempotencyBody = {
    clientMutationId,
    photo: await accountPhotoIdempotencyValue(photo),
  };

  return await runIdempotentApiV1Mutation(args, requestId, principal, idempotencyBody, clientMutationId, "account.photo.upload", async (db) => {
    if (!hasUploadedImageFile(photo)) {
      throw new ApiV1Error("validation_error", "Please select a photo to upload", { field: "photo", reason: "missing" });
    }

    const imageError = validateImageFile(photo, {
      allowedTypes: [...PROFILE_IMAGE_TYPES, ...UNKNOWN_MULTIPART_FILE_TYPES],
      messages: {
        invalidType: "Please upload an image file",
        fileTooLarge: "Photo must be less than 5MB",
      },
    });
    if (imageError) {
      throw new ApiV1Error("validation_error", imageError, { field: "photo" });
    }

    const normalizedPhoto = await normalizeAccountPhotoFile(photo);
    const photoUrl = await storeImage({
      bucket: args.context.cloudflare?.env?.PHOTOS,
      file: normalizedPhoto,
      namespace: `profiles/${principal.id}`,
    });
    await db.user.update({
      where: { id: principal.id },
      data: { photoUrl },
    });

    return {
      status: 200,
      data: await accountProfileMutationPayload(args, principal.id, clientMutationId),
    };
  });
}

async function handleAccountPhotoRemove(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId"]);
  const clientMutationId = clientMutationIdFromBodyHeaderOrQuery(args, body);
  const idempotencyBody = { clientMutationId };

  return await runIdempotentApiV1Mutation(args, requestId, principal, idempotencyBody, clientMutationId, "account.photo.remove", async (db) => {
    const user = await db.user.findUnique({
      where: { id: principal.id },
      select: { photoUrl: true },
    });
    const env = args.context.cloudflare?.env;
    const postHogConfig = env
      ? resolvePostHogServerConfig(env)
      : ({ enabled: false, reason: "missing-key" } as const);

    await deleteStoredImageWithCapture({
      bucket: env?.PHOTOS,
      imageUrl: user?.photoUrl,
      event: "spoonjoy.storage.avatar_delete_failed",
      postHogConfig,
      waitUntil: apiV1WaitUntilFor(args),
      distinctId: principal.id,
    });
    await db.user.update({
      where: { id: principal.id },
      data: { photoUrl: null },
    });

    return {
      status: 200,
      data: await accountProfileMutationPayload(args, principal.id, clientMutationId),
    };
  });
}

async function handleNotificationPreferencesRead(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const db = await getRequestDb(args.context);
  return withApiV1Telemetry(
    apiV1PrivateSuccess(requestId, await notificationPreferencesFor(db, principal.id)),
    { idempotencyOutcome: "none" },
  );
}

async function handleNotificationPreferencesUpdate(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, [
    "notifySpoonOnMyRecipe",
    "notifyForkOfMyRecipe",
    "notifyCookbookSaveOfMine",
    "notifyFellowChefOriginCook",
    "clientMutationId",
  ]);
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  const preferences: NotificationPreferenceFlags = {
    notifySpoonOnMyRecipe: booleanField(body, "notifySpoonOnMyRecipe"),
    notifyForkOfMyRecipe: booleanField(body, "notifyForkOfMyRecipe"),
    notifyCookbookSaveOfMine: booleanField(body, "notifyCookbookSaveOfMine"),
    notifyFellowChefOriginCook: booleanField(body, "notifyFellowChefOriginCook"),
  };

  return await runIdempotentApiV1Mutation(args, requestId, principal, {
    clientMutationId,
    ...preferences,
  }, clientMutationId, "account.notification-preferences.update", async (db) => {
    await db.notificationPreference.upsert({
      where: { userId: principal.id },
      create: {
        userId: principal.id,
        ...preferences,
      },
      update: preferences,
    });

    return {
      status: 200,
      data: {
        ...preferences,
        mutation: mutationMetadata(clientMutationId),
      },
    };
  });
}

const APNS_DEVICE_FIELDS = [
  "clientMutationId",
  "deviceId",
  "platform",
  "environment",
  "token",
  "deviceName",
  "appVersion",
] as const;
const APNS_PLATFORMS = new Set(["ios", "ipados", "macos"]);
const APNS_ENVIRONMENTS = new Set(["development", "production"]);

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashApnsToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(digest));
}

function apnsRequiredText(
  body: Record<string, unknown>,
  field: typeof APNS_DEVICE_FIELDS[number],
  errors: Record<string, string>,
  maxLength = MAX_SHORT_TEXT_LENGTH,
) {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    errors[field] = `${field} must be a nonblank string`;
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    errors[field] = `${field} must be at most ${maxLength} characters`;
    return "";
  }
  return trimmed;
}

function apnsOptionalText(
  body: Record<string, unknown>,
  field: typeof APNS_DEVICE_FIELDS[number],
  errors: Record<string, string>,
) {
  if (body[field] === undefined || body[field] === null) return null;
  return apnsRequiredText(body, field, errors);
}

function apiDateTime(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function nullableApiDateTime(value: Date | string | null): string | null {
  return value === null ? null : apiDateTime(value);
}

function apnsDevicePayload(device: NativePushDevice) {
  return {
    id: device.id,
    deviceId: device.deviceId,
    platform: device.platform,
    environment: device.environment,
    tokenPrefix: device.tokenPrefix,
    deviceName: device.deviceName,
    appVersion: device.appVersion,
    enabledAt: apiDateTime(device.enabledAt),
    revokedAt: nullableApiDateTime(device.revokedAt),
    lastRegisteredAt: apiDateTime(device.lastRegisteredAt),
    createdAt: apiDateTime(device.createdAt),
    updatedAt: apiDateTime(device.updatedAt),
  };
}

async function handleApnsDeviceRegister(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const body = await parseApiV1JsonBody(args.request);
  const fieldErrors: Record<string, string> = {};
  for (const field of Object.keys(body)) {
    if (!(APNS_DEVICE_FIELDS as readonly string[]).includes(field)) {
      fieldErrors[field] = "Unknown field";
    }
  }
  const clientMutationId = apnsRequiredText(body, "clientMutationId", fieldErrors);
  const deviceId = apnsRequiredText(body, "deviceId", fieldErrors);
  const platform = apnsRequiredText(body, "platform", fieldErrors);
  const environment = apnsRequiredText(body, "environment", fieldErrors);
  const token = apnsRequiredText(body, "token", fieldErrors, 4096);
  const deviceName = apnsOptionalText(body, "deviceName", fieldErrors);
  const appVersion = apnsOptionalText(body, "appVersion", fieldErrors);

  if (platform && !APNS_PLATFORMS.has(platform)) {
    fieldErrors.platform = "platform must be ios, ipados, or macos";
  }
  if (environment && !APNS_ENVIRONMENTS.has(environment)) {
    fieldErrors.environment = "environment must be development or production";
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new ApiV1Error("validation_error", "Invalid APNs device registration", { fieldErrors });
  }

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, clientMutationId, "account.apns.register", async (db) => {
    const tokenHash = await hashApnsToken(token);
    const now = new Date();
    await db.nativePushDevice.updateMany({
      where: {
        tokenHash,
        platform,
        environment,
        revokedAt: null,
        NOT: {
          userId: principal.id,
          deviceId,
          platform,
          environment,
        },
      },
      data: { revokedAt: now.toISOString() },
    });
    const existing = await db.nativePushDevice.findFirst({
      where: { userId: principal.id, deviceId, platform, environment },
    });
    const device = existing
      ? await db.nativePushDevice.update({
          where: { id: existing.id },
          data: {
            tokenHash,
            tokenPrefix: token.slice(0, 12),
            deviceName,
            appVersion,
            enabledAt: now,
            revokedAt: null,
            lastRegisteredAt: now,
          },
        })
      : await db.nativePushDevice.create({
          data: {
            userId: principal.id,
            deviceId,
            platform,
            environment,
            tokenHash,
            tokenPrefix: token.slice(0, 12),
            deviceName,
            appVersion,
            enabledAt: now,
            lastRegisteredAt: now,
          },
        });

    return {
      status: existing ? 200 : 201,
      data: {
        created: !existing,
        device: apnsDevicePayload(device),
        mutation: mutationMetadata(clientMutationId),
      },
    };
  });
}

async function handleApnsDeviceRevoke(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal, deviceId: string) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["clientMutationId"]);
  const clientMutationId = clientMutationIdFromBodyHeaderOrQuery(args, body);
  const idempotencyBody = { clientMutationId };

  return await runIdempotentApiV1Mutation(args, requestId, principal, idempotencyBody, clientMutationId, "account.apns.revoke", async (db) => {
    const existingDevices = await db.nativePushDevice.findMany({
      where: { userId: principal.id, deviceId },
      orderBy: [{ lastRegisteredAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    if (existingDevices.length === 0) {
      throw new ApiV1Error("not_found", "Native push device not found");
    }

    const activeDeviceIds = existingDevices
      .filter((device) => device.revokedAt === null)
      .map((device) => device.id);
    if (activeDeviceIds.length > 0) {
      await db.nativePushDevice.updateMany({
        where: { id: { in: activeDeviceIds } },
        data: { revokedAt: new Date().toISOString() },
      });
    }
    const devices = await db.nativePushDevice.findMany({
      where: { userId: principal.id, deviceId },
      orderBy: [{ lastRegisteredAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });

    return {
      status: 200,
      data: {
        revoked: activeDeviceIds.length > 0,
        revokedCount: activeDeviceIds.length,
        device: apnsDevicePayload(devices[0]!),
        devices: devices.map(apnsDevicePayload),
        mutation: mutationMetadata(clientMutationId),
      },
    };
  });
}

function accountConnectionId(clientId: string, resource: string | null, connectionKey: string): string {
  return `conn_${base64UrlEncodeText(JSON.stringify({ clientId, resource, connectionKey }))}`;
}

function parseAccountConnectionId(connectionId: string): { clientId: string; resource: string | null; connectionKey: string } {
  if (!connectionId.startsWith("conn_")) {
    throw new ApiV1Error("not_found", "OAuth connection not found");
  }
  try {
    const parsed = JSON.parse(base64UrlDecodeText(connectionId.slice("conn_".length))) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { clientId?: unknown }).clientId === "string" &&
      typeof (parsed as { connectionKey?: unknown }).connectionKey === "string"
    ) {
      const resource = (parsed as { resource?: unknown }).resource;
      if (resource === null || typeof resource === "string") {
        return {
          clientId: (parsed as { clientId: string }).clientId,
          resource,
          connectionKey: (parsed as { connectionKey: string }).connectionKey,
        };
      }
    }
  } catch {
    // Fall through to the not_found below so invalid opaque ids do not leak parser detail.
  }
  throw new ApiV1Error("not_found", "OAuth connection not found");
}

async function oauthConnectionSummaries(db: ApiV1Db, userId: string) {
  const activeRefreshTokens = await db.oAuthRefreshToken.findMany({
    where: { userId, revokedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      clientId: true,
      resource: true,
      scope: true,
      connectionKey: true,
      createdAt: true,
    },
  });
  const oauthClientIds = [...new Set(activeRefreshTokens.map((token) => token.clientId))];
  const oauthClients = oauthClientIds.length
    ? await db.oAuthClient.findMany({
        where: { id: { in: oauthClientIds } },
        select: { id: true, clientName: true },
      })
    : [];
  const clientNames = new Map(oauthClients.map((client) => [client.id, client.clientName]));
  const accessCredentialCounts = await db.apiCredential.groupBy({
    by: ["oauthClientId", "oauthResource"],
    where: {
      userId,
      revokedAt: null,
      oauthClientId: { in: oauthClientIds.length ? oauthClientIds : ["__none__"] },
    },
    _count: { _all: true },
  });
  const accessCounts = new Map(
    accessCredentialCounts.map((row) => [
      `${row.oauthClientId!}\u0000${row.oauthResource ?? ""}`,
      row._count._all,
    ]),
  );
  const groups = new Map<string, {
    clientId: string;
    clientName: string;
    resource: string | null;
    connectionKey: string;
    scopes: Set<string>;
    createdAt: Date;
    refreshTokenCount: number;
    accessTokenCount: number;
  }>();
  for (const token of activeRefreshTokens) {
    const key = `${token.clientId}\u0000${token.resource ?? ""}`;
    const connectionKey = token.connectionKey ?? token.id;
    const existing = groups.get(key);
    if (existing) {
      for (const scope of token.scope.trim().split(/\s+/).filter(Boolean)) existing.scopes.add(scope);
      if (token.createdAt < existing.createdAt) {
        existing.createdAt = token.createdAt;
        existing.connectionKey = connectionKey;
      }
      existing.refreshTokenCount += 1;
      continue;
    }
    groups.set(key, {
      clientId: token.clientId,
      clientName: clientNames.get(token.clientId) ?? token.clientId,
      resource: token.resource,
      connectionKey,
      scopes: new Set(token.scope.trim().split(/\s+/).filter(Boolean)),
      createdAt: token.createdAt,
      refreshTokenCount: 1,
      accessTokenCount: accessCounts.get(key) ?? 0,
    });
  }

  return Array.from(groups.values()).map((connection) => ({
    id: accountConnectionId(connection.clientId, connection.resource, connection.connectionKey),
    clientId: connection.clientId,
    clientName: connection.clientName,
    resource: connection.resource,
    scopes: Array.from(connection.scopes).sort(),
    createdAt: connection.createdAt.toISOString(),
    refreshTokenCount: connection.refreshTokenCount,
    accessTokenCount: connection.accessTokenCount,
  }));
}

async function handleOAuthConnectionList(args: ApiV1RouteArgs, requestId: string, principal: ApiPrincipal) {
  const db = await getRequestDb(args.context);
  return withApiV1Telemetry(
    apiV1PrivateSuccess(requestId, { connections: await oauthConnectionSummaries(db, principal.id) }),
    { idempotencyOutcome: "none" },
  );
}

async function handleOAuthConnectionDisconnect(
  args: ApiV1RouteArgs,
  requestId: string,
  principal: ApiPrincipal,
  connectionId: string,
) {
  parseAccountConnectionId(connectionId);
  const db = await getRequestDb(args.context);
  const connection = (await oauthConnectionSummaries(db, principal.id))
    .find((candidate) => candidate.id === connectionId);
  if (!connection) {
    throw new ApiV1Error("not_found", "OAuth connection not found or already disconnected");
  }
  const now = new Date();
  const refresh = await db.oAuthRefreshToken.updateMany({
    where: { userId: principal.id, clientId: connection.clientId, resource: connection.resource, revokedAt: null },
    data: { revokedAt: now },
  });
  const access = await db.apiCredential.updateMany({
    where: { userId: principal.id, oauthClientId: connection.clientId, oauthResource: connection.resource, revokedAt: null },
    data: { revokedAt: now },
  });
  const revokedConnectionCount = refresh.count + access.count;
  /* istanbul ignore if -- @preserve the connection summary guarantees an active row; both zero only under a post-summary revoke race. */
  if (revokedConnectionCount === 0) {
    throw new ApiV1Error("not_found", "OAuth connection not found or already disconnected");
  }

  return withApiV1Telemetry(
    apiV1PrivateSuccess(requestId, {
      disconnected: true,
      connectionId,
      clientId: connection.clientId,
      resource: connection.resource,
      revokedRefreshTokens: refresh.count,
      revokedAccessTokens: access.count,
    }),
    { idempotencyOutcome: "none" },
  );
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

function recipeStepOrderIsContiguous(recipe: SerializedRecipe) {
  const stepNums = recipe.steps.map((step) => step.stepNum).sort((a, b) => a - b);
  return stepNums.every((stepNum, index) => stepNum === index + 1);
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
    select: { id: true, chefId: true, title: true, deletedAt: true, updatedAt: true },
  });
  if (!recipe || recipe.chefId !== input.principalId || !recipe.deletedAt) return null;
  if (
    recipe.deletedAt.getTime() + IDEMPOTENCY_RECOVERY_TIMESTAMP_TOLERANCE_MS <
    reservation.createdAt.getTime()
  ) {
    return null;
  }
  await recordNativeSyncTombstone(db, {
    accountId: input.principalId,
    resourceType: "recipe",
    resourceId: recipe.id,
    title: recipe.title,
    deletedAt: recipe.deletedAt,
    updatedAt: recipe.updatedAt,
  });
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
  reservation: ApiIdempotencyKey,
  input: { clientMutationId: string; origin: string; principalId: string; recipeId: string; stepId: string; toStepNum: number },
): Promise<ApiV1IdempotentMutationResult | null> {
  const tombstone = await findMutationTombstone(db, reservation, {
    operation: "recipes.steps.reorder",
    resourceType: "recipe_step_reorder",
    resourceId: input.stepId,
    parentResourceId: input.recipeId,
  });
  if (!tombstone?.payload) return null;
  let payload: { toStepNum?: unknown; reordered?: unknown };
  try {
    payload = JSON.parse(tombstone.payload) as { toStepNum?: unknown; reordered?: unknown };
  } catch {
    return null;
  }
  if (payload.toStepNum !== input.toStepNum || typeof payload.reordered !== "boolean") return null;

  const recipeRow = await loadRecipeById(db, input.recipeId);
  if (!recipeRow || recipeRow.chef.id !== input.principalId) return null;
  const recipe = recipeDetail(recipeRow, input.origin);
  const step = findSerializedStep(recipe, input.stepId);
  if (!step || step.stepNum !== input.toStepNum || !recipeStepOrderIsContiguous(recipe)) return null;
  return {
    status: 200,
    data: {
      reordered: payload.reordered,
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

  return await runIdempotentApiV1Mutation(args, requestId, principal, body, parsed.data.clientMutationId, "recipes.steps.reorder", async (db, reservation) => {
    const reordered = recipeStepResultOrThrow(await reorderNativeRecipeStep(db, principal.id, recipeId, parsed.data, {
      tombstone: { idempotencyKeyId: reservation.id, operation: "recipes.steps.reorder" },
    }));
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

function optionalNativeAppleText(body: Record<string, unknown>, field: string, maxLength: number): string | null {
  const value = body[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiV1Error("validation_error", `${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new ApiV1Error("validation_error", `${field} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function nativeSignInTokenPayload(tokens: Awaited<ReturnType<typeof handleNativeAppleSignIn>>["tokens"]) {
  return {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: "Bearer",
    expires_in: tokens.expiresIn,
    scope: tokens.scope,
  };
}

async function handleNativeAppleSignInRequest(args: ApiV1RouteArgs, requestId: string) {
  const authRateLimit = await enforceAuthRateLimit(args.request, args.context.cloudflare?.env?.AUTH_IP_RATE_LIMITER);
  if (!authRateLimit.allowed) {
    const response = apiV1SamePartyErrorResponse(
      requestId,
      new ApiV1Error("rate_limited", "Too many requests. Try again later.", {
        retryAfterSeconds: authRateLimit.retryAfterSeconds,
        scope: authRateLimit.scope,
      }),
    );
    return withApiV1Telemetry(response, {
      errorCode: "rate_limited",
      rateLimitScope: authRateLimit.scope,
    });
  }

  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["identityToken", "rawNonce", "email", "fullName"]);
  const identityToken = nonblankString(body.identityToken, "identityToken", 8192);
  const rawNonce = nonblankString(body.rawNonce, "rawNonce", 256);
  const email = optionalNativeAppleText(body, "email", 320);
  const fullName = optionalNativeAppleText(body, "fullName", 320);
  const db = await getRequestDb(args.context);

  try {
    const result = await handleNativeAppleSignIn(
      db,
      { identityToken, rawNonce, email, fullName },
      getAppleNativeAuthConfig((args.context.cloudflare?.env ?? {}) as OAuthEnv),
    );
    return withApiV1Telemetry(
      apiV1SamePartyPrivateSuccess(requestId, {
        action: result.action,
        userId: result.userId,
        ...nativeSignInTokenPayload(result.tokens),
      }, 201, TOKEN_RESPONSE_HEADERS),
      { idempotencyOutcome: "none" },
    );
  } catch (error) {
    if (error instanceof NativeAppleAuthError) {
      const code = error.status === 401 ? "invalid_token" : "validation_error";
      throw new ApiV1Error(code, error.message, { providerCode: error.code });
    }
    if (error instanceof Error && error.message.startsWith("Missing required environment variable")) {
      throw new ApiV1Error("validation_error", "Native Apple sign-in is not configured", { providerCode: "apple_native_unconfigured" });
    }
    throw error;
  }
}

async function handleNativePasswordSignInRequest(args: ApiV1RouteArgs, requestId: string) {
  const authRateLimit = await enforceAuthRateLimit(args.request, args.context.cloudflare?.env?.AUTH_IP_RATE_LIMITER);
  if (!authRateLimit.allowed) {
    const response = apiV1SamePartyErrorResponse(
      requestId,
      new ApiV1Error("rate_limited", "Too many requests. Try again later.", {
        retryAfterSeconds: authRateLimit.retryAfterSeconds,
        scope: authRateLimit.scope,
      }),
    );
    return withApiV1Telemetry(response, {
      errorCode: "rate_limited",
      rateLimitScope: authRateLimit.scope,
    });
  }

  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, ["emailOrUsername", "password"]);
  const emailOrUsername = nonblankString(body.emailOrUsername, "emailOrUsername", 320);
  const password = nonblankString(body.password, "password", 1024);
  const db = await getRequestDb(args.context);

  try {
    const result = await handleNativePasswordSignIn(
      db,
      { emailOrUsername, password },
    );
    return withApiV1Telemetry(
      apiV1SamePartyPrivateSuccess(requestId, {
        action: result.action,
        userId: result.userId,
        ...nativeSignInTokenPayload(result.tokens),
      }, 201, TOKEN_RESPONSE_HEADERS),
      { idempotencyOutcome: "none" },
    );
  } catch (error) {
    if (error instanceof NativePasswordAuthError) {
      const code = error.status === 401 ? "invalid_token" : "validation_error";
      throw new ApiV1Error(code, error.message, { providerCode: error.code });
    }
    throw error;
  }
}

async function handleNativeTelemetryRequest(args: ApiV1RouteArgs, requestId: string, authenticated: ApiPrincipal | null) {
  const body = await parseApiV1JsonBody(args.request);
  assertKnownFields(body, [
    "event",
    "stage",
    "environment",
    "platform",
    "appVersion",
    "buildNumber",
    "route",
    "errorType",
    "requestId",
    "status",
    "apiCode",
    "retry",
    "accountBound",
    "hasRenderableCacheContent",
    "recipes",
    "cookbooks",
    "shoppingItems",
    "queuedMutations",
    "intentName",
    "intentActionKind",
    "intentOutcome",
    "intentReturnsValue",
    "intentQueuedMutationId",
    "intentQueuedMutationKind",
    "intentOpensUrl",
    "authProvider",
    "authPhase",
    "authOutcome",
    "authDiagnosticCode",
    "authSessionState",
    "authCredentialPresent",
    "authIdentityTokenPresent",
    "authRawNoncePresent",
    "authEmailPresent",
    "authFullNamePresent",
    "authOAuthStatePresent",
    "authRedirectScheme",
    "authRedirectHost",
  ]);

  const nativeEvent = nativeTelemetryEvent(body.event);
  const environment = nativeTelemetryEnvironment(body.environment, args);
  const platform = optionalNativeTelemetryEnum(body.platform, "platform", NATIVE_TELEMETRY_PLATFORMS);
  const payload = {
    native_event: nativeEvent,
    stage: optionalNullableString(body.stage, "stage", 80),
    environment,
    platform,
    app_version: optionalNullableString(body.appVersion, "appVersion", 40),
    build_number: optionalNullableString(body.buildNumber, "buildNumber", 40),
    route: optionalNullableString(body.route, "route", 80),
    error_type: optionalNullableString(body.errorType, "errorType", 80),
    native_request_id: optionalNullableString(body.requestId, "requestId", 160),
    http_status: optionalNativeTelemetryInteger(body.status, "status", 100, 599),
    api_error_code: optionalNullableString(body.apiCode, "apiCode", 80),
    retry: optionalNullableString(body.retry, "retry", 80),
    account_bound: optionalNativeTelemetryBoolean(body.accountBound, "accountBound"),
    has_renderable_cache_content: optionalNativeTelemetryBoolean(body.hasRenderableCacheContent, "hasRenderableCacheContent"),
    recipe_count: optionalNativeTelemetryInteger(body.recipes, "recipes", 0, 100_000),
    cookbook_count: optionalNativeTelemetryInteger(body.cookbooks, "cookbooks", 0, 100_000),
    shopping_item_count: optionalNativeTelemetryInteger(body.shoppingItems, "shoppingItems", 0, 100_000),
    queued_mutation_count: optionalNativeTelemetryInteger(body.queuedMutations, "queuedMutations", 0, 100_000),
    intent_name: optionalNullableString(body.intentName, "intentName", 120),
    intent_action_kind: optionalNullableString(body.intentActionKind, "intentActionKind", 80),
    intent_outcome: optionalNullableString(body.intentOutcome, "intentOutcome", 40),
    intent_returns_value: optionalNativeTelemetryBoolean(body.intentReturnsValue, "intentReturnsValue"),
    intent_queued_mutation_id: optionalNullableString(body.intentQueuedMutationId, "intentQueuedMutationId", 160),
    intent_queued_mutation_kind: optionalNullableString(body.intentQueuedMutationKind, "intentQueuedMutationKind", 80),
    intent_opens_url: optionalNullableString(body.intentOpensUrl, "intentOpensUrl", 320),
    auth_provider: optionalNullableString(body.authProvider, "authProvider", 80),
    auth_phase: optionalNullableString(body.authPhase, "authPhase", 120),
    auth_outcome: optionalNullableString(body.authOutcome, "authOutcome", 40),
    auth_diagnostic_code: optionalNullableString(body.authDiagnosticCode, "authDiagnosticCode", 120),
    auth_session_state: optionalNullableString(body.authSessionState, "authSessionState", 80),
    auth_credential_present: optionalNativeTelemetryBoolean(body.authCredentialPresent, "authCredentialPresent"),
    auth_identity_token_present: optionalNativeTelemetryBoolean(body.authIdentityTokenPresent, "authIdentityTokenPresent"),
    auth_raw_nonce_present: optionalNativeTelemetryBoolean(body.authRawNoncePresent, "authRawNoncePresent"),
    auth_email_present: optionalNativeTelemetryBoolean(body.authEmailPresent, "authEmailPresent"),
    auth_full_name_present: optionalNativeTelemetryBoolean(body.authFullNamePresent, "authFullNamePresent"),
    auth_oauth_state_present: optionalNativeTelemetryBoolean(body.authOAuthStatePresent, "authOAuthStatePresent"),
    auth_redirect_scheme: optionalNullableString(body.authRedirectScheme, "authRedirectScheme", 40),
    auth_redirect_host: optionalNullableString(body.authRedirectHost, "authRedirectHost", 160),
    server_request_id: requestId,
  };

  const env = args.context.cloudflare?.env as PostHogServerEnv | undefined;
  if (env) {
    const task = captureEvent(resolvePostHogServerConfig(env), {
      event: "spoonjoy.native.telemetry",
      distinctId: authenticated?.id ?? "anonymous_native_app",
      properties: payload,
    });
    const waitUntil = apiV1WaitUntilFor(args);
    if (waitUntil) {
      waitUntil(task);
    } else {
      await task;
    }
  }

  return withApiV1Telemetry(
    authenticated
      ? apiV1PrivateSuccess(requestId, { accepted: true }, 202)
      : apiV1Success(requestId, { accepted: true }, 202),
    { operation: "native.telemetry.capture", idempotencyOutcome: "none" },
  );
}

function nativeTelemetryEvent(value: unknown): NativeTelemetryEventName {
  const event = nonblankString(value, "event", 80);
  if (!NATIVE_TELEMETRY_EVENTS.has(event as NativeTelemetryEventName)) {
    throw new ApiV1Error("validation_error", "event is not a supported native telemetry event");
  }
  return event as NativeTelemetryEventName;
}

function nativeTelemetryEnvironment(value: unknown, args: ApiV1RouteArgs): "local" | "preview" | "production" {
  if (value === undefined || value === null) return nativeSyncEnvironment(args);
  const environment = nonblankString(value, "environment", 40);
  if (!NATIVE_TELEMETRY_ENVIRONMENTS.has(environment)) {
    throw new ApiV1Error("validation_error", "environment must be local, preview, or production");
  }
  return environment as "local" | "preview" | "production";
}

function optionalNativeTelemetryEnum(value: unknown, field: string, allowed: ReadonlySet<string>): string | null {
  if (value === undefined || value === null || value === "") return null;
  const normalized = nonblankString(value, field, 40).toLowerCase();
  if (!allowed.has(normalized)) {
    throw new ApiV1Error("validation_error", `${field} is not supported`);
  }
  return normalized;
}

function optionalNativeTelemetryInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ApiV1Error("validation_error", `${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function optionalNativeTelemetryBoolean(value: unknown, field: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") {
    throw new ApiV1Error("validation_error", `${field} must be a boolean`);
  }
  return value;
}

function isNativeAuthPath(path: string): boolean {
  return path === "auth/apple/native" || path === "auth/password/native";
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
    if ((path === "auth/apple/native" || path === "auth/password/native") && args.request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: apiV1SamePartyPrivateHeaders(requestId, false) });
    }

    if (args.request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: apiV1Headers(requestId, false) });
    }

    const throttled = await enforceApiV1RateLimit(args, requestId, { samePartyError: isNativeAuthPath(path) });
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

    if (path === "auth/apple/native" && args.request.method !== "POST") {
      throw new ApiV1Error("method_not_allowed", "Method not allowed", { allow: "POST" });
    }

    if (args.request.method === "POST" && path === "auth/apple/native") {
      const response = await handleNativeAppleSignInRequest(args, requestId);
      return observeApiV1Response(args, { requestId, path, response, startedAt });
    }

    if (path === "auth/password/native" && args.request.method !== "POST") {
      throw new ApiV1Error("method_not_allowed", "Method not allowed", { allow: "POST" });
    }

    if (args.request.method === "POST" && path === "auth/password/native") {
      const response = await handleNativePasswordSignInRequest(args, requestId);
      return observeApiV1Response(args, { requestId, path, response, startedAt });
    }

    if (path === "native/telemetry" && args.request.method !== "POST") {
      throw new ApiV1Error("method_not_allowed", "Method not allowed", { allow: "POST" });
    }

    if (args.request.method === "POST" && path === "native/telemetry") {
      const principal = await authorize(path);
      const response = await handleNativeTelemetryRequest(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && path === "search") {
      const principal = await authorize(path);
      const response = await handleSearch(args, requestId, principal);
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

    if (args.request.method === "POST" && segments[0] === "recipes" && segments[2] === "image" && segments.length === 3) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleRecipeImageUpload(args, requestId, principal, segments[1]);
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

    if (args.request.method === "POST" && path === "cookbooks") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleCookbookCreate(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && segments[0] === "cookbooks" && segments.length === 2) {
      const principal = await authorize(path);
      const response = await handleCookbookDetail(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "PATCH" && segments[0] === "cookbooks" && segments.length === 2) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleCookbookUpdate(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "DELETE" && segments[0] === "cookbooks" && segments.length === 2) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleCookbookDelete(args, requestId, principal, segments[1]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "POST" && segments[0] === "cookbooks" && segments[2] === "recipes" && segments.length === 4) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleCookbookRecipeAdd(args, requestId, principal, segments[1], segments[3]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "DELETE" && segments[0] === "cookbooks" && segments[2] === "recipes" && segments.length === 4) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleCookbookRecipeRemove(args, requestId, principal, segments[1], segments[3]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && path === "me") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleAccountRead(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && path === "me/sync") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleNativeAccountSync(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "PATCH" && path === "me") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleAccountUpdate(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "POST" && path === "me/photo") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleAccountPhotoUpload(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "DELETE" && path === "me/photo") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleAccountPhotoRemove(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && path === "me/notification-preferences") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleNotificationPreferencesRead(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "PATCH" && path === "me/notification-preferences") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleNotificationPreferencesUpdate(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "POST" && path === "me/apns-devices") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleApnsDeviceRegister(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "DELETE" && segments[0] === "me" && segments[1] === "apns-devices" && segments.length === 3) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleApnsDeviceRevoke(args, requestId, principal, segments[2]);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "GET" && path === "me/connections") {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleOAuthConnectionList(args, requestId, principal);
      return observeApiV1Response(args, { requestId, path, response, startedAt, principal });
    }

    if (args.request.method === "DELETE" && segments[0] === "me" && segments[1] === "connections" && segments.length === 3) {
      const principal = await authorize(path) as ApiPrincipal;
      const response = await handleOAuthConnectionDisconnect(args, requestId, principal, segments[2]);
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

    if (args.request.method !== "GET" && args.request.method !== "POST" && args.request.method !== "PUT" && args.request.method !== "PATCH" && args.request.method !== "DELETE") {
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
      const response = isNativeAuthPath(path)
        ? apiV1SamePartyErrorResponse(requestId, error)
        : apiV1ErrorResponse(requestId, error);
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
    const response = isNativeAuthPath(path)
      ? apiV1SamePartyErrorResponse(requestId, internalError)
      : apiV1ErrorResponse(requestId, internalError);
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
