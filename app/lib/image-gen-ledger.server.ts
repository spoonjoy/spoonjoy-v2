import type { PrismaClient } from "@prisma/client";
import {
  captureException,
  type PostHogServerConfig,
} from "~/lib/analytics-server";

export const PLACEHOLDER_DAILY_CAP = 30;
export const STYLIZATION_DAILY_CAP = 50;
export const IMPORT_DAILY_CAP = 50;

export type ImageGenKind = "placeholder" | "stylization" | "import";

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
