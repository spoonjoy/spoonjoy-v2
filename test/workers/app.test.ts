// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const requestHandler = vi.fn(async () => new Response("handled"));
const mcpPostRoute = vi.fn(async () => Response.json({ ok: true }));
const captureException = vi.fn(async () => undefined);
const resolvePostHogServerConfig = vi.fn(() => ({ enabled: false }));
let loadServerBuild: (() => Promise<unknown>) | undefined;

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    createRequestHandler: vi.fn((loader: () => Promise<unknown>) => {
      loadServerBuild = loader;
      return requestHandler;
    }),
  };
});

vi.mock("../../app/lib/mcp/http-mcp-route.server", () => ({
  handleMcpPostRouteRequest: mcpPostRoute,
}));

vi.mock("../../app/lib/analytics-server", () => ({
  captureException,
  resolvePostHogServerConfig,
}));

const worker = (await import("../../workers/app")).default;
const WORKER_VERSION_ID = "22222222-2222-4222-8222-222222222222";

function versionedEnvironment(overrides: Partial<CloudflareEnvironment> = {}): CloudflareEnvironment {
  return {
    CF_VERSION_METADATA: {
      id: WORKER_VERSION_ID,
      tag: "release",
      timestamp: "2026-07-15T00:00:00Z",
    },
    ...overrides,
  } as CloudflareEnvironment;
}

function context() {
  return { waitUntil: vi.fn() } as unknown as ExecutionContext;
}

describe("Cloudflare worker app", () => {
  it("configures React Router with a lazy server-build loader", async () => {
    expect(loadServerBuild).toBeTypeOf("function");
    await loadServerBuild?.().catch(() => undefined);
  });

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
      versionedEnvironment(),
      context(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("X-Spoonjoy-Worker-Version")).toBe(WORKER_VERSION_ID);
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

  it("adds security and Worker-version headers to canonical redirects", async () => {
    requestHandler.mockClear();

    const response = await worker.fetch(
      new Request("https://www.spoonjoy.app/recipes"),
      versionedEnvironment(),
      context(),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("https://spoonjoy.app/recipes");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("X-Spoonjoy-Worker-Version")).toBe(WORKER_VERSION_ID);
    expect(requestHandler).not.toHaveBeenCalled();
  });

  it("exposes the executing Worker version for release-canary verification", async () => {
    requestHandler.mockClear();
    const env = versionedEnvironment();

    const response = await worker.fetch(new Request("https://spoonjoy.app/health"), env, context());

    expect(response.headers.get("X-Spoonjoy-Worker-Version")).toBe(WORKER_VERSION_ID);
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("threads runtime PostHog host configuration into Worker CSP headers", async () => {
    requestHandler.mockClear();

    const response = await worker.fetch(
      new Request("https://spoonjoy.app/health"),
      versionedEnvironment({
        SPOONJOY_CSP_MODE: "enforce",
        VITE_POSTHOG_HOST: "https://eu.i.posthog.com/project/123",
      } as Partial<CloudflareEnvironment>),
      context(),
    );

    const csp = response.headers.get("Content-Security-Policy");
    expect(csp).toContain("https://eu.i.posthog.com");
    expect(csp).toContain("https://eu-assets.i.posthog.com");
    expect(csp).not.toContain("https://us.i.posthog.com");
    expect(csp).not.toContain("https://us-assets.i.posthog.com");
    expect(response.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
    expect(response.headers.get("X-Spoonjoy-Worker-Version")).toBe(WORKER_VERSION_ID);
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
    const env = versionedEnvironment({ SPOONJOY_BASE_URL: "https://spoonjoy.app" });
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
    expect(response.headers.get("X-Spoonjoy-Worker-Version")).toBe(WORKER_VERSION_ID);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(requestHandler).not.toHaveBeenCalled();
    expect(mcpPostRoute).toHaveBeenCalledWith(request, { cloudflare: { env, ctx } });
  });

  it("rethrows handler failures without analytics when server analytics is disabled", async () => {
    const error = new Error("render failed");
    requestHandler.mockRejectedValueOnce(error);
    captureException.mockClear();
    resolvePostHogServerConfig.mockReturnValueOnce({ enabled: false });

    await expect(worker.fetch(
      new Request("https://spoonjoy.app/failing"),
      {} as CloudflareEnvironment,
      context(),
    )).rejects.toBe(error);

    expect(resolvePostHogServerConfig).toHaveBeenCalledWith({});
    expect(captureException).not.toHaveBeenCalled();
  });

  it("queues analytics capture before rethrowing handler failures when enabled", async () => {
    const error = new Error("render failed with analytics");
    const env = { POSTHOG_KEY: "test-key" } as CloudflareEnvironment;
    const ctx = context();
    requestHandler.mockRejectedValueOnce(error);
    captureException.mockClear();
    resolvePostHogServerConfig.mockReturnValueOnce({ enabled: true });

    await expect(worker.fetch(
      new Request("https://spoonjoy.app/failing", { method: "PATCH" }),
      env,
      ctx,
    )).rejects.toBe(error);

    expect(captureException).toHaveBeenCalledWith(
      { enabled: true },
      {
        error,
        distinctId: "server",
        route: "/failing",
        method: "PATCH",
      },
    );
    expect(ctx.waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });
});
