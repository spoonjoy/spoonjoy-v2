// Reads account mail that a Journeys run's QA Worker captured instead of sending.
//
// QA sends no mail: SPOONJOY_EMAIL_MODE=capture (wrangler.json's env.qa) writes each message to the
// EmailOutbox table of the run's own D1 (app/lib/transactional-email.server.ts). A journey that
// needs a mailed link reads it from there with `wrangler d1 execute --env qa`, which the workflow's
// "Create this run's QA stack" step has already pointed at this run's database. The Run test suite
// step gives the suite CLOUDFLARE_API_TOKEN for this, and nothing else in the suite uses it.
//
// The link is a working credential until it is used, so never log, attach or assert on it in a
// message: open it, use it, and it is dead.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Page, TestInfo } from "@playwright/test";

const execFileAsync = promisify(execFile);

export type CapturedMailPurpose = "reset_password" | "household_invite";

export interface CapturedMail {
  text: string;
  /** The HTML part; null for mail captured before QA kept it (migration 0055). */
  html: string | null;
}

// Only addresses at example.com, which no one receives mail for, are read: the run's throwaway
// accounts and the addresses journeys invite. The address goes into SQL, so anything else is refused.
const THROWAWAY_ADDRESS = /^[a-z0-9._+-]+@example\.com$/;

/** The SQL for the newest captured message of this purpose to this example.com address. */
export function capturedMailQuery(to: string, purpose: CapturedMailPurpose): string {
  if (!THROWAWAY_ADDRESS.test(to)) {
    throw new Error("Captured mail is read only for an @example.com address.");
  }
  return `SELECT "textBody", "htmlBody" FROM "EmailOutbox" WHERE "toAddress" = '${to}' AND "purpose" = '${purpose}' ORDER BY "createdAt" DESC LIMIT 1`;
}

/** The mail from `wrangler d1 execute --json` output, or null when the query matched no row. */
export function mailFromD1Output(stdout: string): CapturedMail | null {
  const start = stdout.indexOf("[");
  if (start < 0) throw new Error("wrangler d1 execute printed no JSON.");
  const statements = JSON.parse(stdout.slice(start)) as Array<{ results?: Array<{ textBody?: unknown; htmlBody?: unknown }> }>;
  const row = statements[0]?.results?.[0];
  if (typeof row?.textBody !== "string") return null;
  return { text: row.textBody, html: typeof row.htmlBody === "string" ? row.htmlBody : null };
}

/** The path and query of the reset link in a reset mail, so the journey opens it on its own origin. */
export function resetLinkPath(text: string): string {
  const match = text.match(/https:\/\/[^\s/]+(\/reset-password\?token=[A-Za-z0-9_-]+)/);
  if (!match) throw new Error("The captured reset mail has no reset link.");
  return match[1];
}

interface WaitOptions {
  attempts?: number;
  delayMs?: number;
  query?: (sql: string) => Promise<string>;
}

async function queryRunDatabase(sql: string): Promise<string> {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error("Reading captured mail needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (the Journeys workflow's Run test suite step).");
  }
  const { stdout } = await execFileAsync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "DB", "--remote", "--env", "qa", "--json", "--command", sql],
    { maxBuffer: 1024 * 1024 },
  );
  return stdout;
}

/**
 * Waits for the run's Worker to capture a message of this purpose to this address and answers its
 * text and HTML. The Worker writes it after answering the form (waitUntil), so the first read can be early.
 */
export async function waitForCapturedMail(
  to: string,
  purpose: CapturedMailPurpose,
  { attempts = 8, delayMs = 2_000, query = queryRunDatabase }: WaitOptions = {},
): Promise<CapturedMail> {
  const sql = capturedMailQuery(to, purpose);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const mail = mailFromD1Output(await query(sql));
    if (mail !== null) return mail;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`No ${purpose} mail was captured for the address after ${attempts} reads.`);
}

/**
 * Attaches the mail's HTML part as a person sees it, in light and in dark mode, opened in a page of
 * its own beside the journey's. A mail with no HTML part fails the journey.
 */
export async function attachCapturedMail(testInfo: TestInfo, page: Page, mail: CapturedMail, name: string): Promise<void> {
  if (mail.html === null) throw new Error(`The captured ${name} mail has no HTML part.`);
  const mailPage = await page.context().newPage();
  try {
    await mailPage.setViewportSize({ width: 600, height: 720 });
    for (const colorScheme of ["light", "dark"] as const) {
      await mailPage.emulateMedia({ colorScheme });
      await mailPage.setContent(mail.html, { waitUntil: "load" });
      // The button's corners: a squircle where the browser draws one (Chromium), else square, never round.
      // Loaded here, not at the top: the unit tests import this file, and loading @playwright/test in
      // Vitest opens a connection to localhost:3000 that nothing answers, which crashes the worker.
      const { expect } = await import("@playwright/test");
      const corners = await mailPage.locator(".sj-button").evaluate((cell) => {
        const style = getComputedStyle(cell);
        return { squircle: CSS.supports("corner-shape", "squircle"), shape: style.getPropertyValue("corner-shape"), radius: style.borderTopLeftRadius };
      });
      // Chromium draws corner-shape, so on the desktop-chrome project the squircle must be there.
      if (testInfo.project.name === "desktop-chrome") expect(corners.squircle).toBe(true);
      if (corners.squircle) {
        // The squircle keyword computes to superellipse(2).
        expect(corners.shape).toMatch(/^(squircle|superellipse\(2\))$/);
        expect(corners.radius).toBe("14px");
      } else {
        expect(corners.radius).toBe("0px");
      }
      await testInfo.attach(`${name}-mail-${colorScheme}`, { body: await mailPage.screenshot({ fullPage: true }), contentType: "image/png" });
    }
  } finally {
    await mailPage.close();
  }
}
