#!/usr/bin/env node
// Gives each Journeys run its own QA stack, so runs for different pull requests never wait on
// each other.
//
// Before this, QA was single-tenant: every run deployed its build to the one `spoonjoy-v2-qa`
// Worker and seeded the one `spoonjoy-qa` D1, so runs queued for their turn (about 10 minutes
// each; 40 queued runs meant a 7-hour wait). Now each run gets:
//   - its own D1 database, `spoonjoy-qa-run-<run id>-<attempt>`, migrated from this checkout's
//     `migrations/` (so a pull request's own migrations apply only to its own database);
//   - its own Worker, `spoonjoy-v2-qa-run-<run id>-<attempt>`, served at
//     `https://spoonjoy-v2-qa-run-<run id>-<attempt>.mendelow-studio.workers.dev`, with its own
//     cook-session Durable Object namespace and per-run secrets;
//   - the shared QA R2 bucket and rate-limit namespaces. Every R2 key a run writes is under an id
//     that run created, and cleanup deletes only keys its own database references.
//
// Cloudflare does not generate version preview URLs for a Worker that implements a Durable
// Object, so a per-run Worker is the way to give each run its own URL.
//
// If this checkout has migrations the shared QA database has not applied yet, the run's database
// starts as a copy of the shared QA database (`wrangler d1 export`), and the new migrations then
// apply on top. A pull request that changes the schema is still tested against real accumulated
// QA data, without changing the shared database for anyone else.
//
// How the rest of the workflow follows: `prepare` rewrites this CI checkout's wrangler.json
// `env.qa` (Worker name, D1 binding, SPOONJOY_BASE_URL) and the generated build/server/wrangler.json
// to the run's identity, after the QA preflight has checked both against the shared QA identity.
// Every later `--env qa` command (migrations, deploy, seed, rotate, cleanup) then targets the
// run's own stack with no other change. Only identity fields change; anything else differing is
// an error. It refuses to run outside GitHub Actions, so it never rewrites a developer's config.
//
// Commands (node scripts/qa-run-scope.mjs <command>):
//   prepare   sweep stale run stacks, create this run's D1 (cloned from shared QA when needed),
//             rewrite the configs, write the per-run secrets file, export the run's base URL.
//   verify    after deploy: the run's Worker has its secrets, its D1 has no pending migration,
//             and the URL serves /health and a hashed asset.
//   teardown  delete this run's Worker and D1 (always; a failure only warns, and a later run's
//             sweep deletes anything older than STALE_AFTER_MS).
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
  readFileSync,
  readdirSync,
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
export const CANONICAL_DUMP_FILE = join(STATE_DIR, "canonical-qa.sql");
export const WRANGLER_CONFIG = "wrangler.json";
export const GENERATED_BUILD_CONFIG = join("build", "server", "wrangler.json");
export const MIGRATIONS_DIR = "migrations";
export const REQUIRED_RUN_SECRETS = ["SESSION_SECRET", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];
export const READY_TIMEOUT_MS = 3 * 60_000;
export const READY_POLL_MS = 5_000;
export const API_RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

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

export function createCloudflareApi({ env, fetchImpl, sleep }) {
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
        await sleep(API_RETRY_DELAYS_MS[attempt]);
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
      // Every listed path already carries a query (`?name=`).
      const payload = await request("GET", `${path}&page=${page}&per_page=100`);
      const result = payload.result ?? [];
      items.push(...result);
      const totalPages = payload.result_info?.total_pages;
      if (result.length < 100 || (typeof totalPages === "number" && page >= totalPages)) break;
    }
    return items;
  }

  return {
    listDatabases: () => listAll(`/d1/database?name=${encodeURIComponent(RUN_DATABASE_PREFIX)}`),
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
export async function sweepStaleRunStacks({ api, now, log }) {
  const cutoff = now() - STALE_AFTER_MS;
  const isStale = (timestamp) => {
    const at = Date.parse(timestamp ?? "");
    return !Number.isNaN(at) && at < cutoff;
  };
  let swept = 0;
  for (const database of await api.listDatabases()) {
    if (!RUN_DATABASE_PATTERN.test(database.name ?? "") || !isStale(database.created_at)) continue;
    await api.deleteDatabase(database.uuid);
    log(`Deleted stale QA run database ${database.name} (created ${database.created_at}).`);
    swept += 1;
  }
  for (const worker of await api.listWorkers()) {
    if (!RUN_WORKER_PATTERN.test(worker.id ?? "") || !isStale(worker.created_on)) continue;
    await api.deleteWorker(worker.id);
    log(`Deleted stale QA run Worker ${worker.id} (created ${worker.created_on}).`);
    swept += 1;
  }
  return swept;
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

export function localMigrationNames(readDir) {
  return readDir(MIGRATIONS_DIR).filter((name) => MIGRATION_FILE_PATTERN.test(name)).sort();
}

// The migrations in this checkout that the shared QA database has not applied yet. Runs while
// wrangler.json still names the shared QA database (checked by the caller).
export async function pendingSharedQaMigrations({ exec, readDir }) {
  const stdout = await runWrangler(exec, [
    "d1", "execute", "DB", "--remote", "--env", "qa", "--json",
    "--command", "SELECT name FROM d1_migrations ORDER BY id;",
  ]);
  const applied = new Set((parseJsonResults(stdout)[0]?.results ?? []).map((row) => row.name));
  return localMigrationNames(readDir).filter((name) => !applied.has(name));
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
  readDir: readdirSync,
};

export async function prepare({ env, exec, fs, api, now, log, secrets }) {
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

  try {
    await sweepStaleRunStacks({ api, now, log });
  } catch (error) {
    log(`::warning::Could not sweep stale QA run stacks: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Read from the shared QA database while wrangler.json still names it.
  const pending = await pendingSharedQaMigrations({ exec, readDir: fs.readDir });
  if (pending.length > 0) {
    log(`This checkout has ${pending.length} migration(s) shared QA has not applied (${pending.join(", ")}); the run's database starts as a copy of shared QA.`);
    await runWrangler(exec, ["d1", "export", "DB", "--remote", "--env", "qa", "--output", CANONICAL_DUMP_FILE]);
  }

  // A database left by an earlier try of this same attempt is replaced, never reused.
  for (const database of await api.listDatabases()) {
    if (database.name === identity.databaseName) await api.deleteDatabase(database.uuid);
  }
  const created = await api.createDatabase(identity.databaseName);
  const databaseId = created?.uuid ?? "";
  if (!/^[0-9a-f-]{36}$/.test(databaseId)) throw new Error("Cloudflare did not return the new database's id.");
  log(`Created QA run database ${identity.databaseName} (${databaseId}).`);

  const state = { ...identity, databaseId, clonedFromSharedQa: pending.length > 0, pendingMigrations: pending };
  writeJson(fs, STATE_FILE, state);
  writeJson(fs, WRANGLER_CONFIG, scopeWranglerConfig(wranglerConfig, identity, databaseId));
  writeJson(fs, GENERATED_BUILD_CONFIG, scopeGeneratedBuildConfig(buildConfig, identity, databaseId));

  if (pending.length > 0) {
    // wrangler.json now names the run's database, so this import can only land there.
    await runWrangler(exec, ["d1", "execute", "DB", "--remote", "--env", "qa", "--yes", "--file", CANONICAL_DUMP_FILE]);
    fs.writeFile(CANONICAL_DUMP_FILE, "", { encoding: "utf8" });
  }

  const runSecrets = secrets(identity);
  for (const value of Object.values(runSecrets)) log(`::add-mask::${value}`);
  writeJson(fs, SECRETS_FILE, runSecrets, 0o600);

  if (env.GITHUB_ENV) {
    fs.appendFile(env.GITHUB_ENV, `SPOONJOY_JOURNEYS_BASE_URL=${identity.baseUrl}\nSPOONJOY_QA_RUN_WORKER=${identity.workerName}\n`);
  }
  log(`This run's QA stack: Worker ${identity.workerName} at ${identity.baseUrl}, D1 ${identity.databaseName}.`);
  return state;
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

export async function verify({ env, exec, fs, fetchImpl, now, sleep, log }) {
  requireGitHubActions(env);
  const state = readState(fs);
  assertWranglerIsRunScoped(fs, state);

  const secretNames = new Set(
    parseJsonResults(await runWrangler(exec, ["secret", "list", "--env", "qa", "--format", "json"])).map((row) => row?.name),
  );
  const missing = REQUIRED_RUN_SECRETS.filter((name) => !secretNames.has(name));
  if (missing.length > 0) throw new Error(`The run's Worker is missing secret(s): ${missing.join(", ")}.`);

  const migrations = await runWrangler(exec, ["d1", "migrations", "list", "DB", "--remote", "--env", "qa"]);
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

  log(`${state.baseUrl} serves this build: secrets set, no pending migrations, /health and hashed assets live.`);
  return state;
}

export async function teardown({ env, fs, api, log }) {
  requireGitHubActions(env);
  const identity = runIdentity(env);
  assertRunNames(identity);
  const failures = [];

  try {
    await api.deleteWorker(identity.workerName);
    log(`Deleted QA run Worker ${identity.workerName}.`);
  } catch (error) {
    if (!isNotFound(error)) failures.push(error.message);
  }
  try {
    const matches = (await api.listDatabases()).filter((database) => database.name === identity.databaseName);
    for (const database of matches) {
      await api.deleteDatabase(database.uuid);
      log(`Deleted QA run database ${identity.databaseName}.`);
    }
  } catch (error) {
    failures.push(error.message);
  }
  fs.remove(STATE_DIR, { recursive: true, force: true });

  if (failures.length > 0) {
    log(
      `::warning::Could not fully delete this run's QA stack (${failures.join("; ")}). ` +
        `A later run deletes it once it is ${STALE_AFTER_MS / 3_600_000} hours old.`,
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
  if (command === "prepare") return prepare({ env, exec, fs, api: api(), now, log, secrets });
  if (command === "verify") return verify({ env, exec, fs, fetchImpl, now, sleep, log });
  if (command === "teardown") return teardown({ env, fs, api: api(), log });
  throw new Error("Usage: qa-run-scope.mjs <prepare|verify|teardown>");
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
