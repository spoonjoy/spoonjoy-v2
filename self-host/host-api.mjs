// What the Worker asks of the server around it, through the SELF_HOST service binding
// (self-host/config.mjs): the backups the admin sees on Server settings. Only the Worker can call
// it; nothing outside the container reaches it.
//
//   GET  /backups                 the schedule, the number kept and the backups, newest first
//   POST /backups                 back up now
//   GET  /backups/<name>          the backup file, to download
//   POST /backups/<name>/restore  replace the kitchen with that backup's
//
// One backup or restore runs at a time (`oneAtATime`, which the scheduled backups share); another
// asked for meanwhile gets a 409.
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { isBackupName, listBackups } from "./backup.mjs";

export class BusyError extends Error {
  constructor() {
    super("A backup or restore is already running. Try again when it's done.");
  }
}

/** Runs one piece of work at a time, refusing another with a BusyError while one runs. */
export function oneAtATime() {
  let busy = false;
  return async (work) => {
    if (busy) throw new BusyError();
    busy = true;
    try {
      return await work();
    } finally {
      busy = false;
    }
  };
}

/**
 * The binding's handler. `settings` are backupSettings'; `backUp(kind)` and `restore(file)` do the
 * work and resolve to what they did, one at a time through `exclusive` (`oneAtATime`). `Response`
 * is Miniflare's, which the binding must answer with.
 */
export function hostApi({ settings, backUp, restore, exclusive, Response }) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const run = async (work) => {
    try {
      return json(await exclusive(work));
    } catch (error) {
      if (error instanceof BusyError) return json({ error: error.message }, 409);
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  };

  return async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/backups") {
      if (request.method === "GET") return json({ schedule: settings.schedule, keep: settings.keep, backups: listBackups(settings.dir) });
      if (request.method === "POST") return run(() => backUp("manual"));
    }
    const match = /^\/backups\/([^/]+)(\/restore)?$/.exec(pathname);
    const name = match ? decodeURIComponent(match[1]) : "";
    const file = path.join(settings.dir, name);
    if (!match || !isBackupName(name) || !existsSync(file)) return json({ error: "There's no such backup." }, 404);
    if (match[2] && request.method === "POST") return run(() => restore(file));
    if (!match[2] && request.method === "GET") {
      return new Response(Readable.toWeb(createReadStream(file)), {
        headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${name}"` },
      });
    }
    return json({ error: "There's no such backup." }, 404);
  };
}
