// The jobs port for tests: jobs wait in memory until drain() runs them, one at a time, retrying a failed
// run straight away and ignoring delaySeconds (the outcome still says how long the queue would have
// waited), with keys held in memory. A job that fails its last attempt shows as "failed" in drain()'s list.
// A key is waiting at most once, and drain() runs one job at a time, so no delivery finds its key running or done.
import { runJob, type JobKeys, type JobMessage, type JobOutcome, type JobRegistry, type Jobs } from "../ports/jobs";

export interface MemoryJobs extends Jobs {
  /** Runs every waiting job, and any job they enqueue, until none is left. */
  drain(): Promise<Array<{ type: string; key: string; outcome: JobOutcome }>>;
}

export function memoryJobs(registry: JobRegistry): MemoryJobs {
  const status = new Map<string, "pending" | "running" | "done">();
  const runs = new Map<string, number>();
  const keys: JobKeys = {
    async claim(key) {
      if (status.has(key)) return false;
      status.set(key, "pending");
      return true;
    },
    async start(key) {
      status.set(key, "running");
      const run = (runs.get(key) ?? 0) + 1;
      runs.set(key, run);
      return { state: "started", run };
    },
    pause: async (key) => void status.set(key, "pending"),
    markDone: async (key) => void status.set(key, "done"),
    release: async (key) => {
      status.delete(key);
      runs.delete(key);
    },
  };
  const waiting: JobMessage[] = [];
  return {
    async enqueue(kind, payload, { key }) {
      if (!(await keys.claim(key, kind.type))) return { enqueued: false };
      waiting.push({ type: kind.type, key, payload });
      return { enqueued: true };
    },
    async drain() {
      const ran: Array<{ type: string; key: string; outcome: JobOutcome }> = [];
      // A kind with no handler is reported once and dropped, so drain() always ends.
      for (let next = waiting.shift(); next; next = waiting.shift()) {
        const outcome = await runJob(registry, keys, next);
        ran.push({ type: next.type, key: next.key, outcome });
        if (outcome.status === "retry" || outcome.status === "busy") waiting.push(next);
      }
      return ran;
    },
  };
}
