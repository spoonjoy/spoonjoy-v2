import { describe, expect, it } from "vitest";

import {
  buildQaSeedTeardownSql,
  buildQaSeedSql,
  createQaSeedRun,
  parseSeedQaArgs,
  wranglerQaSeedArgs,
} from "../../scripts/seed-qa.mjs";

describe("seed-qa", () => {
  const legacyQaNamespace = "sj-qa-" + "demo";
  const legacyDemoEmail = "demo@" + "spoonjoy.com";
  const legacyDemoPassword = "demo" + "1234";

  it("builds disposable per-run QA seed SQL without reusable credentials", () => {
    const seedRun = createQaSeedRun({ now: () => new Date("2026-07-15T12:00:00Z"), random: () => "abc123" });
    const sql = buildQaSeedSql(seedRun);

    expect(seedRun.user.email).toBe("codex-qa-seed-20260715t120000z-abc123@example.com");
    expect(seedRun.user.username).toBe("codex_qa_seed_20260715t120000z_abc123");
    expect(seedRun.recipe.title).toBe("codex QA seed lemon rice 20260715t120000z abc123");
    expect(sql).toContain(seedRun.user.email);
    expect(sql).toContain(seedRun.recipe.title);
    expect(sql).toContain("INSERT INTO \"User\"");
    expect(sql).toContain("INSERT INTO Recipe");
    expect(sql).toContain("INSERT INTO RecipeStep");
    expect(sql).toContain("INSERT INTO Ingredient");
    expect(sql).not.toContain("hashedPassword");
    expect(sql).not.toContain("salt");
    expect(sql).not.toContain(legacyQaNamespace);
    expect(sql).not.toContain(legacyDemoEmail);
    expect(sql).not.toContain(legacyDemoPassword);
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain("DELETE FROM");
  });

  it("builds exact teardown SQL for the generated QA seed run", () => {
    const seedRun = createQaSeedRun({ now: () => new Date("2026-07-15T12:00:00Z"), random: () => "abc123" });
    const sql = buildQaSeedTeardownSql(seedRun);

    expect(sql).toContain(seedRun.user.id);
    expect(sql).toContain(seedRun.recipe.id);
    expect(sql).toContain("DELETE FROM Ingredient");
    expect(sql).toContain("DELETE FROM RecipeStep");
    expect(sql).toContain("DELETE FROM Recipe");
    expect(sql).toContain("DELETE FROM \"User\"");
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain(legacyDemoEmail);
  });

  it("builds remote D1 args only for the QA Wrangler environment", () => {
    expect(wranglerQaSeedArgs("SELECT 1;")).toEqual([
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--remote",
      "--env",
      "qa",
      "--command",
      "SELECT 1;",
    ]);
  });

  it("parses the explicit QA target env", () => {
    expect(parseSeedQaArgs(["--target-env", "qa"])).toEqual({ targetEnv: "qa", dryRun: false, skipTeardown: false });
    expect(parseSeedQaArgs(["--target-env", "qa", "--dry-run"])).toEqual({
      targetEnv: "qa",
      dryRun: true,
      skipTeardown: false,
    });
    expect(parseSeedQaArgs(["--target-env", "qa", "--skip-teardown"])).toEqual({
      targetEnv: "qa",
      dryRun: false,
      skipTeardown: true,
    });
  });

  it("refuses production and missing target envs", () => {
    expect(() => parseSeedQaArgs([])).toThrow(/--target-env qa/);
    expect(() => parseSeedQaArgs(["--target-env", "production"])).toThrow(/refuses/);
  });
});
