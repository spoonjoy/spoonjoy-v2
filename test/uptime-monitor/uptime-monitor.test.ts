// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import monitor, {
  CANARY_CRON,
  ISSUE_TITLE,
  STATE_KEY,
  dispatchCanary,
  runUptimeCheck,
  type UptimeEnv,
} from "../../workers/uptime-monitor/index";

const HTML = "<!doctype html><html><body>Spoonjoy</body></html>";

type Outage = Partial<Record<string, number | "hang" | "throw">>;

function memoryKv() {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => void store.set(key, value)),
    } as unknown as UptimeEnv["STATE"],
  };
}

function fakeFetch(outage: () => Outage) {
  const github: Array<{ method: string; url: string; body: unknown }> = [];
  let issueCounter = 400;
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.github.com/")) {
      github.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/dispatches")) return new Response(null, { status: 204 });
      return Response.json({ number: ++issueCounter }, { status: 201 });
    }
    const path = new URL(url).pathname;
    const fault = outage()[path];
    if (fault === "throw") throw new TypeError("network down");
    if (fault === "hang") {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    }
    if (typeof fault === "number") return new Response("down", { status: fault });
    if (path === "/api/v1/health") return Response.json({ ok: true });
    if (path === "/health/ready") return Response.json({ status: "ready" });
    return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
  });
  return { impl: impl as unknown as typeof fetch, github, calls: impl };
}

function env(kv: UptimeEnv["STATE"], token: string | null = "test-token"): UptimeEnv {
  return {
    TARGET_BASE_URL: "https://spoonjoy.app",
    RECIPE_PATH: "/recipes/r1",
    GITHUB_REPOSITORY: "spoonjoy/spoonjoy-v2",
    ALERT_ASSIGNEE: "arimendelow",
    CANARY_WORKFLOW: "mcp-oauth-canary.yml",
    GITHUB_TOKEN: token ?? undefined,
    STATE: kv,
  };
}

const quiet = () => {};

describe("uptime monitor", () => {
  it("probes the home page, a recipe page, API health and D1/R2 readiness, and stays silent when healthy", async () => {
    const { kv } = memoryKv();
    const net = fakeFetch(() => ({}));

    const result = await runUptimeCheck(env(kv), { fetchImpl: net.impl, log: quiet });

    expect(result.healthy).toBe(true);
    expect(result.results.map((r) => new URL(r.url).pathname).sort()).toEqual(["/", "/api/v1/health", "/health/ready", "/recipes/r1"]);
    expect(net.github).toHaveLength(0);
    // A healthy minute writes nothing to KV.
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("opens one assigned issue after two consecutive failing minutes, then comments and closes it on recovery", async () => {
    const { kv, store } = memoryKv();
    let outage: Outage = { "/health/ready": 503 };
    const net = fakeFetch(() => outage);
    const run = () => runUptimeCheck(env(kv), { fetchImpl: net.impl, log: quiet });

    const first = await run();
    expect(first.healthy).toBe(false);
    expect(net.github).toHaveLength(0);

    await run();
    expect(net.github).toHaveLength(1);
    expect(net.github[0]).toMatchObject({
      method: "POST",
      url: "https://api.github.com/repos/spoonjoy/spoonjoy-v2/issues",
      body: { title: ISSUE_TITLE, assignees: ["arimendelow"] },
    });
    expect((net.github[0].body as { body: string }).body).toContain("D1 and R2 readiness");

    // Still down: no duplicate issue.
    outage = { "/": 500, "/health/ready": 503 };
    await run();
    expect(net.github).toHaveLength(1);
    expect(JSON.parse(store.get(STATE_KEY)!)).toMatchObject({ consecutiveFailures: 3, issueNumber: 401 });

    outage = {};
    const recovered = await run();
    expect(recovered.healthy).toBe(true);
    expect(net.github.slice(1).map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://api.github.com/repos/spoonjoy/spoonjoy-v2/issues/401/comments",
      "PATCH https://api.github.com/repos/spoonjoy/spoonjoy-v2/issues/401",
    ]);
    expect(net.github[2].body).toEqual({ state: "closed", state_reason: "completed" });
    expect(JSON.parse(store.get(STATE_KEY)!)).toEqual({ consecutiveFailures: 0, failingSince: null, issueNumber: null });
  });

  it("does not alert on a single blip", async () => {
    const { kv } = memoryKv();
    let outage: Outage = { "/recipes/r1": "hang" };
    const net = fakeFetch(() => outage);
    const blip = await runUptimeCheck(env(kv), { fetchImpl: net.impl, log: quiet });
    expect(blip.results.find((r) => r.name === "recipe page")?.detail).toMatch(/no response/);
    outage = {};
    await runUptimeCheck(env(kv), { fetchImpl: net.impl, log: quiet });
    outage = { "/": "throw" };
    await runUptimeCheck(env(kv), { fetchImpl: net.impl, log: quiet });
    expect(net.github).toHaveLength(0);
  });

  it("treats a 200 that is not a real page or a degraded readiness body as a failure", async () => {
    const { kv } = memoryKv();
    const impl = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === "/health/ready") return Response.json({ status: "degraded" });
      if (path === "/api/v1/health") return Response.json({ ok: false });
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const result = await runUptimeCheck(env(kv), { fetchImpl: impl, log: quiet });
    expect(result.results.every((r) => !r.ok)).toBe(true);
  });

  it("retries the alert next minute when GitHub rejects it, and logs instead of throwing", async () => {
    const { kv, store } = memoryKv();
    let githubDown = true;
    const impl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.github.com/")) {
        return githubDown ? new Response("nope", { status: 502 }) : Response.json({ number: 9 }, { status: 201 });
      }
      return new Response("down", { status: 500 });
    }) as typeof fetch;
    const log = vi.fn();
    await runUptimeCheck(env(kv), { fetchImpl: impl, log });
    await runUptimeCheck(env(kv), { fetchImpl: impl, log });
    expect(log.mock.calls.some(([line]) => String(line).includes("uptime-alert-failed"))).toBe(true);
    expect(JSON.parse(store.get(STATE_KEY)!).issueNumber).toBeNull();
    githubDown = false;
    await runUptimeCheck(env(kv), { fetchImpl: impl, log });
    expect(JSON.parse(store.get(STATE_KEY)!).issueNumber).toBe(9);
  });

  it("logs loudly instead of alerting when no GitHub token is configured", async () => {
    const { kv } = memoryKv();
    const net = fakeFetch(() => ({ "/": 500 }));
    const log = vi.fn();
    await runUptimeCheck(env(kv, null), { fetchImpl: net.impl, log });
    await runUptimeCheck(env(kv, null), { fetchImpl: net.impl, log });
    expect(net.github).toHaveLength(0);
    expect(log.mock.calls.some(([line]) => String(line).includes("uptime-alert-disabled"))).toBe(true);
  });

  it("dispatches the MCP OAuth canary workflow on main", async () => {
    const { kv } = memoryKv();
    const net = fakeFetch(() => ({}));
    expect(await dispatchCanary(env(kv), { fetchImpl: net.impl, log: quiet })).toEqual({ dispatched: true });
    expect(net.github).toEqual([
      {
        method: "POST",
        url: "https://api.github.com/repos/spoonjoy/spoonjoy-v2/actions/workflows/mcp-oauth-canary.yml/dispatches",
        body: { ref: "main" },
      },
    ]);
    expect(await dispatchCanary(env(kv, null), { fetchImpl: net.impl, log: quiet })).toMatchObject({ dispatched: false });
  });

  it("routes the hourly cron to the canary dispatch and every other minute to the uptime check", async () => {
    const config = JSON.parse(readFileSync("workers/uptime-monitor/wrangler.json", "utf8")) as { triggers: { crons: string[] } };
    expect(config.triggers.crons).toEqual(["* * * * *", CANARY_CRON]);

    const { kv } = memoryKv();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(fakeFetch(() => ({})).impl);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const waitUntil = vi.fn();
    try {
      await monitor.scheduled({ cron: CANARY_CRON }, env(kv), { waitUntil });
      expect(waitUntil).toHaveBeenCalledTimes(1);
      await waitUntil.mock.calls[0][0];
      expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
        "https://api.github.com/repos/spoonjoy/spoonjoy-v2/actions/workflows/mcp-oauth-canary.yml/dispatches",
      ]);

      fetchSpy.mockClear();
      await monitor.scheduled({ cron: "* * * * *" }, env(kv), { waitUntil });
      expect(fetchSpy.mock.calls.map(([url]) => new URL(String(url)).pathname).sort()).toEqual(["/", "/api/v1/health", "/health/ready", "/recipes/r1"]);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("uptime monitor wiring", () => {
  it("lets the monitor Worker drive the canary and keeps the GitHub schedule only as a backstop", () => {
    const canary = readFileSync(".github/workflows/mcp-oauth-canary.yml", "utf8");
    expect(canary).toContain("workflow_dispatch:");
    expect(canary).not.toContain('cron: "23 * * * *"');
    // Missing Cloudflare secrets must fail the run, not report a green skip.
    expect(canary).not.toMatch(/Skipping MCP OAuth canary[\s\S]{0,40}exit 0/);
    expect(canary).toContain("exit 1");

    const monitorConfig = JSON.parse(readFileSync("workers/uptime-monitor/wrangler.json", "utf8")) as { vars: Record<string, string> };
    expect(monitorConfig.vars.CANARY_WORKFLOW).toBe("mcp-oauth-canary.yml");
    expect(monitorConfig.vars.TARGET_BASE_URL).toBe("https://spoonjoy.app");
  });
});
