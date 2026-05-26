// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sessionStorage } from "~/lib/session.server";
import { commitOAuthStartSession } from "~/lib/oauth-route.server";

const mocks = vi.hoisted(() => ({
  createGoogleAuthorizationURL: vi.fn(() => new URL("https://accounts.google.com/o/oauth2/v2/auth?state=mock-state")),
  generateCodeVerifier: vi.fn(() => "mock-code-verifier"),
  verifyGoogleCallback: vi.fn(),
  handleGoogleOAuthCallback: vi.fn(),
  getRequestDb: vi.fn(() => ({ source: "db" })),
}));

vi.mock("~/lib/google-oauth.server", () => ({
  createGoogleAuthorizationURL: mocks.createGoogleAuthorizationURL,
  generateCodeVerifier: mocks.generateCodeVerifier,
  verifyGoogleCallback: mocks.verifyGoogleCallback,
}));

vi.mock("~/lib/google-oauth-callback.server", () => ({
  handleGoogleOAuthCallback: mocks.handleGoogleOAuthCallback,
}));

vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: mocks.getRequestDb,
}));

import { action, loader } from "~/routes/auth.google";
import GoogleOAuthRoute from "~/routes/auth.google";
import { loader as callbackLoader } from "~/routes/auth.google.callback";
import GoogleOAuthCallbackRoute from "~/routes/auth.google.callback";

const googleEnv = {
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
};

function cookieHeader(setCookie: string) {
  return setCookie.split(";")[0];
}

describe("Google OAuth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initiates Google OAuth from POST and stores state", async () => {
    const request = new Request("https://spoonjoy.app/auth/google", { method: "POST" });
    const response = await action({ request, context: { cloudflare: { env: googleEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("accounts.google.com");
    expect(response.headers.get("Set-Cookie")).toBeTruthy();
    expect(mocks.generateCodeVerifier).toHaveBeenCalledOnce();
    expect(mocks.createGoogleAuthorizationURL).toHaveBeenCalledWith(
      { clientId: "google-client", clientSecret: "google-secret" },
      "https://spoonjoy.app/auth/google/callback",
      expect.any(String),
      "mock-code-verifier"
    );
  });

  it("initiates Google OAuth from GET", async () => {
    const request = new Request("https://spoonjoy.app/auth/google?redirectTo=/cookbooks");
    const response = await loader({ request, context: { cloudflare: { env: googleEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("accounts.google.com");
  });

  it("redirects to OAuth error when Google env is missing", async () => {
    const request = new Request("https://spoonjoy.app/auth/google", {
      headers: { Referer: "https://spoonjoy.app/signup" },
    });
    const response = await loader({ request, context: { cloudflare: { env: {} } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/signup?oauthError=oauth_unconfigured");
  });

  it("requires login before starting a linking flow", async () => {
    const request = new Request("https://spoonjoy.app/auth/google?linking=true");
    const response = await loader({ request, context: { cloudflare: { env: googleEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?redirectTo=/account/settings&oauthError=login_required");
  });

  it("renders null route components", () => {
    expect(GoogleOAuthRoute()).toBeNull();
    expect(GoogleOAuthCallbackRoute()).toBeNull();
  });

  it("handles provider error callbacks", async () => {
    const request = new Request("https://spoonjoy.app/auth/google/callback?error=access_denied");
    const response = await callbackLoader({ request, context: { cloudflare: { env: googleEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?oauthError=access_denied");
  });

  it("rejects callbacks with missing stored state", async () => {
    const request = new Request("https://spoonjoy.app/auth/google/callback?state=state&code=code");
    const response = await callbackLoader({ request, context: { cloudflare: { env: googleEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_state");
  });

  it("rejects callbacks when stored and returned state differ", async () => {
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/google"), "google", {
      state: "state",
      codeVerifier: "verifier",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/google/callback?state=other&code=code", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackLoader({ request, context: { cloudflare: { env: googleEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_state");
  });

  it("rejects callbacks with stored state but no returned state", async () => {
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/google"), "google", {
      state: "state",
      codeVerifier: "verifier",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/google/callback?code=code", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackLoader({ request, context: { cloudflare: { env: googleEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_state");
  });

  it("rejects callbacks with missing code verifier", async () => {
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/google"), "google", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/google/callback?state=state&code=code", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackLoader({ request, context: { cloudflare: { env: googleEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_code_verifier");
  });

  it("redirects when callback env is missing", async () => {
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/google"), "google", {
      state: "state",
      codeVerifier: "verifier",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/google/callback?state=state&code=code", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackLoader({ request, context: { cloudflare: { env: {} } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=oauth_unconfigured");
  });

  it("redirects when Google verification fails", async () => {
    mocks.verifyGoogleCallback.mockResolvedValueOnce({ success: false, error: "invalid_code" });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/google"), "google", {
      state: "state",
      codeVerifier: "verifier",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/google/callback?state=state&code=bad", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackLoader({ request, context: { cloudflare: { env: googleEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_code");
  });

  it("passes an empty code to Google verification when the callback omits code", async () => {
    mocks.verifyGoogleCallback.mockResolvedValueOnce({ success: false, error: "invalid_code" });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/google"), "google", {
      state: "state",
      codeVerifier: "verifier",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/google/callback?state=state", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    await callbackLoader({ request, context: { cloudflare: { env: googleEnv } }, params: {} } as any);
    expect(mocks.verifyGoogleCallback).toHaveBeenCalledWith(
      { clientId: "google-client", clientSecret: "google-secret" },
      "https://spoonjoy.app/auth/google/callback",
      { code: "", state: "state", codeVerifier: "verifier" }
    );
  });

  it("redirects when Google verification succeeds without a user payload", async () => {
    mocks.verifyGoogleCallback.mockResolvedValueOnce({ success: true, googleUser: null });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/google"), "google", {
      state: "state",
      codeVerifier: "verifier",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/google/callback?state=state&code=code", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackLoader({ request, context: { cloudflare: { env: googleEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=oauth_error");
  });

  it("redirects when callback handler returns an error", async () => {
    mocks.verifyGoogleCallback.mockResolvedValueOnce({
      success: true,
      googleUser: { id: "g1", email: "g@example.com", emailVerified: true, name: null, givenName: null, familyName: null, picture: null },
    });
    mocks.handleGoogleOAuthCallback.mockResolvedValueOnce({
      success: false,
      error: "account_exists",
      redirectTo: "/recipes",
    });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/google"), "google", {
      state: "state",
      codeVerifier: "verifier",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/google/callback?state=state&code=code", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackLoader({ request, context: { cloudflare: { env: googleEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=account_exists");
  });

  it("creates a session on successful Google callback", async () => {
    const googleUser = { id: "g1", email: "g@example.com", emailVerified: true, name: "G User", givenName: "G", familyName: "User", picture: null };
    mocks.verifyGoogleCallback.mockResolvedValueOnce({ success: true, googleUser });
    mocks.handleGoogleOAuthCallback.mockResolvedValueOnce({
      success: true,
      userId: "user-1",
      action: "user_logged_in",
      redirectTo: "/cookbooks",
    });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/google"), "google", {
      state: "state",
      codeVerifier: "verifier",
      redirectTo: "/cookbooks",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/google/callback?state=state&code=code", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackLoader({ request, context: { cloudflare: { env: googleEnv } }, params: {} } as any);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/cookbooks");
    expect(response.headers.get("Set-Cookie")).toBeTruthy();
    expect(mocks.handleGoogleOAuthCallback).toHaveBeenCalledWith({
      db: { source: "db" },
      googleUser,
      currentUserId: null,
      redirectTo: "/cookbooks",
    });
  });

  it("passes current user ID for successful linking callbacks", async () => {
    const loginSession = await sessionStorage.getSession();
    loginSession.set("userId", "user-1");
    const loginCookie = await sessionStorage.commitSession(loginSession);
    const oauthCookie = await commitOAuthStartSession(
      new Request("https://spoonjoy.app/auth/google", { headers: { Cookie: cookieHeader(loginCookie) } }),
      "google",
      {
        state: "state",
        codeVerifier: "verifier",
        redirectTo: "/account/settings",
        failureRedirect: "/account/settings",
        linking: true,
      }
    );
    const googleUser = { id: "g1", email: "g@example.com", emailVerified: true, name: null, givenName: null, familyName: null, picture: null };
    mocks.verifyGoogleCallback.mockResolvedValueOnce({ success: true, googleUser });
    mocks.handleGoogleOAuthCallback.mockResolvedValueOnce({ success: true, userId: "user-1", action: "account_linked", redirectTo: "/account/settings" });

    const request = new Request("https://spoonjoy.app/auth/google/callback?state=state&code=code", {
      headers: { Cookie: `${cookieHeader(loginCookie)}; ${cookieHeader(oauthCookie)}` },
    });
    await callbackLoader({ request, context: { cloudflare: { env: googleEnv } }, params: {} } as any);

    expect(mocks.handleGoogleOAuthCallback).toHaveBeenCalledWith(expect.objectContaining({ currentUserId: "user-1" }));
  });

  it("rejects linking callbacks without a current user", async () => {
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/google"), "google", {
      state: "state",
      codeVerifier: "verifier",
      redirectTo: "/account/settings",
      failureRedirect: "/account/settings",
      linking: true,
    });
    mocks.verifyGoogleCallback.mockResolvedValueOnce({
      success: true,
      googleUser: { id: "g1", email: "g@example.com", emailVerified: true, name: null, givenName: null, familyName: null, picture: null },
    });
    const request = new Request("https://spoonjoy.app/auth/google/callback?state=state&code=code", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackLoader({ request, context: { cloudflare: { env: googleEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/account/settings?oauthError=login_required");
  });
});
