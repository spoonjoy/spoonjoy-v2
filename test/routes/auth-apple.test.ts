// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sessionStorage } from "~/lib/session.server";
import { commitOAuthStartSession } from "~/lib/oauth-route.server";

const mocks = vi.hoisted(() => ({
  createAppleAuthorizationURL: vi.fn(() => new URL("https://appleid.apple.com/auth/authorize?state=mock-state")),
  verifyAppleCallback: vi.fn(),
  handleAppleOAuthCallback: vi.fn(),
  getRequestDb: vi.fn(() => ({ source: "db" })),
}));

vi.mock("~/lib/apple-oauth.server", () => ({
  createAppleAuthorizationURL: mocks.createAppleAuthorizationURL,
  verifyAppleCallback: mocks.verifyAppleCallback,
  serializeAppleAuthorizationURL: (url: URL) => url.toString(),
}));

vi.mock("~/lib/apple-oauth-callback.server", () => ({
  handleAppleOAuthCallback: mocks.handleAppleOAuthCallback,
}));

vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: mocks.getRequestDb,
}));

import { action, loader } from "~/routes/auth.apple";
import AppleOAuthRoute from "~/routes/auth.apple";
import { action as callbackAction, loader as callbackLoader } from "~/routes/auth.apple.callback";
import AppleOAuthCallbackRoute from "~/routes/auth.apple.callback";
import { action as legacyCallbackAction } from "~/routes/redwood-functions-auth-oauth";

const appleEnv = {
  APPLE_CLIENT_ID: "apple-client",
  APPLE_TEAM_ID: "apple-team",
  APPLE_KEY_ID: "apple-key",
  APPLE_PRIVATE_KEY: "apple-private-key",
};
const appleRedirectUri = "https://spoonjoy.app/auth/apple/callback";
const legacyAppleRedirectUri = "https://spoonjoy.app/.redwood/functions/auth/oauth?method=loginWithApple";

function cookieHeader(setCookie: string) {
  return setCookie.split(";")[0];
}

describe("Apple OAuth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initiates Apple OAuth from POST and stores state", async () => {
    const request = new Request("https://spoonjoy.app/auth/apple", { method: "POST" });
    const response = await action({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("appleid.apple.com");
    expect(response.headers.get("Set-Cookie")).toContain("__oauth=");
    expect(response.headers.get("Set-Cookie")).toContain("SameSite=None");
    expect(mocks.createAppleAuthorizationURL).toHaveBeenCalledWith(
      {
        clientId: "apple-client",
        teamId: "apple-team",
        keyId: "apple-key",
        privateKey: "apple-private-key",
      },
      appleRedirectUri,
      expect.any(String)
    );
  });

  it("initiates Apple OAuth from GET", async () => {
    const request = new Request("https://spoonjoy.app/auth/apple?redirectTo=/cookbooks");
    const response = await loader({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("appleid.apple.com");
  });

  it("redirects to OAuth error when Apple env is missing", async () => {
    const request = new Request("https://spoonjoy.app/auth/apple", {
      headers: { Referer: "https://spoonjoy.app/signup" },
    });
    const response = await loader({ request, context: { cloudflare: { env: {} } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/signup?oauthError=oauth_unconfigured");
  });

  it("redirects to OAuth error when the Apple private key PEM is malformed", async () => {
    const request = new Request("https://spoonjoy.app/auth/apple", {
      headers: { Referer: "https://spoonjoy.app/signup" },
    });
    mocks.createAppleAuthorizationURL.mockImplementationOnce(() => {
      throw new Error("bad private key");
    });

    const response = await loader({
      request,
      context: { cloudflare: { env: appleEnv } },
      params: {},
    } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/signup?oauthError=oauth_unconfigured");
  });

  it("requires login before starting a linking flow", async () => {
    const request = new Request("https://spoonjoy.app/auth/apple?linking=true");
    const response = await loader({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?redirectTo=/account/settings&oauthError=login_required");
  });

  it("renders null route components", () => {
    expect(AppleOAuthRoute()).toBeNull();
    expect(AppleOAuthCallbackRoute()).toBeNull();
  });

  it("rejects GET callbacks because Apple uses form_post", async () => {
    const request = new Request("https://spoonjoy.app/auth/apple/callback");
    const response = await callbackLoader({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_request");
  });

  it("accepts canonical Apple form_post callbacks with urlencoded bodies", async () => {
    const appleUser = { id: "a1", email: "a@example.com", emailVerified: true, isPrivateEmail: false, firstName: "A", lastName: "User", fullName: "A User" };
    mocks.verifyAppleCallback.mockResolvedValueOnce({ success: true, appleUser });
    mocks.handleAppleOAuthCallback.mockResolvedValueOnce({ success: true, userId: "user-1", action: "user_logged_in", redirectTo: "/recipes" });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/apple"), "apple", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
      redirectUri: appleRedirectUri,
    });
    const body = new URLSearchParams({
      state: "state",
      code: "code",
      user: "{\"name\":{\"firstName\":\"A\",\"lastName\":\"User\"}}",
    });
    const request = new Request(appleRedirectUri, {
      method: "POST",
      body,
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackAction({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/recipes");
    expect(mocks.verifyAppleCallback).toHaveBeenCalledWith(
      {
        clientId: "apple-client",
        teamId: "apple-team",
        keyId: "apple-key",
        privateKey: "apple-private-key",
      },
      appleRedirectUri,
      {
        code: "code",
        state: "state",
        user: "{\"name\":{\"firstName\":\"A\",\"lastName\":\"User\"}}",
      }
    );
  });

  it("keeps legacy Apple form_post callbacks working for in-flight auth sessions", async () => {
    const appleUser = { id: "a1", email: "a@example.com", emailVerified: true, isPrivateEmail: false, firstName: "A", lastName: "User", fullName: "A User" };
    mocks.verifyAppleCallback.mockResolvedValueOnce({ success: true, appleUser });
    mocks.handleAppleOAuthCallback.mockResolvedValueOnce({ success: true, userId: "user-1", action: "user_logged_in", redirectTo: "/recipes" });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/apple"), "apple", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
      redirectUri: legacyAppleRedirectUri,
    });
    const body = new URLSearchParams({
      state: "state",
      code: "code",
      user: "{\"name\":{\"firstName\":\"A\",\"lastName\":\"User\"}}",
    });
    const request = new Request(legacyAppleRedirectUri, {
      method: "POST",
      body,
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await legacyCallbackAction({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/recipes");
    expect(mocks.verifyAppleCallback).toHaveBeenCalledWith(
      {
        clientId: "apple-client",
        teamId: "apple-team",
        keyId: "apple-key",
        privateKey: "apple-private-key",
      },
      legacyAppleRedirectUri,
      {
        code: "code",
        state: "state",
        user: "{\"name\":{\"firstName\":\"A\",\"lastName\":\"User\"}}",
      }
    );
  });

  it("accepts canonical Apple form_post callbacks with missing or generic content type", async () => {
    mocks.verifyAppleCallback.mockResolvedValueOnce({ success: false, error: "invalid_code" });
    const userPayload = "{\"name\":{\"firstName\":\"A\"}}";
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/apple"), "apple", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
      redirectUri: appleRedirectUri,
    });
    const request = new Request(appleRedirectUri, {
      method: "POST",
      body: `state=state&code=bad&user=${encodeURIComponent(userPayload)}`,
      headers: {
        Cookie: cookieHeader(cookie),
        "Content-Type": "text/plain",
      },
    });

    const response = await callbackAction({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_code");
    expect(mocks.verifyAppleCallback).toHaveBeenCalledWith(
      {
        clientId: "apple-client",
        teamId: "apple-team",
        keyId: "apple-key",
        privateKey: "apple-private-key",
      },
      appleRedirectUri,
      {
        code: "bad",
        state: "state",
        user: userPayload,
      }
    );
  });

  it("falls back to raw body parsing when multipart Apple callback parsing fails", async () => {
    mocks.verifyAppleCallback.mockResolvedValueOnce({ success: false, error: "invalid_code" });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/apple"), "apple", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
      redirectUri: appleRedirectUri,
    });
    const request = new Request(appleRedirectUri, {
      method: "POST",
      body: "state=state&code=bad",
      headers: {
        Cookie: cookieHeader(cookie),
        "Content-Type": "multipart/form-data",
      },
    });

    const response = await callbackAction({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_code");
  });

  it("accepts canonical Apple form_post callbacks with no content type", async () => {
    mocks.verifyAppleCallback.mockResolvedValueOnce({ success: false, error: "invalid_code" });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/apple"), "apple", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
      redirectUri: appleRedirectUri,
    });
    const request = new Request(appleRedirectUri, {
      method: "POST",
      body: new TextEncoder().encode("state=state&code=bad"),
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackAction({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_code");
  });

  it("handles provider error callbacks", async () => {
    const formData = new FormData();
    formData.set("error", "access_denied");
    formData.set("ignored-file", new Blob(["not an oauth field"]), "ignored.txt");
    const request = new Request("https://spoonjoy.app/auth/apple/callback", { method: "POST", body: formData });
    const response = await callbackAction({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?oauthError=access_denied");
  });

  it("rejects callbacks with missing stored state", async () => {
    const formData = new FormData();
    formData.set("state", "state");
    formData.set("code", "code");
    const request = new Request("https://spoonjoy.app/auth/apple/callback", { method: "POST", body: formData });

    const response = await callbackAction({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_state");
  });

  it("rejects callbacks when stored and returned state differ", async () => {
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/apple"), "apple", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const formData = new FormData();
    formData.set("state", "other");
    formData.set("code", "code");
    const request = new Request("https://spoonjoy.app/auth/apple/callback", {
      method: "POST",
      body: formData,
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackAction({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_state");
  });

  it("rejects callbacks with stored state but no returned state", async () => {
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/apple"), "apple", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const formData = new FormData();
    formData.set("code", "code");
    const request = new Request("https://spoonjoy.app/auth/apple/callback", {
      method: "POST",
      body: formData,
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackAction({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_state");
  });

  it("redirects when callback env is missing", async () => {
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/apple"), "apple", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const formData = new FormData();
    formData.set("state", "state");
    formData.set("code", "code");
    const request = new Request("https://spoonjoy.app/auth/apple/callback", {
      method: "POST",
      body: formData,
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackAction({ request, context: { cloudflare: { env: {} } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=oauth_unconfigured");
  });

  it("redirects when Apple verification fails", async () => {
    mocks.verifyAppleCallback.mockResolvedValueOnce({ success: false, error: "invalid_code" });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/apple"), "apple", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const formData = new FormData();
    formData.set("state", "state");
    formData.set("code", "bad");
    const request = new Request("https://spoonjoy.app/auth/apple/callback", {
      method: "POST",
      body: formData,
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackAction({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_code");
  });

  it("passes empty callback values to Apple verification when optional fields are omitted", async () => {
    mocks.verifyAppleCallback.mockResolvedValueOnce({ success: false, error: "invalid_code" });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/apple"), "apple", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const formData = new FormData();
    formData.set("state", "state");
    const request = new Request("https://spoonjoy.app/auth/apple/callback", {
      method: "POST",
      body: formData,
      headers: { Cookie: cookieHeader(cookie) },
    });

    await callbackAction({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);
    expect(mocks.verifyAppleCallback).toHaveBeenCalledWith(
      {
        clientId: "apple-client",
        teamId: "apple-team",
        keyId: "apple-key",
        privateKey: "apple-private-key",
      },
      appleRedirectUri,
      { code: "", state: "state", user: undefined }
    );
  });

  it("redirects when Apple verification succeeds without a user payload", async () => {
    mocks.verifyAppleCallback.mockResolvedValueOnce({ success: true, appleUser: null });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/apple"), "apple", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const formData = new FormData();
    formData.set("state", "state");
    formData.set("code", "code");
    const request = new Request("https://spoonjoy.app/auth/apple/callback", {
      method: "POST",
      body: formData,
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackAction({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=oauth_error");
  });

  it("redirects when callback handler returns an error", async () => {
    mocks.verifyAppleCallback.mockResolvedValueOnce({
      success: true,
      appleUser: { id: "a1", email: "a@example.com", emailVerified: true, isPrivateEmail: false, firstName: null, lastName: null, fullName: null },
    });
    mocks.handleAppleOAuthCallback.mockResolvedValueOnce({
      success: false,
      error: "account_exists",
      redirectTo: "/recipes",
    });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/apple"), "apple", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const formData = new FormData();
    formData.set("state", "state");
    formData.set("code", "code");
    const request = new Request("https://spoonjoy.app/auth/apple/callback", {
      method: "POST",
      body: formData,
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackAction({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/login?oauthError=account_exists");
  });

  it("creates a session on successful Apple callback", async () => {
    const appleUser = { id: "a1", email: "a@example.com", emailVerified: true, isPrivateEmail: false, firstName: "A", lastName: "User", fullName: "A User" };
    mocks.verifyAppleCallback.mockResolvedValueOnce({ success: true, appleUser });
    mocks.handleAppleOAuthCallback.mockResolvedValueOnce({ success: true, userId: "user-1", action: "user_logged_in", redirectTo: "/cookbooks" });
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/apple"), "apple", {
      state: "state",
      redirectTo: "/cookbooks",
      failureRedirect: "/login",
      linking: false,
    });
    const formData = new FormData();
    formData.set("state", "state");
    formData.set("code", "code");
    formData.set("user", "{\"name\":{\"firstName\":\"A\"}}");
    const request = new Request("https://spoonjoy.app/auth/apple/callback", {
      method: "POST",
      body: formData,
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackAction({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/cookbooks");
    expect(response.headers.get("Set-Cookie")).toContain("__session=");
    expect(response.headers.get("Set-Cookie")).toContain("__oauth=");
    expect(mocks.handleAppleOAuthCallback).toHaveBeenCalledWith({
      db: { source: "db" },
      appleUser,
      currentUserId: null,
      redirectTo: "/cookbooks",
    });
  });

  it("passes current user ID for successful linking callbacks", async () => {
    const loginSession = await sessionStorage.getSession();
    loginSession.set("userId", "user-1");
    let cookie = await sessionStorage.commitSession(loginSession);
    cookie = await commitOAuthStartSession(
      new Request("https://spoonjoy.app/auth/apple", { headers: { Cookie: cookieHeader(cookie) } }),
      "apple",
      {
        state: "state",
        redirectTo: "/account/settings",
        failureRedirect: "/account/settings",
        linking: true,
        linkingUserId: "user-1",
      }
    );
    const appleUser = { id: "a1", email: "a@example.com", emailVerified: true, isPrivateEmail: false, firstName: null, lastName: null, fullName: null };
    mocks.verifyAppleCallback.mockResolvedValueOnce({ success: true, appleUser });
    mocks.handleAppleOAuthCallback.mockResolvedValueOnce({ success: true, userId: "user-1", action: "account_linked", redirectTo: "/account/settings" });
    const formData = new FormData();
    formData.set("state", "state");
    formData.set("code", "code");
    const request = new Request("https://spoonjoy.app/auth/apple/callback", {
      method: "POST",
      body: formData,
      headers: { Cookie: cookieHeader(cookie) },
    });

    await callbackAction({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);
    expect(mocks.handleAppleOAuthCallback).toHaveBeenCalledWith(expect.objectContaining({ currentUserId: "user-1" }));
  });

  it("rejects linking callbacks without a current user", async () => {
    const cookie = await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/apple"), "apple", {
      state: "state",
      redirectTo: "/account/settings",
      failureRedirect: "/account/settings",
      linking: true,
    });
    mocks.verifyAppleCallback.mockResolvedValueOnce({
      success: true,
      appleUser: { id: "a1", email: "a@example.com", emailVerified: true, isPrivateEmail: false, firstName: null, lastName: null, fullName: null },
    });
    const formData = new FormData();
    formData.set("state", "state");
    formData.set("code", "code");
    const request = new Request("https://spoonjoy.app/auth/apple/callback", {
      method: "POST",
      body: formData,
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await callbackAction({ request, context: { cloudflare: { env: appleEnv } }, params: {} } as any);
    expect(response.headers.get("Location")).toBe("/account/settings?oauthError=login_required");
  });
});
