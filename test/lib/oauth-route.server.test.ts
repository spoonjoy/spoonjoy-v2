// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  appendOAuthError,
  assertCanStartOAuthLinking,
  buildOAuthCallbackUrl,
  commitOAuthStartSession,
  generateOAuthState,
  getOAuthEnv,
  isValidOAuthState,
  readOAuthStartSession,
  redirectWithOAuthError,
  resolveOAuthStartSessionData,
  sanitizeInternalRedirect,
} from "~/lib/oauth-route.server";
import { sessionStorage } from "~/lib/session.server";

function cookieHeader(setCookie: string) {
  return setCookie.split(";")[0];
}

describe("oauth-route.server", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates a state token", () => {
    const state = generateOAuthState();
    expect(typeof state).toBe("string");
    expect(state.length).toBeGreaterThan(0);
  });

  it("returns Cloudflare env when present and process.env otherwise", () => {
    const env = { GOOGLE_CLIENT_ID: "cf-client" } as Env;
    expect(getOAuthEnv({ cloudflare: { env } })).toBe(env);
    expect(getOAuthEnv({ cloudflare: { env: null } })).toBe(process.env);
    expect(getOAuthEnv({})).toBe(process.env);
  });

  it("builds provider callback URLs from request origin", () => {
    const request = new Request("https://spoonjoy.app/auth/google");
    expect(buildOAuthCallbackUrl(request, "google")).toBe("https://spoonjoy.app/auth/google/callback");
    expect(buildOAuthCallbackUrl(request, "github")).toBe("https://spoonjoy.app/auth/github/callback");
    expect(buildOAuthCallbackUrl(request, "apple")).toBe("https://spoonjoy.app/auth/apple/callback");
  });

  it("builds provider callback URLs from forwarded public origin", () => {
    const request = new Request("https://spoonjoy-v2.mendelow-studio.workers.dev/auth/github", {
      headers: {
        "X-Forwarded-Host": "spoonjoy.app",
        "X-Forwarded-Proto": "https",
      },
    });

    expect(buildOAuthCallbackUrl(request, "github")).toBe("https://spoonjoy.app/auth/github/callback");
  });

  it("allows forwarded http origins for local proxy callback URLs", () => {
    const request = new Request("https://spoonjoy-v2.mendelow-studio.workers.dev/auth/google", {
      headers: {
        "X-Forwarded-Host": "local.spoonjoy.app:8787",
        "X-Forwarded-Proto": "http",
      },
    });

    expect(buildOAuthCallbackUrl(request, "google")).toBe("http://local.spoonjoy.app:8787/auth/google/callback");
  });

  it("defaults forwarded callback URLs to https when the forwarded proto is missing", () => {
    const request = new Request("https://spoonjoy-v2.mendelow-studio.workers.dev/auth/apple", {
      headers: {
        "X-Forwarded-Host": "spoonjoy.app",
      },
    });

    expect(buildOAuthCallbackUrl(request, "apple")).toBe("https://spoonjoy.app/auth/apple/callback");
  });

  it("ignores malformed forwarded hosts for provider callback URLs", () => {
    const request = new Request("https://spoonjoy-v2.mendelow-studio.workers.dev/auth/apple", {
      headers: {
        "X-Forwarded-Host": "spoonjoy.app/evil",
        "X-Forwarded-Proto": "https",
      },
    });

    expect(buildOAuthCallbackUrl(request, "apple")).toBe(
      "https://spoonjoy-v2.mendelow-studio.workers.dev/auth/apple/callback"
    );
  });

  it("sanitizes redirects to internal paths only", () => {
    expect(sanitizeInternalRedirect("/recipes", "/fallback")).toBe("/recipes");
    expect(sanitizeInternalRedirect("//evil.example", "/fallback")).toBe("/fallback");
    expect(sanitizeInternalRedirect("https://evil.example", "/fallback")).toBe("/fallback");
    expect(sanitizeInternalRedirect(null, "/fallback")).toBe("/fallback");
  });

  it("resolves default login OAuth session data", () => {
    const request = new Request("https://spoonjoy.app/auth/google");
    expect(resolveOAuthStartSessionData(request, "state", { codeVerifier: "verifier" })).toEqual({
      state: "state",
      codeVerifier: "verifier",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
  });

  it("resolves signup failure redirect from same-origin referer", () => {
    const request = new Request("https://spoonjoy.app/auth/google", {
      headers: { Referer: "https://spoonjoy.app/signup" },
    });

    expect(resolveOAuthStartSessionData(request, "state").failureRedirect).toBe("/signup");
  });

  it("ignores cross-origin and malformed referers", () => {
    const crossOrigin = new Request("https://spoonjoy.app/auth/google", {
      headers: { Referer: "https://evil.example/signup" },
    });
    const malformed = new Request("https://spoonjoy.app/auth/google", {
      headers: { Referer: "not a url" },
    });

    expect(resolveOAuthStartSessionData(crossOrigin, "state").failureRedirect).toBe("/login");
    expect(resolveOAuthStartSessionData(malformed, "state").failureRedirect).toBe("/login");
  });

  it("resolves linking redirects and sanitizes requested redirect targets", () => {
    const request = new Request(
      "https://spoonjoy.app/auth/google?linking=true&redirectTo=https://evil.example&failureRedirect=/bad"
    );

    expect(resolveOAuthStartSessionData(request, "state")).toEqual({
      state: "state",
      codeVerifier: undefined,
      redirectTo: "/account/settings",
      failureRedirect: "/account/settings",
      linking: true,
    });
  });

  it("uses safe requested redirect and failure paths for non-linking starts", () => {
    const request = new Request(
      "https://spoonjoy.app/auth/google?redirectTo=/cookbooks&failureRedirect=/signup"
    );

    expect(resolveOAuthStartSessionData(request, "state")).toMatchObject({
      redirectTo: "/cookbooks",
      failureRedirect: "/signup",
      linking: false,
    });
  });

  it("allows non-linking starts without a user", async () => {
    const request = new Request("https://spoonjoy.app/auth/google");
    const data = resolveOAuthStartSessionData(request, "state");
    await expect(assertCanStartOAuthLinking(request, data)).resolves.toBeNull();
  });

  it("allows linking starts when a user session exists", async () => {
    const session = await sessionStorage.getSession();
    session.set("userId", "user-1");
    const cookie = await sessionStorage.commitSession(session);
    const request = new Request("https://spoonjoy.app/auth/google?linking=true", {
      headers: { Cookie: cookieHeader(cookie) },
    });
    const data = resolveOAuthStartSessionData(request, "state");

    await expect(assertCanStartOAuthLinking(request, data)).resolves.toBeNull();
  });

  it("redirects linking starts without a user session", async () => {
    const request = new Request("https://spoonjoy.app/auth/google?linking=true");
    const data = resolveOAuthStartSessionData(request, "state");
    const response = await assertCanStartOAuthLinking(request, data);

    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(302);
    expect(response?.headers.get("Location")).toBe("/login?redirectTo=/account/settings&oauthError=login_required");
  });

  it("commits and reads OAuth session data with a code verifier", async () => {
    const request = new Request("https://spoonjoy.app/auth/google");
    const cookie = await commitOAuthStartSession(request, "google", {
      state: "state",
      codeVerifier: "verifier",
      redirectTo: "/cookbooks",
      failureRedirect: "/signup",
      linking: false,
    });

    const readRequest = new Request("https://spoonjoy.app/auth/google/callback", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    await expect(readOAuthStartSession(readRequest, "google")).resolves.toEqual({
      state: "state",
      codeVerifier: "verifier",
      redirectTo: "/cookbooks",
      failureRedirect: "/signup",
      linking: false,
    });
  });

  it("commits and reads OAuth session data without a code verifier", async () => {
    const request = new Request("https://spoonjoy.app/auth/apple");
    const cookie = await commitOAuthStartSession(request, "apple", {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: true,
    });

    const readRequest = new Request("https://spoonjoy.app/auth/apple/callback", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    await expect(readOAuthStartSession(readRequest, "apple")).resolves.toEqual({
      state: "state",
      codeVerifier: undefined,
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: true,
    });
  });

  it("falls back to safe redirects when stored OAuth redirect values are missing", async () => {
    const session = await sessionStorage.getSession();
    session.set("oauth:google:state", "state");
    const cookie = await sessionStorage.commitSession(session);
    const request = new Request("https://spoonjoy.app/auth/google/callback", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    await expect(readOAuthStartSession(request, "google")).resolves.toEqual({
      state: "state",
      codeVerifier: undefined,
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
  });

  it("returns null when no OAuth state is stored", async () => {
    const request = new Request("https://spoonjoy.app/auth/google/callback");
    await expect(readOAuthStartSession(request, "google")).resolves.toBeNull();
  });

  it("appends OAuth error parameters", () => {
    expect(appendOAuthError("/login", "invalid_state")).toBe("/login?oauthError=invalid_state");
    expect(appendOAuthError("/login?next=1", undefined)).toBe("/login?next=1&oauthError=oauth_error");
  });

  it("redirects with OAuth error and clears stored state", async () => {
    const start = new Request("https://spoonjoy.app/auth/google");
    const cookie = await commitOAuthStartSession(start, "google", {
      state: "state",
      codeVerifier: "verifier",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
    });
    const request = new Request("https://spoonjoy.app/auth/google/callback", {
      headers: { Cookie: cookieHeader(cookie) },
    });

    const response = await redirectWithOAuthError(request, "google", "/login", "invalid_state");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_state");

    const nextRequest = new Request("https://spoonjoy.app/auth/google/callback", {
      headers: { Cookie: cookieHeader(response.headers.get("Set-Cookie") ?? "") },
    });
    await expect(readOAuthStartSession(nextRequest, "google")).resolves.toBeNull();
  });

  it("validates OAuth state", () => {
    expect(isValidOAuthState("state", "state")).toBe(true);
    expect(isValidOAuthState("state", "other")).toBe(false);
    expect(isValidOAuthState(undefined, "state")).toBe(false);
    expect(isValidOAuthState("state", null)).toBe(false);
  });
});
