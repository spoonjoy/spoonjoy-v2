import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  filterExpectedPrismaD1WarningLines,
  isCliEntry,
  parseLocalSeedLifecycleArgs,
  runLocalSeedLifecycle,
} from "../scripts/seed-local.mjs";
import {
  EXPECTED_PRISMA_D1_TRANSACTION_WARNING,
  runWarningGate,
} from "../scripts/warning-gate";

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
    expect(seedSource).not.toMatch(/console\.(?:warn|error|info)\s*=/);
    expect(seedSource).not.toMatch(/process\.(?:stdout|stderr)\.write\s*=/);
    expect(seedSource).not.toContain("suppressExpectedPrismaD1TransactionWarningOutput");
    expect(seedSource).not.toContain("withoutKnownSeedWarnings");
  });

  it("uses a D1-only Wrangler proxy config so seeding does not instantiate app Durable Objects", () => {
    const seedSource = readFileSync("prisma/seed.ts", "utf8");
    const appConfig = JSON.parse(readFileSync("wrangler.json", "utf8")) as Record<string, unknown>;
    const seedConfig = JSON.parse(readFileSync("wrangler.seed.json", "utf8")) as Record<string, unknown>;

    expect(seedSource).toContain('getPlatformProxy<{ DB: D1Database }>({ configPath: "wrangler.seed.json" })');
    expect(seedConfig.d1_databases).toEqual(appConfig.d1_databases);
    expect(seedConfig).not.toHaveProperty("durable_objects");
    expect(seedConfig).not.toHaveProperty("migrations");
    expect(seedConfig).not.toHaveProperty("r2_buckets");
    expect(seedConfig).not.toHaveProperty("ratelimits");
  });

  it("filters only exact whole-line Prisma D1 transaction warnings", () => {
    const expected = EXPECTED_PRISMA_D1_TRANSACTION_WARNING;
    const output = [
      "cleanup remains visible",
      expected,
      `\u001b[33mprisma:warn ${expected}\u001b[39m`,
      `prisma:warn ${expected} appended diagnostic`,
      "prisma:warn unrelated warning",
      "seed complete",
      "",
    ].join("\n");

    expect(filterExpectedPrismaD1WarningLines(output)).toBe([
      "cleanup remains visible",
      `prisma:warn ${expected} appended diagnostic`,
      "prisma:warn unrelated warning",
      "seed complete",
      "",
    ].join("\n"));
  });

  it("filters seed output without suppressing cleanup or altered diagnostics", async () => {
    const expected = EXPECTED_PRISMA_D1_TRANSACTION_WARNING;
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: `cleanup out\n${expected}\n`,
        stderr: `cleanup err\nprisma:warn ${expected}\n`,
      })
      .mockResolvedValueOnce({
        stdout: `seed out\n${expected}\nseed done\n`,
        stderr: `prisma:warn ${expected}\nprisma:warn ${expected} appended diagnostic\n`,
      });

    await runLocalSeedLifecycle({
      argv: ["--target-env", "local"],
      runCommand,
      stdout,
      stderr,
    });

    expect(stdout.write).toHaveBeenNthCalledWith(1, `cleanup out\n${expected}\n`);
    expect(stdout.write).toHaveBeenNthCalledWith(2, "seed out\nseed done\n");
    expect(stderr.write).toHaveBeenNthCalledWith(1, `cleanup err\nprisma:warn ${expected}\n`);
    expect(stderr.write).toHaveBeenNthCalledWith(
      2,
      `prisma:warn ${expected} appended diagnostic\n`,
    );

    const preservedSeedDiagnostic = stderr.write.mock.calls[1]?.[0] as string;
    const gate = await runWarningGate(["--", "seed"], {
      runCommand: async () => ({
        exitCode: 0,
        output: preservedSeedDiagnostic,
        warningOutput: preservedSeedDiagnostic,
      }),
    });
    expect(gate.exitCode).toBe(1);
    expect(gate.unexpectedWarnings).toContain(
      `prisma:warn ${expected} appended diagnostic`,
    );
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
