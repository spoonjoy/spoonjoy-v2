// Self-hosted Spoonjoy: serves the production Worker build (build/server, the bundle
// `wrangler deploy` ships) in Cloudflare's workerd through Miniflare, with the database, photos
// and cook sessions kept in one data folder. Nothing in app/ or workers/ changes for it.
//
//   node self-host/server.mjs             serve on PORT (8080), migrating the database first
//   node self-host/server.mjs sql <file>  run a SQL file (or - for stdin) against the database, with
//                                         the server stopped; the file runs whole or not at all
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Miniflare } from "miniflare";
import { miniflareOptions, settingsFromEnv } from "./config.mjs";
import { startCronTimers } from "./cron.mjs";
import { applyMigrations, migrationFiles, splitSql } from "./migrations.mjs";

const startedAt = Date.now();
const [command = "serve", ...args] = process.argv.slice(2);
const settings = settingsFromEnv(process.env);
const { appDir, dataDir } = settings;
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
  version: process.env.SPOONJOY_VERSION ?? "dev",
  serverAssetFiles: readdirSync(path.join(appDir, "build/server/assets")),
});
if (command !== "serve") options.host = "127.0.0.1";

const mf = new Miniflare(options);
await mf.ready;

const db = await mf.getD1Database("DB");
const migrations = await applyMigrations(db, migrationFiles(path.join(appDir, "migrations")));

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
} else if (command !== "serve") {
  console.error(`Unknown command "${command}". Commands: serve, sql <file>.`);
  await mf.dispose();
  process.exit(2);
}

// Miniflare doesn't schedule cron triggers, so the photo sweep runs on a timer here.
const worker = await mf.getWorker();
const stopCron = startCronTimers(built.triggers?.crons ?? [], async (cron) => {
  await worker.scheduled({ cron });
  log("scheduled", { cron });
});

log("ready", {
  version: options.bindings.CF_VERSION_METADATA.id,
  port: settings.port,
  migrationsRun: migrations.ran,
  migrations: migrations.total,
  bootMs: Date.now() - startedAt,
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    stopCron();
    await mf.dispose();
    process.exit(0);
  });
}
