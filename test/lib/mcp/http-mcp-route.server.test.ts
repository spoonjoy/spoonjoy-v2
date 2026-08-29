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
    });
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

  it("fails closed when the action helper receives a human landing request", async () => {
    await expect(handleMcpRouteRequest(
      new Request("https://spoonjoy.app/mcp", { method: "GET" }),
      { cloudflare: { env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" } as Env } },
    )).rejects.toThrow("MCP landing requests must be handled by the route loader.");

    expect(mocks.getRequestDb).not.toHaveBeenCalled();
    expect(mocks.handleMcpHttpRequest).not.toHaveBeenCalled();
  });
});
