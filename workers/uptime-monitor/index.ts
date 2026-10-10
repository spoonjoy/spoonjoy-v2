/**
 * Spoonjoy uptime monitor: a small, separate Cloudflare Worker on a Cron Trigger.
 *
 * Every minute it probes production (home page, a recipe page, the API health
 * route and the D1/R2 readiness route). After two consecutive failing runs it
 * opens one GitHub issue assigned to the operator; when every probe passes
 * again it comments and closes that issue. Once an hour it also dispatches the
 * MCP OAuth canary workflow, because GitHub's own `schedule:` trigger dropped
 * about 80% of the canary's hourly runs.
 *
 * It is deliberately independent of the app Worker and of GitHub Actions
 * scheduling, so neither an app outage nor a skipped GitHub cron can silence it.
 */

export interface UptimeEnv {
  /** Origin to probe, e.g. https://spoonjoy.app */
  TARGET_BASE_URL: string;
  /** A public recipe page path that must render, e.g. /recipes/<id> */
  RECIPE_PATH: string;
  /** owner/repo that receives alert issues and canary dispatches. */
  GITHUB_REPOSITORY: string;
  /** GitHub login assigned to alert issues so they notify someone. */
  ALERT_ASSIGNEE?: string;
  /** Workflow file dispatched hourly. Empty disables dispatch. */
  CANARY_WORKFLOW?: string;
  /** Fine-grained token: Issues read/write and Actions read/write on GITHUB_REPOSITORY only. */
  GITHUB_TOKEN?: string;
  STATE: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  };
}

/** Minimal Cron Trigger types; this Worker does not share the app's d.ts. */
export type ScheduledEventLike = { cron: string };
export type WaitUntilContext = { waitUntil(promise: Promise<unknown>): void };

export type ProbeResult = { name: string; url: string; ok: boolean; status: number | null; ms: number; detail?: string };

export type MonitorState = {
  consecutiveFailures: number;
  failingSince: string | null;
  issueNumber: number | null;
};

export const STATE_KEY = "uptime-state";
export const FAILURES_BEFORE_ALERT = 2;
export const PROBE_TIMEOUT_MS = 10_000;
export const CANARY_CRON = "23 * * * *";
export const ISSUE_TITLE = "Production uptime check failing";

const EMPTY_STATE: MonitorState = { consecutiveFailures: 0, failingSince: null, issueNumber: null };

type Fetch = typeof fetch;

type ProbeSpec = {
  name: string;
  path: string;
  check: (response: Response) => Promise<string | null>;
};

async function expectHtml(response: Response) {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/html")) return `content-type ${type || "missing"}`;
  const body = await response.text();
  return body.includes("</html>") ? null : "truncated HTML";
}

export function probeSpecs(env: Pick<UptimeEnv, "RECIPE_PATH">): ProbeSpec[] {
  return [
    { name: "home page", path: "/", check: expectHtml },
    { name: "recipe page", path: env.RECIPE_PATH, check: expectHtml },
    {
      name: "API health",
      path: "/api/v1/health",
      check: async (response) => {
        const body = (await response.json()) as { ok?: boolean };
        return body.ok === true ? null : "ok is not true";
      },
    },
    {
      name: "D1 and R2 readiness",
      path: "/health/ready",
      check: async (response) => {
        const body = (await response.json()) as { status?: string };
        return body.status === "ready" ? null : `status ${body.status ?? "missing"}`;
      },
    },
  ];
}

export async function runProbe(
  baseUrl: string,
  spec: ProbeSpec,
  { fetchImpl = fetch, now = () => Date.now(), timeoutMs = PROBE_TIMEOUT_MS }: { fetchImpl?: Fetch; now?: () => number; timeoutMs?: number } = {},
): Promise<ProbeResult> {
  const url = new URL(spec.path, baseUrl).toString();
  const started = now();
  try {
    const response = await fetchImpl(url, {
      headers: { "User-Agent": "spoonjoy-uptime-monitor", "Cache-Control": "no-cache" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const detail = response.status === 200 ? await spec.check(response) : `HTTP ${response.status}`;
    return { name: spec.name, url, ok: detail === null, status: response.status, ms: now() - started, ...(detail ? { detail } : {}) };
  } catch (error) {
    const detail = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
      ? `no response in ${timeoutMs} ms`
      : `request failed: ${error instanceof Error ? error.message : String(error)}`;
    return { name: spec.name, url, ok: false, status: null, ms: now() - started, detail };
  }
}

class GitHub {
  constructor(
    private readonly repository: string,
    private readonly token: string,
    private readonly fetchImpl: Fetch,
  ) {}

  async request(method: string, path: string, body?: unknown) {
    const response = await this.fetchImpl(`https://api.github.com/repos/${this.repository}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "User-Agent": "spoonjoy-uptime-monitor",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(`GitHub ${method} ${path} returned ${response.status}`);
    }
    return response.status === 204 ? null : ((await response.json()) as Record<string, unknown>);
  }
}

function failureTable(results: ProbeResult[]) {
  const rows = results.map((r) => `| ${r.name} | \`${r.url}\` | ${r.ok ? "ok" : "FAIL"} | ${r.status ?? "none"} | ${r.ms} ms | ${r.detail ?? ""} |`);
  return ["| Check | URL | Result | HTTP | Time | Detail |", "| --- | --- | --- | --- | ---: | --- |", ...rows].join("\n");
}

async function readState(env: UptimeEnv): Promise<MonitorState> {
  const raw = await env.STATE.get(STATE_KEY);
  if (!raw) return { ...EMPTY_STATE };
  try {
    return { ...EMPTY_STATE, ...(JSON.parse(raw) as Partial<MonitorState>) };
  } catch {
    return { ...EMPTY_STATE };
  }
}

/**
 * One monitoring pass. Pure apart from the injected fetch and KV, so tests can
 * drive outages and recoveries minute by minute.
 */
export async function runUptimeCheck(
  env: UptimeEnv,
  { fetchImpl = fetch, now = () => Date.now(), log = console.log }: { fetchImpl?: Fetch; now?: () => number; log?: (...args: unknown[]) => void } = {},
) {
  const results = await Promise.all(
    probeSpecs(env).map((spec) => runProbe(env.TARGET_BASE_URL, spec, { fetchImpl, now })),
  );
  const healthy = results.every((r) => r.ok);
  const previous = await readState(env);
  const next: MonitorState = healthy
    ? { ...EMPTY_STATE }
    : {
        consecutiveFailures: previous.consecutiveFailures + 1,
        failingSince: previous.failingSince ?? new Date(now()).toISOString(),
        issueNumber: previous.issueNumber,
      };

  log(JSON.stringify({ event: "uptime-check", healthy, results }));

  const github = env.GITHUB_TOKEN ? new GitHub(env.GITHUB_REPOSITORY, env.GITHUB_TOKEN, fetchImpl) : null;
  if (!github) log(JSON.stringify({ event: "uptime-alert-disabled", reason: "GITHUB_TOKEN is not set" }));

  if (!healthy && next.consecutiveFailures >= FAILURES_BEFORE_ALERT && next.issueNumber === null && github) {
    try {
      const issue = await github.request("POST", "/issues", {
        title: ISSUE_TITLE,
        body: [
          `Production has failed ${next.consecutiveFailures} uptime checks in a row (one check per minute), starting ${next.failingSince}.`,
          "",
          failureTable(results),
          "",
          "The uptime monitor Worker (`workers/uptime-monitor`) will comment and close this issue when every check passes again. Workers Logs for `spoonjoy-v2` hold the request-level detail.",
        ].join("\n"),
        ...(env.ALERT_ASSIGNEE ? { assignees: [env.ALERT_ASSIGNEE] } : {}),
      });
      next.issueNumber = Number(issue?.number);
    } catch (error) {
      // Left unset, so the next failing minute tries again.
      log(JSON.stringify({ event: "uptime-alert-failed", error: String(error) }));
    }
  }

  if (healthy && previous.issueNumber !== null && github) {
    try {
      await github.request("POST", `/issues/${previous.issueNumber}/comments`, {
        body: `Recovered at ${new Date(now()).toISOString()} after failing since ${previous.failingSince}. Every uptime check passes again.\n\n${failureTable(results)}`,
      });
      await github.request("PATCH", `/issues/${previous.issueNumber}`, { state: "closed", state_reason: "completed" });
    } catch (error) {
      // Keep the issue number so the next healthy minute retries the close.
      next.issueNumber = previous.issueNumber;
      next.failingSince = previous.failingSince;
      log(JSON.stringify({ event: "uptime-recovery-update-failed", error: String(error) }));
    }
  }

  const changed = JSON.stringify(previous) !== JSON.stringify(next);
  // KV writes happen only while failing or on a state change, so a healthy
  // minute costs one KV read and no writes.
  if (changed) await env.STATE.put(STATE_KEY, JSON.stringify(next));

  return { healthy, results, state: next };
}

export async function dispatchCanary(
  env: UptimeEnv,
  { fetchImpl = fetch, log = console.log }: { fetchImpl?: Fetch; log?: (...args: unknown[]) => void } = {},
) {
  if (!env.CANARY_WORKFLOW) return { dispatched: false, reason: "CANARY_WORKFLOW is not set" };
  if (!env.GITHUB_TOKEN) {
    log(JSON.stringify({ event: "canary-dispatch-disabled", reason: "GITHUB_TOKEN is not set" }));
    return { dispatched: false, reason: "GITHUB_TOKEN is not set" };
  }
  const github = new GitHub(env.GITHUB_REPOSITORY, env.GITHUB_TOKEN, fetchImpl);
  await github.request("POST", `/actions/workflows/${env.CANARY_WORKFLOW}/dispatches`, { ref: "main" });
  log(JSON.stringify({ event: "canary-dispatched", workflow: env.CANARY_WORKFLOW }));
  return { dispatched: true };
}

export default {
  async scheduled(controller: ScheduledEventLike, env: UptimeEnv, ctx: WaitUntilContext) {
    if (controller.cron === CANARY_CRON) {
      ctx.waitUntil(dispatchCanary(env));
      return;
    }
    await runUptimeCheck(env);
  },

  async fetch() {
    return new Response("spoonjoy uptime monitor\n", { headers: { "content-type": "text/plain" } });
  },
};
