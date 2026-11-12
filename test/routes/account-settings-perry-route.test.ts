// @vitest-environment node
// Perry's route back into his account, end to end (issue #683 must keep it working): a chef with a
// Redwood-era password he has forgotten and a linked Google account signs in with Google on the
// web, removes the password with Current password left blank, sets a new one, and signs in to the
// iPhone app with it. A fresh Google sign-in is the proof that lets the blank removal through.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pbkdf2Sync } from "node:crypto";
import { Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { commitOAuthStartSession } from "~/lib/oauth-route.server";
import { getSessionAuthenticatedAt } from "~/lib/session.server";
import type { AccountSettingsActionResult } from "~/lib/account-settings.server";
import { action } from "~/routes/account.settings";
import { action as apiAction } from "~/routes/api.v1.$";
import { cleanupDatabase } from "../helpers/cleanup";

// Google's token exchange is the only part of a Google sign-in that leaves Spoonjoy; the rest
// (finding the linked account, the session cookie) runs for real.
const google = vi.hoisted(() => ({ verifyGoogleCallback: vi.fn() }));
vi.mock("~/lib/google-oauth.server", () => ({ verifyGoogleCallback: google.verifyGoogleCallback }));
vi.mock("~/lib/env.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/env.server")>()),
  getGoogleOAuthConfig: () => ({ clientId: "google", clientSecret: "google-secret" }),
}));

import { handleGoogleCallback } from "~/lib/oauth-callback-route.server";

const MINUTE = 60_000;

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0];
}

async function postAction(cookie: string, fields: Record<string, string>) {
  const request = new UndiciRequest("http://localhost:3000/account/settings", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return (await action({ request, context: { cloudflare: { env: null } }, params: {} } as any)) as AccountSettingsActionResult;
}

async function storedPassword(userId: string) {
  return (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { hashedPassword: true } })).hashedPassword;
}

beforeEach(async () => {
  await cleanupDatabase();
  google.verifyGoogleCallback.mockReset();
});

afterEach(async () => {
  await cleanupDatabase();
});

describe("Perry's route: a Google-linked chef with a forgotten Redwood-era password", () => {
  it("signs in with Google, removes the password blank, sets a new one and signs in to the app with it", async () => {
    // A Redwood dbAuth (pre-v4) password: PBKDF2-HMAC-SHA1, 1 iteration, 32 bytes, as hex.
    const salt = faker.string.hexadecimal({ length: 32, casing: "lower", prefix: "" });
    const forgotten = "forgotten-redwood-password";
    const user = await db.user.create({
      data: {
        email: `perry-route-${faker.string.alphanumeric(8).toLowerCase()}@example.com`,
        username: `perry_route_${faker.string.alphanumeric(8)}`,
        hashedPassword: pbkdf2Sync(forgotten, salt, 1, 32, "sha1").toString("hex"),
        salt,
        emailVerifiedAt: new Date(),
        OAuth: { create: { provider: "google", providerUserId: "google-perry-route", providerUsername: "Perry Route" } },
      },
    });

    // 1. A fresh Google sign-in on the web.
    google.verifyGoogleCallback.mockResolvedValueOnce({
      success: true,
      googleUser: {
        id: "google-perry-route",
        email: user.email,
        emailVerified: true,
        name: "Perry Route",
        givenName: "Perry",
        familyName: "Route",
        picture: null,
      },
    });
    const start = cookiePair(await commitOAuthStartSession(new Request("https://spoonjoy.app/auth/google"), "google", {
      state: "state",
      redirectTo: "/",
      failureRedirect: "/login",
      linking: false,
      codeVerifier: "verifier",
      redirectUri: "https://spoonjoy.app/auth/google/callback",
    }));
    const signIn = await handleGoogleCallback(
      new Request("https://spoonjoy.app/auth/google/callback?state=state&code=code", { headers: { Cookie: start } }),
      { cloudflare: { env: null } } as any,
    );
    expect(signIn.status).toBe(302);
    const session = signIn.headers.getSetCookie().map(cookiePair).find((pair) => pair.startsWith("__session="));
    expect(session).toBeDefined();
    const signedInAt = await getSessionAuthenticatedAt(new Request("https://spoonjoy.app/", { headers: { Cookie: session! } }));
    expect(Date.now() - signedInAt!).toBeLessThan(MINUTE);

    // 2. Remove password with Current password left blank.
    await expect(postAction(session!, { intent: "removePassword", currentPassword: "" }))
      .resolves.toMatchObject({ success: true });
    expect(await storedPassword(user.id)).toBeNull();

    // 3. Set a new password.
    const fresh = "perry-new-password-1";
    await expect(postAction(session!, { intent: "setPassword", newPassword: fresh, confirmPassword: fresh }))
      .resolves.toMatchObject({ success: true, intent: "setPassword" });

    // 4. Sign in to the iPhone app with the email and the new password.
    const nativeSignIn = (password: string) => apiAction({
      request: new Request("http://localhost/api/v1/auth/password/native", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailOrUsername: user.email, password }),
      }),
      params: { "*": "auth/password/native" },
      context: { cloudflare: { env: {} } },
    } as any);
    const signedIn = await nativeSignIn(fresh);
    expect(signedIn.status).toBe(201);
    expect(((await signedIn.json()) as { data: { userId: string } }).data.userId).toBe(user.id);
    expect((await nativeSignIn(forgotten)).status).toBe(401);
  });
});
