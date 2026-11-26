// Starts a move-in, from an uploaded backup or from the other app's own server: checks it is a kitchen this person
// can bring, keeps what the move-in needs to read it where it is never served, and queues the job that brings it in.
// The plain form and the upload in parts (backup-upload.server.ts) share the backup's check.
import { SourceUnavailableError } from "../../application/source";
import { openMealieBackup } from "../sources/mealie-backup/backup";
import { chooseGroup } from "../sources/mealie-backup/database";
import { MoveInError, type MoveInErrorCode } from "../../model/move-in-error";
import { MOVE_IN_APPS } from "./apps";
import { openServerSource } from "./server-sources";
import { sameAddress } from "../sources/spoonjoy-api/recipe";
import { SPOONJOY_SOURCE_KIND } from "../sources/spoonjoy-api/source";
import { createMoveInJob } from "../storage/job-store.server";
import { MOVE_IN_ARCHIVE_PREFIX, ownerEmail, r2RangeSource, type MoveInEnv } from "./move-in-ports.server";
import { sealServerConnection, serverConnectionSecret, type ServerConnection } from "./server-connection.server";

/**
 * The largest backup the plain form takes, for a page without JavaScript. A form upload is held in the Worker's
 * memory while the request reads it, so this stays well under the Worker's memory. With JavaScript the page sends
 * a backup in parts instead (backup-upload.server.ts), up to MOVE_IN_BACKUP_MAX_BYTES.
 */
export const MOVE_IN_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export { MOVE_IN_APPS } from "./apps";

export type StartMoveInResult = { ok: true; jobId: string } | { ok: false; code: MoveInErrorCode };

/** The job kind a move-in of a backup from `app` starts, or null for an app the form doesn't offer one for. */
export function moveInKind(app: string): string | null {
  return Object.hasOwn(MOVE_IN_APPS, app) ? MOVE_IN_APPS[app as keyof typeof MOVE_IN_APPS].kind : null;
}

/**
 * Checks a backup already at `archiveKey` by range, so the Worker never holds it whole, and creates its job.
 * A backup that is turned away is deleted again, and so is one whose job can't be saved, unless
 * `keepOnSaveFailure`, for an upload whose finish is sent again (the archive sweep deletes it if not).
 * `createJob` makes the job; the form makes a new one, an upload in parts the one its finishes share.
 */
export async function admitStoredBackup({ env, ownerId, archiveKey, createJob, keepOnSaveFailure = false }: {
  env: MoveInEnv;
  ownerId: string;
  archiveKey: string;
  createJob: () => Promise<string>;
  keepOnSaveFailure?: boolean;
}): Promise<StartMoveInResult> {
  const drop = () => env.PHOTOS.delete(archiveKey).catch(() => undefined);
  let refused: MoveInErrorCode | null = null;
  try {
    const backup = await openMealieBackup(await r2RangeSource(env.PHOTOS, archiveKey));
    if (!chooseGroup(backup.database, await ownerEmail(env.DB, ownerId))) refused = "pick-a-group";
  } catch (error) {
    if (error instanceof MoveInError) {
      await drop();
      return { ok: false, code: error.code };
    }
    if (!keepOnSaveFailure) await drop();
    throw error;
  }
  if (refused) {
    await drop();
    return { ok: false, code: refused };
  }
  try {
    return { ok: true, jobId: await createJob() };
  } catch (error) {
    if (!keepOnSaveFailure) await drop();
    throw error;
  }
}

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
  const kind = moveInKind(app);
  if (!kind) return { ok: false, code: "unknown-app" };
  if (file.size > MOVE_IN_UPLOAD_MAX_BYTES) return { ok: false, code: "backup-too-large" };
  const archiveKey = `${MOVE_IN_ARCHIVE_PREFIX}${ownerId}/${crypto.randomUUID()}.zip`;
  await env.PHOTOS.put(archiveKey, file.data);
  return admitStoredBackup({
    env,
    ownerId,
    archiveKey,
    createJob: () => createMoveInJob(env.DB, { ownerId, kind, archiveKey, archiveName: file.name, now }),
  });
}

/**
 * Starts a move-in from the other app's server: asks it, with the cook's token, for the kitchen it would bring, so a
 * wrong address or token is answered at once with its fix-it message. The address and token are kept sealed
 * (server-connection.server.ts) in storage that is never served, and deleted with the job, like a backup.
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
  if (!Object.hasOwn(MOVE_IN_APPS, app)) return { ok: false, code: "unknown-app" };
  const chosen = MOVE_IN_APPS[app as keyof typeof MOVE_IN_APPS];
  if (!address.trim()) return { ok: false, code: "no-address" };
  if (!token.trim()) return { ok: false, code: "no-token" };
  let connection: ServerConnection;
  let name: string;
  try {
    const source = await openServerSource(chosen.serverKind, { address, token: token.trim(), fetch });
    // A server source always has the token's kitchen; opening it reads its recipe list, as the move-in will.
    const kitchen = (await source.chooseKitchen(null)) as string;
    // This Spoonjoy itself, by its own address or another of its names, would bring each of the cook's recipes again.
    if (source.kind === SPOONJOY_SOURCE_KIND && (kitchen === ownerId || (env.SPOONJOY_BASE_URL && sameAddress(source.serverUrl as string, env.SPOONJOY_BASE_URL)))) {
      throw new MoveInError("same-kitchen");
    }
    await source.openKitchen(kitchen);
    connection = { address: source.serverUrl as string, token: token.trim() };
    name = new URL(connection.address).host;
  } catch (error) {
    if (error instanceof MoveInError) return { ok: false, code: error.code };
    if (error instanceof SourceUnavailableError) return { ok: false, code: "server-unreachable" };
    // Anything else the server answered, such as an error page where the recipe list should be, isn't a recipe server.
    return { ok: false, code: "server-address" };
  }
  const archiveKey = `${MOVE_IN_ARCHIVE_PREFIX}${ownerId}/${crypto.randomUUID()}.json`;
  await env.PHOTOS.put(archiveKey, await sealServerConnection(serverConnectionSecret(env), archiveKey, connection));
  try {
    const jobId = await createMoveInJob(env.DB, { ownerId, kind: chosen.serverKind, archiveKey, archiveName: name, now });
    return { ok: true, jobId };
  } catch (error) {
    await env.PHOTOS.delete(archiveKey).catch(() => undefined);
    throw error;
  }
}
