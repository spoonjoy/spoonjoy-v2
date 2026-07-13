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

const { handleMcpPostRouteRequest } = await import("~/lib/mcp/http-mcp-route.server");

describe("handleMcpPostRouteRequest", () => {
  beforeEach(() => {
    mocks.getRequestDb.mockResolvedValue(mocks.db);
    mocks.handleMcpHttpRequest.mockResolvedValue(Response.json({ ok: true }));
    vi.clearAllMocks();
  });

  it("binds Workers context and forwards MCP environment bindings", async () => {
    const request = new Request("https://spoonjoy.app/mcp", { method: "POST" });
    const waitUntil = vi.fn();
    const env = {
      SPOONJOY_BASE_URL: "https://spoonjoy.app",
      API_TOKEN_RATE_LIMITER: { limit: vi.fn() },
      API_IP_RATE_LIMITER: { limit: vi.fn() },
    } as unknown as Env;
    const ctx = { waitUntil, passThroughOnException: vi.fn() };

    const response = await handleMcpPostRouteRequest(request, {
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
    const request = new Request("http://localhost:5173/mcp", { method: "POST" });
    const context = {};

    await handleMcpPostRouteRequest(request, context);

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
});
