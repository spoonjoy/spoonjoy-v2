import { afterAll, afterEach } from "vitest";
import { isDeepStrictEqual } from "node:util";

type ConsoleMethod = "warn" | "error";

type ExpectedConsoleDiagnostic = {
  args: unknown[];
  method: ConsoleMethod;
  observed: boolean;
};

export interface WarningEmitter {
  emitWarning: (...args: unknown[]) => void;
}

const nodeSqliteWarningMessage =
  "SQLite is an experimental feature and might change at any time";

function isNodeSqliteInitializationWarning(args: unknown[], stack: string) {
  return args.length === 4 &&
    args[0] === nodeSqliteWarningMessage &&
    args[1] === "ExperimentalWarning" &&
    args[2] === undefined &&
    args[3] === undefined &&
    /(?:^|\n)\s*at node:sqlite:\d+:\d+(?:\n|$)/.test(stack);
}

export function installNodeSqliteWarningException(
  processLike: WarningEmitter,
  captureStack = () => String(new Error().stack),
) {
  const originalEmitWarning = processLike.emitWarning;
  const filteredEmitWarning = function (this: unknown, ...args: unknown[]) {
    if (isNodeSqliteInitializationWarning(args, captureStack())) {
      if (processLike.emitWarning === filteredEmitWarning) {
        processLike.emitWarning = originalEmitWarning;
      }
      return;
    }
    Reflect.apply(originalEmitWarning, this, args);
  };

  processLike.emitWarning = filteredEmitWarning;
  return () => {
    if (processLike.emitWarning === filteredEmitWarning) {
      processLike.emitWarning = originalEmitWarning;
    }
  };
}

function formatValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

function argsMatch(actual: unknown[], expected: unknown[]) {
  return actual.length === expected.length &&
    actual.every((value, index) => isDeepStrictEqual(value, expected[index]));
}

export function createWarningCollector() {
  const diagnostics: string[] = [];
  const expectedConsoleDiagnostics: ExpectedConsoleDiagnostic[] = [];

  return {
    expectConsole(method: ConsoleMethod, args: unknown[]) {
      expectedConsoleDiagnostics.push({ method, args, observed: false });
    },
    captureConsole(method: ConsoleMethod, args: unknown[]) {
      const expected = expectedConsoleDiagnostics.find((candidate) =>
        !candidate.observed && candidate.method === method && argsMatch(args, candidate.args)
      );
      if (expected) {
        expected.observed = true;
        return true;
      }
      diagnostics.push(`console.${method}: ${args.map(formatValue).join(" ")}`);
      return false;
    },
    captureProcessWarning(warning: Error) {
      diagnostics.push(`process warning: ${formatValue(warning)}`);
    },
    reset() {
      diagnostics.length = 0;
      expectedConsoleDiagnostics.length = 0;
    },
    assertClean() {
      for (const expected of expectedConsoleDiagnostics) {
        if (!expected.observed) {
          diagnostics.push(
            `expected console.${expected.method} not observed: ${expected.args.map(formatValue).join(" ")}`,
          );
        }
      }
      if (diagnostics.length > 0) {
        throw new Error(`Unexpected warning/error output:\n${diagnostics.join("\n")}`);
      }
    },
  };
}

const collector = createWarningCollector();
const originalWarn = console.warn;
const originalError = console.error;

export function createConsoleDiagnosticWrapper(
  method: ConsoleMethod,
  capture: (method: ConsoleMethod, args: unknown[]) => boolean,
  original: (...args: unknown[]) => void,
) {
  return (...args: unknown[]) => {
    if (!capture(method, args)) Reflect.apply(original, console, args);
  };
}

const warningWrapper: typeof console.warn = createConsoleDiagnosticWrapper(
  "warn",
  collector.captureConsole,
  originalWarn,
);
const errorWrapper: typeof console.error = createConsoleDiagnosticWrapper(
  "error",
  collector.captureConsole,
  originalError,
);

console.warn = warningWrapper;
console.error = errorWrapper;

installNodeSqliteWarningException(process as unknown as WarningEmitter);

process.on("warning", collector.captureProcessWarning);

export function expectConsoleWarning(...expectedArgs: unknown[]) {
  collector.expectConsole("warn", expectedArgs);
}

export function expectConsoleError(...expectedArgs: unknown[]) {
  collector.expectConsole("error", expectedArgs);
}

function assertAndResetCollector() {
  try {
    collector.assertClean();
  } finally {
    collector.reset();
  }
}

afterEach(assertAndResetCollector);
afterAll(assertAndResetCollector);
