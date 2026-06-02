import { afterEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import routes from "~/routes";
import { action, loader } from "~/routes/api.v1.$";
import * as apiAuth from "~/lib/api-auth.server";
import { ApiAuthError, createApiCredential } from "~/lib/api-auth.server";
import {
  ApiV1Error,
  apiV1ErrorResponse,
  handleApiV1Request,
  normalizeApiV1AuthError,
  normalizeApiV1InternalError,
} from "~/lib/api-v1.server";
import { API_V1_ERROR_STATUS, API_V1_RESOURCES } from "~/lib/api-v1-contract.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

function routeArgs(request: Request, splat: string) {
  return { request, params: { "*": splat }, context: { cloudflare: { env: null } } } as any;
}

async function readJson(response: Response) {
  return await response.json() as any;
}

function expectV1Headers(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, DELETE, OPTIONS");
  expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id");
}

describe("/api/v1 shell", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("is registered before the legacy /api/* catch-all route", () => {
    const routePaths = JSON.stringify(routes);
    expect(routePaths.indexOf("api/v1/*")).toBeGreaterThanOrEqual(0);
    expect(routePaths.indexOf("routes/api.v1.$.ts")).toBeGreaterThanOrEqual(0);
    expect(routePaths.indexOf("api/v1/*")).toBeLessThan(routePaths.indexOf("api/*"));
  });

  it("serves the exact discovery envelope with request IDs and CORS headers", async () => {
    const response = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1", {
      headers: { "X-Request-Id": "req_test_root" },
    }) as unknown as Request, ""));

    expect(response.status).toBe(200);
    expectV1Headers(response, "req_test_root");
    await expect(readJson(response)).resolves.toEqual({
      ok: true,
      requestId: "req_test_root",
      data: {
        app: "spoonjoy",
        version: "v1",
        status: "ok",
        docsUrl: "https://spoonjoy.app/developers",
        openapiUrl: "/api/v1/openapi.json",
        resources: API_V1_RESOURCES,
        auth: {
          type: "bearer",
          tokenUrl: "/api/v1/tokens",
          oauth: { register: "/oauth/register", authorize: "/oauth/authorize", token: "/oauth/token" },
          mcp: {
            endpoint: "/mcp",
            startAgentConnection: "/api/tools/start_agent_connection",
            pollAgentConnection: "/api/tools/poll_agent_connection",
          },
        },
      },
    });
  });

  it("treats a missing splat param as the v1 root", async () => {
    const response = await handleApiV1Request({
      request: new UndiciRequest("http://localhost/api/v1", {
        headers: { "X-Request-Id": "req_missing_splat" },
      }) as unknown as Request,
      params: {} as { "*": string },
      context: { cloudflare: { env: null } },
    });

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: true,
      requestId: "req_missing_splat",
      data: { app: "spoonjoy", version: "v1" },
    });
  });

  it("serves anonymous health and generated request IDs", async () => {
    const response = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/health") as unknown as Request, "health"));
    const requestId = response.headers.get("X-Request-Id");

    expect(response.status).toBe(200);
    expect(requestId).toMatch(/^req_/);
    expectV1Headers(response, requestId as string);
    await expect(readJson(response)).resolves.toEqual({
      ok: true,
      requestId,
      data: {
        ok: true,
        version: "v1",
        authenticated: false,
        principal: null,
        scopes: [],
      },
    });
  });

  it("serves authenticated health with principal summary and scopes", async () => {
    const db = await getLocalDb();
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Health client", { scopes: ["kitchen:read"] });
    const response = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/health", {
      headers: { Authorization: `Bearer ${credential.token}`, "X-Request-Id": "req_health_auth" },
    }) as unknown as Request, "health"));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: true,
      requestId: "req_health_auth",
      data: {
        ok: true,
        version: "v1",
        authenticated: true,
        principal: { id: user.id, username: user.username, source: "bearer" },
        scopes: ["cookbooks:read", "public:read", "recipes:read", "shopping_list:read", "tokens:read"],
      },
    });
  });

  it("returns the v1 error envelope and Retry-After when the rate limiter denies a request before auth", async () => {
    const response = await loader({
      request: new UndiciRequest("http://localhost/api/v1/health", {
        headers: {
          Authorization: "Bearer sj_throttled_token",
          "X-Request-Id": "req_rate_limited",
        },
      }) as unknown as Request,
      params: { "*": "health" },
      context: {
        cloudflare: {
          env: {
            API_TOKEN_RATE_LIMITER: {
              limit: async ({ key }: { key: string }) => {
                expect(key).toMatch(/^token:[a-f0-9]{64}$/);
                return { success: false };
              },
            },
          },
        },
      },
    } as any);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expectV1Headers(response, "req_rate_limited");
    await expect(readJson(response)).resolves.toEqual({
      ok: false,
      requestId: "req_rate_limited",
      error: {
        code: "rate_limited",
        message: "Too many requests. Try again later.",
        status: 429,
        details: { retryAfterSeconds: 60 },
      },
    });
  });

  it("returns invalid_token for optional-auth routes when a bad bearer is present", async () => {
    for (const [path, splat] of [
      ["/api/v1", ""],
      ["/api/v1/health", "health"],
      ["/api/v1/openapi.json", "openapi.json"],
    ]) {
      const response = await loader(routeArgs(new UndiciRequest(`http://localhost${path}`, {
        headers: { Authorization: "Bearer sj_missing", "X-Request-Id": `req_${splat || "root"}` },
      }) as unknown as Request, splat));

      expect(response.status).toBe(401);
      expectV1Headers(response, `req_${splat || "root"}`);
      await expect(readJson(response)).resolves.toEqual({
        ok: false,
        requestId: `req_${splat || "root"}`,
        error: {
          code: "invalid_token",
          message: "Invalid API token",
          status: 401,
        },
      });
    }
  });

  it("normalizes unexpected optional-auth failures to internal_error", async () => {
    vi.spyOn(apiAuth, "authenticateApiRequest").mockRejectedValueOnce(new Error("auth storage unavailable"));

    const response = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/health", {
      headers: {
        Authorization: "Bearer sj_storage_failure",
        "X-Request-Id": "req_auth_storage_failure",
      },
    }) as unknown as Request, "health"));

    expect(response.status).toBe(500);
    expectV1Headers(response, "req_auth_storage_failure");
    await expect(readJson(response)).resolves.toEqual({
      ok: false,
      requestId: "req_auth_storage_failure",
      error: {
        code: "internal_error",
        message: "auth storage unavailable",
        status: 500,
      },
    });
  });

  it("serves the OpenAPI shell document", async () => {
    const response = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/openapi.json", {
      headers: { "X-Request-Id": "req_openapi" },
    }) as unknown as Request, "openapi.json"));

    expect(response.status).toBe(200);
    expectV1Headers(response, "req_openapi");
    await expect(readJson(response)).resolves.toMatchObject({
      openapi: "3.1.0",
      info: { title: "Spoonjoy API", version: "v1" },
      paths: expect.objectContaining({ "/api/v1/openapi.json": expect.any(Object) }),
    });
  });

  it("handles CORS preflight for any v1 path", async () => {
    const response = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/recipes", {
      method: "OPTIONS",
      headers: { "X-Request-Id": "req_options" },
    }) as unknown as Request, "recipes"));

    expect(response.status).toBe(204);
    expect(response.headers.get("X-Request-Id")).toBe("req_options");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, DELETE, OPTIONS");
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id");
    expect(response.headers.has("Content-Type")).toBe(false);
    expect(await response.text()).toBe("");
  });

  it("returns stable envelopes for unknown endpoints, unsupported methods, and malformed JSON", async () => {
    const unknown = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/nope", {
      headers: { "X-Request-Id": "req_unknown" },
    }) as unknown as Request, "nope"));
    expect(unknown.status).toBe(404);
    expectV1Headers(unknown, "req_unknown");
    await expect(readJson(unknown)).resolves.toMatchObject({
      ok: false,
      requestId: "req_unknown",
      error: { code: "not_found", status: 404 },
    });

    const unknownMutation = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/nope", {
      method: "POST",
      headers: { "X-Request-Id": "req_unknown_mutation" },
    }) as unknown as Request, "nope"));
    expect(unknownMutation.status).toBe(404);
    expectV1Headers(unknownMutation, "req_unknown_mutation");
    await expect(readJson(unknownMutation)).resolves.toMatchObject({
      ok: false,
      requestId: "req_unknown_mutation",
      error: { code: "not_found", status: 404 },
    });

    const method = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/health", {
      method: "DELETE",
      headers: { "X-Request-Id": "req_method" },
    }) as unknown as Request, "health"));
    expect(method.status).toBe(405);
    expectV1Headers(method, "req_method");
    await expect(readJson(method)).resolves.toMatchObject({
      ok: false,
      requestId: "req_method",
      error: { code: "method_not_allowed", status: 405 },
    });

    const unsupported = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/recipes", {
      method: "PUT",
      headers: { "X-Request-Id": "req_put" },
    }) as unknown as Request, "recipes"));
    expect(unsupported.status).toBe(405);
    await expect(readJson(unsupported)).resolves.toMatchObject({
      ok: false,
      requestId: "req_put",
      error: { code: "method_not_allowed", status: 405 },
    });

    const unsupportedKnownPath = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/recipes", {
      method: "POST",
      headers: { "X-Request-Id": "req_post_recipes" },
    }) as unknown as Request, "recipes"));
    expect(unsupportedKnownPath.status).toBe(405);
    await expect(readJson(unsupportedKnownPath)).resolves.toMatchObject({
      ok: false,
      requestId: "req_post_recipes",
      error: { code: "method_not_allowed", status: 405 },
    });

    const unsupportedKnownTemplate = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens/cred_1", {
      headers: { "X-Request-Id": "req_get_token_detail" },
    }) as unknown as Request, "tokens/cred_1"));
    expect(unsupportedKnownTemplate.status).toBe(405);
    await expect(readJson(unsupportedKnownTemplate)).resolves.toMatchObject({
      ok: false,
      requestId: "req_get_token_detail",
      error: { code: "method_not_allowed", status: 405 },
    });

    const invalidJson = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "req_bad_json" },
      body: "{",
    }) as unknown as Request, "tokens"));
    expect(invalidJson.status).toBe(401);
    expectV1Headers(invalidJson, "req_bad_json");
    await expect(readJson(invalidJson)).resolves.toMatchObject({
      ok: false,
      requestId: "req_bad_json",
      error: { code: "authentication_required", status: 401 },
    });

    const validJson = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "req_valid_json" },
      body: JSON.stringify({ name: "Client" }),
    }) as unknown as Request, "tokens"));
    expect(validJson.status).toBe(401);
    await expect(readJson(validJson)).resolves.toMatchObject({
      ok: false,
      requestId: "req_valid_json",
      error: { code: "authentication_required", status: 401 },
    });

    const primitiveJson = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "req_primitive_json" },
      body: JSON.stringify("token"),
    }) as unknown as Request, "tokens"));
    expect(primitiveJson.status).toBe(401);
    await expect(readJson(primitiveJson)).resolves.toMatchObject({
      ok: false,
      requestId: "req_primitive_json",
      error: { code: "authentication_required", status: 401 },
    });

    const emptyJson = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "req_empty_json" },
      body: "   ",
    }) as unknown as Request, "tokens"));
    expect(emptyJson.status).toBe(401);
    await expect(readJson(emptyJson)).resolves.toMatchObject({
      ok: false,
      requestId: "req_empty_json",
      error: { code: "authentication_required", status: 401 },
    });
  });

  it("exports the full v1 error status map", () => {
    expect(API_V1_ERROR_STATUS).toEqual({
      invalid_json: 400,
      validation_error: 400,
      invalid_cursor: 400,
      invalid_scope: 400,
      authentication_required: 401,
      invalid_token: 401,
      insufficient_scope: 403,
      not_found: 404,
      method_not_allowed: 405,
      idempotency_conflict: 409,
      rate_limited: 429,
      internal_error: 500,
    });
  });

  it("serializes error details and internal fallback errors", async () => {
    const detailed = apiV1ErrorResponse("req_details", new ApiV1Error("validation_error", "Bad fields", {
      name: ["Required"],
    }));
    await expect(readJson(detailed)).resolves.toEqual({
      ok: false,
      requestId: "req_details",
      error: {
        code: "validation_error",
        message: "Bad fields",
        status: 400,
        details: { name: ["Required"] },
      },
    });

    expect(normalizeApiV1AuthError(new ApiAuthError("Malformed Authorization header", 400))).toMatchObject({
      code: "validation_error",
      status: 400,
      message: "Malformed Authorization header",
    });
    expect(normalizeApiV1AuthError(new ApiAuthError("Missing scope", 403))).toMatchObject({
      code: "insufficient_scope",
      status: 403,
      message: "Missing scope",
    });
    expect(normalizeApiV1AuthError(new ApiAuthError("Authentication required", 401))).toMatchObject({
      code: "authentication_required",
      status: 401,
      message: "Authentication required",
    });
    expect(normalizeApiV1InternalError(new Error("Exploded"))).toMatchObject({
      code: "internal_error",
      status: 500,
      message: "Exploded",
    });
    expect(normalizeApiV1InternalError("surprise")).toMatchObject({
      code: "internal_error",
      status: 500,
      message: "Internal error",
    });
  });

  it("normalizes unexpected optional-auth failures into internal errors", async () => {
    let cloudflareReads = 0;
    const context = {
      get cloudflare() {
        cloudflareReads += 1;
        if (cloudflareReads > 1) {
          throw new Error("Platform env unavailable");
        }
        return { env: null };
      },
    };

    const response = await handleApiV1Request({
      request: new UndiciRequest("http://localhost/api/v1/health", {
        headers: { "X-Request-Id": "req_platform_error" },
      }) as unknown as Request,
      params: { "*": "health" },
      context,
    });

    expect(response.status).toBe(500);
    expectV1Headers(response, "req_platform_error");
    await expect(readJson(response)).resolves.toMatchObject({
      ok: false,
      requestId: "req_platform_error",
      error: {
        code: "internal_error",
        message: "Platform env unavailable",
        status: 500,
      },
    });
  });
});
