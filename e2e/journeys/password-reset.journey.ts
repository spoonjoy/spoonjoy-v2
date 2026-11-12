import type { Page } from "@playwright/test";
import { test, expect } from "./support/journey";
import { persona } from "./support/personas";
import { requiredLabel } from "./support/forms";

// The forgot-password flow as a signed-out visitor sees it. The reset mail itself is read by the
// unit tests (test/lib/password-reset.server.test.ts follows the captured link through its whole
// life); a journey can't open a mailbox, so it checks what the page can show: the way in from
// /login, an answer that never says whether an address has an account, and a dead link's way out.
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
});
