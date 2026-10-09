import { execFile, spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const CSP_REPORT_ONLY_BREAK_GLASS_ACK = "ACK_REPORT_ONLY_CSP_ROLLBACK";

const execFileAsync = promisify(execFile);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const WORKER_VERSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// merge_group: a merge-queue run tests the exact commit that will land on main.
const ORDINARY_CI_EVENTS = new Set(["push", "pull_request", "merge_group"]);
const CANONICAL_CI_JOB_NAMES = ["coverage", "workers-coverage", "e2e", "advisory"];
const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
const STORYBOOK_WORKFLOW_PATH = ".github/workflows/storybook.yml";
const JOURNEYS_WORKFLOW_PATH = ".github/workflows/journeys.yml";
// The merge queue tests each group on a branch GitHub names gh-readonly-queue/main/pr-<n>-<sha>,
// and the commit it tests is the commit that lands on main.
const MERGE_QUEUE_BRANCH_PATTERN = /^gh-readonly-queue\/main\/pr-\d+-[0-9a-f]{40}$/;
// What each workflow's push run on main may skip, because the merge queue already ran it.
export const QUEUE_TESTED_MODES = Object.freeze({
  "queue-tested-ci": Object.freeze({ workflowPath: CI_WORKFLOW_PATH, jobs: CANONICAL_CI_JOB_NAMES }),
  "queue-tested-journeys": Object.freeze({ workflowPath: JOURNEYS_WORKFLOW_PATH, jobs: ["journeys"] }),
});
const REPORT_ONLY_CI_JOB_NAMES = [
  "report-only-coverage",
  "report-only-workers-coverage",
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

// An automatic release ships the release-target job's choice: the newest main commit with green
// canonical CI (a push run, or the merge queue's run of that same commit), which is the triggering
// commit or a descendant of it on main. Main moving on while the deploy waited for a runner no
// longer refuses the release; the chosen commit's own CI and Storybook evidence is still checked
// below.
function validateReleaseEvent(env, release, headSha, originMainSha, triggerIsAncestor) {
  const event = requiredEnv(env, "GITHUB_EVENT_NAME");
  if (event === "workflow_run") {
    if (
      release.rollbackVersionId !== "" ||
      release.acknowledgement !== "" ||
      env.WORKFLOW_RUN_CONCLUSION !== "success" ||
      env.WORKFLOW_RUN_EVENT !== "push" ||
      env.WORKFLOW_RUN_HEAD_BRANCH !== "main" ||
      !SHA_PATTERN.test(env.WORKFLOW_RUN_HEAD_SHA) ||
      !triggerIsAncestor ||
      env.WORKFLOW_RUN_PATH !== ".github/workflows/ci.yml" ||
      headSha !== release.sourceSha
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

function hasSuccessfulJobs(output, requiredJobs, label) {
  try {
    requireSuccessfulJobs(output, requiredJobs, label);
    return true;
  } catch {
    return false;
  }
}

// Push runs of a workflow on main for this exact commit that GitHub reports successful.
async function pushRunIds(run, workflowPath, sha) {
  const parsed = parseJson(await run("gh", [
    "run", "list",
    "--workflow", workflowPath,
    "--branch", "main",
    "--commit", sha,
    "--event", "push",
    "--status", "success",
    "--limit", "100",
    "--json", "databaseId,headSha,event",
  ]), `${workflowPath} push runs`);
  if (!Array.isArray(parsed)) throw new Error(`${workflowPath} push runs did not return a run list.`);
  return parsed
    .filter((entry) =>
      entry &&
      typeof entry === "object" &&
      Number.isInteger(entry.databaseId) &&
      entry.headSha === sha &&
      entry.event === "push")
    .map((entry) => entry.databaseId);
}

// Merge-queue runs of a workflow for this exact commit: completed and successful, of the workflow
// file at this path, in this repository, from this repository (never a fork's), on a queue branch
// for main. The queue tests the commit that then lands on main, running the workflow file from
// that commit, exactly as a push run does.
export async function mergeQueueRunIds(run, repository, workflowPath, sha) {
  const workflowFile = workflowPath.slice(".github/workflows/".length);
  const parsed = parseJson(await run("gh", [
    "api", "--method", "GET",
    `repos/${repository}/actions/workflows/${workflowFile}/runs`,
    "-f", "event=merge_group",
    "-f", `head_sha=${sha}`,
    "-f", "status=success",
    "-f", "per_page=100",
  ]), `${workflowPath} merge-queue runs`);
  const runs = parsed && typeof parsed === "object" && Array.isArray(parsed.workflow_runs)
    ? parsed.workflow_runs
    : null;
  if (!runs) throw new Error(`${workflowPath} merge-queue runs did not return a run list.`);
  return runs
    .filter((entry) =>
      entry &&
      typeof entry === "object" &&
      Number.isInteger(entry.id) &&
      entry.event === "merge_group" &&
      entry.head_sha === sha &&
      entry.status === "completed" &&
      entry.conclusion === "success" &&
      entry.path === workflowPath &&
      entry.repository?.full_name === repository &&
      entry.head_repository?.full_name === repository &&
      typeof entry.head_branch === "string" &&
      MERGE_QUEUE_BRANCH_PATTERN.test(entry.head_branch))
    .map((entry) => entry.id);
}

async function firstRunWithJobs(run, runIds, jobs, label) {
  for (const runId of runIds) {
    if (hasSuccessfulJobs(await run("gh", ["run", "view", String(runId), "--json", "jobs"]), jobs, `${label} ${runId}`)) {
      return runId;
    }
  }
  return null;
}

// The run that proves this commit passed a workflow's required jobs: a push run on main, or a
// merge-queue run of the same commit, in which every named job succeeded exactly once. A push run
// whose jobs skipped because the queue already ran them is not evidence; the queue's run is.
export async function findEvidenceRun({ run, repository, workflowPath, sha, jobs, label }) {
  const pushRun = await firstRunWithJobs(run, await pushRunIds(run, workflowPath, sha), jobs, label);
  if (pushRun !== null) return { runId: pushRun, event: "push" };
  const queueRun = await firstRunWithJobs(
    run,
    await mergeQueueRunIds(run, repository, workflowPath, sha),
    jobs,
    label,
  );
  if (queueRun !== null) return { runId: queueRun, event: "merge_group" };
  return null;
}

async function findStorybookRun({ run, sleep, repository, sourceSha, attempts }) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const evidence = await findEvidenceRun({
      run,
      repository,
      workflowPath: STORYBOOK_WORKFLOW_PATH,
      sha: sourceSha,
      jobs: ["build-storybook"],
      label: "Canonical Storybook run",
    });
    if (evidence) return evidence;
    if (attempt === attempts) {
      throw new Error(`Canonical Storybook workflow has no successful push or merge-queue run with build-storybook for ${sourceSha}.`);
    }
    await sleep(10_000);
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
  const triggerIsAncestor = await isAncestor(run, env.WORKFLOW_RUN_HEAD_SHA, release.sourceSha);
  validateReleaseEvent(env, release, headSha, originMainSha, triggerIsAncestor);

  const requiresAuthorizedDispatch =
    release.rollbackVersionId === "" &&
    release.acknowledgement === CSP_REPORT_ONLY_BREAK_GLASS_ACK;
  const repository = requiredEnv(env, "GITHUB_REPOSITORY");
  if (requiresAuthorizedDispatch) {
    const ciRuns = await run("gh", [
      "run", "list",
      "--workflow", CI_WORKFLOW_PATH,
      "--branch", "main",
      "--commit", release.sourceSha,
      "--event", "workflow_dispatch",
      "--status", "success",
      "--limit", "100",
      "--json", "databaseId,headSha,event",
    ]);
    const ciRunId = matchingRun(ciRuns, release.sourceSha, "workflow_dispatch", "Canonical CI workflow");
    validateDispatchAudit(
      await run("gh", ["api", `repos/${repository}/actions/runs/${ciRunId}`]),
      release.sourceSha,
    );
    requireSuccessfulJobs(
      await run("gh", ["run", "view", String(ciRunId), "--json", "jobs"]),
      REPORT_ONLY_CI_JOB_NAMES,
      `Report-only CI run ${ciRunId}`,
    );
  } else if (!await findEvidenceRun({
    run,
    repository,
    workflowPath: CI_WORKFLOW_PATH,
    sha: release.sourceSha,
    jobs: CANONICAL_CI_JOB_NAMES,
    label: "Canonical CI run",
  })) {
    throw new Error(`Canonical CI workflow has no successful push or merge-queue run with every canonical job (${CANONICAL_CI_JOB_NAMES.join(", ")}) for ${release.sourceSha}.`);
  }

  await findStorybookRun({
    run,
    sleep,
    repository,
    sourceSha: release.sourceSha,
    attempts: storybookAttempts,
  });
}

async function isAncestor(run, ancestor, descendant) {
  if (!SHA_PATTERN.test(ancestor)) return false;
  try {
    await run("git", ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

// Whether this exact commit passed canonical CI, by the same rule the deploy validates. Asked per
// commit, newest first, so no window of recent runs can hide a newer green commit and let
// production move backwards.
async function hasCanonicalCi(run, repository, sha) {
  return await findEvidenceRun({
    run,
    repository,
    workflowPath: CI_WORKFLOW_PATH,
    sha,
    jobs: CANONICAL_CI_JOB_NAMES,
    label: "Canonical CI run",
  }) !== null;
}

const PRODUCTION_DEPLOY_WORKFLOW_FILE = "production-deploy.yml";
const RELEASE_ARTIFACT_NAME = "mcp-oauth-canary-artifacts";
const RELEASE_ARTIFACT_FILE = "production-release.json";
const RELEASED_RUN_LOOKBACK = 10;

// The commit production runs, as the newest successful Production Deploy run that recorded a
// release says: its release artifact must show the release promoted and complete. A successful run
// with no artifact (one that was superseded, so its deploy job skipped) is passed over. Anything
// else, including a rollback or any lookup error, gives null, and the caller releases as usual.
export async function latestPromotedSha({
  run,
  repository,
  readFile = (file) => readFileSync(file, "utf8"),
  makeTempDir = () => mkdtempSync(path.join(tmpdir(), "spoonjoy-release-")),
}) {
  try {
    const runs = parseJson(await run("gh", [
      "run", "list",
      "--repo", repository,
      "--workflow", PRODUCTION_DEPLOY_WORKFLOW_FILE,
      "--branch", "main",
      "--status", "success",
      "--limit", String(RELEASED_RUN_LOOKBACK),
      "--json", "databaseId",
    ]), "gh run list");
    if (!Array.isArray(runs)) return null;
    for (const entry of runs) {
      if (!Number.isSafeInteger(entry?.databaseId)) return null;
      const directory = makeTempDir();
      try {
        await run("gh", [
          "run", "download", String(entry.databaseId),
          "--repo", repository,
          "--name", RELEASE_ARTIFACT_NAME,
          "--dir", directory,
        ]);
      } catch {
        continue;
      }
      const artifact = parseJson(readFile(path.join(directory, RELEASE_ARTIFACT_FILE)), "The release artifact");
      return artifact?.status === "promoted" && artifact.phase === "complete" && SHA_PATTERN.test(artifact.sourceSha)
        ? artifact.sourceSha
        : null;
    }
    return null;
  } catch {
    return null;
  }
}

// Chooses what this Production Deploy run releases. A dispatch releases exactly its input. A
// workflow_run releases the newest main commit, from the tip back to the commit whose CI triggered
// it, that has green canonical CI (findEvidenceRun). A deploy that waited while main moved ships the
// newest tested commit instead of refusing, and a pending deploy that GitHub replaced loses nothing.
// This choice alone does not stop production moving backwards: if a newer commit's evidence is
// briefly missing (its CI is being re-run), an older commit can be chosen. The deploy step refuses
// any release that is not a descendant of the commit production runs. Any doubt fails closed.
export async function chooseReleaseTarget({
  env = process.env,
  run = runWorkflowCommand,
  appendFile = appendFileSync,
  log = (message) => process.stdout.write(`${message}\n`),
  promotedSha = latestPromotedSha,
} = {}) {
  const event = requiredEnv(env, "GITHUB_EVENT_NAME");
  const requested = exactSha(requiredEnv(env, "SOURCE_SHA"), "SOURCE_SHA");
  const output = requiredEnv(env, "GITHUB_OUTPUT");
  const summary = requiredEnv(env, "GITHUB_STEP_SUMMARY");
  let target = requested;
  let release = true;
  let reason = "Manual dispatch: releasing the requested commit.";

  if (event === "workflow_run") {
    const repository = requiredEnv(env, "GITHUB_REPOSITORY");
    await run("git", ["fetch", "--no-tags", "origin", "main:refs/remotes/origin/main"]);
    if (!await isAncestor(run, requested, "origin/main")) {
      throw new Error(`Triggering commit ${requested} is not on main; refusing to choose a release.`);
    }
    const newer = (await run("git", ["rev-list", "--first-parent", "--ancestry-path", `${requested}..origin/main`]))
      .split("\n").map((line) => line.trim()).filter(Boolean);
    if (newer.some((sha) => !SHA_PATTERN.test(sha))) throw new Error("git rev-list returned a malformed commit.");
    let chosen;
    for (const sha of [...newer, requested]) {
      if (await hasCanonicalCi(run, repository, sha)) {
        chosen = sha;
        break;
      }
    }
    if (!chosen) {
      throw new Error(`No commit from ${requested} to main's tip has green canonical CI; refusing to deploy.`);
    }
    target = chosen;
    reason = chosen === requested
      ? newer.length === 0
        ? "The triggering commit is main's tip."
        : `The triggering commit is the newest green main commit; ${newer.length} newer commit(s) have no green canonical CI yet.`
      : `Main moved on; ${chosen} is the newest main commit with green canonical CI, so this run releases it instead.`;
    // Superseded is not a failure: when production already runs this commit or a newer one, an
    // earlier deploy got there first, so this run releases nothing and stays green.
    const released = await promotedSha({ run, repository });
    if (released && (released === target || await isAncestor(run, target, released))) {
      release = false;
      reason = `Superseded: production already runs ${released}, which includes ${target}, so this run releases nothing.`;
      log(`::notice title=Release superseded::${reason}`);
    }
  } else if (event !== "workflow_dispatch") {
    throw new Error(`Unsupported production release event: ${event}.`);
  }

  appendFile(output, `source_sha=${target}\n`);
  appendFile(output, `release=${release}\n`);
  appendFile(summary, [
    "### Release target",
    "",
    `- Requested commit: \`${requested}\``,
    release ? `- Releasing: \`${target}\`` : `- Releasing: nothing (\`${target}\` is already in production)`,
    `- Why: ${reason}`,
    "",
  ].join("\n"));
  return target;
}

// For a push to main, reports whether the merge queue already ran this workflow's named jobs on
// this exact commit (tested=true), so the push run can skip repeating them. Anything else reports
// tested=false and the push run does the full work: a push that bypassed the queue, a missing,
// failed or partly skipped queue run, a run from another repository, or any lookup error.
export async function reportQueueTested({
  mode,
  env = process.env,
  run = runWorkflowCommand,
  appendFile = appendFileSync,
} = {}) {
  const spec = QUEUE_TESTED_MODES[mode];
  if (!spec) throw new Error(`Unknown queue-tested mode: ${mode}.`);
  const output = requiredEnv(env, "GITHUB_OUTPUT");
  const summary = requiredEnv(env, "GITHUB_STEP_SUMMARY");
  let tested = false;
  let why;
  try {
    if (env.GITHUB_EVENT_NAME !== "push" || env.GITHUB_REF !== "refs/heads/main") {
      why = "This is not a push to main, so the full jobs run.";
    } else {
      const sha = exactSha(requiredEnv(env, "GITHUB_SHA"), "GITHUB_SHA");
      const repository = requiredEnv(env, "GITHUB_REPOSITORY");
      const runId = await firstRunWithJobs(
        run,
        await mergeQueueRunIds(run, repository, spec.workflowPath, sha),
        spec.jobs,
        "Merge-queue run",
      );
      if (runId === null) {
        why = `No successful merge-queue run of ${spec.workflowPath} passed ${spec.jobs.join(", ")} on ${sha}, so the full jobs run.`;
      } else {
        tested = true;
        why = `Merge-queue run ${runId} already passed ${spec.jobs.join(", ")} on ${sha}, so this push skips them.`;
      }
    }
  } catch (error) {
    tested = false;
    why = `The merge-queue lookup failed (${error instanceof Error ? error.message : String(error)}), so the full jobs run.`;
  }
  appendFile(output, `tested=${tested}\n`);
  appendFile(summary, ["### Merge-queue result", "", why, ""].join("\n"));
  return tested;
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
  if (argv[0] === "choose-release-target") {
    await chooseReleaseTarget(deps);
    return;
  }
  if (Object.hasOwn(QUEUE_TESTED_MODES, argv[0])) {
    await reportQueueTested({ ...deps, mode: argv[0] });
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
