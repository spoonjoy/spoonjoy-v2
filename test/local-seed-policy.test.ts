import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  isCliEntry,
  parseLocalSeedLifecycleArgs,
  runLocalSeedLifecycle,
} from "../scripts/seed-local.mjs";

describe("local development seed policy", () => {
  const legacyDemoEmail = "demo@" + "spoonjoy.com";
  const legacyDemoPassword = "demo" + "1234";
  const reusableExamplePassword = "password" + "123";

  it("requires an explicit local target in package and CI seed calls", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(packageJson.scripts["db:seed"]).toBe("node scripts/seed-local.mjs --target-env local");
    expect(ciWorkflow).toContain("pnpm db:seed");
    expect(ciWorkflow).toContain("pnpm run cleanup:local:apply");
    expect(ciWorkflow).not.toMatch(/\bpnpm exec tsx prisma\/seed\.ts/);
  });

  it("uses disposable generated local identities instead of reusable demo credentials", () => {
    const seedSource = readFileSync("prisma/seed.ts", "utf8");

    expect(seedSource).toContain("parseLocalSeedArgs");
    expect(seedSource).toContain("createDisposableLocalSeedRun");
    expect(seedSource).toContain("--clean-start");
    expect(seedSource).not.toContain(legacyDemoEmail);
    expect(seedSource).not.toContain(legacyDemoPassword);
    expect(seedSource).not.toContain(reusableExamplePassword);
  });

  it("cleans prior disposable data before invoking the local seed", async () => {
    const calls: Array<[string, string[]]> = [];
    const runCommand = vi.fn(async (file: string, args: string[]) => {
      calls.push([file, args]);
      return { stdout: "", stderr: "" };
    });

    await runLocalSeedLifecycle({ argv: ["--target-env", "local"], runCommand });

    expect(calls).toEqual([
      ["node", ["scripts/cleanup-local-qa-data.mjs", "--target-env", "local", "--apply"]],
      ["pnpm", ["exec", "tsx", "prisma/seed.ts", "--target-env", "local", "--clean-start"]],
    ]);
  });

  it("refuses missing and non-local lifecycle targets", () => {
    expect(() => parseLocalSeedLifecycleArgs([])).toThrow(/--target-env local/);
    expect(() => parseLocalSeedLifecycleArgs(["--target-env", "production"])).toThrow(/--target-env local/);
  });

  it("does not seed when cleanup fails", async () => {
    const runCommand = vi.fn().mockRejectedValueOnce(new Error("cleanup failed"));

    await expect(
      runLocalSeedLifecycle({ argv: ["--target-env", "local"], runCommand }),
    ).rejects.toThrow("cleanup failed");
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("recognizes only the executed wrapper module as the CLI entry", () => {
    expect(isCliEntry("file:///tmp/seed-local.mjs", "/tmp/seed-local.mjs")).toBe(true);
    expect(isCliEntry("file:///tmp/seed-local.mjs", "/tmp/other.mjs")).toBe(false);
    expect(isCliEntry("file:///tmp/seed-local.mjs", undefined)).toBe(false);
  });
});
