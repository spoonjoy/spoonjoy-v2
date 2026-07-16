import { describe, expect, it, vi } from "vitest";
import {
  EXPECTED_PRISMA_D1_TRANSACTION_WARNING,
  findUnexpectedWarnings,
  isExpectedWarningLine,
  parseWarningGateCommands,
  runWarningGate,
} from "../../scripts/warning-gate";

describe("warning gate", () => {
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
    expect(() => parseWarningGateCommands(["--", "pnpm", "--then"])).toThrow(/empty command/);
  });

  it("allows only the documented Prisma D1 transaction warning", () => {
    const expected = `prisma:warn ${EXPECTED_PRISMA_D1_TRANSACTION_WARNING}`;
    expect(isExpectedWarningLine(expected)).toBe(true);
    expect(findUnexpectedWarnings(`ok\n${expected}\n`)).toEqual([]);

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
});
