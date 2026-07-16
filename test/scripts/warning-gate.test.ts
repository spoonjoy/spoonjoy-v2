import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXPECTED_PRISMA_D1_TRANSACTION_WARNING,
  findUnexpectedWarnings,
  isExpectedWarningLine,
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

  it("allows only the documented Prisma D1 transaction warning", () => {
    const expected = `prisma:warn ${EXPECTED_PRISMA_D1_TRANSACTION_WARNING}`;
    expect(isExpectedWarningLine(expected)).toBe(true);
    expect(findUnexpectedWarnings(`ok\n${expected}\n`)).toEqual([]);
    expect(findUnexpectedWarnings("\u001b[33mprisma:warn Something else happened\u001b[39m")).toEqual([
      "prisma:warn Something else happened",
    ]);
    expect(findUnexpectedWarnings("warning-gate.ts  |   59.09 |    62.06 |")).toEqual([]);
    expect(findUnexpectedWarnings("warnings-summary.log")).toEqual([]);

    expect(findUnexpectedWarnings("prisma:warn Something else happened")).toEqual([
      "prisma:warn Something else happened",
    ]);
    expect(findUnexpectedWarnings("(node:123) ExperimentalWarning: surprise")).toEqual([
      "(node:123) ExperimentalWarning: surprise",
    ]);
    expect(findUnexpectedWarnings("WARNING: browser console noise")).toEqual([
      "WARNING: browser console noise",
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

  it("preserves a non-zero command exit after scanning warning output", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 7,
      output: `prisma:warn ${EXPECTED_PRISMA_D1_TRANSACTION_WARNING}\n`,
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
