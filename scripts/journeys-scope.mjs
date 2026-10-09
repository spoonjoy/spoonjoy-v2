#!/usr/bin/env node
// Decides whether a pull request's Journeys run can skip the suite. It skips only when every file
// the pull request changes is on a short list of paths that cannot change what the app renders or
// how Journeys deploys and drives it; anything else, any unknown path, the `visual` label, or any
// doubt runs the suite. A skipped run still reports the required `journeys` check as passed, so
// the pull request can enter the merge queue, and the queue's merge_group run always runs the full
// suite on the exact commit that will land on main.
//
// Run in the Journeys workflow's `changes` job from the base branch's copy of this file, so a pull
// request cannot widen the list for its own run. It reads the pull request's files and labels from
// GitHub at run time (so adding `visual` and re-running the run forces the suite) and writes
// `journeys=true|false` to GITHUB_OUTPUT with the reason in the job summary.
import { execFile } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const FORCE_LABEL = "visual";
// GitHub lists at most 3,000 files for a pull request; at that size the list may be incomplete.
export const MAX_LISTED_FILES = 3000;

// Each entry: a path that cannot affect rendering or the Journeys run, and why.
// Files under app/ are never on this list, test or story or not: app/styles/tailwind.css builds the
// shipped CSS from every file under app/ and from stories/, so they can change what renders.
export const SKIPPABLE_PATHS = Object.freeze([
  { pattern: /^docs\//, why: "documentation" },
  { pattern: /\.md$/i, why: "Markdown" },
  { pattern: /^\.github\/workflows\/(?!journeys\.yml$)[^/]+\.ya?ml$/, why: "another workflow" },
  { pattern: /^test\//, why: "unit tests" },
  { pattern: /^(?:workers|worker|scripts)\/(?:.+\/)?[^/]+\.test\.(?:ts|mjs|js)$/, why: "a unit test" },
  { pattern: /^(?:LICENSE|\.editorconfig)$/, why: "repository metadata" },
]);

// Files the Journeys run reads although they match the list above: the "Check the QA config" step
// (scripts/qa-preflight.ts) reads these, so a change to one can change whether Journeys passes.
// test/scripts/journeys-scope.test.ts checks this list against qa-preflight.ts.
export const NEVER_SKIP = Object.freeze(new Set([
  ".github/workflows/ci.yml",
  ".github/workflows/production-deploy.yml",
  ".github/workflows/qa-image-cover-smoke.yml",
  ".github/workflows/storybook.yml",
  "README.md",
  "docs/deployment.md",
]));

export function skippableReason(file) {
  if (NEVER_SKIP.has(file)) return null;
  return SKIPPABLE_PATHS.find(({ pattern }) => pattern.test(file))?.why ?? null;
}

// Pure decision: { journeys, why }.
export function decide({ files, labels }) {
  if (labels.includes(FORCE_LABEL)) return { journeys: true, why: `The pull request has the \`${FORCE_LABEL}\` label.` };
  if (files.length === 0) return { journeys: true, why: "GitHub listed no changed files, so the suite runs." };
  if (files.length >= MAX_LISTED_FILES) {
    return { journeys: true, why: `GitHub lists at most ${MAX_LISTED_FILES} files, so the list may be incomplete and the suite runs.` };
  }
  const needsRun = files.filter((file) => skippableReason(file) === null);
  if (needsRun.length > 0) {
    const shown = needsRun.slice(0, 10).map((file) => `\`${file}\``).join(", ");
    return {
      journeys: true,
      why: `${needsRun.length} changed file(s) can affect rendering or the Journeys run, for example ${shown}.`,
    };
  }
  return {
    journeys: false,
    why: `All ${files.length} changed file(s) are documentation, unit tests or other workflows, so this pull request's Journeys run skips the suite. The merge queue still runs it.`,
  };
}

function requiredEnv(env, name) {
  const value = env[name] ?? "";
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function ghJson(run, args) {
  const output = await run("gh", args);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`gh ${args.join(" ")} did not return valid JSON.`);
  }
}

// Every changed path, including the old path of a renamed file.
export async function pullRequestFiles(run, repository, number) {
  const pages = await ghJson(run, [
    "api", "--paginate", "--slurp", `repos/${repository}/pulls/${number}/files?per_page=100`,
  ]);
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error("The pull request file list is malformed.");
  const files = [];
  for (const entry of pages.flat()) {
    if (!entry || typeof entry.filename !== "string") throw new Error("The pull request file list is malformed.");
    files.push(entry.filename);
    if (typeof entry.previous_filename === "string") files.push(entry.previous_filename);
  }
  return files;
}

export async function pullRequestLabels(run, repository, number) {
  const labels = await ghJson(run, ["api", `repos/${repository}/issues/${number}/labels?per_page=100`]);
  if (!Array.isArray(labels) || !labels.every((label) => label && typeof label.name === "string")) {
    throw new Error("The pull request label list is malformed.");
  }
  return labels.map((label) => label.name);
}

export async function runCommand(file, args) {
  return (await execFileAsync(file, args, { maxBuffer: 64 * 1024 * 1024 })).stdout;
}

export async function runJourneysScope({
  env = process.env,
  run = runCommand,
  appendFile = appendFileSync,
} = {}) {
  const output = requiredEnv(env, "GITHUB_OUTPUT");
  const summary = requiredEnv(env, "GITHUB_STEP_SUMMARY");
  let decision;
  try {
    const repository = requiredEnv(env, "GITHUB_REPOSITORY");
    const number = requiredEnv(env, "PR_NUMBER");
    if (!/^\d+$/.test(number)) throw new Error("PR_NUMBER must be a pull request number.");
    decision = decide({
      files: await pullRequestFiles(run, repository, number),
      labels: await pullRequestLabels(run, repository, number),
    });
  } catch (error) {
    decision = {
      journeys: true,
      why: `Could not read the pull request's files or labels (${error instanceof Error ? error.message : String(error)}), so the suite runs.`,
    };
  }
  appendFile(output, `journeys=${decision.journeys}\n`);
  appendFile(summary, ["### Journeys scope", "", decision.why, ""].join("\n"));
  return decision;
}

export function isCliEntry(argv1, moduleUrl) {
  return Boolean(argv1) && path.resolve(argv1) === fileURLToPath(moduleUrl);
}

/* istanbul ignore if -- @preserve CLI boundary delegates to the tested runJourneysScope above. */
if (isCliEntry(process.argv[1], import.meta.url)) {
  runJourneysScope().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
