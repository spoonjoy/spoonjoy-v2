import type { PrismaClient } from "@prisma/client";

export const PLACEHOLDER_DAILY_CAP = 30;
export const STYLIZATION_DAILY_CAP = 50;

export type ImageGenKind = "placeholder" | "stylization";

export interface ConsumeQuotaDeps {
  now?: () => Date;
}

export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function capFor(kind: ImageGenKind): number {
  return kind === "placeholder" ? PLACEHOLDER_DAILY_CAP : STYLIZATION_DAILY_CAP;
}

/**
 * Atomically reserve one unit of the daily image-gen budget for `(userId, kind, today)`.
 * Returns true when the budget was incremented, false when the cap is reached or the
 * user no longer exists. Safe to call concurrently — when two callers race on the very
 * first consume of the day, both will succeed and the ledger ends at count=2.
 */
export async function tryConsumeImageGenQuota(
  db: PrismaClient,
  userId: string,
  kind: ImageGenKind,
  deps: ConsumeQuotaDeps = {},
): Promise<boolean> {
  const now = deps.now ?? (() => new Date());
  const bucketStart = startOfUtcDay(now());
  const cap = capFor(kind);

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
  } catch {
    // Either a parallel caller just created the row (unique conflict) or the user
    // FK is gone. Retry the increment once; if still no row updates, give up.
    const retry = await db.imageGenLedger.updateMany({
      where: { userId, kind, bucketStart, count: { lt: cap } },
      data: { count: { increment: 1 } },
    });
    return retry.count > 0;
  }
}
