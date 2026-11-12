// Account settings: removing the password needs proof the owner is here right now (issue #683).
// Otherwise anyone holding a signed-in session (an unattended browser) could remove the password,
// set a new one and take over password sign-in. The proof is the current password, or, for a chef
// who has forgotten it, a sign-in within the last 10 minutes, the window account deletion uses.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { cleanup, act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { faker } from "@faker-js/faker";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { createUserSessionCookie } from "~/lib/session.server";
import {
  REMOVE_PASSWORD_REAUTH_REDIRECT,
  REMOVE_PASSWORD_RECENT_SIGN_IN_MESSAGE,
  type AccountSettingsActionResult,
} from "~/lib/account-settings.server";
import AccountSettings, { action } from "~/routes/account.settings";
import { cleanupDatabase } from "../helpers/cleanup";

const PASSWORD = "testPassword123";
const REMOVED = { success: true, intent: "removePassword", message: "Your password has been removed successfully" };
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

/** A chef with a password and a linked Google account, signed in at `signedInAt` (null: no time recorded). */
async function googleLinkedChef(signedInAt: number | null) {
  const user = await createUser(db, `chef-${faker.string.alphanumeric(10).toLowerCase()}@example.com`, `chef_${faker.string.alphanumeric(8)}`, PASSWORD);
  await db.oAuth.create({ data: { provider: "google", providerUserId: `google-${user.id}`, providerUsername: user.email, userId: user.id } });
  return { user, cookie: cookiePair(await createUserSessionCookie(user.id, null, null, { authenticatedAt: signedInAt })) };
}

async function storedPassword(userId: string) {
  return (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { hashedPassword: true } })).hashedPassword;
}

beforeEach(async () => {
  await cleanupDatabase();
});

afterEach(async () => {
  cleanup();
  await cleanupDatabase();
});

describe("Account settings - removing the password needs owner proof", () => {
  it("removes the password with a blank current password within 10 minutes of signing in", async () => {
    const { user, cookie } = await googleLinkedChef(Date.now() - 9 * MINUTE);

    await expect(postAction(cookie, { intent: "removePassword", currentPassword: "" }))
      .resolves.toEqual(REMOVED);
    expect(await storedPassword(user.id)).toBeNull();
  });

  it("refuses a blank current password once the sign-in is older than 10 minutes", async () => {
    const { user, cookie } = await googleLinkedChef(Date.now() - 11 * MINUTE);

    await expect(postAction(cookie, { intent: "removePassword", currentPassword: "" })).resolves.toEqual({
      success: false,
      intent: "removePassword",
      error: "recent_sign_in_required",
      message: REMOVE_PASSWORD_RECENT_SIGN_IN_MESSAGE,
    });
    expect(REMOVE_PASSWORD_RECENT_SIGN_IN_MESSAGE)
      .toBe("For your safety, enter your current password, or sign in again and then remove it within 10 minutes.");
    expect(await storedPassword(user.id)).not.toBeNull();
  });

  it("refuses a blank current password when the session records no sign-in time", async () => {
    const { user, cookie } = await googleLinkedChef(null);

    await expect(postAction(cookie, { intent: "removePassword" }))
      .resolves.toMatchObject({ success: false, error: "recent_sign_in_required" });
    expect(await storedPassword(user.id)).not.toBeNull();
  });

  it("refuses a sign-in time in the future", async () => {
    const { user, cookie } = await googleLinkedChef(Date.now() + 5 * MINUTE);

    await expect(postAction(cookie, { intent: "removePassword" }))
      .resolves.toMatchObject({ success: false, error: "recent_sign_in_required" });
    expect(await storedPassword(user.id)).not.toBeNull();
  });

  it("removes the password with the correct current password however old the sign-in is", async () => {
    const { user, cookie } = await googleLinkedChef(Date.now() - 24 * 60 * MINUTE);

    await expect(postAction(cookie, { intent: "removePassword", currentPassword: PASSWORD }))
      .resolves.toEqual(REMOVED);
    expect(await storedPassword(user.id)).toBeNull();
  });

  it("refuses a wrong current password, even on a fresh sign-in", async () => {
    for (const signedInAt of [Date.now() - MINUTE, Date.now() - 11 * MINUTE]) {
      const { user, cookie } = await googleLinkedChef(signedInAt);

      await expect(postAction(cookie, { intent: "removePassword", currentPassword: "wrong-password" })).resolves.toEqual({
        success: false,
        intent: "removePassword",
        error: "invalid_current_password",
        message: "Your current password is incorrect",
      });
      expect(await storedPassword(user.id)).not.toBeNull();
    }
  });

  it("rate limits current password attempts", async () => {
    const { user, cookie } = await googleLinkedChef(Date.now() - 11 * MINUTE);
    const limited = { AUTH_IP_RATE_LIMITER: { limit: async () => ({ success: false }) } };

    await expect(postAction(cookie, { intent: "removePassword", currentPassword: PASSWORD }, limited)).resolves.toEqual({
      success: false,
      intent: "removePassword",
      error: "rate_limited",
      message: "Too many attempts. Try again in a few minutes.",
    });
    expect(await storedPassword(user.id)).not.toBeNull();
  });

  it("signs the chef out and back in to the password section", async () => {
    const { cookie } = await googleLinkedChef(Date.now() - 11 * MINUTE);
    const response = (await postAction(cookie, { intent: "reauthenticate", for: "password" })) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(REMOVE_PASSWORD_REAUTH_REDIRECT);
    expect(REMOVE_PASSWORD_REAUTH_REDIRECT).toBe("/login?redirectTo=%2Faccount%2Fsettings%23password");
  });
});

describe("Account settings - remove password confirmation", () => {
  function renderSettings(result: Record<string, unknown>, onAction: (fields: Record<string, string>) => void) {
    const loaderData = {
      user: {
        id: "u1",
        email: "ada@example.com",
        username: "ada",
        hasPassword: true,
        oauthAccounts: [{ provider: "google", providerUsername: "ada@gmail.com" }],
        photoUrl: null,
        passkeys: [],
      },
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

  async function openRemoveConfirmation(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Remove password" }));
    const section = screen.getByTestId("password-section");
    expect(section.closest("#password")).not.toBeNull();
    return section;
  }

  it("says a blank current password works after a recent sign-in, and offers to sign in again when it doesn't", async () => {
    const user = userEvent.setup();
    const posted: Array<Record<string, string>> = [];
    renderSettings({
      success: false,
      intent: "removePassword",
      error: "recent_sign_in_required",
      message: REMOVE_PASSWORD_RECENT_SIGN_IN_MESSAGE,
    }, (f) => posted.push(f));

    const section = await openRemoveConfirmation(user);
    expect(within(section).getByLabelText("Current password"))
      .toHaveAccessibleDescription("Forgotten it? Leave this blank if you signed in within the last 10 minutes.");
    expect(within(section).queryByRole("button", { name: "Sign in again" })).not.toBeInTheDocument();

    await user.click(within(section).getByRole("button", { name: "Confirm" }));
    const error = await within(section).findByText(REMOVE_PASSWORD_RECENT_SIGN_IN_MESSAGE);
    await act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
    expect(error).toBeInTheDocument();
    // The refusal shows in the Password section, not in the page banner.
    for (const alert of screen.queryAllByRole("alert")) expect(section).toContainElement(alert);

    await user.click(within(section).getByRole("button", { name: "Sign in again" }));
    expect(posted).toEqual([
      { intent: "removePassword", currentPassword: "" },
      { intent: "reauthenticate", for: "password" },
    ]);
  });

  it("confirms a removal in the Password section, as Set password does", async () => {
    const user = userEvent.setup();
    const posted: Array<Record<string, string>> = [];
    renderSettings(REMOVED, (f) => posted.push(f));

    const section = await openRemoveConfirmation(user);
    await user.click(within(section).getByRole("button", { name: "Confirm" }));

    const status = await within(section).findByRole("status");
    expect(status).toHaveTextContent("Your password has been removed successfully");
    // The confirmation closes, and the message shows once, in the section, not in the page banner.
    await waitFor(() => expect(within(section).queryByLabelText("Current password")).not.toBeInTheDocument());
    expect(screen.getAllByText("Your password has been removed successfully")).toHaveLength(1);
    expect(posted).toEqual([{ intent: "removePassword", currentPassword: "" }]);
  });

  it("doesn't show an earlier Set password message when the confirmation opens", async () => {
    const user = userEvent.setup();
    const answers: Array<Record<string, unknown>> = [
      { success: true, intent: "setPassword", message: "Your password has been set successfully" },
      REMOVED,
    ];
    let hasPassword = false;
    const loaderData = () => ({
      user: {
        id: "u1",
        email: "ada@example.com",
        username: "ada",
        hasPassword,
        oauthAccounts: [{ provider: "google", providerUsername: "ada@gmail.com" }],
        photoUrl: null,
        passkeys: [],
      },
      notifications: { pushSubscribed: false, preferences: {} },
    });
    const Stub = createTestRoutesStub([
      {
        path: "/account/settings",
        Component: AccountSettings,
        loader: loaderData,
        action: async () => {
          const answer = answers.shift()!;
          hasPassword = answer.intent === "setPassword";
          return answer;
        },
      },
    ]);
    render(<Stub initialEntries={["/account/settings"]} />);

    await user.click(await screen.findByRole("button", { name: "Set password" }));
    const section = screen.getByTestId("password-section");
    await user.type(within(section).getByLabelText("New password"), "brand-new-pass");
    await user.type(within(section).getByLabelText("Confirm password"), "brand-new-pass");
    await user.click(within(section).getByRole("button", { name: "Set password" }));
    expect(await within(section).findByRole("status")).toHaveTextContent("Your password has been set successfully");

    await user.click(await within(section).findByRole("button", { name: "Remove password" }));
    expect(within(section).queryByRole("status")).not.toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Confirm" }));
    expect(await within(section).findByRole("status")).toHaveTextContent("Your password has been removed successfully");
  });

  it("shows a wrong current password on the field", async () => {
    const user = userEvent.setup();
    renderSettings({
      success: false,
      intent: "removePassword",
      error: "invalid_current_password",
      message: "Your current password is incorrect",
    }, () => {});

    const section = await openRemoveConfirmation(user);
    await user.type(within(section).getByLabelText("Current password"), "nope");
    await user.click(within(section).getByRole("button", { name: "Confirm" }));

    await within(section).findByText("Your current password is incorrect");
    expect(within(section).getByLabelText("Current password")).toHaveAttribute("aria-invalid", "true");
    expect(within(section).queryByRole("button", { name: "Sign in again" })).not.toBeInTheDocument();
  });
});
