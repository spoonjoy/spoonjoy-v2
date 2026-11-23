// The jobs port: work that runs on the server after the request that asked for it, whether or not the
// person keeps the page open. spoonjoy.app runs jobs on Cloudflare Queues (../adapters/cloudflare-jobs.ts)
// and tests drain them in memory (../adapters/memory-jobs.ts); a self-hosted server will get an
// in-process adapter of its own.
//
// A job has a kind (defineJob), a payload and a key. Enqueueing a key that is already waiting or done does
// nothing. A delivery leases its key before it runs, so one run of a key goes at a time, and a delivery
// whose key is done is skipped; one that finds the key leased comes back when the lease is up. Queues
// delivers at least once, and a run can die part-way (its lease then runs out and the next delivery
// starts again; a late duplicate of a job that failed can start it again too), so handlers must be safe
// to run again: resume from what is already saved. A run that throws is retried after a backoff until
// the key has run maxAttempts times (counted on the key, not by the queue); then its key is freed, so
// the same job can be enqueued again later. Handlers check their own payloads: a message queued before
// a payload changed shape still reaches the new handler.

/** One kind of job, and the payload it carries. Define each kind once, beside its handler. */
export interface JobKind<Payload> {
  readonly type: string;
  readonly maxAttempts: number;
  /** How long one run may hold its key before another delivery may start it again. */
  readonly leaseSeconds: number;
  /** Carries the payload's type only; never set. */
  readonly payload?: Payload;
}

/** A Queues consumer runs for at most 15 minutes, so a run's lease outlasts it. */
const DEFAULT_LEASE_SECONDS = 15 * 60 + 60;

export function defineJob<Payload>(type: string, options: { maxAttempts?: number; leaseSeconds?: number } = {}): JobKind<Payload> {
  return { type, maxAttempts: options.maxAttempts ?? 5, leaseSeconds: options.leaseSeconds ?? DEFAULT_LEASE_SECONDS };
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

export function isJobMessage(body: unknown): body is JobMessage {
  if (typeof body !== "object" || body === null) return false;
  const { type, key } = body as Record<string, unknown>;
  return typeof type === "string" && typeof key === "string" && "payload" in body;
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

/** Where job keys are claimed and leased, so a key runs once at a time and finishes once: D1 on spoonjoy.app. */
export interface JobKeys {
  /**
   * True when the key was free (or left waiting for over a day, its message lost) and is now this job's;
   * false when it is already waiting, running or done.
   */
  claim(key: string, type: string): Promise<boolean>;
  /**
   * Leases the key to this run, and counts it: `run` is 1 on the key's first run. "busy" while another run
   * holds an unexpired lease, with the seconds until it is up; "done" once the job finished.
   */
  start(key: string, type: string, leaseSeconds: number): Promise<
    { state: "started"; run: number } | { state: "busy"; retryInSeconds: number } | { state: "done" }
  >;
  /** Gives the lease back after a run that will be retried. */
  pause(key: string): Promise<void>;
  markDone(key: string): Promise<void>;
  release(key: string): Promise<void>;
}

const FIRST_RETRY_SECONDS = 10;
/** How long a message of a kind this Worker doesn't know waits for a Worker that does (a deploy, a rollback). */
const UNHANDLED_RETRY_SECONDS = 5 * 60;
const LONGEST_RETRY_SECONDS = 15 * 60;

/** Seconds to wait before running a job again after its `attempt`th run failed. */
export function retryDelaySeconds(attempt: number): number {
  return Math.min(FIRST_RETRY_SECONDS * 2 ** (attempt - 1), LONGEST_RETRY_SECONDS);
}

export type JobOutcome =
  | { status: "done" }
  | { status: "skipped"; reason: "already-done" }
  | { status: "retry"; delaySeconds: number }
  | { status: "busy"; delaySeconds: number }
  | { status: "unhandled"; delaySeconds: number }
  | { status: "failed"; error: unknown };

/** Runs one delivery of a job: the adapters call this, and act on its outcome. */
export async function runJob(registry: JobRegistry, keys: JobKeys, message: JobMessage): Promise<JobOutcome> {
  const registered = registry.handlerFor(message.type);
  // A Worker that doesn't know the kind leaves the job and its key alone for one that does.
  if (!registered) return { status: "unhandled", delaySeconds: UNHANDLED_RETRY_SECONDS };
  const started = await keys.start(message.key, message.type, registered.kind.leaseSeconds);
  if (started.state === "done") return { status: "skipped", reason: "already-done" };
  if (started.state === "busy") return { status: "busy", delaySeconds: started.retryInSeconds };
  const attempt = started.run;
  try {
    await registered.handler(message.payload, { key: message.key, attempt });
  } catch (error) {
    if (attempt < registered.kind.maxAttempts) {
      await keys.pause(message.key);
      return { status: "retry", delaySeconds: retryDelaySeconds(attempt) };
    }
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
