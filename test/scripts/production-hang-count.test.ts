// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  HUNG_NEEDLE,
  MAX_PAGES,
  PAGE_LIMIT,
  countByRoute,
  eventPath,
  fetchHungEvents,
  isCliEntry,
  queryBody,
  report,
  routePattern,
  runHangCount,
} from "../../scripts/production-hang-count.mjs";

const NOW = Date.parse("2026-11-25T06:17:00.000Z");
const ENV = { CLOUDFLARE_API_TOKEN: "token", CLOUDFLARE_ACCOUNT_ID: "account" };

function event(url: string) {
  return { $workers: { event: { request: { url } } }, $metadata: { id: `id-${url}` } };
}

function answer(events: unknown[], init: { ok?: boolean; status?: number; success?: boolean; errors?: unknown[] } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => ({ success: init.success ?? true, errors: init.errors ?? [], result: { events: { events } } }),
  } as unknown as Response;
}

describe("routePattern", () => {
  it("keeps the app's route words and turns ids, usernames and other data into :id", () => {
    expect(routePattern("/my-recipes")).toBe("/my-recipes");
    expect(routePattern("/chefs.data")).toBe("/chefs.data");
    expect(routePattern("/users/somechef/fellow-chefs.data")).toBe("/users/:id/fellow-chefs.data");
    expect(routePattern("/recipes/cm3x9y2z0000abcdefghijkl/fork.data")).toBe("/recipes/:id/fork.data");
    expect(routePattern("/recipes/new.data")).toBe("/recipes/new.data");
    expect(routePattern("/api/cook-sessions/cm3x9y2z0000abcdefghijkl/start")).toBe("/api/cook-sessions/:id/start");
    expect(routePattern("/account/settings?tab=email#top")).toBe("/account/settings");
    expect(routePattern("/plan/2026-11-25")).toBe("/plan/:id");
    expect(routePattern("/@someone")).toBe("/:id");
    expect(routePattern("/")).toBe("/");
    expect(routePattern(undefined)).toBe("/");
  });
});

describe("eventPath", () => {
  it("reads the request URL, then the metadata URL, then the trigger, and answers null without one", () => {
    expect(eventPath(event("https://spoonjoy.app/my-recipes?x=1"))).toBe("/my-recipes");
    expect(eventPath({ $metadata: { url: "/chefs.data" } })).toBe("/chefs.data");
    expect(eventPath({ $metadata: { url: "not a url" } })).toBeNull();
    expect(eventPath({ $metadata: { trigger: "GET /account/settings" } })).toBe("/account/settings");
    expect(eventPath({ $metadata: { trigger: "cron" } })).toBeNull();
    expect(eventPath(null)).toBeNull();
  });
});

describe("countByRoute", () => {
  it("counts per route pattern, most first, and keeps events without a path apart", () => {
    expect(countByRoute([
      event("https://spoonjoy.app/users/a/fellow-chefs.data"),
      event("https://spoonjoy.app/my-recipes"),
      event("https://spoonjoy.app/users/b/fellow-chefs.data"),
      {},
    ])).toEqual([["/users/:id/fellow-chefs.data", 2], ["(no path)", 1], ["/my-recipes", 1]]);
  });
});

describe("queryBody", () => {
  it("asks Workers Logs for the Worker's events that mention a hang, without saving the query", () => {
    expect(queryBody({ worker: "spoonjoy-v2", from: 1, to: 2 })).toEqual({
      queryId: "production-hang-count",
      view: "events",
      dry: true,
      limit: PAGE_LIMIT,
      timeframe: { from: 1, to: 2 },
      parameters: {
        datasets: ["cloudflare-workers"],
        filters: [{ key: "$workers.scriptName", operation: "eq", type: "string", value: "spoonjoy-v2" }],
        needle: { value: HUNG_NEEDLE, isRegex: false, matchCase: false },
      },
    });
    expect(queryBody({ worker: "w", from: 1, to: 2, offset: "next" })).toMatchObject({ offset: "next" });
  });
});

describe("fetchHungEvents", () => {
  const args = { token: "t", accountId: "acct", worker: "spoonjoy-v2", from: 1, to: 2 };

  it("pages on while a page is full, and stops at MAX_PAGES with the count marked as a floor", async () => {
    const full = Array.from({ length: PAGE_LIMIT }, (_, i) => event(`https://spoonjoy.app/r${i}`));
    const pages = vi.fn<(...a: unknown[]) => Promise<Response>>()
      .mockResolvedValueOnce(answer(full))
      .mockResolvedValueOnce(answer([event("https://spoonjoy.app/my-recipes")]));
    const done = await fetchHungEvents({ ...args, fetchImpl: pages as unknown as typeof fetch });
    expect(done).toMatchObject({ truncated: false });
    expect(done.events).toHaveLength(PAGE_LIMIT + 1);
    const [url, init] = pages.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct/workers/observability/telemetry/query");
    expect(init.headers).toMatchObject({ authorization: "Bearer t" });
    const second = JSON.parse((pages.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(second.offset).toBe(`id-https://spoonjoy.app/r${PAGE_LIMIT - 1}`);

    const always = vi.fn(async () => answer(full));
    const floor = await fetchHungEvents({ ...args, fetchImpl: always as unknown as typeof fetch });
    expect(floor.truncated).toBe(true);
    expect(always).toHaveBeenCalledTimes(MAX_PAGES);
  });

  it("fails with Cloudflare's error codes when the query is refused", async () => {
    const refused = vi.fn(async () => answer([], { ok: false, status: 403, success: false, errors: [{ code: 10000, message: "Authentication error" }] }));
    await expect(fetchHungEvents({ ...args, fetchImpl: refused as unknown as typeof fetch }))
      .rejects.toThrow("Workers Logs query failed with HTTP 403: 10000 Authentication error");
    const bare = vi.fn(async () => answer([], { ok: false, status: 400, success: false, errors: [{}, { message: "bad key" }] }));
    await expect(fetchHungEvents({ ...args, fetchImpl: bare as unknown as typeof fetch }))
      .rejects.toThrow("Workers Logs query failed with HTTP 400: ; bad key");
    const unreadable = vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error("html"); } }) as unknown as Response);
    await expect(fetchHungEvents({ ...args, fetchImpl: unreadable as unknown as typeof fetch }))
      .rejects.toThrow("Workers Logs query failed with HTTP 502");
    const empty = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, result: {} }) }) as unknown as Response);
    await expect(fetchHungEvents({ ...args, fetchImpl: empty as unknown as typeof fetch })).resolves.toEqual({ events: [], truncated: false });
  });
});

describe("report", () => {
  it("prints the total and one row per route, and says when the count is a floor", () => {
    expect(report({ worker: "spoonjoy-v2", hours: 24, counts: [["/my-recipes", 2]], truncated: false, to: NOW })).toBe([
      "## Hung requests on spoonjoy-v2, last 24 h",
      "",
      "2 request(s) canceled as hung, to 2026-11-25T06:17:00.000Z.",
      "",
      "| Route | Hung |",
      "| --- | ---: |",
      "| `/my-recipes` | 2 |",
      "",
    ].join("\n"));
    expect(report({ worker: "w", hours: 1, counts: [], truncated: true, to: NOW })).toContain(`Stopped after ${MAX_PAGES * PAGE_LIMIT} events, so the count is a floor.`);
  });
});

describe("runHangCount", () => {
  it("counts the last 24 hours by default, prints the report and adds it to the job summary", async () => {
    const fetchImpl = vi.fn(async () => answer([event("https://spoonjoy.app/chefs.data")]));
    const write = vi.fn();
    const appendFile = vi.fn();
    const text = await runHangCount({ env: { ...ENV, GITHUB_STEP_SUMMARY: "/summary" }, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW, write, appendFile });
    expect(text).toContain("| `/chefs.data` | 1 |");
    expect(write).toHaveBeenCalledWith(text);
    expect(appendFile).toHaveBeenCalledWith("/summary", text);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.timeframe).toEqual({ from: NOW - 24 * 60 * 60 * 1000, to: NOW });
  });

  it("takes another Worker and window, and refuses a missing credential or a window out of range", async () => {
    const fetchImpl = vi.fn(async () => answer([]));
    const text = await runHangCount({ env: { ...ENV, HANG_COUNT_WORKER: "other", HANG_COUNT_HOURS: "2" }, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW, write: vi.fn(), appendFile: vi.fn() });
    expect(text).toContain("## Hung requests on other, last 2 h");
    await expect(runHangCount({ env: { CLOUDFLARE_ACCOUNT_ID: "a" }, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow("CLOUDFLARE_API_TOKEN is not set");
    await expect(runHangCount({ env: { ...ENV, HANG_COUNT_HOURS: "0" }, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow("HANG_COUNT_HOURS must be between 0 and 168");
    await expect(runHangCount({ env: { ...ENV, HANG_COUNT_HOURS: "x" }, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow("HANG_COUNT_HOURS");
  });

  it("reads the process environment and writes to stdout by default", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    await expect(runHangCount()).rejects.toThrow("CLOUDFLARE_API_TOKEN is not set");
    vi.unstubAllEnvs();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const fetchImpl = vi.fn(async () => answer([]));
      const text = await runHangCount({ env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(stdout).toHaveBeenCalledWith(text);
    } finally {
      stdout.mockRestore();
    }
  });

  it("knows when it is the CLI entry", () => {
    expect(isCliEntry(undefined, import.meta.url)).toBe(false);
  });
});

describe("Production Hang Count workflow", () => {
  const workflow = readFileSync(".github/workflows/production-hang-count.yml", "utf8");

  it("runs daily and on demand, only from main, with read-only contents and the script", () => {
    expect(workflow).toContain('cron: "17 6 * * *"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain('if [ "$GITHUB_REF" != "refs/heads/main" ]; then');
    expect(workflow).toMatch(/permissions:\n {2}contents: read\n/);
    expect(workflow).toContain("run: node scripts/production-hang-count.mjs");
  });
});
