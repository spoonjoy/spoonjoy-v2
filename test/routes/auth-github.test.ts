// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { sessionStorage } from "~/lib/session.server";
import { commitOAuthStartSession } from "~/lib/oauth-route.server";

const mocks = vi.hoisted(() => ({
  createGitHubAuthorizationURL: vi.fn(() => new URL("https://github.com/login/oauth/authorize?state=mock-state")),
  verifyGitHubCallback: vi.fn(),
  handleGitHubOAuthCallback: vi.fn(),
  getRequestDb: vi.fn(() => ({ source: "db" })),
}));

vi.mock("~/lib/github-oauth.server", () => ({
  createGitHubAuthorizationURL: mocks.createGitHubAuthorizationURL,
  verifyGitHubCallback: mocks.verifyGitHubCallback,
}));

vi.mock("~/lib/github-oauth-callback.server", () => ({
  handleGitHubOAuthCallback: mocks.handleGitHubOAuthCallback,
}));

vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: mocks.getRequestDb,
}));

import { action, loader } from "~/routes/auth.github";
import GitHubOAuthRoute from "~/routes/auth.github";
import { loader as callbackLoader } from "~/routes/auth.github.callback";
import GitHubOAuthCallbackRoute from "~/routes/auth.github.callback";

const githubEnv = {
  GITHUB_CLIENT_ID: "github-client",
  GITHUB_CLIENT_SECRET: "github-secret",
};

function cookieHeader(setCookie: string) {
  return setCookie.split(";")[0];
}

describe("GitHub OAuth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initiates GitHub OAuth from POST and stores state", async () => {
    const request = new Request("https://spoonjoy.app/auth/github", { method: "POST" });
    const response = await action({ request, context: { cloudflare: { env: githubEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("github.com");
    expect(response.headers.get("Set-Cookie")).toBeTruthy();
    expect(mocks.createGitHubAuthorizationURL).toHaveBeenCalledWith(
      { clientId: "github-client", clientSecret: "github-secret" },
      "https://spoonjoy.app/auth/github/callback",
      expect.any(String)
    );
  });

  it("initiates GitHub OAuth from GET", async () => {
    const request = new Request("https://spoonjoy.app/auth/github?redirectTo=/cookbooks");
    const response = await loader({ request, context: { cloudflare: { env: githubEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("github.com");
  });

  it("redirects to OAuth error when GitHub env is missing", async () => {
    const request = new Request("https://spoonjoy.app/auth/github", {
      headers: { Referer: "https://spoonjoy.app/signup" },
    });
    const response = await loader({ request, context: { cloudflare: { env: {} } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/signup?oauthError=oauth_unconfigured");
  });

  it("requires login before starting a linking flow", async () => {
    const request = new Request("https://spoonjoy.app/auth/github?linking=true");
    const response = await loader({ request, context: { cloudflare: { env: githubEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?redirectTo=/account/settings&oauthError=login_required");
  });

  it("renders null route components", () => {
    expect(GitHubOAuthRoute()).toBeNull();
    expect(GitHubOAuthCallbackRoute()).toBeNull();
  });

  it("handles provider error callbacks", async () => {
    const request = new Request("https://spoonjoy.app/auth/github/callback?error=access_denied");
    const response = await callbackLoader({ request, context: { cloudflare: { env: githubEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?oauthError=access_denied");
  });

  it("rejects callbacks with missing stored state", async () => {
    const request = new Request("https://spoonjoy.app/auth/github/callback?state=state&code=code");
    const response = await callbackLoader({ request, context: { cloudflare: { env: githubEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_state");
  });

  it("rejects callbacks when stored and returned state differ", async () => {
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/github"), "github", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/github/callback?state=other&code=code", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackLoader({ request, context: { cloudflare: { env: githubEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_state");
  });

  it("rejects callbacks with stored state but no returned state", async () => {
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/github"), "github", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/github/callback?code=code", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackLoader({ request, context: { cloudflare: { env: githubEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_state");
  });

  it("redirects when callback env is missing", async () => {
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/github"), "github", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/github/callback?state=state&code=code", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackLoader({ request, context: { cloudflare: { env: {} } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=oauth_unconfigured");
  });

  it("redirects when GitHub verification fails", async () => {
    mocks.verifyGitHubCallback.mockResolvedValueOnce({ success: false, error: "invalid_code" });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/github"), "github", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/github/callback?state=state&code=bad", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackLoader({ request, context: { cloudflare: { env: githubEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_code");
  });

  it("passes an empty code to GitHub verification when the callback omits code", async () => {
    mocks.verifyGitHubCallback.mockResolvedValueOnce({ success: false, error: "invalid_code" });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/github"), "github", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/github/callback?state=state", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    await callbackLoader({ request, context: { cloudflare: { env: githubEnv } }, params: {} } as any);
    expect(mocks.verifyGitHubCallback).toHaveBeenCalledWith(
      { clientId: "github-client", clientSecret: "github-secret" },
      "https://spoonjoy.app/auth/github/callback",
      { code: "", state: "state" }
    );
  });

  it("redirects when GitHub verification succeeds without a user payload", async () => {
    mocks.verifyGitHubCallback.mockResolvedValueOnce({ success: true, githubUser: null });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/github"), "github", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/github/callback?state=state&code=code", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackLoader({ request, context: { cloudflare: { env: githubEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=oauth_error");
  });

  it("redirects when callback handler returns an error", async () => {
    mocks.verifyGitHubCallback.mockResolvedValueOnce({
      success: true,
      githubUser: { id: "gh1", email: "gh@example.com", emailVerified: true, login: "ghchef", name: null, avatarUrl: null },
    });
    mocks.handleGitHubOAuthCallback.mockResolvedValueOnce({
      success: false,
      error: "account_exists",
      redirectTo: "/recipes",
    });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/github"), "github", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/github/callback?state=state&code=code", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackLoader({ request, context: { cloudflare: { env: githubEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=account_exists");
  });

  it("creates a session on successful GitHub callback", async () => {
    const githubUser = { id: "gh1", email: "gh@example.com", emailVerified: true, login: "ghchef", name: "GitHub Chef", avatarUrl: null };
    mocks.verifyGitHubCallback.mockResolvedValueOnce({ success: true, githubUser });
    mocks.handleGitHubOAuthCallback.mockResolvedValueOnce({
      success: true,
      userId: "user-1",
      action: "user_logged_in",
      redirectTo: "/cookbooks",
    });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/github"), "github", {
      state: "state",
      redirectTo: "/cookbooks",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/github/callback?state=state&code=code", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackLoader({ request, context: { cloudflare: { env: githubEnv } }, params: {} } as any);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/cookbooks");
    expect(response.headers.get("Set-Cookie")).toBeTruthy();
    expect(mocks.handleGitHubOAuthCallback).toHaveBeenCalledWith({
      db: { source: "db" },
      githubUser,
      currentUserId: null,
      redirectTo: "/cookbooks",
    });
  });

  it("passes current user ID for successful linking callbacks", async () => {
    const loginSession = await sessionStorage.getSession();
    loginSession.set("userId", "user-1");
    const loginCookie = await sessionStorage.commitSession(loginSession);
    const oauthCookie = await commitOAuthStartSession(
      new Request("https://spoonjoy.app/auth/github", { headers: { Cookie: cookieHeader(loginCookie) } }),
      "github",
      {
        state: "state",
        redirectTo: "/account/settings",
        failureRedirect: "/account/settings",
        linking: true,
      }
    );
    const githubUser = { id: "gh1", email: "gh@example.com", emailVerified: true, login: "ghchef", name: null, avatarUrl: null };
    mocks.verifyGitHubCallback.mockResolvedValueOnce({ success: true, githubUser });
    mocks.handleGitHubOAuthCallback.mockResolvedValueOnce({ success: true, userId: "user-1", action: "account_linked", redirectTo: "/account/settings" });

    const request = new Request("https://spoonjoy.app/auth/github/callback?state=state&code=code", {
      headers: { Cookie: `${cookieHeader(loginCookie)}; ${cookieHeader(oauthCookie)}` },
    });
    await callbackLoader({ request, context: { cloudflare: { env: githubEnv } }, params: {} } as any);

    expect(mocks.handleGitHubOAuthCallback).toHaveBeenCalledWith(expect.objectContaining({ currentUserId: "user-1" }));
  });

  it("rejects linking callbacks without a current user", async () => {
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/github"), "github", {
      state: "state",
      redirectTo: "/account/settings",
      failureRedirect: "/account/settings",
      linking: true,
    });
    mocks.verifyGitHubCallback.mockResolvedValueOnce({
      success: true,
      githubUser: { id: "gh1", email: "gh@example.com", emailVerified: true, login: "ghchef", name: null, avatarUrl: null },
    });
    const request = new Request("https://spoonjoy.app/auth/github/callback?state=state&code=code", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackLoader({ request, context: { cloudflare: { env: githubEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/account/settings?oauthError=login_required");
  });
});
