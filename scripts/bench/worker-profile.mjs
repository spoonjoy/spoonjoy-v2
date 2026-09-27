#!/usr/bin/env node
// Whole-request CPU profile of the built Worker on workerd. Not part of CI.
//
// Runs the production bundle (`build/server/_worker.js`, from `CLOUDFLARE_ENV=qa pnpm run build`)
// in Miniflare with a local D1 seeded with the QA kitchen, signs in as the kitchen chef with a
// minted session cookie, and for each scenario sends the same request many times while V8's
// sampling profiler runs inside workerd (through its inspector). It reports CPU per request
// (profiler samples that are not idle), the time spent under each phase of the request, and the
// functions with the most self time.
//
// Usage: node scripts/bench/worker-profile.mjs [--requests 200] [--scenario <name>] [--json <file>]
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createCookieSessionStorage } from "react-router";
import { buildKitchenResetSql, personaSessionVersion } from "../seed-qa-kitchen.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { Miniflare } = createRequire(require.resolve("wrangler/package.json"))("miniflare");

const { values: args } = parseArgs({
  options: {
    requests: { type: "string", default: "200" },
    scenario: { type: "string", multiple: true },
    json: { type: "string" },
    "sampling-us": { type: "string", default: "50" },
    // Cold and lukewarm scenarios each start this many fresh isolates and report the mean.
    "isolate-runs": { type: "string", default: "5" },
    // Writes each scenario's raw profile here as <scenario>.cpuprofile (opens in Chrome DevTools).
    "save-profiles": { type: "string" },
  },
});
const REQUESTS = Number(args.requests);
const BASE = "https://spoonjoy-v2-qa.mendelow-studio.workers.dev";
const SECRET = "bench-session-secret-0123456789abcdef";
const SEED_NOW = Date.parse("2026-09-01T00:00:00Z");
const CHEF = "qa-kitchen-chef";
const RECIPE = "qa-kitchen-recipe-lemon-rice";

function migrationStatements(sql) {
  const statements = [];
  let buffer = "";
  let inTrigger = false;
  for (const line of sql.split(/\r?\n/)) {
    if (/^\s*--/.test(line) || !line.trim()) continue;
    buffer += `${line}\n`;
    if (/^\s*CREATE\s+TRIGGER\b/i.test(buffer)) inTrigger = true;
    const complete = inTrigger ? /^\s*END;\s*$/i.test(line) : /;\s*$/.test(line);
    if (!complete) continue;
    statements.push(buffer.trim());
    buffer = "";
    inTrigger = false;
  }
  return statements;
}

async function seed(mf) {
  const db = await mf.getD1Database("DB");
  const migrations = readdirSync(join(ROOT, "migrations")).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) {
    for (const statement of migrationStatements(readFileSync(join(ROOT, "migrations", name), "utf8"))) {
      await db.prepare(statement).run();
    }
  }
  const kitchen = buildKitchenResetSql({
    passwords: { chef: "bench", friend: "bench", newbie: "bench" },
    hash: () => "$2a$04$benchbenchbenchbenchbeuHashPlaceholderNotARealHash0",
    now: () => SEED_NOW,
  });
  for (const statement of kitchen.split(/;\n/).map((line) => line.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
}

async function chefCookie() {
  const storage = createCookieSessionStorage({
    cookie: { name: "__session", secrets: [SECRET], sameSite: "lax", path: "/", httpOnly: true, secure: true },
  });
  const session = await storage.getSession();
  session.set("userId", CHEF);
  session.set("sessionVersion", personaSessionVersion(SEED_NOW));
  return (await storage.commitSession(session)).split(";")[0];
}

class Inspector {
  static async connect(port) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find((candidate) => candidate.id?.includes("bench")) ?? targets[0];
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveOpen, reject) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new Inspector(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const waiter = message.id === undefined ? undefined : this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveResult, reject) => this.pending.set(id, { resolve: resolveResult, reject }));
  }

  close() {
    this.socket.close();
  }
}

// Phases: a sample counts toward a phase when any frame on its stack matches. A sample can
// count toward several phases (they nest), so the phase column does not add up.
const PHASES = [
  ["Worker entry (workers/app.ts fetch)", (f) => f.functionName === "fetch" && /worker-entry/.test(f.url)],
  ["React Router request handler", (f) => /^(requestHandler|handleDocumentRequest|handleSingleFetchRequest|handleDataRequest|staticHandler|singleFetch|runServerMiddlewarePipeline)/i.test(f.functionName)],
  ["Route matching", (f) => /^(matchRoutes|matchRoutesImpl|flattenRoutes|rankRouteBranches|computeScore|matchPath|compilePath)$/.test(f.functionName)],
  ["Session cookie (parse and verify)", (f) => /^(getSession|parseCookie|unsign|sign|verify|getCryptoKey|parse)$/.test(f.functionName) && !/react-dom/.test(f.url)],
  ["Loaders", (f) => /loader$/i.test(f.functionName) || /^(loadRecipeDetail|loadAccountSettings|readKitchenHome|readRecipeDetail|readAccountSettings|searchSpoonjoy)/.test(f.functionName)],
  ["Prisma", (f) => /prisma|query_engine|wasm/i.test(f.url) || /PrismaClient/.test(f.functionName)],
  ["D1 client (serialise/parse)", (f) => /cloudflare-internal:d1|d1-api/.test(f.url)],
  ["turbo-stream encode", (f) => /^(encode|flatten|stringify|encodeViaTurboStream|serializeValue)$/.test(f.functionName)],
  ["React SSR render (renderToReadableStream)", (f) => /react-dom/.test(f.url) || /^(renderToReadableStream|renderRootElement|performWork|renderNode|renderElement|retryTask|flushCompletedQueues)$/.test(f.functionName)],
  ["Security headers and nonce", (f) => /^(withSecurityHeaders|buildContentSecurityPolicy|generateNonce|contentSecurityPolicy)/.test(f.functionName)],
  ["Module evaluation (first request)", (f) => f.functionName === "" && f.lineNumber === 0],
  ["Garbage collection", (f) => f.functionName === "(garbage collector)"],
];

function summarizeProfile(profile, requests) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parent = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const selfTime = new Map();
  const phaseTime = new Map(PHASES.map(([name]) => [name, 0]));
  let busy = 0;
  let idle = 0;
  let program = 0;
  profile.samples.forEach((sampleId, index) => {
    const delta = (profile.timeDeltas[index + 1] ?? 0) / 1000;
    const node = nodes.get(sampleId);
    const name = node.callFrame.functionName;
    if (name === "(idle)" || name === "(root)") {
      idle += delta;
      return;
    }
    // Native work V8 cannot attribute to a JavaScript frame. workerd does not mark its event
    // loop as idle, so this mixes real native work with waiting; it is reported separately.
    if (name === "(program)") {
      program += delta;
      return;
    }
    busy += delta;
    const key = `${name || "(anonymous)"} ${node.callFrame.url.split("/").pop()}:${node.callFrame.lineNumber + 1}`;
    selfTime.set(key, (selfTime.get(key) ?? 0) + delta);
    const stack = [];
    for (let id = sampleId; id !== undefined; id = parent.get(id)) stack.push(nodes.get(id).callFrame);
    for (const [phase, matches] of PHASES) {
      if (stack.some(matches)) phaseTime.set(phase, phaseTime.get(phase) + delta);
    }
  });
  const perRequest = (ms) => Number((ms / requests).toFixed(3));
  return {
    requests,
    cpuMsPerRequest: perRequest(busy),
    programMsPerRequest: perRequest(program),
    idleMsPerRequest: perRequest(idle),
    phases: Object.fromEntries([...phaseTime].map(([name, ms]) => [name, perRequest(ms)])),
    topSelf: [...selfTime].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, ms]) => [name, perRequest(ms)]),
  };
}

const SCENARIOS = [
  { name: "cold: first /_root.data in a fresh isolate", path: "/_root.data", signedIn: true, cold: true },
  { name: "cold: first /recipes/:id HTML in a fresh isolate", path: `/recipes/${RECIPE}`, signedIn: true, html: true, cold: true },
  { name: "lukewarm: requests 2-11 of /recipes/:id.data in a fresh isolate", path: `/recipes/${RECIPE}.data`, signedIn: true, lukewarm: true },
  { name: "lukewarm: requests 2-11 of /recipes/:id HTML in a fresh isolate", path: `/recipes/${RECIPE}`, signedIn: true, html: true, lukewarm: true },
  { name: "/_root.data (home data, signed in)", path: "/_root.data", signedIn: true },
  { name: "/_root.data (signed out)", path: "/_root.data", signedIn: false },
  { name: "/ HTML (signed in)", path: "/", signedIn: true, html: true },
  { name: "/recipes/:id.data (owner)", path: `/recipes/${RECIPE}.data`, signedIn: true },
  { name: "/recipes/:id HTML (owner)", path: `/recipes/${RECIPE}`, signedIn: true, html: true },
  { name: "/search.data?q=rice", path: "/search.data?q=rice", signedIn: true },
  { name: "/search HTML ?q=rice", path: "/search?q=rice", signedIn: true, html: true },
  { name: "/account/settings.data", path: "/account/settings.data", signedIn: true },
  { name: "/recipes.data", path: "/recipes.data", signedIn: true },
  { name: "/my-recipes.data", path: "/my-recipes.data", signedIn: true },
  { name: "/saved-recipes.data", path: "/saved-recipes.data", signedIn: true },
  { name: "/cookbooks.data", path: "/cookbooks.data", signedIn: true },
  { name: "/health", path: "/health", signedIn: false },
];

// Every file of the build, listed explicitly: the bundle has dynamic imports Miniflare cannot
// follow on its own.
function builtModules() {
  const server = join(ROOT, "build/server");
  const assets = readdirSync(join(server, "assets")).map((name) => join(server, "assets", name));
  const typeOf = (path) => (path.endsWith(".wasm") ? "CompiledWasm" : path.endsWith(".js") ? "ESModule" : null);
  return [join(server, "_worker.js"), ...assets]
    .filter((path) => typeOf(path))
    .map((path) => ({ type: typeOf(path), path, contents: readFileSync(path) }));
}

async function startWorker() {
  const inspectorPort = 9300 + Math.floor(Math.random() * 500);
  const mf = new Miniflare({
    name: "bench",
    modulesRoot: join(ROOT, "build/server"),
    modules: builtModules(),
    compatibilityDate: "2024-12-01",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "bench-db" },
    durableObjects: { COOK_SESSIONS: "CookSession" },
    ratelimits: {
      API_TOKEN_RATE_LIMITER: { simple: { limit: 100000, period: 60 } },
      API_IP_RATE_LIMITER: { simple: { limit: 100000, period: 60 } },
      AUTH_IP_RATE_LIMITER: { simple: { limit: 100000, period: 60 } },
    },
    bindings: {
      NODE_ENV: "production",
      SPOONJOY_BASE_URL: BASE,
      COOK_SESSION_BOOTSTRAP_MODE: "1",
      SPOONJOY_CSP_MODE: "enforce",
      VITE_POSTHOG_HOST: "https://us.i.posthog.com",
      SESSION_SECRET: SECRET,
    },
    inspectorPort,
  });
  const started = performance.now();
  await mf.ready;
  // workerd evaluates the Worker's statically imported modules here, before any request.
  return { mf, inspectorPort, startupWallMs: performance.now() - started };
}

async function request(mf, scenario, cookie) {
  const headers = { "User-Agent": "Mozilla/5.0 (Macintosh) bench", Accept: scenario.html ? "text/html" : "*/*" };
  if (scenario.signedIn) headers.Cookie = cookie;
  const response = await mf.dispatchFetch(`${BASE}${scenario.path}`, { headers, redirect: "manual" });
  const body = await response.arrayBuffer();
  return { status: response.status, bytes: body.byteLength };
}

async function profileScenario(scenario, cookie, shared) {
  const isolated = scenario.cold || scenario.lukewarm;
  const fresh = isolated ? await startWorker() : shared;
  if (isolated) await seed(fresh.mf);
  // A lukewarm isolate has served one request: its modules are loaded, but its code has not
  // run often enough to be optimised, as on a low-traffic Worker.
  if (scenario.lukewarm) await request(fresh.mf, scenario, cookie);
  const inspector = await Inspector.connect(fresh.inspectorPort);
  await inspector.send("Profiler.enable");
  await inspector.send("Profiler.setSamplingInterval", { interval: Number(args["sampling-us"]) });
  const count = scenario.cold ? 1 : scenario.lukewarm ? 10 : REQUESTS;
  if (!isolated) for (let i = 0; i < 20; i += 1) await request(fresh.mf, scenario, cookie);
  await inspector.send("Profiler.start");
  const started = performance.now();
  let last;
  for (let i = 0; i < count; i += 1) last = await request(fresh.mf, scenario, cookie);
  const wall = performance.now() - started;
  const { profile } = await inspector.send("Profiler.stop");
  if (args["save-profiles"]) {
    mkdirSync(args["save-profiles"], { recursive: true });
    const file = scenario.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    writeFileSync(join(args["save-profiles"], `${file}.cpuprofile`), JSON.stringify(profile));
  }
  inspector.close();
  if (isolated) await fresh.mf.dispose();
  return {
    name: scenario.name,
    status: last.status,
    bytes: last.bytes,
    dispatchWallMs: Number((wall / count).toFixed(2)),
    ...(isolated ? { startupWallMs: Number(fresh.startupWallMs.toFixed(1)) } : {}),
    ...summarizeProfile(profile, count),
  };
}

const cookie = await chefCookie();
const shared = await startWorker();
await seed(shared.mf);
const selected = args.scenario ? SCENARIOS.filter((scenario) => args.scenario.some((name) => scenario.name.includes(name))) : SCENARIOS;
// The mean of several runs' summaries (numbers averaged field by field).
function meanOf(runs) {
  const average = (values) => Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
  const self = new Map();
  for (const run of runs) for (const [name, ms] of run.topSelf) self.set(name, (self.get(name) ?? 0) + ms / runs.length);
  return {
    ...runs[0],
    runs: runs.length,
    cpuMsPerRequest: average(runs.map((run) => run.cpuMsPerRequest)),
    cpuMsPerRequestRuns: runs.map((run) => run.cpuMsPerRequest),
    programMsPerRequest: average(runs.map((run) => run.programMsPerRequest)),
    idleMsPerRequest: average(runs.map((run) => run.idleMsPerRequest)),
    dispatchWallMs: average(runs.map((run) => run.dispatchWallMs)),
    startupWallMs: average(runs.map((run) => run.startupWallMs ?? 0)),
    phases: Object.fromEntries(Object.keys(runs[0].phases).map((name) => [name, average(runs.map((run) => run.phases[name]))])),
    topSelf: [...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, ms]) => [name, Number(ms.toFixed(3))]),
  };
}

const results = [];
for (const scenario of selected) {
  const runs = [];
  const runCount = scenario.cold || scenario.lukewarm ? Number(args["isolate-runs"]) : 1;
  for (let run = 0; run < runCount; run += 1) runs.push(await profileScenario(scenario, cookie, shared));
  const result = runCount === 1 ? runs[0] : meanOf(runs);
  results.push(result);
  const phases = Object.entries(result.phases).filter(([, ms]) => ms > 0).map(([name, ms]) => `${name} ${ms}`).join("; ");
  const startup = result.startupWallMs === undefined ? "" : ` startup wall ${result.startupWallMs} ms;`;
  console.log(`${result.name}:${startup} status ${result.status}, ${result.bytes} B, CPU ${result.cpuMsPerRequest} ms/request (+${result.programMsPerRequest} native/unattributed; dispatch wall ${result.dispatchWallMs} ms). ${phases}`);
  console.log(`  top self: ${result.topSelf.slice(0, 10).map(([name, ms]) => `${name} ${ms}`).join(" | ")}`);
}
await shared.mf.dispose();
if (args.json) writeFileSync(args.json, JSON.stringify(results, null, 2));
