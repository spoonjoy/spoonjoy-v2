/**
 * Health/liveness status for the public `GET /health` endpoint.
 *
 * Pure and dependency-free so the uptime check stays trivially testable and
 * never touches auth or the database. Real logic lives here (the route is a
 * thin shell) to keep it inside the coverage-measured lib.
 */
export function buildHealthStatus(): { status: "ok"; service: string } {
  return { status: "ok", service: "spoonjoy" };
}

export type ReadinessCheck = { ok: boolean; ms: number; error?: string };

export type ReadinessStatus = {
  status: "ready" | "degraded";
  service: string;
  checks: { d1: ReadinessCheck; r2: ReadinessCheck };
};

/** The slices of the D1 and R2 bindings the readiness probe uses. */
export type ReadinessEnv = {
  DB?: { prepare(sql: string): { first<T>(): Promise<T | null> } };
  PHOTOS?: { head(key: string): Promise<unknown> };
};

/** Key probed in R2. It need not exist: a `null` head still proves R2 answered. */
export const READINESS_R2_KEY = "__readiness__/probe";

const DEFAULT_READINESS_TIMEOUT_MS = 3_000;

class ReadinessFailure extends Error {
  constructor(readonly reason: "timeout" | "binding missing" | "unexpected result") {
    super(reason);
    this.name = "ReadinessFailure";
  }
}

async function timed(
  probe: () => Promise<void>,
  timeoutMs: number,
  now: () => number,
): Promise<ReadinessCheck> {
  const started = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ReadinessFailure("timeout")), timeoutMs);
      }),
    ]);
    return { ok: true, ms: Math.round(now() - started) };
  } catch (error) {
    // Only a short, fixed reason goes on the wire: this endpoint is public.
    const reason = error instanceof ReadinessFailure ? error.reason : "error";
    return { ok: false, ms: Math.round(now() - started), error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Readiness for `GET /health/ready`: proves this Worker can reach D1 and R2.
 * `/health` stays a dependency-free liveness check; this one is what uptime
 * monitoring should watch.
 */
export async function checkReadiness(
  env: ReadinessEnv,
  { timeoutMs = DEFAULT_READINESS_TIMEOUT_MS, now = () => Date.now() }: { timeoutMs?: number; now?: () => number } = {},
): Promise<ReadinessStatus> {
  const [d1, r2] = await Promise.all([
    timed(async () => {
      if (!env.DB) throw new ReadinessFailure("binding missing");
      const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
      if (row?.ok !== 1) throw new ReadinessFailure("unexpected result");
    }, timeoutMs, now),
    timed(async () => {
      if (!env.PHOTOS) throw new ReadinessFailure("binding missing");
      await env.PHOTOS.head(READINESS_R2_KEY);
    }, timeoutMs, now),
  ]);
  return {
    status: d1.ok && r2.ok ? "ready" : "degraded",
    service: "spoonjoy",
    checks: { d1, r2 },
  };
}
