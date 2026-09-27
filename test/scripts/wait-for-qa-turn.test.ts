// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { expectConsoleError } from "../warning-policy";
import {
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_POLL_MS,
  defaultCliErrorHandler,
  isAheadInQueue,
  isCliEntry,
  LISTED_RUN_STATUSES,
  main,
  MAX_PAGES,
  PAGE_SIZE,
  QA_TURN_JOB_NAME,
  queueKey,
  runCliIfEntry,
  safeText,
  waitForQaTurn,
} from "../../scripts/wait-for-qa-turn.mjs";

const ENV = {
  GITHUB_TOKEN: "ghs_test",
  GITHUB_REPOSITORY: "spoonjoy/spoonjoy-v2",
  GITHUB_RUN_ID: "500",
  GITHUB_API_URL: "https://api.github.test",
};

interface FakeRun {
  id: number;
  status: string;
  run_started_at?: string | null;
  created_at?: string;
  run_attempt?: number;
  head_branch?: string;
  event?: string;
  html_url?: string;
  head_repository?: { full_name: string } | null;
}

const REPO = { full_name: "spoonjoy/spoonjoy-v2" };
const FORK = { full_name: "someone/spoonjoy-v2" };
const self: FakeRun = { id: 500, status: "in_progress", run_started_at: "2026-09-27T05:00:00Z", run_attempt: 1, head_repository: REPO };

function run(id: number, status: string, startedAt: string, extra: Partial<FakeRun> = {}): FakeRun {
  return { id, status, run_started_at: startedAt, head_repository: REPO, ...extra };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// One poll's view of GitHub: the Journeys runs that exist, and each run's latest jobs.
interface Poll {
  runs: FakeRun[];
  jobs?: Record<number, Array<{ name: string; conclusion: string | null }>>;
}

// A fake GitHub API. GET /actions/runs/500 returns `selfRun`. Each poll starts with the
// `status=queued&page=1` listing and uses the next entry of `polls` (the last one repeats); a
// Response or Error entry answers every request of that poll.
function fakeGitHub(polls: Array<Poll | Response | Error>, selfRun: FakeRun | Response = self, pageSize = 100) {
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  let poll = -1;
  const fetch = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    requests.push({ url, headers: init.headers });
    if (url.endsWith("/actions/runs/500")) {
      return selfRun instanceof Response ? selfRun : jsonResponse(selfRun);
    }
    const parsed = new URL(url);
    if (parsed.searchParams.get("status") === "queued" && parsed.searchParams.get("page") === "1") poll += 1;
    const current = polls[Math.min(poll, polls.length - 1)];
    if (current instanceof Error) throw current;
    if (current instanceof Response) return current.clone();
    const jobsMatch = parsed.pathname.match(/\/actions\/runs\/(\d+)\/jobs$/);
    if (jobsMatch) return jsonResponse({ jobs: current.jobs?.[Number(jobsMatch[1])] ?? [] });
    const status = parsed.searchParams.get("status");
    const page = Number(parsed.searchParams.get("page"));
    const matching = current.runs.filter((candidate) => candidate.status === status);
    const workflowRuns = matching.slice((page - 1) * pageSize, page * pageSize);
    return jsonResponse({ total_count: matching.length, workflow_runs: workflowRuns });
  });
  return { fetch, requests };
}

function clock() {
  let now = 0;
  return {
    now: () => now,
    sleep: vi.fn(async (ms: number) => {
      now += ms;
    }),
  };
}

const HOLDING = [{ name: "wait for QA", conclusion: "success" }, { name: "journeys", conclusion: null }];
const WAITING = [{ name: "wait for QA", conclusion: null }];

describe("queue order", () => {
  it("orders runs by the start of their current attempt, then by run id", () => {
    const me = queueKey(self);
    expect(isAheadInQueue(queueKey(run(900, "in_progress", "2026-09-27T04:59:59Z")), me)).toBe(true);
    expect(isAheadInQueue(queueKey(run(100, "in_progress", "2026-09-27T05:00:01Z")), me)).toBe(false);
    expect(isAheadInQueue(queueKey(run(499, "queued", "2026-09-27T05:00:00Z")), me)).toBe(true);
    expect(isAheadInQueue(queueKey(run(501, "queued", "2026-09-27T05:00:00Z")), me)).toBe(false);
  });

  it("puts a re-run at the back of the queue even though it keeps its old, lower id", () => {
    const rerun = queueKey(run(12, "in_progress", "2026-09-27T05:10:00Z", { run_attempt: 2 }));
    expect(isAheadInQueue(rerun, queueKey(self))).toBe(false);
    expect(isAheadInQueue(queueKey(self), rerun)).toBe(true);
  });

  it("falls back to the creation time when a queued run has no start time yet", () => {
    expect(queueKey({ id: 7, status: "queued", run_started_at: null, created_at: "2026-09-27T04:00:00Z" }))
      .toEqual({ id: 7, startedAt: Date.parse("2026-09-27T04:00:00Z") });
  });

  it("rejects a run without a usable start or creation time", () => {
    expect(() => queueKey({ id: 8, status: "queued" })).toThrow("Workflow run 8 has no start or creation time.");
  });

  it("keeps other runs' branch names and URLs to plain, bounded text in logs", () => {
    expect(safeText("claude/feature-1.2@x+y:z")).toBe("claude/feature-1.2@x+y:z");
    expect(safeText("evil\n::error::spoof `$(x)`")).toBe("evil?::error::spoof????x??");
    expect(safeText("a".repeat(150))).toHaveLength(100);
  });
});

describe("waitForQaTurn", () => {
  it("goes straight to QA when nothing is ahead or on QA, ignoring itself, fork runs and waiting runs behind it", async () => {
    const { fetch, requests } = fakeGitHub([{
      runs: [
        self,
        run(300, "queued", "2026-09-27T04:00:00Z", { head_repository: FORK }),
        run(301, "in_progress", "2026-09-27T04:00:00Z", { head_repository: null }),
        run(600, "queued", "2026-09-27T05:05:00Z"),
        run(601, "in_progress", "2026-09-27T05:06:00Z"),
      ],
      jobs: { 601: WAITING },
    }]);
    const time = clock();
    const log = vi.fn();

    await expect(waitForQaTurn({ env: ENV, fetch, sleep: time.sleep, now: time.now, log })).resolves.toEqual({ waitedMs: 0 });

    expect(time.sleep).not.toHaveBeenCalled();
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.github.test/repos/spoonjoy/spoonjoy-v2/actions/runs/500",
      "https://api.github.test/repos/spoonjoy/spoonjoy-v2/actions/workflows/journeys.yml/runs?status=queued&per_page=100&page=1",
      "https://api.github.test/repos/spoonjoy/spoonjoy-v2/actions/workflows/journeys.yml/runs?status=in_progress&per_page=100&page=1",
      "https://api.github.test/repos/spoonjoy/spoonjoy-v2/actions/runs/600/jobs?filter=latest&per_page=100",
      "https://api.github.test/repos/spoonjoy/spoonjoy-v2/actions/runs/601/jobs?filter=latest&per_page=100",
    ]);
    expect(requests[0].headers).toEqual({
      Accept: "application/vnd.github+json",
      Authorization: "Bearer ghs_test",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "spoonjoy-wait-for-qa-turn",
    });
    expect(log).toHaveBeenLastCalledWith("No Journeys run is ahead of run 500 or on QA; starting now.");
  });

  it("waits, polling, until every run ahead of it has finished", async () => {
    const ahead = run(450, "in_progress", "2026-09-27T04:30:00Z", { head_branch: "claude/a", event: "pull_request", html_url: "https://github.test/runs/450" });
    const queuedAhead = run(460, "queued", "2026-09-27T04:40:00Z", { head_branch: "main", event: "push" });
    const { fetch } = fakeGitHub([
      { runs: [self, ahead, queuedAhead] },
      { runs: [self, { ...ahead, status: "completed" }, { ...queuedAhead, status: "in_progress" }] },
      { runs: [self, { ...queuedAhead, status: "completed" }] },
    ]);
    const time = clock();
    const log = vi.fn();

    await expect(waitForQaTurn({ env: ENV, fetch, sleep: time.sleep, now: time.now, log, pollMs: 1000 }))
      .resolves.toEqual({ waitedMs: 2000 });

    expect(time.sleep).toHaveBeenCalledTimes(2);
    expect(time.sleep).toHaveBeenCalledWith(1000);
    expect(log).toHaveBeenCalledWith(
      "Waiting for 2 Journeys run(s) ahead of run 500: 460 (queued, push on main); 450 (in_progress, pull_request on claude/a, https://github.test/runs/450)",
    );
    expect(log).toHaveBeenCalledWith("Waiting for 1 Journeys run(s) ahead of run 500: 460 (in_progress, push on main)");
    expect(log).toHaveBeenLastCalledWith("No Journeys run is ahead of run 500 or on QA; starting now.");
  });

  it("waits for a run behind it that already holds QA, such as one that was pending on its pull request's group", async () => {
    const holder = run(700, "in_progress", "2026-09-27T05:30:00Z", { head_branch: "claude/b", event: "pull_request" });
    const { fetch } = fakeGitHub([
      { runs: [self, holder], jobs: { 700: HOLDING } },
      { runs: [self] },
    ]);
    const time = clock();
    const log = vi.fn();

    await expect(waitForQaTurn({ env: ENV, fetch, sleep: time.sleep, now: time.now, log, pollMs: 60_000 }))
      .resolves.toEqual({ waitedMs: 60_000 });
    expect(log).toHaveBeenCalledWith(
      "Waiting for 1 Journeys run(s) already on QA, behind run 500: 700 (in_progress, pull_request on claude/b)",
    );
  });

  it("ignores fork runs even when they are ahead, so outside pull requests cannot hold up the queue", async () => {
    const { fetch } = fakeGitHub([{
      runs: [self, ...Array.from({ length: 5 }, (_, index) => run(10 + index, "queued", "2026-09-27T01:00:00Z", { head_repository: FORK }))],
    }]);

    await expect(waitForQaTurn({ env: ENV, fetch, sleep: vi.fn(), now: () => 0, log: vi.fn() })).resolves.toEqual({ waitedMs: 0 });
  });

  it("follows every page of both status lists, so an active run cannot fall out of view", async () => {
    // GitHub lists newest first: 250 newer in-progress runs push the oldest active run to page 3.
    const newer = Array.from({ length: 250 }, (_, index) => run(900 + index, "in_progress", "2026-09-27T06:00:00Z"));
    const oldest = run(5, "in_progress", "2026-09-27T01:00:00Z");
    const { fetch, requests } = fakeGitHub([{ runs: [self, ...newer, oldest] }, { runs: [self] }]);
    const time = clock();
    const log = vi.fn();

    await waitForQaTurn({ env: ENV, fetch, sleep: time.sleep, now: time.now, log, pollMs: 10 });

    expect(log.mock.calls[0][0]).toBe("Waiting for 1 Journeys run(s) ahead of run 500: 5 (in_progress)");
    expect(requests.some((request) => request.url.includes("status=in_progress&per_page=100&page=3"))).toBe(true);
    expect(PAGE_SIZE).toBe(100);
    expect(MAX_PAGES).toBe(10);
  });

  it("stops paging at MAX_PAGES", async () => {
    const many = Array.from({ length: 1200 }, (_, index) => run(2000 + index, "queued", "2026-09-27T06:00:00Z"));
    const { fetch, requests } = fakeGitHub([{ runs: [self, ...many] }]);

    await waitForQaTurn({ env: ENV, fetch, sleep: vi.fn(), now: () => 0, log: vi.fn() });

    expect(requests.filter((request) => request.url.includes("status=queued")).map((request) => new URL(request.url).searchParams.get("page")))
      .toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  });

  it("counts a run once even if it changes status between the two listings", async () => {
    const ahead = run(40, "queued", "2026-09-27T04:00:00Z");
    let listings = 0;
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/actions/runs/500")) return jsonResponse(self);
      listings += 1;
      if (listings > 2) return jsonResponse({ workflow_runs: [] });
      return jsonResponse({ workflow_runs: [{ ...ahead, status: url.includes("status=queued") ? "queued" : "in_progress" }] });
    });
    const log = vi.fn();
    const time = clock();

    await waitForQaTurn({ env: ENV, fetch, sleep: time.sleep, now: time.now, log, pollMs: 1 });

    expect(log.mock.calls[0][0]).toBe("Waiting for 1 Journeys run(s) ahead of run 500: 40 (in_progress)");
  });

  it("fails with a clear message once the maximum wait is used up", async () => {
    const stuck = run(42, "queued", "2026-09-27T01:00:00Z", { head_branch: "claude/stuck", event: "pull_request" });
    const { fetch } = fakeGitHub([{ runs: [self, stuck] }]);
    const time = clock();

    await expect(waitForQaTurn({ env: ENV, fetch, sleep: time.sleep, now: time.now, log: vi.fn(), pollMs: 60_000, maxWaitMs: 180_000 }))
      .rejects.toThrow(
        "Run 500 waited 3 min for QA and is still waiting for 1 Journeys run(s) ahead of run 500: 42 (queued, pull_request on claude/stuck). " +
          "Cancel or finish those runs, then re-run this one.",
      );
    expect(time.sleep).toHaveBeenCalledTimes(3);
  });

  it("retries through GitHub server errors and network failures instead of skipping the queue", async () => {
    const { fetch } = fakeGitHub([
      new Response("unavailable", { status: 503 }),
      new Error("socket hang up"),
      { runs: [self] },
    ]);
    const time = clock();
    const log = vi.fn();

    await expect(waitForQaTurn({ env: ENV, fetch, sleep: time.sleep, now: time.now, log, pollMs: 10 }))
      .resolves.toEqual({ waitedMs: 20 });
    expect(log).toHaveBeenCalledWith("Could not list Journeys runs (GitHub API returned 503); retrying.");
    expect(log).toHaveBeenCalledWith("Could not list Journeys runs (socket hang up); retrying.");
  });

  it("never proceeds on a partial answer: a failing jobs lookup is retried, not read as a free QA", async () => {
    const behind = run(800, "in_progress", "2026-09-27T06:00:00Z");
    let jobsCalls = 0;
    const base = fakeGitHub([{ runs: [self, behind], jobs: { 800: HOLDING } }, { runs: [self] }]);
    const fetch = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      if (url.includes("/jobs")) {
        jobsCalls += 1;
        if (jobsCalls === 1) return new Response("bad gateway", { status: 502 });
      }
      return base.fetch(url, init);
    });
    const time = clock();
    const log = vi.fn();

    await expect(waitForQaTurn({ env: ENV, fetch, sleep: time.sleep, now: time.now, log, pollMs: 10 })).resolves.toEqual({ waitedMs: 10 });
    expect(log).toHaveBeenCalledWith("Could not list Journeys runs (GitHub API returned 502); retrying.");
  });

  it("gives up on repeated GitHub failures at the maximum wait, never proceeding blind", async () => {
    const { fetch } = fakeGitHub([new Response("unavailable", { status: 502 })]);
    const time = clock();

    await expect(waitForQaTurn({ env: ENV, fetch, sleep: time.sleep, now: time.now, log: vi.fn(), pollMs: 30_000, maxWaitMs: 60_000 }))
      .rejects.toThrow("Run 500 waited 1 min for QA and could not confirm its turn: the GitHub API kept failing (GitHub API returned 502).");
  });

  it("fails fast on a client error such as a missing actions: read permission", async () => {
    const { fetch } = fakeGitHub([new Response("forbidden", { status: 403 })]);
    const time = clock();

    await expect(waitForQaTurn({ env: ENV, fetch, sleep: time.sleep, now: time.now, log: vi.fn() }))
      .rejects.toThrow("Could not list Journeys runs: GitHub API returned 403. The job needs the actions: read permission.");
    expect(time.sleep).not.toHaveBeenCalled();
  });

  it("fails fast when its own run cannot be read", async () => {
    const { fetch } = fakeGitHub([{ runs: [self] }], new Response("missing", { status: 404 }));

    await expect(waitForQaTurn({ env: ENV, fetch, sleep: vi.fn(), now: () => 0, log: vi.fn() }))
      .rejects.toThrow("Could not read this workflow run (500): GitHub API returned 404.");
  });

  it("refuses to queue a fork run, which never deploys to QA", async () => {
    for (const [headRepository, shown] of [[FORK, "someone/spoonjoy-v2"], [null, "an unknown repository"]] as const) {
      const { fetch } = fakeGitHub([{ runs: [] }], { ...self, head_repository: headRepository });
      await expect(waitForQaTurn({ env: ENV, fetch, sleep: vi.fn(), now: () => 0, log: vi.fn() }))
        .rejects.toThrow(`Run 500 is from ${shown}, not spoonjoy/spoonjoy-v2; fork runs never deploy to QA.`);
    }
  });

  it("requires the GitHub Actions environment", async () => {
    for (const missing of ["GITHUB_TOKEN", "GITHUB_REPOSITORY", "GITHUB_RUN_ID"] as const) {
      const env = { ...ENV, [missing]: "" };
      await expect(waitForQaTurn({ env, fetch: vi.fn(), sleep: vi.fn(), now: () => 0, log: vi.fn() }))
        .rejects.toThrow(`${missing} is required to find this run's turn on QA.`);
    }
  });

  it("uses GitHub's public API and the documented defaults when not overridden", async () => {
    const { GITHUB_API_URL: _unused, ...env } = ENV;
    const { fetch, requests } = fakeGitHub([{ runs: [self] }]);

    await waitForQaTurn({ env, fetch, log: vi.fn(), sleep: vi.fn(), now: () => 0 });

    expect(requests[0].url).toBe("https://api.github.com/repos/spoonjoy/spoonjoy-v2/actions/runs/500");
    expect(DEFAULT_POLL_MS).toBe(60_000);
    expect(DEFAULT_MAX_WAIT_MS).toBe(90 * 60_000);
    expect(LISTED_RUN_STATUSES).toEqual(["queued", "in_progress"]);
    expect(QA_TURN_JOB_NAME).toBe("wait for QA");
  });

  it("treats listings without workflow_runs or jobs as empty", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/actions/runs/500")) return jsonResponse(self);
      if (url.includes("/jobs")) return jsonResponse({});
      if (url.includes("status=queued")) return jsonResponse({ workflow_runs: [run(900, "queued", "2026-09-27T06:00:00Z")] });
      return jsonResponse({ total_count: 0 });
    });

    await expect(waitForQaTurn({ env: ENV, fetch, sleep: vi.fn(), now: () => 0, log: vi.fn() })).resolves.toEqual({ waitedMs: 0 });
  });
});

describe("main and CLI guard", () => {
  it("runs with process-level defaults: real timers, console and global fetch", async () => {
    const { fetch } = fakeGitHub([{ runs: [self] }]);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    try {
      await expect(main({ env: ENV })).resolves.toEqual({ waitedMs: 0 });
      expect(log).toHaveBeenCalledWith("No Journeys run is ahead of run 500 or on QA; starting now.");
    } finally {
      globalThis.fetch = originalFetch;
      log.mockRestore();
    }
  });

  it("uses process.env by default", async () => {
    const saved = { ...process.env };
    Object.assign(process.env, ENV);
    const { fetch } = fakeGitHub([{ runs: [self] }]);
    try {
      await expect(main({ fetch, log: vi.fn(), sleep: vi.fn(), now: () => 0 })).resolves.toEqual({ waitedMs: 0 });
    } finally {
      process.env = saved;
    }
  });

  it("can be called with no arguments, as the CLI does, and still validates its environment first", async () => {
    const saved = { ...process.env };
    process.env = { ...saved, GITHUB_TOKEN: "" };
    try {
      await expect(main()).rejects.toThrow("GITHUB_TOKEN is required to find this run's turn on QA.");
    } finally {
      process.env = saved;
    }
  });

  it("sleeps for real between polls by default", async () => {
    vi.useFakeTimers();
    try {
      const { fetch } = fakeGitHub([{ runs: [self, run(1, "in_progress", "2026-09-27T04:00:00Z")] }, { runs: [self] }]);
      const pending = main({ env: ENV, fetch, log: vi.fn(), pollMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toEqual({ waitedMs: 1000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("detects the CLI entrypoint and runs main only then", async () => {
    expect(isCliEntry("file:///repo/scripts/wait-for-qa-turn.mjs", "/repo/scripts/wait-for-qa-turn.mjs")).toBe(true);
    expect(isCliEntry("file:///repo/scripts/wait-for-qa-turn.mjs", "/repo/other.mjs")).toBe(false);
    expect(isCliEntry("file:///repo/scripts/wait-for-qa-turn.mjs", undefined)).toBe(false);

    const runMain = vi.fn(async () => ({ waitedMs: 0 }));
    const onError = vi.fn();
    await expect(runCliIfEntry({ moduleUrl: "file:///a.mjs", argv1: "/b.mjs", runMain, onError })).resolves.toBe(false);
    expect(runMain).not.toHaveBeenCalled();
    await expect(runCliIfEntry({ moduleUrl: "file:///a.mjs", argv1: "/a.mjs", runMain, onError })).resolves.toBe(true);
    expect(runMain).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    const failure = new Error("boom");
    await runCliIfEntry({ moduleUrl: "file:///a.mjs", argv1: "/a.mjs", runMain: async () => { throw failure; }, onError });
    expect(onError).toHaveBeenCalledWith(failure);
    await expect(runCliIfEntry()).resolves.toBe(false);
  });

  it("reports errors as GitHub Actions error annotations and fails the step", () => {
    const io = { error: vi.fn() };
    const exitCode = process.exitCode;
    try {
      defaultCliErrorHandler(new Error("waited too long"), io);
      expect(io.error).toHaveBeenCalledWith("::error::waited too long");
      expect(process.exitCode).toBe(1);
      defaultCliErrorHandler("plain", io);
      expect(io.error).toHaveBeenCalledWith("::error::plain");
    } finally {
      process.exitCode = exitCode;
    }
  });

  it("defaults the error handler's output to console.error", () => {
    const exitCode = process.exitCode;
    try {
      expectConsoleError("::error::queue-default-output");
      defaultCliErrorHandler(new Error("queue-default-output"));
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = exitCode;
    }
  });
});

describe("Journeys workflow queue wiring", () => {
  const workflow = parse(readFileSync(resolve(__dirname, "../../.github/workflows/journeys.yml"), "utf8"));
  const FORK_GATE = "(github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)";
  const journeysSteps: Array<{ name?: string; if?: string; run?: string; env?: Record<string, string> }> =
    workflow.jobs.journeys.steps;

  it("makes the journeys job wait for its turn in a fork-gated qa-turn job with only actions: read and contents: read", () => {
    const qaTurn = workflow.jobs["qa-turn"];

    expect(workflow.jobs.journeys.needs).toBe("qa-turn");
    expect(qaTurn.name).toBe(QA_TURN_JOB_NAME);
    expect(qaTurn.if).toBe(FORK_GATE);
    expect(qaTurn.permissions).toEqual({ actions: "read", contents: "read" });
    expect(qaTurn["timeout-minutes"]).toBeGreaterThanOrEqual(DEFAULT_MAX_WAIT_MS / 60_000 + 15);
    const wait = qaTurn.steps.find((step: { name?: string }) => step.name === "Wait for this run's turn on QA");
    expect(wait.run).toBe("node scripts/wait-for-qa-turn.mjs");
    expect(wait.env).toEqual({ GITHUB_TOKEN: "${{ github.token }}" });
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  it("fails the required journeys check, never skips it, when qa-turn did not succeed", () => {
    // A skipped required check counts as passing, so journeys must run (fork gating aside) and
    // fail as its first step whenever qa-turn failed or timed out.
    expect(workflow.jobs.journeys.name).toBe("journeys");
    expect(workflow.jobs.journeys.if).toBe(`\${{ !cancelled() && ${FORK_GATE} }}`);
    const [gate] = journeysSteps;
    expect(gate.name).toBe("Require this run's turn on QA");
    expect(gate.if).toBe("needs.qa-turn.result != 'success'");
    expect(gate.env).toEqual({ QA_TURN_RESULT: "${{ needs.qa-turn.result }}" });
    expect(gate.run).toContain("::error::");
    expect(gate.run).toContain("exit 1");
  });

  it("never touches QA from a run that did not get its turn", () => {
    // always() steps would otherwise rotate passwords and clean up QA under another run's feet.
    for (const name of ["Stop QA Worker tail and summarise it", "Rotate persona passwords", "Clean up disposable QA data"]) {
      const step = journeysSteps.find((candidate) => candidate.name === name);
      expect(step?.if, name).toBe("always() && needs.qa-turn.result == 'success'");
    }
    for (const step of journeysSteps.filter((candidate) => candidate.if?.startsWith("always()"))) {
      if (step.name === "Remove credentials and session files" || step.name === "Strip network logs from traces") continue;
      expect(step.if, step.name).toContain("needs.qa-turn.result == 'success'");
    }
  });

  it("never shares a cancel-prone group across branches, and never cancels a run in progress", () => {
    expect(workflow.jobs.journeys.concurrency).toBeUndefined();
    expect(JSON.stringify(workflow)).not.toContain("qa-environment");
    expect(workflow.concurrency).toEqual({
      group:
        "journeys-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}",
      "cancel-in-progress": false,
    });
  });
});
