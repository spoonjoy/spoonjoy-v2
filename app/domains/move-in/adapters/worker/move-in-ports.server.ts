// The runner's ports on a Worker: the uploaded backup read from R2 by range, the job and the
// kitchen in D1, photos stored next to every other recipe photo, and tags, categories and tools
// through Kitchen's organizers for a cook who has them.
import type { PrismaClient } from "@prisma/client";
import { isFlagOn, type FlagEnv } from "~/domains/platform";
import { d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";
import { getDb } from "~/lib/db.server";
import type { RangeSource } from "../archive/zip";
import { MoveInError } from "../../model/move-in-error";
import type { MoveInJob, MoveInPorts } from "../../application/run-move-in";
import type { MoveInSource } from "../../application/source";
import { mealieApiSource } from "../sources/mealie-api/source";
import { openMealieBackup } from "../sources/mealie-backup/backup";
import { mealieBackupSource } from "../sources/mealie-backup/source";
import { moveInJobStore } from "../storage/job-store.server";
import { attachMovedInOrganizers } from "../storage/organizer-writer.server";
import { attachMovedInPhoto, hasMovedInPhoto } from "../storage/photo-writer.server";
import { writeMovedInRecipe } from "../storage/recipe-writer.server";
import { readsAServer } from "./apps";

/**
 * Where an uploaded backup waits while it moves in. The photo route never serves this prefix and the
 * photo sweep skips it; a finished job deletes its backup, and sweepMoveInArchives clears the rest.
 */
export { MOVE_IN_ARCHIVE_PREFIX } from "~/lib/photo-variants";

// A backup comes in whole from the form, or in parts from the page (backup-upload.server.ts).
type ArchiveBucket = Pick<R2Bucket, "head" | "get" | "put" | "delete" | "createMultipartUpload" | "resumeMultipartUpload">;

export interface MoveInEnv extends NonNullable<FlagEnv> {
  DB: D1ReadDatabase;
  PHOTOS: ArchiveBucket;
}

/** The database, photo storage and flags a move-in runs with, out of the Worker's environment; null without the first two. */
export function moveInEnv(env: (FlagEnv & { DB?: unknown; PHOTOS?: unknown }) | undefined): MoveInEnv | null {
  if (!env?.DB || !env.PHOTOS) return null;
  const { DB, PHOTOS, SPOONJOY_FLAGS, SPOONJOY_FLAG_USERS } = env;
  return { DB: DB as D1ReadDatabase, PHOTOS: PHOTOS as ArchiveBucket, SPOONJOY_FLAGS, SPOONJOY_FLAG_USERS };
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

/**
 * Where a job's recipes come from: the other app's server, through the address and token its start kept, or the
 * uploaded backup. Gone from storage means the job went quiet for a day and the sweep deleted it.
 */
export async function openMoveInSource(bucket: Pick<R2Bucket, "head" | "get">, job: MoveInJob, fetch: typeof globalThis.fetch): Promise<MoveInSource> {
  const key = job.archiveKey as string;
  if (!readsAServer(job.kind)) return mealieBackupSource(await openMealieBackup(await r2RangeSource(bucket, key)));
  const stored = await bucket.get(key);
  if (!stored) throw new MoveInError("expired", "the server connection is no longer in storage");
  const { address, token } = JSON.parse(new TextDecoder().decode(await stored.arrayBuffer())) as { address: string; token: string };
  return mealieApiSource({ address, token, fetch });
}

/** The email the person signs in to Spoonjoy with, which picks their kitchen in a backup that holds several. */
export async function ownerEmail(db: D1ReadDatabase, ownerId: string): Promise<string | null> {
  const [[row]] = await d1ReadBatch(db, [[`SELECT "email" FROM "User" WHERE "id" = ?`, ownerId]]);
  return row ? String(row.email) : null;
}

export function moveInPorts(env: MoveInEnv, now: () => Date): MoveInPorts {
  const db = env.DB;
  // Kitchen's organizers are on Prisma; a run opens it the first time a recipe has some, and again if that failed.
  let prisma: Promise<PrismaClient> | undefined;
  const openPrisma = () =>
    (prisma ??= getDb({ DB: db as unknown as D1Database }).catch((error: unknown) => {
      prisma = undefined;
      throw error;
    }));
  return {
    store: moveInJobStore(db, now),
    openArchive: (job) => r2RangeSource(env.PHOTOS, job.archiveKey as string),
    openSource: (job) => openMoveInSource(env.PHOTOS, job, (input, init) => fetch(input, init)),
    ownerEmail: (ownerId) => ownerEmail(db, ownerId),
    writeRecipe: (input) => writeMovedInRecipe({ db, ...input, now: now() }),
    attachPhoto: (input) => attachMovedInPhoto({ db, bucket: env.PHOTOS, ...input, now: now() }),
    hasMovedInPhoto: (recipeId) => hasMovedInPhoto(db, recipeId),
    organizers: {
      on: (ownerId) => isFlagOn("organizers", env, ownerId),
      attach: async (moved) => attachMovedInOrganizers(await openPrisma(), moved),
    },
    discardArchive: async (job) => env.PHOTOS.delete(job.archiveKey as string),
    now,
  };
}
