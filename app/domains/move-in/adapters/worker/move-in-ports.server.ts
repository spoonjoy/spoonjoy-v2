// The runner's ports on a Worker: the uploaded backup read from R2 by range, the job and the
// kitchen in D1, photos stored next to every other recipe photo, and tags, categories and tools
// through Kitchen's organizers for a cook who has them.
import type { PrismaClient } from "@prisma/client";
import { prismaOrganizerStore } from "~/domains/kitchen";
import { isFlagOn, type FlagEnv } from "~/domains/platform";
import { d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";
import { getDb } from "~/lib/db.server";
import type { RangeSource } from "../archive/zip";
import { MoveInError } from "../../model/move-in-error";
import type { MoveInPorts } from "../../application/run-move-in";
import { moveInJobStore } from "../storage/job-store.server";
import { attachMovedInOrganizers } from "../storage/organizer-writer.server";
import { attachMovedInPhoto, hasMovedInPhoto } from "../storage/photo-writer.server";
import { writeMovedInRecipe } from "../storage/recipe-writer.server";

/**
 * Where an uploaded backup waits while it moves in. The photo route never serves this prefix and the
 * photo sweep skips it; a finished job deletes its backup, and sweepMoveInArchives clears the rest.
 */
export { MOVE_IN_ARCHIVE_PREFIX } from "~/lib/photo-variants";

type ArchiveBucket = Pick<R2Bucket, "head" | "get" | "put" | "delete">;

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

/** The email the person signs in to Spoonjoy with, which picks their kitchen in a backup that holds several. */
export async function ownerEmail(db: D1ReadDatabase, ownerId: string): Promise<string | null> {
  const [[row]] = await d1ReadBatch(db, [[`SELECT "email" FROM "User" WHERE "id" = ?`, ownerId]]);
  return row ? String(row.email) : null;
}

export function moveInPorts(env: MoveInEnv, now: () => Date): MoveInPorts {
  const db = env.DB;
  // Kitchen's organizers are on Prisma; a run opens it the first time a recipe has some.
  let prisma: Promise<PrismaClient> | undefined;
  return {
    store: moveInJobStore(db, now),
    openArchive: (job) => r2RangeSource(env.PHOTOS, job.archiveKey as string),
    ownerEmail: (ownerId) => ownerEmail(db, ownerId),
    writeRecipe: (input) => writeMovedInRecipe({ db, ...input, now: now() }),
    attachPhoto: (input) => attachMovedInPhoto({ db, bucket: env.PHOTOS, ...input, now: now() }),
    hasMovedInPhoto: (recipeId) => hasMovedInPhoto(db, recipeId),
    organizers: {
      on: (ownerId) => isFlagOn("organizers", env, ownerId),
      attach: async (moved) => attachMovedInOrganizers(prismaOrganizerStore(await (prisma ??= getDb({ DB: db as unknown as D1Database }))), moved),
    },
    discardArchive: async (job) => env.PHOTOS.delete(job.archiveKey as string),
    now,
  };
}
