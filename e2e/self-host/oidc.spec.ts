import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { Secret, fillSecret } from "../journeys/support/secret";

// A self-hosted server whose owner set SPOONJOY_OIDC_* to their own OpenID Connect provider shows
// its button on the sign-in page. The Self-host Image workflow runs this against Dex
// (e2e/self-host/dex.yaml) on the server fresh-server.spec.ts left invite-only, and sets
// SPOONJOY_SELF_HOST_OIDC_LABEL to the label it gave the server and SPOONJOY_SELF_HOST_INVITE_FILE
// to the invite link that file's admin made; without them, this is skipped. Dex's user has no
// account here, so the provider's sign-in must pass the same sign-up gate as a password.
const label = process.env.SPOONJOY_SELF_HOST_OIDC_LABEL;
const inviteFile = process.env.SPOONJOY_SELF_HOST_INVITE_FILE;
const cook = { email: "oidc-owner@example.test", password: new Secret("owner-test-password") };

async function signInAtDex(page: Page) {
  await page.waitForURL((url) => url.port === "5556");
  await page.getByLabel("Email Address").fill(cook.email);
  await fillSecret(page.getByLabel("Password"), cook.password);
  await page.getByRole("button", { name: "Login" }).click();
}

test.describe("A self-hosted server with its owner's OpenID Connect provider", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!label || !inviteFile, "SPOONJOY_SELF_HOST_OIDC_LABEL and SPOONJOY_SELF_HOST_INVITE_FILE come from the workflow");

  test("refuses a new account through the provider while sign-ups are off", async ({ page }, testInfo) => {
    await page.goto("/login");
    await page.getByRole("link", { name: label }).click();
    await signInAtDex(page);

    await page.waitForURL((url) => url.port === "8080" && url.searchParams.get("oauthError") === "signups_closed");
    await expect(page.getByText("This server is invite-only. Ask its owner for an invite link.")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("oidc-stranger-refused.png"), fullPage: true });
  });

  test("signs a new cook up through the provider from an invite link", async ({ page }, testInfo) => {
    const invite = new URL(readFileSync(inviteFile!, "utf8").trim());
    await page.goto(invite.pathname + invite.search);
    await expect(page.getByText("You're invited to this Spoonjoy server.")).toBeVisible();
    await page.getByRole("link", { name: label }).click();
    await signInAtDex(page);

    await page.waitForURL((url) => url.port === "8080" && url.pathname === "/recipes");
    await page.goto("/account/settings");
    await expect(page).toHaveURL("/account/settings");
    await expect(page.getByText(cook.email).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("oidc-signed-up-from-invite.png"), fullPage: true });
  });

  test("signs that cook back in through the provider with no invite", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: label }).click();
    await signInAtDex(page);

    await page.waitForURL((url) => url.port === "8080" && url.pathname === "/recipes");
  });
});
