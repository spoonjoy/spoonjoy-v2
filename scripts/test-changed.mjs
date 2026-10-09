#!/usr/bin/env node
// Runs the unit tests a pull request's changes affect: Vitest's --changed against the pull
// request's base commit (SPOONJOY_CHANGED_SINCE). A change to package.json or the Vitest or Vite
// config makes Vitest select every test. When no test is affected it says so and passes, because
// Vitest's own "No test files found" goes to stderr, which the warning gate rightly rejects.
import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

// A command's exit status, with its output passed straight through; a signal counts as failure.
export function runInherited(command, args) {
  return spawnSync(command, args, { stdio: "inherit" }).status ?? 1;
}

export function testChanged({
  env = process.env,
  run = runInherited,
  readFile = (file) => readFileSync(file, "utf8"),
  removeFile = (file) => unlinkSync(file),
  log = (message) => process.stdout.write(`${message}\n`),
  listFile = path.join(tmpdir(), `spoonjoy-changed-tests-${process.pid}.json`),
} = {}) {
  const base = env.SPOONJOY_CHANGED_SINCE ?? "";
  if (!SHA_PATTERN.test(base)) throw new Error("SPOONJOY_CHANGED_SINCE must be the base commit's 40-character SHA.");
  const listed = run("pnpm", ["exec", "vitest", "list", "--changed", base, "--filesOnly", `--json=${listFile}`]);
  if (listed !== 0) return listed;
  let listing;
  try {
    listing = readFile(listFile);
  } finally {
    removeFile(listFile);
  }
  const files = JSON.parse(listing);
  if (!Array.isArray(files)) throw new Error("vitest list did not return a file list.");
  if (files.length === 0) {
    log(`No unit tests are affected by the changes since ${base}.`);
    return 0;
  }
  log(`${files.length} test file(s) are affected by the changes since ${base}.`);
  return run("pnpm", ["exec", "vitest", "run", "--changed", base, "--fileParallelism=false"]);
}

/* istanbul ignore if -- @preserve CLI boundary delegates to the tested testChanged above. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = testChanged();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
