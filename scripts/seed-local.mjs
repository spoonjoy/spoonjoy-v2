#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify, stripVTControlCharacters } from "node:util";
import { pathToFileURL } from "node:url";
import { EXPECTED_PRISMA_D1_TRANSACTION_WARNING } from "./warning-gate.ts";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 1024 * 1024 * 8;
const EXPECTED_PRISMA_D1_TRANSACTION_WARNING_LINES = new Set([
  EXPECTED_PRISMA_D1_TRANSACTION_WARNING,
  `prisma:warn ${EXPECTED_PRISMA_D1_TRANSACTION_WARNING}`,
]);

export function filterExpectedPrismaD1WarningLines(output) {
  const parts = output.split(/(\r?\n)/);
  let filtered = "";

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index] ?? "";
    const separator = parts[index + 1] ?? "";
    const normalized = stripVTControlCharacters(line).trim();
    if (!EXPECTED_PRISMA_D1_TRANSACTION_WARNING_LINES.has(normalized)) {
      filtered += line + separator;
    }
  }

  return filtered;
}

export function parseLocalSeedLifecycleArgs(argv = process.argv.slice(2)) {
  const targetIndex = argv.indexOf("--target-env");
  const targetEnv = targetIndex === -1 ? undefined : argv[targetIndex + 1];
  if (targetEnv !== "local") {
    throw new Error("Local seeding requires explicit `--target-env local`.");
  }
  return { targetEnv };
}

export async function runLocalSeedLifecycle({
  argv = process.argv.slice(2),
  runCommand = execFileAsync,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  parseLocalSeedLifecycleArgs(argv);
  const commands = [
    {
      file: "node",
      args: ["scripts/cleanup-local-qa-data.mjs", "--target-env", "local", "--apply"],
      filterExpectedWarnings: false,
    },
    {
      file: "pnpm",
      args: ["exec", "tsx", "prisma/seed.ts", "--target-env", "local", "--clean-start"],
      filterExpectedWarnings: true,
    },
  ];

  for (const { file, args, filterExpectedWarnings } of commands) {
    const result = await runCommand(file, args, { encoding: "utf8", maxBuffer: MAX_BUFFER });
    const commandStdout = filterExpectedWarnings
      ? filterExpectedPrismaD1WarningLines(result.stdout)
      : result.stdout;
    const commandStderr = filterExpectedWarnings
      ? filterExpectedPrismaD1WarningLines(result.stderr)
      : result.stderr;
    if (commandStdout) stdout.write(commandStdout);
    if (commandStderr) stderr.write(commandStderr);
  }
}

export function isCliEntry(moduleUrl, argv1 = process.argv[1]) {
  return typeof argv1 === "string" && moduleUrl === pathToFileURL(argv1).href;
}

if (isCliEntry(import.meta.url)) {
  runLocalSeedLifecycle().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
