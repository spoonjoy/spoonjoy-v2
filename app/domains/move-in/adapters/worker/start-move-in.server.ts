// Starts a move-in from an uploaded backup: checks it is a backup this person can bring, keeps it
// where it is never served, and queues the job that brings it in.
import { bytesSource } from "../archive/zip";
import { openMealieBackup } from "../sources/mealie-backup/backup";
import { chooseGroup } from "../sources/mealie-backup/database";
import { MoveInError, type MoveInErrorCode } from "../../model/move-in-error";
import { createMoveInJob } from "../storage/job-store.server";
import { MOVE_IN_ARCHIVE_PREFIX, ownerEmail, type MoveInEnv } from "./move-in-ports.server";

/**
 * The largest backup the upload form takes. A form upload is held in the Worker's memory while it
 * is read, so this stays well under the Worker's memory; larger kitchens move in from their server.
 */
export const MOVE_IN_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

/** The apps the form offers, by the value its choice sends, with the job kind each starts. */
export const MOVE_IN_APPS = { mealie: { kind: "mealie-backup" } } as const;

export type StartMoveInResult = { ok: true; jobId: string } | { ok: false; code: MoveInErrorCode };

export async function startMoveIn({ env, ownerId, app, file, now }: {
  env: MoveInEnv;
  ownerId: string;
  app: string;
  file: { name: string; bytes: Uint8Array };
  now: Date;
}): Promise<StartMoveInResult> {
  const chosen = MOVE_IN_APPS[app as keyof typeof MOVE_IN_APPS];
  if (!chosen) return { ok: false, code: "unknown-app" };
  if (file.bytes.length > MOVE_IN_UPLOAD_MAX_BYTES) return { ok: false, code: "backup-too-large" };
  try {
    const backup = await openMealieBackup(bytesSource(file.bytes));
    if (!chooseGroup(backup.database, await ownerEmail(env.DB, ownerId))) return { ok: false, code: "pick-a-group" };
  } catch (error) {
    if (error instanceof MoveInError) return { ok: false, code: error.code };
    throw error;
  }
  const archiveKey = `${MOVE_IN_ARCHIVE_PREFIX}${ownerId}/${crypto.randomUUID()}.zip`;
  await env.PHOTOS.put(archiveKey, file.bytes);
  const jobId = await createMoveInJob(env.DB, { ownerId, kind: chosen.kind, archiveKey, archiveName: file.name, now });
  return { ok: true, jobId };
}
