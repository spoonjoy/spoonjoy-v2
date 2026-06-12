import { describe, expect, it } from "vitest";

import {
  resolveScriptTarget,
  scriptTargetSummary,
  TARGET_ENVS,
} from "../../scripts/script-environment.mjs";

describe("script target resolver", () => {
  it("declares the only supported target environments", () => {
    expect(TARGET_ENVS).toEqual(["local", "qa", "production"]);
  });

  it("infers local for localhost URLs and returns D1/R2/destructive-scope metadata", () => {
    expect(
      resolveScriptTarget({
        argv: ["--base-url", "http://localhost:5173"],
        env: {},
        defaultBaseUrl: "https://spoonjoy.app",
      }),
    ).toMatchObject({
      targetEnv: "local",
      baseUrl: "http://localhost:5173",
      origin: "http://localhost:5173",
      d1Target: "local D1 (--local)",
      d1Args: ["--local"],
      r2Target: "local photos binding",
      r2Bucket: null,
      destructiveScope: "local disposable test data only",
    });
  });

  it("resolves QA metadata from an explicit target and exact QA URL", () => {
    expect(
      resolveScriptTarget({
        argv: [
          "--target-env",
          "qa",
          "--base-url",
          "https://spoonjoy-v2-qa.mendelow-studio.workers.dev/some-path",
        ],
        env: {},
        defaultBaseUrl: "https://spoonjoy.app",
      }),
    ).toMatchObject({
      targetEnv: "qa",
      baseUrl: "https://spoonjoy-v2-qa.mendelow-studio.workers.dev/some-path",
      origin: "https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
      d1Target: "QA D1 spoonjoy-qa (--remote --env qa)",
      d1Args: ["--remote", "--env", "qa"],
      r2Target: "QA R2 spoonjoy-photos-qa (--remote)",
      r2Bucket: "spoonjoy-photos-qa",
      destructiveScope: "QA disposable test data only",
    });
  });

  it("resolves production metadata for the Worker and custom-domain origins", () => {
    expect(
      resolveScriptTarget({
        argv: [
          "--target-env",
          "production",
          "--base-url",
          "https://spoonjoy-v2.mendelow-studio.workers.dev",
        ],
        env: {},
        defaultBaseUrl: "https://spoonjoy.app",
      }),
    ).toMatchObject({
      targetEnv: "production",
      origin: "https://spoonjoy-v2.mendelow-studio.workers.dev",
      d1Target: "production D1 spoonjoy (--remote)",
      d1Args: ["--remote"],
      r2Target: "production R2 spoonjoy-photos (--remote)",
      r2Bucket: "spoonjoy-photos",
      destructiveScope: "production read-only by default; exact smoke cleanup only",
    });

    expect(
      resolveScriptTarget({
        argv: ["--target-env", "production", "--base-url", "https://spoonjoy.app"],
        env: {},
        defaultBaseUrl: "https://spoonjoy.app",
      }),
    ).toMatchObject({
      targetEnv: "production",
      origin: "https://spoonjoy.app",
    });
  });

  it("requires an explicit target env for remote URLs", () => {
    expect(() =>
      resolveScriptTarget({
        argv: ["--base-url", "https://spoonjoy-v2-qa.mendelow-studio.workers.dev"],
        env: {},
        defaultBaseUrl: "https://spoonjoy.app",
      }),
    ).toThrow(/--target-env qa or --target-env production/);
  });

  it("rejects invalid target envs, empty base URLs, invalid URLs, and URL/env mismatches", () => {
    expect(() =>
      resolveScriptTarget({
        argv: ["--target-env", "staging", "--base-url", "http://localhost:5173"],
        env: {},
        defaultBaseUrl: "https://spoonjoy.app",
      }),
    ).toThrow(/local, qa, or production/);

    expect(() =>
      resolveScriptTarget({ argv: ["--base-url", ""], env: {}, defaultBaseUrl: "https://spoonjoy.app" }),
    ).toThrow(/base URL/i);

    expect(() =>
      resolveScriptTarget({ argv: ["--base-url", "not a url"], env: {}, defaultBaseUrl: "https://spoonjoy.app" }),
    ).toThrow(/valid URL/i);

    expect(() =>
      resolveScriptTarget({
        argv: ["--target-env", "local", "--base-url", "https://spoonjoy.app"],
        env: {},
        defaultBaseUrl: "https://spoonjoy.app",
      }),
    ).toThrow(/Local target/);

    expect(() =>
      resolveScriptTarget({
        argv: ["--target-env", "qa", "--base-url", "https://spoonjoy.app"],
        env: {},
        defaultBaseUrl: "https://spoonjoy.app",
      }),
    ).toThrow(/QA target/);

    expect(() =>
      resolveScriptTarget({
        argv: ["--target-env", "production", "--base-url", "https://spoonjoy-v2-qa.mendelow-studio.workers.dev"],
        env: {},
        defaultBaseUrl: "https://spoonjoy.app",
      }),
    ).toThrow(/Production target/);
  });

  it("formats the resolved target summary agents see before destructive commands", () => {
    const target = resolveScriptTarget({
      argv: ["--target-env", "qa", "--base-url", "https://spoonjoy-v2-qa.mendelow-studio.workers.dev"],
      env: {},
      defaultBaseUrl: "https://spoonjoy.app",
    });

    expect(scriptTargetSummary(target)).toEqual([
      "Target environment: qa",
      "Base URL: https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
      "D1 target: QA D1 spoonjoy-qa (--remote --env qa)",
      "R2 target: QA R2 spoonjoy-photos-qa (--remote)",
      "Destructive scope: QA disposable test data only",
    ]);
  });
});
