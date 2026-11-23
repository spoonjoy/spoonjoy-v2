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

// Files a story's render reads without a story importing them: Storybook's config (its preview
// wraps every story), the stories and their MDX docs, the story accessibility spec and its config,
// the stylesheet, dependencies, the listing's own config and this decision's own rules.
export const STORY_ALWAYS_RUN_PATHS = Object.freeze([
  /^\.storybook\//,
  /^stories\//,
  /^e2e\/storybook\//,
  /^playwright\.storybook\.config\.ts$/,
  /^vitest\.stories-scope\.config\.ts$/,
  /^app\/styles\//,
  /^public\//,
  /^\.github\/workflows\/storybook\.yml$/,
  /^\.github\/ouro-hx-installed\.json$/,
  /^scripts\/(?:storybook-scope|run-with-warning-policy)\.mjs$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^tsconfig[^/]*\.json$/,
]);

// Decides whether a pull request's story check needs Storybook: it does unless no story, nor
// Storybook's preview, imports a changed file (vitest.stories-scope.config.ts lists them for
// Vitest's --changed) and no file in STORY_ALWAYS_RUN_PATHS changed. The job skips Storybook only
// when this and storybookScope both say so. The merge queue, main and manual runs always build it,
// so the queue's full run still checks every story before anything merges. Any doubt builds it.
export function storyScope({
  env = process.env,
  run = (command, args) => spawnSync(command, args, { stdio: ["ignore", "ignore", "inherit"] }).status ?? 1,
  capture = (command, args) => {
    const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    return { status: result.status ?? 1, stdout: result.stdout ?? "" };
  },
  readFile = (file) => readFileSync(file, "utf8"),
  removeFile = (file) => unlinkSync(file),
  listFile = path.join(tmpdir(), `spoonjoy-stories-${process.pid}.json`),
} = {}) {
  const event = env.GITHUB_EVENT_NAME;
  if (event !== "pull_request") return { storybook: true, reason: `A ${event} run builds Storybook.` };
  const base = env.SPOONJOY_OURO_BASE ?? "";
  if (!SHA_PATTERN.test(base)) return { storybook: true, reason: "No base commit to compare with, so Storybook builds." };

  const diff = capture("git", ["diff", "--name-only", "--no-renames", base, "HEAD"]);
  if (diff.status !== 0) return { storybook: true, reason: "The diff against the base failed, so Storybook builds." };
  const changed = diff.stdout.split("\n").filter(Boolean);
  if (changed.length === 0) return { storybook: true, reason: "No changed file was listed, so Storybook builds." };
  const read = changed.find((file) => STORY_ALWAYS_RUN_PATHS.some((pattern) => pattern.test(file)));
  if (read) return { storybook: true, reason: `${read} changed, and Storybook reads it.` };

  const listed = run("pnpm", ["exec", "vitest", "list", "--config", "vitest.stories-scope.config.ts", "--changed", base, "--filesOnly", `--json=${listFile}`]);
  if (listed !== 0) return { storybook: true, reason: "Listing the affected stories failed, so Storybook builds." };
  let files;
  try {
    files = JSON.parse(readFile(listFile));
  } finally {
    removeFile(listFile);
  }
  if (!Array.isArray(files)) return { storybook: true, reason: "The story listing was not a file list, so Storybook builds." };
  if (files.length > 0) return { storybook: true, reason: `${files.length} story file(s) import a changed file.` };
  return { storybook: false, reason: `No story imports a file changed since ${base}.` };
}

/* istanbul ignore if -- @preserve CLI boundary delegates to the tested storybookScope and storyScope above. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ouro, reason } = storybookScope();
  const stories = storyScope();
  // The job builds Storybook when a story can reach a change or the Ouro UI tests must run.
  const storybook = stories.storybook || ouro;
  for (const line of [reason, stories.reason]) process.stdout.write(`${line}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ouro=${ouro}\nstorybook=${storybook}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Ouro UI tests: ${ouro ? "run" : "skipped"}. ${reason}\nStorybook: ${storybook ? "built" : "skipped"}. ${stories.reason}\n`);
  }
}
