// The jobs port on spoonjoy.app: Cloudflare Queues carry the jobs, and D1's PlatformJobKey table holds
// each job's key, so a job is enqueued and run once. The Worker's queue() handler (workers/app.ts) hands
// each batch to consumeJobBatch. These take their bindings as arguments and read no env themselves.
import { runJob, JobsUnavailableError, type JobKeys, type JobMessage, type JobRegistry, type Jobs } from "../ports/jobs";

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

/** Runs a queue batch: acks what finished or was skipped, and retries a failed run after its backoff. */
export async function consumeJobBatch(batch: MessageBatch<JobMessage>, registry: JobRegistry, keys: JobKeys, options: ConsumeOptions = {}) {
  for (const message of batch.messages) {
    const outcome = await runJob(registry, keys, message.body, message.attempts);
    if (outcome.status === "retry") {
      message.retry({ delaySeconds: outcome.delaySeconds });
      continue;
    }
    if (outcome.status === "failed") await options.onFailed?.(message.body, outcome.error);
    message.ack();
  }
}

export function d1JobKeys(db: JobKeysDatabase, now: () => Date = () => new Date()): JobKeys {
  return {
    async claim(key, type) {
      const at = now().toISOString();
      const result = await db
        .prepare(`INSERT INTO "PlatformJobKey" ("key", "type", "status", "createdAt", "updatedAt") VALUES (?, ?, 'pending', ?, ?) ON CONFLICT ("key") DO NOTHING`)
        .bind(key, type, at, at)
        .run();
      return (result.meta.changes ?? 0) > 0;
    },
    async isDone(key) {
      const { results } = await db.prepare(`SELECT "status" FROM "PlatformJobKey" WHERE "key" = ?`).bind(key).all<{ status: string }>();
      return results[0]?.status === "done";
    },
    async markDone(key) {
      await db.prepare(`UPDATE "PlatformJobKey" SET "status" = 'done', "updatedAt" = ? WHERE "key" = ?`).bind(now().toISOString(), key).run();
    },
    async release(key) {
      await db.prepare(`DELETE FROM "PlatformJobKey" WHERE "key" = ?`).bind(key).run();
    },
  };
}
