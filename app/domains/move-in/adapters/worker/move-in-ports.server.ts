// The runner's ports on a Worker: the uploaded backup read from R2 by range, the job and the
// kitchen in D1, and photos stored next to every other recipe photo.
import { d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";
import type { RangeSource } from "../archive/zip";
import { MoveInError } from "../../model/move-in-error";
import type { MoveInPorts } from "../../application/run-move-in";
import { moveInJobStore } from "../storage/job-store.server";
import { attachMovedInPhoto } from "../storage/photo-writer.server";
import { writeMovedInRecipe } from "../storage/recipe-writer.server";

/**
 * Where an uploaded backup waits while it moves in. The photo route never serves this prefix and
 * the photo sweep clears what is left there, so a backup never becomes a public photo.
 */
export const MOVE_IN_ARCHIVE_PREFIX = "pending-uploads/move-in/";

type ArchiveBucket = Pick<R2Bucket, "head" | "get" | "put" | "delete">;

export interface MoveInEnv {
  DB: D1ReadDatabase;
  PHOTOS: ArchiveBucket;
}

const gone = () => new MoveInError("broken-zip", "the uploaded backup is no longer in storage");

/** The R2 object at `key` as a source that reads only the byte ranges asked for. */
export async function r2RangeSource(bucket: Pick<R2Bucket, "head" | "get">, key: string): Promise<RangeSource> {
  const head = await bucket.head(key);
  if (!head) throw gone();
  return {
    size: head.size,
    async read(offset, length) {
      const object = await bucket.get(key, { range: { offset, length } });
      if (!object) throw gone();
      return new Uint8Array(await object.arrayBuffer());
    },
  };
}

export function moveInPorts(env: MoveInEnv, now: () => Date): MoveInPorts {
  const db = env.DB;
  return {
    store: moveInJobStore(db, now),
    openArchive: (job) => r2RangeSource(env.PHOTOS, job.archiveKey as string),
    async ownerEmail(ownerId) {
      const [[row]] = await d1ReadBatch(db, [[`SELECT "email" FROM "User" WHERE "id" = ?`, ownerId]]);
      return row ? String(row.email) : null;
    },
    writeRecipe: (input) => writeMovedInRecipe({ db, ...input, now: now() }),
    attachPhoto: (input) => attachMovedInPhoto({ db, bucket: env.PHOTOS, ...input, now: now() }),
    discardArchive: async (job) => env.PHOTOS.delete(job.archiveKey as string),
    now,
  };
}
