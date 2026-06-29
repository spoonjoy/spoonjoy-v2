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

  it("serves Apple App Site Association metadata for native Universal Links", async () => {
    const aasa = await import("~/routes/well-known.apple-app-site-association");
    const { buildAppleAppSiteAssociation } = await import("~/lib/web-route-manifest.server");

    const response = await aasa.loader(routeArgs(new Request("https://spoonjoy.app/.well-known/apple-app-site-association"), {
      context: { cloudflare: { env: { APPLE_TEAM_ID: "a1b2c3d4e5" } } },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    await expect(response.json()).resolves.toMatchObject({
      applinks: {
        apps: [],
        details: [
          {
            appIDs: ["A1B2C3D4E5.app.spoonjoy.Spoonjoy", "A1B2C3D4E5.app.spoonjoy.Spoonjoy.mac"],
            components: expect.arrayContaining([
              { "/": "/recipes/*" },
              { "/": "/cookbooks/*" },
              { "/": "/search", "?": { "*": "*" } },
              { "/": "/account/settings" },
            ]),
          },
        ],
      },
    });

    const configured = buildAppleAppSiteAssociation({ APPLE_TEAM_ID: "zyxwv98765" });
    expect(configured.applinks.details[0]?.appIDs).toEqual([
      "ZYXWV98765.app.spoonjoy.Spoonjoy",
      "ZYXWV98765.app.spoonjoy.Spoonjoy.mac",
    ]);
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

  it("skips OAuth telemetry when analytics config or Workers scheduling is unavailable", async () => {
    const captureEvent = vi.fn(async () => undefined);
    vi.doMock("~/lib/analytics-server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
      captureEvent,
    }));

    const registerRoute = await import("~/routes/oauth.register");
    const tokenRoute = await import("~/routes/oauth.token");
    const revokeRoute = await import("~/routes/oauth.revoke");
    const authorizeRoute = await import("~/routes/oauth.authorize");
    const waitUntil = vi.fn();

    expect((await registerRoute.action(routeArgs(
      new Request("https://spoonjoy.app/oauth/register", { method: "GET" }),
      { context: { cloudflare: { env: { POSTHOG_KEY: "ph_test" } } } },
    ))).status).toBe(405);

    expect((await registerRoute.action(routeArgs(
      new Request("https://spoonjoy.app/oauth/register", { method: "GET" }),
      { context: { cloudflare: { env: { POSTHOG_KEY: "ph_test", POSTHOG_DISABLED: "1" }, ctx: { waitUntil } } } },
    ))).status).toBe(405);

    expect((await tokenRoute.action(routeArgs(
      new Request("https://spoonjoy.app/oauth/token", { method: "GET" }),
      { context: { cloudflare: { env: { POSTHOG_KEY: "ph_test", POSTHOG_DISABLED: "1" }, ctx: { waitUntil } } } },
    ))).status).toBe(405);

    expect((await revokeRoute.action(routeArgs(
      new Request("https://spoonjoy.app/oauth/revoke", { method: "GET" }),
      { context: { cloudflare: { env: null, ctx: { waitUntil } } } },
    ))).status).toBe(405);

    expect((await revokeRoute.action(routeArgs(
      new Request("https://spoonjoy.app/oauth/revoke", { method: "GET" }),
      { context: { cloudflare: { env: { POSTHOG_KEY: "ph_test" } } } },
    ))).status).toBe(405);

    expect((await revokeRoute.action(routeArgs(
      new Request("https://spoonjoy.app/oauth/revoke", { method: "GET" }),
      { context: { cloudflare: { env: { POSTHOG_KEY: "ph_test", POSTHOG_DISABLED: "1" }, ctx: { waitUntil } } } },
    ))).status).toBe(405);

    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    await expect(authorizeRoute.loader(routeArgs(
      new Request("https://spoonjoy.app/oauth/authorize?state=tiny", {
        headers: { "CF-Connecting-IP": "203.0.113.42" },
      }),
      {
        context: {
          cloudflare: {
            env: { POSTHOG_KEY: "ph_test", POSTHOG_DISABLED: "true", API_IP_RATE_LIMITER: limiter },
            ctx: { waitUntil },
          },
        },
      },
    ))).rejects.toSatisfy((response: Response) => response.status === 429);

    expect(captureEvent).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("uses safe fallback metadata for unannotated OAuth shell responses", async () => {
    const captureEvent = vi.fn(async () => undefined);
    vi.doMock("~/lib/analytics-server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
      captureEvent,
    }));
    vi.doMock("~/lib/route-platform.server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
      getRequestDb: vi.fn(async () => ({})),
    }));
    const handleOAuthToken = vi.fn(async () => new Response(null, { status: 500 }));
    const handleOAuthRevoke = vi.fn(async () => new Response(null, { status: 500 }));
    const loadOAuthAuthorize = vi.fn(async () => new Response(null, { status: 500 }));
    vi.doMock("~/lib/oauth-routes.server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/oauth-routes.server")>()),
      handleOAuthToken,
      handleOAuthRevoke,
      loadOAuthAuthorize,
      oauthTokenTelemetryFor: () => ({}),
      oauthRevokeTelemetryFor: () => ({}),
      oauthAuthorizeTelemetryFor: () => ({}),
    }));

    const tokenRoute = await import("~/routes/oauth.token");
    const revokeRoute = await import("~/routes/oauth.revoke");
    const authorizeRoute = await import("~/routes/oauth.authorize");
    const waitUntil = vi.fn();
    const context = { cloudflare: { env: { POSTHOG_KEY: "ph_test" }, ctx: { waitUntil } } };

    const tokenResponse = await tokenRoute.action(routeArgs(
      new Request("https://spoonjoy.app/oauth/token", { method: "POST" }),
      { context },
    ));
    expect(tokenResponse.status).toBe(500);

    const revokeResponse = await revokeRoute.action(routeArgs(
      new Request("https://spoonjoy.app/oauth/revoke", { method: "POST" }),
      { context },
    ));
    expect(revokeResponse.status).toBe(500);

    await expect(authorizeRoute.loader(routeArgs(
      new Request("https://spoonjoy.app/oauth/authorize"),
      { context },
    ))).rejects.toSatisfy((response: Response) => response.status === 500);

    handleOAuthToken.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const tokenOk = await tokenRoute.action(routeArgs(
      new Request("https://spoonjoy.app/oauth/token", { method: "POST" }),
      { context },
    ));
    expect(tokenOk.status).toBe(200);

    handleOAuthRevoke.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const revokeOk = await revokeRoute.action(routeArgs(
      new Request("https://spoonjoy.app/oauth/revoke", { method: "POST" }),
      { context },
    ));
    expect(revokeOk.status).toBe(204);

    loadOAuthAuthorize.mockResolvedValueOnce({ kind: "error", message: "local view" });
    const authorizeView = await authorizeRoute.loader(routeArgs(
      new Request("https://spoonjoy.app/oauth/authorize"),
      { context },
    ));
    expect(authorizeView).toMatchObject({ kind: "error" });

    expect(captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, key: "ph_test" }),
      expect.objectContaining({
        event: "spoonjoy.oauth.token",
        distinctId: "anon",
        properties: expect.objectContaining({
          outcome: "error",
          grant_type: "unknown",
          status: 500,
        }),
      }),
    );
    expect(captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, key: "ph_test" }),
      expect.objectContaining({
        event: "spoonjoy.oauth.revoke",
        distinctId: "anon",
        properties: expect.objectContaining({
          outcome: "error",
          token_type_hint: "unknown",
          status: 500,
        }),
      }),
    );
    expect(captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, key: "ph_test" }),
      expect.objectContaining({
        event: "spoonjoy.oauth.authorize",
        distinctId: "anon",
        properties: expect.objectContaining({
          outcome: "error",
          phase: "loader",
          status: 500,
        }),
      }),
    );
    expect(captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, key: "ph_test" }),
      expect.objectContaining({
        event: "spoonjoy.oauth.token",
        properties: expect.objectContaining({
          status: 200,
          outcome: undefined,
          grant_type: "unknown",
        }),
      }),
    );
    expect(captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, key: "ph_test" }),
      expect.objectContaining({
        event: "spoonjoy.oauth.revoke",
        properties: expect.objectContaining({
          status: 204,
          outcome: undefined,
          token_type_hint: "unknown",
        }),
      }),
    );
    expect(captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, key: "ph_test" }),
      expect.objectContaining({
        event: "spoonjoy.oauth.authorize",
        properties: expect.objectContaining({
          status: 200,
          outcome: undefined,
          phase: "loader",
        }),
      }),
    );
    expect(waitUntil).toHaveBeenCalledTimes(6);
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
    const captureEvent = vi.fn(async () => undefined);
    vi.doMock("~/lib/spoonjoy-api.server", () => ({
      listSpoonjoyApiOperations: () => [],
      callSpoonjoyApiOperation: vi.fn(async () => {
        throw new Error("Recipe not found");
      }),
    }));
    vi.doMock("~/lib/analytics-server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
      captureEvent,
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

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { status: 404, message: "Recipe not found" },
    });
    expect(captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, key: "ph_test" }),
      expect.objectContaining({
        event: "spoonjoy.legacy_api.request",
        properties: expect.objectContaining({
          route_template: "/api/{operation}",
          operation: "health",
          status: 404,
          error_code: "not_found",
          request_id: "unknown",
        }),
      }),
    );
    expect(JSON.stringify(captureEvent.mock.calls)).not.toContain("Recipe not found");
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it("captures unexpected legacy REST operation errors with waitUntil", async () => {
    const captureException = vi.fn(async () => undefined);
    const captureEvent = vi.fn(async () => undefined);
    vi.doMock("~/lib/spoonjoy-api.server", () => ({
      listSpoonjoyApiOperations: () => [],
      callSpoonjoyApiOperation: vi.fn(async () => {
        throw new Error("unexpected route bug");
      }),
    }));
    vi.doMock("~/lib/analytics-server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
      captureException,
      captureEvent,
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
    expect(captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, key: "ph_test" }),
      expect.objectContaining({
        event: "spoonjoy.legacy_api.request",
        distinctId: "anon",
        properties: expect.objectContaining({
          route_template: "/api/{operation}",
          operation: "health",
          method: "GET",
          status: 500,
          error_code: "internal_error",
          auth_mode: "anonymous",
          request_id: "unknown",
          latency_ms: expect.any(Number),
        }),
      }),
    );
    expect(JSON.stringify(captureEvent.mock.calls)).not.toContain("unexpected route bug");
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
