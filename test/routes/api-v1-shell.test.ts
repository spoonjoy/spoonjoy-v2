import { describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import routes from "~/routes";
import { action, loader } from "~/routes/api.v1.$";
import { API_V1_ERROR_STATUS, API_V1_RESOURCES } from "~/lib/api-v1-contract.server";

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

    const invalidJson = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "req_bad_json" },
      body: "{",
    }) as unknown as Request, "tokens"));
    expect(invalidJson.status).toBe(400);
    expectV1Headers(invalidJson, "req_bad_json");
    await expect(readJson(invalidJson)).resolves.toMatchObject({
      ok: false,
      requestId: "req_bad_json",
      error: { code: "invalid_json", status: 400 },
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
});
