#!/usr/bin/env node
// Counts the production Worker's requests that the Workers runtime canceled as hung ("your
// Worker's code had hung and would never generate a response") over the last 24 hours, per route
// pattern, from Workers Logs (wrangler.json turns observability on with every request sampled).
//
// The QA Worker showed these on merge-group run 45528383350: once a background Prisma task hung,
// every Prisma page in the same isolate hung after it. This count shows whether production does the
// same, and whether moving routes off Prisma lowers it.
//
// Counts only: each event's path is reduced to a route pattern before it is counted (ids, usernames
// and any other varying segment become :id), and nothing else from an event is kept or printed. No
// request body, user, id or query string leaves this script.
//
// Usage: node scripts/production-hang-count.mjs
// Needs CLOUDFLARE_API_TOKEN (Workers Observability) and CLOUDFLARE_ACCOUNT_ID. Reads
// HANG_COUNT_WORKER (default spoonjoy-v2) and HANG_COUNT_HOURS (default 24). Writes a table to
// GITHUB_STEP_SUMMARY when it is set.
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HUNG_NEEDLE = "code had hung";
export const PAGE_LIMIT = 2000;
export const MAX_PAGES = 10;

// Segments kept as written: the app's fixed route words. Anything else that looks like data is :id.
const ID_LIKE = /\d|^c[a-z0-9]{20,}$|^[A-Za-z0-9_-]{20,}$|@|%/;
// The segment after one of these is always a record's id or a chef's username.
const ID_AFTER = new Set(["users", "recipes", "cookbooks", "cook-sessions", "steps", "spoons", "shopping-lists", "households", "chefs", "u", "invites", "covers", "tokens"]);
// Fixed words that can follow those prefixes and must stay as written.
const FIXED_AFTER_PREFIX = new Set(["new", "saved", "everyone", "mine", "import"]);

/** A request path reduced to its route pattern: varying segments become :id, the query is dropped. */
export function routePattern(rawPath) {
  const pathname = String(rawPath ?? "").split(/[?#]/)[0];
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  const out = [];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const dataSuffix = segment.endsWith(".data") ? ".data" : "";
    const bare = dataSuffix ? segment.slice(0, -dataSuffix.length) : segment;
    const after = i > 0 && ID_AFTER.has(segments[i - 1]) && !FIXED_AFTER_PREFIX.has(bare);
    out.push((after || ID_LIKE.test(bare) ? ":id" : bare) + dataSuffix);
  }
  return `/${out.join("/")}`;
}

/** The request path of a Workers Logs event, or null when it carries none. */
export function eventPath(event) {
  const url = event?.$workers?.event?.request?.url ?? event?.$metadata?.url;
  if (typeof url === "string") {
    try {
      return new URL(url).pathname;
    } catch {
      return url.startsWith("/") ? url : null;
    }
  }
  const trigger = event?.$metadata?.trigger;
  if (typeof trigger === "string") {
    const match = /^[A-Z]+ (\/\S*)/.exec(trigger);
    if (match) return match[1];
  }
  return null;
}

/** Counts events by route pattern. */
export function countByRoute(events) {
  const counts = new Map();
  for (const event of events) {
    const route = (() => {
      const found = eventPath(event);
      return found === null ? "(no path)" : routePattern(found);
    })();
    counts.set(route, (counts.get(route) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The query body for one page of hung-request events. */
export function queryBody({ worker, from, to, offset }) {
  return {
    queryId: "production-hang-count",
    view: "events",
    dry: true,
    limit: PAGE_LIMIT,
    timeframe: { from, to },
    ...(offset ? { offset } : {}),
    parameters: {
      datasets: ["cloudflare-workers"],
      filters: [{ key: "$workers.scriptName", operation: "eq", type: "string", value: worker }],
      needle: { value: HUNG_NEEDLE, isRegex: false, matchCase: false },
    },
  };
}

function requiredEnv(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Reads every page of hung-request events (up to MAX_PAGES) and returns them with whether it stopped early. */
export async function fetchHungEvents({ fetchImpl, token, accountId, worker, from, to }) {
  const events = [];
  let offset;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/observability/telemetry/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(queryBody({ worker, from, to, offset })),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      const messages = (body?.errors ?? []).map((error) => `${error.code ?? ""} ${error.message ?? ""}`.trim()).join("; ");
      throw new Error(`Workers Logs query failed with HTTP ${response.status}${messages ? `: ${messages}` : ""}`);
    }
    const pageEvents = body.result?.events?.events ?? [];
    events.push(...pageEvents);
    offset = pageEvents.length === PAGE_LIMIT ? pageEvents.at(-1)?.$metadata?.id : undefined;
    if (!offset) return { events, truncated: false };
  }
  return { events, truncated: true };
}

/** The report as Markdown: totals, then one row per route pattern. */
export function report({ worker, hours, counts, truncated, to }) {
  const total = counts.reduce((sum, [, count]) => sum + count, 0);
  const lines = [
    `## Hung requests on ${worker}, last ${hours} h`,
    "",
    `${total} request(s) canceled as hung, to ${new Date(to).toISOString()}.${truncated ? ` Stopped after ${MAX_PAGES * PAGE_LIMIT} events, so the count is a floor.` : ""}`,
  ];
  if (counts.length > 0) {
    lines.push("", "| Route | Hung |", "| --- | ---: |", ...counts.map(([route, count]) => `| \`${route}\` | ${count} |`));
  }
  return `${lines.join("\n")}\n`;
}

export async function runHangCount({ env = process.env, fetchImpl = fetch, now = Date.now(), write = (text) => process.stdout.write(text), appendFile = appendFileSync } = {}) {
  const token = requiredEnv(env, "CLOUDFLARE_API_TOKEN");
  const accountId = requiredEnv(env, "CLOUDFLARE_ACCOUNT_ID");
  const worker = env.HANG_COUNT_WORKER || "spoonjoy-v2";
  const hours = Number(env.HANG_COUNT_HOURS || 24);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 7) throw new Error(`HANG_COUNT_HOURS must be between 0 and ${24 * 7}`);
  const to = now;
  const from = to - hours * 60 * 60 * 1000;
  const { events, truncated } = await fetchHungEvents({ fetchImpl, token, accountId, worker, from, to });
  const text = report({ worker, hours, counts: countByRoute(events), truncated, to });
  write(text);
  if (env.GITHUB_STEP_SUMMARY) appendFile(env.GITHUB_STEP_SUMMARY, text);
  return text;
}

export function isCliEntry(argv1, moduleUrl) {
  return Boolean(argv1) && path.resolve(argv1) === fileURLToPath(moduleUrl);
}

/* istanbul ignore if -- @preserve CLI boundary delegates to the tested runHangCount above. */
if (isCliEntry(process.argv[1], import.meta.url)) {
  runHangCount().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
