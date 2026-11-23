import { test, expect } from "../fixtures";
import { Secret, fillSecret } from "../journeys/support/secret";

// A self-hosted server whose owner set SPOONJOY_OIDC_* to their own OpenID Connect provider shows
// its button on the sign-in page, and signing in through the provider lands signed in. The
// Self-host Image workflow runs it against Dex (e2e/self-host/dex.yaml) and sets
// SPOONJOY_SELF_HOST_OIDC_LABEL to the label it gave the server; without it, this is skipped.
const label = process.env.SPOONJOY_SELF_HOST_OIDC_LABEL;
const owner = { email: "oidc-owner@example.test", password: new Secret("owner-test-password") };

test.describe("A self-hosted server with its owner's OpenID Connect provider", () => {
  test.skip(!label, "SPOONJOY_SELF_HOST_OIDC_LABEL names the server's OpenID Connect button");

  test("signs its owner in through the provider", async ({ page }, testInfo) => {
    await page.goto("/login");
    await page.getByRole("link", { name: label }).click();

    await page.waitForURL((url) => url.port === "5556");
    await page.getByLabel("Email Address").fill(owner.email);
    await fillSecret(page.getByLabel("Password"), owner.password);
    await page.getByRole("button", { name: "Login" }).click();

    await page.waitForURL((url) => url.port === "8080" && url.pathname === "/recipes");
    await page.goto("/account/settings");
    await expect(page).toHaveURL("/account/settings");
    await expect(page.getByText(owner.email).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("oidc-signed-in.png"), fullPage: true });
  });
});
