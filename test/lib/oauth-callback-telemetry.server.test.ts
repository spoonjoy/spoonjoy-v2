// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppLoadContext } from "react-router";
import { commitOAuthStartSession } from "~/lib/oauth-route.server";

// Mock the verify helpers so each callback test can drive a specific failure
// (dark exit, deep provider capture, or unexpected throw) without real OAuth.
const verifyMocks = vi.hoisted(() => ({
  verifyAppleCallback: vi.fn(),
  verifyGitHubCallback: vi.fn(),
  verifyGoogleCallback: vi.fn(),
}));

const callbackMocks = vi.hoisted(() => ({
  handleGitHubOAuthCallback: vi.fn(),
}));

vi.mock("~/lib/apple-oauth.server", () => ({ verifyAppleCallback: verifyMocks.verifyAppleCallback }));
vi.mock("~/lib/github-oauth.server", () => ({ verifyGitHubCallback: verifyMocks.verifyGitHubCallback }));
vi.mock("~/lib/google-oauth.server", () => ({ verifyGoogleCallback: verifyMocks.verifyGoogleCallback }));
vi.mock("~/lib/github-oauth-callback.server", () => ({
  handleGitHubOAuthCallback: callbackMocks.handleGitHubOAuthCallback,
}));

// Real config resolution would need env; stub the config getters to succeed by
// default so we reach the verify step. Individual tests override to throw.
const configMocks = vi.hoisted(() => ({
  getAppleOAuthConfig: vi.fn(() => ({ clientId: "apple" })),
  getGitHubOAuthConfig: vi.fn(() => ({ clientId: "github" })),
  getGoogleOAuthConfig: vi.fn(() => ({ clientId: "google" })),
}));

vi.mock("~/lib/env.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/env.server")>()),
  getAppleOAuthConfig: configMocks.getAppleOAuthConfig,
  getGitHubOAuthConfig: configMocks.getGitHubOAuthConfig,
  getGoogleOAuthConfig: configMocks.getGoogleOAuthConfig,
}));

vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: vi.fn(async () => ({}) as never),
}));

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureException: vi.fn(() => Promise.resolve()),
  captureEvent: vi.fn(() => Promise.resolve()),
}));

import { captureEvent, captureException } from "~/lib/analytics-server";
import {
  handleAppleCallback,
  handleGitHubCallback,
  handleGoogleCallback,
} from "~/lib/oauth-callback-route.server";

const POSTHOG_ENV = { POSTHOG_KEY: "ph_test" };

function telemetryContext(env: Record<string, unknown> = POSTHOG_ENV) {
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    void promise;
  });
  return {
    waitUntil,
    context: { cloudflare: { env, ctx: { waitUntil } } } as unknown as AppLoadContext,
  };
}

function cookieHeader(setCookie: string) {
  return setCookie.split(";")[0];
}

async function storedCookie(provider: "apple" | "github" | "google", overrides: Record<string, unknown> = {}) {
  return cookieHeader(
    await commitOAuthStartSession(new Request(`https://spoonjoy.app/auth/${provider}`), provider, {
      state: "state",
      redirectTo: "/recipes",
      failureRedirect: "/login",
      linking: false,
      codeVerifier: provider === "google" ? "verifier" : undefined,
      redirectUri: `https://spoonjoy.app/auth/${provider}/callback`,
      ...overrides,
    }),
  );
}

function socialCallbackEvents() {
  return vi.mocked(captureEvent).mock.calls
    .map(([, input]) => input)
    .filter((input) => input.event === "spoonjoy.oauth.social_callback");
}

function expectScheduled(waitUntil: ReturnType<typeof vi.fn>) {
  expect(waitUntil).toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  configMocks.getAppleOAuthConfig.mockReturnValue({ clientId: "apple" });
  configMocks.getGitHubOAuthConfig.mockReturnValue({ clientId: "github" });
  configMocks.getGoogleOAuthConfig.mockReturnValue({ clientId: "google" });
  callbackMocks.handleGitHubOAuthCallback.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OAuth social-callback telemetry", () => {
  describe("dark-exit events", () => {
    it("captures a provider_error event (Apple)", async () => {
      const { context, waitUntil } = telemetryContext();
      const body = new URLSearchParams({ error: "access_denied" });
      const request = new Request("https://spoonjoy.app/auth/apple/callback", { method: "POST", body });

      const response = await handleAppleCallback(request, context);

      expect(response.headers.get("Location")).toBe("/login?oauthError=access_denied");
      expect(socialCallbackEvents()).toContainEqual({
        event: "spoonjoy.oauth.social_callback",
        distinctId: "server",
        properties: { provider: "apple", outcome: "error", error_code: "access_denied", phase: "provider_error" },
      });
      expectScheduled(waitUntil);
    });

    it("captures an invalid_state event when no session is stored (GitHub)", async () => {
      const { context } = telemetryContext();
      const request = new Request("https://spoonjoy.app/auth/github/callback?state=state&code=c");

      await handleGitHubCallback(request, context);

      expect(socialCallbackEvents()).toContainEqual({
        event: "spoonjoy.oauth.social_callback",
        distinctId: "server",
        properties: { provider: "github", outcome: "error", error_code: "invalid_state", phase: "invalid_state" },
      });
    });

    it("captures an invalid_state event on a state mismatch (Google)", async () => {
      const { context } = telemetryContext();
      const cookie = await storedCookie("google");
      const request = new Request("https://spoonjoy.app/auth/google/callback?state=other&code=c", {
        headers: { Cookie: cookie },
      });

      await handleGoogleCallback(request, context);

      expect(socialCallbackEvents().at(-1)).toMatchObject({
        properties: { provider: "google", error_code: "invalid_state", phase: "invalid_state" },
      });
    });

    it("captures an invalid_code_verifier event (Google)", async () => {
      const { context } = telemetryContext();
      const cookie = await storedCookie("google", { codeVerifier: undefined });
      const request = new Request("https://spoonjoy.app/auth/google/callback?state=state&code=c", {
        headers: { Cookie: cookie },
      });

      await handleGoogleCallback(request, context);

      expect(socialCallbackEvents().at(-1)).toMatchObject({
        properties: { provider: "google", error_code: "invalid_code_verifier", phase: "invalid_code_verifier" },
      });
    });
  });

  describe("config failures", () => {
    it("captures the config exception + a config event (Apple)", async () => {
      const { context } = telemetryContext();
      const configError = new Error("APPLE_PRIVATE_KEY missing");
      configMocks.getAppleOAuthConfig.mockImplementation(() => {
        throw configError;
      });
      const cookie = await storedCookie("apple");
      const body = new URLSearchParams({ state: "state", code: "c" });
      const request = new Request("https://spoonjoy.app/auth/apple/callback", {
        method: "POST",
        body,
        headers: { Cookie: cookie },
      });

      const response = await handleAppleCallback(request, context);

      expect(response.headers.get("Location")).toBe("/login?oauthError=oauth_unconfigured");
      expect(captureException).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ error: configError, extras: { provider: "apple", phase: "config" } }),
      );
      expect(socialCallbackEvents().at(-1)).toMatchObject({
        properties: { provider: "apple", error_code: "oauth_unconfigured", phase: "config" },
      });
    });
  });

  describe("deep provider capture (verify helper invokes its capture callback)", () => {
    it("threads provider + phase + upstream classification through to callback telemetry", async () => {
      const { context } = telemetryContext();
      verifyMocks.verifyGoogleCallback.mockImplementation(async (_cfg, _uri, _data, capture) => {
        capture?.({
          error: new Error("userinfo 503"),
          phase: "userinfo",
          httpStatus: 503,
          failureKind: "upstream",
          retryable: true,
        });
        return {
          success: false,
          error: "upstream_error",
          failureKind: "upstream",
          retryable: true,
        };
      });
      const cookie = await storedCookie("google");
      const request = new Request("https://spoonjoy.app/auth/google/callback?state=state&code=c", {
        headers: { Cookie: cookie },
      });

      const response = await handleGoogleCallback(request, context);

      expect(response.headers.get("Location")).toBe("/login?oauthError=upstream_error");
      expect(captureException).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          extras: {
            provider: "google",
            phase: "userinfo",
            httpStatus: 503,
            failure_kind: "upstream",
            retryable: true,
          },
        }),
      );
      // The flattened verify failure also emits a verify-phase social event.
      expect(socialCallbackEvents().at(-1)).toMatchObject({
        properties: {
          provider: "google",
          error_code: "upstream_error",
          phase: "verify",
          failure_kind: "upstream",
          retryable: true,
        },
      });
    });

    it("classifies a provider timeout as retryable without collapsing it to upstream failure", async () => {
      const { context } = telemetryContext();
      verifyMocks.verifyGitHubCallback.mockResolvedValueOnce({
        success: false,
        error: "provider_timeout",
        failureKind: "timeout",
        retryable: true,
      });
      const cookie = await storedCookie("github");
      const request = new Request("https://spoonjoy.app/auth/github/callback?state=state&code=c", {
        headers: { Cookie: cookie },
      });

      const response = await handleGitHubCallback(request, context);

      expect(response.headers.get("Location")).toBe("/login?oauthError=provider_timeout");
      expect(socialCallbackEvents().at(-1)).toMatchObject({
        properties: {
          provider: "github",
          error_code: "provider_timeout",
          phase: "verify",
          failure_kind: "timeout",
          retryable: true,
        },
      });
    });

    it.each([
      ["provider_timeout", "timeout"],
      ["network_error", "network"],
      ["upstream_error", "upstream"],
    ])("derives %s callback telemetry when a compatible verifier omits metadata", async (error, failureKind) => {
      const { context } = telemetryContext();
      verifyMocks.verifyGoogleCallback.mockResolvedValueOnce({ success: false, error });
      const cookie = await storedCookie("google");
      const request = new Request("https://spoonjoy.app/auth/google/callback?state=state&code=c", {
        headers: { Cookie: cookie },
      });

      await handleGoogleCallback(request, context);

      expect(socialCallbackEvents().at(-1)).toMatchObject({
        properties: {
          provider: "google",
          error_code: error,
          failure_kind: failureKind,
          retryable: true,
        },
      });
    });

    it("classifies genuinely missing GitHub verified email as non-retryable missing_email", async () => {
      const { context } = telemetryContext();
      verifyMocks.verifyGitHubCallback.mockResolvedValueOnce({
        success: true,
        githubUser: {
          id: "github-user",
          email: null,
          emailVerified: false,
          login: "chef",
          name: null,
          avatarUrl: null,
        },
      });
      callbackMocks.handleGitHubOAuthCallback.mockResolvedValueOnce({
        success: false,
        error: "email_required",
        redirectTo: "/recipes",
      });
      const cookie = await storedCookie("github");
      const request = new Request("https://spoonjoy.app/auth/github/callback?state=state&code=c", {
        headers: { Cookie: cookie },
      });

      const response = await handleGitHubCallback(request, context);

      expect(response.headers.get("Location")).toBe("/login?oauthError=email_required");
      expect(socialCallbackEvents().at(-1)).toMatchObject({
        properties: {
          provider: "github",
          error_code: "email_required",
          phase: "link_account",
          failure_kind: "missing_email",
          retryable: false,
        },
      });
    });

    it("threads provider + phase through for GitHub (no httpStatus)", async () => {
      const { context } = telemetryContext();
      verifyMocks.verifyGitHubCallback.mockImplementation(async (_cfg, _uri, _data, capture) => {
        capture?.({ error: new Error("token exchange failed"), phase: "token_exchange" });
        return { success: false, error: "oauth_error" };
      });
      const cookie = await storedCookie("github");
      const request = new Request("https://spoonjoy.app/auth/github/callback?state=state&code=c", {
        headers: { Cookie: cookie },
      });

      await handleGitHubCallback(request, context);

      expect(captureException).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ extras: { provider: "github", phase: "token_exchange", httpStatus: undefined } }),
      );
    });
  });

  describe("unexpected verify throws", () => {
    it("captures the original throw + a verify event (Apple)", async () => {
      const { context } = telemetryContext();
      const boom = new Error("unexpected apple throw");
      verifyMocks.verifyAppleCallback.mockRejectedValueOnce(boom);
      const cookie = await storedCookie("apple");
      const body = new URLSearchParams({ state: "state", code: "c" });
      const request = new Request("https://spoonjoy.app/auth/apple/callback", {
        method: "POST",
        body,
        headers: { Cookie: cookie },
      });

      const response = await handleAppleCallback(request, context);

      expect(response.headers.get("Location")).toBe("/login?oauthError=oauth_error");
      expect(captureException).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ error: boom, extras: { provider: "apple", phase: "verify" } }),
      );
      expect(socialCallbackEvents().at(-1)).toMatchObject({
        properties: { provider: "apple", error_code: "oauth_error", phase: "verify" },
      });
    });

    it("captures the rethrown error + a verify event (GitHub)", async () => {
      const { context } = telemetryContext();
      const boom = new Error("github rethrow");
      verifyMocks.verifyGitHubCallback.mockRejectedValueOnce(boom);
      const cookie = await storedCookie("github");
      const request = new Request("https://spoonjoy.app/auth/github/callback?state=state&code=c", {
        headers: { Cookie: cookie },
      });

      const response = await handleGitHubCallback(request, context);

      expect(response.headers.get("Location")).toBe("/login?oauthError=oauth_error");
      expect(captureException).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ error: boom, extras: { provider: "github", phase: "verify" } }),
      );
    });

    it("captures the original throw + a verify event (Google)", async () => {
      const { context } = telemetryContext();
      const boom = new Error("unexpected google throw");
      verifyMocks.verifyGoogleCallback.mockRejectedValueOnce(boom);
      const cookie = await storedCookie("google");
      const request = new Request("https://spoonjoy.app/auth/google/callback?state=state&code=c", {
        headers: { Cookie: cookie },
      });

      const response = await handleGoogleCallback(request, context);

      expect(response.headers.get("Location")).toBe("/login?oauthError=oauth_error");
      expect(captureException).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ error: boom, extras: { provider: "google", phase: "verify" } }),
      );
    });
  });

  it("stays silent (no throw, no capture) when PostHog is disabled", async () => {
    const { context } = telemetryContext({});
    const body = new URLSearchParams({ error: "access_denied" });
    const request = new Request("https://spoonjoy.app/auth/apple/callback", { method: "POST", body });

    const response = await handleAppleCallback(request, context);

    expect(response.headers.get("Location")).toBe("/login?oauthError=access_denied");
    expect(captureEvent).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });
});
