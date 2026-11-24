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

const execFileAsync = promisify(execFile);

export type CapturedMailPurpose = "reset_password";

// Only the run's own throwaway addresses (scripts/seed-qa-kitchen.mjs's scratch accounts and
// createDisposableJourneyUser's) are read, and the address goes into SQL, so anything else is refused.
const THROWAWAY_ADDRESS = /^codex-e2e-[a-z0-9-]+@example\.com$/;

/** The SQL for the newest captured message of this purpose to this throwaway address. */
export function capturedMailQuery(to: string, purpose: CapturedMailPurpose): string {
  if (!THROWAWAY_ADDRESS.test(to)) {
    throw new Error("Captured mail is read only for a run's codex-e2e-*@example.com throwaway address.");
  }
  return `SELECT "textBody" FROM "EmailOutbox" WHERE "toAddress" = '${to}' AND "purpose" = '${purpose}' ORDER BY "createdAt" DESC LIMIT 1`;
}

/** The text body from `wrangler d1 execute --json` output, or null when the query matched no row. */
export function textBodyFromD1Output(stdout: string): string | null {
  const start = stdout.indexOf("[");
  if (start < 0) throw new Error("wrangler d1 execute printed no JSON.");
  const statements = JSON.parse(stdout.slice(start)) as Array<{ results?: Array<{ textBody?: unknown }> }>;
  const body = statements[0]?.results?.[0]?.textBody;
  return typeof body === "string" ? body : null;
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
 * text. The Worker writes it after answering the form (waitUntil), so the first read can be early.
 */
export async function waitForCapturedMail(
  to: string,
  purpose: CapturedMailPurpose,
  { attempts = 8, delayMs = 2_000, query = queryRunDatabase }: WaitOptions = {},
): Promise<string> {
  const sql = capturedMailQuery(to, purpose);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const body = textBodyFromD1Output(await query(sql));
    if (body !== null) return body;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`No ${purpose} mail was captured for the address after ${attempts} reads.`);
}
