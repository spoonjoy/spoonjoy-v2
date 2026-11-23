/**
 * Account activity: when each account was last seen and last signed in.
 *
 * `User.lastSeenAt` moves on authenticated use (a current web session or an
 * authenticated API v1 request), at most once an hour per account: an
 * in-isolate memo skips the database inside the hour, and the UPDATE itself only
 * writes when the stored time is an hour old, so concurrent isolates cost at most
 * one row write per hour. `lastSignInAt` and `lastSignInMethod` move on every
 * successful sign-in.
 *
 * The statements are raw SQL so they never bump `updatedAt` (which native sync
 * reads as a change cursor). A failed write never fails the request; it is
 * captured to PostHog instead.
 */

import { captureException, resolvePostHogServerConfig, type PostHogServerEnv } from "~/lib/analytics-server";
import { d1EpochMsSql } from "~/lib/d1-read.server";
import { d1Timestamp } from "~/lib/d1-write.server";
import { getLocalDb } from "~/lib/db.server";

export const LAST_SEEN_INTERVAL_MS = 60 * 60 * 1000;
const MEMO_LIMIT = 10_000;

/** The slice of a D1 binding these writes use. */
interface ActivityD1 {
  prepare(query: string): { bind(...values: unknown[]): { run(): Promise<unknown> } };
}

export interface AccountActivityEnv extends PostHogServerEnv {
  DB?: unknown;
}

export type AccountSignInMethod = "password" | "passkey" | "apple" | "google" | "github" | "oidc";

const LAST_SEEN_SQL = `UPDATE "User" SET "lastSeenAt" = ? WHERE "id" = ? AND ("lastSeenAt" IS NULL OR ${d1EpochMsSql('"lastSeenAt"')} <= ?)`;
const SIGN_IN_SQL = `UPDATE "User" SET "lastSignInAt" = ?, "lastSignInMethod" = ?, "lastSeenAt" = ? WHERE "id" = ?`;

const lastTouched = new Map<string, number>();

/** Forget the in-isolate memo (tests). */
export function _resetLastSeenMemoForTests(): void {
  lastTouched.clear();
}

function remember(userId: string, atMs: number) {
  if (lastTouched.size >= MEMO_LIMIT) lastTouched.clear();
  lastTouched.set(userId, atMs);
}

async function execute(env: AccountActivityEnv | null | undefined, sql: string, values: unknown[]): Promise<void> {
  if (env?.DB) {
    await (env.DB as ActivityD1).prepare(sql).bind(...values).run();
    return;
  }
  const db = await getLocalDb();
  await db.$executeRawUnsafe(sql, ...values);
}

async function writeActivity(
  env: AccountActivityEnv | null | undefined,
  userId: string,
  phase: "last_seen" | "sign_in",
  sql: string,
  values: unknown[],
): Promise<void> {
  try {
    await execute(env, sql, values);
  } catch (error) {
    if (env) {
      await captureException(resolvePostHogServerConfig(env), {
        error,
        distinctId: userId,
        route: "account-activity",
        extras: { phase },
      });
    }
  }
}

/**
 * Records that the account was used now. Returns the write to wait on, or null when this isolate
 * already recorded the account within the hour (so callers schedule nothing). Never rejects.
 */
export function touchLastSeen(
  env: AccountActivityEnv | null | undefined,
  userId: string,
  now: Date = new Date(),
): Promise<void> | null {
  const nowMs = now.getTime();
  const previous = lastTouched.get(userId);
  if (previous !== undefined && nowMs - previous < LAST_SEEN_INTERVAL_MS) return null;
  remember(userId, nowMs);
  return writeActivity(env, userId, "last_seen", LAST_SEEN_SQL, [d1Timestamp(now), userId, nowMs - LAST_SEEN_INTERVAL_MS]);
}

/** Records a successful sign-in (time and method), which also counts as being seen. Never throws. */
export async function recordAccountSignIn(
  env: AccountActivityEnv | null | undefined,
  userId: string,
  method: AccountSignInMethod,
  now: Date = new Date(),
): Promise<void> {
  remember(userId, now.getTime());
  const at = d1Timestamp(now);
  await writeActivity(env, userId, "sign_in", SIGN_IN_SQL, [at, method, at, userId]);
}
