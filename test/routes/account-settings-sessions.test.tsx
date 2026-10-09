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
import { authenticateApiToken, createApiCredential } from "~/lib/api-auth.server";
import { issueConnectorTokens, registerOAuthClient } from "~/lib/oauth-server.server";

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
        message: "You've been signed out everywhere else, and apps, agents and API tokens have been disconnected. You're still signed in here.",
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

    async function seedAccess() {
      const db = await getLocalDb();
      const personal = await createApiCredential(db, userId, "Laptop script");
      const delegated = await createApiCredential(db, userId, "Spoonjoy for iPhone delegated token", { scopes: "account:read account:write" });
      const client = await registerOAuthClient(db, { clientName: "Some agent", redirectUris: ["https://agent.example/cb"], issuer: ISSUER });
      const oauth = await issueConnectorTokens(db, { userId, clientId: client.clientId, scope: "kitchen:read", issuer: ISSUER });
      const pending = await db.agentConnectionRequest.create({
        data: {
          deviceCodeHash: `hash-${userId}`,
          userCode: `CODE-${userId.slice(-4)}`,
          agentName: "Approved but uncollected",
          scopes: "kitchen:read",
          status: "approved",
          approvedById: userId,
          approvedAt: new Date(),
          expiresAt: new Date(Date.now() + 600_000),
        },
      });
      return { db, personal, delegated, oauth, pending };
    }

    async function expectAllRevoked(seed: Awaited<ReturnType<typeof seedAccess>>, reason: string) {
      for (const token of [seed.personal.token, seed.delegated.token, seed.oauth.accessToken]) {
        await expect(authenticateApiToken(seed.db, token, ISSUER)).rejects.toMatchObject({ status: 401 });
      }
      expect(await seed.db.oAuthRefreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
      const grants = await seed.db.oAuthGrant.findMany({ where: { userId } });
      expect(grants.map((grant) => [grant.status, grant.statusReason])).toEqual([["revoked", reason]]);
      const request = await seed.db.agentConnectionRequest.findUniqueOrThrow({ where: { id: seed.pending.id } });
      expect(request.status).toBe("denied");
    }

    it("sign out everywhere revokes API tokens, delegated tokens, OAuth connections and approved agent requests", async () => {
      const seed = await seedAccess();
      await expect(authenticateApiToken(seed.db, seed.personal.token, ISSUER)).resolves.toMatchObject({ id: userId });

      await postAction(cookiePair(await createUserSessionCookie(userId)), { intent: "signOutEverywhere" });

      await expectAllRevoked(seed, "security_event");
    });

    it("a password change revokes bearer credentials by default", async () => {
      const seed = await seedAccess();

      await postAction(cookiePair(await createUserSessionCookie(userId)), {
        intent: "changePassword",
        currentPassword: PASSWORD,
        newPassword: "newSecurePassword456!",
        confirmPassword: "newSecurePassword456!",
        connectionsChoice: "1",
        revokeConnections: "on",
      });

      await expectAllRevoked(seed, "security_event");
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
        message: "Your password has been changed. Other browsers have been signed out, and apps, agents and API tokens have been disconnected.",
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
