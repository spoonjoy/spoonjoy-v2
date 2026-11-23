import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { Secret, fillSecret } from "../journeys/support/secret";

// A fresh self-hosted server needs no setup before its owner signs in: they sign up with a
// password, add a passkey, and sign back in with it. The Spoonjoy apps' Sign in with Apple is
// accepted out of the box too, checked against Apple's public keys with no secret. The first
// account is the server's admin, who decides who else may sign up and makes invite links.
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

  // Who else may make an account: the first account is the server's admin, the server is
  // invite-only from then on, and an invite link lets one person sign up (app/lib/server-access.server.ts).
  let inviteLink = "";
  const invitee = { email: `invitee-${suffix}@example.test`, username: `invitee${suffix}`, password: new Secret(`Pw-${randomBytes(12).toString("hex")}`) };

  async function signInAsOwner(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Username or email").first().fill(owner.email);
    await fillSecret(page.getByLabel("Password", { exact: true }).first(), owner.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => url.pathname !== "/login");
  }

  test("its first account is the admin and finds the server's settings in account settings", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/account/settings");
    await page.getByTestId("server-settings-section").getByRole("link", { name: "Server settings" }).click();
    await expect(page).toHaveURL("/account/server");
    await expect(page.getByRole("heading", { name: "This server" })).toBeVisible();
    await expect(page.getByTestId("server-signups-mode")).toHaveText("Invite only");
  });

  test("the admin can open sign-ups and turn them off again", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/account/server");
    await page.getByRole("button", { name: "Open sign-ups" }).click();
    await expect(page.getByTestId("server-signups-mode")).toHaveText("Open");
    await page.getByRole("button", { name: "Make invite-only" }).click();
    await expect(page.getByTestId("server-signups-mode")).toHaveText("Invite only");
  });

  test("a stranger is refused at /signup while sign-ups are off", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByTestId("signups-closed")).toContainText("This server is invite-only. Ask its owner for an invite link.");
    await expect(page.getByRole("button", { name: /sign up/i })).toHaveCount(0);
  });

  test("the admin makes an invite link to copy", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/account/server");
    await page.getByRole("button", { name: "Make an invite link" }).click();
    const link = page.getByTestId("server-invite-link");
    await expect(link).toContainText("/signup?invite=");
    await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
    inviteLink = (await link.textContent()) ?? "";
    expect(new URL(inviteLink).searchParams.get("invite")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("the invitee signs up with the link", async ({ page }) => {
    expect(inviteLink).not.toBe("");
    await page.goto(new URL(inviteLink).pathname + new URL(inviteLink).search);
    await expect(page.getByText("You're invited to this Spoonjoy server.")).toBeVisible();
    await page.getByLabel("Email").first().fill(invitee.email);
    await page.getByLabel("Username").first().fill(invitee.username);
    await fillSecret(page.getByLabel("Password", { exact: true }).first(), invitee.password);
    await fillSecret(page.getByLabel("Confirm Password").first(), invitee.password);
    await page.getByRole("button", { name: /sign up/i }).first().click();
    await expect(page).toHaveURL("/");
    await page.goto("/account/settings");
    await expect(page.getByTestId("user-info-section")).toContainText(invitee.username);
    await expect(page.getByTestId("server-settings-section")).toHaveCount(0);
  });

  test("the used invite link no longer works", async ({ page }) => {
    await page.goto(new URL(inviteLink).pathname + new URL(inviteLink).search);
    await expect(page.getByTestId("signups-closed")).toContainText("This invite link has already been used.");
    await expect(page.getByRole("button", { name: /sign up/i })).toHaveCount(0);
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
