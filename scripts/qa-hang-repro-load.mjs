#!/usr/bin/env node
// Load client for the QA Hang Repro workflow (.github/workflows/qa-hang-repro.yml).
//
// It signs in as the seeded QA kitchen chef on one run-scoped QA Worker and sends a mix of
// signed-in reads and writes from `loops` concurrent loops for `seconds`. A share of requests is
// aborted by the client within `abortWindowMs`, the way a browser cancels a navigation, because
// aborted requests are what made Prisma's wasm engine report "The Workers runtime canceled this
// request because it detected that your Worker's code had hung" (Cloudflare error 1101).
//
// Usage:
//   node scripts/qa-hang-repro-load.mjs <label> <baseUrl> <credentialsFile> <outDir> \
//     <seconds> <loops> <abortShare> <abortWindowMs> <writeShare>
//
// Output: <outDir>/<label>.requests.ndjson (one line per request: time, method, path, status,
// client time, abort time, Cloudflare ray id, and an error class) and <outDir>/<label>.summary.json.
// No cookie, password, header or response body is written or printed.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const RECIPE = "qa-kitchen-recipe-risotto";
// A request with no response after this long counts as "no response".
export const NO_RESPONSE_MS = 30_000;
const HUNG_PAGE = /had hung|would never generate a response/;

export function parseArgs(argv) {
  if (argv.length !== 9) {
    throw new Error(
      "Usage: qa-hang-repro-load.mjs <label> <baseUrl> <credentialsFile> <outDir> <seconds> <loops> <abortShare> <abortWindowMs> <writeShare>",
    );
  }
  const [label, baseUrl, credentialsFile, outDir, seconds, loops, abortShare, abortWindowMs, writeShare] = argv;
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error(`label must be lowercase letters, digits and dashes: ${label}`);
  if (!/^https:\/\/spoonjoy-v2-qa-run-\d+-\d+\.[a-z0-9.-]+\.workers\.dev$/.test(baseUrl)) {
    throw new Error(`Refusing to load ${baseUrl}: not a per-run QA Worker URL.`);
  }
  const numbers = { seconds: Number(seconds), loops: Number(loops), abortShare: Number(abortShare), abortWindowMs: Number(abortWindowMs), writeShare: Number(writeShare) };
  if (!Number.isInteger(numbers.seconds) || numbers.seconds < 1 || numbers.seconds > 1800) throw new Error("seconds must be a whole number from 1 to 1800");
  if (!Number.isInteger(numbers.loops) || numbers.loops < 1 || numbers.loops > 64) throw new Error("loops must be a whole number from 1 to 64");
  for (const key of ["abortShare", "writeShare"]) {
    if (!(numbers[key] >= 0 && numbers[key] <= 1)) throw new Error(`${key} must be between 0 and 1`);
  }
  if (!Number.isInteger(numbers.abortWindowMs) || numbers.abortWindowMs < 1 || numbers.abortWindowMs > 10_000) {
    throw new Error("abortWindowMs must be a whole number from 1 to 10000");
  }
  return { label, baseUrl, credentialsFile, outDir, ...numbers };
}

// The request mix: signed-in reads of the routes that hung in production and QA, plus two writes
// (a shopping-list add and a recipe fork, the heaviest D1 write).
export function requestFor({ write, pick, userId, item }) {
  const reads = [
    { path: `/api/cook-sessions/${RECIPE}`, init: { headers: { "X-Spoonjoy-Cook-User": userId } } },
    { path: "/shopping-list", init: {} },
    { path: "/shopping-list.data", init: {} },
    { path: `/recipes/${RECIPE}.data`, init: {} },
    { path: `/recipes/${RECIPE}`, init: {} },
    { path: "/users/qa-kitchen-friend.data", init: {} },
    { path: "/_root.data", init: {} },
  ];
  const form = { "Content-Type": "application/x-www-form-urlencoded" };
  const writes = [
    {
      path: "/shopping-list.data",
      init: { method: "POST", headers: form, body: new URLSearchParams({ intent: "addItem", quantity: "1", unitName: "cup", ingredientName: `rice ${item}` }) },
    },
    { path: `/recipes/${RECIPE}/fork.data`, init: { method: "POST", headers: form, body: new URLSearchParams({}) } },
  ];
  const list = write ? writes : reads;
  return list[Math.min(list.length - 1, Math.floor(pick * list.length))];
}

// Only the error class is kept, never the message text, so nothing from a response or a
// Prisma error reaches the artifact.
export function errorClass(error) {
  if (error?.name === "AbortError") return "aborted";
  if (error?.message === "no response") return "no response";
  return "fetch error";
}

export function emptyCounts() {
  return { total: 0, aborted: 0, abortedBeforeResponse: 0, noResponse: 0, noResponseUnaborted: 0, fetchErrors: 0, status: {}, hungPages: 0, byRoute: {} };
}

export function count(counts, record) {
  counts.total += 1;
  const aborted = record.abortAt != null;
  if (aborted) counts.aborted += 1;
  if (record.error === "aborted") counts.abortedBeforeResponse += 1;
  if (record.error === "no response") {
    counts.noResponse += 1;
    if (!aborted) counts.noResponseUnaborted += 1;
  }
  if (record.error === "fetch error") counts.fetchErrors += 1;
  if (record.status != null) counts.status[record.status] = (counts.status[record.status] ?? 0) + 1;
  if (record.hungPage) counts.hungPages += 1;
  const route = (counts.byRoute[`${record.method} ${record.path}`] ??= { n: 0, s5xx: 0, noResponse: 0 });
  route.n += 1;
  if (record.status >= 500) route.s5xx += 1;
  if (record.error === "no response") route.noResponse += 1;
  return counts;
}

function cookieHeader(response) {
  return (response.headers.getSetCookie?.() ?? []).map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

function withTimeout(promise, ms, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error("no response"));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function signIn({ baseUrl, persona, fetchImpl = fetch }) {
  const response = await fetchImpl(`${baseUrl}/login`, {
    method: "POST",
    body: new URLSearchParams({ identifier: persona.username ?? persona.email, password: persona.password }),
    redirect: "manual",
    headers: { Origin: baseUrl, "Content-Type": "application/x-www-form-urlencoded" },
  });
  const cookie = cookieHeader(response);
  if (!cookie) throw new Error(`Sign-in returned ${response.status} with no session cookie.`);
  const check = await fetchImpl(`${baseUrl}/shopping-list`, { headers: { Cookie: cookie }, redirect: "manual" });
  await check.arrayBuffer();
  if (check.status !== 200) throw new Error(`Signed-in check of /shopping-list returned ${check.status}.`);
  return cookie;
}

export async function sendOne({ baseUrl, cookie, userId, settings, random = Math.random, fetchImpl = fetch, now = Date.now, noResponseMs = NO_RESPONSE_MS }) {
  const write = random() < settings.writeShare;
  const { path, init } = requestFor({ write, pick: random(), userId, item: Math.floor(random() * 20) });
  const method = init.method ?? "GET";
  const controller = new AbortController();
  const abortAt = random() < settings.abortShare ? Math.round(random() * settings.abortWindowMs) : null;
  const abortTimer = abortAt == null ? undefined : setTimeout(() => controller.abort(), abortAt);
  const started = now();
  const record = { t: new Date(started).toISOString(), method, path, abortAt };
  try {
    const response = await withTimeout(
      fetchImpl(`${baseUrl}${path}`, { ...init, redirect: "manual", signal: controller.signal, headers: { ...(init.headers ?? {}), Cookie: cookie, Origin: baseUrl } }),
      noResponseMs,
      () => controller.abort(),
    );
    record.status = response.status;
    record.ray = response.headers.get("cf-ray");
    const text = await withTimeout(response.text(), noResponseMs, () => controller.abort());
    if (response.status >= 500 && HUNG_PAGE.test(text)) record.hungPage = true;
  } catch (error) {
    record.error = errorClass(error);
  } finally {
    clearTimeout(abortTimer);
    record.ms = now() - started;
  }
  return record;
}

export async function run(options, deps = {}) {
  const { fetchImpl = fetch, now = Date.now, random = Math.random, log = console.log, readFile = readFileSync, writeFile = writeFileSync, appendFile = appendFileSync } = deps;
  const credentials = JSON.parse(readFile(options.credentialsFile, "utf8"));
  const cookie = await signIn({ baseUrl: options.baseUrl, persona: credentials.chef, fetchImpl });
  const userId = credentials.chef.username ?? "qa-kitchen-chef";
  const requestsFile = `${options.outDir}/${options.label}.requests.ndjson`;
  writeFile(requestsFile, "");
  const counts = emptyCounts();
  const startedAt = now();
  const deadline = startedAt + options.seconds * 1000;
  let buffer = [];
  const flush = () => {
    if (buffer.length) appendFile(requestsFile, `${buffer.join("\n")}\n`);
    buffer = [];
  };
  async function loop() {
    while (now() < deadline) {
      const record = await sendOne({ baseUrl: options.baseUrl, cookie, userId, settings: options, random, fetchImpl, now, noResponseMs: deps.noResponseMs });
      count(counts, record);
      buffer.push(JSON.stringify(record));
      if (buffer.length >= 200) flush();
    }
  }
  await Promise.all(Array.from({ length: options.loops }, loop));
  flush();
  const { credentialsFile: _credentialsFile, outDir: _outDir, ...settings } = options;
  const summary = { ...settings, started: new Date(startedAt).toISOString(), ended: new Date(now()).toISOString(), startedMs: startedAt, endedMs: now(), ...counts };
  writeFile(`${options.outDir}/${options.label}.summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
  const { byRoute: _byRoute, ...headline } = counts;
  log(JSON.stringify({ label: options.label, ...headline }));
  return summary;
}

if (typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // A pending top-level await with no timers would let Node exit early (code 13).
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await run(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    clearInterval(keepAlive);
  }
}
