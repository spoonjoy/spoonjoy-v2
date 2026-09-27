// @vitest-environment node
// Locks the Worker tail summary that the Journeys workflow uploads in its public report artifact:
// the jq program's field allowlist, the redaction of exception messages, the completeness flag,
// and the workflow wiring that keeps the raw tail stream out of every upload.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = resolve(__dirname, "../..");
const PROGRAM = resolve(ROOT, "scripts/summarize-worker-tail.jq");
const WORKFLOW = resolve(ROOT, ".github/workflows/journeys.yml");

type TailEvent = Record<string, unknown>;

function summarize(events: TailEvent[], tailAliveAtStop = true) {
  const output = execFileSync(
    "jq",
    ["-s", "--argjson", "tailAliveAtStop", String(tailAliveAtStop), "-f", PROGRAM],
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
      "byPath",
      "complete",
      "firstEventTimestamp",
      "firstExceptions",
      "lastEventTimestamp",
      "nonOkInvocations",
      "outcomes",
      "slowest",
      "tailAliveAtStop",
      "totalInvocations",
    ]);
    for (const invocation of [...summary.nonOkInvocations, ...summary.firstExceptions, ...summary.slowest]) {
      expect(Object.keys(invocation).sort()).toEqual(INVOCATION_KEYS);
      for (const exception of invocation.exceptions) expect(Object.keys(exception).sort()).toEqual(["message", "name"]);
    }
    for (const entry of summary.byPath) expect(Object.keys(entry).sort()).toEqual(["count", "cpuTime", "path", "wallTime"]);

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
      firstExceptions: [],
      slowest: [],
      byPath: [],
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

  it("tolerates events without a request", () => {
    const { summary } = summarize([{ outcome: "exceededCpu", exceptions: [] }]);

    expect(summary.nonOkInvocations).toEqual([
      { outcome: "exceededCpu", path: "", method: null, status: null, cpuTime: null, wallTime: null, eventTimestamp: null, exceptions: [] },
    ]);
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

    expect(summarise.if).toBe("always()");
    expect(summarise.run).toContain("-f scripts/summarize-worker-tail.jq");
    expect(summarise.run).toContain("--argjson tailAliveAtStop");
    expect(summarise.run).toContain("::warning::");
    expect(summarise.run).not.toMatch(/headers|\.logs|\bbody\b|\.cf\b|diagnosticsChannelEvents/);
    expect(summarise.run).toContain("rm -rf .worker-tail");
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
