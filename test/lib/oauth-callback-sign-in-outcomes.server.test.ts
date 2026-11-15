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

import { captureEvent } from "~/lib/analytics-server";
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

import { SIGN_IN_FAILED_EVENT, SIGN_IN_SUCCEEDED_EVENT } from "~/lib/sign-in-outcome.server";
import { sessionStorage } from "~/lib/session.server";
import { getLocalDb } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { cleanupDatabase } from "../helpers/cleanup";

function signInEvents() {
  return vi.mocked(captureEvent).mock.calls
    .map(([, input]) => input)
    .filter((input) => input.event === SIGN_IN_SUCCEEDED_EVENT || input.event === SIGN_IN_FAILED_EVENT);
}

const githubUser = { id: "github-user", email: "chef@example.com", emailVerified: true, login: "chef", name: null, avatarUrl: null };

async function githubCallback(result: Record<string, unknown>, cookies: string[] = []) {
  const { context } = telemetryContext();
  verifyMocks.verifyGitHubCallback.mockResolvedValueOnce({ success: true, githubUser });
  callbackMocks.handleGitHubOAuthCallback.mockResolvedValueOnce({ success: true, redirectTo: "/recipes", ...result });
  const cookie = [await storedCookie("github"), ...cookies].join("; ");
  const request = new Request("https://spoonjoy.app/auth/github/callback?state=state&code=c", { headers: { Cookie: cookie } });
  return handleGitHubCallback(request, context);
}

beforeEach(async () => {
  vi.clearAllMocks();
  configMocks.getGitHubOAuthConfig.mockReturnValue({ clientId: "github" });
  callbackMocks.handleGitHubOAuthCallback.mockReset();
  await cleanupDatabase();
});

afterEach(async () => {
  await cleanupDatabase();
});

describe("social sign-in outcomes", () => {
  it("reports a returning chef's sign-in under the account id", async () => {
    await githubCallback({ action: "user_logged_in", userId: "user_gh" });

    expect(signInEvents()).toEqual([
      {
        event: SIGN_IN_SUCCEEDED_EVENT,
        distinctId: "user_gh",
        properties: { method: "github", platform: "web", app_version: null, install_id: null, new_account: false },
      },
    ]);
  });

  it("marks a sign-in that created the account as new", async () => {
    await githubCallback({ action: "user_created", userId: "user_new" });

    expect(signInEvents()[0]).toMatchObject({ distinctId: "user_new", properties: { new_account: true } });
  });

  it("counts a signed-out visitor whose provider was linked by email as a sign-in", async () => {
    await githubCallback({ action: "account_linked", userId: "user_linked" });

    expect(signInEvents()).toEqual([expect.objectContaining({ event: SIGN_IN_SUCCEEDED_EVENT, distinctId: "user_linked" })]);
  });

  it("does not count linking a provider to the account that is already signed in", async () => {
    const db = await getLocalDb();
    const user = await createUser(db, "linker@example.com", "linker_chef", "testPassword123");
    const session = await sessionStorage.getSession();
    session.set("userId", user.id);
    session.set("sessionVersion", 0);
    const sessionCookie = (await sessionStorage.commitSession(session)).split(";")[0];

    await githubCallback({ action: "account_linked", userId: user.id }, [sessionCookie]);

    expect(signInEvents()).toEqual([]);
  });

  it("reports a failed callback with its error code", async () => {
    const { context } = telemetryContext();
    const request = new Request("https://spoonjoy.app/auth/github/callback?state=state&code=c");

    await handleGitHubCallback(request, context);

    expect(signInEvents()).toEqual([
      {
        event: SIGN_IN_FAILED_EVENT,
        distinctId: "anonymous_web_sign_in",
        properties: { method: "github", platform: "web", app_version: null, install_id: null, failure_reason: "invalid_state", account_matched: false },
      },
    ]);
  });

  it("falls back to oauth_error when the provider gives no code", async () => {
    const { context } = telemetryContext();
    verifyMocks.verifyGitHubCallback.mockResolvedValueOnce({ success: false });
    const cookie = await storedCookie("github");
    const request = new Request("https://spoonjoy.app/auth/github/callback?state=state&code=c", { headers: { Cookie: cookie } });

    await handleGitHubCallback(request, context);

    expect(signInEvents()[0]).toMatchObject({ properties: { failure_reason: "oauth_error" } });
  });

  it("does not report a failure while linking a provider to a signed-in account", async () => {
    const { context } = telemetryContext();
    verifyMocks.verifyGoogleCallback.mockResolvedValueOnce({ success: false, error: "token_exchange_failed" });
    const cookie = await storedCookie("google", { linking: true });
    const request = new Request("https://spoonjoy.app/auth/google/callback?state=state&code=c", { headers: { Cookie: cookie } });

    const response = await handleGoogleCallback(request, context);

    expect(response.headers.get("Location")).toContain("oauthError=token_exchange_failed");
    expect(signInEvents()).toEqual([]);
  });
});
