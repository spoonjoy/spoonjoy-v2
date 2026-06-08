import { describe, expect, it } from "vitest";

import {
  buildApplySql,
  buildDryRunSql,
  wranglerLocalD1Args,
} from "../../scripts/cleanup-local-qa-data.mjs";

describe("cleanup-local-qa-data", () => {
  it("dry-runs the disposable Spoonjoy QA data patterns", () => {
    const sql = buildDryRunSql();

    expect(sql).toContain("lower(title) LIKE 'e2e %'");
    expect(sql).toContain("lower(title) LIKE 'mobile dock save%'");
    expect(sql).toContain("lower(title) LIKE 'codex %'");
    expect(sql).toContain("email LIKE 'codex-%'");
    expect(sql).toContain("email LIKE 'e2e-passkey-%'");
    expect(sql).toContain("clientName = 'E2E OAuth Client'");
  });

  it("soft-deletes recipes and deletes only disposable local support rows on apply", () => {
    const sql = buildApplySql();

    expect(sql).toContain("UPDATE Recipe");
    expect(sql).toContain("SET deletedAt = CURRENT_TIMESTAMP");
    expect(sql).toContain("DELETE FROM OAuthAuthCode");
    expect(sql).toContain("DELETE FROM OAuthClient");
    expect(sql).toContain("DELETE FROM UserCredential");
    expect(sql).toContain("DELETE FROM User");
    expect(sql).not.toContain("DROP TABLE");
  });

  it("builds local-only Wrangler D1 args", () => {
    const args = wranglerLocalD1Args("DB", "SELECT 1;");

    expect(args).toEqual([
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--local",
      "--command",
      "SELECT 1;",
    ]);
    expect(args).not.toContain("--remote");
  });
});
