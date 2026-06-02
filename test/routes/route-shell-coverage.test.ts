import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionStorage } from "~/lib/session.server";

function routeArgs(request: Request, extras: Record<string, unknown> = {}) {
  return {
    request,
    params: {},
    context: { cloudflare: { env: null } },
    ...extras,
  } as any;
}

afterEach(() => {
  vi.doUnmock("~/lib/spoonjoy-api.server");
  vi.doUnmock("~/lib/analytics-server");
  vi.doUnmock("~/lib/env.server");
  vi.doUnmock("~/lib/webauthn-route.server");
  vi.doUnmock("~/lib/session.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

describe("route shell coverage", () => {
  it("serves the public health route shell", async () => {
    const { loader } = await import("~/routes/health");
    const response = loader();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", service: "spoonjoy" });
  });

  it("serves OAuth metadata route shells", async () => {
    const authorization = await import("~/routes/well-known.oauth-authorization-server");
    const protectedResource = await import("~/routes/well-known.oauth-protected-resource");

    const args = routeArgs(new Request("https://worker.example/.well-known/oauth-authorization-server"), {
      context: { cloudflare: { env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" } } },
    });
    await expect(authorization.loader(args).json()).resolves.toMatchObject({
      issuer: "https://spoonjoy.app",
      token_endpoint: "https://spoonjoy.app/oauth/token",
    });
    await expect(protectedResource.loader(args).json()).resolves.toMatchObject({
      resource: "https://spoonjoy.app/mcp",
      authorization_servers: ["https://spoonjoy.app"],
    });
  });

  it("rate limits and forwards OAuth register/token route shells", async () => {
    const registerRoute = await import("~/routes/oauth.register");
    const tokenRoute = await import("~/routes/oauth.token");
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const throttledContext = { cloudflare: { env: { API_IP_RATE_LIMITER: limiter } } };

    const throttledRegister = await registerRoute.action(routeArgs(
      new Request("https://spoonjoy.app/oauth/register", {
        method: "POST",
        headers: { "CF-Connecting-IP": "203.0.113.10" },
      }),
      { context: throttledContext },
    ));
    expect(throttledRegister.status).toBe(429);

    const throttledToken = await tokenRoute.action(routeArgs(
      new Request("https://spoonjoy.app/oauth/token", {
        method: "POST",
        headers: { "CF-Connecting-IP": "203.0.113.10" },
      }),
      { context: throttledContext },
    ));
    expect(throttledToken.status).toBe(429);

    const forwardedRegister = await registerRoute.action(routeArgs(
      new Request("https://spoonjoy.app/oauth/register", { method: "GET" }),
    ));
    expect(forwardedRegister.status).toBe(405);

    const forwardedToken = await tokenRoute.action(routeArgs(
      new Request("https://spoonjoy.app/oauth/token", { method: "GET" }),
    ));
    expect(forwardedToken.status).toBe(405);
  });

  it("binds waitUntil in the MCP route shell when a Workers context exists", async () => {
    const { loader } = await import("~/routes/mcp");
    const waitUntil = vi.fn();
    const response = await loader(routeArgs(
      new Request("https://spoonjoy.app/mcp", { method: "GET" }),
      { context: { cloudflare: { env: null, ctx: { waitUntil } } } },
    ));

    expect(response.status).toBe(405);
  });

  it("maps legacy REST operation not-found errors to 404", async () => {
    vi.doMock("~/lib/spoonjoy-api.server", () => ({
      listSpoonjoyApiOperations: () => [],
      callSpoonjoyApiOperation: vi.fn(async () => {
        throw new Error("Recipe not found");
      }),
    }));

    const { loader } = await import("~/routes/api.$");
    const response = await loader(routeArgs(
      new Request("https://spoonjoy.app/api/health"),
      { params: { "*": "health" } },
    ));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { status: 404, message: "Recipe not found" },
    });
  });

  it("captures unexpected legacy REST operation errors with waitUntil", async () => {
    const captureException = vi.fn(async () => undefined);
    vi.doMock("~/lib/spoonjoy-api.server", () => ({
      listSpoonjoyApiOperations: () => [],
      callSpoonjoyApiOperation: vi.fn(async () => {
        throw new Error("unexpected route bug");
      }),
    }));
    vi.doMock("~/lib/analytics-server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
      captureException,
    }));

    const { loader } = await import("~/routes/api.$");
    const waitUntil = vi.fn();
    const response = await loader(routeArgs(
      new Request("https://spoonjoy.app/api/health"),
      {
        params: { "*": "health" },
        context: { cloudflare: { env: { POSTHOG_KEY: "ph_test" }, ctx: { waitUntil } } },
      },
    ));

    expect(response.status).toBe(500);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, key: "ph_test" }),
      expect.objectContaining({ distinctId: "server", route: "/api/health", method: "GET" }),
    );
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it("does not capture unexpected legacy REST errors when analytics is unavailable", async () => {
    vi.doMock("~/lib/spoonjoy-api.server", () => ({
      listSpoonjoyApiOperations: () => [],
      callSpoonjoyApiOperation: vi.fn(async () => {
        throw new Error("unexpected route bug");
      }),
    }));

    const { loader } = await import("~/routes/api.$");
    const disabledAnalyticsWaitUntil = vi.fn();
    const disabledAnalyticsResponse = await loader(routeArgs(
      new Request("https://spoonjoy.app/api/health"),
      {
        params: { "*": "health" },
        context: { cloudflare: { env: {}, ctx: { waitUntil: disabledAnalyticsWaitUntil } } },
      },
    ));

    expect(disabledAnalyticsResponse.status).toBe(500);
    expect(disabledAnalyticsWaitUntil).not.toHaveBeenCalled();

    const noEnvWaitUntil = vi.fn();
    const noEnvResponse = await loader(routeArgs(
      new Request("https://spoonjoy.app/api/health"),
      {
        params: { "*": "health" },
        context: { cloudflare: { env: null, ctx: { waitUntil: noEnvWaitUntil } } },
      },
    ));

    expect(noEnvResponse.status).toBe(500);
    expect(noEnvWaitUntil).not.toHaveBeenCalled();
  });

  it("uses the public-key route fallback for non-Error config failures", async () => {
    vi.doMock("~/lib/env.server", () => ({
      getVapidConfig: () => {
        throw "non-error config failure";
      },
    }));

    const { loader } = await import("~/routes/api.push.public-key");
    const response = await loader(routeArgs(new Request("https://spoonjoy.app/api/push/public-key")));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "VAPID configuration error" });
  });

  it("uses the registration verify fallback for non-Error orchestration failures", async () => {
    vi.doMock("~/lib/session.server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/session.server")>()),
      getUserId: vi.fn(async () => "route-shell-user"),
    }));
    vi.doMock("~/lib/webauthn-route.server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/webauthn-route.server")>()),
      finishRegistration: vi.fn(async () => {
        throw "non-error registration failure";
      }),
    }));

    const { action } = await import("~/routes/auth.webauthn.register.verify");
    const response = await action(routeArgs(
      new Request("https://spoonjoy.app/auth/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: await sessionCookie("route-shell-user") },
        body: JSON.stringify({ response: { id: "credential" } }),
      }),
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Could not verify registration" });
  });

  it("uses the authentication verify fallback for non-Error orchestration failures", async () => {
    vi.doMock("~/lib/webauthn-route.server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/webauthn-route.server")>()),
      finishAuthentication: vi.fn(async () => {
        throw "non-error authentication failure";
      }),
    }));

    const { action } = await import("~/routes/auth.webauthn.authenticate.verify");
    const response = await action(routeArgs(
      new Request("https://spoonjoy.app/auth/webauthn/authenticate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "passkey@example.com", response: { id: "credential" } }),
      }),
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Could not verify authentication" });
  });
});
