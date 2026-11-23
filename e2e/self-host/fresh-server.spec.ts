import { randomBytes } from "node:crypto";
import { test, expect } from "../fixtures";
import { Secret, fillSecret } from "../journeys/support/secret";

// A fresh self-hosted server needs no setup before its owner signs in: they sign up with a
// password, add a passkey, and sign back in with it. The Spoonjoy apps' Sign in with Apple is
// accepted out of the box too, checked against Apple's public keys with no secret.
test.describe("A fresh self-hosted server", () => {
  test.describe.configure({ mode: "serial" });

  const suffix = randomBytes(4).toString("hex");
  const owner = { email: `owner-${suffix}@example.test`, username: `owner${suffix}`, password: new Secret(`Pw-${randomBytes(12).toString("hex")}`) };

  test("its owner signs up with a password, adds a passkey and signs back in with it", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });

    await page.goto("/signup");
    await page.getByLabel("Email").first().fill(owner.email);
    await page.getByLabel("Username").first().fill(owner.username);
    await fillSecret(page.getByLabel("Password", { exact: true }).first(), owner.password);
    await fillSecret(page.getByLabel("Confirm Password").first(), owner.password);
    await page.getByRole("button", { name: /sign up/i }).first().click();
    await expect(page).toHaveURL("/");

    await page.goto("/account/settings");
    const passkeys = page.getByTestId("passkeys-section");
    await passkeys.getByLabel(/name \(optional\)/i).fill("Owner's key");
    await passkeys.getByRole("button", { name: /add a passkey/i }).click();
    await expect(passkeys.getByText("Owner's key")).toBeVisible();

    await page.getByRole("button", { name: /log\s*out/i }).first().click();
    await page.waitForURL((url) => !url.pathname.startsWith("/account"));

    await page.goto("/login");
    await page.getByLabel("Username or email").first().fill(owner.email);
    await page.getByRole("button", { name: /sign in with a passkey/i }).first().click();
    await page.waitForURL((url) => url.pathname !== "/login");
    await page.goto("/account/settings");
    await expect(page.getByTestId("passkeys-section").getByText("Owner's key")).toBeVisible();
  });

  test("the Spoonjoy apps' Sign in with Apple is set up, and a token Apple didn't sign is refused", async ({ request }) => {
    const response = await request.post("/api/v1/auth/apple/native", {
      data: { identityToken: "eyJhbGciOiJSUzI1NiIsImtpZCI6Im5vdC1hcHBsZSJ9.eyJpc3MiOiJodHRwczovL2FwcGxlaWQuYXBwbGUuY29tIn0.c2ln", rawNonce: "fresh-server-nonce" },
    });
    const body = JSON.stringify(await response.json());
    expect(response.status(), body).toBe(401);
    expect(body).toContain("invalid_token");
    expect(body).toContain("not currently trusted");
  });
});
