import { afterAll, afterEach } from "vitest";
import { isDeepStrictEqual } from "node:util";

type ConsoleMethod = "warn" | "error" | "info";

type ExpectedConsoleDiagnostic = {
  description: string;
  matches: (args: unknown[]) => boolean;
  method: ConsoleMethod;
  observed: boolean;
};

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
      expectedConsoleDiagnostics.push({
        method,
        description: args.map(formatValue).join(" "),
        matches: (actual) => argsMatch(actual, args),
        observed: false,
      });
    },
    expectConsoleMatching(
      method: ConsoleMethod,
      description: string,
      matches: (args: unknown[]) => boolean,
    ) {
      expectedConsoleDiagnostics.push({
        method,
        description,
        matches,
        observed: false,
      });
    },
    captureConsole(method: ConsoleMethod, args: unknown[]) {
      const expected = expectedConsoleDiagnostics.find((candidate) =>
        !candidate.observed && candidate.method === method && candidate.matches(args)
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
            `expected console.${expected.method} not observed: ${expected.description}`,
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
const originalInfo = console.info;

export function createConsoleDiagnosticWrapper(
  method: ConsoleMethod,
  capture: (method: ConsoleMethod, args: unknown[]) => boolean,
  original: (...args: unknown[]) => void,
) {
  return (...args: unknown[]) => {
    if (!capture(method, args)) Reflect.apply(original, console, args);
  };
}

export function createPrismaWarningInfoWrapper(
  capture: (method: "info", args: unknown[]) => boolean,
  original: (...args: unknown[]) => void,
) {
  return (...args: unknown[]) => {
    const message = args[0];
    if (typeof message !== "string" || !message.includes("prisma:warn")) {
      Reflect.apply(original, console, args);
      return;
    }
    if (!capture("info", args)) Reflect.apply(original, console, args);
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
const prismaWarningInfoWrapper: typeof console.info = createPrismaWarningInfoWrapper(
  collector.captureConsole,
  originalInfo,
);

console.warn = warningWrapper;
console.error = errorWrapper;
console.info = prismaWarningInfoWrapper;

process.on("warning", collector.captureProcessWarning);

export function expectConsoleWarning(...expectedArgs: unknown[]) {
  collector.expectConsole("warn", expectedArgs);
}

export function expectConsoleError(...expectedArgs: unknown[]) {
  collector.expectConsole("error", expectedArgs);
}

export function expectConsoleErrorMatching(
  description: string,
  matches: (args: unknown[]) => boolean,
) {
  collector.expectConsoleMatching("error", description, matches);
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
