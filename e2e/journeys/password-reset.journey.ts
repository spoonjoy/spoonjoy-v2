import type { Page } from "@playwright/test";
import { test, expect } from "./support/journey";
import { persona } from "./support/personas";
import { requiredLabel } from "./support/forms";
import { attachCapturedMail, resetLinkPath, waitForCapturedMail } from "./support/captured-mail";
import { pathUrl, waitForHydration } from "./support/navigation";
import { scratchForProject } from "./support/personas";
import { Secret, fillSecret } from "./support/secret";

// The forgot-password flow as a signed-out visitor sees it: the way in from /login, an answer that
// never says whether an address has an account, a dead link's way out, and the whole round trip
// through the mail. QA captures account mail instead of sending it (SPOONJOY_EMAIL_MODE=capture),
// so the round trip reads the reset link from the run's database (support/captured-mail.ts).
//
// The round trip resets scratch index 14's password (the base account on iPhone, the desktop twin on
// desktop Chrome), so no other journey uses that index. Its sign-in with the new password is one
// sign-in attempt per device, two per run (support/scratch-budget.ts).
const SCRATCH_INDEX = 14;
test.describe("Password reset", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("log in offers a way to reset a forgotten password", async ({ page, expectAccessible }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole("heading", { name: "Reset your password", level: 1 })).toBeVisible();
    await expectAccessible();
  });

  /** Asks for a reset link for this address and answers the page's text with the address blanked out. */
  async function requestLink(page: Page, email: string): Promise<string> {
    await page.goto("/forgot-password");
    await page.getByLabel(requiredLabel("Email")).fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email", level: 1 })).toBeVisible();
    await expect(page.getByText("If an account uses that email, a reset link is on its way.")).toBeVisible();
    const text = await page.getByRole("main").innerText();
    return text.split(email).join("<address>");
  }

  test("answers an address with an account and one without in the same words", async ({ page, expectAccessible }) => {
    const known = await requestLink(page, persona("newbie").email);
    await expectAccessible();
    const unknown = await requestLink(page, `codex-e2e-no-account-${Date.now()}@example.com`);
    expect(unknown).toBe(known);
  });

  test("a used or unknown reset link offers a new one", async ({ page, expectAccessible }) => {
    await page.goto("/reset-password?token=journeyunknowntoken");
    await expect(page.getByText("This reset link has expired or was already used.")).toBeVisible();
    await page.getByRole("link", { name: "Send a new link" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expectAccessible();
  });

  test("a reset link from the mail sets a new password that signs in, after a reload @mutates", async ({
    page,
    verifyAfterReload,
    expectAccessible,
  }, testInfo) => {
    const account = scratchForProject(SCRATCH_INDEX, testInfo.project.name);
    const newPassword = Secret.generate();

    // Ask for a link.
    await page.goto("/forgot-password");
    await waitForHydration(page);
    await page.getByLabel(requiredLabel("Email")).fill(account.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email", level: 1 })).toBeVisible();

    // The mail QA captured holds the link. It works once, and it is used below, so the copy of it in
    // the report's step titles is dead by the time anyone can read the report.
    const mail = await waitForCapturedMail(account.email, "reset_password");
    expect(mail.text).toContain("Someone asked to reset the password for your Spoonjoy account.");
    await attachCapturedMail(testInfo, page, mail, "password-reset");
    const link = resetLinkPath(mail.text);

    // Choose a new password from the link.
    await page.goto(link);
    await waitForHydration(page);
    await expect(page.getByRole("heading", { name: "Choose a new password", level: 1 })).toBeVisible();
    await expectAccessible();
    await fillSecret(page.getByLabel(requiredLabel("New password"), { exact: true }), newPassword);
    await fillSecret(page.getByLabel(requiredLabel("Confirm new password"), { exact: true }), newPassword);
    await page.getByRole("button", { name: "Reset password", exact: true }).click();
    await expect(page.getByText("Your password has been reset.")).toBeVisible();
    await testInfo.attach("password-reset-done", { body: await page.getByRole("main").screenshot(), contentType: "image/png" });

    // The link is spent.
    await page.goto(link);
    await expect(page.getByText("This reset link has expired or was already used.")).toBeVisible();

    // The new password signs in, and the account is still signed in after a reload.
    await page.goto("/login");
    await waitForHydration(page);
    await page.getByLabel(requiredLabel("Username or email"), { exact: true }).fill(account.username);
    await fillSecret(page.getByLabel(requiredLabel("Password"), { exact: true }), newPassword);
    await page.getByRole("main").getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto("/account/settings");
    await expect(page).toHaveURL(pathUrl("/account/settings"));
    await expect(page.getByTestId("user-info-section")).toContainText(account.username);
    await testInfo.attach("password-reset-signed-in", {
      body: await page.getByTestId("user-info-section").screenshot(),
      contentType: "image/png",
    });

    await verifyAfterReload(async () => {
      await expect(page).toHaveURL(pathUrl("/account/settings"));
      await expect(page.getByTestId("user-info-section")).toContainText(account.username);
    });
  });
});
