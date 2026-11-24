// Starts a move-in, from an uploaded backup or from the other app's own server: checks it is a kitchen this person
// can bring, keeps what the move-in needs to read it where it is never served, and queues the job that brings it in.
import { SourceUnavailableError } from "../../application/source";
import { mealieApiSource } from "../sources/mealie-api/source";
import { openMealieBackup } from "../sources/mealie-backup/backup";
import { chooseGroup } from "../sources/mealie-backup/database";
import { MoveInError, type MoveInErrorCode } from "../../model/move-in-error";
import { MOVE_IN_APPS } from "./apps";
import { createMoveInJob } from "../storage/job-store.server";
import { MOVE_IN_ARCHIVE_PREFIX, ownerEmail, r2RangeSource, type MoveInEnv } from "./move-in-ports.server";

/**
 * The largest backup the upload form takes. A form upload is held in the Worker's memory while the
 * request reads it, so this stays well under the Worker's memory; larger kitchens move in from their server.
 */
export const MOVE_IN_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export { MOVE_IN_APPS } from "./apps";

export type StartMoveInResult = { ok: true; jobId: string } | { ok: false; code: MoveInErrorCode };

/**
 * `file.data` is the upload as the form gave it. It goes to storage first and is checked there by range, so the
 * Worker never holds a second copy of it, and a backup that is turned away is deleted again.
 */
export async function startMoveIn({ env, ownerId, app, file, now }: {
  env: MoveInEnv;
  ownerId: string;
  app: string;
  file: { name: string; size: number; data: Blob | Uint8Array };
  now: Date;
}): Promise<StartMoveInResult> {
  const chosen = MOVE_IN_APPS[app as keyof typeof MOVE_IN_APPS];
  if (!chosen) return { ok: false, code: "unknown-app" };
  if (file.size > MOVE_IN_UPLOAD_MAX_BYTES) return { ok: false, code: "backup-too-large" };
  const archiveKey = `${MOVE_IN_ARCHIVE_PREFIX}${ownerId}/${crypto.randomUUID()}.zip`;
  await env.PHOTOS.put(archiveKey, file.data);
  let refused: MoveInErrorCode | null = null;
  try {
    const backup = await openMealieBackup(await r2RangeSource(env.PHOTOS, archiveKey));
    if (!chooseGroup(backup.database, await ownerEmail(env.DB, ownerId))) refused = "pick-a-group";
  } catch (error) {
    await env.PHOTOS.delete(archiveKey).catch(() => undefined);
    if (error instanceof MoveInError) return { ok: false, code: error.code };
    throw error;
  }
  const drop = () => env.PHOTOS.delete(archiveKey).catch(() => undefined);
  if (refused) {
    await drop();
    return { ok: false, code: refused };
  }
  try {
    const jobId = await createMoveInJob(env.DB, { ownerId, kind: chosen.kind, archiveKey, archiveName: file.name, now });
    return { ok: true, jobId };
  } catch (error) {
    await drop();
    throw error;
  }
}

/** What a move-in from a server keeps in storage while it runs: where the server is, and the cook's token for it. */
export interface ServerConnection {
  address: string;
  token: string;
}

/**
 * Starts a move-in from the other app's server: asks it, with the cook's token, for the kitchen it would bring, so a
 * wrong address or token is answered at once with its fix-it message. The token is kept only in storage that is never
 * served, and deleted with the job, like a backup.
 */
export async function startServerMoveIn({ env, ownerId, app, address, token, fetch, now }: {
  env: MoveInEnv;
  ownerId: string;
  app: string;
  address: string;
  token: string;
  fetch: typeof globalThis.fetch;
  now: Date;
}): Promise<StartMoveInResult> {
  const chosen = MOVE_IN_APPS[app as keyof typeof MOVE_IN_APPS];
  if (!chosen) return { ok: false, code: "unknown-app" };
  if (!address.trim()) return { ok: false, code: "server-address" };
  if (!token.trim()) return { ok: false, code: "no-token" };
  let connection: ServerConnection;
  let name: string;
  try {
    const source = await mealieApiSource({ address, token: token.trim(), fetch });
    // A server source always has the token's kitchen; opening it reads its recipe list, as the move-in will.
    await source.openKitchen((await source.chooseKitchen(null)) as string);
    connection = { address: source.serverUrl as string, token: token.trim() };
    name = new URL(connection.address).host;
  } catch (error) {
    if (error instanceof MoveInError) return { ok: false, code: error.code };
    if (error instanceof SourceUnavailableError) return { ok: false, code: "server-unreachable" };
    // Anything else the server answered, such as an error page where the recipe list should be, isn't a recipe server.
    return { ok: false, code: "server-address" };
  }
  const archiveKey = `${MOVE_IN_ARCHIVE_PREFIX}${ownerId}/${crypto.randomUUID()}.json`;
  await env.PHOTOS.put(archiveKey, new TextEncoder().encode(JSON.stringify(connection)));
  try {
    const jobId = await createMoveInJob(env.DB, { ownerId, kind: chosen.serverKind, archiveKey, archiveName: name, now });
    return { ok: true, jobId };
  } catch (error) {
    await env.PHOTOS.delete(archiveKey).catch(() => undefined);
    throw error;
  }
}
