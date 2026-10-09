#!/usr/bin/env node
// Gives each Journeys run its own QA stack, so runs for different pull requests never wait on
// each other.
//
// Before this, QA was single-tenant: every run deployed its build to the one `spoonjoy-v2-qa`
// Worker and seeded the one `spoonjoy-qa` D1, so runs queued for their turn (about 10 minutes
// each; 40 queued runs meant a 7-hour wait). Now each run gets:
//   - its own D1 database, `spoonjoy-qa-run-<run id>-<attempt>`, created empty and migrated from
//     this checkout's `migrations/` (so a pull request's own migrations apply only to its own
//     database, and never to shared QA before they merge);
//   - its own Worker, `spoonjoy-v2-qa-run-<run id>-<attempt>`, served at
//     `https://spoonjoy-v2-qa-run-<run id>-<attempt>.mendelow-studio.workers.dev`, with its own
//     cook-session Durable Object namespace and per-run secrets;
//   - the shared QA R2 bucket and rate-limit namespaces. The seed writes no R2 objects, and every
//     key the app writes has a timestamp and a random UUID in it, so every R2 key the run's
//     database references was uploaded by this run; cleanup deletes only keys its own database
//     references.
//
// Cloudflare does not generate version preview URLs for a Worker that implements a Durable
// Object, so a per-run Worker is the way to give each run its own URL.
//
// The run's database always starts empty. It is never a copy of shared QA: D1 cannot export a
// database with a virtual table (migration 0006 adds an FTS5 table), an export blocks shared QA
// while it runs, and a copy would let cleanup delete R2 objects shared QA still references.
//
// How the rest of the workflow follows: `prepare` rewrites this CI checkout's wrangler.json
// `env.qa` (Worker name, D1 binding, SPOONJOY_BASE_URL) and the generated build/server/wrangler.json
// to the run's identity, after the QA preflight has checked both against the shared QA identity.
// Every later `--env qa` command (migrations, deploy, seed, rotate, cleanup) then targets the
// run's own stack with no other change. Only identity fields change; anything else differing is
// an error. It refuses to run outside GitHub Actions, so it never rewrites a developer's config.
//
// Commands (node scripts/qa-run-scope.mjs <command>):
//   prepare   sweep stale run stacks, create this run's empty D1, rewrite the configs, write the
//             per-run secrets file, export the run's base URL.
//   deploy    deploy this build to the run's Worker with the run's secrets, retrying when
//             Cloudflare does not yet know the brand-new script (code 10007).
//   verify    after deploy: the run's Worker has its secrets, its D1 has no pending migration,
//             and the URL serves /health and a hashed asset.
//   teardown  delete this run's Worker and D1 (always; a failure only warns, and a later sweep
//             deletes anything older than STALE_AFTER_MS).
//   sweep     delete run stacks older than STALE_AFTER_MS; run on a schedule as well as by each
//             prepare, and fails when more than MAX_RUN_WORKERS run Workers remain.
//
// Environment (set by GitHub Actions): GITHUB_ACTIONS, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT,
// GITHUB_ENV, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
import { execFile as nodeExecFile } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { QA_BASE_URL, QA_D1_DATABASE_ID, QA_D1_DATABASE_NAME } from "./script-environment.mjs";

export const CANONICAL_WORKER_NAME = "spoonjoy-v2-qa";
export const RUN_WORKER_PREFIX = "spoonjoy-v2-qa-run-";
export const RUN_DATABASE_PREFIX = "spoonjoy-qa-run-";
export const RUN_WORKER_PATTERN = /^spoonjoy-v2-qa-run-\d+-\d+$/;
export const RUN_DATABASE_PATTERN = /^spoonjoy-qa-run-\d+-\d+$/;
// The journeys job times out after 40 minutes, so a run stack older than this belongs to a run
// that ended without its teardown (cancelled, or the runner died).
export const STALE_AFTER_MS = 3 * 60 * 60_000;
export const STATE_DIR = ".qa-run";
export const STATE_FILE = join(STATE_DIR, "scope.json");
export const SECRETS_FILE = join(STATE_DIR, "secrets.json");
export const WRANGLER_CONFIG = "wrangler.json";
export const GENERATED_BUILD_CONFIG = join("build", "server", "wrangler.json");
export const REQUIRED_RUN_SECRETS = ["SESSION_SECRET", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];
// Only these per-run values are secret. Masking the others would hide the run's URL
// (VAPID_SUBJECT) or every "1" in the log (POSTHOG_DISABLED).
export const MASKED_RUN_SECRETS = ["SESSION_SECRET", "VAPID_PRIVATE_KEY"];
export const READY_TIMEOUT_MS = 3 * 60_000;
export const READY_POLL_MS = 5_000;
// Every hashed file the build will serve from /assets/, and how long a fresh Worker gets to serve
// them all. A brand-new Worker can answer /health while some static assets still 404 (seen on a
// lazily loaded chunk), so the journeys would fail on their first page load for a reason that is
// not the PR's.
export const CLIENT_ASSETS_DIR = join("build", "client", "assets");
export const ASSETS_READY_TIMEOUT_MS = 2 * 60_000;
export const ASSET_FETCH_CONCURRENCY = 8;
export const EXPECTED_ASSET_TYPES = { ".js": /javascript/, ".css": /^text\/css/ };
// Cloudflare's API allows 1,200 requests per 5 minutes per user, shared by every concurrent run.
// A rate-limited request backs off for up to about 4 minutes in all (each delay jittered between
// half and one and a half times its base, and never shorter than the response's Retry-After), so a
// burst of runs spreads out instead of failing.
export const API_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 120_000];
export const MAX_RETRY_AFTER_MS = 5 * 60_000;
// Workers Paid allows 500 scripts per account. Far more run Workers than concurrent runs means
// teardown and the sweep are failing, so fail loudly long before the account limit.
export const MAX_RUN_WORKERS = 100;
// `wrangler deploy` uploads a brand-new script, then enables its workers.dev subdomain. Right
// after the upload Cloudflare can still answer "This Worker does not exist on your account.
// [code: 10007]" (seen on run 37917989293). Deploying again is idempotent (assets already
// uploaded are skipped), so the deploy is retried after these delays.
export const DEPLOY_RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
const SCRIPT_NOT_FOUND_PATTERN = /\[code: 10007\]/;

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const MIGRATION_FILE_PATTERN = /^\d{4}_[A-Za-z0-9_.-]+\.sql$/;
const NO_PENDING_MIGRATIONS_PATTERN = /no migrations to apply/i;

// The workers.dev hostname of the shared QA Worker, minus the Worker's own name.
const WORKERS_DEV_SUFFIX = new URL(QA_BASE_URL).hostname.slice(CANONICAL_WORKER_NAME.length);

export function runIdentity(env) {
  const runId = env.GITHUB_RUN_ID ?? "";
  const attempt = env.GITHUB_RUN_ATTEMPT ?? "";
  if (!/^\d+$/.test(runId) || !/^\d+$/.test(attempt)) {
    throw new Error("GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT must be whole numbers to name this run's QA stack.");
  }
  const suffix = `${runId}-${attempt}`;
  const workerName = `${RUN_WORKER_PREFIX}${suffix}`;
  return {
    workerName,
    databaseName: `${RUN_DATABASE_PREFIX}${suffix}`,
    baseUrl: `https://${workerName}${WORKERS_DEV_SUFFIX}`,
  };
}

export function requireGitHubActions(env) {
  if (env.GITHUB_ACTIONS !== "true") {
    throw new Error("qa-run-scope rewrites wrangler.json in place, so it runs only inside GitHub Actions.");
  }
}

function assertRunNames({ workerName, databaseName }) {
  if (!RUN_WORKER_PATTERN.test(workerName) || !RUN_DATABASE_PATTERN.test(databaseName)) {
    throw new Error(`Refusing to touch ${workerName} / ${databaseName}: not a per-run QA stack name.`);
  }
}

// ---------------------------------------------------------------------------------------------
// Config rewriting

function d1Binding(config, where) {
  const binding = Array.isArray(config?.d1_databases)
    ? config.d1_databases.find((entry) => entry?.binding === "DB")
    : undefined;
  if (!binding) throw new Error(`${where} has no D1 binding named DB.`);
  return binding;
}

function assertCanonicalQa(section, where) {
  const db = d1Binding(section, where);
  if (db.database_id !== QA_D1_DATABASE_ID || db.database_name !== QA_D1_DATABASE_NAME) {
    throw new Error(`${where} does not bind the shared QA database; refusing to rewrite it.`);
  }
  if (section.vars?.SPOONJOY_BASE_URL !== QA_BASE_URL) {
    throw new Error(`${where} does not target ${QA_BASE_URL}; refusing to rewrite it.`);
  }
}

function withRunIdentity(section, identity, databaseId) {
  const next = structuredClone(section);
  next.name = identity.workerName;
  next.vars = { ...next.vars, SPOONJOY_BASE_URL: identity.baseUrl };
  const db = d1Binding(next, "rewritten config");
  db.database_name = identity.databaseName;
  db.database_id = databaseId;
  return next;
}

// The fields a rewrite may change, blanked so the rest can be compared exactly.
function withoutIdentity(section) {
  const copy = structuredClone(section);
  delete copy.name;
  if (copy.vars) delete copy.vars.SPOONJOY_BASE_URL;
  for (const entry of copy.d1_databases ?? []) {
    if (entry?.binding === "DB") {
      delete entry.database_name;
      delete entry.database_id;
    }
  }
  return copy;
}

export function assertOnlyIdentityChanged(before, after) {
  if (JSON.stringify(withoutIdentity(before)) !== JSON.stringify(withoutIdentity(after))) {
    throw new Error("The run-scoped config differs from the shared QA config in more than its identity.");
  }
}

// wrangler.json: only `env.qa` changes. The top level (production) is never touched.
export function scopeWranglerConfig(config, identity, databaseId) {
  const qa = config?.env?.qa;
  if (!qa) throw new Error("wrangler.json has no env.qa.");
  assertCanonicalQa(qa, "wrangler.json env.qa");
  const scopedQa = withRunIdentity(qa, identity, databaseId);
  assertOnlyIdentityChanged(qa, scopedQa);
  return { ...config, env: { ...config.env, qa: scopedQa } };
}

// build/server/wrangler.json: the flattened QA config the Cloudflare Vite plugin generated.
export function scopeGeneratedBuildConfig(config, identity, databaseId) {
  if (config?.name !== CANONICAL_WORKER_NAME) {
    throw new Error(`The generated build config is for ${config?.name}, not ${CANONICAL_WORKER_NAME}. Build with CLOUDFLARE_ENV=qa first.`);
  }
  assertCanonicalQa(config, "build/server/wrangler.json");
  const scoped = withRunIdentity(config, identity, databaseId);
  assertOnlyIdentityChanged(config, scoped);
  return scoped;
}

// ---------------------------------------------------------------------------------------------
// Per-run secrets

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

// VAPID keys in the shape app/lib/env.server.ts reads (scripts/generate-vapid-keys.ts): the public
// key is the uncompressed P-256 point, the private key the raw `d`, both base64url.
export function generateVapidKeys(generate = generateKeyPairSync) {
  const { privateKey } = generate("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  return {
    publicKey: base64Url(Buffer.concat([Buffer.from([4]), x, y])),
    privateKey: jwk.d,
  };
}

// The shared QA Worker's GOOGLE_API_KEY is not copied (secrets cannot be read back), so a run's
// Worker has no image-generation key and skips AI placeholder covers, as the app does whenever
// the key is absent. No journey asserts on a generated cover; the QA Image Cover Smoke workflow
// covers that path against the shared QA Worker.
export function buildRunSecrets(identity, { random = randomBytes, vapid = generateVapidKeys } = {}) {
  const keys = vapid();
  return {
    SESSION_SECRET: random(32).toString("hex"),
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: identity.baseUrl,
    POSTHOG_DISABLED: "1",
  };
}

// ---------------------------------------------------------------------------------------------
// Cloudflare API

class CloudflareApiError extends Error {
  constructor(method, path, status, detail) {
    super(`Cloudflare API ${method} ${path} returned ${status}${detail ? `: ${detail}` : ""}`);
    this.status = status;
  }
}

export function retryDelayMs(attempt, response, random = Math.random) {
  const base = API_RETRY_DELAYS_MS[attempt] * (0.5 + random());
  const header = response?.headers?.get?.("retry-after");
  const seconds = header == null ? Number.NaN : Number(header);
  const retryAfter = Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : 0;
  return Math.round(Math.max(base, retryAfter));
}

export function createCloudflareApi({ env, fetchImpl, sleep, random = Math.random }) {
  const token = env.CLOUDFLARE_API_TOKEN ?? "";
  const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? "";
  if (token === "" || !/^[0-9a-f]{32}$/.test(accountId)) {
    throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required for a per-run QA stack.");
  }

  async function request(method, path, body) {
    const url = `${CLOUDFLARE_API}/accounts/${accountId}${path}`;
    for (let attempt = 0; ; attempt += 1) {
      let response;
      let failure;
      try {
        response = await fetchImpl(url, {
          method,
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      const retryable = failure !== undefined || response.status === 429 || response.status >= 500;
      if (retryable && attempt < API_RETRY_DELAYS_MS.length) {
        await sleep(retryDelayMs(attempt, response, random));
        continue;
      }
      if (failure !== undefined) throw new CloudflareApiError(method, path, "a network error", failure);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        const detail = (payload.errors ?? []).map((item) => item?.message).filter(Boolean).join("; ");
        throw new CloudflareApiError(method, path, response.status, detail);
      }
      return payload;
    }
  }

  async function listAll(path) {
    const items = [];
    for (let page = 1; page <= 20; page += 1) {
      const payload = await request("GET", `${path}?page=${page}&per_page=100`);
      const result = payload.result ?? [];
      items.push(...result);
      const totalPages = payload.result_info?.total_pages;
      if (result.length < 100 || (typeof totalPages === "number" && page >= totalPages)) break;
    }
    return items;
  }

  return {
    // Every database in the account, unfiltered: callers match names exactly themselves, so
    // nothing depends on how the API's own `name` filter matches.
    listDatabases: () => listAll("/d1/database"),
    createDatabase: async (name) => (await request("POST", "/d1/database", { name })).result,
    deleteDatabase: (id) => request("DELETE", `/d1/database/${id}`),
    // The scripts list is not paginated.
    listWorkers: async () => (await request("GET", "/workers/scripts")).result ?? [],
    // force: the run's Worker owns a Durable Object namespace, which is deleted with it.
    deleteWorker: (name) => request("DELETE", `/workers/scripts/${name}?force=true`),
  };
}

function isNotFound(error) {
  return error instanceof CloudflareApiError && error.status === 404;
}

// Deletes run stacks older than STALE_AFTER_MS. Never touches the shared QA Worker or database:
// only names matching the per-run patterns are candidates.
// A 404 means another run's sweep or teardown deleted it first.
async function deleteTolerating404(remove) {
  try {
    await remove();
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function sweepStaleRunStacks({ api, now, log }) {
  const cutoff = now() - STALE_AFTER_MS;
  const isStale = (timestamp) => {
    const at = Date.parse(timestamp ?? "");
    return !Number.isNaN(at) && at < cutoff;
  };
  let swept = 0;
  for (const database of await api.listDatabases()) {
    if (!RUN_DATABASE_PATTERN.test(database.name ?? "") || !isStale(database.created_at)) continue;
    const deleted = await deleteTolerating404(() => api.deleteDatabase(database.uuid));
    log(`${deleted ? "Deleted" : "Already gone:"} stale QA run database ${database.name} (created ${database.created_at}).`);
    swept += 1;
  }
  let remaining = 0;
  for (const worker of await api.listWorkers()) {
    if (!RUN_WORKER_PATTERN.test(worker.id ?? "")) continue;
    if (!isStale(worker.created_on)) {
      remaining += 1;
      continue;
    }
    const deleted = await deleteTolerating404(() => api.deleteWorker(worker.id));
    log(`${deleted ? "Deleted" : "Already gone:"} stale QA run Worker ${worker.id} (created ${worker.created_on}).`);
    swept += 1;
  }
  return { swept, remainingRunWorkers: remaining };
}

export function assertRunWorkerHeadroom(remainingRunWorkers) {
  if (remainingRunWorkers > MAX_RUN_WORKERS) {
    throw new Error(
      `${remainingRunWorkers} QA run Workers exist (limit ${MAX_RUN_WORKERS}; the account allows 500 scripts). ` +
        "Teardown or the sweep is failing; delete the stale spoonjoy-v2-qa-run-* Workers and find out why.",
    );
  }
}

export async function sweep({ api, now, log }) {
  const result = await sweepStaleRunStacks({ api, now, log });
  log(`Swept ${result.swept} stale QA run resource(s); ${result.remainingRunWorkers} run Worker(s) are in use.`);
  assertRunWorkerHeadroom(result.remainingRunWorkers);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Wrangler

export async function runWrangler(exec, args) {
  const { stdout } = await exec("pnpm", ["exec", "wrangler", ...args], { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

function parseJsonResults(stdout) {
  const start = stdout.indexOf("[");
  if (start === -1) throw new Error("wrangler returned no JSON results.");
  return JSON.parse(stdout.slice(start));
}

// ---------------------------------------------------------------------------------------------
// Commands

function readJson(fs, path) {
  return JSON.parse(fs.readFile(path, "utf8"));
}

function writeJson(fs, path, value, mode) {
  fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`, mode === undefined ? { encoding: "utf8" } : { encoding: "utf8", mode });
  if (mode !== undefined) fs.chmod(path, mode);
}

export const defaultFs = {
  readFile: readFileSync,
  writeFile: writeFileSync,
  appendFile: appendFileSync,
  chmod: chmodSync,
  exists: existsSync,
  mkdir: mkdirSync,
  remove: rmSync,
  listDir: readdirSync,
};

// Creates the run's database. A create retried after a 5xx can find that the first try worked,
// so on failure the database is looked up by its exact name and reused if it exists.
async function createRunDatabase(api, name) {
  try {
    return await api.createDatabase(name);
  } catch (error) {
    const existing = (await api.listDatabases()).find((database) => database.name === name);
    if (!existing) throw error;
    return existing;
  }
}

export async function prepare({ env, fs, api, now, log, secrets }) {
  requireGitHubActions(env);
  const identity = runIdentity(env);
  assertRunNames(identity);
  if (!fs.exists(GENERATED_BUILD_CONFIG)) {
    throw new Error(`${GENERATED_BUILD_CONFIG} is missing. Build with CLOUDFLARE_ENV=qa before preparing the run's QA stack.`);
  }
  const wranglerConfig = readJson(fs, WRANGLER_CONFIG);
  const buildConfig = readJson(fs, GENERATED_BUILD_CONFIG);
  // Both checks run before anything is created, so a config that does not name shared QA fails
  // without side effects.
  scopeWranglerConfig(wranglerConfig, identity, "00000000-0000-0000-0000-000000000000");
  scopeGeneratedBuildConfig(buildConfig, identity, "00000000-0000-0000-0000-000000000000");
  fs.mkdir(STATE_DIR, { recursive: true });

  let remainingRunWorkers = 0;
  try {
    ({ remainingRunWorkers } = await sweepStaleRunStacks({ api, now, log }));
  } catch (error) {
    log(`::warning::Could not sweep stale QA run stacks: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertRunWorkerHeadroom(remainingRunWorkers);

  // A database left by an earlier try of this same attempt is replaced, never reused.
  for (const database of await api.listDatabases()) {
    if (database.name === identity.databaseName) await deleteTolerating404(() => api.deleteDatabase(database.uuid));
  }
  const created = await createRunDatabase(api, identity.databaseName);
  const databaseId = created?.uuid ?? "";
  if (!/^[0-9a-f-]{36}$/.test(databaseId)) throw new Error("Cloudflare did not return the new database's id.");
  log(`Created QA run database ${identity.databaseName} (${databaseId}).`);

  const state = { ...identity, databaseId };
  writeJson(fs, STATE_FILE, state);
  writeJson(fs, WRANGLER_CONFIG, scopeWranglerConfig(wranglerConfig, identity, databaseId));
  writeJson(fs, GENERATED_BUILD_CONFIG, scopeGeneratedBuildConfig(buildConfig, identity, databaseId));

  const runSecrets = secrets(identity);
  for (const name of MASKED_RUN_SECRETS) log(`::add-mask::${runSecrets[name]}`);
  writeJson(fs, SECRETS_FILE, runSecrets, 0o600);

  if (env.GITHUB_ENV) {
    fs.appendFile(env.GITHUB_ENV, `SPOONJOY_JOURNEYS_BASE_URL=${identity.baseUrl}\nSPOONJOY_QA_RUN_WORKER=${identity.workerName}\n`);
  }
  log(`This run's QA stack: Worker ${identity.workerName} at ${identity.baseUrl}, D1 ${identity.databaseName}.`);
  return state;
}

function outputOf(error) {
  return `${error?.stdout ?? ""}${error?.stderr ?? ""}`;
}

export async function deploy({ env, exec, fs, sleep, log }) {
  requireGitHubActions(env);
  const state = readState(fs);
  assertWranglerIsRunScoped(fs, state);
  const args = ["exec", "wrangler", "deploy", "--env", "qa", "--secrets-file", SECRETS_FILE];
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { stdout, stderr } = await exec("pnpm", args, { maxBuffer: 64 * 1024 * 1024 });
      log(`${stdout}${stderr}`);
      return attempt + 1;
    } catch (error) {
      log(outputOf(error));
      if (!SCRIPT_NOT_FOUND_PATTERN.test(outputOf(error)) || attempt >= DEPLOY_RETRY_DELAYS_MS.length) throw error;
      const delay = DEPLOY_RETRY_DELAYS_MS[attempt];
      log(`::warning::Cloudflare did not yet know ${state.workerName} (code 10007); deploying again in ${delay / 1000} s.`);
      await sleep(delay);
    }
  }
}

function readState(fs) {
  const state = readJson(fs, STATE_FILE);
  assertRunNames(state);
  return state;
}

function assertWranglerIsRunScoped(fs, state) {
  const qa = readJson(fs, WRANGLER_CONFIG).env?.qa;
  const db = d1Binding(qa, "wrangler.json env.qa");
  if (qa.name !== state.workerName || db.database_id !== state.databaseId) {
    throw new Error("wrangler.json env.qa does not name this run's QA stack.");
  }
}

async function waitFor(check, { now, sleep, timeoutMs, describe }) {
  const started = now();
  let last = "not tried";
  for (;;) {
    try {
      const result = await check();
      if (result === true) return;
      last = result;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (now() - started >= timeoutMs) {
      throw new Error(`${describe} within ${Math.round(timeoutMs / 1000)} s: ${last}.`);
    }
    await sleep(READY_POLL_MS);
  }
}

export function builtAssetPaths(fs) {
  const names = fs.exists(CLIENT_ASSETS_DIR) ? fs.listDir(CLIENT_ASSETS_DIR).map(String) : [];
  const paths = names.filter((name) => /^[^/]+\.[A-Za-z0-9]+$/.test(name)).sort().map((name) => `/assets/${name}`);
  if (paths.length === 0) throw new Error(`${CLIENT_ASSETS_DIR} has no built assets; run the QA build before verify.`);
  return paths;
}

async function assetProblem(fetchImpl, url, path) {
  try {
    const response = await fetchImpl(url, { redirect: "manual" });
    if (response.status !== 200) return `${path} returned ${response.status}`;
    const expected = EXPECTED_ASSET_TYPES[/\.[A-Za-z0-9]+$/.exec(path)[0]];
    const type = response.headers?.get?.("content-type") ?? "";
    if (expected && !expected.test(type)) return `${path} was served as ${type || "no content-type"}`;
    return null;
  } catch (error) {
    return `${path} failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// Polls every built asset until each returns 200 with the right content-type, re-checking only the
// ones still missing, and fails with a clear message (not a test failure) after the bound.
export async function waitForBuiltAssets({ fs, fetchImpl, now, sleep, baseUrl, timeoutMs = ASSETS_READY_TIMEOUT_MS }) {
  const all = builtAssetPaths(fs);
  let pending = all;
  const started = now();
  for (;;) {
    const problems = [];
    for (let index = 0; index < pending.length; index += ASSET_FETCH_CONCURRENCY) {
      const batch = pending.slice(index, index + ASSET_FETCH_CONCURRENCY);
      const results = await Promise.all(batch.map((path) => assetProblem(fetchImpl, `${baseUrl}${path}`, path)));
      results.forEach((problem, offset) => {
        if (problem) problems.push({ path: batch[offset], problem });
      });
    }
    if (problems.length === 0) return all.length;
    pending = problems.map(({ path }) => path);
    if (now() - started >= timeoutMs) {
      const shown = problems.slice(0, 5).map(({ problem }) => problem).join("; ");
      throw new Error(
        `${problems.length} of ${all.length} built assets not live on ${baseUrl} after ${Math.round(timeoutMs / 1000)} s: ${shown}${problems.length > 5 ? "; …" : ""}.`,
      );
    }
    await sleep(READY_POLL_MS);
  }
}

// Right after deploy, Cloudflare's API can still say a brand-new script does not exist (seen 1.6 s
// after "Deployed ... triggers" on #403). Every Cloudflare call verify makes retries a not-found
// within the readiness window, then fails as a setup error rather than as a suite failure.
export const CLOUDFLARE_NOT_FOUND_PATTERN = /not found|does not exist|\[code: 10007\]/i;

async function untilCloudflareKnows(task, { now, sleep, deadline, workerName }) {
  for (;;) {
    try {
      return await task();
    } catch (error) {
      const text = `${error instanceof Error ? error.message : String(error)}\n${outputOf(error)}`;
      if (!CLOUDFLARE_NOT_FOUND_PATTERN.test(text)) throw error;
      if (now() >= deadline) {
        const reason = text.split("\n").find((line) => CLOUDFLARE_NOT_FOUND_PATTERN.test(line)).trim();
        throw new Error(
          `Setup error, not a test failure: Cloudflare still did not know ${workerName} ${Math.round(READY_TIMEOUT_MS / 1000)} s after deploy: ${reason}`,
        );
      }
      await sleep(READY_POLL_MS);
    }
  }
}

export async function verify({ env, exec, fs, fetchImpl, now, sleep, log }) {
  requireGitHubActions(env);
  const state = readState(fs);
  assertWranglerIsRunScoped(fs, state);
  const known = { now, sleep, deadline: now() + READY_TIMEOUT_MS, workerName: state.workerName };

  const secretNames = new Set(
    parseJsonResults(await untilCloudflareKnows(
      () => runWrangler(exec, ["secret", "list", "--env", "qa", "--format", "json"]),
      known,
    )).map((row) => row?.name),
  );
  const missing = REQUIRED_RUN_SECRETS.filter((name) => !secretNames.has(name));
  if (missing.length > 0) throw new Error(`The run's Worker is missing secret(s): ${missing.join(", ")}.`);

  const migrations = await untilCloudflareKnows(
    () => runWrangler(exec, ["d1", "migrations", "list", "DB", "--remote", "--env", "qa"]),
    known,
  );
  if (!NO_PENDING_MIGRATIONS_PATTERN.test(migrations)) {
    throw new Error("The run's database still has pending migrations.");
  }

  // A brand-new workers.dev hostname can take a few seconds to serve, and the journeys must not
  // start against a Worker whose hashed assets are not live yet.
  await waitFor(async () => {
    const health = await fetchImpl(`${state.baseUrl}/health`, { redirect: "manual" });
    if (health.status !== 200) return `/health returned ${health.status}`;
    const home = await fetchImpl(`${state.baseUrl}/`, { redirect: "manual" });
    if (home.status !== 200) return `/ returned ${home.status}`;
    const asset = /\/assets\/[A-Za-z0-9_.-]+\.js/.exec(await home.text())?.[0];
    if (!asset) return "/ referenced no hashed script";
    const script = await fetchImpl(`${state.baseUrl}${asset}`, { redirect: "manual" });
    return script.status === 200 ? true : `${asset} returned ${script.status}`;
  }, { now, sleep, timeoutMs: READY_TIMEOUT_MS, describe: `${state.baseUrl} did not become ready` });

  const served = await waitForBuiltAssets({ fs, fetchImpl, now, sleep, baseUrl: state.baseUrl });

  log(`${state.baseUrl} serves this build: secrets set, no pending migrations, /health and all ${served} hashed assets live.`);
  return state;
}

// The run's database id: from the state prepare wrote, or, if prepare failed before writing it,
// by exact name from the full listing.
async function runDatabaseIds(fs, api, identity) {
  if (fs.exists(STATE_FILE)) {
    const state = readState(fs);
    if (state.databaseName === identity.databaseName) return [state.databaseId];
  }
  return (await api.listDatabases()).filter((database) => database.name === identity.databaseName).map((database) => database.uuid);
}

export async function teardown({ env, fs, api, log }) {
  requireGitHubActions(env);
  const identity = runIdentity(env);
  assertRunNames(identity);
  const failures = [];
  const warnings = [];

  try {
    const deleted = await deleteTolerating404(() => api.deleteWorker(identity.workerName));
    if (deleted) log(`Deleted QA run Worker ${identity.workerName}.`);
    else warnings.push(`no Worker named ${identity.workerName} existed`);
  } catch (error) {
    failures.push(error.message);
  }
  try {
    const ids = await runDatabaseIds(fs, api, identity);
    if (ids.length === 0) warnings.push(`no database named ${identity.databaseName} existed`);
    for (const id of ids) {
      if (await deleteTolerating404(() => api.deleteDatabase(id))) {
        log(`Deleted QA run database ${identity.databaseName} (${id}).`);
      } else {
        warnings.push(`database ${identity.databaseName} (${id}) was already deleted`);
      }
    }
  } catch (error) {
    failures.push(error.message);
  }
  fs.remove(STATE_DIR, { recursive: true, force: true });

  if (warnings.length > 0) log(`::warning::Nothing to delete for part of this run's QA stack: ${warnings.join("; ")}.`);
  if (failures.length > 0) {
    log(
      `::warning::Could not fully delete this run's QA stack (${failures.join("; ")}). ` +
        `The scheduled sweep deletes it once it is ${STALE_AFTER_MS / 3_600_000} hours old.`,
    );
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// CLI

export function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const {
    env = process.env,
    exec = promisify(nodeExecFile),
    fs = defaultFs,
    fetchImpl = fetch,
    now = Date.now,
    sleep = defaultSleep,
    log = console.log,
    secrets = buildRunSecrets,
  } = deps;
  const [command] = argv;
  const api = () => deps.api ?? createCloudflareApi({ env, fetchImpl, sleep });
  if (command === "prepare") return prepare({ env, fs, api: api(), now, log, secrets });
  if (command === "deploy") return deploy({ env, exec, fs, sleep, log });
  if (command === "verify") return verify({ env, exec, fs, fetchImpl, now, sleep, log });
  if (command === "teardown") return teardown({ env, fs, api: api(), log });
  if (command === "sweep") return sweep({ api: api(), now, log });
  throw new Error("Usage: qa-run-scope.mjs <prepare|deploy|verify|teardown|sweep>");
}

export function isCliEntry(moduleUrl, argv1 = process.argv[1]) {
  return typeof argv1 === "string" && moduleUrl === pathToFileURL(argv1).href;
}

export function defaultCliErrorHandler(error, io = console) {
  io.error(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

export async function runCliIfEntry({
  moduleUrl = import.meta.url,
  argv1 = process.argv[1],
  runMain = main,
  onError = defaultCliErrorHandler,
} = {}) {
  if (!isCliEntry(moduleUrl, argv1)) return false;
  try {
    await runMain();
  } catch (error) {
    onError(error);
  }
  return true;
}

await runCliIfEntry();
