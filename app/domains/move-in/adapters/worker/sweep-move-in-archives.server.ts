// Deletes uploaded backups that no move-in needs any more: a finished job's (if its own delete
// failed), one whose account is gone, and one whose job stopped moving forward, which it ends.
// The photo sweep skips this prefix, so this is the only thing that clears it. It also aborts uploads
// in parts that never finished. Runs from the cron.
import { d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Timestamp } from "~/lib/d1-write.server";
import { MOVE_IN_ARCHIVE_PREFIX } from "~/lib/photo-variants";
import { FINISHED, type MoveInJob } from "../../application/run-move-in";
import { MOVE_IN_ERROR_MESSAGES } from "../../model/move-in-error";
import { moveInJobStore } from "../storage/job-store.server";
import { abandonedUploads, deleteUpload } from "../storage/upload-store.server";
import { MOVE_IN_UPLOAD_KEPT_MS } from "./backup-upload.server";

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
      // The write checks the quiet again, so a run that takes the job in the meantime keeps it, and its backup.
      const changed = await store.updateJob(String(row.id), { status: "failed", lastError: "expired" }, undefined, {
        quietSince: d1Timestamp(new Date(now.getTime() - MOVE_IN_ABANDONED_MS)),
        events: [{ level: "error", kind: "job-failed", entity: null, sourceKey: null, targetId: null, message: MOVE_IN_ERROR_MESSAGES.expired }],
      });
      if (!changed) continue;
      expired += 1;
    }
    await bucket.delete(object.key);
    deleted += 1;
  }
  return { deleted, expired };
}

/**
 * "Buckets have a default lifecycle rule to expire multipart uploads seven days after initiation"
 * (https://developers.cloudflare.com/r2/buckets/object-lifecycles/). That this bucket still has that rule is
 * unchecked, so it is only a backstop: production deploys with scoped tokens and no workflow manages the bucket's
 * lifecycle rules, so the app aborts its own unfinished uploads here, after a day.
 */
export const MOVE_IN_UPLOAD_BACKSTOP_MS = 7 * 24 * 60 * 60 * 1000;

export interface MoveInUploadBucket {
  resumeMultipartUpload(key: string, uploadId: string): { abort(): Promise<void> };
}

/**
 * Aborts each upload in parts that didn't become a move-in within a day, and forgets it. One that storage won't
 * abort is tried again on the next cron, until storage's own backstop must have cleared it; one whose parts were
 * put together but never became a job left a backup, which sweepMoveInArchives deletes.
 */
export async function sweepMoveInUploads({ db, bucket, now }: { db: D1ReadDatabase; bucket: MoveInUploadBucket; now: Date }) {
  let aborted = 0;
  for (const upload of await abandonedUploads(db, new Date(now.getTime() - MOVE_IN_UPLOAD_KEPT_MS))) {
    try {
      await bucket.resumeMultipartUpload(upload.archiveKey, upload.uploadId).abort();
    } catch {
      if (now.getTime() - new Date(upload.startedAt).getTime() < MOVE_IN_UPLOAD_BACKSTOP_MS) continue;
    }
    await deleteUpload(db, upload.id);
    aborted += 1;
  }
  return { aborted };
}

/** The cron's entry: sweeps when the Worker has its database and bucket, and logs the counts. */
export async function runScheduledMoveInSweep(
  env: { DB?: unknown; PHOTOS?: unknown },
  now: Date,
  log: (line: string) => void = console.log,
): Promise<{ deleted: number; expired: number; aborted: number } | null> {
  if (!env.DB || !env.PHOTOS) return null;
  const db = env.DB as D1ReadDatabase;
  const uploads = await sweepMoveInUploads({ db, bucket: env.PHOTOS as MoveInUploadBucket, now });
  const report = { ...(await sweepMoveInArchives({ db, bucket: env.PHOTOS as MoveInArchiveBucket, now })), ...uploads };
  log(JSON.stringify({ event: "move_in_archive_sweep", ...report }));
  return report;
}
