import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { faker } from "@faker-js/faker";
import { createTestRoutesStub } from "../utils";
import { getLocalDb } from "~/lib/db.server";
import { createUser, verifyPassword } from "~/lib/auth.server";
import { createUserSessionCookie, getSessionIdentity, getUserId } from "~/lib/session.server";
import type { AccountSettingsActionResult } from "~/lib/account-settings.server";
import AccountSettings, { action } from "~/routes/account.settings";
import { cleanupDatabase } from "../helpers/cleanup";
import { authenticateApiToken, createApiCredential, hashApiToken } from "~/lib/api-auth.server";
import {
  consumeAuthorizationCode,
  createAuthorizationCode,
  issueConnectorTokens,
  registerOAuthClient,
  rotateConnectorTokens,
} from "~/lib/oauth-server.server";
import { handleOAuthRevoke, handleOAuthToken } from "~/lib/oauth-routes.server";
import { approveAgentConnectionRequest, pollAgentConnection, startAgentConnection } from "~/lib/agent-connection.server";
import { revokeAllAccountAccess } from "~/lib/account-revocation.server";
import { sqliteD1 } from "../helpers/sqlite-d1";

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface DataResult {
  data: AccountSettingsActionResult;
  init: { headers: Record<string, string> };
}

const PASSWORD = "testPassword123";

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0];
}

function pageRequest(cookie: string): Request {
  return new UndiciRequest("http://localhost:3000/account/settings", {
    headers: { Cookie: cookie },
  }) as unknown as Request;
}

async function postAction(cookie: string, fields: Record<string, string>) {
  const request = new UndiciRequest("http://localhost:3000/account/settings", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return action({ request, context: { cloudflare: { env: null } }, params: {} } as any);
}

async function currentVersion(userId: string): Promise<number> {
  const db = await getLocalDb();
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { sessionVersion: true } });
  return user.sessionVersion;
}

describe("Account settings - revocable sessions", () => {
  let userId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    const db = await getLocalDb();
    const user = await createUser(
      db,
      faker.internet.email(),
      `${faker.internet.username()}_${faker.string.alphanumeric(8)}`,
      PASSWORD,
    );
    userId = user.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("action - sign out everywhere", () => {
    it("revokes every existing session and re-issues this browser's session at the new version", async () => {
      const thisBrowser = cookiePair(await createUserSessionCookie(userId));
      const otherBrowser = cookiePair(await createUserSessionCookie(userId));

      const result = (await postAction(thisBrowser, { intent: "signOutEverywhere" })) as unknown as DataResult;

      expect(result.data).toEqual({
        success: true,
        message: "You've been signed out everywhere else, and apps, agents and API tokens have been disconnected. You're still signed in here. Your passkeys and linked Google, GitHub or Apple sign-ins still work; remove any you don't recognise below.",
      });
      expect(await currentVersion(userId)).toBe(1);

      const reissued = cookiePair(result.init.headers["Set-Cookie"]);
      await expect(getSessionIdentity(pageRequest(reissued))).resolves.toEqual({ userId, sessionVersion: 1 });
      await expect(getUserId(pageRequest(reissued))).resolves.toBe(userId);
      await expect(getUserId(pageRequest(thisBrowser))).resolves.toBeNull();
      await expect(getUserId(pageRequest(otherBrowser))).resolves.toBeNull();
    });

    it("revokes a cookie issued before session versions existed", async () => {
      const legacyBrowser = cookiePair(await createUserSessionCookie(userId, null, null, { sessionVersion: 0 }));
      const thisBrowser = cookiePair(await createUserSessionCookie(userId));

      await postAction(thisBrowser, { intent: "signOutEverywhere" });

      await expect(getUserId(pageRequest(legacyBrowser))).resolves.toBeNull();
    });

    it("keeps bumping on every use, so an older re-issued session is revoked too", async () => {
      const first = cookiePair(await createUserSessionCookie(userId));
      const second = cookiePair(
        ((await postAction(first, { intent: "signOutEverywhere" })) as unknown as DataResult).init.headers["Set-Cookie"],
      );
      const third = cookiePair(
        ((await postAction(second, { intent: "signOutEverywhere" })) as unknown as DataResult).init.headers["Set-Cookie"],
      );

      expect(await currentVersion(userId)).toBe(2);
      await expect(getUserId(pageRequest(second))).resolves.toBeNull();
      await expect(getUserId(pageRequest(third))).resolves.toBe(userId);
    });

    it("sends a revoked browser to sign in instead of signing out everywhere again", async () => {
      const revoked = cookiePair(await createUserSessionCookie(userId));
      await postAction(cookiePair(await createUserSessionCookie(userId)), { intent: "signOutEverywhere" });

      await expect(postAction(revoked, { intent: "signOutEverywhere" })).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(Response);
        expect((error as Response).headers.get("Location")).toBe("/login?redirectTo=%2Faccount%2Fsettings");
        return true;
      });
      expect(await currentVersion(userId)).toBe(1);
    });
  });

  describe("bearer credentials", () => {
    const ISSUER = "http://localhost:3000";
    const MCP = `${ISSUER}/mcp`;
    const VERIFIER = "v".repeat(64);

    async function seedAccess() {
      const db = await getLocalDb();
      const personal = await createApiCredential(db, userId, "Laptop script");
      // A real device-flow token, approved and collected.
      const started = await startAgentConnection(db, { agentName: "Ouro agent", scopes: "account:read" });
      await approveAgentConnectionRequest(db, started.request.id, userId);
      const delegated = await pollAgentConnection(db, { deviceCode: started.deviceCode });
      // Approved but not collected yet: collecting it later must not mint a token.
      const pendingStart = await startAgentConnection(db, { agentName: "Uncollected agent", scopes: "account:read" });
      await approveAgentConnectionRequest(db, pendingStart.request.id, userId);
      const client = await registerOAuthClient(db, { clientName: "Some agent", redirectUris: ["https://agent.example/cb"], issuer: ISSUER });
      const oauth = await issueConnectorTokens(db, { userId, clientId: client.clientId, scope: "kitchen:read", issuer: ISSUER });
      // The Claude connector's MCP-bound access token.
      const mcp = await issueConnectorTokens(db, {
        userId, clientId: client.clientId, scope: "kitchen:read", issuer: ISSUER, resource: MCP, persistentMcpResource: MCP,
      });
      // An authorization the chef (or whoever held the session) approved but nobody exchanged yet.
      const code = await createAuthorizationCode(db, {
        clientId: client.clientId, userId, redirectUri: "https://agent.example/cb", issuer: ISSUER, scope: "kitchen:read",
        codeChallenge: await pkceChallenge(VERIFIER),
      });
      await db.oAuthConsentTransaction.create({
        data: {
          tokenHash: `consent-${userId}`, userId, issuer: ISSUER, clientId: client.clientId, redirectUri: "https://agent.example/cb",
          state: "s".repeat(16), scope: "kitchen:read", codeChallenge: "c".repeat(43), expiresAt: new Date(Date.now() + 600_000),
        },
      });
      return { db, client, personal, delegated, pendingStart, oauth, mcp, code };
    }

    async function expectAllRevoked(seed: Awaited<ReturnType<typeof seedAccess>>) {
      const { db } = seed;
      for (const token of [seed.personal.token, seed.delegated.token!, seed.oauth.accessToken, seed.mcp.accessToken]) {
        await expect(authenticateApiToken(db, token, ISSUER)).rejects.toMatchObject({ status: 401 });
      }
      expect(await db.oAuthRefreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
      const grants = await db.oAuthGrant.findMany({ where: { userId } });
      expect(grants.length).toBeGreaterThan(0);
      expect(grants.map((grant) => [grant.status, grant.statusReason])).toEqual(grants.map(() => ["revoked", "security_event"]));

      // Refreshing fails, and says the chef revoked the session, so the iPhone app signs out quietly.
      await expect(rotateConnectorTokens(db, { refreshToken: seed.oauth.refreshToken, clientId: seed.client.clientId, issuer: ISSUER }))
        .rejects.toMatchObject({ code: "invalid_grant", reason: "revoked_by_user" });
      const refresh = await handleOAuthToken(new UndiciRequest(`${ISSUER}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: seed.oauth.refreshToken, client_id: seed.client.clientId }).toString(),
      }) as unknown as Request, db, null);
      expect(refresh.status).toBe(400);
      expect(await refresh.json()).toEqual({ error: "invalid_grant", error_description: "Session revoked", reason: "revoked_by_user" });
      // The authorization code issued before the sign-out cannot be exchanged.
      await expect(consumeAuthorizationCode(db, {
        code: seed.code, clientId: seed.client.clientId, redirectUri: "https://agent.example/cb", codeVerifier: VERIFIER, issuer: ISSUER,
      })).rejects.toMatchObject({ code: "invalid_grant" });
      expect(await db.oAuthConsentTransaction.count({ where: { userId } })).toBe(0);
      // Collecting the approved-but-uncollected agent connection mints nothing.
      const collected = await pollAgentConnection(db, { deviceCode: seed.pendingStart.deviceCode });
      expect(collected.token).toBeUndefined();
      expect(collected.status).toBe("denied");
      // An app signing itself out afterwards still succeeds (the iPhone app waits for this).
      const revoke = await handleOAuthRevoke(new UndiciRequest(`${ISSUER}/oauth/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: seed.oauth.refreshToken, client_id: seed.client.clientId, token_type_hint: "refresh_token" }).toString(),
      }) as unknown as Request, db, null);
      expect(revoke.status).toBe(200);
    }

    it("sign out everywhere revokes API tokens, agent tokens, OAuth and MCP connections, unused codes and approved agent requests", async () => {
      const seed = await seedAccess();
      await expect(authenticateApiToken(seed.db, seed.personal.token, ISSUER)).resolves.toMatchObject({ id: userId });
      await expect(authenticateApiToken(seed.db, seed.delegated.token!, ISSUER)).resolves.toMatchObject({ id: userId });
      await expect(authenticateApiToken(seed.db, seed.mcp.accessToken, ISSUER)).resolves.toMatchObject({ id: userId });

      await postAction(cookiePair(await createUserSessionCookie(userId)), { intent: "signOutEverywhere" });

      await expectAllRevoked(seed);
    });

    it("a password change from a form that does not offer the choice revokes everything", async () => {
      const seed = await seedAccess();

      await postAction(cookiePair(await createUserSessionCookie(userId)), {
        intent: "changePassword",
        currentPassword: PASSWORD,
        newPassword: "newSecurePassword456!",
        confirmPassword: "newSecurePassword456!",
      });

      await expectAllRevoked(seed);
    });

    it("a password change with the box ticked revokes everything", async () => {
      const seed = await seedAccess();

      await postAction(cookiePair(await createUserSessionCookie(userId)), {
        intent: "changePassword",
        currentPassword: PASSWORD,
        newPassword: "newSecurePassword456!",
        confirmPassword: "newSecurePassword456!",
        connectionsChoice: "1",
        revokeConnections: "on",
      });

      await expectAllRevoked(seed);
    });

    it("a password change keeps bearer credentials when the chef unticks the box", async () => {
      const seed = await seedAccess();

      const result = (await postAction(cookiePair(await createUserSessionCookie(userId)), {
        intent: "changePassword",
        currentPassword: PASSWORD,
        newPassword: "newSecurePassword456!",
        confirmPassword: "newSecurePassword456!",
        connectionsChoice: "1",
      })) as unknown as DataResult;

      expect(result.data.message).toBe("Your password has been changed successfully. Other browsers signed in to your account have been signed out.");
      await expect(authenticateApiToken(seed.db, seed.personal.token, ISSUER)).resolves.toMatchObject({ id: userId });
      await expect(authenticateApiToken(seed.db, seed.oauth.accessToken, ISSUER)).resolves.toMatchObject({ id: userId });
    });

    it("an access token minted by a refresh that races the sign-out does not work", async () => {
      const seed = await seedAccess();
      let raced: Awaited<ReturnType<typeof rotateConnectorTokens>> | null = null;

      // The refresh has passed its grant checks; the sign-out lands just before it inserts the
      // new access token, so the token sweep cannot see that token.
      raced = await rotateConnectorTokens(seed.db, { refreshToken: seed.mcp.refreshToken, clientId: seed.client.clientId, issuer: ISSUER }, {
        onPersistenceMutation: async (stage, timing) => {
          if (stage === "access_insert" && timing === "before") {
            await revokeAllAccountAccess(seed.db, userId, { reason: "sign_out_everywhere" });
          }
        },
      });

      const minted = await seed.db.apiCredential.findUniqueOrThrow({ where: { tokenHash: await hashApiToken(raced.accessToken) } });
      expect(minted.revokedAt).toBeNull();
      await expect(authenticateApiToken(seed.db, raced.accessToken, ISSUER)).rejects.toMatchObject({ status: 401 });
    });

    it("leaves the account untouched when any step fails", async () => {
      const seed = await seedAccess();
      // The last sweep fails; everything before it must roll back.
      const failing = {
        $transaction: (run: (tx: any) => Promise<unknown>) => seed.db.$transaction(async (tx: any) => run(new Proxy(tx, {
          get: (target, prop) => prop === "apiCredential"
            ? { updateMany: async () => { throw new Error("D1 went away"); } }
            : target[prop],
        }))),
      } as unknown as typeof seed.db;

      await expect(revokeAllAccountAccess(failing, userId, { reason: "sign_out_everywhere", user: { bumpSessionVersion: true } }))
        .rejects.toThrow("D1 went away");

      expect(await currentVersion(userId)).toBe(0);
      expect(await seed.db.oAuthRefreshToken.count({ where: { userId, revokedAt: null } })).toBeGreaterThan(0);
      expect(await seed.db.oAuthGrant.count({ where: { userId, status: "active" } })).toBeGreaterThan(0);
      await expect(authenticateApiToken(seed.db, seed.mcp.accessToken, ISSUER)).resolves.toMatchObject({ id: userId });
    });

    it("runs as one D1 batch, with the same effect, when the request has a D1 binding", async () => {
      const seed = await seedAccess();
      const d1 = sqliteD1();
      try {
        const result = await revokeAllAccountAccess(seed.db, userId, {
          reason: "sign_out_everywhere",
          d1: d1.binding,
          user: { bumpSessionVersion: true },
        });

        expect(d1.roundTrips()).toBe(1);
        expect(result).toMatchObject({ sessionVersion: 1, refreshTokens: 2, oauthGrants: 2, pendingAgentConnections: 1, authorizationCodes: 1, consentTransactions: 1 });
        expect(result.apiCredentials).toBe(4);
      } finally {
        d1.close();
      }
      expect(await currentVersion(userId)).toBe(1);
      await expectAllRevoked(seed);
    });

    it("writes the new password in the same D1 batch, and works without a user write", async () => {
      const seed = await seedAccess();
      const before = await seed.db.user.findUniqueOrThrow({ where: { id: userId }, select: { hashedPassword: true, salt: true } });
      const d1 = sqliteD1();
      try {
        const result = await revokeAllAccountAccess(seed.db, userId, {
          reason: "password_change",
          d1: d1.binding,
          user: { bumpSessionVersion: true, password: { hashedPassword: "new-hash", salt: "new-salt" } },
        });
        expect(result.sessionVersion).toBe(1);
        expect(d1.roundTrips()).toBe(1);

        const sweepOnly = await revokeAllAccountAccess(seed.db, userId, { reason: "password_reset", d1: d1.binding });
        expect(sweepOnly).toMatchObject({ sessionVersion: null, apiCredentials: 0, refreshTokens: 0 });

        await expect(revokeAllAccountAccess(seed.db, "no-such-user", {
          reason: "sign_out_everywhere",
          d1: d1.binding,
          user: { bumpSessionVersion: true },
        })).rejects.toThrow("Account revocation found no user to update");
      } finally {
        d1.close();
      }
      const after = await seed.db.user.findUniqueOrThrow({ where: { id: userId }, select: { hashedPassword: true, salt: true, sessionVersion: true } });
      expect(before.hashedPassword).not.toBe("new-hash");
      expect(after).toEqual({ hashedPassword: "new-hash", salt: "new-salt", sessionVersion: 1 });
      await expectAllRevoked(seed);
    });

    it("does not touch another chef's credentials", async () => {
      const db = await getLocalDb();
      const other = await createUser(db, faker.internet.email(), `other_${faker.string.alphanumeric(8)}`, PASSWORD);
      const otherToken = await createApiCredential(db, other.id, "Other chef");

      await postAction(cookiePair(await createUserSessionCookie(userId)), { intent: "signOutEverywhere" });

      await expect(authenticateApiToken(db, otherToken.token, ISSUER)).resolves.toMatchObject({ id: other.id });
    });
  });

  describe("action - change password", () => {
    it("revokes every other session and keeps this browser signed in", async () => {
      const thisBrowser = cookiePair(await createUserSessionCookie(userId));
      const otherBrowser = cookiePair(await createUserSessionCookie(userId));

      const result = (await postAction(thisBrowser, {
        intent: "changePassword",
        currentPassword: PASSWORD,
        newPassword: "newSecurePassword456!",
        confirmPassword: "newSecurePassword456!",
      })) as unknown as DataResult;

      expect(result.data).toEqual({
        success: true,
        intent: "changePassword",
        message: "Your password has been changed. Other browsers have been signed out, and apps, agents and API tokens have been disconnected. Your passkeys and linked Google, GitHub or Apple sign-ins still work; remove any you don't recognise below.",
      });
      expect(await currentVersion(userId)).toBe(1);
      const db = await getLocalDb();
      const saved = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { hashedPassword: true } });
      await expect(verifyPassword("newSecurePassword456!", saved.hashedPassword!)).resolves.toBe(true);

      await expect(getUserId(pageRequest(cookiePair(result.init.headers["Set-Cookie"])))).resolves.toBe(userId);
      await expect(getUserId(pageRequest(otherBrowser))).resolves.toBeNull();
      await expect(getUserId(pageRequest(thisBrowser))).resolves.toBeNull();
    });

    it("does not revoke sessions when the password change is rejected", async () => {
      const thisBrowser = cookiePair(await createUserSessionCookie(userId));

      const result = await postAction(thisBrowser, {
        intent: "changePassword",
        currentPassword: "wrong-password",
        newPassword: "newSecurePassword456!",
        confirmPassword: "newSecurePassword456!",
      });

      expect(result).toMatchObject({ success: false, error: "invalid_current_password" });
      expect(await currentVersion(userId)).toBe(0);
      await expect(getUserId(pageRequest(thisBrowser))).resolves.toBe(userId);
    });

    it("does not revoke sessions when a password is set or removed", async () => {
      const db = await getLocalDb();
      const thisBrowser = cookiePair(await createUserSessionCookie(userId));
      await db.oAuth.create({
        data: { provider: "google", providerUserId: `google-${userId}`, providerUsername: "chef@gmail.com", userId },
      });

      await expect(postAction(thisBrowser, { intent: "removePassword", currentPassword: PASSWORD }))
        .resolves.toMatchObject({ success: true });
      await expect(postAction(thisBrowser, {
        intent: "setPassword",
        newPassword: "anotherPassword789!",
        confirmPassword: "anotherPassword789!",
      })).resolves.toMatchObject({ success: true });

      expect(await currentVersion(userId)).toBe(0);
    });
  });

  describe("component - sign out everywhere", () => {
    function renderSettings(onAction: (intent: FormDataEntryValue | null) => void) {
      const loaderData = {
        user: {
          id: userId,
          email: "chef@example.com",
          username: "chef",
          hasPassword: true,
          oauthAccounts: [],
          photoUrl: null,
          passkeys: [],
        },
        notifications: { pushSubscribed: false },
      };
      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => loaderData,
          action: async ({ request }) => {
            onAction((await request.formData()).get("intent"));
            return { success: true, message: "You've been signed out everywhere else. You're still signed in here." };
          },
        },
      ]);
      render(<Stub initialEntries={["/account/settings"]} />);
    }

    it("asks for confirmation, and Cancel leaves every session alone", async () => {
      const user = userEvent.setup();
      const intents: Array<FormDataEntryValue | null> = [];
      renderSettings((intent) => intents.push(intent));

      await user.click(await screen.findByRole("button", { name: "Sign out everywhere" }));
      expect(screen.getByText("Are you sure?")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Sign out everywhere" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.getByRole("button", { name: "Sign out everywhere" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Confirm sign out everywhere" })).not.toBeInTheDocument();
      expect(intents).toEqual([]);
    });

    it("submits the sign-out-everywhere intent on Confirm and shows the result", async () => {
      const user = userEvent.setup();
      const intents: Array<FormDataEntryValue | null> = [];
      renderSettings((intent) => intents.push(intent));

      await user.click(await screen.findByRole("button", { name: "Sign out everywhere" }));
      await user.click(screen.getByRole("button", { name: "Confirm sign out everywhere" }));

      expect(await screen.findByText("You've been signed out everywhere else. You're still signed in here.")).toBeInTheDocument();
      expect(intents).toEqual(["signOutEverywhere"]);
      expect(screen.getByRole("button", { name: "Sign out everywhere" })).toBeInTheDocument();
      expect(screen.queryByText("Are you sure?")).not.toBeInTheDocument();
    });
  });
});
