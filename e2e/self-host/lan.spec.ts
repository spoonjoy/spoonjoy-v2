import { randomBytes } from "node:crypto";
import { test, expect } from "../fixtures";
import { Secret, fillSecret } from "../journeys/support/secret";

// A server on a home network, reached at a plain http:// address that isn't localhost, as most
// owners first start it. Its owner declares that address as SPOONJOY_BASE_URL, so the session
// cookie comes without Secure (a browser drops a Secure cookie on plain http) and sign-in works.
// Passkeys need HTTPS or localhost, so the browser offers none here and sign-in is by password.
// The Self-host Image workflow starts the server on Docker's bridge, sets SPOONJOY_SELF_HOST_LAN
// and points this at the container's own address; without it, this is skipped.
test.describe("A self-hosted server at a plain http:// network address", () => {
  test.skip(!process.env.SPOONJOY_SELF_HOST_LAN, "SPOONJOY_SELF_HOST_LAN comes from the workflow, with a server at a network address");

  test("its owner signs up, signs out and signs back in, and stays signed in after a reload", async ({ page, baseURL }, testInfo) => {
    const address = new URL(baseURL!);
    expect(address.protocol).toBe("http:");
    expect(["localhost", "127.0.0.1", "[::1]"]).not.toContain(address.hostname);

    const suffix = randomBytes(4).toString("hex");
    const owner = { email: `lan-${suffix}@example.test`, username: `lan${suffix}`, password: new Secret(`Pw-${randomBytes(12).toString("hex")}`) };

    await page.goto("/signup");
    await page.getByLabel("Email").first().fill(owner.email);
    await page.getByLabel("Username").first().fill(owner.username);
    await fillSecret(page.getByLabel("Password", { exact: true }).first(), owner.password);
    await fillSecret(page.getByLabel("Confirm Password").first(), owner.password);
    await page.getByRole("button", { name: /sign up/i }).first().click();
    await expect(page).toHaveURL("/");

    const session = (await page.context().cookies()).find((cookie) => cookie.name === "__session");
    expect(session, "the server set a session cookie the browser kept").toBeDefined();
    expect(session!.secure).toBe(false);

    await page.goto("/account/settings");
    await page.getByRole("button", { name: /log\s*out/i }).first().click();
    await page.waitForURL((url) => !url.pathname.startsWith("/account"));

    await page.goto("/login");
    await expect(page.getByRole("button", { name: /sign in with a passkey/i })).toHaveCount(0);
    await page.getByLabel("Username or email").first().fill(owner.email);
    await fillSecret(page.getByLabel("Password", { exact: true }).first(), owner.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => url.pathname !== "/login");

    await page.goto("/account/settings");
    await page.reload();
    await expect(page).toHaveURL(/\/account\/settings$/);
    await expect(page.getByText(owner.email).first()).toBeVisible();
    await page.locator("main").screenshot({ path: testInfo.outputPath("lan-signed-in.png") });
  });
});
