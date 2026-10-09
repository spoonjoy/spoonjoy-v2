#!/usr/bin/env node
// Waits until it is this Journeys run's turn on the single-tenant QA mirror.
//
// Why not a `concurrency` group: GitHub keeps one running and one pending run per group and
// cancels the older pending run whenever a newer one queues, so with three or more branches
// pushing, runs were silently cancelled. This is an explicit first-in, first-out queue instead.
//
// Who is in the queue: only this repository's own Journeys runs (`head_repository` equal to
// GITHUB_REPOSITORY) that are `queued` or `in_progress`. Fork pull request runs never deploy to
// QA (their qa-turn and journeys jobs are skipped), so they are ignored, and this script refuses
// to run for one. Both status lists are paginated, so an active run cannot fall out of view.
//
// Queue order: runs are ordered by the start time of their current attempt (`run_started_at`,
// falling back to `created_at` for a run that has not started), then by run id. A re-run keeps
// its old id but gets a new `run_started_at`, so a re-run joins the back of the queue.
//
// When this run may start: when no run is ahead of it in that order, and no run behind it
// already holds QA. A run holds QA once its "wait for QA" job has succeeded; it keeps QA until
// the run completes. The holder check covers a run that was pending on its pull request's
// concurrency group and shows up late with an early start time. The run at the front never
// waits on runs behind it unless one of them holds QA, so no two runs wait on each other.
//
// Failure handling: a GitHub server error or network failure is retried on the next poll; a
// client error (for example a missing `actions: read` permission) fails at once. Once the
// maximum wait is used up, the step fails, naming the runs it was waiting for, and never
// proceeds without confirming its turn.
//
// API budget: two list requests per poll (more only past 100 active runs per status), plus one
// jobs request per active run behind this one when nothing is ahead, polled every 60 s.
//
// Environment (set by GitHub Actions): GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID and,
// optionally, GITHUB_API_URL.
import { pathToFileURL } from "node:url";

export const WORKFLOW_FILE = "journeys.yml";
export const LISTED_RUN_STATUSES = ["queued", "in_progress"];
export const QA_TURN_JOB_NAME = "wait for QA";
export const DEFAULT_POLL_MS = 60_000;
export const DEFAULT_MAX_WAIT_MS = 330 * 60_000;
export const PAGE_SIZE = 100;
export const MAX_PAGES = 10;

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

// Branch names and URLs of other runs end up in log lines and annotations; keep them to plain
// characters and a bounded length.
export function safeText(value) {
  return String(value).replace(/[^\w./@+:-]/g, "?").slice(0, 100);
}

function describeRun(run) {
  const details = [
    safeText(run.status),
    run.event && run.head_branch ? `${safeText(run.event)} on ${safeText(run.head_branch)}` : null,
    run.html_url ? safeText(run.html_url) : null,
  ]
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

  let selfRun;
  try {
    selfRun = await getJson(`/actions/runs/${runId}`);
  } catch (error) {
    throw new Error(`Could not read this workflow run (${runId}): ${error.message}.`);
  }
  if (selfRun.head_repository?.full_name !== repository) {
    const origin = selfRun.head_repository?.full_name ? safeText(selfRun.head_repository.full_name) : "an unknown repository";
    throw new Error(`Run ${runId} is from ${origin}, not ${repository}; fork runs never deploy to QA.`);
  }
  const self = queueKey(selfRun);

  // This repository's other queued and in-progress Journeys runs, every page.
  async function activeRuns() {
    const runs = new Map();
    for (const status of LISTED_RUN_STATUSES) {
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const listing = await getJson(
          `/actions/workflows/${WORKFLOW_FILE}/runs?status=${status}&per_page=${PAGE_SIZE}&page=${page}`,
        );
        const batch = listing.workflow_runs ?? [];
        for (const run of batch) runs.set(run.id, run);
        if (batch.length < PAGE_SIZE) break;
      }
    }
    return [...runs.values()].filter((run) => run.id !== runId && run.head_repository?.full_name === repository);
  }

  async function holdsQa(run) {
    const listing = await getJson(`/actions/runs/${run.id}/jobs?filter=latest&per_page=${PAGE_SIZE}`);
    return (listing.jobs ?? []).some((job) => job.name === QA_TURN_JOB_NAME && job.conclusion === "success");
  }

  const startedWaiting = now();
  for (;;) {
    const waited = now() - startedWaiting;
    let blocking = null;
    let reason = null;
    let failure = null;
    try {
      const active = await activeRuns();
      const ahead = active.filter((run) => isAheadInQueue(queueKey(run), self));
      if (ahead.length > 0) {
        blocking = ahead;
        reason = "ahead of";
      } else {
        blocking = [];
        for (const run of active) {
          if (await holdsQa(run)) blocking.push(run);
        }
        reason = "already on QA, behind";
      }
    } catch (error) {
      if (error instanceof GitHubApiError && error.status < 500) {
        throw new Error(`Could not list Journeys runs: ${error.message}. The job needs the actions: read permission.`);
      }
      // A partial answer is no answer: never proceed on it.
      blocking = null;
      failure = error.message;
    }

    if (blocking && blocking.length === 0) {
      log(`No Journeys run is ahead of run ${runId} or on QA; starting now.`);
      return { waitedMs: waited };
    }

    const described = blocking && `${blocking.length} Journeys run(s) ${reason} run ${runId}: ${blocking.map(describeRun).join("; ")}`;
    if (waited >= maxWaitMs) {
      if (blocking) {
        throw new Error(
          `Run ${runId} waited ${minutes(waited)} min for QA and is still waiting for ${described}. ` +
            "Cancel or finish those runs, then re-run this one.",
        );
      }
      throw new Error(
        `Run ${runId} waited ${minutes(waited)} min for QA and could not confirm its turn: the GitHub API kept failing (${failure}).`,
      );
    }

    log(blocking ? `Waiting for ${described}` : `Could not list Journeys runs (${failure}); retrying.`);
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
