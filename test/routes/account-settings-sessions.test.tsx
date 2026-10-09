import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { faker } from "@faker-js/faker";
import { createTestRoutesStub } from "../utils";
import { getLocalDb } from "~/lib/db.server";
import { createUser, verifyPassword } from "~/lib/auth.server";
import { createUserSessionCookie, getSessionAuthenticatedAt, getSessionIdentity, getUserId } from "~/lib/session.server";
import type { AccountSettingsActionResult } from "~/lib/account-settings.server";
import AccountSettings, { action } from "~/routes/account.settings";
import { cleanupDatabase } from "../helpers/cleanup";

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
        message: "You've been signed out everywhere else. You're still signed in here.",
      });
      expect(await currentVersion(userId)).toBe(1);

      const reissued = cookiePair(result.init.headers["Set-Cookie"]);
      await expect(getSessionIdentity(pageRequest(reissued))).resolves.toEqual({ userId, sessionVersion: 1 });
      await expect(getUserId(pageRequest(reissued))).resolves.toBe(userId);
      await expect(getUserId(pageRequest(thisBrowser))).resolves.toBeNull();
      await expect(getUserId(pageRequest(otherBrowser))).resolves.toBeNull();
    });

    it("keeps this browser's sign-in time on the re-issued session", async () => {
      const thisBrowser = cookiePair(await createUserSessionCookie(userId, null, null, { authenticatedAt: 1_700_000_000_000 }));

      const result = (await postAction(thisBrowser, { intent: "signOutEverywhere" })) as unknown as DataResult;

      const reissued = cookiePair(result.init.headers["Set-Cookie"]);
      await expect(getSessionAuthenticatedAt(pageRequest(reissued))).resolves.toBe(1_700_000_000_000);
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
        message: "Your password has been changed successfully. Other browsers signed in to your account have been signed out.",
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
