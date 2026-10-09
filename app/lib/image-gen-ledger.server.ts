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
/** A photo import is one vision-model read, dearer than a text one, so it has its own lower cap. */
export const PHOTO_IMPORT_DAILY_CAP = 10;

export type ImageGenKind = "placeholder" | "stylization" | "import" | "import-photo";

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
  at: Date,
): Promise<boolean> {
  const day = prismaD1Timestamp(bucketStart);
  const dayForms = [day, bucketStart.toISOString(), bucketStart.getTime()];
  const sameDay = `"userId" = ? AND "kind" = ? AND "bucketStart" IN (?, ?, ?)`;
  const updatedAt = prismaD1Timestamp(at);
  const [, increment] = await d1WriteBatch(d1, [
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
      // One row only: a day stored in two forms by older writers must spend one unit, not two.
      `UPDATE "ImageGenLedger" SET "count" = "count" + 1, "updatedAt" = ?
       WHERE "id" = (SELECT "id" FROM "ImageGenLedger" WHERE ${sameDay} AND "count" < ? LIMIT 1)`,
      updatedAt,
      userId,
      kind,
      ...dayForms,
      cap,
    ],
  ]);
  return increment!.changes >= 1;
}

/**
 * Atomically reserve one unit of the daily image-gen budget for `(userId, kind, today)`.
 * Returns true when the budget was incremented, false when the cap is reached or the
 * user no longer exists. Safe to call concurrently — when two callers race on the very
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

  if (deps.d1) {
    try {
      return await tryConsumeImageGenQuotaOnD1(deps.d1, userId, kind, bucketStart, cap, at);
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

  // Prisma (no D1 binding). Each updateMany is one UPDATE whose WHERE re-checks the cap.

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
