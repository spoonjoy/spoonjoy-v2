// Self-hosted Spoonjoy: serves the production Worker build (build/server, the bundle
// `wrangler deploy` ships) in Cloudflare's workerd through Miniflare, with the database, photos
// and cook sessions kept in one data folder. Nothing in app/ or workers/ changes for it.
//
//   node self-host/server.mjs             serve on PORT (8080), migrating the database first
//   node self-host/server.mjs sql <file>  run a SQL file (or - for stdin) against the database, with
//                                         the server stopped; the file runs whole or not at all
//   node self-host/server.mjs photos <dir> [prefix]
//                                         put each image in a folder into the photo store, under
//                                         prefix, with the server stopped
//   node self-host/server.mjs backup [file]
//                                         back up the database and photos to one file (in the
//                                         backups folder unless named), with the server stopped
//   node self-host/server.mjs restore <file>
//                                         replace the kitchen with a backup's, with the server
//                                         stopped, backing up what was there first
//
// While it serves, the server also backs itself up on SPOONJOY_BACKUP_SCHEDULE (self-host/backup.mjs).
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Miniflare, Response as MiniflareResponse, fetch as nodeFetch } from "miniflare";
import { createBackup, backupFileName, pruneBackups, restoreBackup } from "./backup.mjs";
import { serverPushKeys } from "./push-keys.mjs";
import { backupSettings, miniflareOptions, photoUploads, settingsFromEnv } from "./config.mjs";
import { nextCronTime, startCronTimers } from "./cron.mjs";
import { BusyError, hostApi, oneAtATime } from "./host-api.mjs";
import { applyMigrations, migrationFiles, splitSql } from "./migrations.mjs";

const startedAt = Date.now();
const [command = "serve", ...args] = process.argv.slice(2);
const settings = settingsFromEnv(process.env);
const { appDir, dataDir } = settings;
const backups = backupSettings(process.env, dataDir, (cron) => nextCronTime(cron, Date.now()));
// One backup or restore at a time, whether the schedule or the admin asks for it.
const exclusive = oneAtATime();
let api;
const log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));

mkdirSync(dataDir, { recursive: true });

// A session secret made once per server and kept in the data folder, unless SESSION_SECRET is set.
const secretFile = path.join(dataDir, "session-secret");
if (!existsSync(secretFile)) {
  writeFileSync(secretFile, randomBytes(32).toString("hex"), { mode: 0o600 });
  chmodSync(secretFile, 0o600);
}

const built = JSON.parse(readFileSync(path.join(appDir, "build/server/wrangler.json"), "utf8"));
const options = miniflareOptions({
  built,
  env: process.env,
  settings: command === "serve" ? settings : { ...settings, port: 0 },
  sessionSecret: readFileSync(secretFile, "utf8").trim(),
  pushKeys: serverPushKeys(path.join(dataDir, "push-keys.json")),
  version: process.env.SPOONJOY_VERSION ?? "dev",
  serverAssetFiles: readdirSync(path.join(appDir, "build/server/assets")),
  outboundFetch: nodeFetch,
  // Built on its first request, which comes only once the database below is ready.
  hostService: command === "serve" ? (request) => (api ??= hostApi({ settings: backups, backUp, restore: restoreFrom, exclusive, Response: MiniflareResponse }))(request) : undefined,
});
if (command !== "serve") options.host = "127.0.0.1";

const mf = new Miniflare(options);
await mf.ready;

const db = await mf.getD1Database("DB");
const knownMigrations = migrationFiles(path.join(appDir, "migrations"));
const migrations = await applyMigrations(db, knownMigrations);
const version = options.bindings.CF_VERSION_METADATA.id;

async function backUp(kind, file = path.join(backups.dir, backupFileName(kind))) {
  mkdirSync(path.dirname(file), { recursive: true });
  const photos = await mf.getR2Bucket("PHOTOS");
  const made = await createBackup({ db, photos, file, version });
  log("backup", { kind, file, rows: made.rows, photos: made.photos, photoBytes: made.photoBytes, bytes: statSync(file).size });
  return { ...made, name: path.basename(file) };
}

// Replaces the kitchen with a backup's, saving what's there first if it has any accounts, and
// brings it up to date with this image.
async function restoreFrom(file) {
  const users = (await db.prepare('SELECT COUNT(*) AS count FROM "User"').first()).count;
  const saved = users > 0 ? await backUp("before-restore") : null;
  const photos = await mf.getR2Bucket("PHOTOS");
  const restored = await restoreBackup({ db, photos, file, knownMigrations: knownMigrations.map((migration) => migration.name) });
  const after = await applyMigrations(db, knownMigrations);
  log("restore", { ...restored, migrationsRun: after.ran, savedFirst: saved?.name ?? null });
  return { ...restored, savedFirst: saved?.name ?? null };
}

if (command === "sql") {
  const file = args[0];
  if (!file) {
    console.error("Usage: server.mjs sql <file.sql | ->");
    await mf.dispose();
    process.exit(2);
  }
  const statements = splitSql(readFileSync(file === "-" ? 0 : file, "utf8"));
  await db.batch(statements.map((statement) => db.prepare(statement)));
  log("sql", { file, statements: statements.length, migrationsRun: migrations.ran });
  await mf.dispose();
  process.exit(0);
} else if (command === "photos") {
  const [dir, prefix = ""] = args;
  if (!dir) {
    console.error("Usage: server.mjs photos <dir> [prefix]");
    await mf.dispose();
    process.exit(2);
  }
  const photos = await mf.getR2Bucket("PHOTOS");
  const uploads = photoUploads(readdirSync(dir), dir, prefix);
  for (const upload of uploads) {
    await photos.put(upload.key, readFileSync(upload.path), { httpMetadata: { contentType: upload.contentType } });
  }
  log("photos", { dir, prefix, photos: uploads.length });
  await mf.dispose();
  process.exit(0);
} else if (command === "backup") {
  await backUp("manual", args[0] ? path.resolve(args[0]) : undefined);
  await mf.dispose();
  process.exit(0);
} else if (command === "restore") {
  const file = args[0];
  if (!file) {
    console.error("Usage: server.mjs restore <file>");
    await mf.dispose();
    process.exit(2);
  }
  await restoreFrom(file);
  await mf.dispose();
  process.exit(0);
} else if (command !== "serve") {
  console.error(`Unknown command "${command}". Commands: serve, sql <file>, photos <dir> [prefix], backup [file], restore <file>.`);
  await mf.dispose();
  process.exit(2);
}

// Miniflare doesn't schedule cron triggers, so the photo sweep runs on a timer here.
const worker = await mf.getWorker();
const stopCron = startCronTimers(built.triggers?.crons ?? [], async (cron) => {
  await worker.scheduled({ cron });
  log("scheduled", { cron });
});
const stopBackups = backups.schedule
  ? startCronTimers([backups.schedule], async () => {
      await exclusive(() => backUp("auto"));
      const removed = pruneBackups(backups.dir, backups.keep);
      if (removed.length > 0) log("backups-pruned", { removed });
    }, (error) => log(error instanceof BusyError ? "backup-skipped" : "backup-failed", { error: String(error?.message ?? error) }))
  : () => {};

log("ready", {
  version,
  port: settings.port,
  backups: backups.schedule ? { schedule: backups.schedule, keep: backups.keep, dir: backups.dir } : "off",
  migrationsRun: migrations.ran,
  migrations: migrations.total,
  bootMs: Date.now() - startedAt,
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    stopCron();
    stopBackups();
    await mf.dispose();
    process.exit(0);
  });
}
