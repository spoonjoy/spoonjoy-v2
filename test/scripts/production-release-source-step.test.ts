import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Runs the Production Deploy workflow's real "Validate release source" shell against a scratch
// repository, so a refusal is proven to name its reason in the job log (run 37936356295 ended with
// only "Process completed with exit code 1").
const workflow = parse(readFileSync(".github/workflows/production-deploy.yml", "utf8"));
const step = workflow.jobs.deploy.steps.find((candidate: { name?: string }) => candidate.name === "Validate release source");

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  }).trim();
}

// Each case starts git and bash, which is slow on a loaded machine.
const STEP_TIMEOUT = 60_000;

function releaseCheckout() {
  const root = mkdtempSync(path.join(tmpdir(), "spoonjoy-release-step-"));
  const origin = path.join(root, "origin");
  git(root, "init", "-q", "-b", "main", origin);
  git(origin, "commit", "-q", "--allow-empty", "-m", "release");
  const checkout = path.join(root, "checkout");
  git(root, "clone", "-q", origin, checkout);
  const script = path.join(root, "validate.sh");
  writeFileSync(script, step.run);
  return { checkout, script, sha: git(checkout, "rev-parse", "HEAD") };
}

let shared: ReturnType<typeof releaseCheckout> | undefined;

function runStep(overrides: Record<string, string>) {
  // One scratch repository serves every case: the step only reads it and fetches from its origin.
  shared ??= releaseCheckout();
  const { checkout, script, sha } = shared;
  return spawnSync("bash", ["--noprofile", "--norc", "-e", script], {
    cwd: checkout,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      SOURCE_SHA: sha,
      ROLLBACK_VERSION_ID: "",
      SPOONJOY_RELEASE_MODE: "atomic-product-activation",
      SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA: "",
      GITHUB_EVENT_NAME: "workflow_run",
      WORKFLOW_RUN_CONCLUSION: "success",
      WORKFLOW_RUN_EVENT: "push",
      WORKFLOW_RUN_HEAD_BRANCH: "main",
      WORKFLOW_RUN_HEAD_SHA: sha,
      WORKFLOW_RUN_PATH: ".github/workflows/ci.yml",
      ...overrides,
    },
  });
}

describe("Production Deploy's release-source validation step", () => {
  it.each([
    ["the triggering CI run did not succeed", { WORKFLOW_RUN_CONCLUSION: "failure" }, 'test "$WORKFLOW_RUN_CONCLUSION" = "success"'],
    ["the triggering run was not a push", { WORKFLOW_RUN_EVENT: "pull_request" }, 'test "$WORKFLOW_RUN_EVENT" = "push"'],
    ["the triggering run was not on main", { WORKFLOW_RUN_HEAD_BRANCH: "feature" }, 'test "$WORKFLOW_RUN_HEAD_BRANCH" = "main"'],
  ])("names the failed check in the log when %s", (_name, overrides, check) => {
    const result = runStep(overrides);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`::error title=Release source refused::Check failed: ${check}`);
  }, STEP_TIMEOUT);

  it.each([
    ["the triggering run is another workflow", { WORKFLOW_RUN_PATH: ".github/workflows/storybook.yml" }, "The triggering run came from .github/workflows/storybook.yml, not .github/workflows/ci.yml"],
    ["the release mode is unknown", { SPOONJOY_RELEASE_MODE: "yolo" }, "Unknown SPOONJOY_RELEASE_MODE: yolo"],
  ])("explains the refusal when %s", (_name, overrides, message) => {
    const result = runStep(overrides);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`::error title=Release source refused::${message}`);
  }, STEP_TIMEOUT);

  it("keeps its own message for a malformed source SHA", () => {
    const result = runStep({ SOURCE_SHA: "main" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("source_sha must be an exact 40-character lowercase Git SHA");
  }, STEP_TIMEOUT);
});
