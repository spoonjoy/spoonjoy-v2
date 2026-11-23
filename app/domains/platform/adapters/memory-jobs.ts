// The jobs port for tests: jobs wait in memory until drain() runs them, one at a time, retrying a failed
// run straight away and ignoring delaySeconds (the outcome still says how long the queue would have
// waited), with keys held in memory. A job that fails its last attempt shows as "failed" in drain()'s list.
import { runJob, type JobKeys, type JobMessage, type JobOutcome, type JobRegistry, type Jobs } from "../ports/jobs";

export interface MemoryJobs extends Jobs {
  /** Runs every waiting job, and any job they enqueue, until none is left. */
  drain(): Promise<Array<{ type: string; key: string; outcome: JobOutcome }>>;
}

export function memoryJobs(registry: JobRegistry): MemoryJobs {
  const status = new Map<string, "pending" | "running" | "done">();
  const keys: JobKeys = {
    async claim(key) {
      if (status.has(key)) return false;
      status.set(key, "pending");
      return true;
    },
    async start(key) {
      const now = status.get(key);
      if (now === "done") return "done";
      if (now === "running") return "busy";
      status.set(key, "running");
      return "started";
    },
    pause: async (key) => void status.set(key, "pending"),
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
        if (outcome.status === "retry" || outcome.status === "busy") waiting.push({ message: next.message, attempt: next.attempt + 1 });
      }
      return ran;
    },
  };
}
