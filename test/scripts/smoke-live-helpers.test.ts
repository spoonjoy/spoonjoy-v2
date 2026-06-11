import { describe, expect, it } from "vitest";

import {
  buildCleanupD1Args,
  buildUserCountD1Args,
  parseSmokeArgs,
  shouldRunAppleOAuthCheck,
  usesLocalD1,
} from "../../scripts/smoke-live-helpers.mjs";

describe("smoke-live helpers", () => {
  it("detects local D1 targets from localhost base URLs", () => {
    expect(usesLocalD1("http://localhost:5173")).toBe(true);
    expect(usesLocalD1("http://127.0.0.1:5173")).toBe(true);
    expect(usesLocalD1("https://spoonjoy-v2-qa.mendelow-studio.workers.dev")).toBe(false);
  });

  it("builds local cleanup args for local smoke targets", () => {
    const args = buildCleanupD1Args("codex-smoke-local@example.com", { targetEnv: "local" });

    expect(args).toEqual([
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--local",
      "--command",
      `DELETE FROM "User" WHERE email = 'codex-smoke-local@example.com';`,
    ]);
  });

  it("builds QA cleanup args with --env qa", () => {
    const args = buildCleanupD1Args("codex-smoke-qa@example.com", { targetEnv: "qa" });

    expect(args).toEqual([
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--remote",
      "--env",
      "qa",
      "--command",
      `DELETE FROM "User" WHERE email = 'codex-smoke-qa@example.com';`,
    ]);
  });

  it("builds explicit production cleanup args without --env qa", () => {
    const args = buildCleanupD1Args("codex-smoke-prod@example.com", { targetEnv: "production" });

    expect(args).toContain("--remote");
    expect(args).not.toContain("--env");
    expect(args).not.toContain("qa");
  });

  it("builds QA user-count verification args with --env qa", () => {
    expect(buildUserCountD1Args("codex-smoke-qa@example.com", { targetEnv: "qa" })).toEqual([
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--remote",
      "--env",
      "qa",
      "--command",
      `SELECT COUNT(*) AS count FROM "User" WHERE email = 'codex-smoke-qa@example.com';`,
    ]);
  });

  it("only runs the production Apple OAuth guard for production smoke", () => {
    expect(shouldRunAppleOAuthCheck("production")).toBe(true);
    expect(shouldRunAppleOAuthCheck("qa")).toBe(false);
    expect(shouldRunAppleOAuthCheck("local")).toBe(false);
  });

  it("requires explicit target env for remote smoke URLs", () => {
    expect(() =>
      parseSmokeArgs(["--base-url", "https://spoonjoy-v2-qa.mendelow-studio.workers.dev"]),
    ).toThrow(/--target-env/);
  });

  it("allows local smoke URLs to infer local target env", () => {
    expect(parseSmokeArgs(["--base-url", "http://localhost:5173"])).toMatchObject({
      baseUrl: "http://localhost:5173",
      targetEnv: "local",
      shouldCleanup: true,
    });
  });

  it("parses explicit QA smoke args", () => {
    expect(
      parseSmokeArgs([
        "--target-env",
        "qa",
        "--base-url",
        "https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
        "--out",
        "qa-live-smoke-artifacts",
        "--keep-smoke-data",
      ]),
    ).toMatchObject({
      targetEnv: "qa",
      baseUrl: "https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
      outDir: "qa-live-smoke-artifacts",
      shouldCleanup: false,
    });
  });

  it("refuses mismatched QA target env and production URL", () => {
    expect(() =>
      parseSmokeArgs(["--target-env", "qa", "--base-url", "https://spoonjoy-v2.mendelow-studio.workers.dev"]),
    ).toThrow(/QA smoke/);
  });
});
