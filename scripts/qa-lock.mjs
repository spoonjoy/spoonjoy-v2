#!/usr/bin/env node
// An atomic lock on the QA mirror, held in QA's own D1 database, so two Journeys runs can never
// use QA at the same time.
//
// The FIFO queue (scripts/wait-for-qa-turn.mjs) decides whose turn it is, but it reads the
// GitHub Actions API, which can lag by seconds: two runs have both seen "no run ahead" and used
// QA at once. This lock is the final, atomic step. After the queue says it is this run's turn,
// the journeys job acquires the lock before it deploys, and releases it at the end.
//
// - The lock is one row (id = 1) in `QaRunLock`, created with CREATE TABLE IF NOT EXISTS. It
//   exists only in QA's database; this script refuses any target but QA.
// - Acquiring is a single INSERT … ON CONFLICT DO UPDATE that takes the row only when it is free,
//   expired, or already this run's (same run id and attempt, so a retried call is harmless). The
//   row is then read back, and the lock counts as held only if it names this run and attempt.
// - Timestamps come from D1's clock, not the runner's. The lock expires after LOCK_TTL_MINUTES,
//   longer than the journeys job timeout, so a run that crashed without releasing it cannot
//   block QA for ever.
// - While another run holds it, acquiring polls with backoff (5 s doubling to 60 s) and fails
//   after 10 minutes, naming the holder.
// - Releasing deletes the row only if it names this run and attempt, then reads it back to
//   confirm this run no longer holds it. A failed release is reported as a warning, not a
//   failure: the lock then expires on its own.
//
// Usage: node scripts/qa-lock.mjs <acquire|release> --target-env qa
// Environment (set by GitHub Actions): GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT; Cloudflare
// credentials for wrangler.
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

export const LOCK_TTL_MINUTES = 45;
export const DEFAULT_MAX_WAIT_MS = 10 * 60_000;
export const INITIAL_DELAY_MS = 5_000;
export const MAX_DELAY_MS = 60_000;
export const RELEASE_ATTEMPTS = 3;

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export const CREATE_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS "QaRunLock" (' +
  '"id" INTEGER NOT NULL PRIMARY KEY CHECK ("id" = 1), ' +
  '"runId" TEXT NOT NULL, "attempt" INTEGER NOT NULL, ' +
  '"acquiredAt" TEXT NOT NULL, "expiresAt" TEXT NOT NULL);';

export function parseQaLockArgs(argv) {
  const [action] = argv;
  if (action !== "acquire" && action !== "release") {
    throw new Error("Usage: qa-lock.mjs <acquire|release> --target-env qa");
  }
  const targetEnvIndex = argv.indexOf("--target-env");
  const targetEnv = targetEnvIndex === -1 ? undefined : argv[targetEnvIndex + 1];
  if (targetEnv !== "qa") {
    throw new Error("qa-lock refuses non-QA targets; run with `--target-env qa`.");
  }
  return { action, targetEnv };
}

export function lockIdentity(env) {
  const runId = env.GITHUB_RUN_ID ?? "";
  const attempt = env.GITHUB_RUN_ATTEMPT ?? "";
  if (!/^\d+$/.test(runId) || !/^\d+$/.test(attempt)) {
    throw new Error("GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT must be set to whole numbers to take the QA lock.");
  }
  return { runId, attempt: Number(attempt) };
}

// runId and attempt are validated as digits by lockIdentity, so they are safe SQL literals.
export function buildAcquireSql({ runId, attempt }, ttlMinutes = LOCK_TTL_MINUTES) {
  return [
    CREATE_TABLE_SQL,
    'INSERT INTO "QaRunLock" ("id", "runId", "attempt", "acquiredAt", "expiresAt") ' +
      `VALUES (1, '${runId}', ${attempt}, ${NOW_SQL}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${ttlMinutes} minutes')) ` +
      'ON CONFLICT("id") DO UPDATE SET "runId" = excluded."runId", "attempt" = excluded."attempt", ' +
      '"acquiredAt" = excluded."acquiredAt", "expiresAt" = excluded."expiresAt" ' +
      'WHERE "QaRunLock"."expiresAt" < excluded."acquiredAt" ' +
      'OR ("QaRunLock"."runId" = excluded."runId" AND "QaRunLock"."attempt" = excluded."attempt");',
    'SELECT "runId", "attempt", "acquiredAt", "expiresAt" FROM "QaRunLock" WHERE "id" = 1;',
  ].join("\n");
}

export function buildReleaseSql({ runId, attempt }) {
  return [
    CREATE_TABLE_SQL,
    `DELETE FROM "QaRunLock" WHERE "id" = 1 AND "runId" = '${runId}' AND "attempt" = ${attempt};`,
    'SELECT "runId", "attempt", "acquiredAt", "expiresAt" FROM "QaRunLock" WHERE "id" = 1;',
  ].join("\n");
}

// Runs SQL against QA's D1 (never any other database) and returns wrangler's per-statement
// results.
export async function runQaSql(sql, exec) {
  const { stdout } = await exec("pnpm", [
    "exec", "wrangler", "d1", "execute", "DB", "--remote", "--env", "qa", "--json", "--command", sql,
  ]);
  const start = stdout.indexOf("[");
  if (start === -1) throw new Error("wrangler returned no JSON results.");
  const results = JSON.parse(stdout.slice(start));
  if (!Array.isArray(results) || results.some((result) => result?.success === false)) {
    throw new Error("wrangler reported a failed statement.");
  }
  return results;
}

function describeHolder(holder) {
  return holder
    ? `run ${holder.runId} attempt ${holder.attempt} (since ${holder.acquiredAt}, expires ${holder.expiresAt})`
    : "nobody";
}

export async function acquireQaLock({ env, exec, sleep, now, log, maxWaitMs = DEFAULT_MAX_WAIT_MS }) {
  const identity = lockIdentity(env);
  const sql = buildAcquireSql(identity);
  const started = now();
  let delay = INITIAL_DELAY_MS;
  for (;;) {
    let holder = null;
    let failure = null;
    try {
      const results = await runQaSql(sql, exec);
      holder = results.at(-1)?.results?.[0] ?? null;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    if (holder && holder.runId === identity.runId && Number(holder.attempt) === identity.attempt) {
      log(`Took the QA lock for run ${identity.runId} attempt ${identity.attempt} (expires ${holder.expiresAt}).`);
      return holder;
    }

    const waited = now() - started;
    const status = failure ? `could not reach QA's database (${failure})` : `QA is locked by ${describeHolder(holder)}`;
    if (waited >= maxWaitMs) {
      throw new Error(
        `Run ${identity.runId} attempt ${identity.attempt} could not take the QA lock within ${Math.round(waited / 60_000)} min: ${status}.`,
      );
    }
    log(`Waiting for the QA lock: ${status}; retrying in ${Math.round(delay / 1000)} s.`);
    await sleep(delay);
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  }
}

export async function releaseQaLock({ env, exec, sleep, log }) {
  const identity = lockIdentity(env);
  const sql = buildReleaseSql(identity);
  let failure = null;
  for (let attempt = 1; attempt <= RELEASE_ATTEMPTS; attempt += 1) {
    try {
      // Read the row back rather than trusting a change count (local D1 does not report one).
      const results = await runQaSql(sql, exec);
      const holder = results.at(-1)?.results?.[0] ?? null;
      if (holder && holder.runId === identity.runId && Number(holder.attempt) === identity.attempt) {
        throw new Error("the lock row still names this run");
      }
      log(`Run ${identity.runId} attempt ${identity.attempt} no longer holds the QA lock (now held by ${describeHolder(holder)}).`);
      return true;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      if (attempt < RELEASE_ATTEMPTS) await sleep(INITIAL_DELAY_MS);
    }
  }
  log(
    `::warning::Could not release the QA lock for run ${identity.runId} attempt ${identity.attempt} (${failure}). ` +
      `It expires on its own within ${LOCK_TTL_MINUTES} minutes.`,
  );
  return false;
}

const defaultExec = (file, args) => promisify(nodeExecFile)(file, args, { maxBuffer: 10 * 1024 * 1024 });

export async function main(argv = process.argv.slice(2), deps = {}) {
  const {
    env = process.env,
    exec = defaultExec,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    log = console.log,
    maxWaitMs,
  } = deps;
  const { action } = parseQaLockArgs(argv);
  if (action === "acquire") return acquireQaLock({ env, exec, sleep, now, log, maxWaitMs });
  return releaseQaLock({ env, exec, sleep, log });
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
