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
//   - its own jobs queue, `spoonjoy-jobs-qa-run-<run id>-<attempt>`, which its Worker sends to
//     and consumes;
//   - when the run splits its suite into parts (SPOONJOY_QA_RUN_PART, 2 to 9), each part after the
//     first gets a stack of its own, named with `-p<part>` after the attempt; part 1 keeps the
//     plain name;
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
// `env.qa` (Worker name, D1 binding, jobs queue, SPOONJOY_BASE_URL, plus SPOONJOY_QA_ERROR_LOGS=1,
// which only a per-run Worker carries) and the generated build/server/wrangler.json
// to the run's identity, after the QA preflight has checked both against the shared QA identity.
// Every later `--env qa` command (migrations, deploy, seed, rotate, cleanup) then targets the
// run's own stack with no other change. Only identity fields change; anything else differing is
// an error. It refuses to run outside GitHub Actions, so it never rewrites a developer's config
// by accident; SPOONJOY_QA_LOCAL_RUN=1 is the explicit opt-in for a local run (see below).
//
// Commands (node scripts/qa-run-scope.mjs <command>):
//   prepare   sweep stale run stacks, create this run's empty D1 and its jobs queue, rewrite the
//             configs, write the per-run secrets file, export the run's base URL.
//   deploy    deploy this build to the run's Worker with the run's secrets, retrying code 10007
//             or the specific internal authentication server error (code 10500).
//   verify    after deploy: the run's Worker has its secrets, its D1 has no pending migration,
//             and the URL serves /health and every built asset, and the app answers /login
//             several times in a row on new connections. While Cloudflare keeps answering a
//             server error for a built file, it deploys the build again under a fresh Worker name
//             (`-r<n>`) and points the rest of the run at it.
//   teardown  delete this run's jobs queue, Worker and D1 (always; a failure only warns, and a
//             later sweep deletes anything older than STALE_AFTER_MS).
//   sweep     delete run stacks older than STALE_AFTER_MS; run on a schedule as well as by each
//             prepare, and fails when more than MAX_RUN_WORKERS run Workers remain.
//   shared-queue  create shared QA's jobs queue if it is missing; main runs it before deploying
//             shared QA, since a deploy cannot bind a queue that does not exist.
//
// Environment (set by GitHub Actions): GITHUB_ACTIONS, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT,
// GITHUB_ENV, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID; optionally SPOONJOY_QA_RUN_PART, set by
// the Journeys job for each part of its suite.
//
// Local run: prepare, deploy, verify and teardown also run outside GitHub Actions when
// SPOONJOY_QA_LOCAL_RUN=1 (exactly "1"). Use a throwaway worktree, because prepare rewrites
// wrangler.json and the generated build config in place. Set GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT
// to whole numbers of your own (pick a run id no CI run uses, such as 9 followed by nine digits),
// plus CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID; leave GITHUB_ENV unset. For example:
//   SPOONJOY_QA_LOCAL_RUN=1 GITHUB_RUN_ID=9200000001 GITHUB_RUN_ATTEMPT=1 \
//     node scripts/qa-run-scope.mjs prepare
// Always run teardown with the same values when you are done; the scheduled sweep deletes a
// forgotten stack once it is STALE_AFTER_MS old.
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
// `-r<n>`: verify deployed the build again under a fresh name (deployFresh says why).
export const RUN_WORKER_PATTERN = /^spoonjoy-v2-qa-run-\d+-\d+(?:-p[2-9])?(?:-r[2-9])?$/;
export const RUN_DATABASE_PATTERN = /^spoonjoy-qa-run-\d+-\d+(?:-p[2-9])?$/;
// Background jobs (app/domains/platform, the Jobs port) go through a Cloudflare queue bound as
// JOBS. Shared QA has its own; each run gets one too, so a run's Worker only ever takes its own
// run's jobs, which would otherwise land on a Worker running different code against another database.
export const JOBS_BINDING = "JOBS";
export const SHARED_QA_QUEUE = "spoonjoy-jobs-qa";
export const RUN_QUEUE_PREFIX = "spoonjoy-jobs-qa-run-";
export const RUN_QUEUE_PATTERN = /^spoonjoy-jobs-qa-run-\d+-\d+(?:-p[2-9])?$/;
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

// One edge can serve a new workers.dev Worker while another still answers Cloudflare's placeholder
// page, a 404 that says "There is nothing here yet" (Journeys run 45436206706: /login got it after
// this check passed). So verify asks for /login until the app answers it this many times in a row,
// this far apart (about 10 s), each on a new connection ("connection: close"), so the requests can
// reach different machines.
export const APP_ANSWERS_IN_A_ROW = 5;
export const APP_ANSWER_GAP_MS = 2_500;
export const WORKERS_DEV_PLACEHOLDER = "There is nothing here yet";
// React Router writes this into every page it renders; the placeholder has none.
const APP_PAGE_MARKER = "__reactRouterContext";
export const ASSET_FETCH_CONCURRENCY = 8;
// Cloudflare's own static file serving has answered 500 for a few built files of a freshly
// deployed run Worker, a different few each run, for the whole two-minute window, while it served
// the rest (#1031: Journeys runs 45430868319, 45437129781 and 45454463278, 2026-11-24). Those
// files were not ones wrangler skipped as "already uploaded": that count is exactly the build's
// duplicate files (41 identical empty route modules and three other pairs), and one failing file,
// devtools-well-known-BRs2crOX.js, is in wrangler's own list of files it uploaded. Deploying the
// same Worker again would re-send nothing (wrangler skips every file the Worker already has), so
// after this grace window a file still answering a server error makes verify deploy the build
// again under a fresh Worker name, which uploads every file again, at most MAX_ASSET_REDEPLOYS
// times. A 404 or a wrong content-type keeps the full window: a 404 has cleared on its own (#668).
export const ASSET_SERVER_ERROR_GRACE_MS = 45_000;
export const MAX_ASSET_REDEPLOYS = 2;
// How much of a failing answer's body the log keeps, for a report to Cloudflare.
const ASSET_BODY_SNIPPET_CHARS = 200;
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
// uploaded are skipped), so the deploy is retried after these delays. The same bound applies
// to the exact internal authentication server error seen during run 39088149235, not other
// authentication or permission failures, to a lost API connection or an API server error, and to
// the "unknown error" (code 10013) Cloudflare answered while enabling the new script's workers.dev
// subdomain on merge-queue runs 45145294626, 45163811444 and 45176389392, and while attaching it
// to its queue as a consumer on #971's run 45350953066, and while listing the account's queues to
// find the run's queue on #1037's run 45487087615; only those three requests' 10013 is retried,
// since the script is uploaded by then.
export const DEPLOY_RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
const SCRIPT_NOT_FOUND_PATTERN = /\[code: 10007\]/;
const SUBDOMAIN_UNKNOWN_ERROR_PATTERN = /\/workers\/scripts\/[^/\s)]+\/subdomain\) failed\.\s+An unknown error has occurred\.[^\n]*\[code: 10013\]/;
const QUEUE_CONSUMER_UNKNOWN_ERROR_PATTERN = /\/queues\/[^/\s)]+\/consumers\) failed\.\s+An unknown error has occurred\.[^\n]*\[code: 10013\]/;
const QUEUE_LOOKUP_UNKNOWN_ERROR_PATTERN = /\/accounts\/[^/\s)]+\/queues\) failed\.\s+An unknown error has occurred\.[^\n]*\[code: 10013\]/;
const INTERNAL_AUTH_SERVER_ERROR_PATTERN = /Internal authentication error: internal server error\s+\[code: 10500\]/;
// The connection to Cloudflare's API failed before any answer (undici's "fetch failed" and the
// socket errors under it), or the API answered a server error with a page instead of JSON, which
// wrangler reports as "Received a malformed response from the API" with "-> 502 Bad Gateway".
// Neither names a fault in the build or the config.
const API_CONNECTION_FAILURE_PATTERN = /(?:\[ERROR\]|TypeError:) fetch failed\b|\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN|EPIPE|UND_ERR_(?:SOCKET|CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT))\b/;
const API_SERVER_ERROR_PAGE_PATTERN = /Received a malformed response from the API[\s\S]*-> (50[0234])\b/;
// A deploy that ended in 10007, or lost its connection, has usually made the script and applied
// its Durable Object migrations; while Cloudflare's reads lag, the next deploy sends them again
// and is refused, or wrangler itself fails reading the half-made script's migration tag (PR
// Journeys run 45181160164, after a 10007).
const MIGRATION_TAG_LAG_PATTERN = /Actor migration tag precondition failed, got tag '' when expected tag is '[^']+'.*\[code: 10079\]/s;
const MIGRATION_TAG_READ_FAILURE_PATTERN = /\[ERROR\] Cannot read properties of null \(reading 'tag'\)/;

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
  // A Journeys run that splits its suite gives each part its own stack, so the parts run side by
  // side without sharing a database. Part 1 (or no part) keeps the plain name.
  const part = env.SPOONJOY_QA_RUN_PART ?? "1";
  if (!/^[1-9]$/.test(part)) {
    throw new Error("SPOONJOY_QA_RUN_PART must be a single digit from 1 to 9 to name this part's QA stack.");
  }
  const suffix = part === "1" ? `${runId}-${attempt}` : `${runId}-${attempt}-p${part}`;
  const workerName = `${RUN_WORKER_PREFIX}${suffix}`;
  return {
    workerName,
    databaseName: `${RUN_DATABASE_PREFIX}${suffix}`,
    baseUrl: `https://${workerName}${WORKERS_DEV_SUFFIX}`,
    queueName: `${RUN_QUEUE_PREFIX}${suffix}`,
  };
}

// A developer can run the per-run commands on purpose, from a throwaway checkout, by setting
// exactly SPOONJOY_QA_LOCAL_RUN=1. Nothing else changes for a local run: the run still needs a
// numeric GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT (so its stack keeps a per-run name the scheduled
// sweep deletes), the configs must still name shared QA before anything is rewritten, and only
// that run's own Worker and D1 are created or deleted.
export const LOCAL_RUN_FLAG = "SPOONJOY_QA_LOCAL_RUN";

export function requireGitHubActions(env) {
  if (env.GITHUB_ACTIONS !== "true" && env[LOCAL_RUN_FLAG] !== "1") {
    throw new Error(
      `qa-run-scope rewrites wrangler.json in place, so it runs only inside GitHub Actions, or locally from a throwaway checkout with ${LOCAL_RUN_FLAG}=1.`,
    );
  }
}

function assertRunNames({ workerName, databaseName, queueName }) {
  if (!RUN_WORKER_PATTERN.test(workerName) || !RUN_DATABASE_PATTERN.test(databaseName) || !RUN_QUEUE_PATTERN.test(queueName)) {
    throw new Error(`Refusing to touch ${workerName} / ${databaseName} / ${queueName}: not a per-run QA stack name.`);
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

// The JOBS producer and the one consumer that takes from the same queue.
function jobsQueue(config, where) {
  const producer = Array.isArray(config?.queues?.producers)
    ? config.queues.producers.find((entry) => entry?.binding === JOBS_BINDING)
    : undefined;
  const consumers = Array.isArray(config?.queues?.consumers)
    ? config.queues.consumers.filter((entry) => producer && entry?.queue === producer.queue)
    : [];
  if (!producer || consumers.length !== 1) throw new Error(`${where} has no ${JOBS_BINDING} queue with one consumer.`);
  // A dead-letter queue would be shared by every run, and this script names only the one queue each run has.
  if (consumers[0].dead_letter_queue !== undefined) throw new Error(`${where} gives the ${JOBS_BINDING} consumer a dead-letter queue; a run can't have its own.`);
  return { producer, consumer: consumers[0] };
}

function assertCanonicalQa(section, where) {
  if (jobsQueue(section, where).producer.queue !== SHARED_QA_QUEUE) {
    throw new Error(`${where} does not use shared QA's jobs queue ${SHARED_QA_QUEUE}; refusing to rewrite it.`);
  }
  const db = d1Binding(section, where);
  if (db.database_id !== QA_D1_DATABASE_ID || db.database_name !== QA_D1_DATABASE_NAME) {
    throw new Error(`${where} does not bind the shared QA database; refusing to rewrite it.`);
  }
  if (section.vars?.SPOONJOY_BASE_URL !== QA_BASE_URL) {
    throw new Error(`${where} does not target ${QA_BASE_URL}; refusing to rewrite it.`);
  }
}

// The run's own Worker writes each loader or action error as one scrubbed console.error line
// (app/lib/qa-error-logs.server.ts) for the Journeys tail summary. Only this rewrite sets it, so
// shared QA and production never log errors to the console.
export const QA_ERROR_LOGS_VAR = "SPOONJOY_QA_ERROR_LOGS";

function withRunIdentity(section, identity, databaseId) {
  if (section.vars && QA_ERROR_LOGS_VAR in section.vars) {
    throw new Error(`The shared QA config already sets ${QA_ERROR_LOGS_VAR}; only a per-run Worker may set it.`);
  }
  const next = structuredClone(section);
  next.name = identity.workerName;
  next.vars = { ...next.vars, SPOONJOY_BASE_URL: identity.baseUrl, [QA_ERROR_LOGS_VAR]: "1" };
  const db = d1Binding(next, "rewritten config");
  db.database_name = identity.databaseName;
  db.database_id = databaseId;
  const queue = jobsQueue(next, "rewritten config");
  queue.producer.queue = identity.queueName;
  queue.consumer.queue = identity.queueName;
  return next;
}

// The fields a rewrite may change, blanked so the rest can be compared exactly.
function withoutIdentity(section) {
  const copy = structuredClone(section);
  delete copy.name;
  if (copy.vars) {
    delete copy.vars.SPOONJOY_BASE_URL;
    delete copy.vars[QA_ERROR_LOGS_VAR];
  }
  for (const entry of copy.d1_databases ?? []) {
    if (entry?.binding === "DB") {
      delete entry.database_name;
      delete entry.database_id;
    }
  }
  const producer = copy.queues?.producers?.find?.((entry) => entry?.binding === JOBS_BINDING);
  if (producer) {
    for (const entry of copy.queues.consumers ?? []) if (entry?.queue === producer.queue) delete entry.queue;
    delete producer.queue;
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

// A run's Worker gets no image-provider key: QA makes covers from the sample images in QA's photo
// bucket, never a paid generation call (IMAGE_PROVIDER_PRIMARY=sample in wrangler.json's env.qa,
// app/lib/sample-cover-images.server.ts). No journey asserts on a generated cover; the QA Image
// Cover Smoke workflow covers that path against the shared QA Worker.
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
      // The page count, where the API gives one, also covers an API that pages in smaller pages than asked for.
      if (result.length === 0 || (typeof totalPages === "number" ? page >= totalPages : result.length < 100)) break;
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
    listQueues: () => listAll("/queues"),
    createQueue: async (name) => (await request("POST", "/queues", { queue_name: name })).result,
    deleteQueue: (id) => request("DELETE", `/queues/${id}`),
    // A queue has a consumer or two, so the list is not paginated.
    listQueueConsumers: async (queueId) => (await request("GET", `/queues/${queueId}/consumers`)).result ?? [],
    deleteQueueConsumer: (queueId, consumerId) => request("DELETE", `/queues/${queueId}/consumers/${consumerId}`),
  };
}

function isRefusal(error) {
  return error instanceof CloudflareApiError && error.status >= 400 && error.status < 500 && error.status !== 404;
}

function isNotFound(error) {
  return error instanceof CloudflareApiError && error.status === 404;
}

// Cloudflare deletes neither a queue a Worker still binds nor a Worker that still consumes a queue,
// so a run's stack comes down in order: the queue's consumers, then the Worker, then the queue.
async function detachQueueConsumers(api, queueId) {
  let consumers;
  try {
    consumers = await api.listQueueConsumers(queueId);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  for (const consumer of consumers) await deleteTolerating404(() => api.deleteQueueConsumer(queueId, consumer.consumer_id));
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
  // A stale run's queue lets go of its Worker first, and goes once the Worker has.
  const staleQueues = (await api.listQueues()).filter((queue) => RUN_QUEUE_PATTERN.test(queue.queue_name ?? "") && isStale(queue.created_on));
  for (const queue of staleQueues) await detachQueueConsumers(api, queue.queue_id);
  let remaining = 0;
  for (const worker of await api.listWorkers()) {
    if (!RUN_WORKER_PATTERN.test(worker.id ?? "")) continue;
    if (!isStale(worker.created_on)) {
      remaining += 1;
      continue;
    }
    // Cloudflare can refuse one Worker for good (403 while it is still a queue's consumer, seen for
    // three run Workers on 2026-11-23). Skipping it, counted as still in use, keeps that one Worker
    // from stopping every later sweep; any other failure still fails the sweep.
    let deleted;
    try {
      deleted = await deleteTolerating404(() => api.deleteWorker(worker.id));
    } catch (error) {
      if (!isRefusal(error)) throw error;
      log(`::warning::Could not delete stale QA run Worker ${worker.id} (created ${worker.created_on}): ${error.message}`);
      remaining += 1;
      continue;
    }
    log(`${deleted ? "Deleted" : "Already gone:"} stale QA run Worker ${worker.id} (created ${worker.created_on}).`);
    swept += 1;
  }
  for (const queue of staleQueues) {
    const deleted = await deleteTolerating404(() => api.deleteQueue(queue.queue_id));
    log(`${deleted ? "Deleted" : "Already gone:"} stale QA run jobs queue ${queue.queue_name} (created ${queue.created_on}).`);
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

// Creates a queue. Like a database, a create retried after a 5xx can find the first try worked, so
// on failure the queue is looked up by its exact name and reused if it exists.
async function createQueueOnce(api, name) {
  try {
    return await api.createQueue(name);
  } catch (error) {
    const existing = (await api.listQueues()).find((queue) => queue.queue_name === name);
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

  // A queue left by an earlier try of this same attempt may hold that try's jobs: replaced, never reused.
  for (const queue of await api.listQueues()) {
    if (queue.queue_name === identity.queueName) await deleteTolerating404(() => api.deleteQueue(queue.queue_id));
  }
  await createQueueOnce(api, identity.queueName);
  log(`Created QA run jobs queue ${identity.queueName}.`);

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
  let scriptMayExist = false;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { stdout, stderr } = await exec("pnpm", args, { maxBuffer: 64 * 1024 * 1024 });
      log(`${stdout}${stderr}`);
      return attempt + 1;
    } catch (error) {
      const output = outputOf(error);
      log(output);
      const serverErrorPage = API_SERVER_ERROR_PAGE_PATTERN.exec(output);
      const reason = SCRIPT_NOT_FOUND_PATTERN.test(output)
        ? `Cloudflare did not yet know ${state.workerName} (code 10007)`
        : INTERNAL_AUTH_SERVER_ERROR_PATTERN.test(output)
          ? `Cloudflare reported an internal authentication server error (code 10500) while deploying ${state.workerName}`
          : SUBDOMAIN_UNKNOWN_ERROR_PATTERN.test(output)
            ? `Cloudflare answered an unknown error (code 10013) while enabling ${state.workerName}'s workers.dev subdomain`
          : QUEUE_CONSUMER_UNKNOWN_ERROR_PATTERN.test(output)
            ? `Cloudflare answered an unknown error (code 10013) while attaching ${state.workerName} to its queue`
          : QUEUE_LOOKUP_UNKNOWN_ERROR_PATTERN.test(output)
            ? `Cloudflare answered an unknown error (code 10013) while looking up ${state.workerName}'s queue`
          : scriptMayExist && MIGRATION_TAG_LAG_PATTERN.test(output)
            ? `Cloudflare had not yet caught up with ${state.workerName}'s Durable Object migrations (code 10079)`
          : scriptMayExist && MIGRATION_TAG_READ_FAILURE_PATTERN.test(output)
            ? `Wrangler could not read ${state.workerName}'s Durable Object migration tag while Cloudflare catches up`
            : serverErrorPage
              ? `Cloudflare's API answered ${serverErrorPage[1]} while deploying ${state.workerName}`
              : API_CONNECTION_FAILURE_PATTERN.test(output)
                ? `The connection to Cloudflare's API failed while deploying ${state.workerName}`
                : undefined;
      if (SCRIPT_NOT_FOUND_PATTERN.test(output) || SUBDOMAIN_UNKNOWN_ERROR_PATTERN.test(output) || QUEUE_CONSUMER_UNKNOWN_ERROR_PATTERN.test(output) || QUEUE_LOOKUP_UNKNOWN_ERROR_PATTERN.test(output) || serverErrorPage || API_CONNECTION_FAILURE_PATTERN.test(output)) scriptMayExist = true;
      if (!reason || attempt >= DEPLOY_RETRY_DELAYS_MS.length) throw error;
      const delay = DEPLOY_RETRY_DELAYS_MS[attempt];
      log(`::warning::${reason}; deploying again in ${delay / 1000} s.`);
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
  const queue = jobsQueue(qa, "wrangler.json env.qa");
  if (qa.name !== state.workerName || db.database_id !== state.databaseId || queue.producer.queue !== state.queueName) {
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

// What Cloudflare said about a failing answer: its request id, which a report to Cloudflare names,
// and whether its cache served it.
function cfDetail(headers) {
  const ray = headers?.get?.("cf-ray");
  const cache = headers?.get?.("cf-cache-status");
  return [`cf-ray ${ray || "none"}`, cache ? `cf-cache-status ${cache}` : ""].filter(Boolean).join(", ");
}

async function bodySnippet(response) {
  try {
    return (await response.text()).replace(/\s+/g, " ").trim().slice(0, ASSET_BODY_SNIPPET_CHARS);
  } catch {
    return "";
  }
}

// null when the file is live; otherwise what went wrong, the status (if any) and a note for the log.
async function assetProblem(fetchImpl, url, path) {
  try {
    const response = await fetchImpl(url, { redirect: "manual" });
    if (response.status !== 200) {
      const ray = response.headers?.get?.("cf-ray");
      return {
        problem: `${path} returned ${response.status}${ray ? ` (cf-ray ${ray})` : ""}`,
        status: response.status,
        note: `${path} answered ${response.status} (${cfDetail(response.headers)}): ${await bodySnippet(response)}`,
      };
    }
    const expected = EXPECTED_ASSET_TYPES[/\.[A-Za-z0-9]+$/.exec(path)[0]];
    const type = response.headers?.get?.("content-type") ?? "";
    if (expected && !expected.test(type)) return { problem: `${path} was served as ${type || "no content-type"}` };
    return null;
  } catch (error) {
    return { problem: `${path} failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Thrown when built files still answer a server error after the grace window, so verify deploys again. */
export class AssetServerErrors extends Error {}

function listProblems(problems) {
  return `${problems.slice(0, 5).map(({ problem }) => problem).join("; ")}${problems.length > 5 ? "; …" : ""}`;
}

// Polls every built asset until each returns 200 with the right content-type, re-checking only the
// ones still missing, and fails with a clear message (not a test failure) after the bound. Each
// failing file's first answer is logged once, with its cf-ray and the start of its body. With
// serverErrorGraceMs, it throws AssetServerErrors once that much time has passed while any file
// still answers a server error.
export async function waitForBuiltAssets({ fs, fetchImpl, now, sleep, baseUrl, log = () => {}, timeoutMs = ASSETS_READY_TIMEOUT_MS, serverErrorGraceMs }) {
  const all = builtAssetPaths(fs);
  let pending = all;
  const noted = new Set();
  const started = now();
  for (;;) {
    const problems = [];
    for (let index = 0; index < pending.length; index += ASSET_FETCH_CONCURRENCY) {
      const batch = pending.slice(index, index + ASSET_FETCH_CONCURRENCY);
      const results = await Promise.all(batch.map((path) => assetProblem(fetchImpl, `${baseUrl}${path}`, path)));
      results.forEach((result, offset) => {
        if (result) problems.push({ path: batch[offset], ...result });
      });
    }
    if (problems.length === 0) return all.length;
    for (const { path, note } of problems) {
      if (note && !noted.has(path)) {
        noted.add(path);
        log(note);
      }
    }
    pending = problems.map(({ path }) => path);
    const waited = now() - started;
    const serverErrors = problems.filter(({ status }) => status >= 500);
    if (serverErrorGraceMs !== undefined && waited >= serverErrorGraceMs && serverErrors.length > 0) {
      throw new AssetServerErrors(
        `${serverErrors.length} of ${all.length} built assets still answered a server error on ${baseUrl} after ${Math.round(waited / 1000)} s: ${listProblems(serverErrors)}.`,
      );
    }
    if (waited >= timeoutMs) {
      throw new Error(`${problems.length} of ${all.length} built assets not live on ${baseUrl} after ${Math.round(timeoutMs / 1000)} s: ${listProblems(problems)}.`);
    }
    await sleep(READY_POLL_MS);
  }
}

async function appProblem(fetchImpl, url) {
  try {
    const response = await fetchImpl(url, { redirect: "manual", headers: { connection: "close" } });
    const body = await response.text();
    if (response.status !== 200) {
      return `/login returned ${response.status}${body.includes(WORKERS_DEV_PLACEHOLDER) ? ", Cloudflare's workers.dev placeholder" : ""}`;
    }
    return body.includes(APP_PAGE_MARKER) ? null : "/login answered without the app";
  } catch (error) {
    return `/login failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// Asks for /login until the app answers APP_ANSWERS_IN_A_ROW times in a row; any other answer
// starts the count again. Fails as a setup error after the bound.
export async function waitForAppAnswers({ fetchImpl, now, sleep, baseUrl, timeoutMs = READY_TIMEOUT_MS }) {
  const started = now();
  let inARow = 0;
  for (;;) {
    const problem = await appProblem(fetchImpl, `${baseUrl}/login`);
    inARow = problem ? 0 : inARow + 1;
    if (inARow === APP_ANSWERS_IN_A_ROW) return;
    if (problem && now() - started >= timeoutMs) {
      throw new Error(
        `Setup error, not a test failure: ${baseUrl}/login did not answer with the app ${APP_ANSWERS_IN_A_ROW} times in a row within ${Math.round(timeoutMs / 1000)} s: ${problem}.`,
      );
    }
    await sleep(APP_ANSWER_GAP_MS);
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

// Secrets set, no pending migration, and the URL serves /health, / and the hashed script / names.
async function waitForWorker({ exec, fetchImpl, now, sleep, state }) {
  const known = { now, sleep, deadline: now() + READY_TIMEOUT_MS, workerName: state.workerName };

  // Right after deploy, `secret list` can also answer with an empty or partial list for a script
  // Cloudflare already knows (seen on #452: all four secrets "missing" on a run whose deploy
  // uploaded them). Re-read within the readiness window before calling a secret missing.
  for (;;) {
    const secretNames = new Set(
      parseJsonResults(await untilCloudflareKnows(
        () => runWrangler(exec, ["secret", "list", "--env", "qa", "--format", "json"]),
        known,
      )).map((row) => row?.name),
    );
    const missing = REQUIRED_RUN_SECRETS.filter((name) => !secretNames.has(name));
    if (missing.length === 0) break;
    if (now() >= known.deadline) throw new Error(`The run's Worker is missing secret(s): ${missing.join(", ")}.`);
    await sleep(READY_POLL_MS);
  }

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
}

// The run's Worker under the name `-r<n>` gives it: same database and queue, a new URL.
function freshWorker(env, state, ordinal) {
  const workerName = `${runIdentity(env).workerName}-r${ordinal}`;
  return { ...state, workerName, baseUrl: `https://${workerName}${WORKERS_DEV_SUFFIX}` };
}

// Points a scoped config section at another name and URL for the run's Worker; nothing else moves.
function renamedSection(section, fresh) {
  const next = structuredClone(section);
  next.name = fresh.workerName;
  next.vars = { ...next.vars, SPOONJOY_BASE_URL: fresh.baseUrl };
  assertOnlyIdentityChanged(section, next);
  return next;
}

// Deploys this build again as a fresh Worker: the old one first lets go of the run's queue (a
// queue has one consumer) and is deleted, the configs, secrets, state and GITHUB_ENV name the new
// one, and deploy uploads every file again, since the new Worker has none.
async function deployFresh({ env, exec, fs, sleep, log, api, state, ordinal }) {
  const fresh = freshWorker(env, state, ordinal);
  assertRunNames(fresh);
  for (const queue of (await api.listQueues()).filter((entry) => entry.queue_name === state.queueName)) {
    await detachQueueConsumers(api, queue.queue_id);
  }
  try {
    await deleteTolerating404(() => api.deleteWorker(state.workerName));
  } catch (error) {
    log(`::warning::Could not delete ${state.workerName} before deploying again (${error.message}); teardown deletes it.`);
  }

  const wranglerConfig = readJson(fs, WRANGLER_CONFIG);
  writeJson(fs, WRANGLER_CONFIG, { ...wranglerConfig, env: { ...wranglerConfig.env, qa: renamedSection(wranglerConfig.env.qa, fresh) } });
  writeJson(fs, GENERATED_BUILD_CONFIG, renamedSection(readJson(fs, GENERATED_BUILD_CONFIG), fresh));
  writeJson(fs, SECRETS_FILE, { ...readJson(fs, SECRETS_FILE), VAPID_SUBJECT: fresh.baseUrl }, 0o600);
  const next = { ...fresh, retiredWorkers: [...(state.retiredWorkers ?? []), state.workerName] };
  writeJson(fs, STATE_FILE, next);
  if (env.GITHUB_ENV) {
    fs.appendFile(env.GITHUB_ENV, `SPOONJOY_JOURNEYS_BASE_URL=${fresh.baseUrl}\nSPOONJOY_QA_RUN_WORKER=${fresh.workerName}\n`);
  }
  await deploy({ env, exec, fs, sleep, log });
  return next;
}

export async function verify({ env, exec, fs, fetchImpl, now, sleep, log, api }) {
  requireGitHubActions(env);
  let state = readState(fs);
  for (let redeploys = 0; ; redeploys += 1) {
    assertWranglerIsRunScoped(fs, state);
    await waitForWorker({ exec, fetchImpl, now, sleep, state });
    let served;
    try {
      served = await waitForBuiltAssets({
        fs,
        fetchImpl,
        now,
        sleep,
        log,
        baseUrl: state.baseUrl,
        serverErrorGraceMs: redeploys < MAX_ASSET_REDEPLOYS ? ASSET_SERVER_ERROR_GRACE_MS : undefined,
      });
    } catch (error) {
      if (redeploys > 0 && !(error instanceof AssetServerErrors)) {
        throw new Error(`Setup error, not a test failure: built files still not served after ${redeploys} fresh deploys of this build: ${error.message}`);
      }
      if (!(error instanceof AssetServerErrors)) throw error;
      const ordinal = redeploys + 2;
      log(
        `::warning::Cloudflare kept answering a server error for built files of ${state.workerName}: ${error.message} ` +
          `Deploying this build again as ${freshWorker(env, state, ordinal).workerName}, which uploads every file again.`,
      );
      state = await deployFresh({ env, exec, fs, sleep, log, api, state, ordinal });
      continue;
    }
    await waitForAppAnswers({ fetchImpl, now, sleep, baseUrl: state.baseUrl });
    log(
      `${state.baseUrl} serves this build: secrets set, no pending migrations, /health and all ${served} hashed assets live, and /login answered by the app ${APP_ANSWERS_IN_A_ROW} times in a row.`,
    );
    return state;
  }
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

// This run's Worker names: the one the state names, then those verify replaced, each only if it is
// this run's own Worker or a fresh-name deploy of it; with no such state, the plain name.
function runWorkerNames(fs, identity) {
  const ours = (name) => typeof name === "string" && RUN_WORKER_PATTERN.test(name) && (name === identity.workerName || name.startsWith(`${identity.workerName}-r`));
  let state = {};
  try {
    if (fs.exists(STATE_FILE)) state = readJson(fs, STATE_FILE);
  } catch {
    state = {};
  }
  const current = ours(state.workerName) ? state.workerName : identity.workerName;
  const retired = (Array.isArray(state.retiredWorkers) ? state.retiredWorkers : []).filter((name) => ours(name) && name !== current);
  return [current, ...new Set(retired)];
}

export async function teardown({ env, fs, api, log }) {
  requireGitHubActions(env);
  const identity = runIdentity(env);
  assertRunNames(identity);
  const failures = [];
  const warnings = [];

  // The queue lets go of the Worker, the Worker goes, then the queue (detachQueueConsumers says why).
  let queues = [];
  try {
    queues = (await api.listQueues()).filter((queue) => queue.queue_name === identity.queueName);
    if (queues.length === 0) warnings.push(`no jobs queue named ${identity.queueName} existed`);
    for (const queue of queues) await detachQueueConsumers(api, queue.queue_id);
  } catch (error) {
    failures.push(error.message);
  }
  // The Worker verify last deployed, then any it replaced: only names of this run's own Worker.
  const [current, ...retired] = runWorkerNames(fs, identity);
  try {
    const deleted = await deleteTolerating404(() => api.deleteWorker(current));
    if (deleted) log(`Deleted QA run Worker ${current}.`);
    else warnings.push(`no Worker named ${current} existed`);
  } catch (error) {
    failures.push(error.message);
  }
  for (const name of retired) {
    try {
      if (await deleteTolerating404(() => api.deleteWorker(name))) log(`Deleted QA run Worker ${name}.`);
    } catch (error) {
      failures.push(error.message);
    }
  }
  for (const queue of queues) {
    try {
      if (await deleteTolerating404(() => api.deleteQueue(queue.queue_id))) log(`Deleted QA run jobs queue ${identity.queueName}.`);
      else warnings.push(`jobs queue ${identity.queueName} was already deleted`);
    } catch (error) {
      failures.push(error.message);
    }
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

// Shared QA's queue is made once and kept; this only creates it when it is missing.
export async function ensureSharedQueue({ env, api, log }) {
  requireGitHubActions(env);
  if ((await api.listQueues()).some((queue) => queue.queue_name === SHARED_QA_QUEUE)) {
    log(`Shared QA's jobs queue ${SHARED_QA_QUEUE} is already there.`);
    return false;
  }
  await createQueueOnce(api, SHARED_QA_QUEUE);
  log(`Created shared QA's jobs queue ${SHARED_QA_QUEUE}.`);
  return true;
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
  if (command === "verify") return verify({ env, exec, fs, fetchImpl, now, sleep, log, api: api() });
  if (command === "teardown") return teardown({ env, fs, api: api(), log });
  if (command === "sweep") return sweep({ api: api(), now, log });
  if (command === "shared-queue") return ensureSharedQueue({ env, api: api(), log });
  throw new Error("Usage: qa-run-scope.mjs <prepare|deploy|verify|teardown|sweep|shared-queue>");
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
