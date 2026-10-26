#!/usr/bin/env node
// Runs the unit tests a pull request's changes affect: Vitest's --changed against the pull
// request's base commit (SPOONJOY_CHANGED_SINCE), plus every test that names a changed file in
// quotes. --changed follows imports only, so a test that reads a file by path (wrangler.json, a
// workflow, a migration) was skipped when only that file changed (pull request #593 changed
// wrangler.json, and only the merge queue ran test/config/worker-observability.test.ts). A change
// to package.json or the Vitest or Vite config makes Vitest select every test. When no test is
// affected it says so and passes, because Vitest's own "No test files found" goes to stderr, which
// the warning gate rightly rejects. The affected tests run in parallel, one SQLite test database per
// worker process, as the full coverage run does (vitest.config.ts, test/support/worker-db.ts).
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

// A command's exit status and standard output; its errors still reach the log.
export function runCaptured(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

/**
 * The test files whose source names one of the changed paths as a whole quoted string, such as
 * readFileSync("wrangler.json"): they read that file by path, which the import graph cannot see.
 */
export function testsNamingPaths(testFiles, changedPaths, readFile) {
  if (changedPaths.length === 0) return [];
  const quoted = changedPaths.map((changed) => new RegExp(`["'\`]${changed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`));
  return testFiles.filter((file) => {
    const source = readFile(file);
    return quoted.some((pattern) => pattern.test(source));
  });
}

export function testChanged({
  env = process.env,
  run = runInherited,
  capture = runCaptured,
  readFile = (file) => readFileSync(file, "utf8"),
  removeFile = (file) => unlinkSync(file),
  log = (message) => process.stdout.write(`${message}\n`),
  listFile = path.join(tmpdir(), `spoonjoy-changed-tests-${process.pid}.json`),
  cwd = process.cwd(),
} = {}) {
  const base = env.SPOONJOY_CHANGED_SINCE ?? "";
  if (!SHA_PATTERN.test(base)) throw new Error("SPOONJOY_CHANGED_SINCE must be the base commit's 40-character SHA.");

  // The repository-relative test files `vitest list` names, or its failing status.
  const list = (args) => {
    const listed = run("pnpm", ["exec", "vitest", "list", ...args, "--filesOnly", `--json=${listFile}`]);
    if (listed !== 0) return listed;
    let listing;
    try {
      listing = readFile(listFile);
    } finally {
      removeFile(listFile);
    }
    const files = JSON.parse(listing);
    if (!Array.isArray(files)) throw new Error("vitest list did not return a file list.");
    return files.map((entry) => path.relative(cwd, path.resolve(cwd, entry.file)));
  };

  const diff = capture("git", ["diff", "--name-only", base, "HEAD"]);
  if (diff.status !== 0) return diff.status;
  const changedPaths = diff.stdout.split("\n").filter(Boolean);

  const imported = list(["--changed", base]);
  if (typeof imported === "number") return imported;
  const everyTest = list([]);
  if (typeof everyTest === "number") return everyTest;
  const naming = testsNamingPaths(everyTest, changedPaths, readFile).filter((file) => !imported.includes(file));

  if (imported.length === 0 && naming.length === 0) {
    log(`No unit tests are affected by the changes since ${base}.`);
    return 0;
  }
  log(`${imported.length} test file(s) are affected by the changes since ${base} through imports.`);
  if (naming.length === 0) return run("pnpm", ["exec", "vitest", "run", "--changed", base]);
  log(`${naming.length} more name a changed file: ${naming.join(", ")}`);
  return run("pnpm", ["exec", "vitest", "run", ...imported, ...naming]);
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
