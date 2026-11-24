import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parseDocument } from "yaml";
import {
  MIN_AGE_MS,
  STUCK_WAIT_MS,
  cancelStaleQueueRuns,
  createGitHub,
  main,
  runCliIfEntry,
  stalePullRequestRuns,
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
    expect(STUCK_WAIT_MS).toBe(30_000);
  });
});

describe("stalePullRequestRuns", () => {
  const prRun = (id: number, head_sha: string, extra: Record<string, unknown> = {}) =>
    run(id, head_sha, { event: "pull_request", head_branch: "feature", ...extra });

  it("picks unfinished pull-request runs whose head is no open pull request's head", () => {
    const runs = [
      prRun(1, "current"),
      prRun(2, "superseded"),
      prRun(3, "superseded", { status: "completed" }),
      prRun(4, "closed-pr", { status: "queued", run_started_at: undefined }),
      run(5, "superseded"),
      prRun(6, "superseded", { run_started_at: ago(1) }),
      prRun(7, "superseded"),
    ];
    expect(stalePullRequestRuns(runs, ["current"], { now: NOW, selfRunId: "7" }).map((each) => each.id)).toEqual([2, 4]);
  });
});

type Answer = { status?: number; body?: unknown };
function fakeFetch(answers: Record<string, Answer | Answer[]>) {
  const calls: { url: string; method: string; body?: string; auth: string }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: { method?: string; body?: string; headers: Record<string, string> }) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body, auth: init.headers.authorization });
    const key = Object.keys(answers).find((each) => `${method} ${url}`.includes(each));
    const found = key ? answers[key] : { status: 404, body: "missing" };
    const answer = Array.isArray(found) ? (found.length > 1 ? found.shift() : found[0]) : found;
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
const runsFor = (status: string, runs: unknown[], event = "merge_group") => ({ [`GET https://api.github.com/repos/o/r/actions/runs?event=${event}&status=${status}&`]: { body: { workflow_runs: runs } } });
const STATUSES = ["queued", "in_progress", "waiting", "pending", "requested"];
const openPulls = (heads: string[]) => ({ "GET https://api.github.com/repos/o/r/pulls?state=open&per_page=100&page=1": { body: heads.map((sha) => ({ head: { sha } })) } });
const noRuns = Object.assign(
  {},
  ...STATUSES.map((status) => runsFor(status, [])),
  ...STATUSES.map((status) => runsFor(status, [], "pull_request")),
  openPulls([]),
);
const noWait = async () => {};

describe("cancelStaleQueueRuns against the GitHub API", () => {
  it("cancels each stale run and leaves the current groups' runs", async () => {
    const { fetchImpl, calls } = fakeFetch({
      ...noRuns,
      ...runsFor("in_progress", [run(11, "a9d2172e"), run(12, "af5b7e11")]),
      "POST https://api.github.com/graphql": { body: queue(["a9d2172e", null]) },
      "POST https://api.github.com/repos/o/r/actions/runs/12/cancel": { status: 202, body: {} },
      "GET https://api.github.com/repos/o/r/actions/runs/12": { body: { id: 12, status: "completed" } },
    });
    const log = vi.fn();
    const github = createGitHub({ token: "t", repository: "o/r", fetchImpl });
    const cancelled = await cancelStaleQueueRuns({ github, branch: "main", now: NOW, selfRunId: undefined, log, wait: noWait });
    expect(cancelled.map((each: { id: number }) => each.id)).toEqual([12]);
    expect(calls.filter((call) => call.method === "POST" && call.url.endsWith("/cancel")).map((call) => call.url)).toEqual([
      "https://api.github.com/repos/o/r/actions/runs/12/cancel",
    ]);
    expect(JSON.parse(calls.find((call) => call.url.endsWith("/graphql"))!.body!).variables).toEqual({ owner: "o", name: "r", branch: "main" });
    expect(calls.every((call) => call.auth === "Bearer t")).toBe(true);
    expect(log).toHaveBeenLastCalledWith("1 stale merge-queue run(s) and 0 stale pull-request run(s) cancelled; 1 queue entry live.");
  });

  it("reads a no-content answer as success and counts several entries", async () => {
    const { fetchImpl } = fakeFetch({
      ...noRuns,
      ...runsFor("queued", [run(21, "gone")]),
      "POST https://api.github.com/graphql": { body: queue(["x", "y"]) },
      "POST https://api.github.com/repos/o/r/actions/runs/21/cancel": { status: 204 },
      "GET https://api.github.com/repos/o/r/actions/runs/21": { body: { id: 21, status: "completed" } },
    });
    const log = vi.fn();
    const github = createGitHub({ token: "t", repository: "o/r", fetchImpl });
    await cancelStaleQueueRuns({ github, branch: "main", now: NOW, selfRunId: undefined, log, wait: noWait });
    expect(log).toHaveBeenLastCalledWith("1 stale merge-queue run(s) and 0 stale pull-request run(s) cancelled; 2 queue entries live.");
  });

  it("cancels pull-request runs for superseded heads and closed pull requests, reading every page of open pull requests", async () => {
    const page1 = Array.from({ length: 100 }, (_, index) => ({ head: { sha: `open-${index}` } }));
    const { fetchImpl, calls } = fakeFetch({
      ...noRuns,
      ...runsFor("queued", [run(51, "x", { event: "pull_request" }), run(52, "open-3", { event: "pull_request" }), run(53, "open-101", { event: "pull_request" })], "pull_request"),
      "GET https://api.github.com/repos/o/r/pulls?state=open&per_page=100&page=1": { body: page1 },
      "GET https://api.github.com/repos/o/r/pulls?state=open&per_page=100&page=2": { body: [{ head: { sha: "open-101" } }] },
      "POST https://api.github.com/graphql": { body: queue([]) },
      "POST https://api.github.com/repos/o/r/actions/runs/51/cancel": { status: 202, body: {} },
      "GET https://api.github.com/repos/o/r/actions/runs/51": { body: { id: 51, status: "completed" } },
    });
    const log = vi.fn();
    const github = createGitHub({ token: "t", repository: "o/r", fetchImpl });
    const cancelled = await cancelStaleQueueRuns({ github, branch: "main", now: NOW, selfRunId: undefined, log, wait: noWait });
    expect(cancelled.map((each: { id: number }) => each.id)).toEqual([51]);
    expect(calls.filter((call) => call.method === "POST" && /cancel$/.test(call.url)).map((call) => call.url)).toEqual([
      "https://api.github.com/repos/o/r/actions/runs/51/cancel",
    ]);
    expect(log).toHaveBeenCalledWith("Cancelled CI run 51 (gh-readonly-queue/main/pr-1-x): its head x is no open pull request's head.");
    expect(log).toHaveBeenLastCalledWith("0 stale merge-queue run(s) and 1 stale pull-request run(s) cancelled; 0 queue entries live.");
  });

  it("force-cancels a cancelled run that is still queued after the wait, and leaves one that is finishing", async () => {
    const { fetchImpl, calls } = fakeFetch({
      ...noRuns,
      ...runsFor("queued", [run(61, "old"), run(62, "old")]),
      "POST https://api.github.com/graphql": { body: queue([]) },
      "POST https://api.github.com/repos/o/r/actions/runs/61/cancel": { status: 202, body: {} },
      "POST https://api.github.com/repos/o/r/actions/runs/62/cancel": { status: 202, body: {} },
      "GET https://api.github.com/repos/o/r/actions/runs/61": { body: { id: 61, status: "queued" } },
      "GET https://api.github.com/repos/o/r/actions/runs/62": { body: { id: 62, status: "in_progress" } },
      "POST https://api.github.com/repos/o/r/actions/runs/61/force-cancel": { status: 202, body: {} },
    });
    const log = vi.fn();
    const wait = vi.fn(async () => {});
    const github = createGitHub({ token: "t", repository: "o/r", fetchImpl });
    await cancelStaleQueueRuns({ github, branch: "main", now: NOW, selfRunId: undefined, log, wait });
    expect(wait).toHaveBeenCalledWith(STUCK_WAIT_MS);
    expect(calls.filter((call) => call.url.endsWith("/force-cancel")).map((call) => call.url)).toEqual([
      "https://api.github.com/repos/o/r/actions/runs/61/force-cancel",
    ]);
    expect(log).toHaveBeenCalledWith("Force-cancelled CI run 61: it was still queued 30 s after it was cancelled.");
  });

  it("does not wait when it cancelled nothing", async () => {
    const { fetchImpl } = fakeFetch({ ...noRuns, "POST https://api.github.com/graphql": { body: queue([]) } });
    const wait = vi.fn(async () => {});
    await cancelStaleQueueRuns({ github: createGitHub({ token: "t", repository: "o/r", fetchImpl }), branch: "main", now: NOW, selfRunId: undefined, log: vi.fn(), wait });
    expect(wait).not.toHaveBeenCalled();
  });

  it("stops before cancelling anything when the queue can't be read", async () => {
    for (const body of [{ errors: [{ message: "denied" }] }, { data: { repository: { mergeQueue: null } } }]) {
      const { fetchImpl, calls } = fakeFetch({ ...noRuns, ...runsFor("queued", [run(31, "old")]), "POST https://api.github.com/graphql": { body } });
      const github = createGitHub({ token: "t", repository: "o/r", fetchImpl });
      await expect(cancelStaleQueueRuns({ github, branch: "main", now: NOW, selfRunId: undefined, log: vi.fn(), wait: noWait })).rejects.toThrow(
        "Could not read the main merge queue",
      );
      expect(calls.some((call) => call.url.endsWith("/cancel"))).toBe(false);
    }
  });

  it("waits with a real timer by default", async () => {
    vi.useFakeTimers();
    const { fetchImpl } = fakeFetch({
      ...noRuns,
      ...runsFor("queued", [run(71, "old")]),
      "POST https://api.github.com/graphql": { body: queue([]) },
      "POST https://api.github.com/repos/o/r/actions/runs/71/cancel": { status: 202, body: {} },
      "GET https://api.github.com/repos/o/r/actions/runs/71": { body: { id: 71, status: "completed" } },
    });
    const done = cancelStaleQueueRuns({ github: createGitHub({ token: "t", repository: "o/r", fetchImpl }), branch: "main", now: NOW, selfRunId: undefined, log: vi.fn() });
    await vi.advanceTimersByTimeAsync(STUCK_WAIT_MS);
    await expect(done).resolves.toHaveLength(1);
    vi.useRealTimers();
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

  it("can cancel runs and read pull requests and nothing more, and runs the sweep script", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.sweep.permissions).toEqual({ actions: "write", contents: "read", "pull-requests": "read" });
    expect(workflow.jobs.sweep.steps.at(-1).run).toBe("node scripts/cancel-stale-queue-runs.mjs");
    expect(workflow.jobs.sweep.steps[0].with["sparse-checkout"]).toBe("scripts/cancel-stale-queue-runs.mjs");
  });
});
