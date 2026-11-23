import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parseDocument } from "yaml";
import {
  MIN_AGE_MS,
  cancelStaleQueueRuns,
  createGitHub,
  main,
  runCliIfEntry,
  staleQueueRuns,
} from "../../scripts/cancel-stale-queue-runs.mjs";

const NOW = Date.parse("2026-11-23T11:30:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const run = (id: number, head_sha: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: "CI",
  head_sha,
  head_branch: `gh-readonly-queue/main/pr-1-${head_sha}`,
  event: "merge_group",
  status: "in_progress",
  run_started_at: ago(10),
  created_at: ago(10),
  ...extra,
});

describe("staleQueueRuns", () => {
  it("picks unfinished merge-queue runs whose head is no current entry's head", () => {
    const runs = [
      run(1, "live"),
      run(2, "old"),
      run(3, "old", { status: "completed" }),
      run(4, "old", { event: "pull_request" }),
      run(5, "old", { status: "queued", run_started_at: undefined }),
    ];
    expect(staleQueueRuns(runs, ["live"], { now: NOW, selfRunId: undefined }).map((each) => each.id)).toEqual([2, 5]);
  });

  it("leaves a run younger than the age floor, and this sweep's own run", () => {
    const runs = [run(1, "new", { run_started_at: ago(1) }), run(2, "old")];
    expect(staleQueueRuns(runs, [], { now: NOW, selfRunId: "2" })).toEqual([]);
    expect(MIN_AGE_MS).toBe(120_000);
  });
});

function fakeFetch(answers: Record<string, { status?: number; body?: unknown }>) {
  const calls: { url: string; method: string; body?: string; auth: string }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: { method?: string; body?: string; headers: Record<string, string> }) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body, auth: init.headers.authorization });
    const key = Object.keys(answers).find((each) => `${method} ${url}`.includes(each));
    const answer = key ? answers[key] : { status: 404, body: "missing" };
    const status = answer.status ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => answer.body,
      text: async () => JSON.stringify(answer.body),
    };
  });
  return { fetchImpl, calls };
}

const queue = (heads: (string | null)[]) => ({
  data: { repository: { mergeQueue: { entries: { nodes: heads.map((oid) => ({ headCommit: oid ? { oid } : null })) } } } },
});
const runsFor = (status: string, runs: unknown[]) => ({ [`GET https://api.github.com/repos/o/r/actions/runs?event=merge_group&status=${status}&`]: { body: { workflow_runs: runs } } });
const noRuns = Object.assign(
  {},
  ...["queued", "in_progress", "waiting", "pending", "requested"].map((status) => runsFor(status, [])),
);

describe("cancelStaleQueueRuns against the GitHub API", () => {
  it("cancels each stale run and leaves the current groups' runs", async () => {
    const { fetchImpl, calls } = fakeFetch({
      ...noRuns,
      ...runsFor("in_progress", [run(11, "a9d2172e"), run(12, "af5b7e11")]),
      "POST https://api.github.com/graphql": { body: queue(["a9d2172e", null]) },
      "POST https://api.github.com/repos/o/r/actions/runs/12/cancel": { status: 202, body: {} },
    });
    const log = vi.fn();
    const github = createGitHub({ token: "t", repository: "o/r", fetchImpl });
    const cancelled = await cancelStaleQueueRuns({ github, branch: "main", now: NOW, selfRunId: undefined, log });
    expect(cancelled.map((each: { id: number }) => each.id)).toEqual([12]);
    expect(calls.filter((call) => call.method === "POST" && call.url.endsWith("/cancel")).map((call) => call.url)).toEqual([
      "https://api.github.com/repos/o/r/actions/runs/12/cancel",
    ]);
    expect(JSON.parse(calls.find((call) => call.url.endsWith("/graphql"))!.body!).variables).toEqual({ owner: "o", name: "r", branch: "main" });
    expect(calls.every((call) => call.auth === "Bearer t")).toBe(true);
    expect(log).toHaveBeenLastCalledWith("1 stale merge-queue run(s) cancelled; 1 queue entry live.");
  });

  it("reads a no-content answer as success and counts several entries", async () => {
    const { fetchImpl } = fakeFetch({
      ...noRuns,
      ...runsFor("queued", [run(21, "gone")]),
      "POST https://api.github.com/graphql": { body: queue(["x", "y"]) },
      "POST https://api.github.com/repos/o/r/actions/runs/21/cancel": { status: 204 },
    });
    const log = vi.fn();
    const github = createGitHub({ token: "t", repository: "o/r", fetchImpl });
    await cancelStaleQueueRuns({ github, branch: "main", now: NOW, selfRunId: undefined, log });
    expect(log).toHaveBeenLastCalledWith("1 stale merge-queue run(s) cancelled; 2 queue entries live.");
  });

  it("stops before cancelling anything when the queue can't be read", async () => {
    for (const body of [{ errors: [{ message: "denied" }] }, { data: { repository: { mergeQueue: null } } }]) {
      const { fetchImpl, calls } = fakeFetch({ ...noRuns, ...runsFor("queued", [run(31, "old")]), "POST https://api.github.com/graphql": { body } });
      const github = createGitHub({ token: "t", repository: "o/r", fetchImpl });
      await expect(cancelStaleQueueRuns({ github, branch: "main", now: NOW, selfRunId: undefined, log: vi.fn() })).rejects.toThrow(
        "Could not read the main merge queue",
      );
      expect(calls.some((call) => call.url.endsWith("/cancel"))).toBe(false);
    }
  });

  it("fails on an error answer, naming the request", async () => {
    const { fetchImpl } = fakeFetch({});
    const github = createGitHub({ token: "t", repository: "o/r", fetchImpl });
    await expect(github.unfinishedQueueRuns()).rejects.toThrow(/GitHub GET \/repos\/o\/r\/actions\/runs\?event=merge_group&status=queued&per_page=100 answered 404/);
    await expect(github.cancel(5)).rejects.toThrow("GitHub POST /repos/o/r/actions/runs/5/cancel answered 404");
  });
});

describe("main", () => {
  it("needs a token and the repository", async () => {
    await expect(main({ env: {} })).rejects.toThrow("GITHUB_TOKEN and GITHUB_REPOSITORY are required.");
    vi.stubEnv("GITHUB_TOKEN", "");
    await expect(main()).rejects.toThrow("GITHUB_TOKEN and GITHUB_REPOSITORY are required.");
    vi.unstubAllEnvs();
  });

  it("sweeps the named branch's queue, defaulting to main, and never cancels its own run", async () => {
    for (const [env, branch] of [
      [{ GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "41" }, "main"],
      [{ GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "41", MERGE_QUEUE_BRANCH: "next" }, "next"],
    ] as const) {
      const { fetchImpl, calls } = fakeFetch({ ...noRuns, ...runsFor("in_progress", [run(41, "old")]), "POST https://api.github.com/graphql": { body: queue([]) } });
      const cancelled = await main({ env, fetchImpl, now: () => NOW, log: vi.fn() });
      expect(cancelled).toEqual([]);
      expect(JSON.parse(calls.find((call) => call.url.endsWith("/graphql"))!.body!).variables.branch).toBe(branch);
    }
  });
});

describe("runCliIfEntry", () => {
  const moduleUrl = pathToFileURL("/repo/scripts/cancel-stale-queue-runs.mjs").href;

  it("runs only as the entry script", async () => {
    const runMain = vi.fn(async () => []);
    expect(await runCliIfEntry({ moduleUrl, argv1: undefined, runMain })).toBe(false);
    expect(await runCliIfEntry({ moduleUrl, argv1: "/repo/scripts/other.mjs", runMain })).toBe(false);
    expect(runMain).not.toHaveBeenCalled();
    expect(await runCliIfEntry({ moduleUrl, argv1: "/repo/scripts/cancel-stale-queue-runs.mjs", runMain })).toBe(true);
    expect(runMain).toHaveBeenCalledOnce();
  });

  it("reports a failure as a workflow error and sets a failing exit code", async () => {
    const io = { error: vi.fn() };
    const previous = process.exitCode;
    for (const thrown of [new Error("boom"), "plain"]) {
      await runCliIfEntry({ moduleUrl, argv1: "/repo/scripts/cancel-stale-queue-runs.mjs", runMain: async () => Promise.reject(thrown), io });
    }
    expect(io.error.mock.calls).toEqual([["::error::boom"], ["::error::plain"]]);
    expect(process.exitCode).toBe(1);
    process.exitCode = previous;
  });
});

describe("Merge Queue Sweep workflow", () => {
  const workflow = parseDocument(readFileSync(".github/workflows/merge-queue-sweep.yml", "utf8")).toJS();

  it("runs when the queue starts a group and every ten minutes, one sweep at a time", () => {
    expect(Object.keys(workflow.on)).toEqual(["merge_group", "schedule", "workflow_dispatch"]);
    expect(workflow.on.schedule).toEqual([{ cron: "*/10 * * * *" }]);
    expect(workflow.concurrency).toEqual({ group: "merge-queue-sweep", "cancel-in-progress": true });
  });

  it("can cancel runs and nothing more, and runs the sweep script", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.sweep.permissions).toEqual({ actions: "write", contents: "read" });
    expect(workflow.jobs.sweep.steps.at(-1).run).toBe("node scripts/cancel-stale-queue-runs.mjs");
    expect(workflow.jobs.sweep.steps[0].with["sparse-checkout"]).toBe("scripts/cancel-stale-queue-runs.mjs");
  });
});
