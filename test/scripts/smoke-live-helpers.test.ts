import { describe, expect, it } from "vitest";

import * as smokeHelpers from "../../scripts/smoke-live-helpers.mjs";
import {
  buildQaR2DeleteArgs,
  buildQaR2GetArgs,
  buildCleanupD1Args,
  buildUserCountD1Args,
  isQaR2ObjectMissingError,
  parseD1CountOutput,
  parseSmokeArgs,
  readGitMetadata,
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

  it("uses process argv defaults when no args are provided", () => {
    const originalArgv = process.argv;
    const originalBaseUrl = process.env.SPOONJOY_SMOKE_BASE_URL;
    try {
      process.argv = ["node", "scripts/smoke-live.mjs"];
      delete process.env.SPOONJOY_SMOKE_BASE_URL;
      expect(() => parseSmokeArgs()).toThrow(/--target-env/);
    } finally {
      process.argv = originalArgv;
      if (originalBaseUrl === undefined) {
        delete process.env.SPOONJOY_SMOKE_BASE_URL;
      } else {
        process.env.SPOONJOY_SMOKE_BASE_URL = originalBaseUrl;
      }
    }
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

  it("parses the QA-only image-cover smoke flag", () => {
    expect(
      parseSmokeArgs([
        "--target-env",
        "qa",
        "--base-url",
        "https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
        "--include-image-cover-smoke",
      ]),
    ).toMatchObject({
      targetEnv: "qa",
      includeImageCoverSmoke: true,
    });
  });

  it("refuses image-cover smoke outside QA", () => {
    expect(() =>
      parseSmokeArgs([
        "--target-env",
        "production",
        "--base-url",
        "https://spoonjoy-v2.mendelow-studio.workers.dev",
        "--include-image-cover-smoke",
      ]),
    ).toThrow(/image-cover smoke.*QA/i);
    expect(() =>
      parseSmokeArgs([
        "--base-url",
        "http://localhost:5173",
        "--include-image-cover-smoke",
      ]),
    ).toThrow(/image-cover smoke.*QA/i);
  });

  it("builds QA R2 object get and delete args", () => {
    expect(buildQaR2GetArgs("recipes/user-1/uploads/photo.jpg")).toEqual([
      "exec",
      "wrangler",
      "r2",
      "object",
      "get",
      "spoonjoy-photos-qa/recipes/user-1/uploads/photo.jpg",
      "--remote",
      "--pipe",
    ]);
    expect(buildQaR2DeleteArgs("spoons/user-1/uploads/photo.png")).toEqual([
      "exec",
      "wrangler",
      "r2",
      "object",
      "delete",
      "spoonjoy-photos-qa/spoons/user-1/uploads/photo.png",
      "--remote",
      "--force",
    ]);
  });

  it("only treats known Wrangler R2 missing-key errors as deleted-object proof", () => {
    expect(isQaR2ObjectMissingError(Object.assign(new Error("wrangler failed"), {
      stderr: "\u001b[31mERROR\u001b[0m The specified key does not exist.",
    }))).toBe(true);
    expect(isQaR2ObjectMissingError({
      stdout: new TextEncoder().encode("NoSuchKey: missing object"),
    })).toBe(true);
    expect(isQaR2ObjectMissingError(Object.assign(new Error("wrangler failed"), {
      stderr: "Authentication failed: invalid API token",
    }))).toBe(false);
    expect(isQaR2ObjectMissingError({ stderr: 403 })).toBe(false);
    expect(isQaR2ObjectMissingError(Object.assign(new Error("network failed"), {
      code: "ENOTFOUND",
    }))).toBe(false);
    expect(isQaR2ObjectMissingError("The specified key does not exist.")).toBe(true);
  });

  it("allows explicit production smoke args for the production Worker URL", () => {
    expect(
      parseSmokeArgs([
        "--target-env",
        "production",
        "--base-url",
        "https://spoonjoy-v2.mendelow-studio.workers.dev",
      ]),
    ).toMatchObject({
      targetEnv: "production",
      baseUrl: "https://spoonjoy-v2.mendelow-studio.workers.dev",
    });
  });

  it("allows explicit production smoke args for the production custom domain", () => {
    expect(parseSmokeArgs(["--target-env", "production", "--base-url", "https://spoonjoy.app"])).toMatchObject({
      targetEnv: "production",
      baseUrl: "https://spoonjoy.app",
    });
  });

  it("refuses mismatched QA target env and production URL", () => {
    expect(() =>
      parseSmokeArgs(["--target-env", "qa", "--base-url", "https://spoonjoy-v2.mendelow-studio.workers.dev"]),
    ).toThrow(/QA smoke/);
  });

  it("refuses mismatched production target env and QA URL", () => {
    expect(() =>
      parseSmokeArgs([
        "--target-env",
        "production",
        "--base-url",
        "https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
      ]),
    ).toThrow(/Production smoke/);
  });

  it("refuses mismatched local target env and remote URL", () => {
    expect(() =>
      parseSmokeArgs(["--target-env", "local", "--base-url", "https://spoonjoy-v2.mendelow-studio.workers.dev"]),
    ).toThrow(/Local smoke/);
  });

  it("refuses unknown target envs", () => {
    expect(() =>
      parseSmokeArgs(["--target-env", "staging", "--base-url", "http://localhost:5173"]),
    ).toThrow(/must be one of local, qa, or production/);
  });

  it("parses D1 count output variants and rejects malformed output", () => {
    expect(parseD1CountOutput(JSON.stringify([{ results: [{ count: 2 }] }]))).toBe(2);
    expect(parseD1CountOutput(JSON.stringify([{ results: [{ "COUNT(*)": "3" }] }]))).toBe(3);
    expect(parseD1CountOutput(JSON.stringify([{ results: [{ "count(*)": 4 }] }]))).toBe(4);
    expect(() => parseD1CountOutput("no json here")).toThrow(/JSON array/);
    expect(() => parseD1CountOutput(JSON.stringify([{ results: [{}] }]))).toThrow(/numeric count/);
  });

  it("rejects unsupported target envs for D1 arg builders", () => {
    expect(() => buildUserCountD1Args("codex@example.com", { targetEnv: "staging" })).toThrow(/targetEnv/);
  });

  it("reads git metadata with unknown fallbacks", () => {
    expect(readGitMetadata(() => "")).toEqual({ branch: "unknown", commit: "unknown" });

    let calls = 0;
    expect(readGitMetadata(() => {
      calls += 1;
      if (calls === 1) throw new Error("git unavailable");
      return "abc123def456\n";
    })).toEqual({ branch: "unknown", commit: "abc123def456" });
  });

  it("builds live smoke artifact metadata with empty R2 arrays for normal smoke", () => {
    expect(typeof smokeHelpers.buildSmokeReport).toBe("function");

    const report = smokeHelpers.buildSmokeReport({
      generatedAt: "2026-06-12T14:00:00.000Z",
      target: {
        targetEnv: "production",
        baseUrl: "https://spoonjoy.app",
        d1Target: "production D1 spoonjoy (--remote)",
        r2Target: "production R2 spoonjoy-photos (--remote)",
        destructiveScope: "production read-only by default; exact smoke cleanup only",
      },
      git: { branch: "spoonjoy/sj-044-cleanup-harness", commit: "abc1234" },
      created: {
        email: "codex-smoke@example.com",
        username: "codex_smoke",
        recipeTitle: "Codex smoke skillet",
        recipeId: "recipe-1",
      },
      screenshots: ["01.png"],
      consoleErrors: [],
      pageErrors: [],
      cleanup: { target: "production D1" },
      cleanupVerification: { remaining: 0 },
      apple: { skipped: false },
      pushPublicKeyStatus: 200,
    });

    expect(report.environment).toEqual({
      targetEnv: "production",
      baseUrl: "https://spoonjoy.app",
      d1Target: "production D1 spoonjoy (--remote)",
      r2Target: "production R2 spoonjoy-photos (--remote)",
      destructiveScope: "production read-only by default; exact smoke cleanup only",
    });
    expect(report.git).toEqual({ branch: "spoonjoy/sj-044-cleanup-harness", commit: "abc1234" });
    expect(report.created).toEqual({
      email: "codex-smoke@example.com",
      username: "codex_smoke",
      recipeTitle: "Codex smoke skillet",
      recipeId: "recipe-1",
    });
    expect(report.cleanup).toEqual({ target: "production D1" });
    expect(report.cleanupVerification).toEqual({ remaining: 0 });
    expect(report.r2).toEqual({ retainedKeys: [], deletedKeys: [], verifiedDeletedKeys: [] });
    expect(report).toMatchObject({
      baseUrl: "https://spoonjoy.app",
      email: "codex-smoke@example.com",
      username: "codex_smoke",
      recipeTitle: "Codex smoke skillet",
      recipeId: "recipe-1",
      targetEnv: "production",
    });
  });

  it("mirrors image-cover R2 arrays into the top-level live smoke artifact", () => {
    expect(typeof smokeHelpers.buildSmokeReport).toBe("function");

    const report = smokeHelpers.buildSmokeReport({
      generatedAt: "2026-06-12T14:00:00.000Z",
      target: {
        targetEnv: "qa",
        baseUrl: "https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
        d1Target: "QA D1 spoonjoy-qa (--remote --env qa)",
        r2Target: "QA R2 spoonjoy-photos-qa (--remote)",
        destructiveScope: "QA disposable test data only",
      },
      git: { branch: "spoonjoy/sj-044-cleanup-harness", commit: "def5678" },
      created: {
        email: "codex-smoke@example.com",
        username: "codex_smoke",
        recipeTitle: "Codex smoke skillet",
        recipeId: "recipe-1",
      },
      imageCoverSmoke: {
        r2: {
          retainedKeys: ["recipes/other-user/uploads/keep.jpg"],
          deletedKeys: ["recipes/user-1/uploads/oriented.jpg"],
          verifiedDeletedKeys: ["recipes/user-1/uploads/oriented.jpg"],
          generatedCoverKeys: ["covers/generated.jpg"],
        },
      },
    });

    expect(report.r2).toEqual({
      retainedKeys: ["recipes/other-user/uploads/keep.jpg"],
      deletedKeys: ["recipes/user-1/uploads/oriented.jpg"],
      verifiedDeletedKeys: ["recipes/user-1/uploads/oriented.jpg"],
      generatedCoverKeys: ["covers/generated.jpg"],
    });
  });
});
