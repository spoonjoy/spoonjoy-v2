#!/usr/bin/env node
// Counts the Cloudflare API requests a Journeys run makes, so the per-run QA stack's cost against
// Cloudflare's API rate limit (1,200 requests per 5 minutes per user) is measured, not guessed.
//
// Loaded into every Node process of a Cloudflare step with
// `NODE_OPTIONS=--import <this file>` and SPOONJOY_CF_REQUEST_LOG set. Node's fetch and the undici
// copy bundled into wrangler both publish `undici:request:create`, so this sees wrangler's own
// requests as well as qa-run-scope.mjs's. Each request to api.cloudflare.com appends one line,
// `<METHOD> <path>`, with the account id replaced and the query string dropped; nothing from the
// request's headers or body is read, so no token can reach the log.
//
// `node scripts/count-cloudflare-requests.mjs summary <log>` prints the total and the busiest
// endpoints, for the job summary.
import { subscribe as nodeSubscribe } from "node:diagnostics_channel";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com";
export const LOG_ENV = "SPOONJOY_CF_REQUEST_LOG";

export function describeRequest(request) {
  if (request?.origin !== CLOUDFLARE_API_ORIGIN) return null;
  const path = String(request.path ?? "")
    .split("?")[0]
    .replace(/\/accounts\/[^/]+/, "/accounts/:account")
    .replace(/\/d1\/database\/[0-9a-f-]{36}/, "/d1/database/:id");
  return `${request.method} ${path}`;
}

export function install({ env = process.env, subscribe = nodeSubscribe, append = appendFileSync } = {}) {
  const log = env[LOG_ENV];
  if (!log) return false;
  subscribe("undici:request:create", ({ request }) => {
    const line = describeRequest(request);
    if (line) append(log, `${line}\n`);
  });
  return true;
}

export function summarize(text) {
  const lines = text.split("\n").filter(Boolean);
  const byEndpoint = new Map();
  for (const line of lines) byEndpoint.set(line, (byEndpoint.get(line) ?? 0) + 1);
  const busiest = [...byEndpoint].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return [
    `Cloudflare API requests this run: ${lines.length}`,
    ...busiest.map(([endpoint, count]) => `  ${String(count).padStart(4)}  ${endpoint}`),
  ].join("\n");
}

export function main(argv, { readFile, exists, log }) {
  const [command, file] = argv;
  if (command !== "summary" || !file) throw new Error("Usage: count-cloudflare-requests.mjs summary <log>");
  log(summarize(exists(file) ? readFile(file, "utf8") : ""));
}

export function isCliEntry(moduleUrl, argv1) {
  return typeof argv1 === "string" && moduleUrl === pathToFileURL(argv1).href;
}

// Run as a command, it summarises; loaded with --import, it counts.
export function start({
  moduleUrl = import.meta.url,
  argv = process.argv,
  runMain = () => main(argv.slice(2), { readFile: readFileSync, exists: existsSync, log: console.log }),
  runInstall = install,
} = {}) {
  if (isCliEntry(moduleUrl, argv[1])) {
    runMain();
    return "summary";
  }
  runInstall();
  return "count";
}

start();
