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

const INVOCATION_KEYS = ["cpuTime", "eventTimestamp", "exceptions", "method", "outcome", "path", "status", "wallTime"];

describe("summarize-worker-tail.jq", () => {
  it("copies only allowlisted fields, so no header, cookie, body, log, cf or query value leaves the tail", () => {
    const { summary, raw } = summarize([hostileEvent(), hostileEvent({ outcome: "ok" })]);

    expect(Object.keys(summary).sort()).toEqual([
      "budget",
      "byPath",
      "complete",
      "firstEventTimestamp",
      "firstExceptions",
      "hungInvocations",
      "lastEventTimestamp",
      "nonOkInvocations",
      "outcomes",
      "serverErrorInvocations",
      "slowest",
      "stalledInvocations",
      "tailAliveAtStop",
      "totalInvocations",
    ]);
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
      wallTime: { p50: 300, p95: 400, max: 3840 },
      cpuTime: { p50: 22, p95: 23, max: 27 },
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
        { path: "/recipes/:id.data", count: 3, cpuTime: { p50: 43, p95: 43, max: 87 } },
        { path: "/search.data", count: 4, cpuTime: { p50: 9, p95: 12, max: 40 } },
      ],
    });
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
      { outcome: "ok", path: "/login.data", method: "POST", status: 500, cpuTime: 9, wallTime: 40, eventTimestamp: 3, exceptions: [] },
      { outcome: "ok", path: "/recipes/cmg1abcdefghijklmnopqrstu.data", method: "POST", status: 502, cpuTime: 9, wallTime: 40, eventTimestamp: 4, exceptions: [] },
      { outcome: "exception", path: "/shopping-list.data", method: "POST", status: 500, cpuTime: 9, wallTime: 40, eventTimestamp: 5, exceptions: [] },
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

  it("tolerates events without a request", () => {
    const { summary } = summarize([{ outcome: "exceededCpu", exceptions: [] }]);

    expect(summary.nonOkInvocations).toEqual([
      { outcome: "exceededCpu", path: "", method: null, status: null, cpuTime: null, wallTime: null, eventTimestamp: null, exceptions: [] },
    ]);
  });
});

// Error-level log lines are kept only behind the explicit QA switch (`--argjson keepErrorLogs true`,
// passed by the Journeys workflow for its per-run QA Worker). Any other caller, such as a
// production tail, gets no log lines at all.
const QA_ERROR_LOGS = ["--argjson", "keepErrorLogs", "true"];

// Fake, token-shaped secrets, one per category the scrubber must remove. None is a real credential.
const FAKE_SECRETS = {
  cookieHeader: "fakeCookieHeaderValue0001",
  setCookieHeader: "fakeSetCookieValue0002",
  sessionCookie: "eyJmYWtlIjoic2Vzc2lvbiJ9.FakeSig0003",
  agentCodeCookie: "fakeAgentCode0004",
  bearer: "fakeBearer0005",
  basicAuth: "ZmFrZTpmYWtlMDAwNg",
  apiToken: "sj_FAKEfakeFAKEfake0007abcdefghijklmnopqrstu",
  deviceCode: "sjdc_FAKEfakeFAKEfake0008abcdefghijklmnopqrs",
  oauthCode: "oac_FAKEfakeFAKEfake0009abcdefghijklmnopqrst",
  connectionKey: "ocn_FAKEocn0010abcdefgh",
  refreshToken: "ort_FAKEfakeFAKEfake0011abcdefghijklmnopqrst",
  clientToken: "oct_FAKEfakeFAKEfake0012abcdefghijklmnopqrst",
  connectionId: "conn_eyJmYWtlIjoiY29ubjAwMTMifQ",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlMDAxNCJ9.ZmFrZXNpZzAwMTQ",
  hex: "fa4efa4efa4efa4e0015deadbeefcafebabe0015",
  email: "fake.chef0016@example.com",
  query: "fakeQueryCode0017",
  fragment: "fakeFragmentToken0018",
  userinfo: "fakeUserPass0019",
};

const secretLine = [
  `Cookie: theme=dark; sid=${FAKE_SECRETS.cookieHeader}`,
  `Set-Cookie: __session=${FAKE_SECRETS.setCookieHeader}; Path=/; HttpOnly`,
].join("\n");

const secretMessage = [
  `cookie __session=${FAKE_SECRETS.sessionCookie} and __agent_code=${FAKE_SECRETS.agentCodeCookie}`,
  `Authorization: Bearer ${FAKE_SECRETS.bearer}`,
  `Authorization: Basic ${FAKE_SECRETS.basicAuth}`,
  `tokens ${FAKE_SECRETS.apiToken} ${FAKE_SECRETS.deviceCode} ${FAKE_SECRETS.oauthCode} ${FAKE_SECRETS.connectionKey}`,
  `${FAKE_SECRETS.refreshToken} ${FAKE_SECRETS.clientToken} ${FAKE_SECRETS.connectionId} ${FAKE_SECRETS.jwt}`,
  `digest ${FAKE_SECRETS.hex} for ${FAKE_SECRETS.email}`,
  `fetch https://chef:${FAKE_SECRETS.userinfo}@api.example.test/v1/login?code=${FAKE_SECRETS.query}&x=1 and /oauth/cb#access_token=${FAKE_SECRETS.fragment}`,
].join(" | ");

function expectNoSecrets(raw: string) {
  for (const [name, secret] of Object.entries(FAKE_SECRETS)) {
    expect(raw, `${name} leaked`).not.toContain(secret);
    // A partly redacted secret is still a leak: its distinctive tail must be gone too.
    expect(raw, `${name} leaked in part`).not.toContain(secret.slice(-10));
  }
}

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
    const waitAt = run.indexOf("wc -c < .worker-tail/tail.json");
    const killAt = run.indexOf('kill "$(cat .worker-tail/pid)"');

    expect(waitAt).toBeGreaterThan(-1);
    expect(waitAt).toBeLessThan(killAt);
    // Alive-at-stop is judged before the wait, so a tail that died during the suite stays incomplete.
    expect(run.indexOf("tail_alive=true")).toBeLessThan(waitAt);
    expect(run).toMatch(/for _ in \$\(seq 1 30\)/);
    expect(run).toMatch(/quiet" -ge 5/);
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
    const uploads = steps.filter((candidate) => candidate.name?.startsWith("Upload "));

    expect(uploads.map((upload) => upload.name)).toEqual(["Upload journeys report", "Upload explore report"]);
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
