// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => {
  class MockApiAuthError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }

  return {
    ApiAuthError: MockApiAuthError,
    authenticateApiRequest: vi.fn(),
    db: { marker: "db" },
    getDb: vi.fn(),
  };
});

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

vi.mock("../../app/lib/api-auth.server", () => ({
  ApiAuthError: apiMocks.ApiAuthError,
  authenticateApiRequest: apiMocks.authenticateApiRequest,
}));

vi.mock("../../app/lib/db.server", () => ({
  getDb: apiMocks.getDb,
}));

const worker = (await import("../../workers/app")).default;
const WORKER_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_DELETE_INTENT_RESOURCE = "urn:spoonjoy:account-delete-intent:v1";

function versionedEnvironment(overrides: Partial<CloudflareEnvironment> = {}): CloudflareEnvironment {
  return {
    AUTH_IP_RATE_LIMITER: {
      limit: vi.fn(async () => ({ success: true })),
    },
    CF_VERSION_METADATA: {
      id: WORKER_VERSION_ID,
      tag: "release",
      timestamp: "2026-07-15T00:00:00Z",
    },
    SPOONJOY_BASE_URL: "https://spoonjoy.app",
    ...overrides,
  } as CloudflareEnvironment;
}

function context() {
  return { waitUntil: vi.fn() } as unknown as ExecutionContext;
}

function principal(
  source: "session" | "bearer" = "session",
  scopes: string[] = ["kitchen:read", "kitchen:write"],
  metadata: { credentialId?: string; oauthResource?: string | null } = {},
) {
  return {
    id: "user-1",
    email: "cook@example.com",
    username: "cook",
    source,
    scopes,
    ...metadata,
  };
}

function cookSessionNamespace(response = Response.json({
  ok: true,
  storage: "sqlite",
  residue: 0,
}, {
  status: 202,
  statusText: "Accepted",
  headers: {
    "Content-Length": "999",
    "X-Probe-Result": "ready",
  },
})) {
  const fetch = vi.fn(async () => response);
  const get = vi.fn(() => ({ fetch }));
  const idFromName = vi.fn(() => ({ toString: () => "bootstrap-object-id" }));

  return {
    namespace: { get, idFromName } as unknown as DurableObjectNamespace,
    fetch,
    get,
    idFromName,
  };
}

describe("Cloudflare worker app", () => {
  beforeEach(() => {
    apiMocks.authenticateApiRequest.mockReset();
    apiMocks.authenticateApiRequest.mockResolvedValue(principal());
    apiMocks.getDb.mockReset();
    apiMocks.getDb.mockResolvedValue(apiMocks.db);
  });

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

  it.each([
    ["GET", "/api/cook-sessions"],
    ["GET", "/api/cook-sessions/recipe-1"],
    ["GET", "/api/cook-sessions/recipe-1/socket"],
    ["PATCH", "/api/cook-sessions/recipe-1"],
    ["DELETE", "/api/cook-sessions/recipe-1"],
    ["POST", "/api/cook-sessions/recipe-1/start"],
  ])("returns the inert protocol response for %s %s", async (method, path) => {
    const request = new Request(`https://spoonjoy.app${path}`, {
      method,
      headers: { Origin: "https://spoonjoy.app" },
    });
    const env = versionedEnvironment({ DB: { marker: "binding" } as unknown as D1Database });

    const response = await worker.fetch(request, env, context());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(response.headers.get("X-Spoonjoy-Worker-Version")).toBe(WORKER_VERSION_ID);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "cook_session_protocol_unavailable",
        message: "Cook session protocol is temporarily unavailable.",
        retryable: true,
      },
    });
    expect(apiMocks.getDb).toHaveBeenCalledWith({ DB: env.DB });
    expect(apiMocks.authenticateApiRequest).toHaveBeenCalledWith(apiMocks.db, request, env);
  });

  it.each([
    ["PUT", "/api/cook-sessions/recipe-1"],
    ["GET", "/api/cook-sessions/recipe-1?mode=bad"],
    ["DELETE", "/api/cook-sessions/"],
    ["GET", "/api/cook-sessions/recipe-1/extra"],
    ["POST", "/api/cook-sessions/recipe-1/pause"],
    ["GET", "/api/cook-sessions-bad"],
  ])("returns 404 before authentication for malformed cook route %s %s", async (method, path) => {
    const response = await worker.fetch(
      new Request(`https://spoonjoy.app${path}`, { method }),
      versionedEnvironment(),
      context(),
    );

    expect(response.status).toBe(404);
    expect(apiMocks.getDb).not.toHaveBeenCalled();
    expect(apiMocks.authenticateApiRequest).not.toHaveBeenCalled();
  });

  it.each(["?confirm=1", "?"])("rejects owner DELETE query component %s before authentication", async (suffix) => {
    const namespace = cookSessionNamespace();
    const response = await worker.fetch(
      new Request(`https://spoonjoy.app/api/cook-sessions${suffix}`, { method: "DELETE" }),
      versionedEnvironment({ COOK_SESSIONS: namespace.namespace }),
      context(),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "Cook session request is invalid.",
        retryable: false,
      },
    });
    expect(apiMocks.getDb).not.toHaveBeenCalled();
    expect(apiMocks.authenticateApiRequest).not.toHaveBeenCalled();
    expect(namespace.idFromName).not.toHaveBeenCalled();
    expect(namespace.get).not.toHaveBeenCalled();
    expect(namespace.fetch).not.toHaveBeenCalled();
  });

  it("rejects a body on owner DELETE after the complete deletion intent without DO access", async () => {
    apiMocks.authenticateApiRequest.mockResolvedValueOnce(principal(
      "bearer",
      ["account:write"],
      {
        credentialId: "account-delete-credential",
        oauthResource: ACCOUNT_DELETE_INTENT_RESOURCE,
      },
    ));
    const namespace = cookSessionNamespace();
    const cancelBody = vi.fn();
    const request = new Request("https://spoonjoy.app/api/cook-sessions", {
      method: "DELETE",
      headers: { Origin: "https://spoonjoy.app" },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{"));
          controller.enqueue(new TextEncoder().encode("}"));
        },
        cancel: cancelBody,
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await worker.fetch(
      request,
      versionedEnvironment({ DB: {} as D1Database, COOK_SESSIONS: namespace.namespace }),
      context(),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "Cook session request is invalid.",
        retryable: false,
      },
    });
    expect(apiMocks.authenticateApiRequest).toHaveBeenCalledWith(apiMocks.db, request, expect.anything());
    expect(namespace.idFromName).not.toHaveBeenCalled();
    expect(namespace.get).not.toHaveBeenCalled();
    expect(namespace.fetch).not.toHaveBeenCalled();
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("rejects an owner DELETE payload when best-effort stream cancellation fails", async () => {
    apiMocks.authenticateApiRequest.mockResolvedValueOnce(principal(
      "bearer",
      ["account:write"],
      {
        credentialId: "account-delete-credential",
        oauthResource: ACCOUNT_DELETE_INTENT_RESOURCE,
      },
    ));
    const namespace = cookSessionNamespace();
    const request = new Request("https://spoonjoy.app/api/cook-sessions", {
      method: "DELETE",
      headers: { Origin: "https://spoonjoy.app" },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("payload"));
        },
        cancel() {
          throw new Error("cancel failed");
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await worker.fetch(
      request,
      versionedEnvironment({ DB: {} as D1Database, COOK_SESSIONS: namespace.namespace }),
      context(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
    expect(namespace.idFromName).not.toHaveBeenCalled();
    expect(namespace.get).not.toHaveBeenCalled();
    expect(namespace.fetch).not.toHaveBeenCalled();
  });

  it("rejects an owner DELETE when reading its body stream fails", async () => {
    apiMocks.authenticateApiRequest.mockResolvedValueOnce(principal(
      "bearer",
      ["account:write"],
      {
        credentialId: "account-delete-credential",
        oauthResource: ACCOUNT_DELETE_INTENT_RESOURCE,
      },
    ));
    const namespace = cookSessionNamespace();
    const streamError = new Error("read failed");
    const request = new Request("https://spoonjoy.app/api/cook-sessions", {
      method: "DELETE",
      headers: { Origin: "https://spoonjoy.app" },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(streamError);
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await worker.fetch(
      request,
      versionedEnvironment({ DB: {} as D1Database, COOK_SESSIONS: namespace.namespace }),
      context(),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "Cook session request is invalid.",
        retryable: false,
      },
    });
    expect(namespace.idFromName).not.toHaveBeenCalled();
    expect(namespace.get).not.toHaveBeenCalled();
    expect(namespace.fetch).not.toHaveBeenCalled();
  });

  it("accepts an edge-normalized zero-byte owner DELETE stream without DO access", async () => {
    apiMocks.authenticateApiRequest.mockResolvedValueOnce(principal(
      "bearer",
      ["account:write"],
      {
        credentialId: "account-delete-credential",
        oauthResource: ACCOUNT_DELETE_INTENT_RESOURCE,
      },
    ));
    const namespace = cookSessionNamespace();
    const request = new Request("https://spoonjoy.app/api/cook-sessions", {
      method: "DELETE",
      headers: { Origin: "https://spoonjoy.app" },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(0));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    expect(request.body).not.toBeNull();
    const response = await worker.fetch(
      request,
      versionedEnvironment({ DB: {} as D1Database, COOK_SESSIONS: namespace.namespace }),
      context(),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(namespace.idFromName).not.toHaveBeenCalled();
    expect(namespace.get).not.toHaveBeenCalled();
    expect(namespace.fetch).not.toHaveBeenCalled();
  });

  it("reserves exact owner DELETE for a complete bearer deletion-intent principal without Durable Object access", async () => {
    apiMocks.authenticateApiRequest.mockResolvedValueOnce(principal(
      "bearer",
      ["account:write"],
      {
        credentialId: "account-delete-credential",
        oauthResource: ACCOUNT_DELETE_INTENT_RESOURCE,
      },
    ));
    const namespace = cookSessionNamespace();
    const request = new Request("https://spoonjoy.app/api/cook-sessions", {
      method: "DELETE",
      headers: { Origin: "https://spoonjoy.app" },
    });
    const env = versionedEnvironment({
      DB: {} as D1Database,
      COOK_SESSIONS: namespace.namespace,
    });

    const response = await worker.fetch(request, env, context());

    expect(namespace.idFromName).not.toHaveBeenCalled();
    expect(namespace.get).not.toHaveBeenCalled();
    expect(namespace.fetch).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Retry-After")).toBe("1");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "cook_session_protocol_unavailable",
        message: "Cook session protocol is temporarily unavailable.",
        retryable: true,
      },
    });
    expect(apiMocks.authenticateApiRequest).toHaveBeenCalledWith(apiMocks.db, request, env);
  });

  it.each([
    ["missing credentials", null, 401, "authentication_required", "Authentication required."],
    [
      "a session principal",
      principal("session", ["account:write"]),
      403,
      "insufficient_scope",
      "This credential does not include the required cook-session scope.",
    ],
    [
      "a bearer principal without a credential id",
      principal("bearer", ["account:write"], { oauthResource: ACCOUNT_DELETE_INTENT_RESOURCE }),
      403,
      "insufficient_scope",
      "This credential does not include the required cook-session scope.",
    ],
    [
      "a bearer principal without a resource",
      principal("bearer", ["account:write"], { credentialId: "account-delete-credential" }),
      403,
      "insufficient_scope",
      "This credential does not include the required cook-session scope.",
    ],
    [
      "a bearer principal with the wrong resource",
      principal("bearer", ["account:write"], {
        credentialId: "account-delete-credential",
        oauthResource: `${ACCOUNT_DELETE_INTENT_RESOURCE}:wrong`,
      }),
      403,
      "insufficient_scope",
      "This credential does not include the required cook-session scope.",
    ],
    [
      "a bearer principal without account write scope",
      principal("bearer", ["kitchen:write"], {
        credentialId: "account-delete-credential",
        oauthResource: ACCOUNT_DELETE_INTENT_RESOURCE,
      }),
      403,
      "insufficient_scope",
      "This credential does not include the required cook-session scope.",
    ],
  ])("rejects owner DELETE for %s before checking Origin", async (
    _case,
    authenticated,
    status,
    code,
    message,
  ) => {
    apiMocks.authenticateApiRequest.mockResolvedValueOnce(authenticated);
    const namespace = cookSessionNamespace();

    const response = await worker.fetch(
      new Request("https://spoonjoy.app/api/cook-sessions", {
        method: "DELETE",
        headers: { Origin: "https://attacker.example" },
      }),
      versionedEnvironment({ DB: {} as D1Database, COOK_SESSIONS: namespace.namespace }),
      context(),
    );

    expect(namespace.idFromName).not.toHaveBeenCalled();
    expect(namespace.get).not.toHaveBeenCalled();
    expect(namespace.fetch).not.toHaveBeenCalled();
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({
      error: { code, message, retryable: false },
    });
  });

  it("checks owner DELETE Origin only after validating the bearer deletion intent", async () => {
    apiMocks.authenticateApiRequest.mockResolvedValueOnce(principal(
      "bearer",
      ["account:write"],
      {
        credentialId: "account-delete-credential",
        oauthResource: ACCOUNT_DELETE_INTENT_RESOURCE,
      },
    ));

    const response = await worker.fetch(
      new Request("https://spoonjoy.app/api/cook-sessions", {
        method: "DELETE",
        headers: { Origin: "https://attacker.example" },
      }),
      versionedEnvironment({ DB: {} as D1Database }),
      context(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "origin_forbidden",
        message: "Request origin is not allowed.",
        retryable: false,
      },
    });
  });

  it("fails owner DELETE closed when the public origin is not configured", async () => {
    apiMocks.authenticateApiRequest.mockResolvedValueOnce(principal(
      "bearer",
      ["account:write"],
      {
        credentialId: "account-delete-credential",
        oauthResource: ACCOUNT_DELETE_INTENT_RESOURCE,
      },
    ));
    const namespace = cookSessionNamespace();

    const response = await worker.fetch(
      new Request("https://spoonjoy.app/api/cook-sessions", {
        method: "DELETE",
        headers: { Origin: "https://spoonjoy.app" },
      }),
      versionedEnvironment({
        COOK_SESSIONS: namespace.namespace,
        SPOONJOY_BASE_URL: undefined,
      }),
      context(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "origin_forbidden" } });
    expect(namespace.idFromName).not.toHaveBeenCalled();
    expect(namespace.get).not.toHaveBeenCalled();
    expect(namespace.fetch).not.toHaveBeenCalled();
  });

  it("preserves malformed owner DELETE authentication as invalid_request", async () => {
    apiMocks.authenticateApiRequest.mockRejectedValueOnce(
      new apiMocks.ApiAuthError("Malformed Authorization header", 400),
    );
    const namespace = cookSessionNamespace();

    const response = await worker.fetch(
      new Request("https://spoonjoy.app/api/cook-sessions", {
        method: "DELETE",
        headers: { Authorization: "Basic malformed" },
      }),
      versionedEnvironment({ COOK_SESSIONS: namespace.namespace }),
      context(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "Authentication request is invalid.",
        retryable: false,
      },
    });
    expect(namespace.idFromName).not.toHaveBeenCalled();
    expect(namespace.get).not.toHaveBeenCalled();
    expect(namespace.fetch).not.toHaveBeenCalled();
  });

  it("requires an authenticated cook-session principal", async () => {
    apiMocks.authenticateApiRequest.mockResolvedValueOnce(null);

    const response = await worker.fetch(
      new Request("https://spoonjoy.app/api/cook-sessions"),
      versionedEnvironment({ DB: {} as D1Database }),
      context(),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "authentication_required",
        message: "Authentication required.",
        retryable: false,
      },
    });
  });

  it.each([
    ["GET", "/api/cook-sessions", ["kitchen:write"]],
    ["PATCH", "/api/cook-sessions/recipe-1", ["kitchen:read"]],
  ])("checks bearer scope before origin for %s %s", async (method, path, scopes) => {
    apiMocks.authenticateApiRequest.mockResolvedValueOnce(principal("bearer", scopes));

    const response = await worker.fetch(
      new Request(`https://spoonjoy.app${path}`, {
        method,
        headers: { Origin: "https://attacker.example" },
      }),
      versionedEnvironment({ DB: {} as D1Database }),
      context(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "insufficient_scope",
        message: "This credential does not include the required cook-session scope.",
        retryable: false,
      },
    });
  });

  it("checks mutation origin after bearer scope", async () => {
    apiMocks.authenticateApiRequest.mockResolvedValueOnce(principal("bearer", ["kitchen:write"]));

    const response = await worker.fetch(
      new Request("https://spoonjoy.app/api/cook-sessions/recipe-1", {
        method: "PATCH",
        headers: { Origin: "https://attacker.example" },
      }),
      versionedEnvironment({ DB: {} as D1Database }),
      context(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "origin_forbidden",
        message: "Request origin is not allowed.",
        retryable: false,
      },
    });
  });

  it("checks mutations against the configured public origin when the transport URL is internal", async () => {
    const request = new Request("https://spoonjoy-internal.workers.dev/api/cook-sessions/recipe-1", {
      method: "PATCH",
      headers: {
        Origin: "https://spoonjoy.app",
        "X-Forwarded-Host": "spoonjoy.app",
      },
    });
    const env = versionedEnvironment({ DB: {} as D1Database });

    const response = await worker.fetch(request, env, context());

    expect(response.status).toBe(503);
    expect(apiMocks.authenticateApiRequest).toHaveBeenCalledWith(apiMocks.db, request, env);
  });

  it.each([undefined, "not a url", "ftp://spoonjoy.app"])(
    "fails mutation origin closed when SPOONJOY_BASE_URL is %s",
    async (baseUrl) => {
      const response = await worker.fetch(
        new Request("https://spoonjoy.app/api/cook-sessions/recipe-1", {
          method: "PATCH",
          headers: { Origin: "https://spoonjoy.app" },
        }),
        versionedEnvironment({ DB: {} as D1Database, SPOONJOY_BASE_URL: baseUrl }),
        context(),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "origin_forbidden" } });
    },
  );

  it.each([
    [400, 400, "invalid_request", "Authentication request is invalid."],
    [403, 401, "authentication_required", "Authentication required."],
  ])("normalizes API auth errors with source status %i", async (
    sourceStatus,
    expectedStatus,
    code,
    message,
  ) => {
    apiMocks.authenticateApiRequest.mockRejectedValueOnce(
      new apiMocks.ApiAuthError("auth failed", sourceStatus),
    );

    const response = await worker.fetch(
      new Request("https://spoonjoy.app/api/cook-sessions"),
      versionedEnvironment({ DB: {} as D1Database }),
      context(),
    );

    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toEqual({
      error: { code, message, retryable: false },
    });
  });

  it("rethrows non-authentication cook-session failures through server analytics", async () => {
    const error = new Error("database unavailable");
    const env = versionedEnvironment({ DB: {} as D1Database, POSTHOG_KEY: "test-key" });
    const ctx = context();
    apiMocks.authenticateApiRequest.mockRejectedValueOnce(error);
    captureException.mockClear();
    resolvePostHogServerConfig.mockReturnValueOnce({ enabled: true });

    await expect(worker.fetch(
      new Request("https://spoonjoy.app/api/cook-sessions"),
      env,
      ctx,
    )).rejects.toBe(error);

    expect(captureException).toHaveBeenCalledWith(
      { enabled: true },
      {
        error,
        distinctId: "server",
        route: "/api/cook-sessions",
        method: "GET",
      },
    );
  });

  it.each([
    ["path", "/.well-known/spoonjoy-cook-session-bootstrap/extra", "POST", true, ""],
    ["query", "/.well-known/spoonjoy-cook-session-bootstrap?bad=1", "POST", true, ""],
    ["method", "/.well-known/spoonjoy-cook-session-bootstrap", "GET", true, undefined],
    ["version", "/.well-known/spoonjoy-cook-session-bootstrap", "POST", false, ""],
    ["binding", "/.well-known/spoonjoy-cook-session-bootstrap", "POST", true, ""],
    ["body", "/.well-known/spoonjoy-cook-session-bootstrap", "POST", true, "not-empty"],
  ])("keeps invalid bootstrap %s requests inert", async (
    _case,
    path,
    method,
    includeVersion,
    body,
  ) => {
    const namespace = cookSessionNamespace();
    const env = {
      COOK_SESSIONS: _case === "binding" ? undefined : namespace.namespace,
      CF_VERSION_METADATA: includeVersion
        ? versionedEnvironment().CF_VERSION_METADATA
        : undefined,
    } as CloudflareEnvironment;
    const response = await worker.fetch(
      new Request(`https://spoonjoy.app${path}`, { method, body }),
      env,
      context(),
    );

    expect(response.status).toBe(404);
    expect(namespace.idFromName).not.toHaveBeenCalled();
    expect(namespace.get).not.toHaveBeenCalled();
    expect(namespace.fetch).not.toHaveBeenCalled();
  });

  it("keeps the former public bootstrap probe permanently inert", async () => {
    const namespace = cookSessionNamespace();
    const env = versionedEnvironment({
      COOK_SESSIONS: namespace.namespace,
    });

    const response = await worker.fetch(
      new Request("https://spoonjoy.app/.well-known/spoonjoy-cook-session-bootstrap", {
        method: "POST",
        headers: { "CF-Connecting-IP": "203.0.113.40" },
      }),
      env,
      context(),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("X-Spoonjoy-Worker-Version")).toBe(WORKER_VERSION_ID);
    expect(namespace.idFromName).not.toHaveBeenCalled();
    expect(namespace.get).not.toHaveBeenCalled();
    expect(namespace.fetch).not.toHaveBeenCalled();
  });

  it("accepts Cloudflare's empty incoming POST stream without treating it as a request body", async () => {
    const namespace = cookSessionNamespace();
    const request = new Request(
      "https://spoonjoy.app/.well-known/spoonjoy-cook-session-bootstrap",
      {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "203.0.113.44",
          "Content-Length": "0",
        },
      },
    );
    Object.defineProperty(request, "body", {
      value: new ReadableStream({ start(controller) { controller.close(); } }),
    });

    const response = await worker.fetch(
      request,
      versionedEnvironment({
        COOK_SESSIONS: namespace.namespace,
      }),
      context(),
    );

    expect(response.status).toBe(404);
    expect(namespace.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["content type", { "Content-Type": "application/octet-stream" }],
    ["transfer encoding", { "Transfer-Encoding": "chunked" }],
    ["nonzero content length", { "Content-Length": "1" }],
  ])("rejects a bootstrap request with a declared %s", async (_case, bodyHeaders) => {
    const namespace = cookSessionNamespace();
    const response = await worker.fetch(
      new Request("https://spoonjoy.app/.well-known/spoonjoy-cook-session-bootstrap", {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "203.0.113.45",
          ...bodyHeaders,
        },
      }),
      versionedEnvironment({
        COOK_SESSIONS: namespace.namespace,
      }),
      context(),
    );

    expect(response.status).toBe(404);
    expect(namespace.fetch).not.toHaveBeenCalled();
  });

  it("rejects a headerless non-empty bootstrap stream without reading it", async () => {
    const namespace = cookSessionNamespace();
    const limiter = { limit: vi.fn(async () => ({ success: true })) };
    const request = new Request(
      "https://spoonjoy.app/.well-known/spoonjoy-cook-session-bootstrap",
      {
        method: "POST",
        headers: { "CF-Connecting-IP": "203.0.113.46" },
      },
    );
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const getReader = vi.spyOn(body, "getReader");
    Object.defineProperty(request, "body", {
      value: body,
    });

    const response = await worker.fetch(
      request,
      versionedEnvironment({
        AUTH_IP_RATE_LIMITER: limiter,
        COOK_SESSIONS: namespace.namespace,
      }),
      context(),
    );

    expect(response.status).toBe(404);
    expect(getReader).not.toHaveBeenCalled();
    expect(limiter.limit).not.toHaveBeenCalled();
    expect(namespace.idFromName).not.toHaveBeenCalled();
    expect(namespace.fetch).not.toHaveBeenCalled();
  });

  it("rate-limits the public bootstrap probe before Durable Object work", async () => {
    const namespace = cookSessionNamespace();
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const response = await worker.fetch(
      new Request("https://spoonjoy.app/.well-known/spoonjoy-cook-session-bootstrap", {
        method: "POST",
        headers: { "CF-Connecting-IP": "203.0.113.41" },
      }),
      versionedEnvironment({
        AUTH_IP_RATE_LIMITER: limiter,
        COOK_SESSIONS: namespace.namespace,
      }),
      context(),
    );

    expect(response.status).toBe(404);
    expect(limiter.limit).not.toHaveBeenCalled();
    expect(namespace.fetch).not.toHaveBeenCalled();
  });

  it.each(["client IP", "rate limiter"])("fails the public bootstrap probe closed without its %s", async (missing) => {
    const namespace = cookSessionNamespace();
    const response = await worker.fetch(
      new Request("https://spoonjoy.app/.well-known/spoonjoy-cook-session-bootstrap", {
        method: "POST",
        headers: missing === "client IP" ? undefined : { "CF-Connecting-IP": "203.0.113.43" },
      }),
      versionedEnvironment({
        AUTH_IP_RATE_LIMITER: missing === "rate limiter" ? undefined : {
          limit: vi.fn(async () => ({ success: true })),
        },
        COOK_SESSIONS: namespace.namespace,
      }),
      context(),
    );

    expect(response.status).toBe(404);
    expect(namespace.fetch).not.toHaveBeenCalled();
  });

  it("rejects a declared public bootstrap request body without reading its stream", async () => {
    const namespace = cookSessionNamespace();
    const request = new Request("https://spoonjoy.app/.well-known/spoonjoy-cook-session-bootstrap", {
      method: "POST",
      headers: {
        "CF-Connecting-IP": "203.0.113.42",
        "Content-Length": "1",
      },
    });
    const readBody = vi.spyOn(request, "text").mockRejectedValue(new Error("body must not be read"));
    Object.defineProperty(request, "body", { value: {} as ReadableStream });

    const response = await worker.fetch(
      request,
      versionedEnvironment({
        COOK_SESSIONS: namespace.namespace,
      }),
      context(),
    );

    expect(response.status).toBe(404);
    expect(readBody).not.toHaveBeenCalled();
    expect(namespace.fetch).not.toHaveBeenCalled();
  });
});
