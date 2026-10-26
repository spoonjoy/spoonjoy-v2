// node scripts/claims-pr.mjs (`pnpm run claims:pr`)
//
// The claims checks a pull request runs in CI's unit-changed job, with HX's checker
// (app/lib/ouro/claims-check.mjs, from lib-claims). The base is the merge commit's first parent,
// read from the checkout as for the source rule's ratchet, and the title and body come from the
// pull_request event GitHub writes to GITHUB_EVENT_PATH, so the workflow passes nothing in.
//
//   1. ratchet               an exemption claims.config.json adds must have a reason and be named
//                            in the pull request's description
//   2. lint --pr             the title and body: each factual sentence carries its source
//   3. check --network=changed
//                            every surface, every claim's check, and the addresses the pull
//                            request adds to the URL cache fetched again
//
// All three run, and the command fails when any of them does.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CHECKER = "app/lib/ouro/claims-check.mjs";
export const STEPS = [["ratchet"], ["lint", "--pr"], ["check", "--network=changed"]];

/** The pull request's title and body from a pull_request event; throws for any other event. */
export function pullRequestText(event) {
  const pullRequest = event?.pull_request;
  if (!pullRequest) throw new Error("claims-pr: GITHUB_EVENT_PATH holds no pull_request event.");
  return { title: pullRequest.title ?? "", body: pullRequest.body ?? "" };
}

export const defaultDeps = {
  env: process.env,
  readFile: (file) => readFileSync(file, "utf8"),
  run: (command, args, options) => spawnSync(command, args, { stdio: "inherit", ...options }),
  revParse: () => spawnSync("git", ["rev-parse", "HEAD^1"], { encoding: "utf8" }),
  io: console,
};

export function main(deps) {
  const { env, readFile, run, revParse, io } = { ...defaultDeps, ...deps };
  if (!env.GITHUB_EVENT_PATH) {
    io.error("claims-pr: GITHUB_EVENT_PATH is not set; run it in a pull_request workflow.");
    return 2;
  }
  const { title, body } = pullRequestText(JSON.parse(readFile(env.GITHUB_EVENT_PATH)));
  const parent = revParse();
  if (parent.status !== 0) {
    io.error(`claims-pr: cannot read the base commit (HEAD^1): ${parent.stderr ?? ""}`.trim());
    return 2;
  }
  const childEnv = { ...env, CLAIMS_BASE_REF: parent.stdout.trim(), PR_TITLE: title, PR_BODY: body };
  let failed = 0;
  for (const step of STEPS) {
    const result = run(process.execPath, [CHECKER, ...step], { env: childEnv });
    if (result.status !== 0) failed += 1;
  }
  return failed === 0 ? 0 : 1;
}

export function isCliEntry(moduleUrl, argv1 = process.argv[1]) {
  return typeof argv1 === "string" && moduleUrl === pathToFileURL(argv1).href;
}

export function runCliIfEntry({ moduleUrl = import.meta.url, argv1 = process.argv[1], runMain = () => main({}) } = {}) {
  if (!isCliEntry(moduleUrl, argv1)) return false;
  process.exitCode = runMain();
  return true;
}

runCliIfEntry();
