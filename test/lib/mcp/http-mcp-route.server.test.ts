// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { id: "db" },
  getRequestDb: vi.fn(),
  handleMcpHttpRequest: vi.fn(),
}));

vi.mock("~/lib/route-platform.server", () => ({
  getRequestDb: mocks.getRequestDb,
}));

vi.mock("~/lib/mcp/http-mcp.server", () => ({
  handleMcpHttpRequest: mocks.handleMcpHttpRequest,
}));

const { handleMcpRouteRequest } = await import("~/lib/mcp/http-mcp-route.server");

describe("handleMcpRouteRequest", () => {
  beforeEach(() => {
    mocks.getRequestDb.mockResolvedValue(mocks.db);
    mocks.handleMcpHttpRequest.mockResolvedValue(Response.json({ ok: true }));
    vi.clearAllMocks();
  });

  it("binds Workers context and forwards MCP environment bindings", async () => {
    const request = new Request("https://spoonjoy.app/mcp", {
      method: "POST",
      headers: { Accept: "application/json, text/event-stream" },
    });
    const waitUntil = vi.fn();
    const env = {
      SPOONJOY_BASE_URL: "https://spoonjoy.app",
      API_TOKEN_RATE_LIMITER: { limit: vi.fn() },
      API_IP_RATE_LIMITER: { limit: vi.fn() },
    } as unknown as Env;
    const ctx = { waitUntil, passThroughOnException: vi.fn() };

    const response = await handleMcpRouteRequest(request, {
      cloudflare: { env, ctx },
    });

    expect(response.status).toBe(200);
    expect(mocks.getRequestDb).toHaveBeenCalledWith({ cloudflare: { env, ctx } });
    expect(mocks.handleMcpHttpRequest).toHaveBeenCalledWith({
      request,
      db: mocks.db,
      cloudflareEnv: env,
      waitUntil: expect.any(Function),
      tokenLimiter: env.API_TOKEN_RATE_LIMITER,
      ipLimiter: env.API_IP_RATE_LIMITER,
      transport: { kind: "protocol", era: "legacy", protocolVersion: null },
    });

    const forwarded = mocks.handleMcpHttpRequest.mock.calls[0]?.[0] as { waitUntil: (promise: Promise<unknown>) => void };
    const promise = Promise.resolve();
    forwarded.waitUntil(promise);
    expect(waitUntil).toHaveBeenCalledWith(promise);
  });

  it("falls back to local DB behavior when no Cloudflare context exists", async () => {
    const request = new Request("http://localhost:5173/mcp", {
      method: "POST",
      headers: { Accept: "application/json, text/event-stream" },
    });
    const context = {};

    await handleMcpRouteRequest(request, context);

    expect(mocks.getRequestDb).toHaveBeenCalledWith(context);
    expect(mocks.handleMcpHttpRequest).toHaveBeenCalledWith({
      request,
      db: mocks.db,
      cloudflareEnv: null,
      waitUntil: undefined,
      tokenLimiter: undefined,
      ipLimiter: undefined,
      transport: { kind: "protocol", era: "legacy", protocolVersion: null },
    });
  });

  it("forwards explicit modern transport identity unchanged", async () => {
    const request = new Request("https://spoonjoy.app/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
      },
    });
    const context = { cloudflare: { env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" } as Env } };

    await handleMcpRouteRequest(request, context);

    expect(mocks.handleMcpHttpRequest).toHaveBeenCalledWith(expect.objectContaining({
      request,
      transport: { kind: "protocol", era: "modern", protocolVersion: "2026-07-28" },
    }));
  });

  it.each([
    ["DELETE", {}, 405],
    ["OPTIONS", { Origin: "https://spoonjoy.app" }, 204],
    ["POST", {}, 406],
  ])("returns a %s edge response before resolving DB", async (method, headers, status) => {
    const response = await handleMcpRouteRequest(new Request("https://spoonjoy.app/mcp", {
      method,
      headers,
    }), { cloudflare: { env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" } as Env } });

    expect(response.status).toBe(status);
    expect(mocks.getRequestDb).not.toHaveBeenCalled();
    expect(mocks.handleMcpHttpRequest).not.toHaveBeenCalled();
  });

  it("preserves a valid request ID in an unsupported-version error without resolving DB", async () => {
    const response = await handleMcpRouteRequest(new Request("https://spoonjoy.app/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2099-01-01",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: "future-id", method: "server/discover" }),
    }), { cloudflare: { env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" } as Env } });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: "future-id",
      error: {
        code: -32022,
        message: "Unsupported protocol version",
        data: {
          supported: ["2026-07-28", "2025-06-18"],
          requested: "2099-01-01",
        },
      },
    });
    expect(mocks.getRequestDb).not.toHaveBeenCalled();
    expect(mocks.handleMcpHttpRequest).not.toHaveBeenCalled();
  });

  it("keeps the body limit ahead of unsupported-version ID recovery", async () => {
    const response = await handleMcpRouteRequest(new Request("https://spoonjoy.app/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2099-01-01",
        "Content-Length": String(8 * 1024 * 1024),
      },
    }), { cloudflare: { env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" } as Env } });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "request_too_large",
      message: "Request body is too large.",
    });
    expect(mocks.getRequestDb).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{", null],
    ["a batch", "[]", null],
    ["an invalid object ID", JSON.stringify({ id: {} }), null],
    ["a finite numeric ID", JSON.stringify({ id: 42 }), 42],
    ["a non-finite numeric ID", "{\"id\":1e400}", null],
  ])("safely recovers %s for an unsupported version", async (_label, body, expectedId) => {
    const response = await handleMcpRouteRequest(new Request("https://spoonjoy.app/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2099-01-01",
      },
      body,
    }), { cloudflare: { env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" } as Env } });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ id: expectedId, error: { code: -32022 } });
    expect(mocks.getRequestDb).not.toHaveBeenCalled();
  });

  it("falls back to a null ID when unsupported-version recovery sees malformed UTF-8", async () => {
    const response = await handleMcpRouteRequest(new Request("https://spoonjoy.app/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2099-01-01",
      },
      body: new Uint8Array([0xc3, 0x28]),
    }), { cloudflare: { env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" } as Env } });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ id: null, error: { code: -32022 } });
    expect(mocks.getRequestDb).not.toHaveBeenCalled();
  });

  it("rate-limits an unsupported version before consuming its body", async () => {
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ id: "never-read" })));
      controller.close();
    });
    const request = new Request("https://spoonjoy.app/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "CF-Connecting-IP": "203.0.113.9",
        "MCP-Protocol-Version": "2099-01-01",
      },
      body: new ReadableStream({ pull }, { highWaterMark: 0 }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const ipLimiter = { limit: vi.fn().mockResolvedValue({ success: false, reset: 12 }) };

    const response = await handleMcpRouteRequest(request, {
      cloudflare: {
        env: {
          SPOONJOY_BASE_URL: "https://spoonjoy.app",
          API_IP_RATE_LIMITER: ipLimiter,
        } as unknown as Env,
      },
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(pull).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    expect(mocks.getRequestDb).not.toHaveBeenCalled();
  });

  it("fails closed when the action helper receives a human landing request", async () => {
    await expect(handleMcpRouteRequest(
      new Request("https://spoonjoy.app/mcp", { method: "GET" }),
      { cloudflare: { env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" } as Env } },
    )).rejects.toThrow("MCP landing requests must be handled by the route loader.");

    expect(mocks.getRequestDb).not.toHaveBeenCalled();
    expect(mocks.handleMcpHttpRequest).not.toHaveBeenCalled();
  });
});
