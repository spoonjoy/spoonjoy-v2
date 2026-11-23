// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppLoadContext } from "react-router";
import { commitOAuthStartSession } from "~/lib/oauth-route.server";

// The web sign-in callbacks with the providers' answers stubbed, so a new account on an
// invite-only self-hosted server reaches the account-creation gate through the real route code.
const verifyMocks = vi.hoisted(() => ({
  verifyAppleCallback: vi.fn(),
  verifyGitHubCallback: vi.fn(),
  verifyGoogleCallback: vi.fn(),
}));
vi.mock("~/lib/apple-oauth.server", () => ({ verifyAppleCallback: verifyMocks.verifyAppleCallback }));
vi.mock("~/lib/github-oauth.server", () => ({ verifyGitHubCallback: verifyMocks.verifyGitHubCallback }));
vi.mock("~/lib/google-oauth.server", () => ({ verifyGoogleCallback: verifyMocks.verifyGoogleCallback }));
vi.mock("~/lib/env.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/env.server")>()),
  getAppleOAuthConfig: vi.fn(() => ({ clientId: "apple" })),
  getGitHubOAuthConfig: vi.fn(() => ({ clientId: "github" })),
  getGoogleOAuthConfig: vi.fn(() => ({ clientId: "google" })),
}));

import { handleAppleCallback, handleGitHubCallback, handleGoogleCallback } from "~/lib/oauth-callback-route.server";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";

type Provider = "apple" | "github" | "google";

async function callback(provider: Provider, env: Record<string, string>) {
  const stored = await commitOAuthStartSession(new Request(`https://spoonjoy.app/auth/${provider}`), provider, {
    state: "state",
    redirectTo: "/recipes",
    failureRedirect: "/signup",
    linking: false,
    codeVerifier: provider === "google" ? "verifier" : undefined,
    redirectUri: `https://spoonjoy.app/auth/${provider}/callback`,
  });
  const email = `new-${provider}@example.com`;
  if (provider === "apple") {
    verifyMocks.verifyAppleCallback.mockResolvedValueOnce({
      success: true,
      appleUser: { id: "apple-new", email, emailVerified: true, isPrivateEmail: false, firstName: null, lastName: null, fullName: null },
    });
  } else if (provider === "github") {
    verifyMocks.verifyGitHubCallback.mockResolvedValueOnce({
      success: true,
      githubUser: { id: "github-new", email, emailVerified: true, login: "newcook", name: null, avatarUrl: null },
    });
  } else {
    verifyMocks.verifyGoogleCallback.mockResolvedValueOnce({
      success: true,
      googleUser: { id: "google-new", email, emailVerified: true, name: "New Cook", givenName: null, familyName: null, picture: null },
    });
  }
  const context = { cloudflare: { env, ctx: { waitUntil: () => {} } } } as unknown as AppLoadContext;
  // Apple posts its answer as a form; the others redirect with it in the query.
  const request = provider === "apple"
    ? new Request("https://spoonjoy.app/auth/apple/callback", {
        method: "POST",
        headers: { Cookie: stored.split(";")[0], "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ state: "state", code: "c" }),
      })
    : new Request(`https://spoonjoy.app/auth/${provider}/callback?state=state&code=c`, { headers: { Cookie: stored.split(";")[0] } });
  const handle = { apple: handleAppleCallback, github: handleGitHubCallback, google: handleGoogleCallback }[provider];
  return handle(request, context);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanupDatabase();
  await db.user.create({ data: { email: "owner@example.com", username: "owner" } });
});
afterEach(cleanupDatabase);

describe("web sign-in with a provider, for someone with no account", () => {
  it.each<Provider>(["apple", "github", "google"])("is refused by %s on an invite-only self-hosted server", async (provider) => {
    const response = await callback(provider, { SPOONJOY_SELF_HOSTED: "true" });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("oauthError=signups_closed");
    expect(await db.user.count()).toBe(1);
  });

  it.each<Provider>(["apple", "github", "google"])("makes an account with %s on spoonjoy.app as before", async (provider) => {
    const response = await callback(provider, {});
    expect(response.headers.get("Location")).toBe("/recipes");
    expect(await db.user.count()).toBe(2);
  });
});
