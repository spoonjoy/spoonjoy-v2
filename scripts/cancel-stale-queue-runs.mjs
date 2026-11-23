#!/usr/bin/env node
// Cancels merge-queue runs that can no longer merge anything, so they stop holding runners.
//
// When the queue rebuilds its groups (a pull request jumps the queue, leaves it, or a group ahead
// fails), GitHub starts new runs for the new groups but leaves the old groups' runs going. Their
// results are never read: only a run for a current entry's head commit can merge it. On
// 2026-11-23 one jump left four such groups running (CI, Journeys, Storybook) while the front of
// the queue waited for a runner.
//
// A run is stale when it is a merge_group run that hasn't finished, its head commit is no current
// queue entry's head commit, and it started at least MIN_AGE_MS ago. The age floor keeps a group
// the queue has just created, but not yet listed as an entry's head, from being cancelled. A run
// this sweep skips for that reason is old enough the next time the sweep runs.
//
// Usage: node scripts/cancel-stale-queue-runs.mjs
// Needs GITHUB_TOKEN (actions: write, contents: read) and GITHUB_REPOSITORY (owner/name). Reads
// MERGE_QUEUE_BRANCH (default main) and GITHUB_RUN_ID (this run, which it never cancels).
import { pathToFileURL } from "node:url";

export const MIN_AGE_MS = 2 * 60 * 1000;
const UNFINISHED = ["queued", "in_progress", "waiting", "pending", "requested"];

export function staleQueueRuns(runs, entryHeads, { now, selfRunId, minAgeMs = MIN_AGE_MS }) {
  const live = new Set(entryHeads);
  return runs.filter(
    (run) =>
      run.event === "merge_group" &&
      UNFINISHED.includes(run.status) &&
      !live.has(run.head_sha) &&
      String(run.id) !== String(selfRunId) &&
      now - Date.parse(run.run_started_at ?? run.created_at) >= minAgeMs,
  );
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
    async unfinishedQueueRuns() {
      const runs = [];
      for (const status of UNFINISHED) {
        const body = await call(`/repos/${owner}/${name}/actions/runs?event=merge_group&status=${status}&per_page=100`);
        runs.push(...body.workflow_runs);
      }
      return runs;
    },
    cancel(runId) {
      return call(`/repos/${owner}/${name}/actions/runs/${runId}/cancel`, { method: "POST" });
    },
  };
}

export async function cancelStaleQueueRuns({ github, branch, now, selfRunId, log }) {
  // Runs first, heads second: a group created between the two reads is then already listed.
  const runs = await github.unfinishedQueueRuns();
  const heads = await github.entryHeads(branch);
  const stale = staleQueueRuns(runs, heads, { now, selfRunId });
  for (const run of stale) {
    await github.cancel(run.id);
    log(`Cancelled ${run.name} run ${run.id} (${run.head_branch}): its head ${run.head_sha} is no queue entry's head.`);
  }
  log(`${stale.length} stale merge-queue run(s) cancelled; ${heads.length} queue entr${heads.length === 1 ? "y" : "ies"} live.`);
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
