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
  verifyOidcCallback: vi.fn(),
}));
vi.mock("~/lib/apple-oauth.server", () => ({ verifyAppleCallback: verifyMocks.verifyAppleCallback }));
vi.mock("~/lib/github-oauth.server", () => ({ verifyGitHubCallback: verifyMocks.verifyGitHubCallback }));
vi.mock("~/lib/google-oauth.server", () => ({ verifyGoogleCallback: verifyMocks.verifyGoogleCallback }));
vi.mock("~/lib/oidc.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/oidc.server")>()),
  verifyOidcCallback: verifyMocks.verifyOidcCallback,
}));
vi.mock("~/lib/env.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/env.server")>()),
  getAppleOAuthConfig: vi.fn(() => ({ clientId: "apple" })),
  getGitHubOAuthConfig: vi.fn(() => ({ clientId: "github" })),
  getGoogleOAuthConfig: vi.fn(() => ({ clientId: "google" })),
  getOidcConfig: vi.fn(() => ({ issuer: "https://auth.example.test", clientId: "spoonjoy", clientSecret: "test-only", label: "Kitchen sign-in", scopes: ["openid"] })),
}));

import { handleAppleCallback, handleGitHubCallback, handleGoogleCallback, handleOidcCallback } from "~/lib/oauth-callback-route.server";
import { createServerInvite } from "~/lib/server-access.server";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";

type Provider = "apple" | "github" | "google" | "oidc";
const PROVIDERS: Provider[] = ["apple", "github", "google", "oidc"];

async function callback(provider: Provider, env: Record<string, string>, inviteToken?: string) {
  const stored = await commitOAuthStartSession(new Request(`https://spoonjoy.app/auth/${provider}`), provider, {
    state: "state",
    redirectTo: "/recipes",
    failureRedirect: "/signup",
    linking: false,
    codeVerifier: provider === "google" || provider === "oidc" ? "verifier" : undefined,
    ...(provider === "oidc" ? { nonce: "nonce" } : {}),
    ...(inviteToken ? { inviteToken } : {}),
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
  } else if (provider === "oidc") {
    verifyMocks.verifyOidcCallback.mockResolvedValueOnce({
      success: true,
      oidcUser: { id: "oidc-new", email, emailVerified: true, username: "newcook", name: "New Cook" },
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
  const handle = { apple: handleAppleCallback, github: handleGitHubCallback, google: handleGoogleCallback, oidc: handleOidcCallback }[provider];
  return handle(request, context);
}

let owner: { id: string };

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanupDatabase();
  owner = await db.user.create({ data: { email: "owner@example.com", username: "owner" } });
});
afterEach(cleanupDatabase);

describe("web sign-in with a provider, for someone with no account", () => {
  it.each<Provider>(PROVIDERS)("is refused by %s on an invite-only self-hosted server", async (provider) => {
    const response = await callback(provider, { SPOONJOY_SELF_HOSTED: "true" });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("oauthError=signups_closed");
    expect(await db.user.count()).toBe(1);
  });

  it.each<Provider>(PROVIDERS)("makes an account with %s on an invite-only self-hosted server from an invite link", async (provider) => {
    const { token } = await createServerInvite(db, owner.id);
    const response = await callback(provider, { SPOONJOY_SELF_HOSTED: "true" }, token);
    expect(response.headers.get("Location")).toBe("/recipes");
    const created = await db.user.findFirstOrThrow({ where: { email: `new-${provider}@example.com` } });
    expect(await db.serverInvite.findFirstOrThrow()).toMatchObject({ usedById: created.id });
  });

  it.each<Provider>(PROVIDERS)("is refused by %s with an invite link that was already used", async (provider) => {
    const { token } = await createServerInvite(db, owner.id);
    await db.serverInvite.updateMany({ data: { usedAt: new Date() } });
    const response = await callback(provider, { SPOONJOY_SELF_HOSTED: "true" }, token);
    expect(response.headers.get("Location")).toContain("oauthError=signups_closed");
    expect(await db.user.count()).toBe(1);
  });

  it.each<Provider>(PROVIDERS)("makes an account with %s on spoonjoy.app as before", async (provider) => {
    const response = await callback(provider, {});
    expect(response.headers.get("Location")).toBe("/recipes");
    expect(await db.user.count()).toBe(2);
  });
});
