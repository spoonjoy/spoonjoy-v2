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

  it("returns 202 with empty body for notifications", async () => {
    const response = await handleMcpHttpRequest({
      request: rpcRequest({ jsonrpc: "2.0", method: "notifications/initialized" }),
      db,
    });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("handles initialize without auth and negotiates protocol version", async () => {
    const response = await handleMcpHttpRequest({
      request: rpcRequest(init(1, "initialize", { protocolVersion: "2025-06-18" })),
      db,
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.serverInfo.name).toBe("spoonjoy");
  });

  it("lists tools without auth (discovery)", async () => {
    const response = await handleMcpHttpRequest({
      request: rpcRequest(init(2, "tools/list")),
      db,
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { tools: { name: string }[] } };
    const names = body.result.tools.map((t) => t.name);
    expect(names).toContain("search_spoonjoy");
    expect(names).toContain("get_shopping_list");
  });

  it("allows a public bootstrap tool/call without auth", async () => {
    const response = await handleMcpHttpRequest({
      request: rpcRequest(init(3, "tools/call", { name: "health", arguments: {} })),
      db,
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { content: { type: string; text: string }[] } };
    expect(body.result.content[0].type).toBe("text");
    expect(JSON.parse(body.result.content[0].text)).toMatchObject({ ok: true });
  });

  it("challenges a protected tool/call without auth (401 + WWW-Authenticate)", async () => {
    const response = await handleMcpHttpRequest({
      request: rpcRequest(init(4, "tools/call", { name: "get_shopping_list", arguments: {} })),
      db,
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      'resource_metadata="https://spoonjoy.app/.well-known/oauth-protected-resource"',
    );
  });

  it("challenges a protected tool/call carrying an invalid token", async () => {
    const response = await handleMcpHttpRequest({
      request: rpcRequest(init(4, "tools/call", { name: "get_shopping_list", arguments: {} }), {
        Authorization: "Bearer sj_not_a_real_token",
      }),
      db,
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("points the challenge at SPOONJOY_BASE_URL, not the worker's own host", async () => {
    const request = new UndiciRequest("https://spoonjoy-v2.mendelow-studio.workers.dev/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(init(4, "tools/call", { name: "get_shopping_list", arguments: {} })),
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

  it("does not challenge a malformed tool/call with no tool name", async () => {
    const response = await handleMcpHttpRequest({
      request: rpcRequest(init(4, "tools/call", { arguments: {} })),
      db,
    });
    expect(response.status).toBe(200);
  });

  it("dispatches a protected tool/call with a valid bearer token", async () => {
    const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
    const { token } = await createApiCredential(db, user.id, "mcp connector");

    const response = await handleMcpHttpRequest({
      request: rpcRequest(init(5, "tools/call", { name: "get_shopping_list", arguments: {} }), {
        Authorization: `Bearer ${token}`,
      }),
      db,
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { content: { text: string }[] } };
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload).toHaveProperty("shoppingList");
  });

  it("returns a JSON-RPC parse error for an invalid body", async () => {
    const response = await handleMcpHttpRequest({
      request: rpcRequest("{ not json"),
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
});
