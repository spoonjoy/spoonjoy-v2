import { describe, expect, it, vi } from "vitest";

import {
  buildQaSeedTeardownSql,
  buildQaSeedSql,
  createQaSeedRun,
  main,
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

  it("tears down the exact run after a successful seed", () => {
    const execFile = vi.fn();

    main(["--target-env", "qa"], execFile, { log: vi.fn() });

    expect(execFile).toHaveBeenCalledTimes(2);
    expect(execFile.mock.calls[0]?.[0]).toBe("pnpm");
    expect(execFile.mock.calls[0]?.[1]).toContain("--remote");
    expect(execFile.mock.calls[0]?.[1].at(-1)).toContain("INSERT INTO \"User\"");
    expect(execFile.mock.calls[1]?.[0]).toBe("pnpm");
    expect(execFile.mock.calls[1]?.[1]).toContain("--remote");
    expect(execFile.mock.calls[1]?.[1].at(-1)).toContain("DELETE FROM \"User\"");
  });

  it("still tears down when seeding fails after partially writing rows", () => {
    const seedFailure = new Error("seed failed");
    const execFile = vi.fn()
      .mockImplementationOnce(() => {
        throw seedFailure;
      })
      .mockImplementationOnce(() => undefined);

    expect(() => main(["--target-env", "qa"], execFile, { log: vi.fn() })).toThrow(seedFailure);
    expect(execFile).toHaveBeenCalledTimes(2);
    expect(execFile.mock.calls[1]?.[1].at(-1)).toContain("DELETE FROM \"User\"");
  });

  it("propagates teardown failures after a successful seed", () => {
    const teardownFailure = new Error("teardown failed");
    const execFile = vi.fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw teardownFailure;
      });

    expect(() => main(["--target-env", "qa"], execFile, { log: vi.fn() })).toThrow(teardownFailure);
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it("reports both failures when seeding and teardown fail", () => {
    const seedFailure = new Error("seed failed");
    const teardownFailure = new Error("teardown failed");
    const execFile = vi.fn()
      .mockImplementationOnce(() => {
        throw seedFailure;
      })
      .mockImplementationOnce(() => {
        throw teardownFailure;
      });
    let thrown: unknown;

    try {
      main(["--target-env", "qa"], execFile, { log: vi.fn() });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([seedFailure, teardownFailure]);
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it("honors explicit teardown retention even when seeding fails", () => {
    const seedFailure = new Error("seed failed");
    const execFile = vi.fn(() => {
      throw seedFailure;
    });

    expect(() => main(["--target-env", "qa", "--skip-teardown"], execFile, { log: vi.fn() })).toThrow(seedFailure);
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("prints both statements without executing during a dry run", () => {
    const execFile = vi.fn();
    const log = vi.fn();

    main(["--target-env", "qa", "--dry-run"], execFile, { log });

    expect(execFile).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toContain("INSERT INTO \"User\"");
    expect(log.mock.calls[0]?.[0]).toContain("DELETE FROM \"User\"");
  });
});
