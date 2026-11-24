import { describe, expect, it } from "vitest";
import {
  capturedMailQuery,
  resetLinkPath,
  textBodyFromD1Output,
  waitForCapturedMail,
} from "../e2e/journeys/support/captured-mail";

const ADDRESS = "codex-e2e-s-ab12cd-14d@example.com";
const RESET_MAIL = [
  "Someone asked to reset the password for your Spoonjoy account. If it was you, choose a new password here:",
  "https://spoonjoy-v2-qa-run-1-1.mendelow-studio.workers.dev/reset-password?token=AbC_d-123",
  "The link works once, for the next 30 minutes.",
].join("\n\n");

function d1Output(rows: Array<{ textBody: string }>): string {
  return `${JSON.stringify([{ results: rows, success: true, meta: {} }])}\n`;
}

describe("captured mail", () => {
  it("reads only a run's throwaway address", () => {
    expect(capturedMailQuery(ADDRESS, "reset_password")).toBe(
      `SELECT "textBody" FROM "EmailOutbox" WHERE "toAddress" = '${ADDRESS}' AND "purpose" = 'reset_password' ORDER BY "createdAt" DESC LIMIT 1`,
    );
    expect(() => capturedMailQuery("qa-kitchen-chef@example.com", "reset_password")).toThrow(/throwaway/);
    expect(() => capturedMailQuery("codex-e2e-x'; DROP TABLE User;--@example.com", "reset_password")).toThrow(/throwaway/);
  });

  it("answers the text body from wrangler's JSON, after any lines before it, or null for no row", () => {
    expect(textBodyFromD1Output(`warning line\n${d1Output([{ textBody: RESET_MAIL }])}`)).toBe(RESET_MAIL);
    expect(textBodyFromD1Output(d1Output([]))).toBeNull();
    expect(() => textBodyFromD1Output("no json here")).toThrow(/no JSON/);
  });

  it("takes the reset link's path and query from the mail", () => {
    expect(resetLinkPath(RESET_MAIL)).toBe("/reset-password?token=AbC_d-123");
    expect(() => resetLinkPath("no link")).toThrow(/no reset link/);
  });

  it("reads again until the mail is captured, and gives up after the last read", async () => {
    const outputs = [d1Output([]), d1Output([]), d1Output([{ textBody: RESET_MAIL }])];
    const sql: string[] = [];
    const body = await waitForCapturedMail(ADDRESS, "reset_password", {
      delayMs: 0,
      query: async (statement) => {
        sql.push(statement);
        return outputs.shift()!;
      },
    });
    expect(body).toBe(RESET_MAIL);
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
