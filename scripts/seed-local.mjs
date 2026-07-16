#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 1024 * 1024 * 8;

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
    ["node", ["scripts/cleanup-local-qa-data.mjs", "--target-env", "local", "--apply"]],
    ["pnpm", ["exec", "tsx", "prisma/seed.ts", "--target-env", "local", "--clean-start"]],
  ];

  for (const [file, args] of commands) {
    const result = await runCommand(file, args, { encoding: "utf8", maxBuffer: MAX_BUFFER });
    if (result.stdout) stdout.write(result.stdout);
    if (result.stderr) stderr.write(result.stderr);
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
