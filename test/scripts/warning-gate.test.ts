import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXPECTED_PRISMA_D1_TRANSACTION_WARNING,
  findUnexpectedWarnings,
  main,
  parseWarningGateCommands,
  resolveSpawnedCommandClose,
  runSpawnedCommand,
  runWarningGate,
} from "../../scripts/warning-gate";

describe("warning gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses sequential command segments after --", () => {
    expect(parseWarningGateCommands([
      "--",
      "pnpm",
      "run",
      "api:playground:generate",
      "--then",
      "pnpm",
      "exec",
      "vitest",
      "run",
      "--coverage",
    ])).toEqual([
      ["pnpm", "run", "api:playground:generate"],
      ["pnpm", "exec", "vitest", "run", "--coverage"],
    ]);
  });

  it("rejects missing separators and empty command segments", () => {
    expect(() => parseWarningGateCommands([])).toThrow(/-- separator/);
    expect(() => parseWarningGateCommands(["--"])).toThrow(/at least one command/);
    expect(() => parseWarningGateCommands(["--", "--then", "pnpm"])).toThrow(/empty command/);
    expect(() => parseWarningGateCommands(["--", "pnpm", "--then"])).toThrow(/empty command/);
  });

  it("detects real warning tokens without self-matching coverage table filenames", () => {
    const prismaWarning = `prisma:warn ${EXPECTED_PRISMA_D1_TRANSACTION_WARNING}`;
    expect(findUnexpectedWarnings(`ok\n${prismaWarning}\n`)).toEqual([prismaWarning]);
    expect(findUnexpectedWarnings("\u001b[33mprisma:warn Something else happened\u001b[39m")).toEqual([
      "prisma:warn Something else happened",
    ]);
    expect(findUnexpectedWarnings("warning-gate.ts  |   59.09 |    62.06 |")).toEqual([]);
    expect(findUnexpectedWarnings("PASS scripts: scripts/warning-gate.ts, scripts/production-readiness.ts")).toEqual([]);
    expect(findUnexpectedWarnings("warnings-summary.log")).toEqual([]);
    expect(findUnexpectedWarnings("2 warnings")).toEqual(["2 warnings"]);
    expect(findUnexpectedWarnings("Found 2 warnings")).toEqual(["Found 2 warnings"]);
    expect(findUnexpectedWarnings("WARNINGS: 2")).toEqual(["WARNINGS: 2"]);
    expect(findUnexpectedWarnings("ExperimentalWarnings: surprise")).toEqual([
      "ExperimentalWarnings: surprise",
    ]);
    expect(findUnexpectedWarnings("[warnings] generated fallback output")).toEqual([
      "[warnings] generated fallback output",
    ]);
    expect(findUnexpectedWarnings("✓ [warnings] hidden behind a status prefix")).toEqual([
      "✓ [warnings] hidden behind a status prefix",
    ]);
    expect(findUnexpectedWarnings("✓ should preserve warnings copy")).toEqual([]);
    expect(findUnexpectedWarnings("warnings-summary.log: Warnings: build failed")).toEqual([
      "warnings-summary.log: Warnings: build failed",
    ]);
    expect(findUnexpectedWarnings("✓ should display appropriate UI warning for one auth method")).toEqual([]);
    expect(findUnexpectedWarnings("✓ test/scripts/warning-gate.test.ts (14 tests) 194ms")).toEqual([]);
    expect(findUnexpectedWarnings("✓ app/lib/warning-copy.test.tsx (1 test) 2.4s")).toEqual([]);
    expect(findUnexpectedWarnings("✓ warning dependency fallback used")).toEqual([
      "✓ warning dependency fallback used",
    ]);
    expect(findUnexpectedWarnings("✓ should keep warning copy in a passing test name")).toEqual([]);

    expect(findUnexpectedWarnings("▲ [WARNING] bundle contains dynamic import")).toEqual([
      "▲ [WARNING] bundle contains dynamic import",
    ]);
    expect(findUnexpectedWarnings("⚠️ Warning: browser console noise")).toEqual([
      "⚠️ Warning: browser console noise",
    ]);
    expect(findUnexpectedWarnings("[vite] warning: env replacement skipped")).toEqual([
      "[vite] warning: env replacement skipped",
    ]);
    expect(findUnexpectedWarnings("(node:123) ExperimentalWarning: surprise")).toEqual([
      "(node:123) ExperimentalWarning: surprise",
    ]);
    expect(findUnexpectedWarnings("WARNING: browser console noise")).toEqual([
      "WARNING: browser console noise",
    ]);
    expect(findUnexpectedWarnings("⚠️ Missing unit for imported ingredient")).toEqual([
      "⚠️ Missing unit for imported ingredient",
    ]);
    expect(findUnexpectedWarnings("WARN[build] generated chunk is oversized")).toEqual([
      "WARN[build] generated chunk is oversized",
    ]);
    expect(findUnexpectedWarnings("warning(build) generated chunk is oversized")).toEqual([
      "warning(build) generated chunk is oversized",
    ]);
    expect(findUnexpectedWarnings("foo-warning: generated chunk is oversized")).toEqual([
      "foo-warning: generated chunk is oversized",
    ]);
    expect(findUnexpectedWarnings("[warn] hidden on stdout")).toEqual([
      "[warn] hidden on stdout",
    ]);
    expect(findUnexpectedWarnings("[WARN] hidden on stdout")).toEqual([
      "[WARN] hidden on stdout",
    ]);
    expect(findUnexpectedWarnings("[ warning ] hidden on stdout")).toEqual([
      "[ warning ] hidden on stdout",
    ]);
    expect(findUnexpectedWarnings("✓ [warn] hidden behind a status prefix")).toEqual([
      "✓ [warn] hidden behind a status prefix",
    ]);
    expect(findUnexpectedWarnings("\u001b[33mWarning: hidden behind color\u001b[39m")).toEqual([
      "Warning: hidden behind color",
    ]);
    expect(findUnexpectedWarnings("warniX\u001b[1Dng")).toEqual([
      "warning-gate rejected cursor-editing terminal control output: warniXng",
    ]);
    expect(findUnexpectedWarnings("warnin\bng")).toEqual([
      "warning-gate rejected cursor-editing terminal control output: warninng",
    ]);
    expect(findUnexpectedWarnings("\u001b[2K\u001b[1GWarning: hidden after cursor controls")).toEqual([
      "warning-gate rejected cursor-editing terminal control output: Warning: hidden after cursor controls",
    ]);
    expect(findUnexpectedWarnings("\u001b(Bordinary charset switch")).toEqual([
      "warning-gate rejected cursor-editing terminal control output: ordinary charset switch",
    ]);
    expect(findUnexpectedWarnings("\u001b]0;build title\u0007Warning: hidden after OSC title\n")).toEqual([
      "Warning: hidden after OSC title",
    ]);
    expect(findUnexpectedWarnings("\u001b]0;build title\u001b\\Warning: hidden after OSC ST\n")).toEqual([
      "Warning: hidden after OSC ST",
    ]);
    expect(findUnexpectedWarnings("✓ ordinary passing test")).toEqual([]);
    expect(findUnexpectedWarnings("\u001b[2K\u001b[1G✓ ordinary passing test")).toEqual([
      "warning-gate rejected cursor-editing terminal control output: ✓ ordinary passing test",
    ]);
    expect(findUnexpectedWarnings("[warn:build] hidden on stdout")).toEqual([
      "[warn:build] hidden on stdout",
    ]);
    expect(findUnexpectedWarnings("Warning! hidden failure")).toEqual([
      "Warning! hidden failure",
    ]);
    expect(findUnexpectedWarnings("WARNING-hidden failure")).toEqual([
      "WARNING-hidden failure",
    ]);
    expect(findUnexpectedWarnings("WARNING-gated bypass")).toEqual([
      "WARNING-gated bypass",
    ]);
    expect(findUnexpectedWarnings("WARN=hidden failure")).toEqual([
      "WARN=hidden failure",
    ]);
    expect(findUnexpectedWarnings(`${prismaWarning} Warning: appended bypass`)).toEqual([
      `${prismaWarning} Warning: appended bypass`,
    ]);
  });

  it("streams spawned command output and reports child exit states", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = await runSpawnedCommand([
      process.execPath,
      "-e",
      "process.stdout.write('out'); process.stderr.write('err');",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("out");
    expect(result.output).toContain("err");
    expect(result.warningOutput).toBe("err");
    expect(stdout).toHaveBeenCalledWith("out");
    expect(stderr).toHaveBeenCalledWith("err");
  });

  it("rejects empty or unspawnable commands and records signal exits", async () => {
    expect(() => runSpawnedCommand([])).toThrow(/empty command/);
    await expect(runSpawnedCommand(["/definitely/not/a/spoonjoy-command"])).rejects.toThrow();
    expect(resolveSpawnedCommandClose(null, null, "partial")).toEqual({
      exitCode: 1,
      output: "partial",
    });
    expect(resolveSpawnedCommandClose(3, "SIGTERM", "partial")).toEqual({
      exitCode: 1,
      output: "partialwarning-gate child terminated by SIGTERM\n",
    });

    const result = await runSpawnedCommand([
      process.execPath,
      "-e",
      "process.kill(process.pid, 'SIGTERM');",
    ]);

    expect(result).toEqual({
      exitCode: 1,
      output: "warning-gate child terminated by SIGTERM\n",
    });
  });

  it("runs every command and fails unexpected warning output even when commands exit cleanly", async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        exitCode: 0,
        output: "generated\n",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        output: "Warning: leaked warning\n",
      });

    const result = await runWarningGate([
      "--",
      "pnpm",
      "run",
      "api:playground:generate",
      "--then",
      "pnpm",
      "exec",
      "vitest",
    ], { runCommand });

    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(result.exitCode).toBe(1);
    expect(result.unexpectedWarnings).toEqual(["Warning: leaked warning"]);
  });

  it("fails successful commands that write otherwise unmarked output to the warning channel", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      output: "ordinary stdout\n",
      warningOutput: "Missing unit fallback was used\n",
    });

    const result = await runWarningGate(["--", "pnpm", "run", "build"], { runCommand });

    expect(result).toEqual({
      exitCode: 1,
      unexpectedWarnings: ["Missing unit fallback was used"],
    });
  });

  it("still rejects Prisma's CI update banner when it reaches stderr", async () => {
    const updateBanner = "Update available 6.19.2 -> 7.8.0\n";
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      output: updateBanner,
      warningOutput: updateBanner,
    });

    const result = await runWarningGate(["--", "pnpm", "prisma:generate"], { runCommand });

    expect(result).toEqual({
      exitCode: 1,
      unexpectedWarnings: ["Update available 6.19.2 -> 7.8.0"],
    });
  });

  it("fails cursor-editing terminal controls on the warning channel even without text", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      output: "ordinary stdout\n",
      warningOutput: "\u001b[1D\n",
    });

    const result = await runWarningGate(["--", "pnpm", "run", "build"], { runCommand });

    expect(result).toEqual({
      exitCode: 1,
      unexpectedWarnings: ["warning-gate rejected cursor-editing terminal control output"],
    });
  });

  it("preserves a non-zero command exit after scanning warning output", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 7,
      output: "ordinary failure details\n",
    });

    const result = await runWarningGate(["--", "pnpm", "exec", "playwright", "test"], {
      runCommand,
    });

    expect(result.exitCode).toBe(7);
    expect(result.unexpectedWarnings).toEqual([]);
  });

  it("uses the spawned command runner when no test runner is injected", async () => {
    const result = await runWarningGate([
      "--",
      process.execPath,
      "-e",
      "process.exit(0);",
    ], {});

    expect(result).toEqual({
      exitCode: 0,
      unexpectedWarnings: [],
    });
  });

  it("prints CLI warning details and records the selected exit code", async () => {
    const writeStderr = vi.fn();
    const setExitCode = vi.fn();
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      output: "Warning: leaked warning\n",
    });

    const result = await main(["--", "pnpm", "exec", "vitest"], {
      runCommand,
      writeStderr,
      setExitCode,
    });

    expect(result.exitCode).toBe(1);
    expect(writeStderr).toHaveBeenCalledWith(expect.stringContaining("Warning: leaked warning"));
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it("keeps quiet CLI output quiet while preserving command failures", async () => {
    const writeStderr = vi.fn();
    const setExitCode = vi.fn();
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 4,
      output: "ordinary failure details\n",
    });

    const result = await main(["--", "pnpm", "exec", "playwright", "test"], {
      runCommand,
      writeStderr,
      setExitCode,
    });

    expect(result.exitCode).toBe(4);
    expect(result.unexpectedWarnings).toEqual([]);
    expect(writeStderr).not.toHaveBeenCalled();
    expect(setExitCode).toHaveBeenCalledWith(4);
  });

  it("uses process stderr and process exitCode by default at the CLI seam", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      output: "Warning: default CLI path\n",
    });

    process.exitCode = undefined;
    const result = await main(["--", "pnpm", "exec", "vitest"], { runCommand });

    expect(result.exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("Warning: default CLI path"));
    expect(process.exitCode).toBe(1);
  });
});
