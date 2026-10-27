import type { PrismaClient } from "@prisma/client";
import { d1EpochMsSql, type D1Query, type D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";
import { retryD1Write } from "~/lib/d1-write-retry.server";
import {
  captureException,
  type PostHogServerConfig,
} from "~/lib/analytics-server";

export const PLACEHOLDER_DAILY_CAP = 30;
export const STYLIZATION_DAILY_CAP = 50;
export const IMPORT_DAILY_CAP = 50;
/** A photo import is one vision-model read, dearer than a text one, so it has its own lower cap. */
export const PHOTO_IMPORT_DAILY_CAP = 10;

export type ImageGenKind = "placeholder" | "stylization" | "import" | "import-photo";

/**
 * Default ceiling on AI generations per UTC day across every user and kind. The
 * per-user caps above bound one account; this bounds the bill when many accounts
 * (for example scripted signups) spend their caps at once. Override it with
 * SPOONJOY_AI_DAILY_GENERATION_BUDGET.
 */
export const GLOBAL_DAILY_GENERATION_BUDGET = 200;

/** Operator controls read from the Worker environment. */
export interface ImageGenBudgetEnv {
  /** Kill switch: "off" stops every AI generation as if the quota were spent. */
  SPOONJOY_AI_IMAGE_GENERATION?: string;
  /** Global per-UTC-day generation ceiling across all users and kinds. */
  SPOONJOY_AI_DAILY_GENERATION_BUDGET?: string;
}

/** True when the operator kill switch has turned AI generation off. */
export function aiGenerationDisabled(env: ImageGenBudgetEnv | null | undefined): boolean {
  return env?.SPOONJOY_AI_IMAGE_GENERATION?.trim().toLowerCase() === "off";
}

/** The global daily budget: the env override when it is a non-negative integer, else the default. */
export function globalDailyGenerationBudget(env: ImageGenBudgetEnv | null | undefined): number {
  const raw = env?.SPOONJOY_AI_DAILY_GENERATION_BUDGET?.trim();
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  return GLOBAL_DAILY_GENERATION_BUDGET;
}

export interface ConsumeQuotaDeps {
  now?: () => Date;
  /**
   * Optional PostHog config. When the create in the consume race throws
   * something OTHER than the expected unique-conflict (P2002, a parallel
   * first-consume) or FK-violation (P2003, the user row is gone), the throw is
   * a real D1 fault. It is captured (when set + enabled) before rethrow so the
   * fault is observable instead of being silently reported as "quota
   * exhausted". Capture is fire-and-forget — {@link captureException} swallows
   * its own errors and never changes the consume outcome.
   */
  postHogConfig?: PostHogServerConfig;
  /** fetch used for the analytics post; separate so app fetch can be mocked apart. */
  analyticsFetchImpl?: typeof fetch;
  /** The request's D1 binding: the consume is then one atomic D1 batch instead of Prisma. */
  d1?: D1ReadDatabase | null;
  /** Kill switch and global daily budget. */
  env?: ImageGenBudgetEnv | null;
  /**
   * The generation costs nothing: QA's sample images (app/lib/sample-cover-images.server.ts).
   * The global daily budget only bounds the provider bill, so a free consume neither spends it nor
   * is stopped by it; otherwise test traffic using up the shared budget would fail QA's covers for
   * no saving. The user's own cap and the kill switch still apply, so QA shows the same per-user
   * limits as production.
   */
  free?: boolean;
}

/** Read a Prisma known-request-error code off an unknown throw, if present. */
function prismaErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * The two Prisma error codes the consume race expects on the `create`:
 *   - P2002: unique conflict — a parallel caller created the row first.
 *   - P2003: FK violation — the `userId` no longer references a user.
 * Anything else is an unexpected D1 fault and must not be masked as
 * "quota exhausted".
 */
function isExpectedConsumeRaceError(error: unknown): boolean {
  const code = prismaErrorCode(error);
  return code === "P2002" || code === "P2003";
}

export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function capFor(kind: ImageGenKind): number {
  switch (kind) {
    case "placeholder":
      return PLACEHOLDER_DAILY_CAP;
    case "stylization":
      return STYLIZATION_DAILY_CAP;
    case "import":
      return IMPORT_DAILY_CAP;
    case "import-photo":
      return PHOTO_IMPORT_DAILY_CAP;
  }
}

/**
 * A DateTime as Prisma's D1 adapter stores it: ISO 8601 text with a `+00:00` offset. The
 * ledger's unique key compares `bucketStart` as stored, so the D1 path writes the day the way
 * Prisma did on D1. It also matches the other forms a DateTime can take in SQLite (`Z` text,
 * and the integer milliseconds Prisma's own SQLite engine writes), so a day row written any
 * of those ways is counted, never duplicated.
 */
function prismaD1Timestamp(date: Date): string {
  return date.toISOString().replace(/Z$/, "+00:00");
}

/**
 * Where a consume records that it spent its unit: a row in the idempotency key table under this
 * client key, keyed by the consume's id, written in the same batch as the spend and only when the
 * spend happened. Rows older than a day are dropped by the next consume of the same chef.
 */
const CONSUME_MARKER_CLIENT_KEY = "image-gen-consume";
const CONSUME_MARKER_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The first two statements of either consume batch: drop the chef's day-old markers, and create
 * the day's ledger row at zero if it is missing (and the user still exists).
 */
function consumeOpeningStatements(userId: string, kind: ImageGenKind, bucketStart: Date, at: Date): D1Query[] {
  const day = prismaD1Timestamp(bucketStart);
  return [
    [
      `DELETE FROM "ApiIdempotencyKey"
       WHERE "userId" = ? AND "clientKey" = '${CONSUME_MARKER_CLIENT_KEY}' AND ${d1EpochMsSql('"expiresAt"')} <= ?`,
      userId,
      at.getTime(),
    ],
    [
      `INSERT INTO "ImageGenLedger" ("id", "userId", "kind", "bucketStart", "count", "updatedAt")
       SELECT ?, ?, ?, ?, 0, ?
       WHERE EXISTS (SELECT 1 FROM "User" WHERE "id" = ?)
         AND NOT EXISTS (SELECT 1 FROM "ImageGenLedger" WHERE "userId" = ? AND "kind" = ? AND "bucketStart" IN (?, ?, ?))
       ON CONFLICT ("userId", "kind", "bucketStart") DO NOTHING`,
      crypto.randomUUID(),
      userId,
      kind,
      day,
      prismaD1Timestamp(at),
      userId,
      userId,
      kind,
      day,
      bucketStart.toISOString(),
      bucketStart.getTime(),
    ],
  ];
}

/**
 * The consume as one D1 batch: create the day's row at zero if it is missing (and the user
 * still exists), then add one only while the count is under the cap. D1 runs a batch as one
 * transaction and runs batches one at a time, so concurrent consumes cannot pass the cap and
 * exactly the calls that fit under it succeed.
 *
 * A consume spends at most one unit however often it runs: its id is chosen before the first
 * try, the batch writes a marker row with that id when it spends, and both increments are skipped
 * once the marker exists. So after a transient D1 error the batch runs again, and its answer (is
 * there a marker) is the same whether the spend landed on the first try, late, or on this one.
 */
async function tryConsumeImageGenQuotaOnD1(
  d1: D1ReadDatabase,
  userId: string,
  kind: ImageGenKind,
  bucketStart: Date,
  cap: number,
  globalCap: number,
  at: Date,
): Promise<boolean> {
  const day = prismaD1Timestamp(bucketStart);
  const dayForms = [day, bucketStart.toISOString(), bucketStart.getTime()];
  const sameDay = `"userId" = ? AND "kind" = ? AND "bucketStart" IN (?, ?, ?)`;
  const budgetDay = `"bucketStart" IN (?, ?, ?)`;
  const updatedAt = prismaD1Timestamp(at);
  // Marks this consume's global-budget increment so the per-user increment can see whether
  // it happened, inside the same transaction, and names the marker that says it spent.
  const consumeId = crypto.randomUUID();
  const marker = `"userId" = ? AND "clientKey" = '${CONSUME_MARKER_CLIENT_KEY}' AND "key" = ?`;
  const notSpentYet = `NOT EXISTS (SELECT 1 FROM "ApiIdempotencyKey" WHERE ${marker})`;
  const results = await retryD1Write({ scope: "image_gen.consume" }, () => d1WriteBatch(d1, [
    ...consumeOpeningStatements(userId, kind, bucketStart, at),
    [
      `INSERT INTO "ImageGenDailyBudget" ("bucketStart", "count", "updatedAt")
       SELECT ?, 0, ?
       WHERE NOT EXISTS (SELECT 1 FROM "ImageGenDailyBudget" WHERE ${budgetDay})
       ON CONFLICT ("bucketStart") DO NOTHING`,
      day,
      updatedAt,
      ...dayForms,
    ],
    [
      // Spend one unit of the global day only while it is under budget AND this user still
      // has room under their own cap.
      `UPDATE "ImageGenDailyBudget" SET "count" = "count" + 1, "lastConsumeId" = ?, "updatedAt" = ?
       WHERE "bucketStart" = (SELECT "bucketStart" FROM "ImageGenDailyBudget" WHERE ${budgetDay} AND "count" < ? LIMIT 1)
         AND EXISTS (SELECT 1 FROM "ImageGenLedger" WHERE ${sameDay} AND "count" < ?)
         AND ${notSpentYet}`,
      consumeId,
      updatedAt,
      ...dayForms,
      globalCap,
      userId,
      kind,
      ...dayForms,
      cap,
      userId,
      consumeId,
    ],
    [
      // One row only: a day stored in two forms by older writers must spend one unit, not two.
      // It runs only when the global increment above was this consume's.
      `UPDATE "ImageGenLedger" SET "count" = "count" + 1, "updatedAt" = ?
       WHERE "id" = (SELECT "id" FROM "ImageGenLedger" WHERE ${sameDay} AND "count" < ? LIMIT 1)
         AND EXISTS (SELECT 1 FROM "ImageGenDailyBudget" WHERE ${budgetDay} AND "lastConsumeId" = ?)
         AND ${notSpentYet}`,
      updatedAt,
      userId,
      kind,
      ...dayForms,
      cap,
      ...dayForms,
      consumeId,
      userId,
      consumeId,
    ],
    [
      // The marker, only when this run spent (the global increment carries its id) and no
      // earlier run of this consume already left one.
      `INSERT INTO "ApiIdempotencyKey"
         ("id", "userId", "credentialId", "clientKey", "key", "operation", "requestHash", "responseStatus", "expiresAt", "createdAt", "updatedAt")
       SELECT ?, ?, NULL, '${CONSUME_MARKER_CLIENT_KEY}', ?, ?, ?, 200, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM "ImageGenDailyBudget" WHERE ${budgetDay} AND "lastConsumeId" = ?)
       ON CONFLICT DO NOTHING`,
      consumeId,
      userId,
      consumeId,
      `image_gen.consume.${kind}`,
      kind,
      d1Timestamp(new Date(at.getTime() + CONSUME_MARKER_TTL_MS)),
      d1Timestamp(at),
      d1Timestamp(at),
      ...dayForms,
      consumeId,
    ],
    [`SELECT 1 AS "spent" FROM "ApiIdempotencyKey" WHERE ${marker}`, userId, consumeId],
  ]));
  return results[results.length - 1]!.rows.length > 0;
}

/**
 * {@link tryConsumeImageGenQuotaOnD1} for a free consume: the user's cap only. With no global row
 * to carry the consume's id, the marker does it: written as pending (status 0) only while the user
 * has room and no earlier run of this consume spent, the increment runs only under a pending
 * marker, and the marker is then settled (200). The batch is one transaction, so a pending marker
 * never outlives it and a retry spends nothing more.
 */
async function tryConsumeFreeImageGenQuotaOnD1(
  d1: D1ReadDatabase,
  userId: string,
  kind: ImageGenKind,
  bucketStart: Date,
  cap: number,
  at: Date,
): Promise<boolean> {
  const day = prismaD1Timestamp(bucketStart);
  const dayForms = [day, bucketStart.toISOString(), bucketStart.getTime()];
  const sameDay = `"userId" = ? AND "kind" = ? AND "bucketStart" IN (?, ?, ?)`;
  const updatedAt = prismaD1Timestamp(at);
  const consumeId = crypto.randomUUID();
  const marker = `"userId" = ? AND "clientKey" = '${CONSUME_MARKER_CLIENT_KEY}' AND "key" = ?`;
  const results = await retryD1Write({ scope: "image_gen.consume" }, () => d1WriteBatch(d1, [
    ...consumeOpeningStatements(userId, kind, bucketStart, at),
    [
      `INSERT INTO "ApiIdempotencyKey"
         ("id", "userId", "credentialId", "clientKey", "key", "operation", "requestHash", "responseStatus", "expiresAt", "createdAt", "updatedAt")
       SELECT ?, ?, NULL, '${CONSUME_MARKER_CLIENT_KEY}', ?, ?, ?, 0, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM "ImageGenLedger" WHERE ${sameDay} AND "count" < ?)
         AND NOT EXISTS (SELECT 1 FROM "ApiIdempotencyKey" WHERE ${marker})
       ON CONFLICT DO NOTHING`,
      consumeId,
      userId,
      consumeId,
      `image_gen.consume.${kind}`,
      kind,
      d1Timestamp(new Date(at.getTime() + CONSUME_MARKER_TTL_MS)),
      d1Timestamp(at),
      d1Timestamp(at),
      userId,
      kind,
      ...dayForms,
      cap,
      userId,
      consumeId,
    ],
    [
      // One row only, as in the paid batch.
      `UPDATE "ImageGenLedger" SET "count" = "count" + 1, "updatedAt" = ?
       WHERE "id" = (SELECT "id" FROM "ImageGenLedger" WHERE ${sameDay} AND "count" < ? LIMIT 1)
         AND EXISTS (SELECT 1 FROM "ApiIdempotencyKey" WHERE ${marker} AND "responseStatus" = 0)`,
      updatedAt,
      userId,
      kind,
      ...dayForms,
      cap,
      userId,
      consumeId,
    ],
    [
      `UPDATE "ApiIdempotencyKey" SET "responseStatus" = 200 WHERE ${marker} AND "responseStatus" = 0`,
      userId,
      consumeId,
    ],
    [`SELECT 1 AS "spent" FROM "ApiIdempotencyKey" WHERE ${marker}`, userId, consumeId],
  ]));
  return results[results.length - 1]!.rows.length > 0;
}

/**
 * Atomically reserve one unit of the daily image-gen budget for `(userId, kind, today)`.
 * Returns true when the budget was incremented, false when the per-user cap or the global
 * daily budget is reached, the operator kill switch is off, or the user no longer exists. A
 * `free` consume skips the global budget (see {@link ConsumeQuotaDeps.free}). Safe to call
 * concurrently — when two callers race on the very first consume of the day, both will succeed
 * and the ledger ends at count=2. With a D1
 * binding it is one atomic batch; Prisma's version runs as separate queries on D1.
 */
export async function tryConsumeImageGenQuota(
  db: PrismaClient,
  userId: string,
  kind: ImageGenKind,
  deps: ConsumeQuotaDeps = {},
): Promise<boolean> {
  const now = deps.now ?? (() => new Date());
  const at = now();
  const bucketStart = startOfUtcDay(at);
  const cap = capFor(kind);
  // Kill switch: no ledger write and no generation; callers take their quota-exhausted path.
  if (aiGenerationDisabled(deps.env)) return false;
  const globalCap = globalDailyGenerationBudget(deps.env);

  if (deps.d1) {
    try {
      return deps.free
        ? await tryConsumeFreeImageGenQuotaOnD1(deps.d1, userId, kind, bucketStart, cap, at)
        : await tryConsumeImageGenQuotaOnD1(deps.d1, userId, kind, bucketStart, cap, globalCap, at);
    } catch (error) {
      // A D1 fault must not read as "quota exhausted": capture it, then rethrow.
      if (deps.postHogConfig) {
        await captureException(
          deps.postHogConfig,
          { error, distinctId: userId, extras: { feature: "image_gen_quota", kind, phase: "ledgerBatch" } },
          deps.analyticsFetchImpl,
        );
      }
      throw error;
    }
  }

  // Prisma (no D1 binding: unit tests and local scripts). Spend the global unit first and
  // refund it if the per-user consume fails. This is not one transaction; production always
  // takes the atomic D1 batch above.
  if (deps.free) return tryConsumeUserQuotaWithPrisma(db, userId, kind, bucketStart, cap, deps);
  if (!(await spendGlobalBudgetWithPrisma(db, bucketStart, globalCap))) return false;
  let consumedForUser = false;
  try {
    consumedForUser = await tryConsumeUserQuotaWithPrisma(db, userId, kind, bucketStart, cap, deps);
  } finally {
    if (!consumedForUser) {
      await db.imageGenDailyBudget.updateMany({
        where: { bucketStart, count: { gt: 0 } },
        data: { count: { decrement: 1 } },
      });
    }
  }
  return consumedForUser;
}

/** Prisma path: one unit of the global day, created at 1 on the day's first consume. */
async function spendGlobalBudgetWithPrisma(db: PrismaClient, bucketStart: Date, globalCap: number): Promise<boolean> {
  const spend = () => db.imageGenDailyBudget.updateMany({
    where: { bucketStart, count: { lt: globalCap } },
    data: { count: { increment: 1 } },
  });
  if ((await spend()).count > 0) return true;
  if (globalCap < 1) return false;
  try {
    await db.imageGenDailyBudget.create({ data: { bucketStart, count: 1 } });
    return true;
  } catch (error) {
    if (prismaErrorCode(error) !== "P2002") throw error;
    return (await spend()).count > 0;
  }
}

async function tryConsumeUserQuotaWithPrisma(
  db: PrismaClient,
  userId: string,
  kind: ImageGenKind,
  bucketStart: Date,
  cap: number,
  deps: ConsumeQuotaDeps,
): Promise<boolean> {
  // 1) Try increment if a row already exists and we are under the cap.
  const updated = await db.imageGenLedger.updateMany({
    where: { userId, kind, bucketStart, count: { lt: cap } },
    data: { count: { increment: 1 } },
  });
  if (updated.count > 0) return true;

  // 2) No matching updatable row: maybe one doesn't exist yet. Try to create it.
  try {
    await db.imageGenLedger.create({
      data: { userId, kind, bucketStart, count: 1 },
    });
    return true;
  } catch (error) {
    // Expected: a parallel caller just created the row (P2002 unique conflict)
    // or the user FK is gone (P2003). A bare catch here would also mask a real
    // D1 fault (connection drop, schema drift) as a benign "quota exhausted",
    // so capture+rethrow anything else instead of swallowing it.
    if (!isExpectedConsumeRaceError(error)) {
      if (deps.postHogConfig) {
        await captureException(
          deps.postHogConfig,
          {
            error,
            distinctId: userId,
            extras: { feature: "image_gen_quota", kind, phase: "ledgerCreate" },
          },
          deps.analyticsFetchImpl,
        );
      }
      throw error;
    }
    // Retry the increment once; if still no row updates, give up.
    const retry = await db.imageGenLedger.updateMany({
      where: { userId, kind, bucketStart, count: { lt: cap } },
      data: { count: { increment: 1 } },
    });
    return retry.count > 0;
  }
}
