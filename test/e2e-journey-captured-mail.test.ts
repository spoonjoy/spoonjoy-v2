import { describe, expect, it } from "vitest";
import {
  capturedMailQuery,
  resetLinkPath,
  mailFromD1Output,
  waitForCapturedMail,
} from "../e2e/journeys/support/captured-mail";

const ADDRESS = "codex-e2e-s-ab12cd-14d@example.com";
const RESET_MAIL = [
  "Someone asked to reset the password for your Spoonjoy account. If it was you, choose a new password here:",
  "https://spoonjoy-v2-qa-run-1-1.mendelow-studio.workers.dev/reset-password?token=AbC_d-123",
  "The link works once, for the next 30 minutes.",
].join("\n\n");

function d1Output(rows: Array<{ textBody: string; htmlBody?: string | null }>): string {
  return `${JSON.stringify([{ results: rows, success: true, meta: {} }])}\n`;
}

describe("captured mail", () => {
  it("reads only an example.com address", () => {
    expect(capturedMailQuery(ADDRESS, "reset_password")).toBe(
      `SELECT "textBody", "htmlBody" FROM "EmailOutbox" WHERE "toAddress" = '${ADDRESS}' AND "purpose" = 'reset_password' ORDER BY "createdAt" DESC LIMIT 1`,
    );
    expect(capturedMailQuery("cook-abc123@example.com", "household_invite")).toContain(`"toAddress" = 'cook-abc123@example.com' AND "purpose" = 'household_invite'`);
    expect(() => capturedMailQuery("someone@gmail.com", "reset_password")).toThrow(/example\.com/);
    expect(() => capturedMailQuery("codex-e2e-x'; DROP TABLE User;--@example.com", "reset_password")).toThrow(/example\.com/);
  });

  it("answers the mail from wrangler's JSON, after any lines before it, or null for no row", () => {
    expect(mailFromD1Output(`warning line\n${d1Output([{ textBody: RESET_MAIL, htmlBody: "<p>hi</p>" }])}`)).toEqual({ text: RESET_MAIL, html: "<p>hi</p>" });
    expect(mailFromD1Output(d1Output([{ textBody: RESET_MAIL, htmlBody: null }]))).toEqual({ text: RESET_MAIL, html: null });
    expect(mailFromD1Output(d1Output([]))).toBeNull();
    expect(() => mailFromD1Output("no json here")).toThrow(/no JSON/);
  });

  it("takes the reset link's path and query from the mail", () => {
    expect(resetLinkPath(RESET_MAIL)).toBe("/reset-password?token=AbC_d-123");
    expect(() => resetLinkPath("no link")).toThrow(/no reset link/);
  });

  it("reads again until the mail is captured, and gives up after the last read", async () => {
    const outputs = [d1Output([]), d1Output([]), d1Output([{ textBody: RESET_MAIL }])];
    const sql: string[] = [];
    const mail = await waitForCapturedMail(ADDRESS, "reset_password", {
      delayMs: 0,
      query: async (statement) => {
        sql.push(statement);
        return outputs.shift()!;
      },
    });
    expect(mail).toEqual({ text: RESET_MAIL, html: null });
    expect(sql).toHaveLength(3);

    await expect(
      waitForCapturedMail(ADDRESS, "reset_password", { attempts: 2, delayMs: 0, query: async () => d1Output([]) }),
    ).rejects.toThrow("No reset_password mail was captured for the address after 2 reads.");
  });

  it("needs the Cloudflare credentials to read the run's database", async () => {
    const saved = process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_API_TOKEN;
    try {
      await expect(waitForCapturedMail(ADDRESS, "reset_password", { attempts: 1 })).rejects.toThrow(/CLOUDFLARE_API_TOKEN/);
    } finally {
      if (saved !== undefined) process.env.CLOUDFLARE_API_TOKEN = saved;
    }
  });
});
