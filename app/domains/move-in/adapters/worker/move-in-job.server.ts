// A move-in as a background job on the platform's jobs port, so it carries on with the page
// closed. Each delivery runs the move-in for a while and queues the next segment from where it
// stopped. The key names that place, so each segment is queued once however often it is asked
// for, and a segment that runs twice repeats nothing: the runner resumes from its own cursor.
import { defineJob, type JobHandler, type Jobs } from "~/domains/platform";
import { FINISHED, runForAWhile, type MoveInJob, type MoveInStatus } from "../../application/run-move-in";
import { moveInPorts, type MoveInEnv } from "./move-in-ports.server";

/** How long one segment runs before it hands over to the next, a stretch the page-driven runs have kept to. */
export const MOVE_IN_SEGMENT_MS = 20_000;
/** How long a move-in may go without a write before a look at the page queues it again. */
export const MOVE_IN_QUIET_MS = 60_000;

export interface MoveInJobPayload {
  jobId: string;
}

// The lease outlasts a segment with room to spare, so a segment whose Worker died is taken over in
// minutes rather than the port's default quarter of an hour.
export const MOVE_IN_JOB = defineJob<MoveInJobPayload>("move-in.run", { leaseSeconds: 120 });

/** The key for the segment that starts where the job now stands. */
export function moveInJobKey(job: Pick<MoveInJob, "id" | "phase" | "cursor">): string {
  return `move-in:${job.id}:${job.phase}:${job.cursor ?? "-"}`;
}

/** Queues the segment that starts where the job stands: false when that segment is already queued, running or done. */
export async function queueMoveIn(jobs: Jobs, job: Pick<MoveInJob, "id" | "phase" | "cursor">): Promise<boolean> {
  return (await jobs.enqueue(MOVE_IN_JOB, { jobId: job.id }, { key: moveInJobKey(job) })).enqueued;
}

/**
 * Queues an unfinished move-in that nothing has written to for MOVE_IN_QUIET_MS, for when its chain of segments broke
 * (a segment out of attempts, say). `updatedAt` is the job's last write, as D1 keeps it (ISO).
 */
export async function nudgeMoveIn(
  jobs: Jobs,
  job: Pick<MoveInJob, "id" | "phase" | "cursor"> & { status: MoveInStatus; updatedAt: string },
  now: Date,
): Promise<boolean> {
  if (FINISHED.includes(job.status)) return false;
  if (now.getTime() - Date.parse(job.updatedAt) < MOVE_IN_QUIET_MS) return false;
  return queueMoveIn(jobs, job);
}

/** The move-in still holds the claim of another run, so this delivery comes back later. */
class MoveInHeldError extends Error {
  constructor(jobId: string) {
    super(`Another run is moving ${jobId} in`);
    this.name = "MoveInHeldError";
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
    // An error is passed on, and the port runs this segment again; the runner resumes from its cursor.
    const after = await runForAWhile(before.id, ports, { budgetMs, chunkSize });
    if (!after || FINISHED.includes(after.status)) return;
    if (moveInJobKey(after) === moveInJobKey(before) && after.status === before.status) throw new MoveInHeldError(before.id);
    await queueMoveIn(jobs, after);
  };
}
