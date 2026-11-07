#!/usr/bin/env node
// Decides how much of the Journeys suite a pull request's run needs. The merge queue's
// merge_group run always runs the full suite on the exact commit that will land on main, so the
// pull request's run is an early signal, not the gate:
//   - skip: every changed file is on a short list of paths that cannot change what the app renders
//     or how Journeys deploys and drives it. The required `journeys` check still reports passed.
//   - affected: every other changed file is app code (app/, stories/, public/) or a journey spec.
//     The run runs the changed specs, the specs whose names share a word with a changed file, and
//     a smoke set; plus the HX census when app code changed, because its baseline fails on any
//     control change and an author should see that before the queue.
//   - full: anything else (dependencies, config, migrations, scripts, the journeys harness, any
//     unknown path), the `visual` label, too many affected specs, or any doubt.
//
// Run in the Journeys workflow's `changes` job from the base branch's copy of this file, so a pull
// request cannot change the rules for its own run. It reads the pull request's files and labels
// and the head commit's journey specs from GitHub at run time (so adding `visual` and re-running
// the run forces the full suite) and writes `journeys`, `mode`, `census` and `specs` to
// GITHUB_OUTPUT with the reason in the job summary.
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

// A journey spec the affected run can select. The census and the personas setup are not on it:
// the census runs in its own step and the setup runs with every run.
export const SPEC_FILE = /^e2e\/journeys\/(?!hx-census\.)[A-Za-z0-9_-]+(?:\.(?:mobile|desktop))?\.journey\.ts$/;
// App code: a pull request that changes only these (and journey specs) gets the affected run.
export const AFFECTED_PATHS = Object.freeze([/^app\//, /^stories\//, /^public\//]);
// Always part of an affected run: signing in and moving around the app.
export const SMOKE_SPECS = Object.freeze(["e2e/journeys/sign-in.journey.ts", "e2e/journeys/round-trips.journey.ts"]);
// More than this many selected specs runs the full suite instead.
export const MAX_AFFECTED_SPECS = 10;
// Words too common in paths to tie a file to a journey.
const COMMON_WORDS = new Set(["routes", "route", "components", "component", "index", "hooks", "server", "client", "stories", "styles", "utils", "journey", "mobile", "desktop", "public", "images"]);

function words(text) {
  return text.toLowerCase().split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 5 && !COMMON_WORDS.has(word))
    .map((word) => word.replace(/s$/, ""));
}

// The specs whose name shares a word (5+ letters, plural folded) with a changed app file.
export function relatedSpecs(files, specs) {
  const changedWords = new Set(files.filter((file) => AFFECTED_PATHS.some((pattern) => pattern.test(file))).flatMap(words));
  return specs.filter((spec) => words(path.posix.basename(spec, ".journey.ts")).some((word) => changedWords.has(word)));
}

const full = (why) => ({ journeys: true, mode: "full", census: true, specs: [], why });

// Pure decision: { journeys, mode, census, specs, why }. `specs` lists the head commit's journey
// specs, or is null when they could not be read.
export function decide({ files, labels, specs = null }) {
  if (labels.includes(FORCE_LABEL)) return full(`The pull request has the \`${FORCE_LABEL}\` label.`);
  if (files.length === 0) return full("GitHub listed no changed files, so the full suite runs.");
  if (files.length >= MAX_LISTED_FILES) {
    return full(`GitHub lists at most ${MAX_LISTED_FILES} files, so the list may be incomplete and the full suite runs.`);
  }
  const needsRun = files.filter((file) => skippableReason(file) === null);
  if (needsRun.length === 0) {
    return {
      journeys: false,
      mode: "skip",
      census: false,
      specs: [],
      why: `All ${files.length} changed file(s) are documentation, unit tests or other workflows, so this pull request's Journeys run skips the suite. The merge queue still runs it.`,
    };
  }
  const outside = needsRun.filter((file) => !SPEC_FILE.test(file) && !AFFECTED_PATHS.some((pattern) => pattern.test(file)));
  if (outside.length > 0) {
    const shown = outside.slice(0, 10).map((file) => `\`${file}\``).join(", ");
    return full(`${outside.length} changed file(s) are not app code or a journey spec, so the full suite runs, for example ${shown}.`);
  }
  if (!Array.isArray(specs)) return full("The head commit's journey specs could not be listed, so the full suite runs.");
  const available = specs.filter((spec) => SPEC_FILE.test(spec));
  const selected = [...new Set([
    ...needsRun.filter((file) => available.includes(file)),
    ...relatedSpecs(needsRun, available),
    ...SMOKE_SPECS.filter((spec) => available.includes(spec)),
  ])].sort();
  if (selected.length === 0) return full("No journey spec matches the change, so the full suite runs.");
  if (selected.length > MAX_AFFECTED_SPECS) {
    return full(`${selected.length} journey specs are affected (more than ${MAX_AFFECTED_SPECS}), so the full suite runs.`);
  }
  const census = needsRun.some((file) => AFFECTED_PATHS.some((pattern) => pattern.test(file)));
  return {
    journeys: true,
    mode: "affected",
    census,
    specs: selected,
    why: [
      `Only app code or journey specs changed, so this pull request runs ${selected.length} affected journey spec(s)${census ? " and the HX census" : ""}: ${selected.map((spec) => `\`${spec}\``).join(", ")}.`,
      "The merge queue runs the full suite before anything reaches main. Add the `visual` label and re-run to run the full suite here.",
    ].join(" "),
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

// The journey specs in the head commit's e2e/journeys/.
export async function headJourneySpecs(run, repository, sha) {
  const entries = await ghJson(run, ["api", `repos/${repository}/contents/e2e/journeys?ref=${sha}`]);
  if (!Array.isArray(entries) || !entries.every((entry) => entry && typeof entry.path === "string")) {
    throw new Error("The journey spec list is malformed.");
  }
  return entries.map((entry) => entry.path);
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
    const sha = requiredEnv(env, "HEAD_SHA");
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("HEAD_SHA must be a commit SHA.");
    decision = decide({
      files: await pullRequestFiles(run, repository, number),
      labels: await pullRequestLabels(run, repository, number),
      specs: await headJourneySpecs(run, repository, sha),
    });
  } catch (error) {
    decision = full(`Could not read the pull request's files, labels or journey specs (${error instanceof Error ? error.message : String(error)}), so the full suite runs.`);
  }
  appendFile(output, `journeys=${decision.journeys}\n`);
  appendFile(output, `mode=${decision.mode}\n`);
  appendFile(output, `census=${decision.census}\n`);
  appendFile(output, `specs=${decision.specs.join(" ")}\n`);
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
