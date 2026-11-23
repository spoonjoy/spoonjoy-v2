// The jobs port on spoonjoy.app: Cloudflare Queues carry the jobs, and D1's PlatformJobKey table holds
// each job's key and lease. The Worker's queue() handler (workers/app.ts) hands each batch to
// consumeJobBatch. These take their bindings as arguments and read no env themselves.
//
// The JOBS queue's consumer needs max_retries well above the largest kind's maxAttempts, because waiting
// out a lease or a deploy also counts as a delivery to Queues; if Queues drops a message anyway, its key
// is claimable again once its lease is up (or after a day waiting). It needs max_batch_size 1 for long
// jobs, so one job's run never holds up another's.
import { isJobMessage, retryDelaySeconds, runJob, JobsUnavailableError, type JobKeys, type JobMessage, type JobRegistry, type Jobs } from "../ports/jobs";

/** The slice of a D1 binding the job keys use. */
export interface JobKeysDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<{ meta: { changes?: number } }>;
      all<Row>(): Promise<{ results: Row[] }>;
    };
  };
}

export function queueJobs(queue: Queue<JobMessage> | undefined, keys: JobKeys): Jobs {
  return {
    async enqueue(kind, payload, { key, delaySeconds }) {
      if (!queue) throw new JobsUnavailableError("the JOBS queue binding");
      if (!(await keys.claim(key, kind.type))) return { enqueued: false };
      try {
        await queue.send({ type: kind.type, key, payload }, delaySeconds ? { delaySeconds } : {});
      } catch (error) {
        await keys.release(key);
        throw error;
      }
      return { enqueued: true };
    },
  };
}

export interface ConsumeOptions {
  /** Hears a job that failed its last attempt, to report it. */
  onFailed?(message: JobMessage, error: unknown): void | Promise<void>;
}

/**
 * Runs a queue batch: acks what finished or was skipped, and retries a failed or busy run after its wait.
 * Each message settles on its own, so one message's error never sends the rest of the batch round again.
 */
export async function consumeJobBatch(batch: MessageBatch<unknown>, registry: JobRegistry, keys: JobKeys, options: ConsumeOptions = {}) {
  for (const message of batch.messages) {
    const body = message.body;
    // Not a job this code can read: nothing would ever run it.
    if (!isJobMessage(body)) {
      message.ack();
      continue;
    }
    let outcome;
    try {
      outcome = await runJob(registry, keys, body);
    } catch {
      // The job's bookkeeping failed (D1 dropped a write); deliver it again after the usual wait.
      message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
      continue;
    }
    if (outcome.status === "retry" || outcome.status === "busy" || outcome.status === "unhandled") {
      message.retry({ delaySeconds: outcome.delaySeconds });
      continue;
    }
    if (outcome.status === "failed") await reportFailure(options, body, outcome.error);
    message.ack();
  }
}

/** A report that fails can't be reported; the job is still settled. */
async function reportFailure(options: ConsumeOptions, message: JobMessage, error: unknown) {
  try {
    await options.onFailed?.(message, error);
  } catch {
    // The reporter is the telemetry; there's nowhere left to send its own failure.
  }
}

/** A key waiting this long has lost its message (a send that failed after the claim, or a dropped delivery). */
const LOST_AFTER_MS = 24 * 60 * 60 * 1000;
/** A delivery that finds its key leased comes back this long after the lease is up. */
const AFTER_LEASE_SECONDS = 5;

export function d1JobKeys(db: JobKeysDatabase, now: () => Date = () => new Date()): JobKeys {
  return {
    async claim(key, type) {
      const at = now();
      const lostBefore = new Date(at.getTime() - LOST_AFTER_MS).toISOString();
      const result = await db
        .prepare(
          `INSERT INTO "PlatformJobKey" ("key", "type", "status", "createdAt", "updatedAt") VALUES (?, ?, 'pending', ?, ?)
           ON CONFLICT ("key") DO UPDATE SET "type" = excluded."type", "status" = 'pending', "leaseUntil" = NULL, "runs" = 0,
             "updatedAt" = excluded."updatedAt"
           WHERE ("PlatformJobKey"."status" = 'pending' AND "PlatformJobKey"."updatedAt" < ?)
              OR ("PlatformJobKey"."status" = 'running' AND "PlatformJobKey"."leaseUntil" < ?)`,
        )
        .bind(key, type, at.toISOString(), at.toISOString(), lostBefore, at.toISOString())
        .run();
      return (result.meta.changes ?? 0) > 0;
    },
    async start(key, type, leaseSeconds) {
      const at = now();
      const leaseUntil = new Date(at.getTime() + leaseSeconds * 1000).toISOString();
      // A delivery whose key has no row (released after a failure, or never claimed) starts it.
      const result = await db
        .prepare(
          `INSERT INTO "PlatformJobKey" ("key", "type", "status", "leaseUntil", "runs", "createdAt", "updatedAt") VALUES (?, ?, 'running', ?, 1, ?, ?)
           ON CONFLICT ("key") DO UPDATE SET "status" = 'running', "leaseUntil" = excluded."leaseUntil", "runs" = "PlatformJobKey"."runs" + 1,
             "updatedAt" = excluded."updatedAt"
           WHERE "PlatformJobKey"."status" = 'pending' OR ("PlatformJobKey"."status" = 'running' AND "PlatformJobKey"."leaseUntil" < ?)
           RETURNING "runs"`,
        )
        .bind(key, type, leaseUntil, at.toISOString(), at.toISOString(), at.toISOString())
        .all<{ runs: number }>();
      if (result.results[0]) return { state: "started", run: result.results[0].runs };
      const { results } = await db
        .prepare(`SELECT "status", "leaseUntil" FROM "PlatformJobKey" WHERE "key" = ?`)
        .bind(key)
        .all<{ status: string; leaseUntil: string | null }>();
      if (results[0]?.status === "done") return { state: "done" };
      const leaseLeftMs = results[0]?.leaseUntil ? new Date(results[0].leaseUntil).getTime() - at.getTime() : 0;
      return { state: "busy", retryInSeconds: Math.max(0, Math.ceil(leaseLeftMs / 1000)) + AFTER_LEASE_SECONDS };
    },
    async pause(key) {
      await db
        .prepare(`UPDATE "PlatformJobKey" SET "status" = 'pending', "leaseUntil" = NULL, "updatedAt" = ? WHERE "key" = ? AND "status" = 'running'`)
        .bind(now().toISOString(), key)
        .run();
    },
    async markDone(key) {
      await db
        .prepare(`UPDATE "PlatformJobKey" SET "status" = 'done', "leaseUntil" = NULL, "updatedAt" = ? WHERE "key" = ?`)
        .bind(now().toISOString(), key)
        .run();
    },
    async release(key) {
      await db.prepare(`DELETE FROM "PlatformJobKey" WHERE "key" = ?`).bind(key).run();
    },
  };
}
