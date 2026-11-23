#!/usr/bin/env node
// Decides whether the Storybook job runs the Ouro UI browser tests and specs (about ten minutes).
// On a pull request or a merge-queue group they run only when a change can reach them: a test in
// vitest.ouro.config.ts imports a changed file (Vitest's --changed, the import graph unit-changed
// trusts), or a changed file is one they read some other way (ALWAYS_RUN_PATHS). Otherwise their
// result is the base commit's, which passed them: main's every commit landed through the queue.
// Pushes to main and manual runs always run them. Any doubt (no base, a failed diff or listing, no
// changed file) runs them. The story accessibility check and the Storybook build always run.
//
// The workflow passes the base: the merge commit's first parent on a pull request, the group's
// base_sha in the merge queue. It writes `ouro` to GITHUB_OUTPUT and the reason to the summary.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

// Files the Ouro UI tests and specs read without importing them: Storybook's own config and the
// stylesheet it loads, the specs and their config, dependencies, and this decision's own rules.
export const ALWAYS_RUN_PATHS = Object.freeze([
  /^\.storybook\//,
  /^e2e\/ouro\//,
  /^playwright\.ouro\.config\.ts$/,
  /^vitest\.ouro\.config\.ts$/,
  /^app\/styles\//,
  /^\.github\/workflows\/storybook\.yml$/,
  /^\.github\/ouro-hx-installed\.json$/,
  /^scripts\/(?:storybook-scope|run-with-warning-policy)\.mjs$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^tsconfig[^/]*\.json$/,
]);

export function storybookScope({
  env = process.env,
  run = (command, args) => spawnSync(command, args, { stdio: ["ignore", "ignore", "inherit"] }).status ?? 1,
  capture = (command, args) => {
    const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    return { status: result.status ?? 1, stdout: result.stdout ?? "" };
  },
  readFile = (file) => readFileSync(file, "utf8"),
  removeFile = (file) => unlinkSync(file),
  listFile = path.join(tmpdir(), `spoonjoy-ouro-tests-${process.pid}.json`),
} = {}) {
  const event = env.GITHUB_EVENT_NAME;
  if (event !== "pull_request" && event !== "merge_group") return { ouro: true, reason: `A ${event} run runs the Ouro UI tests.` };
  const base = env.SPOONJOY_OURO_BASE ?? "";
  if (!SHA_PATTERN.test(base)) return { ouro: true, reason: "No base commit to compare with, so the Ouro UI tests run." };

  const diff = capture("git", ["diff", "--name-only", "--no-renames", base, "HEAD"]);
  if (diff.status !== 0) return { ouro: true, reason: "The diff against the base failed, so the Ouro UI tests run." };
  const changed = diff.stdout.split("\n").filter(Boolean);
  if (changed.length === 0) return { ouro: true, reason: "No changed file was listed, so the Ouro UI tests run." };
  const read = changed.find((file) => ALWAYS_RUN_PATHS.some((pattern) => pattern.test(file)));
  if (read) return { ouro: true, reason: `${read} changed, and the Ouro UI tests or specs read it.` };

  const listed = run("pnpm", ["exec", "vitest", "list", "--config", "vitest.ouro.config.ts", "--changed", base, "--filesOnly", `--json=${listFile}`]);
  if (listed !== 0) return { ouro: true, reason: "Listing the affected Ouro UI tests failed, so they run." };
  let files;
  try {
    files = JSON.parse(readFile(listFile));
  } finally {
    removeFile(listFile);
  }
  if (!Array.isArray(files)) return { ouro: true, reason: "The Ouro UI test listing was not a file list, so they run." };
  if (files.length > 0) return { ouro: true, reason: `${files.length} Ouro UI test file(s) import a changed file.` };
  return { ouro: false, reason: `No Ouro UI test or spec input changed since ${base}.` };
}

/* istanbul ignore if -- @preserve CLI boundary delegates to the tested storybookScope above. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ouro, reason } = storybookScope();
  process.stdout.write(`${reason}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ouro=${ouro}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Ouro UI tests: ${ouro ? "run" : "skipped"}. ${reason}\n`);
}
