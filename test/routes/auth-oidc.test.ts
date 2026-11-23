// @vitest-environment node
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { getSessionSignInMethod, getUserId, sessionStorage } from "~/lib/session.server";
import { commitOAuthStartSession, readOAuthStartSession, type OAuthStartSessionData } from "~/lib/oauth-route.server";

const mocks = vi.hoisted(() => ({
  createOidcAuthorizationURL: vi.fn(async () => new URL("https://auth.example.test/authorize?state=mock")),
  verifyOidcCallback: vi.fn(),
  handleOidcOAuthCallback: vi.fn(),
  getRequestDb: vi.fn(() => ({ source: "db" })),
}));

vi.mock("~/lib/oidc.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/oidc.server")>()),
  createOidcAuthorizationURL: mocks.createOidcAuthorizationURL,
  verifyOidcCallback: mocks.verifyOidcCallback,
}));

vi.mock("~/lib/oidc-callback.server", () => ({
  handleOidcOAuthCallback: mocks.handleOidcOAuthCallback,
}));

vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: mocks.getRequestDb,
}));

import OidcOAuthRoute, { action, loader } from "~/routes/auth.oidc";
import OidcOAuthCallbackRoute, { loader as callbackLoader } from "~/routes/auth.oidc.callback";
import { ensureSessionUser } from "../helpers/session-user";

const oidcEnv = {
  SPOONJOY_OIDC_ISSUER: "https://auth.example.test/realms/kitchen",
  SPOONJOY_OIDC_CLIENT_ID: "spoonjoy",
  SPOONJOY_OIDC_CLIENT_SECRET: "test-only-secret",
};
const config = {
  issuer: "https://auth.example.test/realms/kitchen",
  clientId: "spoonjoy",
  clientSecret: "test-only-secret",
  label: "Continue with single sign-on",
  scopes: ["openid", "email", "profile"],
};
const oidcUser = { id: "sub-1", email: "owner@example.test", emailVerified: true, name: "Owner", username: "owner" };

function cookieHeader(setCookie: string) {
  return setCookie.split(";")[0];
}

type RouteArgs = Parameters<typeof loader>[0];

function context(env: Record<string, string> = oidcEnv): RouteArgs["context"] {
  return { cloudflare: { env } } as unknown as RouteArgs["context"];
}

function args(request: Request, env?: Record<string, string>): RouteArgs {
  return { request, context: context(env), params: {} } as unknown as RouteArgs;
}

async function startCookie(overrides: Partial<OAuthStartSessionData> = {}, request = new Request("https://kitchen.example.test/auth/oidc")) {
  return commitOAuthStartSession(request, "oidc", {
    state: "state",
    codeVerifier: "verifier",
    nonce: "nonce",
    redirectTo: "/cookbooks",
    failureRedirect: "/login",
    linking: false,
    ...overrides,
  });
}

async function callback(query: string, cookie?: string, env?: Record<string, string>) {
  const request = new Request(`https://kitchen.example.test/auth/oidc/callback${query}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  return callbackLoader(args(request, env));
}

describe("OpenID Connect sign-in routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing itself", () => {
    expect(OidcOAuthRoute()).toBeNull();
    expect(OidcOAuthCallbackRoute()).toBeNull();
  });

  it("sends the browser to the provider and keeps state, the PKCE verifier and the nonce in the signed cookie", async () => {
    const response = await loader(args(new Request("https://kitchen.example.test/auth/oidc?redirectTo=/cookbooks")));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://auth.example.test/authorize?state=mock");
    const stored = await readOAuthStartSession(
      new Request("https://kitchen.example.test/auth/oidc/callback", { headers: { Cookie: cookieHeader(response.headers.get("Set-Cookie") ?? "") } }),
      "oidc",
    );
    expect(stored).toMatchObject({ redirectTo: "/cookbooks", redirectUri: "https://kitchen.example.test/auth/oidc/callback", linking: false });
    expect(mocks.createOidcAuthorizationURL).toHaveBeenCalledWith(
      config,
      "https://kitchen.example.test/auth/oidc/callback",
      stored!.state,
      stored!.codeVerifier,
      stored!.nonce,
    );
    expect(stored!.nonce).toEqual(expect.any(String));
    expect(stored!.nonce).not.toBe(stored!.state);
  });

  it("builds the callback from SPOONJOY_BASE_URL and starts from POST too", async () => {
    await action(args(new Request("http://localhost:8080/auth/oidc", { method: "POST" }), { ...oidcEnv, SPOONJOY_BASE_URL: "http://localhost:8080" }));
    expect(mocks.createOidcAuthorizationURL).toHaveBeenCalledWith(expect.anything(), "http://localhost:8080/auth/oidc/callback", expect.any(String), expect.any(String), expect.any(String));
  });

  it("returns to the page it came from when the provider isn't configured", async () => {
    const response = await loader(args(new Request("https://kitchen.example.test/auth/oidc", { headers: { Referer: "https://kitchen.example.test/signup" } }), {}));
    expect(response.headers.get("Location")).toBe("/signup?oauthError=oauth_unconfigured");
    expect(mocks.createOidcAuthorizationURL).not.toHaveBeenCalled();
  });

  it("explains a provider that doesn't answer discovery", async () => {
    mocks.createOidcAuthorizationURL.mockRejectedValueOnce(new Error("discovery failed"));
    const response = await loader(args(new Request("https://kitchen.example.test/auth/oidc")));
    expect(response.headers.get("Location")).toBe("/login?oauthError=provider_unavailable");
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("asks for a sign-in before linking", async () => {
    const response = await loader(args(new Request("https://kitchen.example.test/auth/oidc?linking=true")));
    expect(response.headers.get("Location")).toBe("/login?redirectTo=/account/settings&oauthError=login_required");
  });

  it("passes the provider's own error back to the sign-in page", async () => {
    const response = await callback("?error=access_denied");
    expect(response.headers.get("Location")).toBe("/login?oauthError=access_denied");
  });

  it.each([
    ["no stored sign-in", "?state=state&code=code", false],
    ["no returned state", "?code=code", true],
    ["another state", "?state=other&code=code", true],
  ])("refuses a callback with %s", async (_label, query, withCookie) => {
    const cookie = withCookie ? cookieHeader(await startCookie()) : undefined;
    const response = await callback(query, cookie);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_state");
  });

  it.each([
    ["verifier", { codeVerifier: undefined }],
    ["nonce", { nonce: undefined }],
  ])("refuses a stored sign-in with no %s", async (_label, overrides) => {
    const response = await callback("?state=state&code=code", cookieHeader(await startCookie(overrides)));
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_code_verifier");
    expect(mocks.verifyOidcCallback).not.toHaveBeenCalled();
  });

  it("fails closed when the provider was unconfigured in between", async () => {
    const response = await callback("?state=state&code=code", cookieHeader(await startCookie()), {});
    expect(response.headers.get("Location")).toBe("/login?oauthError=oauth_unconfigured");
  });

  it("flattens an unexpected verification failure", async () => {
    mocks.verifyOidcCallback.mockRejectedValueOnce(new Error("boom"));
    const response = await callback("?state=state&code=code", cookieHeader(await startCookie()));
    expect(response.headers.get("Location")).toBe("/login?oauthError=oauth_error");
  });

  it("passes a verification failure back, with an empty code when none came", async () => {
    mocks.verifyOidcCallback.mockResolvedValueOnce({ success: false, error: "invalid_id_token", failureKind: "client", retryable: false });
    const response = await callback("?state=state", cookieHeader(await startCookie({ redirectUri: undefined })));
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_id_token");
    expect(mocks.verifyOidcCallback).toHaveBeenCalledWith(
      config,
      "https://kitchen.example.test/auth/oidc/callback",
      { code: "", codeVerifier: "verifier", nonce: "nonce" },
      expect.any(Function),
    );
  });

  it("signs a verified user in, linked under this issuer", async () => {
    onTestFinished(await ensureSessionUser("oidc-user-1"));
    mocks.verifyOidcCallback.mockResolvedValueOnce({ success: true, oidcUser });
    mocks.handleOidcOAuthCallback.mockResolvedValueOnce({ success: true, userId: "oidc-user-1", action: "user_created", redirectTo: "/cookbooks" });

    const response = await callback("?state=state&code=code", cookieHeader(await startCookie({ redirectUri: "https://kitchen.example.test/auth/oidc/callback" })));

    expect(response.headers.get("Location")).toBe("/cookbooks");
    expect(mocks.handleOidcOAuthCallback).toHaveBeenCalledWith({
      db: { source: "db" },
      d1: null,
      env: oidcEnv,
      inviteToken: undefined,
      provider: "oidc:https://auth.example.test/realms/kitchen",
      oidcUser,
      currentUserId: null,
      redirectTo: "/cookbooks",
    });
    const sessionCookie = response.headers.getSetCookie().find((cookie) => cookie.startsWith("__session="))!;
    const signedIn = new Request("https://kitchen.example.test/", { headers: { Cookie: cookieHeader(sessionCookie) } });
    await expect(getUserId(signedIn)).resolves.toBe("oidc-user-1");
    await expect(getSessionSignInMethod(signedIn)).resolves.toBe("oidc");
  });

  it("passes an account failure back to the sign-in page", async () => {
    mocks.verifyOidcCallback.mockResolvedValueOnce({ success: true, oidcUser });
    mocks.handleOidcOAuthCallback.mockResolvedValueOnce({ success: false, error: "account_exists_unverified", redirectTo: "/recipes" });
    const response = await callback("?state=state&code=code", cookieHeader(await startCookie()));
    expect(response.headers.get("Location")).toBe("/login?oauthError=account_exists_unverified");
  });

  it("links to the signed-in user", async () => {
    onTestFinished(await ensureSessionUser("oidc-user-2"));
    const loginSession = await sessionStorage.getSession();
    loginSession.set("userId", "oidc-user-2");
    const loginCookie = cookieHeader(await sessionStorage.commitSession(loginSession));
    const oauthCookie = cookieHeader(await startCookie({ linking: true, redirectTo: "/account/settings", failureRedirect: "/account/settings" }));
    mocks.verifyOidcCallback.mockResolvedValueOnce({ success: true, oidcUser });
    mocks.handleOidcOAuthCallback.mockResolvedValueOnce({ success: true, userId: "oidc-user-2", action: "account_linked", redirectTo: "/account/settings" });

    const response = await callback("?state=state&code=code", `${loginCookie}; ${oauthCookie}`);
    expect(response.headers.get("Location")).toBe("/account/settings");
    expect(mocks.handleOidcOAuthCallback).toHaveBeenCalledWith(expect.objectContaining({ currentUserId: "oidc-user-2" }));
  });

  it("refuses a linking callback with nobody signed in", async () => {
    mocks.verifyOidcCallback.mockResolvedValueOnce({ success: true, oidcUser });
    const response = await callback("?state=state&code=code", cookieHeader(await startCookie({ linking: true, failureRedirect: "/account/settings" })));
    expect(response.headers.get("Location")).toBe("/account/settings?oauthError=login_required");
    expect(mocks.handleOidcOAuthCallback).not.toHaveBeenCalled();
  });
});
