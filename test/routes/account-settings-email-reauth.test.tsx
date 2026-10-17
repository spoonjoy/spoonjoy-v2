// Account settings: changing the email needs proof the owner is here right now (audit 2026-10-09,
// finding 2). A stolen session could otherwise move the account to the thief's address and then
// sign in with Google or GitHub there. The proof is the one account deletion asks for: the current
// password, or for an account without one, a sign-in within the last 10 minutes. A username-only
// save needs no proof.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { cleanup, act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { faker } from "@faker-js/faker";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { createUserSessionCookie } from "~/lib/session.server";
import {
  EMAIL_CHANGE_REAUTH_REDIRECT,
  EMAIL_CHANGE_RECENT_SIGN_IN_MESSAGE,
  type AccountSettingsActionResult,
} from "~/lib/account-settings.server";
import AccountSettings, { action } from "~/routes/account.settings";
import { cleanupDatabase } from "../helpers/cleanup";

const PASSWORD = "testPassword123";
const MINUTE = 60_000;

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0];
}

async function postAction(cookie: string, fields: Record<string, string>, env: Record<string, unknown> | null = null) {
  const request = new UndiciRequest("http://localhost:3000/account/settings", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  try {
    return (await action({ request, context: { cloudflare: { env } }, params: {} } as any)) as AccountSettingsActionResult;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

function newEmail() {
  return `moved-${faker.string.alphanumeric(10).toLowerCase()}@example.com`;
}

async function storedEmail(userId: string) {
  return (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } })).email;
}

async function passwordChef() {
  const user = await createUser(db, `chef-${faker.string.alphanumeric(10).toLowerCase()}@example.com`, `chef_${faker.string.alphanumeric(8)}`, PASSWORD);
  return { user, cookie: cookiePair(await createUserSessionCookie(user.id)) };
}

async function passwordlessChef(signedInAt: number) {
  const user = await db.user.create({
    data: {
      email: `oauth-${faker.string.alphanumeric(10).toLowerCase()}@example.com`,
      username: `oauth_${faker.string.alphanumeric(8)}`,
      OAuth: { create: { provider: "github", providerUserId: faker.string.alphanumeric(10), providerUsername: "gh" } },
    },
  });
  return { user, cookie: cookiePair(await createUserSessionCookie(user.id, null, null, { authenticatedAt: signedInAt })) };
}

beforeEach(async () => {
  await cleanupDatabase();
});

afterEach(async () => {
  cleanup();
  await cleanupDatabase();
});

describe("Account settings - email change needs owner proof", () => {
  it("changes the email of a password account only with its current password", async () => {
    const { user, cookie } = await passwordChef();
    const target = newEmail();
    const fields = { intent: "updateUserInfo", email: target, username: user.username };

    await expect(postAction(cookie, fields)).resolves.toEqual({
      success: false,
      intent: "updateUserInfo",
      error: "password_required",
      fieldErrors: { currentPassword: "Enter your current password to confirm it's you." },
    });
    await expect(postAction(cookie, { ...fields, currentPassword: "wrong-password" })).resolves.toEqual({
      success: false,
      intent: "updateUserInfo",
      error: "password_incorrect",
      fieldErrors: { currentPassword: "That password isn't right." },
    });
    expect(await storedEmail(user.id)).toBe(user.email);

    await expect(postAction(cookie, { ...fields, currentPassword: PASSWORD })).resolves.toEqual({
      success: true,
      intent: "updateUserInfo",
      message: "Account details saved.",
    });
    expect(await storedEmail(user.id)).toBe(target);
  });

  it("saves a username change, or an unchanged email in other letter case, without a password", async () => {
    const { user, cookie } = await passwordChef();
    const renamed = `renamed_${faker.string.alphanumeric(8)}`;

    await expect(postAction(cookie, { intent: "updateUserInfo", email: ` ${user.email.toUpperCase()} `, username: renamed }))
      .resolves.toMatchObject({ success: true, intent: "updateUserInfo" });
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.username).toBe(renamed);
    expect(stored.email).toBe(user.email);
  });

  it("asks for proof before saying whether another account holds the new email", async () => {
    const { user, cookie } = await passwordChef();
    const taken = await createUser(db, newEmail(), `other_${faker.string.alphanumeric(8)}`, PASSWORD);
    const fields = { intent: "updateUserInfo", email: taken.email, username: user.username };

    // Without proof, a stolen session can't use this form to learn which emails have accounts.
    await expect(postAction(cookie, fields)).resolves.toMatchObject({ error: "password_required" });
    await expect(postAction(cookie, { ...fields, currentPassword: PASSWORD })).resolves.toMatchObject({ error: "email_taken" });
  });

  it("lets a passwordless account change its email only within ten minutes of signing in", async () => {
    const stale = await passwordlessChef(Date.now() - 11 * MINUTE);
    const staleTarget = newEmail();
    await expect(postAction(stale.cookie, { intent: "updateUserInfo", email: staleTarget, username: stale.user.username }))
      .resolves.toEqual({
        success: false,
        intent: "updateUserInfo",
        error: "recent_sign_in_required",
        fieldErrors: { email: EMAIL_CHANGE_RECENT_SIGN_IN_MESSAGE },
      });
    expect(EMAIL_CHANGE_RECENT_SIGN_IN_MESSAGE).toBe("For your safety, sign in again, then change your email within 10 minutes.");
    expect(await storedEmail(stale.user.id)).toBe(stale.user.email);

    const fresh = await passwordlessChef(Date.now() - MINUTE);
    const freshTarget = newEmail();
    await expect(postAction(fresh.cookie, { intent: "updateUserInfo", email: freshTarget, username: fresh.user.username }))
      .resolves.toMatchObject({ success: true });
    expect(await storedEmail(fresh.user.id)).toBe(freshTarget);
  });

  it("rate limits email change attempts", async () => {
    const { user, cookie } = await passwordChef();
    const limited = { AUTH_IP_RATE_LIMITER: { limit: async () => ({ success: false }) } };

    await expect(postAction(cookie, { intent: "updateUserInfo", email: newEmail(), username: user.username, currentPassword: PASSWORD }, limited))
      .resolves.toEqual({
        success: false,
        intent: "updateUserInfo",
        error: "rate_limited",
        fieldErrors: { currentPassword: "Too many attempts. Try again in a few minutes." },
      });
    expect(await storedEmail(user.id)).toBe(user.email);

    // A username-only save is not an attempt at proof, so it is not rate limited.
    await expect(postAction(cookie, { intent: "updateUserInfo", email: user.email, username: `renamed_${faker.string.alphanumeric(8)}` }, limited))
      .resolves.toMatchObject({ success: true });
  });

  it("signs a passwordless chef out and back in to the email form", async () => {
    const { cookie } = await passwordlessChef(Date.now() - 11 * MINUTE);
    const response = (await postAction(cookie, { intent: "reauthenticate", for: "email" })) as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(EMAIL_CHANGE_REAUTH_REDIRECT);
    expect(EMAIL_CHANGE_REAUTH_REDIRECT).toBe("/login?redirectTo=%2Faccount%2Fsettings%23user-info");
  });
});

describe("Account settings - email change form", () => {
  function renderSettings(hasPassword: boolean, result: Record<string, unknown>, onAction: (fields: Record<string, string>) => void) {
    const loaderData = {
      user: { id: "u1", email: "ada@example.com", username: "ada", hasPassword, oauthAccounts: [{ provider: "github", providerUsername: "ada" }], photoUrl: null, passkeys: [] },
      notifications: { pushSubscribed: false, preferences: {} },
    };
    const Stub = createTestRoutesStub([
      {
        path: "/account/settings",
        Component: AccountSettings,
        loader: () => loaderData,
        action: async ({ request }) => {
          onAction(Object.fromEntries((await request.formData()).entries()) as Record<string, string>);
          return result;
        },
      },
    ]);
    render(<Stub initialEntries={["/account/settings"]} />);
  }

  it("asks a password account for its current password and shows why it was refused", async () => {
    const user = userEvent.setup();
    const posted: Array<Record<string, string>> = [];
    renderSettings(true, {
      success: false,
      intent: "updateUserInfo",
      error: "password_incorrect",
      fieldErrors: { currentPassword: "That password isn't right." },
    }, (f) => posted.push(f));

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const section = screen.getByTestId("user-info-section");
    expect(section.closest("#user-info")).not.toBeNull();
    expect(within(section).getByText("Needed only to change your email.")).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "Sign in again" })).not.toBeInTheDocument();

    const email = within(section).getByLabelText("Email");
    await user.clear(email);
    await user.type(email, "new@example.com");
    await user.type(within(section).getByLabelText("Current password"), "nope");
    await user.click(within(section).getByRole("button", { name: "Save" }));

    const error = await within(section).findByText("That password isn't right.");
    // FieldError's text precedes its real-frame entrance completion.
    await act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
    expect(error).toBeInTheDocument();
    expect(error).not.toHaveAttribute("data-starting-style");
    expect(within(section).getByLabelText("Current password")).toHaveAttribute("aria-invalid", "true");
    expect(posted).toEqual([{ intent: "updateUserInfo", email: "new@example.com", username: "ada", currentPassword: "nope" }]);
    // The error shows by the field, not in the page banner.
    for (const alert of screen.queryAllByRole("alert")) expect(section).toContainElement(alert);
  });

  it("asks a passwordless chef for a recent sign-in and offers to sign in again", async () => {
    const user = userEvent.setup();
    const posted: Array<Record<string, string>> = [];
    renderSettings(false, {
      success: false,
      intent: "updateUserInfo",
      error: "recent_sign_in_required",
      fieldErrors: { email: EMAIL_CHANGE_RECENT_SIGN_IN_MESSAGE },
    }, (f) => posted.push(f));

    expect(await screen.findByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in again" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const section = screen.getByTestId("user-info-section");
    expect(within(section).queryByLabelText("Current password")).not.toBeInTheDocument();
    expect(within(section).getByText(/To change your email, you need to have signed in within the last 10 minutes/)).toBeInTheDocument();

    await user.click(within(section).getByRole("button", { name: "Save" }));
    const error = await within(section).findByText(EMAIL_CHANGE_RECENT_SIGN_IN_MESSAGE);
    await act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
    expect(error).toBeInTheDocument();
    expect(error).not.toHaveAttribute("data-starting-style");

    await user.click(within(section).getByRole("button", { name: "Sign in again" }));
    expect(posted.map((f) => f.intent)).toEqual(["updateUserInfo", "reauthenticate"]);
    expect(posted[1]).toEqual({ intent: "reauthenticate", for: "email" });
  });
});
