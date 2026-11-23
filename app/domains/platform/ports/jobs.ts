// The jobs port: work that runs on the server after the request that asked for it, whether or not the
// person keeps the page open. spoonjoy.app runs jobs on Cloudflare Queues (../adapters/cloudflare-jobs.ts);
// a self-hosted server runs them in process; tests drain them in memory (../adapters/memory-jobs.ts).
//
// A job has a kind (defineJob), a payload and a key. Enqueueing a key that is already waiting or done does
// nothing, and a delivery whose key is done is skipped, so a job runs to completion once however often
// it is enqueued or delivered. A run that throws is retried after a backoff until its kind's attempts
// run out; then its key is freed, so the same job can be enqueued again later.

/** One kind of job, and the payload it carries. Define each kind once, beside its handler. */
export interface JobKind<Payload> {
  readonly type: string;
  readonly maxAttempts: number;
  /** Carries the payload's type only; never set. */
  readonly payload?: Payload;
}

export function defineJob<Payload>(type: string, options: { maxAttempts?: number } = {}): JobKind<Payload> {
  return { type, maxAttempts: options.maxAttempts ?? 5 };
}

export interface EnqueueOptions {
  /** Names the work: the same key means the same job, so it is enqueued and run once. */
  key: string;
  delaySeconds?: number;
}

export interface Jobs {
  enqueue<Payload>(kind: JobKind<Payload>, payload: Payload, options: EnqueueOptions): Promise<{ enqueued: boolean }>;
}

export interface JobContext {
  key: string;
  /** 1 on the first run. */
  attempt: number;
}

export type JobHandler<Payload> = (payload: Payload, context: JobContext) => Promise<void>;

/** What travels on the queue. */
export interface JobMessage {
  type: string;
  key: string;
  payload: unknown;
}

export interface RegisteredJob {
  kind: JobKind<unknown>;
  handler: JobHandler<unknown>;
}

export interface JobRegistry {
  on<Payload>(kind: JobKind<Payload>, handler: JobHandler<Payload>): JobRegistry;
  handlerFor(type: string): RegisteredJob | undefined;
}

export function jobRegistry(): JobRegistry {
  const handlers = new Map<string, RegisteredJob>();
  const registry: JobRegistry = {
    on(kind, handler) {
      if (handlers.has(kind.type)) throw new Error(`A handler for "${kind.type}" is already registered`);
      handlers.set(kind.type, { kind: kind as JobKind<unknown>, handler: handler as JobHandler<unknown> });
      return registry;
    },
    handlerFor: (type) => handlers.get(type),
  };
  return registry;
}

/** Where job keys are claimed, so a key runs once: D1 on spoonjoy.app. */
export interface JobKeys {
  /** True when the key was free and is now this job's; false when it is already waiting or done. */
  claim(key: string, type: string): Promise<boolean>;
  isDone(key: string): Promise<boolean>;
  markDone(key: string): Promise<void>;
  release(key: string): Promise<void>;
}

const FIRST_RETRY_SECONDS = 10;
const LONGEST_RETRY_SECONDS = 15 * 60;

/** Seconds to wait before running a job again after its `attempt`th run failed. */
export function retryDelaySeconds(attempt: number): number {
  return Math.min(FIRST_RETRY_SECONDS * 2 ** (attempt - 1), LONGEST_RETRY_SECONDS);
}

export type JobOutcome =
  | { status: "done" }
  | { status: "skipped"; reason: "already-done" | "unknown-type" }
  | { status: "retry"; delaySeconds: number }
  | { status: "failed"; error: unknown };

/** Runs one delivery of a job: the adapters call this, and act on its outcome. */
export async function runJob(registry: JobRegistry, keys: JobKeys, message: JobMessage, attempt: number): Promise<JobOutcome> {
  const registered = registry.handlerFor(message.type);
  if (!registered) return { status: "skipped", reason: "unknown-type" };
  if (await keys.isDone(message.key)) return { status: "skipped", reason: "already-done" };
  try {
    await registered.handler(message.payload, { key: message.key, attempt });
  } catch (error) {
    if (attempt < registered.kind.maxAttempts) return { status: "retry", delaySeconds: retryDelaySeconds(attempt) };
    await keys.release(message.key);
    return { status: "failed", error };
  }
  await keys.markDone(message.key);
  return { status: "done" };
}

/** The jobs port lacks the binding it runs on here. */
export class JobsUnavailableError extends Error {
  constructor(missing: string) {
    super(`The jobs port is not available here: ${missing} is not configured.`);
    this.name = "JobsUnavailableError";
  }
}
