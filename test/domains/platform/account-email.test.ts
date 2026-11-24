import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderAccountEmail, shortLink, type AccountEmailContent } from "~/domains/platform";
import { passwordResetEmail } from "~/lib/password-reset.server";
import { householdInviteEmail } from "~/domains/households-and-identity/application/households.server";
import { contentReportEmail } from "~/lib/moderation.server";

const BASE = "https://spoonjoy.app";

// Each account email, rendered as it is sent. The .html snapshots open in a browser as the mail looks.
const EMAILS: Record<string, { content: AccountEmailContent; baseUrl: string }> = {
  "reset-password": {
    content: passwordResetEmail(`${BASE}/reset-password?token=Zq3_example-token-0123456789abcdefghijk`),
    baseUrl: BASE,
  },
  "household-invite": {
    content: householdInviteEmail({ inviter: "ann_cooks", household: "The Lee kitchen", viewer: false, link: `${BASE}/join/inv_example_0123456789`, days: 14 }),
    baseUrl: `${BASE}/join/inv_example_0123456789`,
  },
  "household-invite-viewer": {
    content: householdInviteEmail({ inviter: "ann_cooks", household: "The Lee kitchen", viewer: true, link: `${BASE}/join/inv_example_0123456789`, days: 14 }),
    baseUrl: `${BASE}/join/inv_example_0123456789`,
  },
  "content-report": {
    content: contentReportEmail({ reporter: "cal_bakes", target: "the recipe “Lemon Herb Rice”", reason: "Spam", details: "Links to a shop <b>everywhere</b>.", baseUrl: BASE }),
    baseUrl: BASE,
  },
};

describe("account email", () => {
  for (const [name, { content, baseUrl }] of Object.entries(EMAILS)) {
    it(`renders the ${name} mail's HTML and text parts`, async () => {
      const { html, text } = renderAccountEmail(content, baseUrl);
      await expect(html).toMatchFileSnapshot(`./__snapshots__/account-email/${name}.html`);
      await expect(text).toMatchFileSnapshot(`./__snapshots__/account-email/${name}.txt`);
    });
  }

  it("keeps the whole link in the text part and behind the button, and shows it short under the button", () => {
    const link = `${BASE}/reset-password?token=Zq3_example-token`;
    const { html, text } = renderAccountEmail(passwordResetEmail(link), BASE);
    expect(text).toContain(`Choose a new password: ${link}`);
    expect(html.match(new RegExp(`href="${link.replace(/[?.]/g, "\\$&")}"`, "g"))).toHaveLength(2);
    expect(html).toContain(">spoonjoy.app/reset-password…</a>");
  });

  it("shortens a link to its host and first path segment, so no token shows and nothing wraps mid-word", () => {
    expect(shortLink("https://spoonjoy.app/reset-password?token=abc")).toBe("spoonjoy.app/reset-password…");
    expect(shortLink("https://spoonjoy.app/join/uufKrnDJgarBH9ybTNXv4mF3CLjxw9EIxV674QyE3LE")).toBe("spoonjoy.app/join…");
    expect(shortLink("https://spoonjoy.app/moderation")).toBe("spoonjoy.app/moderation");
    expect(shortLink("https://spoonjoy.app/")).toBe("spoonjoy.app");
  });

  it("loads Fraunces and Source Serif from the sending site, keeping Georgia behind them, and sets the button in the serif", () => {
    const { html } = renderAccountEmail(EMAILS["reset-password"].content, "https://kitchen.example.com/x");
    expect(html).toContain(`src: url("https://kitchen.example.com/fonts/email/fraunces-400-900-latin.woff2")`);
    expect(html).toContain(`src: url("https://kitchen.example.com/fonts/email/source-serif-4-400-800-latin.woff2")`);
    expect(html).toMatch(/<a href="[^"]+" style="display:inline-block;padding:14px 26px;font-family:'Source Serif 4', Georgia, 'Times New Roman', serif;/);
  });

  it("serves the mail's fonts from public/, byte for byte the app's own", () => {
    for (const [file, source] of [["fraunces-400-900-latin.woff2", "fraunces-400-900-latin.woff2"], ["source-serif-4-400-800-latin.woff2", "source-serif-4-400-800-latin.woff2"]]) {
      expect(readFileSync(resolve("public/fonts/email", file)).equals(readFileSync(resolve("app/fonts", source)))).toBe(true);
    }
  });

  it("draws the button square unless the client can draw a squircle, and never round", () => {
    const { html } = renderAccountEmail(EMAILS["reset-password"].content, BASE);
    expect(html).toMatch(/@supports \(corner-shape: squircle\) \{\s*\.sj-button \{ border-radius: 14px; corner-shape: squircle; \}/);
    // The only radius is the one inside @supports.
    expect(html.match(/border-radius/g)).toHaveLength(1);
    expect(html).not.toContain("corner-shape: round");
  });

  it("switches to Spoonjoy's dark palette where the client honours dark mode", () => {
    const { html } = renderAccountEmail(EMAILS["reset-password"].content, BASE);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toMatch(/@media \(prefers-color-scheme: dark\) \{[^}]*\.sj-page \{ background-color: #1e1c19 !important; \}/);
  });

  it("escapes what a person typed", () => {
    const { html } = renderAccountEmail(EMAILS["content-report"].content, BASE);
    expect(html).toContain("They wrote: Links to a shop &lt;b&gt;everywhere&lt;/b&gt;.");
    expect(html).not.toContain("<b>everywhere</b>");
  });

  it("shows the mark from the sending site, with a button only when there is a link", () => {
    const { html } = renderAccountEmail({ preview: "p", heading: "Hello", body: ["Hi."] }, "https://kitchen.example.com/some/path");
    expect(html).toContain('src="https://kitchen.example.com/images/email/spoonjoy-mark.png"');
    expect(html).not.toContain("sj-button\" bgcolor");
    expect(renderAccountEmail({ preview: "p", heading: "Hello", body: ["Hi."] }, BASE).text).toBe("Hello\n\nHi.\n\nSpoonjoy");
  });
});
