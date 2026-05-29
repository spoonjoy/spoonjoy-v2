import type { Route } from "./+types/api.$";
import { ApiAuthError } from "~/lib/api-auth.server";
import { enforceRateLimit, rateLimitedResponse } from "~/lib/rate-limit.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { callSpoonjoyApiOperation, listSpoonjoyApiOperations } from "~/lib/spoonjoy-api.server";
import { buildSpoonjoyApiContext, resolveApiPrincipal } from "~/lib/spoonjoy-api-request.server";
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";

const API_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const NUMERIC_QUERY_KEYS = new Set(["duration", "limit", "quantity"]);
const BOOLEAN_QUERY_KEYS = new Set(["checked"]);

type ApiDispatch = {
  operation: string;
  args: Record<string, unknown>;
};

function apiJson(payload: unknown, status = 200): Response {
  return Response.json(payload, { status, headers: API_HEADERS });
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

async function bodyArgs(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("Content-Length") === "0") return {};

  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) return {};
  const text = await request.text();
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

function dispatchGet(path: string, segments: string[], url: URL): ApiDispatch | null {
  const args = queryArgs(url);

  if (path === "health") return { operation: "health", args };
  if (path === "tools") return null;
  if (path === "search") return { operation: "search_spoonjoy", args };
  if (path === "recipes") return { operation: "search_recipes", args };
  if (segments[0] === "recipes" && segments.length === 2) {
    return { operation: "get_recipe", args: { ...args, id: segments[1] } };
  }
  if (path === "cookbooks") return { operation: "list_cookbooks", args };
  if (segments[0] === "cookbooks" && segments.length === 2) {
    return { operation: "get_cookbook", args: { ...args, cookbookId: segments[1] } };
  }
  if (path === "shopping-list") return { operation: "get_shopping_list", args };
  if (path === "shopping-list/search") return { operation: "search_shopping_list", args };
  if (path === "tokens") return { operation: "list_api_tokens", args };

  notFound(path);
}

async function dispatchMutation(method: string, path: string, segments: string[], request: Request): Promise<ApiDispatch> {
  const args = await bodyArgs(request);

  if (method === "POST" && segments[0] === "tools" && segments.length === 2) {
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
    return response;
  }

  try {
    const url = new URL(request.url);
    const splat = params["*"] ?? "";
    const segments = splat.split("/").filter(Boolean).map(decodeURIComponent);
    const path = segments.join("/");

    if (!path) {
      return apiJson({
        ok: true,
        data: {
          app: "spoonjoy-v2",
          links: ["/api/health", "/api/search", "/api/recipes", "/api/cookbooks", "/api/shopping-list", "/api/tokens"],
        },
      });
    }

    if (request.method === "GET" && path === "tools") {
      return apiJson({ ok: true, data: { operations: listSpoonjoyApiOperations() } });
    }

    const dispatch = request.method === "GET"
      ? dispatchGet(path, segments, url)
      : await dispatchMutation(request.method, path, segments, request);

    if (!dispatch) notFound(path);

    const db = await getRequestDb(context);
    const principal = await resolveApiPrincipal(db, request, context.cloudflare?.env, dispatch.operation);

    const data = await callSpoonjoyApiOperation(
      dispatch.operation,
      dispatch.args,
      buildSpoonjoyApiContext({ db, principal, cloudflareEnv: cfEnv ?? null, waitUntil }),
    );
    return apiJson({ ok: true, data });
  } catch (error) {
    // ApiAuthError and "Recipe/Cookbook not found"-style errors are intentional
    // client-visible failures — surface them at their proper status. Anything
    // else is an unexpected bug or infra failure: log it via PostHog (so prod
    // incidents aren't invisible) and respond 500 with a generic message rather
    // than leaking the raw error.
    if (error instanceof ApiAuthError) {
      return apiJson({ ok: false, error: { message: error.message, status: error.status } }, error.status);
    }
    if (error instanceof Error && /not found/i.test(error.message)) {
      return apiJson({ ok: false, error: { message: error.message, status: 404 } }, 404);
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
    return apiJson({ ok: false, error: { message: "Internal server error", status: 500 } }, 500);
  }
}

export async function loader(args: Route.LoaderArgs) {
  return handleApiRequest(args);
}

export async function action(args: Route.ActionArgs) {
  return handleApiRequest(args);
}
