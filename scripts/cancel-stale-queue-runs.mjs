#!/usr/bin/env node
// Cancels workflow runs that can no longer decide anything, so they stop holding runners.
//
// When the queue rebuilds its groups (a pull request jumps the queue, leaves it, or a group ahead
// fails), GitHub starts new runs for the new groups but leaves the old groups' runs going. Their
// results are never read: only a run for a current entry's head commit can merge it. On
// 2026-11-23 one jump left four such groups running (CI, Journeys, Storybook) while the front of
// the queue waited for a runner.
//
// A pull request's runs for an older head are cancelled by each workflow's concurrency group, but
// not always: on 2026-11-24 #971's Journeys run for its old head stayed queued after #971 moved on,
// holding the pull request's Journeys group so the new head's run sat pending behind it. A plain
// cancel left it queued; only a force-cancel ended it. Runs of a pull request that has closed are
// stale the same way.
//
// A run is stale when it hasn't finished, it started at least MIN_AGE_MS ago, and either it is a
// merge_group run whose head commit is no current queue entry's head commit, or it is a
// pull_request run whose head commit is no open pull request's head commit. The age floor keeps a
// group the queue has just created, or a push GitHub has not yet listed as its pull request's head,
// from being cancelled; a run skipped for that reason is old enough the next time the sweep runs.
// After cancelling, the sweep waits STUCK_WAIT_MS and force-cancels any of those runs still
// queued. A queued run has no job running, so a force-cancel cuts no teardown short.
//
// Usage: node scripts/cancel-stale-queue-runs.mjs
// Needs GITHUB_TOKEN (actions: write, contents: read, pull-requests: read) and GITHUB_REPOSITORY
// (owner/name). Reads MERGE_QUEUE_BRANCH (default main) and GITHUB_RUN_ID (this run, which it never
// cancels).
import { pathToFileURL } from "node:url";

export const MIN_AGE_MS = 2 * 60 * 1000;
export const STUCK_WAIT_MS = 30 * 1000;
const UNFINISHED = ["queued", "in_progress", "waiting", "pending", "requested"];

function staleRuns(event, runs, liveHeads, { now, selfRunId, minAgeMs = MIN_AGE_MS }) {
  const live = new Set(liveHeads);
  return runs.filter(
    (run) =>
      run.event === event &&
      UNFINISHED.includes(run.status) &&
      !live.has(run.head_sha) &&
      String(run.id) !== String(selfRunId) &&
      now - Date.parse(run.run_started_at ?? run.created_at) >= minAgeMs,
  );
}

export function staleQueueRuns(runs, entryHeads, options) {
  return staleRuns("merge_group", runs, entryHeads, options);
}

export function stalePullRequestRuns(runs, openHeads, options) {
  return staleRuns("pull_request", runs, openHeads, options);
}

export function createGitHub({ token, repository, fetchImpl }) {
  const [owner, name] = repository.split("/");
  async function call(path, init = {}) {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    });
    if (!response.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path} answered ${response.status}: ${await response.text()}`);
    return response.status === 204 ? null : response.json();
  }
  return {
    async entryHeads(branch) {
      const query = `query($owner:String!,$name:String!,$branch:String!){repository(owner:$owner,name:$name){mergeQueue(branch:$branch){entries(first:100){nodes{headCommit{oid}}}}}}`;
      const body = await call("/graphql", { method: "POST", body: JSON.stringify({ query, variables: { owner, name, branch } }) });
      // A failed query must not read as an empty queue, which would make every running group stale.
      if (body.errors?.length || !body.data?.repository?.mergeQueue) throw new Error(`Could not read the ${branch} merge queue: ${JSON.stringify(body.errors ?? body)}`);
      return body.data.repository.mergeQueue.entries.nodes.map((node) => node.headCommit?.oid).filter(Boolean);
    },
    async openPullRequestHeads() {
      const heads = [];
      for (let page = 1; ; page += 1) {
        const pulls = await call(`/repos/${owner}/${name}/pulls?state=open&per_page=100&page=${page}`);
        heads.push(...pulls.map((pull) => pull.head.sha));
        if (pulls.length < 100) return heads;
      }
    },
    async unfinishedRuns(event) {
      const runs = [];
      for (const status of UNFINISHED) {
        const body = await call(`/repos/${owner}/${name}/actions/runs?event=${event}&status=${status}&per_page=100`);
        runs.push(...body.workflow_runs);
      }
      return runs;
    },
    unfinishedQueueRuns() {
      return this.unfinishedRuns("merge_group");
    },
    run(runId) {
      return call(`/repos/${owner}/${name}/actions/runs/${runId}`);
    },
    cancel(runId) {
      return call(`/repos/${owner}/${name}/actions/runs/${runId}/cancel`, { method: "POST" });
    },
    forceCancel(runId) {
      return call(`/repos/${owner}/${name}/actions/runs/${runId}/force-cancel`, { method: "POST" });
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function cancelStaleQueueRuns({ github, branch, now, selfRunId, log, wait = sleep }) {
  // Runs first, heads second: a group or push created between the two reads is then already listed.
  const queueRuns = await github.unfinishedQueueRuns();
  const pullRuns = await github.unfinishedRuns("pull_request");
  const heads = await github.entryHeads(branch);
  const openHeads = await github.openPullRequestHeads();
  const staleQueue = staleQueueRuns(queueRuns, heads, { now, selfRunId });
  const stalePulls = stalePullRequestRuns(pullRuns, openHeads, { now, selfRunId });
  for (const run of staleQueue) {
    await github.cancel(run.id);
    log(`Cancelled ${run.name} run ${run.id} (${run.head_branch}): its head ${run.head_sha} is no queue entry's head.`);
  }
  for (const run of stalePulls) {
    await github.cancel(run.id);
    log(`Cancelled ${run.name} run ${run.id} (${run.head_branch}): its head ${run.head_sha} is no open pull request's head.`);
  }
  const stale = [...staleQueue, ...stalePulls];
  if (stale.length > 0) {
    await wait(STUCK_WAIT_MS);
    for (const run of stale) {
      if ((await github.run(run.id)).status !== "queued") continue;
      await github.forceCancel(run.id);
      log(`Force-cancelled ${run.name} run ${run.id}: it was still queued ${STUCK_WAIT_MS / 1000} s after it was cancelled.`);
    }
  }
  log(
    `${staleQueue.length} stale merge-queue run(s) and ${stalePulls.length} stale pull-request run(s) cancelled; ` +
      `${heads.length} queue entr${heads.length === 1 ? "y" : "ies"} live.`,
  );
  return stale;
}

export async function main(deps = {}) {
  const { env = process.env, fetchImpl = fetch, now = Date.now, log = console.log } = deps;
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required.");
  const github = createGitHub({ token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY, fetchImpl });
  return cancelStaleQueueRuns({ github, branch: env.MERGE_QUEUE_BRANCH || "main", now: now(), selfRunId: env.GITHUB_RUN_ID, log });
}

export async function runCliIfEntry({ moduleUrl = import.meta.url, argv1 = process.argv[1], runMain = main, io = console } = {}) {
  if (typeof argv1 !== "string" || moduleUrl !== pathToFileURL(argv1).href) return false;
  try {
    await runMain();
  } catch (error) {
    io.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
  return true;
}

await runCliIfEntry();
