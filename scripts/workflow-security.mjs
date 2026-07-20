import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const CSP_REPORT_ONLY_BREAK_GLASS_ACK = "ACK_REPORT_ONLY_CSP_ROLLBACK";

const execFileAsync = promisify(execFile);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const WORKER_VERSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDINARY_CI_EVENTS = new Set(["push", "pull_request"]);
const CANONICAL_CI_JOB_NAMES = ["coverage", "e2e", "advisory"];
const REPORT_ONLY_CI_JOB_NAMES = [
  "report-only-coverage",
  "report-only-e2e",
  "report-only-advisory",
];

export async function runWorkflowCommand(file, args) {
  const result = await execFileAsync(file, args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return result.stdout;
}

export function runInheritedWorkflowCommand(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal) {
        reject(new Error(`${file} terminated by ${signal}.`));
      } else if (code !== 0) {
        reject(new Error(`${file} exited with code ${code}.`));
      } else {
        resolve();
      }
    });
  });
}

export async function runProductionDeploy({
  env = process.env,
  run = runInheritedWorkflowCommand,
} = {}) {
  const rollbackVersionId = env.ROLLBACK_VERSION_ID ?? "";
  if (rollbackVersionId && !WORKER_VERSION_PATTERN.test(rollbackVersionId)) {
    throw new Error("ROLLBACK_VERSION_ID must be an exact Worker version UUID.");
  }
  const args = ["run", "deploy:auto"];
  if (rollbackVersionId) {
    args.push("--", "--rollback-version-id", rollbackVersionId);
  }
  await run("pnpm", args);
}

export function sleepMilliseconds(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requiredEnv(env, name) {
  const value = env[name] ?? "";
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function exactSha(value, name) {
  if (!SHA_PATTERN.test(value)) {
    throw new Error(`${name} must be an exact 40-character lowercase Git SHA.`);
  }
  return value;
}

function parseJson(output, label) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${label} did not return valid JSON.`);
  }
}

function matchingRun(output, sourceSha, event, label) {
  const parsed = parseJson(output, label);
  if (!Array.isArray(parsed)) throw new Error(`${label} did not return a run list.`);
  const run = parsed.find((entry) =>
    entry &&
    typeof entry === "object" &&
    Number.isInteger(entry.databaseId) &&
    entry.headSha === sourceSha &&
    entry.event === event
  );
  if (!run) throw new Error(`${label} has no successful ${event} run for ${sourceSha}.`);
  return run.databaseId;
}

function requireSuccessfulJobs(output, requiredJobs, label) {
  const parsed = parseJson(output, label);
  const jobs = parsed && typeof parsed === "object" && Array.isArray(parsed.jobs)
    ? parsed.jobs
    : null;
  if (!jobs) throw new Error(`${label} did not return a job list.`);
  for (const requiredJob of requiredJobs) {
    const matches = jobs.filter((job) =>
      job &&
      typeof job === "object" &&
      job.name === requiredJob &&
      job.conclusion === "success"
    );
    if (matches.length !== 1) {
      throw new Error(`${label} is missing exactly one successful job: ${requiredJob}.`);
    }
  }
}

function validateDispatchAudit(output, sourceSha) {
  const run = parseJson(output, "Authorized CI workflow run");
  if (
    !run ||
    typeof run !== "object" ||
    run.event !== "workflow_dispatch" ||
    run.head_sha !== sourceSha ||
    run.head_branch !== "main" ||
    run.conclusion !== "success" ||
    !run.actor ||
    typeof run.actor !== "object" ||
    typeof run.actor.login !== "string" ||
    run.actor.login === ""
  ) {
    throw new Error("Authorized CI workflow run is not an authenticated successful main-branch dispatch for the exact source SHA.");
  }
}

export async function validateCiInvocation({ env = process.env, run = runWorkflowCommand } = {}) {
  const event = requiredEnv(env, "GITHUB_EVENT_NAME");
  const githubSha = exactSha(requiredEnv(env, "GITHUB_SHA"), "GITHUB_SHA");
  const sourceSha = exactSha(requiredEnv(env, "CI_SOURCE_SHA"), "CI_SOURCE_SHA");
  const acknowledgement = env.SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS ?? "";

  if (ORDINARY_CI_EVENTS.has(event)) {
    if (acknowledgement !== "") {
      throw new Error("Ordinary CI must not receive a CSP report-only break-glass acknowledgement.");
    }
  } else if (event === "workflow_dispatch") {
    if (acknowledgement !== CSP_REPORT_ONLY_BREAK_GLASS_ACK) {
      throw new Error(`Dispatched report-only CI requires ${CSP_REPORT_ONLY_BREAK_GLASS_ACK}.`);
    }
    requiredEnv(env, "GITHUB_ACTOR");
    requiredEnv(env, "GITHUB_REPOSITORY");
    if (!/^\d+$/.test(requiredEnv(env, "GITHUB_RUN_ID"))) {
      throw new Error("GITHUB_RUN_ID must identify the auditable workflow dispatch.");
    }
    if (!/^refs\/heads\/.+/.test(requiredEnv(env, "GITHUB_REF"))) {
      throw new Error("Dispatched report-only CI must run from a branch ref.");
    }
  } else {
    throw new Error(`Unsupported CI event: ${event}.`);
  }

  if (sourceSha !== githubSha) {
    throw new Error("CI_SOURCE_SHA must equal the workflow run's exact GITHUB_SHA.");
  }
  const headSha = (await run("git", ["rev-parse", "HEAD"])).trim();
  if (headSha !== sourceSha) {
    throw new Error("The checked-out CI source does not match CI_SOURCE_SHA.");
  }
}

function validateReleaseInputs(env) {
  const sourceSha = exactSha(requiredEnv(env, "SOURCE_SHA"), "source_sha");
  const rollbackVersionId = env.ROLLBACK_VERSION_ID ?? "";
  if (rollbackVersionId && !WORKER_VERSION_PATTERN.test(rollbackVersionId)) {
    throw new Error("rollback_version_id must be an exact Worker version UUID.");
  }
  const acknowledgement = env.SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS ?? "";
  if (acknowledgement && acknowledgement !== CSP_REPORT_ONLY_BREAK_GLASS_ACK) {
    throw new Error(`csp_report_only_break_glass must be ${CSP_REPORT_ONLY_BREAK_GLASS_ACK}.`);
  }
  if (requiredEnv(env, "GITHUB_REF") !== "refs/heads/main") {
    throw new Error("Production release validation must run from refs/heads/main.");
  }
  requiredEnv(env, "GITHUB_ACTOR");
  requiredEnv(env, "GITHUB_REPOSITORY");
  if (!/^\d+$/.test(requiredEnv(env, "GITHUB_RUN_ID"))) {
    throw new Error("GITHUB_RUN_ID must identify the production workflow run.");
  }
  return { acknowledgement, rollbackVersionId, sourceSha };
}

function validateReleaseEvent(env, release, headSha, originMainSha) {
  const event = requiredEnv(env, "GITHUB_EVENT_NAME");
  if (event === "workflow_run") {
    if (
      release.rollbackVersionId !== "" ||
      release.acknowledgement !== "" ||
      env.WORKFLOW_RUN_CONCLUSION !== "success" ||
      env.WORKFLOW_RUN_EVENT !== "push" ||
      env.WORKFLOW_RUN_HEAD_BRANCH !== "main" ||
      env.WORKFLOW_RUN_HEAD_SHA !== release.sourceSha ||
      env.WORKFLOW_RUN_PATH !== ".github/workflows/ci.yml" ||
      headSha !== release.sourceSha ||
      originMainSha !== release.sourceSha
    ) {
      throw new Error("Automatic production release is not bound to the successful canonical main CI SHA.");
    }
    return;
  }
  if (event !== "workflow_dispatch") {
    throw new Error(`Unsupported production release event: ${event}.`);
  }
  if (headSha !== originMainSha) {
    throw new Error("Protected production workflow tooling must match current origin/main.");
  }
  if (!release.rollbackVersionId && headSha !== release.sourceSha) {
    throw new Error("A normal production dispatch must check out the exact source SHA on main.");
  }
}

async function findStorybookRun({ run, sleep, sourceSha, attempts }) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const output = await run("gh", [
      "run", "list",
      "--workflow", ".github/workflows/storybook.yml",
      "--branch", "main",
      "--commit", sourceSha,
      "--event", "push",
      "--status", "success",
      "--limit", "100",
      "--json", "databaseId,headSha,event",
    ]);
    try {
      return matchingRun(output, sourceSha, "push", "Canonical Storybook workflow");
    } catch (error) {
      if (attempt === attempts) throw error;
      await sleep(10_000);
    }
  }
  throw new Error("Canonical Storybook workflow lookup exhausted unexpectedly.");
}

export async function validateProductionDeploySource({
  env = process.env,
  run = runWorkflowCommand,
  sleep = sleepMilliseconds,
  storybookAttempts = 30,
} = {}) {
  const release = validateReleaseInputs(env);
  await run("git", ["fetch", "--no-tags", "origin", "main:refs/remotes/origin/main"]);
  await run("git", ["merge-base", "--is-ancestor", release.sourceSha, "origin/main"]);
  const originMainSha = (await run("git", ["rev-parse", "origin/main"])).trim();
  const headSha = (await run("git", ["rev-parse", "HEAD"])).trim();
  validateReleaseEvent(env, release, headSha, originMainSha);

  const requiresAuthorizedDispatch =
    release.rollbackVersionId === "" &&
    release.acknowledgement === CSP_REPORT_ONLY_BREAK_GLASS_ACK;
  const ciEvent = requiresAuthorizedDispatch ? "workflow_dispatch" : "push";
  const ciRuns = await run("gh", [
    "run", "list",
    "--workflow", ".github/workflows/ci.yml",
    "--branch", "main",
    "--commit", release.sourceSha,
    "--event", ciEvent,
    "--status", "success",
    "--limit", "100",
    "--json", "databaseId,headSha,event",
  ]);
  const ciRunId = matchingRun(ciRuns, release.sourceSha, ciEvent, "Canonical CI workflow");
  if (requiresAuthorizedDispatch) {
    const repository = requiredEnv(env, "GITHUB_REPOSITORY");
    validateDispatchAudit(
      await run("gh", ["api", `repos/${repository}/actions/runs/${ciRunId}`]),
      release.sourceSha,
    );
  }
  requireSuccessfulJobs(
    await run("gh", ["run", "view", String(ciRunId), "--json", "jobs"]),
    requiresAuthorizedDispatch ? REPORT_ONLY_CI_JOB_NAMES : CANONICAL_CI_JOB_NAMES,
    `${requiresAuthorizedDispatch ? "Report-only" : "Canonical"} CI run ${ciRunId}`,
  );

  const storybookRunId = await findStorybookRun({
    run,
    sleep,
    sourceSha: release.sourceSha,
    attempts: storybookAttempts,
  });
  requireSuccessfulJobs(
    await run("gh", ["run", "view", String(storybookRunId), "--json", "jobs"]),
    ["build-storybook"],
    `Canonical Storybook run ${storybookRunId}`,
  );
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  if (argv.length !== 1) throw new Error("workflow-security requires exactly one validation mode.");
  if (argv[0] === "validate-ci-invocation") {
    await validateCiInvocation(deps);
    return;
  }
  if (argv[0] === "validate-production-deploy-source") {
    await validateProductionDeploySource(deps);
    return;
  }
  if (argv[0] === "run-production-deploy") {
    await runProductionDeploy(deps);
    return;
  }
  throw new Error(`Unknown workflow-security validation mode: ${argv[0]}.`);
}

export function isCliEntry(argv1, moduleUrl) {
  if (!argv1) return false;
  return path.resolve(argv1) === fileURLToPath(moduleUrl);
}

export function runCliIfEntry({ argv1, moduleUrl, runMain = main, onError } = {}) {
  if (!isCliEntry(argv1, moduleUrl)) return false;
  const handleError = onError ?? ((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
  runMain().catch(handleError);
  return true;
}

runCliIfEntry({ argv1: process.argv[1], moduleUrl: import.meta.url });
