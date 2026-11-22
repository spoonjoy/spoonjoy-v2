#!/usr/bin/env node
// Looks up OSV-Scanner's release tag through the GitHub API, so the advisory job can check it
// points at the pinned commit before downloading the binary. The lookup sends the job's
// GITHUB_TOKEN. GitHub can still answer 403 or 429 when a rate limit is hit, and curl's --retry
// skips a 403, so this retries those, and 5xx answers and network errors, with a short backoff
// (spoonjoy-v2#840). When the last try fails it prints the answer's status and headers, which
// show which limit was hit. Usage: node scripts/fetch-osv-scanner-tag.mjs <output.json>
// with OSV_SCANNER_VERSION and GITHUB_TOKEN set.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const RETRY_STATUSES = new Set([403, 429, 500, 502, 503, 504]);
export const LOOKUP_TIMEOUT_MS = 30_000;
// Without a hint from GitHub, a failed try waits 2 s, then 4 s, then 8 s; a retry-after or
// rate-limit reset is followed but capped, so a long limit fails the job rather than stalling it.
export const MAX_WAIT_MS = 30_000;
const backoffMs = (attempt) => 1000 * 2 ** attempt;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function tagUrl(version) {
  return `https://api.github.com/repos/google/osv-scanner/git/ref/tags/${version}`;
}

export function waitMs(headers, attempt, now = Date.now()) {
  const retryAfter = Number(headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, MAX_WAIT_MS);
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (headers.get("x-ratelimit-remaining") === "0" && Number.isFinite(reset)) {
    return Math.min(Math.max(reset * 1000 - now, 1000), MAX_WAIT_MS);
  }
  return backoffMs(attempt);
}

export function describeAnswer(response) {
  const lines = [`status ${response.status}`];
  for (const [name, value] of response.headers) lines.push(`${name}: ${value}`);
  return lines.join("\n");
}

export async function fetchOsvScannerTag({
  version,
  token,
  output,
  fetchImpl = fetch,
  attempts = 4,
  sleep = defaultSleep,
  log = console.log,
}) {
  if (!version) throw new Error("fetch-osv-scanner-tag needs OSV_SCANNER_VERSION");
  if (!token) throw new Error("fetch-osv-scanner-tag needs GITHUB_TOKEN");
  if (!output) throw new Error("fetch-osv-scanner-tag needs an output path");
  const url = tagUrl(version);
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    } catch (error) {
      if (attempt >= attempts) throw new Error(`${url} could not be reached: ${error.message}`);
      const ms = backoffMs(attempt);
      log(`OSV-Scanner tag lookup could not reach GitHub (${error.message}); trying again in ${ms / 1000} s`);
      await sleep(ms);
      continue;
    }
    if (response.ok) {
      const body = await response.text();
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, body);
      return output;
    }
    if (!RETRY_STATUSES.has(response.status) || attempt >= attempts) {
      throw new Error(`${url} answered ${response.status} on try ${attempt} of ${attempts}\n${describeAnswer(response)}`);
    }
    const ms = waitMs(response.headers, attempt);
    log(`OSV-Scanner tag lookup answered ${response.status}; trying again in ${ms / 1000} s`);
    await sleep(ms);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  fetchOsvScannerTag({
    version: process.env.OSV_SCANNER_VERSION,
    token: process.env.GITHUB_TOKEN,
    output: process.argv[2],
  }).then(
    () => {},
    (error) => {
      console.error(`::error title=OSV-Scanner tag lookup failed::${error.message.split("\n")[0]}`);
      console.error(error.message);
      process.exit(1);
    },
  );
}
