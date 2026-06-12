import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import * as cleanup from "../../scripts/cleanup-local-qa-data.mjs";

const { buildApplySql, buildDryRunSql, wranglerLocalD1Args } = cleanup;

function writableBuffer() {
  let text = "";
  return {
    stream: {
      write(chunk: string) {
        text += String(chunk);
      },
    },
    text: () => text,
  };
}

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

  it("parses explicit local, QA, and production target environments", () => {
    expect(cleanup.parseCleanupArgs(["--target-env", "local"])).toMatchObject({
      apply: false,
      dbName: "DB",
      target: {
        targetEnv: "local",
        baseUrl: "http://localhost:5173",
        d1Target: "local D1 (--local)",
        r2Target: "local photos binding",
        destructiveScope: "local disposable test data only",
      },
    });
    expect(cleanup.parseCleanupArgs(["--target-env", "qa", "--db", "QA_DB"])).toMatchObject({
      dbName: "QA_DB",
      target: {
        targetEnv: "qa",
        baseUrl: "https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
        d1Target: "QA D1 spoonjoy-qa (--remote --env qa)",
        r2Target: "QA R2 spoonjoy-photos-qa (--remote)",
        destructiveScope: "QA disposable test data only",
      },
    });
    expect(cleanup.parseCleanupArgs(["--target-env", "production"])).toMatchObject({
      target: {
        targetEnv: "production",
        baseUrl: "https://spoonjoy.app",
        d1Target: "production D1 spoonjoy (--remote)",
        r2Target: "production R2 spoonjoy-photos (--remote)",
        destructiveScope: "production read-only by default; exact smoke cleanup only",
      },
    });
  });

  it("keeps the backwards-compatible missing-target default as a local dry-run", () => {
    expect(cleanup.parseCleanupArgs([])).toMatchObject({
      apply: false,
      target: {
        targetEnv: "local",
        baseUrl: "http://localhost:5173",
      },
    });
  });

  it("rejects missing and invalid target env values", () => {
    expect(() => cleanup.parseCleanupArgs(["--target-env"])).toThrow(/Missing value for --target-env/);
    expect(() => cleanup.parseCleanupArgs(["--target-env", "staging"])).toThrow(/local, qa, or production/);
  });

  it("formats the target summary printed before cleanup commands", () => {
    const options = cleanup.parseCleanupArgs(["--target-env", "qa"]);

    expect(cleanup.formatCleanupTargetSummary(options.target)).toEqual([
      "Target environment: qa",
      "Base URL: https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
      "D1 target: QA D1 spoonjoy-qa (--remote --env qa)",
      "R2 target: QA R2 spoonjoy-photos-qa (--remote)",
      "Destructive scope: QA disposable test data only",
    ]);
  });

  it("runs local dry-run and local apply with explicit target summaries and local Wrangler args", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async () => ({ stdout: "[]", stderr: "" }));

    await cleanup.runCleanupCli({
      argv: ["--target-env", "local"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(stdout.text()).toContain("Target environment: local");
    expect(stdout.text()).toContain("Dry run only. Pass --apply to mutate local D1.");
    expect(runCommand).toHaveBeenLastCalledWith(
      "pnpm",
      ["exec", "wrangler", "d1", "execute", "DB", "--local", "--command", buildDryRunSql()],
      expect.objectContaining({ encoding: "utf8" }),
    );

    await cleanup.runCleanupCli({
      argv: ["--target-env", "local", "--apply"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(stdout.text()).toContain("Applied local QA cleanup.");
    expect(runCommand).toHaveBeenLastCalledWith(
      "pnpm",
      ["exec", "wrangler", "d1", "execute", "DB", "--local", "--command", buildApplySql()],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it("runs QA remote dry-run but refuses QA apply until D1/R2 safety is installed", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async () => ({ stdout: "[]", stderr: "" }));

    await cleanup.runCleanupCli({
      argv: ["--target-env", "qa"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(stdout.text()).toContain("Target environment: qa");
    expect(runCommand).toHaveBeenLastCalledWith(
      "pnpm",
      ["exec", "wrangler", "d1", "execute", "DB", "--remote", "--env", "qa", "--command", buildDryRunSql()],
      expect.objectContaining({ encoding: "utf8" }),
    );

    await expect(
      cleanup.runCleanupCli({
        argv: ["--target-env", "qa", "--apply"],
        runCommand,
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).rejects.toThrow(/remote QA apply not enabled until D1\/R2 safety checks are installed/);
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("runs production read-only dry-run and refuses broad production apply", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async () => ({ stdout: "[]", stderr: "" }));

    await cleanup.runCleanupCli({
      argv: ["--target-env", "production"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(stdout.text()).toContain("Target environment: production");
    expect(stdout.text()).toContain("Production cleanup is read-only for broad disposable sweeps.");
    expect(runCommand).toHaveBeenLastCalledWith(
      "pnpm",
      ["exec", "wrangler", "d1", "execute", "DB", "--remote", "--command", buildDryRunSql()],
      expect.objectContaining({ encoding: "utf8" }),
    );

    await expect(
      cleanup.runCleanupCli({
        argv: ["--target-env", "production", "--apply"],
        runCommand,
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).rejects.toThrow(/Refusing broad production cleanup/);
    expect(runCommand).toHaveBeenCalledTimes(1);
  });
});
