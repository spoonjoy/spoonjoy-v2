import type { Route } from "./+types/api.$";
import { ApiAuthError, type ApiPrincipal } from "~/lib/api-auth.server";
import { enforceRateLimit, rateLimitedResponse, type RateLimitScope } from "~/lib/rate-limit.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { callSpoonjoyApiOperation, listSpoonjoyApiOperations } from "~/lib/spoonjoy-api.server";
import { buildSpoonjoyApiContext, resolveApiPrincipal } from "~/lib/spoonjoy-api-request.server";
import { RequestBodyTooLargeError, readLimitedTextBody } from "~/lib/request-body-limit.server";
import {
  captureEvent,
  captureException,
  requestContentBytes,
  resolvePostHogServerConfig,
  safeHeaderHost,
  userAgentFamily,
} from "~/lib/analytics-server";

const API_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const TOKEN_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

const SECRET_BEARING_OPERATIONS = new Set([
  "start_agent_connection",
  "poll_agent_connection",
  "create_api_token",
]);

const NUMERIC_QUERY_KEYS = new Set(["duration", "limit", "quantity"]);
const BOOLEAN_QUERY_KEYS = new Set(["checked"]);
const LEGACY_SAFE_REQUEST_ID_RE = /^req_[a-z0-9][a-z0-9_-]{0,63}$/i;
const LEGACY_UUID_REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ApiDispatch = {
  operation: string;
  args: Record<string, unknown>;
};

const LEGACY_TOOL_OPERATION_NAMES = new Set(listSpoonjoyApiOperations().map((operation) => operation.name));

type LegacyApiTelemetryInput = {
  request: Request;
  context: Route.LoaderArgs["context"];
  response: Response;
  startedAt: number;
  operation?: string;
  principal?: ApiPrincipal | null;
  errorCode?: string;
  routeTemplate?: string;
  rateLimitScope?: RateLimitScope;
};

function apiJson(payload: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(API_HEADERS);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return Response.json(payload, { status, headers });
}

function legacyRequestId(request: Request): string {
  const requestId = request.headers.get("X-Request-Id")?.trim();
  if (!requestId) return "unknown";
  if (LEGACY_SAFE_REQUEST_ID_RE.test(requestId) || LEGACY_UUID_REQUEST_ID_RE.test(requestId)) {
    return requestId;
  }
  return "unknown";
}

function legacyAuthMode(principal: ApiPrincipal | null): string {
  if (!principal) return "anonymous";
  return principal.oauthClientId ? "oauth_bearer" : principal.source;
}

function legacyPrivacyClass(operation: string | undefined, principal: ApiPrincipal | null): string {
  if (principal) return "authenticated";
  if (!operation) return "public";
  if (
    operation.includes("shopping_list") ||
    operation.includes("token") ||
    operation.startsWith("create_") ||
    operation.startsWith("add_") ||
    operation.startsWith("remove_") ||
    operation.startsWith("set_") ||
    operation.startsWith("revoke_")
  ) {
    return "private";
  }
  return "public";
}

function legacyOperationFromRequest(request: Request, splat: string): string | undefined {
  try {
    const url = new URL(request.url);
    const segments = splat.split("/").filter(Boolean).map(decodeURIComponent);
    const path = segments.join("/");
    if (!path) return "root";
    if (request.method === "GET" && path === "tools") return "tools";
    if (request.method === "GET") return dispatchGet(path, segments, url).operation;
  } catch {
    return undefined;
  }
  return undefined;
}

function observeLegacyApiResponse(input: LegacyApiTelemetryInput): Response {
  const cloudflare = input.context.cloudflare;
  const env = cloudflare?.env;
  const waitUntil = cloudflare?.ctx?.waitUntil ? cloudflare.ctx.waitUntil.bind(cloudflare.ctx) : undefined;
  if (!env || !waitUntil) return input.response;

  const postHogConfig = resolvePostHogServerConfig(env);
  if (!postHogConfig.enabled) return input.response;

  const principal = input.principal ?? null;
  const routeTemplate = input.routeTemplate ?? (input.operation ? "/api/{operation}" : "/api/{unknown}");
  waitUntil(captureEvent(postHogConfig, {
    event: "spoonjoy.legacy_api.request",
    distinctId: principal?.id ?? "anon",
    properties: {
      route_template: routeTemplate,
      operation: input.operation,
      method: input.request.method,
      status: input.response.status,
      request_id: legacyRequestId(input.request),
      error_code: input.errorCode,
      auth_mode: legacyAuthMode(principal),
      principal_id: principal?.id,
      credential_id: principal?.credentialId,
      oauth_client_id: principal?.oauthClientId || undefined,
      oauth_resource: principal?.oauthClientId ? (principal.oauthResource ?? null) : undefined,
      scopes: principal?.scopes,
      request_bytes: requestContentBytes(input.request),
      privacy_class: legacyPrivacyClass(input.operation, principal),
      origin_host: safeHeaderHost(input.request.headers.get("Origin")),
      referrer_host: safeHeaderHost(input.request.headers.get("Referer")),
      user_agent_family: userAgentFamily(input.request.headers.get("User-Agent")),
      rate_limit_scope: input.rateLimitScope,
      latency_ms: Math.max(0, Date.now() - input.startedAt),
    },
  }));

  return input.response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function queryArgs(url: URL): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  for (const [key, value] of url.searchParams) {
    if (NUMERIC_QUERY_KEYS.has(key)) {
      const numeric = Number(value);
      args[key] = Number.isFinite(numeric) ? numeric : value;
    } else if (BOOLEAN_QUERY_KEYS.has(key)) {
      args[key] = value === "true" ? true : value === "false" ? false : value;
    } else {
      args[key] = value;
    }
  }

  return args;
}

function pickArgs(args: Record<string, unknown>, allowedKeys: readonly string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      picked[key] = args[key];
    }
  }
  return picked;
}

async function bodyArgs(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("Content-Length") === "0") return {};

  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) return {};
  const text = await readLimitedTextBody(request);
  if (!text.trim()) return {};

  try {
    const parsed = JSON.parse(text);
    if (parsed === null || parsed === undefined) return {};
    if (!isRecord(parsed)) throw new ApiAuthError("JSON body must be an object", 400);
    return parsed;
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    throw new ApiAuthError("Invalid JSON body", 400);
  }
}

function notFound(path: string): never {
  throw new ApiAuthError(`Unknown Spoonjoy API endpoint: /api/${path}`, 404);
}

function dispatchGet(path: string, segments: string[], url: URL): ApiDispatch {
  const args = queryArgs(url);

  if (path === "health") return { operation: "health", args: {} };
  if (path === "search") return { operation: "search_spoonjoy", args: pickArgs(args, ["query", "scope", "ownerEmail", "limit"]) };
  if (path === "recipes") return { operation: "search_recipes", args: pickArgs(args, ["query", "chefEmail", "limit"]) };
  if (segments[0] === "recipes" && segments.length === 2) {
    return { operation: "get_recipe", args: { id: segments[1] } };
  }
  if (path === "cookbooks") return { operation: "list_cookbooks", args: pickArgs(args, ["ownerEmail", "query", "limit"]) };
  if (segments[0] === "cookbooks" && segments.length === 2) {
    return { operation: "get_cookbook", args: { ...pickArgs(args, ["ownerEmail", "title", "cookbookTitle"]), cookbookId: segments[1] } };
  }
  if (path === "shopping-list") return { operation: "get_shopping_list", args: pickArgs(args, ["ownerEmail"]) };
  if (path === "shopping-list/search") return { operation: "search_shopping_list", args: pickArgs(args, ["ownerEmail", "query", "limit"]) };
  if (path === "tokens") return { operation: "list_api_tokens", args: pickArgs(args, ["ownerEmail"]) };

  notFound(path);
}

async function dispatchMutation(method: string, path: string, segments: string[], request: Request): Promise<ApiDispatch> {
  const args = await bodyArgs(request);

  if (method === "POST" && segments[0] === "tools" && segments.length === 2) {
    if (!LEGACY_TOOL_OPERATION_NAMES.has(segments[1])) notFound(path);
    return { operation: segments[1], args };
  }
  if (method === "POST" && path === "recipes") return { operation: "create_recipe", args };
  if (method === "POST" && segments[0] === "recipes" && segments.length === 3 && segments[2] === "shopping-list") {
    return { operation: "add_recipe_to_shopping_list", args: { ...args, recipeId: segments[1] } };
  }
  if (method === "POST" && path === "cookbooks") return { operation: "create_cookbook", args };
  if (method === "POST" && segments[0] === "cookbooks" && segments.length === 3 && segments[2] === "recipes") {
    return { operation: "add_recipe_to_cookbook", args: { ...args, cookbookId: segments[1] } };
  }
  if (method === "DELETE" && segments[0] === "cookbooks" && segments[2] === "recipes" && segments.length === 4) {
    return { operation: "remove_recipe_from_cookbook", args: { ...args, cookbookId: segments[1], recipeId: segments[3] } };
  }
  if (method === "POST" && path === "shopping-list/items") return { operation: "add_shopping_list_item", args };
  if (method === "PATCH" && segments[0] === "shopping-list" && segments[1] === "items" && segments.length === 3) {
    return { operation: "set_shopping_list_item_checked", args: { ...args, itemId: segments[2] } };
  }
  if (method === "DELETE" && segments[0] === "shopping-list" && segments[1] === "items" && segments.length === 3) {
    return { operation: "remove_shopping_list_item", args: { ...args, itemId: segments[2] } };
  }
  if (method === "POST" && path === "tokens") return { operation: "create_api_token", args };
  if (method === "DELETE" && segments[0] === "tokens" && segments.length === 2) {
    return { operation: "revoke_api_token", args: { ...args, credentialId: segments[1] } };
  }

  notFound(path);
}

async function handleApiRequest({ request, context, params }: Route.LoaderArgs | Route.ActionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: API_HEADERS });
  }

  const startedAt = Date.now();
  const cfEnv = context.cloudflare?.env;
  const cloudflare = context.cloudflare;
  const ctx = cloudflare?.ctx;
  const waitUntil = ctx?.waitUntil ? ctx.waitUntil.bind(ctx) : undefined;

  const rateLimit = await enforceRateLimit({
    authorization: request.headers.get("Authorization"),
    ip: request.headers.get("CF-Connecting-IP"),
    tokenLimiter: cfEnv?.API_TOKEN_RATE_LIMITER,
    ipLimiter: cfEnv?.API_IP_RATE_LIMITER,
  });
  if (!rateLimit.allowed) {
    const response = rateLimitedResponse(rateLimit.retryAfterSeconds);
    for (const [k, v] of Object.entries(API_HEADERS)) {
      response.headers.set(k, v);
    }
    const operation = legacyOperationFromRequest(request, params["*"] ?? "");
    return observeLegacyApiResponse({
      request,
      context,
      response,
      startedAt,
      operation,
      routeTemplate: operation ? undefined : "/api/{unknown}",
      errorCode: "rate_limited",
      rateLimitScope: rateLimit.scope,
    });
  }

  let operation: string | undefined;
  let principal: ApiPrincipal | null = null;
  try {
    const url = new URL(request.url);
    const splat = params["*"] ?? "";
    const segments = splat.split("/").filter(Boolean).map(decodeURIComponent);
    const path = segments.join("/");

    if (!path) {
      operation = "root";
      const response = apiJson({
        ok: true,
        data: {
          app: "spoonjoy-v2",
          links: ["/api/health", "/api/search", "/api/recipes", "/api/cookbooks", "/api/shopping-list", "/api/tokens"],
        },
      });
      return observeLegacyApiResponse({ request, context, response, startedAt, operation });
    }

    if (request.method === "GET" && path === "tools") {
      operation = "tools";
      const response = apiJson({ ok: true, data: { operations: listSpoonjoyApiOperations() } });
      return observeLegacyApiResponse({ request, context, response, startedAt, operation });
    }

    const dispatch = request.method === "GET"
      ? dispatchGet(path, segments, url)
      : await dispatchMutation(request.method, path, segments, request);
    operation = dispatch.operation;

    const db = await getRequestDb(context);
    principal = await resolveApiPrincipal(db, request, context.cloudflare?.env, dispatch.operation);
    if (principal?.oauthResource) {
      throw new ApiAuthError("OAuth access token is bound to a protected resource and cannot call legacy /api routes.", 403);
    }

    const data = await callSpoonjoyApiOperation(
      dispatch.operation,
      dispatch.args,
      buildSpoonjoyApiContext({ db, principal, cloudflareEnv: cfEnv ?? null, waitUntil }),
    );
    const response = apiJson(
      { ok: true, data },
      200,
      SECRET_BEARING_OPERATIONS.has(dispatch.operation) ? TOKEN_RESPONSE_HEADERS : undefined,
    );
    return observeLegacyApiResponse({ request, context, response, startedAt, operation, principal });
  } catch (error) {
    // ApiAuthError and "Recipe/Cookbook not found"-style errors are intentional
    // client-visible failures — surface them at their proper status. Anything
    // else is an unexpected bug or infra failure: log it via PostHog (so prod
    // incidents aren't invisible) and respond 500 with a generic message rather
    // than leaking the raw error.
    if (error instanceof ApiAuthError) {
      const response = apiJson({ ok: false, error: { message: error.message, status: error.status } }, error.status);
      return observeLegacyApiResponse({
        request,
        context,
        response,
        startedAt,
        operation,
        principal,
        routeTemplate: error.status === 404 && !operation ? "/api/{unknown}" : undefined,
        errorCode: "api_auth_error",
      });
    }
    if (error instanceof RequestBodyTooLargeError) {
      const response = apiJson({ ok: false, error: { message: error.message, status: error.status } }, error.status);
      return observeLegacyApiResponse({
        request,
        context,
        response,
        startedAt,
        operation,
        principal,
        errorCode: "request_too_large",
      });
    }
    if (error instanceof Error && /not found/i.test(error.message)) {
      const response = apiJson({ ok: false, error: { message: error.message, status: 404 } }, 404);
      return observeLegacyApiResponse({
        request,
        context,
        response,
        startedAt,
        operation,
        principal,
        errorCode: "not_found",
      });
    }
    if (waitUntil && cfEnv) {
      const phConfig = resolvePostHogServerConfig(cfEnv);
      if (phConfig.enabled) {
        waitUntil(
          captureException(phConfig, {
            error,
            distinctId: "server",
            route: new URL(request.url).pathname,
            method: request.method,
          }),
        );
      }
    }
    const response = apiJson({ ok: false, error: { message: "Internal server error", status: 500 } }, 500);
    return observeLegacyApiResponse({
      request,
      context,
      response,
      startedAt,
      operation,
      principal,
      errorCode: "internal_error",
    });
  }
}

export async function loader(args: Route.LoaderArgs) {
  return handleApiRequest(args);
}

export async function action(args: Route.ActionArgs) {
  return handleApiRequest(args);
}
