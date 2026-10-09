import type { PrismaClient } from "@prisma/client";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { d1WriteBatch } from "~/lib/d1-write.server";
import {
  captureException,
  type PostHogServerConfig,
} from "~/lib/analytics-server";

export const PLACEHOLDER_DAILY_CAP = 30;
export const STYLIZATION_DAILY_CAP = 50;
export const IMPORT_DAILY_CAP = 50;

export type ImageGenKind = "placeholder" | "stylization" | "import";

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
 * The consume as one D1 batch: create the day's row at zero if it is missing (and the user
 * still exists), then add one only while the count is under the cap. D1 runs a batch as one
 * transaction and runs batches one at a time, so concurrent consumes cannot pass the cap and
 * exactly the calls that fit under it succeed.
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
  // it happened, inside the same transaction.
  const consumeId = crypto.randomUUID();
  const [, , , increment] = await d1WriteBatch(d1, [
    [
      `INSERT INTO "ImageGenLedger" ("id", "userId", "kind", "bucketStart", "count", "updatedAt")
       SELECT ?, ?, ?, ?, 0, ?
       WHERE EXISTS (SELECT 1 FROM "User" WHERE "id" = ?)
         AND NOT EXISTS (SELECT 1 FROM "ImageGenLedger" WHERE ${sameDay})
       ON CONFLICT ("userId", "kind", "bucketStart") DO NOTHING`,
      crypto.randomUUID(),
      userId,
      kind,
      day,
      updatedAt,
      userId,
      userId,
      kind,
      ...dayForms,
    ],
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
         AND EXISTS (SELECT 1 FROM "ImageGenLedger" WHERE ${sameDay} AND "count" < ?)`,
      consumeId,
      updatedAt,
      ...dayForms,
      globalCap,
      userId,
      kind,
      ...dayForms,
      cap,
    ],
    [
      // One row only: a day stored in two forms by older writers must spend one unit, not two.
      // It runs only when the global increment above was this consume's.
      `UPDATE "ImageGenLedger" SET "count" = "count" + 1, "updatedAt" = ?
       WHERE "id" = (SELECT "id" FROM "ImageGenLedger" WHERE ${sameDay} AND "count" < ? LIMIT 1)
         AND EXISTS (SELECT 1 FROM "ImageGenDailyBudget" WHERE ${budgetDay} AND "lastConsumeId" = ?)`,
      updatedAt,
      userId,
      kind,
      ...dayForms,
      cap,
      ...dayForms,
      consumeId,
    ],
  ]);
  return increment!.changes >= 1;
}

/**
 * Atomically reserve one unit of the daily image-gen budget for `(userId, kind, today)`.
 * Returns true when the budget was incremented, false when the per-user cap or the global
 * daily budget is reached, the operator kill switch is off, or the user no longer exists. Safe to call concurrently — when two callers race on the very
 * first consume of the day, both will succeed and the ledger ends at count=2. With a D1
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
      return await tryConsumeImageGenQuotaOnD1(deps.d1, userId, kind, bucketStart, cap, globalCap, at);
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
