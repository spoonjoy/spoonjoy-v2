// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const requestHandler = vi.fn(async () => new Response("handled"));
const mcpPostRoute = vi.fn(async () => Response.json({ ok: true }));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    createRequestHandler: vi.fn(() => requestHandler),
  };
});

vi.mock("../../app/lib/mcp/http-mcp-route.server", () => ({
  handleMcpPostRouteRequest: mcpPostRoute,
}));

const worker = (await import("../../workers/app")).default;

function context() {
  return { waitUntil: vi.fn() } as unknown as ExecutionContext;
}

describe("Cloudflare worker app", () => {
  it("answers OAuth CORS preflights before React Router handles methods", async () => {
    requestHandler.mockClear();

    const response = await worker.fetch(
      new Request("https://spoonjoy.app/oauth/token", {
        method: "OPTIONS",
        headers: {
          Origin: "https://client.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type",
        },
      }),
      {} as CloudflareEnvironment,
      context(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(requestHandler).not.toHaveBeenCalled();
  });

  it("does not redirect OAuth preflights from the canonical www host", async () => {
    requestHandler.mockClear();

    const response = await worker.fetch(
      new Request("https://www.spoonjoy.app/oauth/register", {
        method: "OPTIONS",
        headers: { Origin: "https://client.example" },
      }),
      {} as CloudflareEnvironment,
      context(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Location")).toBeNull();
    expect(requestHandler).not.toHaveBeenCalled();
  });

  it("still routes non-preflight requests through React Router", async () => {
    requestHandler.mockClear();
    mcpPostRoute.mockClear();

    const response = await worker.fetch(
      new Request("https://spoonjoy.app/oauth/token", { method: "POST" }),
      {} as CloudflareEnvironment,
      context(),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("handled");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(requestHandler).toHaveBeenCalledTimes(1);
    expect(mcpPostRoute).not.toHaveBeenCalled();
  });

  it("exposes the executing Worker version for release-canary verification", async () => {
    requestHandler.mockClear();
    const env = {
      CF_VERSION_METADATA: {
        id: "22222222-2222-4222-8222-222222222222",
        tag: "release",
        timestamp: "2026-07-15T00:00:00Z",
      },
    } as CloudflareEnvironment;

    const response = await worker.fetch(new Request("https://spoonjoy.app/health"), env, context());

    expect(response.headers.get("X-Spoonjoy-Worker-Version")).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("omits the release-version header outside the versioned Workers runtime", async () => {
    const response = await worker.fetch(
      new Request("https://spoonjoy.app/health"),
      {} as CloudflareEnvironment,
      context(),
    );

    expect(response.headers.get("X-Spoonjoy-Worker-Version")).toBeNull();
  });

  it("answers MCP POST requests as raw JSON before React Router renders the landing page", async () => {
    requestHandler.mockClear();
    mcpPostRoute.mockClear();
    const env = { SPOONJOY_BASE_URL: "https://spoonjoy.app" } as CloudflareEnvironment;
    const ctx = context();
    const request = new Request("https://spoonjoy.app/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });

    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(requestHandler).not.toHaveBeenCalled();
    expect(mcpPostRoute).toHaveBeenCalledWith(request, { cloudflare: { env, ctx } });
  });
});
