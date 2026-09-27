// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { expectConsoleError } from "../warning-policy";
import {
  ACTIVE_RUN_STATUSES,
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_POLL_MS,
  defaultCliErrorHandler,
  isAheadInQueue,
  isCliEntry,
  main,
  queueKey,
  runCliIfEntry,
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
}

const self: FakeRun = { id: 500, status: "in_progress", run_started_at: "2026-09-27T05:00:00Z", run_attempt: 1 };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// A fake GitHub API: GET /actions/runs/:id returns `selfRun`, and each list call returns the
// next entry of `listings` (the last one repeats).
function fakeGitHub(listings: Array<FakeRun[] | Response | Error>, selfRun: FakeRun | Response = self) {
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  let call = 0;
  const fetch = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    requests.push({ url, headers: init.headers });
    if (url.includes("/actions/runs/500")) {
      return selfRun instanceof Response ? selfRun : jsonResponse(selfRun);
    }
    const listing = listings[Math.min(call, listings.length - 1)];
    call += 1;
    if (listing instanceof Error) throw listing;
    if (listing instanceof Response) return listing;
    return jsonResponse({ total_count: listing.length, workflow_runs: listing });
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

describe("queue order", () => {
  it("orders runs by the start of their current attempt, then by run id", () => {
    const me = queueKey(self);
    expect(isAheadInQueue(queueKey({ id: 900, status: "in_progress", run_started_at: "2026-09-27T04:59:59Z" }), me)).toBe(true);
    expect(isAheadInQueue(queueKey({ id: 100, status: "in_progress", run_started_at: "2026-09-27T05:00:01Z" }), me)).toBe(false);
    expect(isAheadInQueue(queueKey({ id: 499, status: "queued", run_started_at: "2026-09-27T05:00:00Z" }), me)).toBe(true);
    expect(isAheadInQueue(queueKey({ id: 501, status: "queued", run_started_at: "2026-09-27T05:00:00Z" }), me)).toBe(false);
  });

  it("puts a re-run at the back of the queue even though it keeps its old, lower id", () => {
    const rerun = queueKey({ id: 12, status: "in_progress", run_attempt: 2, run_started_at: "2026-09-27T05:10:00Z" });
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
});

describe("waitForQaTurn", () => {
  it("goes straight to QA when no run is ahead, ignoring itself, finished runs and runs queued behind it", async () => {
    const { fetch, requests } = fakeGitHub([[
      self,
      { id: 400, status: "completed", run_started_at: "2026-09-27T04:00:00Z" },
      { id: 600, status: "queued", run_started_at: "2026-09-27T05:05:00Z" },
      { id: 601, status: "in_progress", run_started_at: "2026-09-27T05:06:00Z" },
    ]]);
    const time = clock();
    const log = vi.fn();

    await expect(waitForQaTurn({ env: ENV, fetch, sleep: time.sleep, now: time.now, log })).resolves.toEqual({ waitedMs: 0 });

    expect(time.sleep).not.toHaveBeenCalled();
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.github.test/repos/spoonjoy/spoonjoy-v2/actions/runs/500",
      "https://api.github.test/repos/spoonjoy/spoonjoy-v2/actions/workflows/journeys.yml/runs?per_page=100",
    ]);
    expect(requests[0].headers).toEqual({
      Accept: "application/vnd.github+json",
      Authorization: "Bearer ghs_test",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "spoonjoy-wait-for-qa-turn",
    });
    expect(log).toHaveBeenLastCalledWith("No Journeys run is ahead of run 500 on QA; starting now.");
  });

  it("waits, polling, until every run ahead of it has finished", async () => {
    const ahead = { id: 450, status: "in_progress", run_started_at: "2026-09-27T04:30:00Z", head_branch: "claude/a", event: "pull_request", html_url: "https://github.test/runs/450" };
    const queuedAhead = { id: 460, status: "queued", run_started_at: "2026-09-27T04:40:00Z", head_branch: "main", event: "push" };
    const { fetch } = fakeGitHub([
      [self, ahead, queuedAhead],
      [self, { ...ahead, status: "completed" }, { ...queuedAhead, status: "in_progress" }],
      [self, { ...queuedAhead, status: "completed" }],
    ]);
    const time = clock();
    const log = vi.fn();

    await expect(waitForQaTurn({ env: ENV, fetch, sleep: time.sleep, now: time.now, log, pollMs: 1000 }))
      .resolves.toEqual({ waitedMs: 2000 });

    expect(time.sleep).toHaveBeenCalledTimes(2);
    expect(time.sleep).toHaveBeenCalledWith(1000);
    expect(log).toHaveBeenCalledWith(
      "Waiting for 2 Journeys run(s) ahead of run 500 on QA: 450 (in_progress, pull_request on claude/a, https://github.test/runs/450); 460 (queued, push on main)",
    );
    expect(log).toHaveBeenCalledWith("Waiting for 1 Journeys run(s) ahead of run 500 on QA: 460 (in_progress, push on main)");
    expect(log).toHaveBeenLastCalledWith("No Journeys run is ahead of run 500 on QA; starting now.");
  });

  it("counts every active status as holding or queued for QA", async () => {
    expect(ACTIVE_RUN_STATUSES).toEqual(["queued", "in_progress", "waiting", "requested", "pending"]);
    const listing = ACTIVE_RUN_STATUSES.map((status, index) => ({
      id: 10 + index,
      status,
      run_started_at: "2026-09-27T04:00:00Z",
    }));
    const { fetch } = fakeGitHub([listing, [self]]);
    const time = clock();
    const log = vi.fn();

    await waitForQaTurn({ env: ENV, fetch, sleep: time.sleep, now: time.now, log, pollMs: 5 });

    expect(log.mock.calls[0][0]).toMatch(/^Waiting for 5 Journeys run\(s\)/);
  });

  it("fails with a clear message once the maximum wait is used up", async () => {
    const stuck = { id: 42, status: "queued", run_started_at: "2026-09-27T01:00:00Z", head_branch: "claude/stuck", event: "pull_request" };
    const { fetch } = fakeGitHub([[self, stuck]]);
    const time = clock();

    await expect(waitForQaTurn({ env: ENV, fetch, sleep: time.sleep, now: time.now, log: vi.fn(), pollMs: 60_000, maxWaitMs: 180_000 }))
      .rejects.toThrow(
        "Run 500 waited 3 min for QA and 1 Journeys run(s) are still ahead of it: 42 (queued, pull_request on claude/stuck). " +
          "Cancel or finish the runs ahead, then re-run this one.",
      );
    expect(time.sleep).toHaveBeenCalledTimes(3);
  });

  it("retries through GitHub server errors and network failures instead of skipping the queue", async () => {
    const { fetch } = fakeGitHub([
      new Response("unavailable", { status: 503 }),
      new Error("socket hang up"),
      [self],
    ]);
    const time = clock();
    const log = vi.fn();

    await expect(waitForQaTurn({ env: ENV, fetch, sleep: time.sleep, now: time.now, log, pollMs: 10 }))
      .resolves.toEqual({ waitedMs: 20 });
    expect(log).toHaveBeenCalledWith("Could not list Journeys runs (GitHub API returned 503); retrying.");
    expect(log).toHaveBeenCalledWith("Could not list Journeys runs (socket hang up); retrying.");
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
    const { fetch } = fakeGitHub([[self]], new Response("missing", { status: 404 }));

    await expect(waitForQaTurn({ env: ENV, fetch, sleep: vi.fn(), now: () => 0, log: vi.fn() }))
      .rejects.toThrow("Could not read this workflow run (500): GitHub API returned 404.");
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
    const { fetch, requests } = fakeGitHub([[self]]);
    const log = vi.fn();

    await waitForQaTurn({ env, fetch, log, sleep: vi.fn(), now: () => 0 });

    expect(requests[0].url).toBe("https://api.github.com/repos/spoonjoy/spoonjoy-v2/actions/runs/500");
    expect(DEFAULT_POLL_MS).toBe(30_000);
    expect(DEFAULT_MAX_WAIT_MS).toBe(90 * 60_000);
  });

  it("treats a listing without workflow_runs as no active runs", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("/actions/runs/500") ? jsonResponse(self) : jsonResponse({ total_count: 0 }));

    await expect(waitForQaTurn({ env: ENV, fetch, sleep: vi.fn(), now: () => 0, log: vi.fn() })).resolves.toEqual({ waitedMs: 0 });
  });
});

describe("main and CLI guard", () => {
  it("runs with process-level defaults: real timers, console and global fetch", async () => {
    const { fetch } = fakeGitHub([[self]]);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    try {
      await expect(main({ env: ENV })).resolves.toEqual({ waitedMs: 0 });
      expect(log).toHaveBeenCalledWith("No Journeys run is ahead of run 500 on QA; starting now.");
    } finally {
      globalThis.fetch = originalFetch;
      log.mockRestore();
    }
  });

  it("uses process.env by default", async () => {
    const saved = { ...process.env };
    Object.assign(process.env, ENV);
    const { fetch } = fakeGitHub([[self]]);
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
      const { fetch } = fakeGitHub([[self, { id: 1, status: "in_progress", run_started_at: "2026-09-27T04:00:00Z" }], [self]]);
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

  it("makes the journeys job wait for its turn in a qa-turn job with only actions: read and contents: read", () => {
    const qaTurn = workflow.jobs["qa-turn"];

    expect(workflow.jobs.journeys.needs).toBe("qa-turn");
    expect(qaTurn.if).toBe(workflow.jobs.journeys.if);
    expect(qaTurn.permissions).toEqual({ actions: "read", contents: "read" });
    expect(qaTurn["timeout-minutes"]).toBeGreaterThan(DEFAULT_MAX_WAIT_MS / 60_000);
    const wait = qaTurn.steps.find((step: { name?: string }) => step.name === "Wait for this run's turn on QA");
    expect(wait.run).toBe("node scripts/wait-for-qa-turn.mjs");
    expect(wait.env).toEqual({ GITHUB_TOKEN: "${{ github.token }}" });
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  it("never shares a cancel-prone concurrency group across branches, and cancels only a superseded pull request run", () => {
    expect(workflow.jobs.journeys.concurrency).toBeUndefined();
    expect(JSON.stringify(workflow)).not.toContain("qa-environment");
    expect(workflow.concurrency).toEqual({
      group:
        "journeys-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}",
      "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
    });
  });
});
