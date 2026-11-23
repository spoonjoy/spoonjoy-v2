// Deletes uploaded backups that no move-in needs any more: a finished job's (if its own delete
// failed), one whose account is gone, and one whose job stopped moving forward, which it ends.
// The photo sweep skips this prefix, so this is the only thing that clears it. Runs from the cron.
import { d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";
import { MOVE_IN_ARCHIVE_PREFIX } from "~/lib/photo-variants";
import { FINISHED, type MoveInJob } from "../../application/run-move-in";
import { MOVE_IN_ERROR_MESSAGES } from "../../model/move-in-error";
import { moveInJobStore } from "../storage/job-store.server";

/** How long an upload may wait for its job row: the upload writes the backup first, then the job. */
export const MOVE_IN_UPLOAD_GRACE_MS = 60 * 60 * 1000;
/** How long a job may go without moving forward before it is ended and its backup deleted. */
export const MOVE_IN_ABANDONED_MS = 24 * 60 * 60 * 1000;

export interface MoveInArchiveBucket {
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{
    objects: Array<{ key: string; uploaded: Date }>;
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string | string[]): Promise<void>;
}

async function listArchives(bucket: MoveInArchiveBucket) {
  const objects: Array<{ key: string; uploaded: Date }> = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await bucket.list({ prefix: MOVE_IN_ARCHIVE_PREFIX, cursor });
    objects.push(...page.objects);
    if (!page.truncated || !page.cursor) return objects;
    cursor = page.cursor;
  }
}

export async function sweepMoveInArchives({ db, bucket, now }: { db: D1ReadDatabase; bucket: MoveInArchiveBucket; now: Date }) {
  const store = moveInJobStore(db, () => now);
  let deleted = 0;
  let expired = 0;
  for (const object of await listArchives(bucket)) {
    const [[row]] = await d1ReadBatch(db, [[`SELECT "id", "status", "updatedAt" FROM "ImportJob" WHERE "archiveKey" = ?`, object.key]]);
    const age = now.getTime() - object.uploaded.getTime();
    if (!row) {
      if (age < MOVE_IN_UPLOAD_GRACE_MS) continue;
    } else if (!FINISHED.includes(row.status as MoveInJob["status"])) {
      if (now.getTime() - new Date(String(row.updatedAt)).getTime() < MOVE_IN_ABANDONED_MS) continue;
      const id = String(row.id);
      await store.addEvent(id, { level: "error", kind: "job-failed", entity: null, sourceKey: null, targetId: null, message: MOVE_IN_ERROR_MESSAGES.expired });
      await store.updateJob(id, { status: "failed", lastError: "expired" });
      expired += 1;
    }
    await bucket.delete(object.key);
    deleted += 1;
  }
  return { deleted, expired };
}

/** The cron's entry: sweeps when the Worker has its database and bucket, and logs the counts. */
export async function runScheduledMoveInSweep(
  env: { DB?: unknown; PHOTOS?: unknown },
  now: Date,
  log: (line: string) => void = console.log,
): Promise<{ deleted: number; expired: number } | null> {
  if (!env.DB || !env.PHOTOS) return null;
  const report = await sweepMoveInArchives({ db: env.DB as D1ReadDatabase, bucket: env.PHOTOS as MoveInArchiveBucket, now });
  log(JSON.stringify({ event: "move_in_archive_sweep", ...report }));
  return report;
}
