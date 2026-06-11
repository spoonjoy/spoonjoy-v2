import { describe, expect, it } from "vitest";

import {
  QA_SEED_EMAIL,
  QA_SEED_RECIPE_TITLE,
  buildQaSeedSql,
  parseSeedQaArgs,
  wranglerQaSeedArgs,
} from "../../scripts/seed-qa.mjs";

describe("seed-qa", () => {
  it("builds idempotent disposable demo seed SQL", () => {
    const sql = buildQaSeedSql();

    expect(sql).toContain(QA_SEED_EMAIL);
    expect(sql).toContain(QA_SEED_RECIPE_TITLE);
    expect(sql).toContain("INSERT OR IGNORE INTO \"User\"");
    expect(sql).toContain("INSERT OR IGNORE INTO Recipe");
    expect(sql).toContain("INSERT OR IGNORE INTO RecipeStep");
    expect(sql).toContain("INSERT OR IGNORE INTO Ingredient");
    expect(sql).toContain("sj-qa-demo");
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain("DELETE FROM");
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
    expect(parseSeedQaArgs(["--target-env", "qa"])).toEqual({ targetEnv: "qa", dryRun: false });
    expect(parseSeedQaArgs(["--target-env", "qa", "--dry-run"])).toEqual({ targetEnv: "qa", dryRun: true });
  });

  it("refuses production and missing target envs", () => {
    expect(() => parseSeedQaArgs([])).toThrow(/--target-env qa/);
    expect(() => parseSeedQaArgs(["--target-env", "production"])).toThrow(/refuses/);
  });
});
