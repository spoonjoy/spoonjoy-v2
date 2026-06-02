import { ApiAuthError, authenticateApiRequest, type ApiPrincipal } from "~/lib/api-auth.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { API_V1_DISCOVERY_DATA, API_V1_ERROR_STATUS, type ApiV1ErrorCode } from "~/lib/api-v1-contract.server";

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

function normalizeAuthError(error: ApiAuthError): ApiV1Error {
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
      throw normalizeAuthError(error);
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

    if (args.request.method !== "GET" && args.request.method !== "POST" && args.request.method !== "PATCH" && args.request.method !== "DELETE") {
      throw new ApiV1Error("method_not_allowed", "Method not allowed");
    }

    if (args.request.method !== "GET") {
      await parseApiV1JsonBody(args.request);
    }

    if (path === "health") {
      throw new ApiV1Error("method_not_allowed", "Method not allowed");
    }

    throw new ApiV1Error("not_found", `Unknown Spoonjoy API v1 endpoint: /api/v1/${path}`);
  } catch (error) {
    if (error instanceof ApiV1Error) {
      return apiV1ErrorResponse(requestId, error);
    }

    const fallback = error instanceof Error
      ? new ApiV1Error("internal_error", error.message)
      : new ApiV1Error("internal_error", "Internal error");
    return apiV1ErrorResponse(requestId, fallback);
  }
}
