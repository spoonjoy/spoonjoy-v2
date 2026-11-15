// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { accountActivityRows, accountActivitySql, formatAccountActivity, main } from "../../scripts/account-activity";

const ROW = {
  id: "cm_test_user",
  username: "test_chef",
  createdAt: "2026-10-01T00:00:00.000Z",
  lastSignInAt: "2026-11-15T09:00:00.000Z",
  lastSignInMethod: "apple",
  lastSeenAt: "2026-11-15T10:00:00.000Z",
};

describe("scripts/account-activity", () => {
  it("selects one account by username or id, or the recent sign-ins, and never the email", () => {
    expect(accountActivitySql("test_chef")).toContain(`WHERE "username" = 'test_chef' OR "id" = 'test_chef'`);
    expect(accountActivitySql("--recent")).toContain(`ORDER BY "lastSignInAt" DESC LIMIT 20`);
    expect(accountActivitySql("test_chef")).not.toContain("email");
    expect(() => accountActivitySql("x' OR 1=1 --")).toThrow(/username or user id/);
  });

  it("parses Wrangler's JSON and refuses anything else", () => {
    expect(accountActivityRows(JSON.stringify([{ results: [ROW, { id: "u2", username: "new_chef", createdAt: null }] }]))).toEqual([
      ROW,
      { id: "u2", username: "new_chef", createdAt: null, lastSignInAt: null, lastSignInMethod: null, lastSeenAt: null },
    ]);
    expect(() => accountActivityRows("not json")).toThrow(/not valid JSON/);
    expect(() => accountActivityRows(JSON.stringify({}))).toThrow(/no results/);
  });

  it("formats an account, an account that never signed in again, and no match", () => {
    expect(formatAccountActivity([ROW])[0]).toContain("last sign-in  2026-11-15T09:00:00.000Z via apple");
    const quiet = formatAccountActivity([{ ...ROW, createdAt: null, lastSignInAt: null, lastSeenAt: null }])[0];
    expect(quiet).toContain("last sign-in  none recorded");
    expect(quiet).toContain("last seen     none recorded");
    expect(quiet).toContain("created       unknown");
    expect(formatAccountActivity([{ ...ROW, lastSignInMethod: null }])[0]).toContain("via unknown");
    expect(formatAccountActivity([])).toEqual(["No matching account."]);
  });

  it("runs a remote read with the D1 token when set, else Wrangler's login", async () => {
    const run = vi.fn(async () => JSON.stringify([{ results: [ROW] }]));
    const log = vi.fn();

    await expect(main(["test_chef"], { env: { CLOUDFLARE_D1_API_TOKEN: "d1", CLOUDFLARE_ACCOUNT_ID: "acct" }, run, log })).resolves.toEqual([ROW]);
    expect(run.mock.calls[0][0]).toEqual(expect.arrayContaining(["d1", "execute", "DB", "--remote", "--json"]));
    expect(run.mock.calls[0][1].env.CLOUDFLARE_API_TOKEN).toBe("d1");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("test_chef (cm_test_user)"));

    await main(["--recent"], { env: { HOME: "/home/test" }, run, log });
    expect(run.mock.calls[1][1].env).toEqual({ HOME: "/home/test" });

    await expect(main([], { env: {}, run, log })).rejects.toThrow(/Usage/);
  });
});
