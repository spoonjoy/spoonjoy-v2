import { describe, expect, it, vi } from "vitest";

import {
  analyze,
  analyzeClient,
  analyzeTail,
  decide,
  exceptionClass,
  join5xx,
  main as analyzeMain,
  markdown,
  parseLines,
  parseVariants,
  percentile,
  routeOf,
} from "../../scripts/qa-hang-repro-analyze.mjs";
import { count, emptyCounts, errorClass, parseArgs, requestFor, run, sendOne, signIn } from "../../scripts/qa-hang-repro-load.mjs";

const BASE = "https://spoonjoy-v2-qa-run-123-10.mendelow-studio.workers.dev";
const ARGS = ["0-main", BASE, "/creds.json", "/out", "60", "4", "0.4", "150", "0.15"];
const PASSWORD = "pa55word-never-written";
const COOKIE = "__session=cookie-never-written";

function response(status: number, body = "", headers: Record<string, string> = {}) {
  const res = new Response(body, { status, headers });
  if (headers["set-cookie"]) Object.defineProperty(res.headers, "getSetCookie", { value: () => [headers["set-cookie"]] });
  return res;
}

describe("load client arguments", () => {
  it("parses the nine positional arguments", () => {
    expect(parseArgs(ARGS)).toEqual({
      label: "0-main",
      baseUrl: BASE,
      credentialsFile: "/creds.json",
      outDir: "/out",
      seconds: 60,
      loops: 4,
      abortShare: 0.4,
      abortWindowMs: 150,
      writeShare: 0.15,
    });
  });

  it("loads only a per-run QA Worker, never shared QA or production", () => {
    for (const url of ["https://spoonjoy-v2-qa.mendelow-studio.workers.dev", "https://spoonjoy.app", "http://spoonjoy-v2-qa-run-1-1.x.workers.dev"]) {
      expect(() => parseArgs(ARGS.map((arg, index) => (index === 1 ? url : arg)))).toThrow(/not a per-run QA Worker/);
    }
  });

  it("refuses wrong counts and out-of-range settings", () => {
    expect(() => parseArgs(ARGS.slice(1))).toThrow(/Usage/);
    const at = (index: number, value: string) => ARGS.map((arg, position) => (position === index ? value : arg));
    expect(() => parseArgs(at(0, "Bad Label"))).toThrow(/label/);
    expect(() => parseArgs(at(4, "0"))).toThrow(/seconds/);
    expect(() => parseArgs(at(5, "65"))).toThrow(/loops/);
    expect(() => parseArgs(at(6, "2"))).toThrow(/abortShare/);
    expect(() => parseArgs(at(7, "0"))).toThrow(/abortWindowMs/);
    expect(() => parseArgs(at(8, "x"))).toThrow(/writeShare/);
  });
});

describe("load client requests", () => {
  it("picks reads and writes across the whole mix", () => {
    expect(requestFor({ write: false, pick: 0, userId: "chef", item: 1 }).path).toBe("/api/cook-sessions/qa-kitchen-recipe-risotto");
    expect(requestFor({ write: false, pick: 0.999, userId: "chef", item: 1 }).path).toBe("/_root.data");
    expect(requestFor({ write: true, pick: 0, userId: "chef", item: 3 }).init.body!.toString()).toContain("rice+3");
    expect(requestFor({ write: true, pick: 1, userId: "chef", item: 3 }).path).toBe("/recipes/qa-kitchen-recipe-risotto/fork.data");
  });

  it("keeps only an error class, never a message", () => {
    expect(errorClass(Object.assign(new Error("x"), { name: "AbortError" }))).toBe("aborted");
    expect(errorClass(new Error("no response"))).toBe("no response");
    expect(errorClass(new Error(`fetch failed ${PASSWORD}`))).toBe("fetch error");
  });

  it("records status, ray and a hung 1101 page without the body, cookie or headers", async () => {
    const fetchImpl = vi.fn(async () => response(500, "<title>Worker threw exception</title> code had hung", { "cf-ray": "abc123-SJC" }));
    const record = await sendOne({ baseUrl: BASE, cookie: COOKIE, userId: "chef", settings: { writeShare: 0, abortShare: 0, abortWindowMs: 150 }, random: () => 0.5, fetchImpl });
    expect(record).toMatchObject({ method: "GET", status: 500, ray: "abc123-SJC", hungPage: true, abortAt: null });
    expect(JSON.stringify(record)).not.toContain("cookie-never-written");
    expect(JSON.stringify(record)).not.toContain("Worker threw");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ headers: { Cookie: COOKIE, Origin: BASE }, redirect: "manual" });
  });

  it("aborts within the window, and counts a request with no response", async () => {
    const hanging = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    const aborted = await sendOne({ baseUrl: BASE, cookie: COOKIE, userId: "chef", settings: { writeShare: 0, abortShare: 1, abortWindowMs: 10 }, random: () => 0.5, fetchImpl: hanging });
    expect(aborted).toMatchObject({ abortAt: 5, error: "aborted" });
    const silent = vi.fn(() => new Promise<Response>(() => {}));
    const stuck = await sendOne({ baseUrl: BASE, cookie: COOKIE, userId: "chef", settings: { writeShare: 0, abortShare: 0, abortWindowMs: 10 }, random: () => 0.5, fetchImpl: silent, noResponseMs: 20 });
    expect(stuck).toMatchObject({ abortAt: null, error: "no response" });
    const counts = [aborted, stuck, { method: "GET", path: "/x", abortAt: null, status: 503 }, { method: "GET", path: "/x", abortAt: null, error: "fetch error" }, { method: "GET", path: "/y", abortAt: 3, error: "no response" }, { method: "GET", path: "/y", status: 500, abortAt: null, hungPage: true }].reduce(count, emptyCounts());
    expect(counts).toMatchObject({ total: 6, aborted: 2, abortedBeforeResponse: 1, noResponse: 2, noResponseUnaborted: 1, fetchErrors: 1, hungPages: 1, status: { 500: 1, 503: 1 } });
  });

  it("signs in and checks the session, or fails without printing the password", async () => {
    const ok = vi.fn().mockResolvedValueOnce(response(302, "", { "set-cookie": `${COOKIE}; Path=/; HttpOnly` })).mockResolvedValueOnce(response(200));
    expect(await signIn({ baseUrl: BASE, persona: { username: "chef", password: PASSWORD }, fetchImpl: ok })).toBe(COOKIE);
    const noCookie = vi.fn().mockResolvedValue(response(400));
    await expect(signIn({ baseUrl: BASE, persona: { email: "c@x", password: PASSWORD }, fetchImpl: noCookie })).rejects.toThrow(/no session cookie/);
    const signedOut = vi.fn().mockResolvedValueOnce(response(302, "", { "set-cookie": COOKIE })).mockResolvedValueOnce(response(302));
    await expect(signIn({ baseUrl: BASE, persona: { username: "chef", password: PASSWORD }, fetchImpl: signedOut })).rejects.toThrow(/returned 302/);
  });

  it("runs the loops until the deadline and writes records and a summary with no secret in them", async () => {
    let clock = 0;
    const files = new Map<string, string>();
    const fetchImpl = vi.fn(async (url: string) => {
      clock += 100;
      if (url.endsWith("/login")) return response(302, "", { "set-cookie": COOKIE });
      return response(200, "ok", { "cf-ray": "r1-SJC" });
    });
    const log = vi.fn();
    const summary = await run(parseArgs(["0-main", BASE, "/creds.json", "/out", "1", "2", "0", "150", "0"]), {
      fetchImpl,
      now: () => clock,
      random: () => 0.5,
      log,
      readFile: () => JSON.stringify({ chef: { username: "qa-kitchen-chef", password: PASSWORD } }),
      writeFile: (file: string, data: string) => files.set(file, data),
      appendFile: (file: string, data: string) => files.set(file, (files.get(file) ?? "") + data),
    });
    expect(summary.total).toBeGreaterThan(0);
    expect(summary).not.toHaveProperty("credentialsFile");
    expect(files.get("/out/0-main.requests.ndjson")!.trim().split("\n")).toHaveLength(summary.total);
    const written = [...files.values()].join("\n") + JSON.stringify(log.mock.calls);
    expect(written).not.toContain(PASSWORD);
    expect(written).not.toContain("cookie-never-written");
  });
});

const tailEvent = (overrides: Record<string, unknown> = {}) => ({
  outcome: "ok",
  eventTimestamp: 1_000,
  cpuTime: 3,
  wallTime: 40,
  exceptions: [],
  event: { request: { method: "GET", url: "https://w.example/recipes/qa-kitchen-recipe-risotto.data?x=secret", headers: { "cf-ray": "r1", cookie: COOKIE } } },
  ...overrides,
});

describe("tail and client analysis", () => {
  it("classifies exceptions into fixed classes only", () => {
    expect(exceptionClass("The Workers runtime canceled this request because it detected that your Worker's code had hung")).toBe("hung");
    expect(exceptionClass("RangeError: Invalid array buffer length")).toBe("invalidArrayBufferLength");
    expect(exceptionClass("RuntimeError: memory access out of bounds")).toBe("memoryAccessOutOfBounds");
    expect(exceptionClass("RuntimeError: unreachable")).toBe("unreachable");
    expect(exceptionClass("Worker exceeded resource limits")).toBe("exceededResources");
    expect(exceptionClass(`Error: ${PASSWORD}`)).toBe("other");
    expect(exceptionClass(undefined)).toBe("other");
  });

  it("computes percentiles and normalizes routes without queries", () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(routeOf("https://w.example/users/qa-kitchen-friend.data?x=1")).toBe("/users/:id.data");
    expect(routeOf("/api/cook-sessions/abc")).toBe("/api/cook-sessions/:id");
    expect(routeOf(undefined)).toBe("");
    expect(parseLines('{"a":1}\nnot json\n\n{"b":2}')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("counts hung, stalled and other invocations in the window, copying no header, cookie or query", () => {
    const events = [
      tailEvent(),
      tailEvent({ eventTimestamp: 500 }),
      tailEvent({ eventTimestamp: 5_000 }),
      tailEvent({ outcome: "exception", exceptions: [{ message: "Invalid array buffer length" }, { message: "code had hung" }], event: { request: { method: "POST", url: "https://w.example/recipes/qa-kitchen-recipe-risotto/fork.data", headers: { "cf-ray": "r2-SJC" } } } }),
      tailEvent({ outcome: "canceled", wallTime: 306_000, cpuTime: 1 }),
      tailEvent({ outcome: "exception", exceptions: [{ message: "unreachable" }], event: {} }),
      "noise",
    ];
    const { summary, rows } = analyzeTail(events, 1_000, 2_000);
    expect(summary).toMatchObject({
      invocations: 4,
      outcomes: { ok: 1, exception: 2, canceled: 1 },
      hung: 1,
      hungByRoute: { "POST /recipes/:id/fork.data": 1 },
      exceptions: { hung: 1, unreachable: 1 },
      stalledOver30s: 1,
      stalledByOutcome: { canceled: 1 },
      lowCpuWallOver2s: 1,
      wallMax: 306_000,
    });
    expect(rows.map((row) => row.ray)).toEqual(["r1", "r2", "r1", ""]);
    expect(JSON.stringify(summary)).not.toMatch(/secret|cookie|x=/);
    expect(analyzeTail([], 0, 1).summary).toMatchObject({ invocations: 0, wallP95: null, wallMax: null });
  });

  it("measures unaborted client requests and matches 5xx to the tail by ray", () => {
    const records = [
      { method: "GET", path: "/a", abortAt: null, status: 200, ms: 100 },
      { method: "GET", path: "/a", abortAt: null, status: 500, ms: 300, ray: "r2-SJC", hungPage: true },
      { method: "GET", path: "/a", abortAt: 20, error: "aborted", ms: 20 },
      { method: "POST", path: "/b", abortAt: null, error: "no response", ms: 30_000 },
      { method: "POST", path: "/b", abortAt: 50, error: "no response", ms: 30_000 },
      { method: "POST", path: "/b", abortAt: null, error: "fetch error", ms: 5 },
      { method: "GET", path: "/c", abortAt: null, status: 502, ms: 9, ray: "zz" },
    ];
    const client = analyzeClient(records);
    expect(client).toMatchObject({ requests: 7, aborted: 2, responses: 3, s5xx: 2, hungPages: 1, noResponse: 2, noResponseUnaborted: 1, fetchErrors: 1, wallP50: 100, wallP95: 300 });
    // Nearest rank: the p50 of two values is the higher one.
    expect(client.byRoute["GET /a"]).toEqual({ n: 3, s5xx: 1, noResponse: 0, p50: 300, p95: 300 });
    const tailRows = analyzeTail([tailEvent({ outcome: "exception", exceptions: [{ message: "code had hung" }], event: { request: { headers: { "cf-ray": "r2" } } } }), tailEvent({ event: {} })], 0, 10_000).rows;
    expect(join5xx(records, tailRows)).toEqual({ hung: 1, "not in tail": 1 });
    expect(analyze({ label: "0-main", phase: "with-aborts", tailEvents: [], records, sinceMs: 0, untilMs: 1 })).toMatchObject({ label: "0-main", phase: "with-aborts", client: { requests: 7 }, tail: { invocations: 0 } });
  });
});

function analysis(label: string, phase: string, { hung = 0, hungPages = 0, noResponse = 0, p95 = 1000, invocations = 10 } = {}) {
  return { label, phase, client: { requests: 100, s5xx: 0, hungPages, noResponse, wallP95: p95 }, tail: { hung, stalledOver30s: 0, invocations } };
}

describe("decision rule and report", () => {
  const variants = parseVariants("0\t0-main\tmain\tabc\n1\t1-fix\tclaude/fix\tdef\n2\t2-slow\tclaude/slow\n\n");

  it("parses the variants list", () => {
    expect(variants).toEqual([
      { index: 0, label: "0-main", ref: "main", sha: "abc" },
      { index: 1, label: "1-fix", ref: "claude/fix", sha: "def" },
      { index: 2, label: "2-slow", ref: "claude/slow", sha: undefined },
    ]);
  });

  it("names a winner only with no hung, no missing response and p95 within 1.5x of the baseline, in every phase", () => {
    const verdict = decide(variants, [
      analysis("0-main", "with-aborts", { hung: 3 }),
      analysis("0-main", "without-aborts", { hung: 1 }),
      analysis("1-fix", "with-aborts", { p95: 1500 }),
      analysis("1-fix", "without-aborts", { p95: 1400 }),
      analysis("2-slow", "with-aborts", { p95: 1501, noResponse: 2, hungPages: 1 }),
    ]);
    expect(verdict.phases).toEqual(["with-aborts", "without-aborts"]);
    expect(verdict.winners).toEqual(["1-fix"]);
    const slow = verdict.rows.find((row) => row.label === "2-slow")!;
    expect(slow.phases[0].reasons).toEqual(["1 hung", "2 with no response", "p95 1.50x baseline"]);
    expect(slow.phases[1]).toEqual({ phase: "without-aborts", missing: true, pass: false });
    expect(verdict.rows[0]).toMatchObject({ baseline: true, wins: false });
    expect(verdict.rows[0].phases[0].reasons).toEqual(["3 hung"]);
  });

  it("never names a winner without tail evidence or a baseline p95", () => {
    const verdict = decide(variants.slice(0, 2), [analysis("0-main", "x", { p95: null as unknown as number }), analysis("1-fix", "x", { invocations: 0 })]);
    expect(verdict.winners).toEqual([]);
    expect(verdict.rows[1].phases[0].reasons).toEqual(["p95 unknown baseline", "no tail evidence"]);
  });

  it("writes one table row per variant and phase", () => {
    const verdict = decide(variants, [analysis("0-main", "with-aborts", { hung: 2 }), analysis("1-fix", "with-aborts"), analysis("2-slow", "with-aborts", { p95: 9000 }), analysis("0-main", "without-aborts")]);
    const text = markdown(verdict);
    expect(text).toContain("Winners: none.");
    expect(text).toContain("| 0-main | `main` | with-aborts | 100 | 0 | 2 | 0 | 0 | 1000 | 1.00x | 10 | baseline: 2 hung |");
    expect(text).toContain("| 1-fix | `claude/fix` | with-aborts | 100 | 0 | 0 | 0 | 0 | 1000 | 1.00x | 10 | pass |");
    expect(text).toContain("| 2-slow | `claude/slow` | with-aborts | 100 | 0 | 0 | 0 | 0 | 9000 | 9.00x | 10 | p95 9.00x baseline |");
    expect(text).toContain("| 1-fix | `claude/fix` | without-aborts | | | | | | | | | missing |");
    expect(text).toContain("| 0-main | `main` | without-aborts | 100 | 0 | 0 | 0 | 0 | 1000 | 1.00x | 10 | baseline |");
    expect(markdown(decide(variants.slice(0, 2), [analysis("0-main", "x"), analysis("1-fix", "x")]))).toContain("Winners: 1-fix.");
  });

  it("runs analyze and report from the command line", () => {
    const files = new Map<string, string>([
      ["/tail.ndjson", `${JSON.stringify(tailEvent())}\n`],
      ["/req.ndjson", `${JSON.stringify({ method: "GET", path: "/a", abortAt: null, status: 200, ms: 5 })}\n`],
      ["/variants.tsv", "0\t0-main\tmain\tabc\n"],
    ]);
    const io = { readFile: (file: string) => files.get(file)!, writeFile: (file: string, data: string) => files.set(file, data), listDir: () => ["0-main.p.analysis.json", "other.txt"], log: vi.fn() };
    analyzeMain(["analyze", "0-main", "p", "/tail.ndjson", "/req.ndjson", "0", "5000", "/results/0-main.p.analysis.json"], io);
    expect(JSON.parse(files.get("/results/0-main.p.analysis.json")!)).toMatchObject({ client: { requests: 1 }, tail: { invocations: 1 } });
    const verdict = analyzeMain(["report", "/results", "/variants.tsv", "/report.md", "/verdict.json"], io);
    expect(verdict.rows).toHaveLength(1);
    expect(files.get("/report.md")).toContain("## QA Hang Repro");
    expect(() => analyzeMain(["nope"], io)).toThrow(/Usage/);
  });
});
