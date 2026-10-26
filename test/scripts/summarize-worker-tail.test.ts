// @vitest-environment node
// Locks the Worker tail summary that the Journeys workflow uploads in its public report artifact:
// the jq program's field allowlist, the redaction of exception messages and of the error-level
// log lines kept for per-run QA Workers only, the completeness flag, and the workflow wiring that
// keeps the raw tail stream out of every upload.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { expectNoSecrets, FAKE_SECRETS, secretLine, secretMessage } from "../fixtures/fake-secrets";

const ROOT = resolve(__dirname, "../..");
const PROGRAM = resolve(ROOT, "scripts/summarize-worker-tail.jq");
const WORKFLOW = resolve(ROOT, ".github/workflows/journeys.yml");

type TailEvent = Record<string, unknown>;

function summarize(events: TailEvent[], tailAliveAtStop = true, extraArgs: string[] = []) {
  const output = execFileSync(
    "jq",
    ["-s", "--argjson", "tailAliveAtStop", String(tailAliveAtStop), ...extraArgs, "-f", PROGRAM],
    { input: events.map((event) => JSON.stringify(event)).join("\n"), encoding: "utf8" },
  );
  return { summary: JSON.parse(output), raw: output };
}

const CANARIES = {
  cookie: "canary-session-cookie-value",
  bearer: "canary-bearer-token-value",
  apiToken: "sj_canarytokenvalue123456",
  body: "canary-request-body",
  logLine: "canary-console-log-line",
  query: "canary-oauth-code",
  email: "canary.person@example.com",
  cf: "canary-cf-colo",
  hex: "deadbeefcafebabe0123456789abcdef0123456789abcdef",
};

function hostileEvent(overrides: TailEvent = {}): TailEvent {
  return {
    outcome: "exception",
    scriptName: "spoonjoy-v2-qa",
    eventTimestamp: 1790000000000,
    cpuTime: 12,
    wallTime: 340,
    logs: [{ level: "log", message: [CANARIES.logLine], timestamp: 1 }],
    diagnosticsChannelEvents: [{ channel: "x", message: CANARIES.logLine }],
    event: {
      request: {
        url: `https://user:pass@spoonjoy-v2-qa.example/oauth/callback?code=${CANARIES.query}&state=s#frag`,
        method: "POST",
        headers: {
          cookie: `__session=${CANARIES.cookie}`,
          authorization: `Bearer ${CANARIES.bearer}`,
        },
        body: CANARIES.body,
        cf: { colo: CANARIES.cf },
      },
      response: { status: 500 },
    },
    exceptions: [
      {
        name: "Error",
        message: [
          // V8's JSON.parse error quotes a snippet of the text it parsed, which can be a request body.
          `Unexpected token 'c', "${CANARIES.body}" is not valid JSON`,
          `lookup failed for ${CANARIES.email}`,
          `Authorization: Bearer ${CANARIES.bearer}`,
          `token ${CANARIES.apiToken}`,
          `cookie __session=${CANARIES.cookie}; Path=/`,
          `fetch /oauth/callback?code=${CANARIES.query}`,
          `digest ${CANARIES.hex}`,
        ].join(" | "),
        timestamp: 2,
      },
    ],
    ...overrides,
  };
}

const INVOCATION_KEYS = ["cpuTime", "entrypoint", "eventTimestamp", "exceptions", "executionModel", "method", "outcome", "path", "status", "wallTime"];

describe("summarize-worker-tail.jq", () => {
  it("copies only allowlisted fields, so no header, cookie, body, log, cf or query value leaves the tail", () => {
    const { summary, raw } = summarize([hostileEvent(), hostileEvent({ outcome: "ok" })]);

    expect(Object.keys(summary).sort()).toEqual([
      "budget",
      "byPath",
      "complete",
      "d1ReadReissues",
      "d1TransientErrors",
      "firstEventTimestamp",
      "firstExceptions",
      "hungInvocations",
      "isolates",
      "lastEventTimestamp",
      "nonOkInvocations",
      "outcomes",
      "serverErrorInvocations",
      "slowCalls",
      "slowest",
      "stalledInvocations",
      "stalledRequests",
      "tailAliveAtStop",
      "tailReconnects",
      "totalInvocations",
    ]);
    expect(Object.keys(summary.d1TransientErrors).sort()).toEqual(["notRetried", "notRetriedWrites", "retried", "total", "writeOperations"]);
    for (const invocation of [...summary.nonOkInvocations, ...summary.firstExceptions, ...summary.slowest, ...summary.serverErrorInvocations]) {
      expect(Object.keys(invocation).sort()).toEqual(INVOCATION_KEYS);
      for (const exception of invocation.exceptions) expect(Object.keys(exception).sort()).toEqual(["message", "name"]);
    }
    for (const entry of summary.byPath) expect(Object.keys(entry).sort()).toEqual(["count", "cpuTime", "path", "wallTime"]);
    expect(Object.keys(summary.budget).sort()).toEqual(["cpuTimeP95Ms", "overBudget"]);
    for (const entry of summary.budget.overBudget) expect(Object.keys(entry).sort()).toEqual(["count", "cpuTime", "path"]);

    for (const [name, canary] of Object.entries(CANARIES)) {
      expect(raw, `${name} canary leaked`).not.toContain(canary);
    }
    expect(raw).not.toMatch(/user:pass|spoonjoy-v2-qa\.example|#frag/);
    expect(summary.nonOkInvocations[0]).toMatchObject({
      outcome: "exception",
      path: "/oauth/callback",
      method: "POST",
      status: 500,
      cpuTime: 12,
      wallTime: 340,
      eventTimestamp: 1790000000000,
    });
  });

  it("redacts exception messages and caps them at 200 characters", () => {
    const { summary } = summarize([hostileEvent()]);
    const message: string = summary.firstExceptions[0].exceptions[0].message;

    expect(message.length).toBeLessThanOrEqual(200);
    expect(message).toContain(`Unexpected token 'c', "[redacted]" is not valid JSON`);
    expect(message).toContain("[email]");
    expect(message).toContain("Bearer [token]");

    const single = (text: string) =>
      summarize([hostileEvent({ exceptions: [{ name: "Error", message: text }] })]).summary.firstExceptions[0].exceptions[0].message;
    expect(single("no user for someone.else+tag@sub.example.org here")).toBe("no user for [email] here");
    expect(single("sent bearer abc.def-ghi_jkl~mno")).toBe("sent Bearer [token]");
    expect(single(`used ${CANARIES.apiToken} twice`)).toBe("used [token] twice");
    expect(single("got theme=dark; lang=en; end")).toBe("got [cookie]; [cookie]; end");
    expect(single("got __session=abc123 and __oauth=xyz")).toBe("got [cookie] and [cookie]");
    expect(single("GET /recipes/1?q=secret&x=y failed")).toBe("GET /recipes/1?[query] failed");
    expect(single(`hash ${CANARIES.hex}`)).toBe("hash [token]");
    expect(single('Invalid `prisma.user.findUnique()` invocation: where: { email: "a@b.co", username: "chef" }'))
      .toBe('Invalid `prisma.user.findUnique()` invocation: where: { email: "[redacted]", username: "[redacted]" }');
    expect(single("unknown recipe 'lemon-herb-rice' for 'x'")).toBe("unknown recipe '[redacted]' for 'x'");
    expect(single("word ".repeat(100))).toHaveLength(200);
    expect(single("plain failure")).toBe("plain failure");
  });

  it("keeps exception names short and tolerates missing or odd exception fields", () => {
    const { summary } = summarize([
      hostileEvent({ exceptions: [{ name: "N".repeat(300), message: 42 }, {}] }),
    ]);

    expect(summary.firstExceptions[0].exceptions).toEqual([
      { name: "N".repeat(100), message: "42" },
      { name: null, message: "" },
    ]);
  });

  it("marks the summary complete only when the tail was alive at the end and recorded events", () => {
    expect(summarize([hostileEvent()], true).summary).toMatchObject({ complete: true, tailAliveAtStop: true });
    expect(summarize([hostileEvent()], false).summary).toMatchObject({ complete: false, tailAliveAtStop: false });
    expect(summarize([], true).summary).toMatchObject({
      complete: false,
      tailAliveAtStop: true,
      totalInvocations: 0,
      firstEventTimestamp: null,
      lastEventTimestamp: null,
      outcomes: {},
      nonOkInvocations: [],
      serverErrorInvocations: [],
      hungInvocations: 0,
      stalledInvocations: 0,
      firstExceptions: [],
      slowest: [],
      byPath: [],
      budget: { cpuTimeP95Ms: 10, overBudget: [] },
    });
  });

  it("marks a tail that reconnected after a drop incomplete, and records how often it reconnected", () => {
    expect(summarize([hostileEvent()], true).summary).toMatchObject({ complete: true, tailReconnects: 0 });
    expect(summarize([hostileEvent()], true, ["--argjson", "tailReconnects", "0"]).summary)
      .toMatchObject({ complete: true, tailReconnects: 0 });
    expect(summarize([hostileEvent()], true, ["--argjson", "tailReconnects", "2"]).summary)
      .toMatchObject({ complete: false, tailAliveAtStop: true, tailReconnects: 2 });
    expect(summarize([hostileEvent()], true, ["--argjson", "tailReconnects", '"x"']).summary)
      .toMatchObject({ complete: true, tailReconnects: 0 });
  });

  it("counts the Worker's transient D1 error reports, retried or not, reading only their fixed fields", () => {
    const report = (fields: Record<string, unknown>) =>
      JSON.stringify({ event: "d1_transient_error", call: "all", attempt: 1, kind: "network_connection_lost", ...fields });
    const { summary, raw } = summarize([
      hostileEvent({
        outcome: "ok",
        logs: [
          { level: "warn", message: [report({ operation: "read", willRetry: true })] },
          { level: "warn", message: [report({ operation: "read", willRetry: false, extra: CANARIES.logLine })] },
          { level: "error", message: report({ operation: "write", willRetry: false }) },
          { level: "warn", message: [{ event: "d1_transient_error", operation: "bogus", willRetry: "yes" }] },
          { level: "warn", message: ["{not json", JSON.stringify({ event: "other" }), 7] },
          "not an object",
        ],
      }),
      hostileEvent({ logs: "not an array" }),
      hostileEvent({ logs: undefined }),
    ]);
    const none = { retried: 0, applied: 0, gaveUp: 0 };
    expect(summary.d1TransientErrors).toEqual({ total: 4, retried: 1, notRetried: 3, notRetriedWrites: 2, writeOperations: none });
    expect(raw).not.toContain(CANARIES.logLine);
    expect(summarize([]).summary.d1TransientErrors).toEqual({ total: 0, retried: 0, notRetried: 0, notRetriedWrites: 0, writeOperations: none });
  });

  it("counts the D1 reads sent again after stalling, and how many the re-issued try answered, reading only that field", () => {
    const line = (answeredBy: unknown) => JSON.stringify({ event: "d1_read_reissue", call: "batch", table: "Cookbook", attempt: 1, answeredBy, sql: CANARIES.query });
    const { summary, raw } = summarize([
      { outcome: "ok", logs: [{ level: "warn", message: [line("reissue")] }, { level: "warn", message: [line("original")] }] },
      { outcome: "ok", logs: [{ level: "warn", message: [{ event: "d1_read_reissue", answeredBy: CANARIES.body }] }, { level: "warn", message: ["not json"] }] },
    ]);

    expect(summary.d1ReadReissues).toEqual({ total: 3, answeredByReissue: 1 });
    expect(raw).not.toContain(CANARIES.query);
    expect(raw).not.toContain(CANARIES.body);
  });

  it("counts the writes an operation retried safely, found applied or gave up on, and leaves out of notRetriedWrites the ones it handled", () => {
    const transient = (fields: Record<string, unknown>) =>
      JSON.stringify({ event: "d1_transient_error", call: "batch", attempt: 1, kind: "network_connection_lost", ...fields });
    const operation = (outcome: unknown, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ event: "d1_write_retry", scope: "spoon.create", attempt: 1, kind: "network_connection_lost", outcome, ...extra });
    const { summary, raw } = summarize([
      hostileEvent({
        outcome: "ok",
        logs: [
          { level: "warn", message: [transient({ operation: "write", willRetry: false })] },
          { level: "warn", message: [operation("retry", { scope: CANARIES.logLine })] },
          { level: "warn", message: [transient({ operation: "write", willRetry: false })] },
          { level: "warn", message: [operation("applied")] },
          { level: "warn", message: [transient({ operation: "write", willRetry: false })] },
          { level: "warn", message: [operation("gave_up")] },
          { level: "warn", message: [transient({ operation: "write", willRetry: false })] },
          { level: "warn", message: [operation("bogus")] },
          { level: "warn", message: [transient({ operation: "write", willRetry: false })] },
        ],
      }),
      // An operation's failure that was a read out of retries is never counted below zero writes.
      hostileEvent({ logs: [{ level: "warn", message: [operation("retry")] }] }),
    ]);
    expect(summary.d1TransientErrors).toEqual({
      total: 5,
      retried: 0,
      notRetried: 5,
      notRetriedWrites: 0,
      writeOperations: { retried: 2, applied: 1, gaveUp: 1 },
    });
    expect(raw).not.toContain(CANARIES.logLine);
    const unhandled = summarize([hostileEvent({ logs: [{ level: "warn", message: [transient({ operation: "write", willRetry: false })] }] })]);
    expect(unhandled.summary.d1TransientErrors.notRetriedWrites).toBe(1);
  });

  it("records the time window the tail covered", () => {
    const { summary } = summarize([
      hostileEvent({ eventTimestamp: 300 }),
      hostileEvent({ eventTimestamp: 100 }),
      hostileEvent({ eventTimestamp: undefined }),
    ]);

    expect(summary).toMatchObject({ firstEventTimestamp: 100, lastEventTimestamp: 300 });
  });

  it("lists the 25 slowest invocations and per-route wall and CPU percentiles with per-run ids collapsed", () => {
    const load = (path: string, wallTime: number | undefined, cpuTime: number | undefined, outcome = "ok") => ({
      outcome,
      eventTimestamp: 1,
      ...(wallTime === undefined ? {} : { wallTime }),
      ...(cpuTime === undefined ? {} : { cpuTime }),
      event: { request: { url: `https://qa.example${path}?_routes=root`, method: "GET" }, response: { status: 200 } },
    });
    const events = [
      ...[100, 200, 300, 400].map((wall, index) => load(`/recipes/cmg${index}abcdefghijklmnopqrstu.data`, wall, 20 + index)),
      load("/recipes/cmg9abcdefghijklmnopqrstu.data", 3840, 27, "canceled"),
      load("/recipes/qa-kitchen-recipe-lemon-rice", 250, 15),
      load("/users/codex_e2e_20260927t041600z_abc123/kitchen-visitors", 80, 5),
      load("/cookbooks/123/items/0f8fad5b-d9cb-469f-a165-70867728950e", 60, 4),
      load("/search", undefined, undefined),
      ...Array.from({ length: 30 }, () => load("/health", 1, 1)),
    ];

    const { summary } = summarize(events);

    expect(summary.slowest).toHaveLength(25);
    expect(summary.slowest.slice(0, 2).map((entry: { wallTime: number }) => entry.wallTime)).toEqual([3840, 400]);
    expect(summary.slowest[0]).toMatchObject({ path: "/recipes/cmg9abcdefghijklmnopqrstu.data", outcome: "canceled" });
    expect(summary.byPath[0]).toEqual({
      path: "/recipes/:id.data",
      count: 5,
      wallTime: { p50: 300, p95: 3840, max: 3840 },
      cpuTime: { p50: 22, p95: 27, max: 27 },
    });
    const paths = summary.byPath.map((entry: { path: string }) => entry.path);
    expect(paths).toEqual(expect.arrayContaining([
      "/recipes/qa-kitchen-recipe-lemon-rice",
      "/users/:id/kitchen-visitors",
      "/cookbooks/:id/items/:id",
      "/search",
      "/health",
    ]));
    expect(summary.byPath.find((entry: { path: string }) => entry.path === "/search")).toEqual({
      path: "/search",
      count: 1,
      wallTime: { p50: null, p95: null, max: null },
      cpuTime: { p50: null, p95: null, max: null },
    });
  });

  it("lists the routes whose p95 CPU time is over the 10 ms budget, worst first", () => {
    const load = (path: string, cpuTime: number | undefined) => ({
      outcome: cpuTime !== undefined && cpuTime > 10 ? "exceededCpu" : "ok",
      eventTimestamp: 1,
      wallTime: 100,
      ...(cpuTime === undefined ? {} : { cpuTime }),
      event: { request: { url: `https://qa.example${path}`, method: "GET" }, response: { status: 200 } },
    });
    const events = [
      // p95 is the nearest-rank value: 19 requests at 4 ms and one at 30 ms stay in budget.
      ...Array.from({ length: 19 }, () => load("/_root.data", 4)),
      load("/_root.data", 30),
      ...[8, 9, 12, 40].map((cpu) => load("/search.data", cpu)),
      ...[24, 43, 87].map((cpu, index) => load(`/recipes/cmg${index}abcdefghijklmnopqrstu.data`, cpu)),
      load("/account/settings.data", 10),
      load("/health", undefined),
    ];

    const { summary } = summarize(events);

    expect(summary.budget).toEqual({
      cpuTimeP95Ms: 10,
      overBudget: [
        { path: "/recipes/:id.data", count: 3, cpuTime: { p50: 43, p95: 87, max: 87 } },
        { path: "/search.data", count: 4, cpuTime: { p50: 9, p95: 40, max: 40 } },
      ],
    });
  });

  it.each([
    { count: 1, p50: 1, p95: 1 },
    { count: 2, p50: 1, p95: 2 },
    { count: 3, p50: 2, p95: 3 },
    { count: 5, p50: 3, p95: 5 },
    { count: 20, p50: 10, p95: 19 },
    { count: 21, p50: 11, p95: 20 },
  ])("uses nearest rank for $count numeric timing samples", ({ count, p50, p95 }) => {
    const events: TailEvent[] = Array.from({ length: count }, (_, index) => ({
      outcome: "ok",
      cpuTime: count - index,
      wallTime: count - index,
      event: { request: { url: "https://qa.example/health", method: "GET" }, response: { status: 200 } },
    }));
    events.push({
      outcome: "ok",
      cpuTime: null,
      wallTime: "unknown",
      event: { request: { url: "https://qa.example/health", method: "GET" }, response: { status: 200 } },
    });

    const { summary } = summarize(events);

    expect(summary.byPath).toEqual([{
      path: "/health",
      count: count + 1,
      cpuTime: { p50, p95, max: count },
      wallTime: { p50, p95, max: count },
    }]);
  });

  it("lists every 5xx response, including ones the Worker returned normally, so an app-level 500 is on record", () => {
    // React Router turns a loader or action error into a 500 response and the invocation still
    // ends "ok", so nonOkInvocations misses it; Journeys run 37942328703 failed on such a
    // /login.data 500 that the summary did not show.
    const load = (path: string, status: number | undefined, outcome = "ok", eventTimestamp = 1) => ({
      outcome,
      eventTimestamp,
      wallTime: 40,
      cpuTime: 9,
      event: { request: { url: `https://qa.example${path}?x=1`, method: "POST" }, response: status === undefined ? undefined : { status } },
    });
    const events = [
      load("/login.data", 500, "ok", 3),
      load("/recipes/cmg1abcdefghijklmnopqrstu.data", 502, "ok", 4),
      load("/shopping-list.data", 500, "exception", 5),
      load("/missing", 404),
      load("/recipes", 200),
      load("/canceled", undefined, "canceled"),
      ...Array.from({ length: 60 }, (_, index) => load("/burst", 503, "ok", 100 + index)),
    ];

    const { summary } = summarize(events);

    expect(summary.serverErrorInvocations).toHaveLength(50);
    expect(summary.serverErrorInvocations.slice(0, 3)).toEqual([
      { outcome: "ok", path: "/login.data", method: "POST", status: 500, cpuTime: 9, wallTime: 40, eventTimestamp: 3, executionModel: null, entrypoint: null, exceptions: [] },
      { outcome: "ok", path: "/recipes/cmg1abcdefghijklmnopqrstu.data", method: "POST", status: 502, cpuTime: 9, wallTime: 40, eventTimestamp: 4, executionModel: null, entrypoint: null, exceptions: [] },
      { outcome: "exception", path: "/shopping-list.data", method: "POST", status: 500, cpuTime: 9, wallTime: 40, eventTimestamp: 5, executionModel: null, entrypoint: null, exceptions: [] },
    ]);
    expect(summary.serverErrorInvocations.map((entry: { status: number }) => entry.status)).not.toContain(404);
  });

  it("counts the requests the Workers runtime canceled as hung (Error 1101), whatever their outcome", () => {
    // Journeys runs 37942328703 and 37912555692 had 13 such 500s; the summary showed them only as
    // "exception" entries among the other non-ok invocations, with no count to compare runs by.
    const HUNG =
      "The Workers runtime canceled this request because it detected that your Worker's code had hung and would never generate a response. Refer to: https://developers.cloudflare.com/workers/observability/errors/";
    const at = (outcome: string, message?: string) => ({
      outcome,
      cpuTime: 12,
      wallTime: 20,
      event: { request: { url: "https://qa.example/api/cook-sessions/x", method: "GET" }, response: { status: 500 } },
      exceptions: message === undefined ? [] : [{ name: "Error", message }],
    });

    const { summary } = summarize([
      at("exception", HUNG),
      at("exception", HUNG),
      at("canceled", HUNG),
      at("exception", "memory access out of bounds"),
      at("exception", "Network connection lost."),
      at("ok"),
    ]);

    expect(summary.hungInvocations).toBe(3);
    expect(summarize([at("exception", "unreachable")]).summary.hungInvocations).toBe(0);
  });

  it("counts requests that waited over 2 s on under 5 ms of CPU, the shape of a request stuck on a promise", () => {
    // Runs 37956171261 (/recipes/:id.data, 1 ms CPU, 4,273 ms wall) and 37935772167 (/_root.data,
    // 1 ms CPU, 6,288 ms wall) each had one, canceled when Playwright gave up.
    const timed = (cpuTime: unknown, wallTime: unknown, outcome = "canceled") => ({
      outcome,
      cpuTime,
      wallTime,
      event: { request: { url: "https://qa.example/_root.data", method: "GET" } },
    });

    const { summary } = summarize([
      timed(1, 6288),
      timed(4, 2001, "ok"),
      timed(5, 4000),
      timed(33, 5146),
      timed(1, 2000),
      timed(1, 1500),
      timed(undefined, 9000),
      timed(1, undefined),
    ]);

    expect(summary.stalledInvocations).toBe(2);
  });

  describe("what a stalled request waited on", () => {
    const slowCall = (fields: Record<string, unknown>) =>
      JSON.stringify({ event: "slow_call", operation: "read", table: null, attempt: 1, settled: false, outcome: null, ...fields });
    const served = (isolate: unknown, request: unknown, arrivedAt: unknown) => JSON.stringify({ event: "isolate_request", isolate, request, arrivedAt });
    const runsIn = (isolate: unknown, colo: unknown) => JSON.stringify({ event: "isolate_colo", isolate, runsIn: colo });
    const request = (path: string, cpuTime: number, wallTime: number, eventTimestamp: number, messages: unknown[], extra: TailEvent = {}) => ({
      outcome: "canceled",
      cpuTime,
      wallTime,
      eventTimestamp,
      logs: messages.map((message) => ({ level: "warn", message: [message] })),
      event: { request: { url: `https://qa.example${path}`, method: "GET" } },
      ...extra,
    });

    it("attaches each stalled request's slow calls and where it ran, so the stall names the call it waited on", () => {
      // Run 40241845409: GET /cookbooks/:id.data waited 5,395 ms on 1 ms of CPU and was cancelled.
      const { summary } = summarize([
        request("/search", 30, 1400, 10, [
          served("0a1b2c3d", 1, "IAD"),
          runsIn("0a1b2c3d", "IAD"),
          slowCall({ call: "d1.first", table: "User", waitedMs: 1002, operation: "write", attempt: 2 }),
        ]),
        request("/api/cook-sessions/qa-kitchen-recipe-lemon-rice", 2, 3902, 20, [
          served("0a1b2c3d", 2, "IAD"),
          slowCall({ call: "cook_session.fetch", waitedMs: 1000 }),
          slowCall({ call: "cook_session.fetch", waitedMs: 3890, settled: true, outcome: "ok" }),
        ]),
        request("/api/cook-sessions/qa-kitchen-recipe-lemon-rice", 1, 3800, 21, [], { executionModel: "durableObject", entrypoint: "CookSession" }),
        request("/cookbooks/cmg1abcdefghijklmnopqrstu.data", 1, 5395, 30, [
          served("ffee0011", 1, "IAD"),
          slowCall({ call: "d1.batch", table: "Cookbook", waitedMs: 1001 }),
        ]),
        request("/health", 1, 20, 40, [served("ffee0011", 2, "EWR"), runsIn("ffee0011", "ORD")]),
      ]);

      expect(summary.stalledInvocations).toBe(3);
      expect(summary.stalledRequests.map((entry: { path: string; ranOn: unknown; slowCalls: unknown[] }) => [entry.path, entry.ranOn, entry.slowCalls])).toEqual([
        ["/api/cook-sessions/qa-kitchen-recipe-lemon-rice", { isolate: "0a1b2c3d", request: 2, arrivedAt: "IAD", runsIn: "IAD" }, [
          { call: "cook_session.fetch", operation: "read", table: null, attempt: 1, waitedMs: 1000, settled: false, outcome: null },
          { call: "cook_session.fetch", operation: "read", table: null, attempt: 1, waitedMs: 3890, settled: true, outcome: "ok" },
        ]],
        ["/api/cook-sessions/qa-kitchen-recipe-lemon-rice", null, []],
        ["/cookbooks/cmg1abcdefghijklmnopqrstu.data", { isolate: "ffee0011", request: 1, arrivedAt: "IAD", runsIn: "ORD" }, [
          { call: "d1.batch", operation: "read", table: "Cookbook", attempt: 1, waitedMs: 1001, settled: false, outcome: null },
        ]],
      ]);
      expect(summary.stalledRequests[1]).toMatchObject({ executionModel: "durableObject", entrypoint: "CookSession" });
      for (const entry of summary.stalledRequests) {
        expect(Object.keys(entry).sort()).toEqual([...INVOCATION_KEYS, "ranOn", "slowCalls"].sort());
      }

      // A slow call counts once, when it was reported waiting, whether or not the request stalled.
      expect(summary.slowCalls.total).toBe(3);
      expect(summary.slowCalls.byCall).toEqual({ "cook_session.fetch": 1, "d1.batch": 1, "d1.first": 1 });
      expect(summary.slowCalls.requests.map((entry: { path: string }) => entry.path)).toEqual([
        "/search",
        "/api/cook-sessions/qa-kitchen-recipe-lemon-rice",
        "/cookbooks/cmg1abcdefghijklmnopqrstu.data",
      ]);
      expect(summary.slowCalls.requests[0].slowCalls).toEqual([
        { call: "d1.first", operation: "write", table: "User", attempt: 2, waitedMs: 1002, settled: false, outcome: null },
      ]);

      expect(summary.isolates).toEqual([
        { isolate: "0a1b2c3d", runsIn: "IAD", arrivedAt: ["IAD"], requests: 2, firstEventTimestamp: 10, lastEventTimestamp: 20 },
        { isolate: "ffee0011", runsIn: "ORD", arrivedAt: ["EWR", "IAD"], requests: 2, firstEventTimestamp: 30, lastEventTimestamp: 40 },
      ]);
    });

    it("reads only the fixed fields of slow-call and isolate lines, each checked against its shape", () => {
      const { summary, raw } = summarize([
        request("/recipes/cmg1abcdefghijklmnopqrstu.data", 1, 4000, 1, [
          served(CANARIES.hex, "1", CANARIES.cf),
          runsIn(CANARIES.hex, CANARIES.cf),
          runsIn(42, "ORD"),
          JSON.stringify({
            event: "slow_call",
            call: `SELECT * FROM "User" WHERE email = '${CANARIES.email}'`,
            operation: "delete",
            table: `User; ${CANARIES.logLine}`,
            attempt: "2",
            waitedMs: -5,
            settled: "yes",
            outcome: CANARIES.body,
            sql: CANARIES.query,
          }),
          { event: "slow_call", call: "d1.raw", operation: "read", table: "Recipe", attempt: 1.5, waitedMs: 1200.7, settled: true, outcome: "error" },
        ], { executionModel: `durable ${CANARIES.hex}`, entrypoint: 42 }),
      ]);

      expect(summary.stalledRequests[0]).toMatchObject({
        ranOn: { isolate: null, request: null, arrivedAt: null, runsIn: null },
        executionModel: null,
        entrypoint: null,
      });
      expect(summary.isolates).toEqual([]);
      expect(summary.stalledRequests[0].slowCalls).toEqual([
        { call: null, operation: null, table: null, attempt: null, waitedMs: null, settled: false, outcome: null },
        { call: "d1.raw", operation: "read", table: "Recipe", attempt: 1, waitedMs: 1200, settled: true, outcome: "error" },
      ]);
      expect(summary.slowCalls.byCall).toEqual({ unknown: 1 });
      for (const [name, canary] of Object.entries(CANARIES)) {
        expect(raw, `${name} canary leaked`).not.toContain(canary);
      }
    });

    it("keeps the first 20 stalled requests and the first 40 requests with a slow call", () => {
      const events = Array.from({ length: 45 }, (_, index) =>
        request(`/r${index}`, 1, 3000, index, [slowCall({ call: "d1.first", waitedMs: 1000 })]));

      const { summary } = summarize(events);

      expect(summary.stalledInvocations).toBe(45);
      expect(summary.stalledRequests).toHaveLength(20);
      expect(summary.slowCalls.total).toBe(45);
      expect(summary.slowCalls.requests).toHaveLength(40);
      expect(summary.slowCalls.requests[39].path).toBe("/r39");
    });

    it("reports nothing to attach for a tail without the lines", () => {
      const { summary } = summarize([{ outcome: "ok", event: { request: { url: "https://qa.example/", method: "GET" } } }]);

      expect(summary.stalledRequests).toEqual([]);
      expect(summary.slowCalls).toEqual({ total: 0, byCall: {}, requests: [] });
      expect(summary.isolates).toEqual([]);
    });
  });

  it("tolerates events without a request", () => {
    const { summary } = summarize([{ outcome: "exceededCpu", exceptions: [] }]);

    expect(summary.nonOkInvocations).toEqual([
      { outcome: "exceededCpu", path: "", method: null, status: null, cpuTime: null, wallTime: null, eventTimestamp: null, executionModel: null, entrypoint: null, exceptions: [] },
    ]);
  });
});

// Error-level log lines are kept only behind the explicit QA switch (`--argjson keepErrorLogs true`,
// passed by the Journeys workflow for its per-run QA Worker). Any other caller, such as a
// production tail, gets no log lines at all.
const QA_ERROR_LOGS = ["--argjson", "keepErrorLogs", "true"];

function serverError(logs: unknown[], overrides: TailEvent = {}): TailEvent {
  return {
    outcome: "ok",
    eventTimestamp: 3,
    wallTime: 40,
    cpuTime: 9,
    logs,
    exceptions: [],
    event: { request: { url: "https://qa.example/login.data?redirectTo=%2F", method: "POST" }, response: { status: 500 } },
    ...overrides,
  };
}

const stackOf = (count: number) => Array.from({ length: count }, (_, index) => `    at frame${index} (index.js:${index + 1}:7)`).join("\n");

describe("summarize-worker-tail.jq error-level log lines (per-run QA Worker only)", () => {
  const loginFailure = serverError([
    { level: "log", message: ["canary-info-line"], timestamp: 1 },
    { level: "warn", message: ["canary-warn-line"], timestamp: 2 },
    { level: "error", message: [`TypeError: Cannot read properties of undefined (reading 'id')\n${stackOf(7)}`], timestamp: 3 },
  ]);

  it("keeps no log line, error-level or not, without the explicit QA switch", () => {
    for (const args of [[], ["--argjson", "keepErrorLogs", "false"]]) {
      const { summary, raw } = summarize([loginFailure, hostileEvent()], true, args);

      expect(summary).not.toHaveProperty("errorLogs");
      for (const invocation of [...summary.serverErrorInvocations, ...summary.firstExceptions, ...summary.nonOkInvocations, ...summary.slowest]) {
        expect(Object.keys(invocation).sort()).toEqual(INVOCATION_KEYS);
      }
      expect(raw).not.toMatch(/Cannot read properties|frame0|canary-info-line|canary-warn-line|TypeError/);
    }
  });

  it("attaches the error-level lines, reduced to class, message and five stack frames, to the 500 that ended ok", () => {
    const { summary, raw } = summarize([loginFailure], true, QA_ERROR_LOGS);

    expect(summary.serverErrorInvocations[0]).toMatchObject({ outcome: "ok", path: "/login.data", status: 500 });
    expect(summary.serverErrorInvocations[0].errorLogs).toEqual([
      {
        name: "TypeError",
        message: "Cannot read properties of undefined (reading 'id')",
        stack: ["at frame0 (index.js:1:7)", "at frame1 (index.js:2:7)", "at frame2 (index.js:3:7)", "at frame3 (index.js:4:7)", "at frame4 (index.js:5:7)"],
      },
    ]);
    expect(Object.keys(summary.serverErrorInvocations[0]).sort()).toEqual([...INVOCATION_KEYS, "errorLogs"].sort());
    expect(raw).not.toMatch(/canary-info-line|canary-warn-line|frame5/);
    expect(summary.errorLogs).toEqual({ kept: 1, droppedOverCap: 0, invocations: 1, perInvocationCap: 3, totalCap: 40 });
    // Only the two lists that explain a failure carry log lines.
    expect(summary.slowest[0]).not.toHaveProperty("errorLogs");
    expect(summary.firstExceptions).toEqual([]);
  });

  it("scrubs every secret category from a kept line, whether plain text or nested in a JSON-stringified message", () => {
    const nested = JSON.stringify({
      level: "error",
      msg: "login action failed",
      request: { headers: { cookie: `__session=${FAKE_SECRETS.sessionCookie}`, authorization: `Bearer ${FAKE_SECRETS.bearer}` } },
      error: {
        name: "PrismaClientKnownRequestError",
        message: `lookup failed: ${secretMessage}`,
        stack: `PrismaClientKnownRequestError: lookup failed\n    at action (https://chef:${FAKE_SECRETS.userinfo}@qa.example.test/build/server.js?v=${FAKE_SECRETS.query}:1:2)\n${stackOf(2)}`,
      },
    });
    const events = [
      serverError([{ level: "error", message: [`Error: ${secretMessage}\n${secretLine}\n${stackOf(1)}`] }], { eventTimestamp: 1 }),
      serverError([{ level: "error", message: [nested] }], { eventTimestamp: 2 }),
      serverError([{ level: "error", message: [JSON.stringify(nested)] }], { eventTimestamp: 3 }),
      serverError([{ level: "error", message: [{ name: "Error", message: secretMessage, stack: `Error: x\n${stackOf(1)}` }] }], { eventTimestamp: 4 }),
    ];

    const { summary, raw } = summarize(events, true, QA_ERROR_LOGS);

    expectNoSecrets(raw);
    const [plain, json, doubleJson, object] = summary.serverErrorInvocations.map((entry: { errorLogs: unknown[] }) => entry.errorLogs[0]);
    // The lines were kept (so the check above is not vacuous), with each secret replaced by its placeholder.
    expect(plain.name).toBe("Error");
    for (const placeholder of ["Cookie: [cookie]", "Set-Cookie: [cookie]", "[cookie]", "Bearer [token]", "Authorization: [token]", "[token]", "[email]", "?[query]", "#[fragment]", "[userinfo]@api.example.test/v1/login"]) {
      expect(`${plain.message} ${object.message}`, placeholder).toContain(placeholder);
    }
    expect(plain.stack).toEqual(["at frame0 (index.js:1:7)"]);
    for (const entry of [json, doubleJson]) {
      expect(entry.name).toBe("PrismaClientKnownRequestError");
      expect(entry.message).toMatch(/^lookup failed: /);
      expect(entry.stack).toEqual(["at action (https://[userinfo]@qa.example.test/build/server.js?[query])", "at frame0 (index.js:1:7)", "at frame1 (index.js:2:7)"]);
    }
    expect(object).toMatchObject({ name: "Error", stack: ["at frame0 (index.js:1:7)"] });
    expect(object.message.length).toBeLessThanOrEqual(500);
    // Text that only looks like a fragment or a header name outside a URL is left alone.
    const issue = summarize([serverError([{ level: "error", message: ["Error: see issue #123 for recipe 12"] }])], true, QA_ERROR_LOGS);
    expect(issue.summary.serverErrorInvocations[0].errorLogs[0].message).toBe("see issue #123 for recipe 12");
  });

  it("scrubs the same categories from exception messages, which every caller keeps", () => {
    const { raw } = summarize([serverError([], { exceptions: [{ name: "Error", message: `${secretMessage} | ${secretLine}` }] })]);

    expectNoSecrets(raw);
  });

  it("caps log lines per invocation and in total, counts what the caps dropped, and attaches them to firstExceptions too", () => {
    const errorLine = (index: number) => ({ level: "error", message: [`Error: failure ${index}`] });
    const events = [
      // A 500 with an exception is in both lists; its lines count once.
      serverError([0, 1, 2, 3, 4].map(errorLine), { outcome: "exception", exceptions: [{ name: "Error", message: "boom" }] }),
      ...Array.from({ length: 20 }, (_, index) => serverError([errorLine(index), errorLine(index + 100)], { eventTimestamp: 10 + index })),
      // Not a 5xx and no exception: its error lines are never read.
      { ...serverError([errorLine(999)]), event: { request: { url: "https://qa.example/ok", method: "GET" }, response: { status: 200 } } },
    ];

    const { summary } = summarize(events, true, QA_ERROR_LOGS);

    expect(summary.serverErrorInvocations[0].errorLogs.map((line: { message: string }) => line.message)).toEqual(["failure 0", "failure 1", "failure 2"]);
    expect(summary.firstExceptions[0].errorLogs).toEqual(summary.serverErrorInvocations[0].errorLogs);
    const kept = summary.serverErrorInvocations.reduce((total: number, entry: { errorLogs: unknown[] }) => total + entry.errorLogs.length, 0);
    expect(kept).toBe(40);
    expect(summary.serverErrorInvocations.at(-1).errorLogs).toEqual([]);
    expect(summary.errorLogs).toEqual({ kept: 40, droppedOverCap: 2 + (3 + 20 * 2 - 40), invocations: 20, perInvocationCap: 3, totalCap: 40 });
    expect(JSON.stringify(summary)).not.toContain("failure 999");
  });
});

describe("Journeys workflow tail wiring", () => {
  const workflow = parse(readFileSync(WORKFLOW, "utf8"));
  const steps: Array<{ name?: string; run?: string; if?: string; with?: { path?: string } }> = workflow.jobs.journeys.steps;
  const step = (name: string) => {
    const found = steps.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`Missing workflow step: ${name}`);
    return found;
  };

  it("summarises the tail with the tested jq program and never copies raw fields itself", () => {
    const summarise = step("Stop QA Worker tail and summarise it");

    // Runs even after a failed suite, but only for a run whose own QA stack was created.
    expect(summarise.if).toBe("always() && steps.qa-run.outcome == 'success'");
    expect(summarise.run).toContain("-f scripts/summarize-worker-tail.jq");
    expect(summarise.run).toContain("--argjson tailAliveAtStop");
    expect(summarise.run).toContain("::warning::");
    expect(summarise.run).not.toMatch(/headers|\.logs|\bbody\b|\.cf\b|diagnosticsChannelEvents/);
    expect(summarise.run).toContain("rm -rf .worker-tail");
  });

  it("warns, without failing the run, for each route over the CPU budget, with the path reduced to safe characters", () => {
    const summarise = step("Stop QA Worker tail and summarise it") as { run?: string; "continue-on-error"?: boolean };
    const filter = /jq -r '(\.budget[\s\S]*?)' \\\n/.exec(summarise.run ?? "")?.[1];
    expect(filter).toBeDefined();
    expect(summarise["continue-on-error"]).toBe(true);

    const summary = {
      budget: {
        cpuTimeP95Ms: 10,
        overBudget: [
          { path: "/recipes/:id.data", count: 3, cpuTime: { p50: 43, p95: 43, max: 87 } },
          { path: "/x y\n::error::injected%0A", count: 1, cpuTime: { p50: 12, p95: 12, max: 12 } },
        ],
      },
    };
    const output = execFileSync("jq", ["-r", filter!], { input: JSON.stringify(summary), encoding: "utf8" });
    expect(output.trimEnd().split("\n")).toEqual([
      "::warning::CPU budget: /recipes/:id.data has p95 CPU 43 ms (max 87 ms over 3 requests), over the 10 ms budget.",
      "::warning::CPU budget: /x?y?::error::injected?0A has p95 CPU 12 ms (max 12 ms over 1 requests), over the 10 ms budget.",
    ]);
    expect(execFileSync("jq", ["-r", filter!], { input: JSON.stringify({ budget: { cpuTimeP95Ms: 10, overBudget: [] } }), encoding: "utf8" }))
      .toBe("");
  });

  it("prints the hang and stall counts in the step log and warns, without failing, when any request hung", () => {
    const summarise = step("Stop QA Worker tail and summarise it") as { run?: string; "continue-on-error"?: boolean };
    const run = summarise.run ?? "";
    expect(summarise["continue-on-error"]).toBe(true);
    expect(run).toMatch(/jq '\{[^']*hungInvocations, stalledInvocations[^']*\}'/);

    const filter = /jq -r '(select\(\.hungInvocations[\s\S]*?)' \\\n/.exec(run)?.[1];
    expect(filter).toBeDefined();
    const warn = (summary: object) => execFileSync("jq", ["-r", filter!], { input: JSON.stringify(summary), encoding: "utf8" });
    expect(warn({ hungInvocations: 11, stalledInvocations: 1 }).trimEnd()).toBe(
      "::warning::Worker hangs: 11 request(s) failed with Error 1101 because the Workers runtime detected hung code. See hungInvocations and nonOkInvocations in worker-tail-summary.json.",
    );
    expect(warn({ hungInvocations: 0, stalledInvocations: 3 })).toBe("");
    expect(warn({})).toBe("");
  });

  it("waits for late tail events before stopping the tail, bounded, so the last failures are kept", () => {
    // Tail events arrive seconds after their request ends. Stopping the tail as soon as the suite
    // finished lost the last ~6 s of events in runs 37934997247 and 37912555692, including the
    // failing request itself.
    const run = step("Stop QA Worker tail and summarise it").run ?? "";
    const waitAt = run.indexOf("cat .worker-tail/tail-*.json 2>/dev/null | wc -c");
    const killAt = run.indexOf('kill -- "-$(cat .worker-tail/pid)"');

    expect(waitAt).toBeGreaterThan(-1);
    expect(waitAt).toBeLessThan(killAt);
    // Alive-at-stop is judged before the wait, so a tail that died during the suite stays incomplete.
    expect(run.indexOf("tail_alive=true")).toBeLessThan(waitAt);
    expect(run).toMatch(/for _ in \$\(seq 1 30\)/);
    expect(run).toMatch(/quiet" -ge 5/);
  });

  it("reconnects a dropped tail into a new file per connection, and summarises every connection's events", () => {
    // Run 38151797798's tail exited at 15:40:06, seconds before its two 500s, so the summary had
    // no record of them.
    const start = step("Start QA Worker tail").run ?? "";
    expect(start).toMatch(/^ *setsid nohup bash -c '/m);
    expect(start).toMatch(/for connection in 1 2 3 4 5 6; do/);
    expect(start).toContain('> ".worker-tail/tail-$connection.json"');
    expect(start).toContain("echo $! > .worker-tail/pid");

    const stop = step("Stop QA Worker tail and summarise it").run ?? "";
    expect(stop).toContain('kill -9 -- "-$(cat .worker-tail/pid)"');
    expect(stop).toMatch(/for tail_file in \.worker-tail\/tail-\*\.json; do/);
    expect(stop).toContain(`sed -n '/^{/,$p' "$tail_file" | jq -c '.' >> .worker-tail/events.ndjson`);
    expect(stop).toContain('--argjson tailReconnects "$tail_reconnects"');
    expect(stop).toMatch(/jq '\{[^']*tailReconnects[^']*d1TransientErrors[^']*\}'/);
  });

  it("warns, without failing, when the Worker reported transient D1 errors", () => {
    const run = step("Stop QA Worker tail and summarise it").run ?? "";
    const filter = /jq -r '(select\(\.d1TransientErrors[\s\S]*?)' \\\n/.exec(run)?.[1];
    expect(filter).toBeDefined();
    const warn = (summary: object) => execFileSync("jq", ["-r", filter!], { input: JSON.stringify(summary), encoding: "utf8" });
    expect(warn({
      d1TransientErrors: { total: 3, retried: 2, notRetried: 1, notRetriedWrites: 1, writeOperations: { retried: 4, applied: 1, gaveUp: 2 } },
    }).trimEnd()).toBe(
      "::warning::D1 transient errors: 3 (2 retried; 1 not retried, of which 1 on writes nothing handled). Write operations: 4 retried safely, 1 found already applied, 2 gave up with a retryable 503. See d1TransientErrors in worker-tail-summary.json.",
    );
    // A summary from before write operations were counted.
    expect(warn({ d1TransientErrors: { total: 1, retried: 1, notRetried: 0, notRetriedWrites: 0 } }).trimEnd()).toBe(
      "::warning::D1 transient errors: 1 (1 retried; 0 not retried, of which 0 on writes nothing handled). Write operations: 0 retried safely, 0 found already applied, 0 gave up with a retryable 503. See d1TransientErrors in worker-tail-summary.json.",
    );
    expect(warn({ d1TransientErrors: { total: 0, retried: 0, notRetried: 0, notRetriedWrites: 0 } })).toBe("");
    expect(warn({})).toBe("");
  });

  it("keeps error-level log lines for the per-run QA Worker only, and prints how many it kept", () => {
    const run = step("Stop QA Worker tail and summarise it").run ?? "";

    expect(run).toContain("--argjson keepErrorLogs true");
    expect(step("Start QA Worker tail").run).toContain('wrangler tail "$SPOONJOY_QA_RUN_WORKER"');
    const filter = /jq -r '("QA Worker error log lines[\s\S]*?)' \\\n/.exec(run)?.[1];
    expect(filter).toBeDefined();
    const print = (summary: unknown) => execFileSync("jq", ["-r", filter!], { input: JSON.stringify(summary), encoding: "utf8" });
    expect(print({ errorLogs: { kept: 7, droppedOverCap: 2, invocations: 3, perInvocationCap: 3, totalCap: 40 } }))
      .toBe("QA Worker error log lines kept: 7 from 3 invocations (2 over the cap).\n");
    expect(print({})).toBe("QA Worker error log lines kept: 0 from 0 invocations (0 over the cap).\n");
  });

  it("keeps the raw tail stream out of every upload, behind the unchanged gates", () => {
    const allUploads = steps.filter((candidate) => candidate.name?.startsWith("Upload "));
    expect(allUploads.map((upload) => upload.name)).toEqual(["Upload the HX census", "Upload journeys report", "Upload explore report"]);

    // The census artifact is one merged JSON file of control identities, uploaded on every run.
    const census = step("Upload the HX census");
    expect(census.with?.path).toBe("census-actual.json");
    expect(census.if).toBe("always() && env.SUITE == 'journeys' && steps.suite.outcome != 'skipped'");

    const uploads = allUploads.filter((upload) => upload !== census);
    for (const upload of uploads) {
      expect(upload.with?.path).not.toContain(".worker-tail");
      expect(upload.if).toContain("!cancelled()");
      expect(upload.if).toContain("steps.rotate-passwords.outcome == 'success'");
      expect(upload.if).toContain("steps.cleanup-qa-data.outcome == 'success'");
      expect(upload.if).toContain("steps.strip-traces.outcome == 'success'");
    }
    expect(step("Remove credentials and session files").run).toContain(".worker-tail");
  });
});
