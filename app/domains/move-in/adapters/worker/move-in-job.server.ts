// A move-in as a background job on the platform's jobs port, so it carries on with the page
// closed. Each delivery runs the move-in for a while and queues the next segment from where it
// stopped. The key names that place, so each segment is queued once however often it is asked
// for, and a segment that runs twice repeats nothing: the runner resumes from its own cursor.
// A watch runs beside the segments every few minutes, queues the move-in again if its segments
// stopped coming, and ends when the move-in does. A delivery that finds another run holding the
// move-in leaves it to that run.
import { defineJob, type JobHandler, type Jobs } from "~/domains/platform";
import { FINISHED, runMoveInSegment, type MoveInJob, type MoveInStatus } from "../../application/run-move-in";
import { readMoveInPosition } from "../storage/job-store.server";
import { moveInPorts, type MoveInEnv } from "./move-in-ports.server";

/** How long one segment runs before it hands over to the next, a stretch the page-driven runs have kept to. */
export const MOVE_IN_SEGMENT_MS = 20_000;
/** How long a move-in may go without a write before a look at the page, or its watch, queues it again. */
export const MOVE_IN_QUIET_MS = 60_000;
/** How often a move-in's watch looks at it. */
export const MOVE_IN_WATCH_SECONDS = 5 * 60;

export interface MoveInJobPayload {
  jobId: string;
}

export interface MoveInWatchPayload {
  jobId: string;
  /** Which look this is, so each one has its own key. */
  look: number;
}

type Position = Pick<MoveInJob, "id" | "phase" | "cursor">;

// The lease outlasts a segment and a slow chunk after it, so a segment whose Worker died is taken over in minutes
// rather than the port's default quarter of an hour.
export const MOVE_IN_JOB = defineJob<MoveInJobPayload>("move-in.run", { leaseSeconds: 300 });
export const MOVE_IN_WATCH = defineJob<MoveInWatchPayload>("move-in.watch", { leaseSeconds: 60 });

/** The key for the segment that starts where the job now stands. */
export function moveInJobKey(job: Position): string {
  return `move-in:${job.id}:${job.phase}:${job.cursor ?? "-"}`;
}

/** Queues the segment that starts where the job stands: false when that segment is already queued, running or done. */
export async function queueMoveIn(jobs: Jobs, job: Position): Promise<boolean> {
  return (await jobs.enqueue(MOVE_IN_JOB, { jobId: job.id }, { key: moveInJobKey(job) })).enqueued;
}

/**
 * Starts a move-in on the queue: its first segment, and the watch that keeps it going. Each is sent whether or not the
 * other could be, since either one gets the move-in going; it throws if either failed.
 */
export async function startMoveInJob(jobs: Jobs, jobId: string): Promise<void> {
  // The watch is tried twice: without it, only the open page could get a stalled move-in going again.
  const watch = watchMoveIn(jobs, jobId, 1).catch(() => watchMoveIn(jobs, jobId, 1));
  const sent = await Promise.allSettled([watch, queueMoveIn(jobs, { id: jobId, phase: "inspect", cursor: null })]);
  const failed = sent.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
}

async function watchMoveIn(jobs: Jobs, jobId: string, look: number): Promise<void> {
  await jobs.enqueue(MOVE_IN_WATCH, { jobId, look }, { key: `move-in:${jobId}:watch:${look}`, delaySeconds: MOVE_IN_WATCH_SECONDS });
}

/**
 * Queues an unfinished move-in that nothing has written to for MOVE_IN_QUIET_MS, for when its chain of segments broke
 * (a segment out of attempts, or a Worker that died holding it). `updatedAt` is the job's last write, as D1 keeps it
 * (ISO). The key names that quiet stretch and the minute, rather than the segment, whose own key may be spent already:
 * one nudge a minute goes out however many ask, and a nudge that found a run still holding the move-in, which then died,
 * doesn't stop the next.
 */
export async function nudgeMoveIn(jobs: Jobs, job: Pick<MoveInJob, "id"> & { status: MoveInStatus; updatedAt: string }, now: Date): Promise<boolean> {
  if (FINISHED.includes(job.status)) return false;
  if (now.getTime() - Date.parse(job.updatedAt) < MOVE_IN_QUIET_MS) return false;
  const minute = Math.floor(now.getTime() / MOVE_IN_QUIET_MS);
  return (await jobs.enqueue(MOVE_IN_JOB, { jobId: job.id }, { key: `move-in:${job.id}:nudge:${job.updatedAt}:${minute}` })).enqueued;
}

/** A segment held the move-in and moved nothing, so the port runs it again. */
class MoveInStalledError extends Error {
  constructor(jobId: string) {
    super(`A segment of ${jobId} moved nothing`);
    this.name = "MoveInStalledError";
  }
}

const isPayload = (payload: unknown): payload is MoveInJobPayload =>
  typeof payload === "object" && payload !== null && typeof (payload as MoveInJobPayload).jobId === "string";

export function moveInJobHandler(
  env: MoveInEnv,
  jobs: Jobs,
  { budgetMs = MOVE_IN_SEGMENT_MS, chunkSize, now = () => new Date() }: { budgetMs?: number; chunkSize?: number; now?: () => Date } = {},
): JobHandler<MoveInJobPayload> {
  return async (payload) => {
    // A message that names no move-in has nothing to run.
    if (!isPayload(payload)) return;
    const ports = moveInPorts(env, now);
    const before = await ports.store.loadJob(payload.jobId);
    if (!before || FINISHED.includes(before.status)) return;
    // An error lets the move-in go and is passed on, so the port's backoff paces the next try, which resumes from the
    // runner's cursor.
    const { job: after, claimed } = await runMoveInSegment(before.id, ports, { budgetMs, chunkSize, releaseOnError: true });
    if (!after || FINISHED.includes(after.status)) return;
    // Another run holds it, and queues what comes after its own segment. If that run's Worker died instead, the move-in
    // goes quiet, and the watch or the page queues it again.
    if (!claimed) return;
    if (moveInJobKey(after) === moveInJobKey(before)) throw new MoveInStalledError(before.id);
    await queueMoveIn(jobs, after);
  };
}

const isWatch = (payload: unknown): payload is MoveInWatchPayload =>
  isPayload(payload) && Number.isInteger((payload as MoveInWatchPayload).look);

/** Looks at a move-in every few minutes until it finishes, and queues it again whenever its segments stopped coming. */
export function moveInWatchHandler(env: MoveInEnv, jobs: Jobs, { now = () => new Date() }: { now?: () => Date } = {}): JobHandler<MoveInWatchPayload> {
  return async (payload) => {
    if (!isWatch(payload)) return;
    const job = await readMoveInPosition(env.DB, payload.jobId);
    if (!job || FINISHED.includes(job.status)) return;
    // The next look goes out first, so a nudge that fails can't end the watch.
    await watchMoveIn(jobs, job.id, payload.look + 1);
    await nudgeMoveIn(jobs, job, now());
  };
}
