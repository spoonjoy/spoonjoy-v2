import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import { handleMcpHttpRequest } from "~/lib/mcp/http-mcp.server";
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

describe("handleMcpHttpRequest", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
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
    const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
    const { token } = await createApiCredential(db, user.id, "mcp connector");
    return token;
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
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});
