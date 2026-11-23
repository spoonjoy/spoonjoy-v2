// The jobs port for tests: jobs wait in memory until drain() runs them, retrying a failed run straight
// away (the outcome still says how long the queue would have waited), with keys held in memory.
import { runJob, type JobKeys, type JobMessage, type JobOutcome, type JobRegistry, type Jobs } from "../ports/jobs";

export interface MemoryJobs extends Jobs {
  /** Runs every waiting job, and any job they enqueue, until none is left. */
  drain(): Promise<Array<{ type: string; key: string; outcome: JobOutcome }>>;
}

export function memoryJobs(registry: JobRegistry): MemoryJobs {
  const status = new Map<string, "pending" | "done">();
  const keys: JobKeys = {
    async claim(key) {
      if (status.has(key)) return false;
      status.set(key, "pending");
      return true;
    },
    isDone: async (key) => status.get(key) === "done",
    markDone: async (key) => void status.set(key, "done"),
    release: async (key) => void status.delete(key),
  };
  const waiting: Array<{ message: JobMessage; attempt: number }> = [];
  return {
    async enqueue(kind, payload, { key }) {
      if (!(await keys.claim(key, kind.type))) return { enqueued: false };
      waiting.push({ message: { type: kind.type, key, payload }, attempt: 1 });
      return { enqueued: true };
    },
    async drain() {
      const ran: Array<{ type: string; key: string; outcome: JobOutcome }> = [];
      for (let next = waiting.shift(); next; next = waiting.shift()) {
        const outcome = await runJob(registry, keys, next.message, next.attempt);
        ran.push({ type: next.message.type, key: next.message.key, outcome });
        if (outcome.status === "retry") waiting.push({ message: next.message, attempt: next.attempt + 1 });
      }
      return ran;
    },
  };
}
