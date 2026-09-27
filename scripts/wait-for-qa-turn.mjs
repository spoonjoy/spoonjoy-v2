#!/usr/bin/env node
// Waits until it is this Journeys run's turn on the single-tenant QA mirror.
//
// Why not a `concurrency` group: GitHub keeps one running and one pending run per group and
// cancels the older pending run whenever a newer one queues, so with three or more branches
// pushing, runs were silently cancelled. This is an explicit first-in, first-out queue instead.
//
// Queue order: every active Journeys run (status queued, in_progress, waiting, requested or
// pending) is ordered by the start time of its current attempt (`run_started_at`, falling back
// to `created_at` for a run that has not started), then by run id. A re-run keeps its old id but
// gets a new `run_started_at`, so a re-run joins the back of the queue. This run waits only for
// runs strictly ahead of it in that order, so the run at the front never waits and two runs can
// never wait on each other. Runs behind it (including ones already waiting on this run) are
// ignored.
//
// Failure handling: a GitHub server error or network failure is retried on the next poll; a
// client error (for example a missing `actions: read` permission) fails at once. Once the
// maximum wait is used up, the step fails with the runs still ahead, and never proceeds without
// confirming its turn.
//
// Limit: one request per poll lists the 100 most recent Journeys runs. An active run older than
// the newest 100 runs would be missed; with runs serialised on QA that does not happen.
//
// Environment (set by GitHub Actions): GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID and,
// optionally, GITHUB_API_URL.
import { pathToFileURL } from "node:url";

export const WORKFLOW_FILE = "journeys.yml";
export const ACTIVE_RUN_STATUSES = ["queued", "in_progress", "waiting", "requested", "pending"];
export const DEFAULT_POLL_MS = 30_000;
export const DEFAULT_MAX_WAIT_MS = 90 * 60_000;

class GitHubApiError extends Error {
  constructor(status) {
    super(`GitHub API returned ${status}`);
    this.status = status;
  }
}

export function queueKey(run) {
  const startedAt = Date.parse(run.run_started_at ?? run.created_at ?? "");
  if (Number.isNaN(startedAt)) throw new Error(`Workflow run ${run.id} has no start or creation time.`);
  return { id: run.id, startedAt };
}

export function isAheadInQueue(candidate, self) {
  return candidate.startedAt < self.startedAt || (candidate.startedAt === self.startedAt && candidate.id < self.id);
}

function describeRun(run) {
  const details = [run.status, run.event && run.head_branch ? `${run.event} on ${run.head_branch}` : null, run.html_url]
    .filter(Boolean)
    .join(", ");
  return `${run.id} (${details})`;
}

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required to find this run's turn on QA.`);
  return value;
}

function minutes(ms) {
  return Math.round(ms / 60_000);
}

export async function waitForQaTurn({
  env,
  fetch,
  sleep,
  now,
  log,
  pollMs = DEFAULT_POLL_MS,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
}) {
  const token = required(env, "GITHUB_TOKEN");
  const repository = required(env, "GITHUB_REPOSITORY");
  const runId = Number(required(env, "GITHUB_RUN_ID"));
  const apiUrl = env.GITHUB_API_URL || "https://api.github.com";
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "spoonjoy-wait-for-qa-turn",
  };

  async function getJson(path) {
    const response = await fetch(`${apiUrl}/repos/${repository}${path}`, { headers });
    if (!response.ok) throw new GitHubApiError(response.status);
    return response.json();
  }

  let self;
  try {
    self = queueKey(await getJson(`/actions/runs/${runId}`));
  } catch (error) {
    throw new Error(`Could not read this workflow run (${runId}): ${error.message}.`);
  }

  const startedWaiting = now();
  for (;;) {
    const waited = now() - startedWaiting;
    let ahead = null;
    let failure = null;
    try {
      const listing = await getJson(`/actions/workflows/${WORKFLOW_FILE}/runs?per_page=100`);
      ahead = (listing.workflow_runs ?? []).filter(
        (run) => run.id !== runId && ACTIVE_RUN_STATUSES.includes(run.status) && isAheadInQueue(queueKey(run), self),
      );
    } catch (error) {
      if (error instanceof GitHubApiError && error.status < 500) {
        throw new Error(`Could not list Journeys runs: ${error.message}. The job needs the actions: read permission.`);
      }
      failure = error.message;
    }

    if (ahead && ahead.length === 0) {
      log(`No Journeys run is ahead of run ${runId} on QA; starting now.`);
      return { waitedMs: waited };
    }

    if (waited >= maxWaitMs) {
      if (ahead) {
        throw new Error(
          `Run ${runId} waited ${minutes(waited)} min for QA and ${ahead.length} Journeys run(s) are still ahead of it: ` +
            `${ahead.map(describeRun).join("; ")}. Cancel or finish the runs ahead, then re-run this one.`,
        );
      }
      throw new Error(
        `Run ${runId} waited ${minutes(waited)} min for QA and could not confirm its turn: the GitHub API kept failing (${failure}).`,
      );
    }

    log(
      ahead
        ? `Waiting for ${ahead.length} Journeys run(s) ahead of run ${runId} on QA: ${ahead.map(describeRun).join("; ")}`
        : `Could not list Journeys runs (${failure}); retrying.`,
    );
    await sleep(pollMs);
  }
}

export function main({
  env = process.env,
  fetch = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  log = console.log,
  pollMs,
  maxWaitMs,
} = {}) {
  return waitForQaTurn({ env, fetch, sleep, now, log, pollMs, maxWaitMs });
}

export function isCliEntry(moduleUrl, argv1 = process.argv[1]) {
  return typeof argv1 === "string" && moduleUrl === pathToFileURL(argv1).href;
}

export function defaultCliErrorHandler(error, io = console) {
  io.error(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

export async function runCliIfEntry({
  moduleUrl = import.meta.url,
  argv1 = process.argv[1],
  runMain = main,
  onError = defaultCliErrorHandler,
} = {}) {
  if (!isCliEntry(moduleUrl, argv1)) return false;
  try {
    await runMain();
  } catch (error) {
    onError(error);
  }
  return true;
}

await runCliIfEntry();
