import { randomBytes } from "node:crypto";
import { test, expect } from "../fixtures";
import { Secret, fillSecret } from "../journeys/support/secret";

// Account mail from a self-hosted server, through its owner's SMTP server (SPOONJOY_SMTP_*). The Self-host Image
// workflow starts Mailpit as that server and sets SPOONJOY_SELF_HOST_MAIL to the address of its API; without it, this
// is skipped. A cook who forgot their password asks for a reset, follows the link in the mail Mailpit caught, chooses a
// new password and signs in with it.
const mailpit = process.env.SPOONJOY_SELF_HOST_MAIL;

type Found = { messages: { ID: string; Subject: string; From: { Address: string } }[] };

test.describe("Account mail from a self-hosted server through its SMTP server", () => {
  test.skip(!mailpit, "SPOONJOY_SELF_HOST_MAIL comes from the workflow, with an SMTP server that catches the mail");

  test("a cook resets a forgotten password from the link in the mail", async ({ page, browser, request }, testInfo) => {
    const suffix = randomBytes(4).toString("hex");
    const cook = { email: `mail-${suffix}@example.test`, username: `mail${suffix}`, password: new Secret(`Pw-${randomBytes(12).toString("hex")}`) };
    const newPassword = new Secret(`Pw-${randomBytes(12).toString("hex")}`);

    await page.goto("/signup");
    await page.getByLabel("Email").first().fill(cook.email);
    await page.getByLabel("Username").first().fill(cook.username);
    await fillSecret(page.getByLabel("Password", { exact: true }).first(), cook.password);
    await fillSecret(page.getByLabel("Confirm Password").first(), cook.password);
    await page.getByRole("button", { name: /sign up/i }).first().click();
    await expect(page).toHaveURL("/");
    await page.context().clearCookies();

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(cook.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("If an account uses that email, a reset link is on its way.")).toBeVisible();
    await page.locator("main").screenshot({ path: testInfo.outputPath("mail-reset-asked.png") });

    let found: Found["messages"] = [];
    await expect(async () => {
      const answer = await request.get(`${mailpit}/api/v1/search`, { params: { query: `to:"${cook.email}" subject:"Reset your Spoonjoy password"` } });
      expect(answer.ok()).toBe(true);
      found = ((await answer.json()) as Found).messages;
      expect(found).toHaveLength(1);
    }).toPass({ timeout: 30_000 });
    expect(found[0]!.From.Address).toBe("kitchen@example.com");

    const mail = (await (await request.get(`${mailpit}/api/v1/message/${found[0]!.ID}`)).json()) as { Text: string; HTML: string };
    const link = mail.Text.match(/http\S+\/reset-password\?token=\S+/)?.[0];
    expect(link, "the mail carries a reset link to this server").toBeDefined();
    expect(new URL(link!).origin).toBe(new URL(page.url()).origin);

    // The mail has a plain-text part and an HTML part, sent as alternatives, and both carry the same link.
    const headers = (await (await request.get(`${mailpit}/api/v1/message/${found[0]!.ID}/headers`)).json()) as Record<string, string[]>;
    expect(headers["Content-Type"]?.[0]).toMatch(/^multipart\/alternative;/);
    expect(mail.HTML).toContain(link!.replaceAll("&", "&amp;"));

    // The mail as the SMTP server caught it, outside the app, so the app's browser checks don't apply to its page.
    const inbox = await browser.newContext({ viewport: { width: 900, height: 700 } });
    const view = await inbox.newPage();
    await view.goto(`${mailpit}/view/${found[0]!.ID}`);
    await expect(view.getByRole("cell", { name: "Reset your Spoonjoy password" })).toBeVisible();
    await view.screenshot({ path: testInfo.outputPath("mail-reset-caught.png") });
    // The HTML part on its own, as a mail app shows it.
    await view.goto(`${mailpit}/view/${found[0]!.ID}.html`);
    await expect(view.locator("body")).toContainText(/spoonjoy/i);
    await view.screenshot({ path: testInfo.outputPath("mail-reset-html.png"), fullPage: true });
    await inbox.close();

    await page.goto(link!);
    await fillSecret(page.getByLabel("New password", { exact: true }), newPassword);
    await fillSecret(page.getByLabel("Confirm new password", { exact: true }), newPassword);
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page.getByText("Your password has been reset.")).toBeVisible();

    await page.goto("/login");
    await page.getByLabel("Username or email").first().fill(cook.email);
    await fillSecret(page.getByLabel("Password", { exact: true }).first(), newPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => url.pathname !== "/login");
    await page.goto("/account/settings");
    await expect(page.getByText(cook.email).first()).toBeVisible();
    await page.locator("main").screenshot({ path: testInfo.outputPath("mail-signed-in-after-reset.png") });
  });
});
