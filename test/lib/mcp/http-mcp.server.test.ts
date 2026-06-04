import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureEvent: vi.fn(async () => undefined),
  captureException: vi.fn(async () => undefined),
}));

import { handleMcpHttpRequest, jsonRpcErrorCode, mcpJsonRpcTelemetry } from "~/lib/mcp/http-mcp.server";
import { captureEvent, captureException } from "~/lib/analytics-server";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../../helpers/cleanup";

function uniqueEmail(prefix = "mcp") {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

function rpcRequest(body: unknown, headers: Record<string, string> = {}) {
  return new UndiciRequest("https://spoonjoy.app/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as Request;
}

const init = (id: number, method: string, params?: unknown) => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params === undefined ? {} : { params }),
});

function mcpTelemetryInputs() {
  return vi.mocked(captureEvent).mock.calls.map(([, input]) => input);
}

function expectMcpTelemetryEvent(input: {
  status: number;
  errorCode?: string;
  authMode: "anonymous" | "bearer" | "oauth_bearer";
  method?: string;
  jsonRpcMethod?: string;
  toolName?: string;
  notification?: boolean;
  jsonRpcErrorCode?: number;
  rateLimitScope?: string;
  forbidden?: readonly string[];
}) {
  const eventInput = mcpTelemetryInputs().find((candidate) => (
    candidate.event === "spoonjoy.mcp.request" &&
    candidate.properties?.status === input.status &&
    (
      input.errorCode === undefined
        ? candidate.properties?.error_code === undefined
        : candidate.properties?.error_code === input.errorCode
    ) &&
    candidate.properties?.auth_mode === input.authMode &&
    (input.jsonRpcMethod ? candidate.properties?.jsonrpc_method === input.jsonRpcMethod : true) &&
    (input.toolName ? candidate.properties?.tool_name === input.toolName : true) &&
    (input.rateLimitScope ? candidate.properties?.rate_limit_scope === input.rateLimitScope : true)
  ));

  expect(eventInput).toMatchObject({
    event: "spoonjoy.mcp.request",
    properties: {
      route_template: "/mcp",
      method: input.method ?? "POST",
      status: input.status,
      error_code: input.errorCode,
      auth_mode: input.authMode,
      request_bytes: expect.any(Number),
      latency_ms: expect.any(Number),
    },
  });

  const properties = eventInput!.properties as Record<string, unknown>;
  if (input.notification !== undefined) {
    expect(properties.notification).toBe(input.notification);
  }
  if (input.jsonRpcErrorCode !== undefined) {
    expect(properties.jsonrpc_error_code).toBe(input.jsonRpcErrorCode);
  }
  if (input.rateLimitScope) {
    expect(properties.rate_limit_scope).toBe(input.rateLimitScope);
  } else {
    expect(properties.rate_limit_scope).toBeUndefined();
  }

  const serialized = JSON.stringify(eventInput);
  for (const forbidden of input.forbidden ?? []) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(serialized).not.toContain("Authorization");
  expect(serialized).not.toContain("Bearer ");
  return eventInput;
}

describe("handleMcpHttpRequest", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    await cleanupDatabase();
    db = await getLocalDb();
  });
  afterEach(async () => {
    await cleanupDatabase();
  });

  it("rejects non-POST with 405", async () => {
    const request = new UndiciRequest("https://spoonjoy.app/mcp", { method: "GET" }) as unknown as Request;
    const response = await handleMcpHttpRequest({ request, db });
    expect(response.status).toBe(405);
  });

  async function mintToken(): Promise<string> {
    return (await mintCredential()).token;
  }

  async function mintCredential(options: Parameters<typeof createApiCredential>[3] = {}) {
    const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
    const created = await createApiCredential(db, user.id, "mcp connector", options);
    return { user, token: created.token, credential: created.credential };
  }

  async function mintOAuthCredential(options: { oauthResource?: string | null } = {}) {
    const user = await db.user.create({ data: { email: uniqueEmail("oauth-mcp"), username: faker.internet.username() } });
    const created = await createApiCredential(db, user.id, "oauth mcp token", {
      scopes: ["kitchen:read", "kitchen:write"],
      oauthClientId: "oauth_client_1",
      oauthResource: options.oauthResource ?? null,
    });
    return { user, token: created.token, credential: created.credential };
  }

  async function mintOAuthToken(options: { oauthResource?: string | null } = {}): Promise<string> {
    return (await mintOAuthCredential(options)).token;
  }

  function bearer(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  it("challenges an unauthenticated initialize with 401 + WWW-Authenticate", async () => {
    // The cue an OAuth client uses to start login + consent before connecting.
    const response = await handleMcpHttpRequest({
      request: rpcRequest(init(1, "initialize", { protocolVersion: "2025-06-18" })),
      db,
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      'resource_metadata="https://spoonjoy.app/.well-known/oauth-protected-resource"',
    );
  });

  it("challenges any unauthenticated request (tools/list)", async () => {
    const response = await handleMcpHttpRequest({ request: rpcRequest(init(2, "tools/list")), db });
    expect(response.status).toBe(401);
  });

  it("challenges a request carrying an invalid token", async () => {
    const response = await handleMcpHttpRequest({
      request: rpcRequest(init(3, "tools/list"), { Authorization: "Bearer sj_not_a_real_token" }),
      db,
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("points the challenge at SPOONJOY_BASE_URL, not the worker's own host", async () => {
    const request = new UndiciRequest("https://spoonjoy-v2.mendelow-studio.workers.dev/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(init(4, "initialize", {})),
    }) as unknown as Request;
    const response = await handleMcpHttpRequest({
      request,
      db,
      cloudflareEnv: { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      'resource_metadata="https://spoonjoy.app/.well-known/oauth-protected-resource"',
    );
  });

  it("negotiates protocol version on an authenticated initialize", async () => {
    const response = await handleMcpHttpRequest({
      request: rpcRequest(init(1, "initialize", { protocolVersion: "2025-06-18" }), bearer(await mintToken())),
      db,
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.serverInfo.name).toBe("spoonjoy");
  });

  it("lists tools for an authenticated request", async () => {
    const response = await handleMcpHttpRequest({
      request: rpcRequest(init(2, "tools/list"), bearer(await mintToken())),
      db,
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      result: { tools: { name: string; title?: string; annotations?: { readOnlyHint?: boolean } }[] };
    };
    const names = body.result.tools.map((t) => t.name);
    expect(names).toContain("search_spoonjoy");
    expect(names).toContain("get_shopping_list");
    // Annotations must reach the wire — directories read them from tools/list.
    const getShoppingList = body.result.tools.find((t) => t.name === "get_shopping_list");
    expect(getShoppingList?.title).toBe("Get shopping list");
    expect(getShoppingList?.annotations?.readOnlyHint).toBe(true);
  });

  it("acks an authenticated notification with 202 and no body", async () => {
    const request = rpcRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, bearer(await mintToken()));
    const response = await handleMcpHttpRequest({ request, db });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("dispatches a protected tool/call with a valid bearer token", async () => {
    const response = await handleMcpHttpRequest({
      request: rpcRequest(init(5, "tools/call", { name: "get_shopping_list", arguments: {} }), bearer(await mintToken())),
      db,
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { content: { text: string }[] } };
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload).toHaveProperty("shoppingList");
  });

  it("rejects OAuth tokens that are not audience-bound to the MCP resource", async () => {
    const response = await handleMcpHttpRequest({
      request: rpcRequest(init(6, "tools/list"), bearer(await mintOAuthToken({ oauthResource: null }))),
      db,
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_token",
      message: "OAuth access token is not audience-bound to this MCP resource.",
    });
  });

  it("returns a JSON-RPC parse error for an invalid (authenticated) body", async () => {
    const response = await handleMcpHttpRequest({
      request: rpcRequest("{ not json", bearer(await mintToken())),
      db,
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32700);
  });

  it("returns 429 when the rate limiter denies the request", async () => {
    const denyingLimiter = { limit: async () => ({ success: false }) };
    const response = await handleMcpHttpRequest({
      request: rpcRequest(init(6, "tools/list"), { Authorization: "Bearer sj_whatever" }),
      db,
      tokenLimiter: denyingLimiter,
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
  });

  it("rate-limits anonymous requests by IP", async () => {
    const denyingLimiter = { limit: async () => ({ success: false }) };
    const request = new UndiciRequest("https://spoonjoy.app/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
      body: JSON.stringify(init(7, "tools/list")),
    }) as unknown as Request;
    const response = await handleMcpHttpRequest({ request, db, ipLimiter: denyingLimiter });
    expect(response.status).toBe(429);
  });

  it("captures safe MCP telemetry for auth failures, wrong-resource tokens, and rate limits", async () => {
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      void promise;
    });
    const cloudflareEnv = { POSTHOG_KEY: "ph_test", SPOONJOY_BASE_URL: "https://spoonjoy.app" };

    const methodResponse = await handleMcpHttpRequest({
      request: new UndiciRequest("https://spoonjoy.app/mcp", { method: "GET" }) as unknown as Request,
      db,
      cloudflareEnv,
      waitUntil,
    });
    expect(methodResponse.status).toBe(405);
    expectMcpTelemetryEvent({
      status: 405,
      errorCode: "method_not_allowed",
      authMode: "anonymous",
      method: "GET",
    });

    const bodySecret = "raw-mcp-argument-secret";
    const unauthenticatedResponse = await handleMcpHttpRequest({
      request: rpcRequest(init(41, "tools/call", {
        name: "get_recipe",
        arguments: { id: bodySecret },
      })),
      db,
      cloudflareEnv,
      waitUntil,
    });
    expect(unauthenticatedResponse.status).toBe(401);
    expectMcpTelemetryEvent({
      status: 401,
      errorCode: "authentication_required",
      authMode: "anonymous",
      forbidden: [bodySecret, "tools/call", "get_recipe"],
    });

    const malformedToken = "sj_malformed_mcp_secret";
    const malformedResponse = await handleMcpHttpRequest({
      request: rpcRequest(init(42, "tools/list"), { Authorization: `Bearer ${malformedToken} extra` }),
      db,
      cloudflareEnv,
      waitUntil,
    });
    expect(malformedResponse.status).toBe(401);
    expectMcpTelemetryEvent({
      status: 401,
      errorCode: "malformed_authorization",
      authMode: "anonymous",
      forbidden: [malformedToken, "tools/list"],
    });

    const invalidToken = "sj_invalid_mcp_secret";
    const invalidResponse = await handleMcpHttpRequest({
      request: rpcRequest(init(43, "tools/list"), { Authorization: `Bearer ${invalidToken}` }),
      db,
      cloudflareEnv,
      waitUntil,
    });
    expect(invalidResponse.status).toBe(401);
    expectMcpTelemetryEvent({
      status: 401,
      errorCode: "invalid_token",
      authMode: "anonymous",
      forbidden: [invalidToken, "tools/list"],
    });

    const wrongResourceToken = await mintOAuthToken({ oauthResource: null });
    const wrongResourceResponse = await handleMcpHttpRequest({
      request: rpcRequest(init(44, "tools/list"), bearer(wrongResourceToken)),
      db,
      cloudflareEnv,
      waitUntil,
    });
    expect(wrongResourceResponse.status).toBe(403);
    const wrongResourceEvent = expectMcpTelemetryEvent({
      status: 403,
      errorCode: "invalid_token",
      authMode: "oauth_bearer",
      forbidden: [wrongResourceToken, "tools/list"],
    });
    expect(wrongResourceEvent!.properties).toMatchObject({
      oauth_client_id: "oauth_client_1",
      oauth_resource: null,
    });

    const rateLimitedToken = "sj_rate_limited_mcp_secret";
    const denyingLimiter = {
      limit: async ({ key }: { key: string }) => {
        expect(key).toMatch(/^token:[a-f0-9]{64}$/);
        return { success: false };
      },
    };
    const rateLimitedResponse = await handleMcpHttpRequest({
      request: rpcRequest(init(45, "tools/list"), {
        Authorization: `Bearer ${rateLimitedToken}`,
        "CF-Connecting-IP": "203.0.113.55",
      }),
      db,
      cloudflareEnv,
      waitUntil,
      tokenLimiter: denyingLimiter,
    });
    expect(rateLimitedResponse.status).toBe(429);
    expectMcpTelemetryEvent({
      status: 429,
      errorCode: "rate_limited",
      authMode: "anonymous",
      rateLimitScope: "token",
      forbidden: [rateLimitedToken, "203.0.113.55", "tools/list"],
    });
  });

  it("captures safe MCP success metadata for tools/list and tools/call", async () => {
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      void promise;
    });
    const cloudflareEnv = { POSTHOG_KEY: "ph_test", SPOONJOY_BASE_URL: "https://spoonjoy.app" };

    const personal = await mintCredential({ scopes: ["kitchen:read", "kitchen:write"] });
    const listResponse = await handleMcpHttpRequest({
      request: rpcRequest(init(46, "tools/list"), bearer(personal.token)),
      db,
      cloudflareEnv,
      waitUntil,
    });
    expect(listResponse.status).toBe(200);
    const listEvent = expectMcpTelemetryEvent({
      status: 200,
      authMode: "bearer",
      forbidden: [
        personal.token,
        personal.credential.tokenPrefix,
        personal.user.email,
        personal.user.username,
      ],
    });
    expect(listEvent!.distinctId).toBe(personal.user.id);
    expect(listEvent!.properties).toMatchObject({
      principal_id: personal.user.id,
      credential_id: personal.credential.id,
      jsonrpc_method: "tools/list",
    });
    expect((listEvent!.properties as Record<string, unknown>).tool_name).toBeUndefined();

    const oauth = await mintOAuthCredential({ oauthResource: "https://spoonjoy.app/mcp" });
    const rawArgument = "raw-mcp-tool-argument-secret";
    const callResponse = await handleMcpHttpRequest({
      request: rpcRequest(init(47, "tools/call", {
        name: "search_spoonjoy",
        arguments: { query: rawArgument },
      }), bearer(oauth.token)),
      db,
      cloudflareEnv,
      waitUntil,
    });
    expect(callResponse.status).toBe(200);
    const callEvent = expectMcpTelemetryEvent({
      status: 200,
      authMode: "oauth_bearer",
      forbidden: [
        oauth.token,
        oauth.credential.tokenPrefix,
        oauth.user.email,
        oauth.user.username,
        rawArgument,
      ],
    });
    expect(callEvent!.distinctId).toBe(oauth.user.id);
    expect(callEvent!.properties).toMatchObject({
      principal_id: oauth.user.id,
      credential_id: oauth.credential.id,
      oauth_client_id: "oauth_client_1",
      oauth_resource: "https://spoonjoy.app/mcp",
      jsonrpc_method: "tools/call",
      tool_name: "search_spoonjoy",
    });
  });

  it("captures safe MCP notification and JSON-RPC error telemetry while preserving exception capture", async () => {
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      void promise;
    });
    const cloudflareEnv = { POSTHOG_KEY: "ph_test", SPOONJOY_BASE_URL: "https://spoonjoy.app" };
    const personal = await mintCredential({ scopes: ["kitchen:read", "kitchen:write"] });

    const notificationResponse = await handleMcpHttpRequest({
      request: rpcRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, bearer(personal.token)),
      db,
      cloudflareEnv,
      waitUntil,
    });
    expect(notificationResponse.status).toBe(202);
    expectMcpTelemetryEvent({
      status: 202,
      authMode: "bearer",
      jsonRpcMethod: "notifications/initialized",
      notification: true,
      forbidden: [personal.token, personal.credential.tokenPrefix, personal.user.email, personal.user.username],
    });

    const parseSecret = "raw-parse-error-secret";
    const parseResponse = await handleMcpHttpRequest({
      request: rpcRequest(
        `{"jsonrpc":"2.0","id":51,"method":"tools/call","params":{"name":"get_recipe","arguments":{"id":"${parseSecret}"}`,
        bearer(personal.token),
      ),
      db,
      cloudflareEnv,
      waitUntil,
    });
    expect(parseResponse.status).toBe(200);
    const parseBody = await parseResponse.json() as { error: { code: number } };
    expect(parseBody.error.code).toBe(-32700);
    expectMcpTelemetryEvent({
      status: 200,
      errorCode: "jsonrpc_error",
      authMode: "bearer",
      jsonRpcErrorCode: -32700,
      forbidden: [parseSecret, "tools/call", "get_recipe"],
    });

    const unknownToolSecret = "raw-unknown-tool-secret";
    const unknownToolResponse = await handleMcpHttpRequest({
      request: rpcRequest(init(52, "tools/call", {
        name: "no_such_op",
        arguments: { id: unknownToolSecret },
      }), bearer(personal.token)),
      db,
      cloudflareEnv,
      waitUntil,
    });
    expect(unknownToolResponse.status).toBe(200);
    const unknownToolBody = await unknownToolResponse.json() as { error: { code: number; message: string } };
    expect(unknownToolBody.error.code).toBe(-32602);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, key: "ph_test" }),
      expect.objectContaining({
        distinctId: personal.user.id,
        error: expect.any(Error),
        route: "/mcp",
        method: "POST",
      }),
    );
    expectMcpTelemetryEvent({
      status: 200,
      errorCode: "jsonrpc_error",
      authMode: "bearer",
      jsonRpcMethod: "tools/call",
      jsonRpcErrorCode: -32602,
      forbidden: [
        personal.token,
        personal.credential.tokenPrefix,
        personal.user.email,
        personal.user.username,
        unknownToolSecret,
        "no_such_op",
        unknownToolBody.error.message,
      ],
    });
    expect(JSON.stringify(mcpTelemetryInputs())).not.toContain("No such tool");
  });

  it("normalizes MCP JSON-RPC telemetry helper edge cases without leaking unknown values", () => {
    expect(mcpJsonRpcTelemetry("not json")).toEqual({});
    expect(mcpJsonRpcTelemetry("[]")).toEqual({});
    expect(mcpJsonRpcTelemetry(JSON.stringify({ jsonrpc: "2.0", id: 61, method: 42 }))).toEqual({});
    expect(mcpJsonRpcTelemetry(JSON.stringify({ jsonrpc: "2.0", id: 62, method: "resources/read" }))).toEqual({});
    expect(mcpJsonRpcTelemetry(JSON.stringify({
      jsonrpc: "2.0",
      id: 63,
      method: "tools/call",
      params: { name: "raw_secret_tool_name" },
    }))).toEqual({ jsonRpcMethod: "tools/call", toolName: undefined });

    expect(jsonRpcErrorCode(null)).toBeUndefined();
    expect(jsonRpcErrorCode({ error: null })).toBeUndefined();
    expect(jsonRpcErrorCode({ error: { code: "raw-error-code" } })).toBeUndefined();
    expect(jsonRpcErrorCode({ error: { code: -32000 } })).toBe(-32000);
  });

  // A tools/call with an unknown operation name throws from the API layer →
  // handleJsonRpcMessage catches it and routes through `onError` before
  // collapsing to a JSON-RPC failure. These tests cover each branch of the
  // PostHog capture path wired through `onError`.
  function badToolCall(token: string) {
    return rpcRequest(
      init(8, "tools/call", { name: "no_such_op", arguments: {} }),
      bearer(token),
    );
  }

  it("returns a JSON-RPC failure and skips capture when waitUntil is missing", async () => {
    const response = await handleMcpHttpRequest({ request: badToolCall(await mintToken()), db });
    expect(response.status).toBe(200);
    const body = await response.json() as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toMatch(/no_such_op/);
  });

  it("skips PostHog capture when cloudflareEnv is missing but waitUntil is set", async () => {
    const waitUntil = vi.fn();
    await handleMcpHttpRequest({ request: badToolCall(await mintToken()), db, waitUntil });
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("skips PostHog capture when env is set but POSTHOG_KEY is not configured", async () => {
    const waitUntil = vi.fn();
    await handleMcpHttpRequest({
      request: badToolCall(await mintToken()),
      db,
      cloudflareEnv: {}, // no POSTHOG_KEY → resolvePostHogServerConfig returns enabled=false
      waitUntil,
    });
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("captures the raw exception via waitUntil when PostHog is configured", async () => {
    const waitUntil = vi.fn();
    await handleMcpHttpRequest({
      request: badToolCall(await mintToken()),
      db,
      cloudflareEnv: { POSTHOG_KEY: "phc_test" },
      waitUntil,
    });
    expect(waitUntil.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, key: "phc_test" }),
      expect.objectContaining({
        distinctId: expect.any(String),
        error: expect.any(Error),
        route: "/mcp",
        method: "POST",
      }),
    );
    expect(captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, key: "phc_test" }),
      expect.objectContaining({
        event: "spoonjoy.mcp.request",
        properties: expect.objectContaining({
          route_template: "/mcp",
          status: 200,
          error_code: "jsonrpc_error",
          jsonrpc_method: "tools/call",
          jsonrpc_error_code: -32602,
        }),
      }),
    );
  });
});
