// Backups of a self-hosted kitchen: the whole database and every photo, in one .tar.gz file that a
// fresh server restores (`server.mjs backup` and `server.mjs restore`, and the scheduled backups
// `server.mjs` makes while it serves). The database goes in row by row, not as the SQLite file, so a
// backup made while the server runs is consistent (it is read in one transaction) and restores
// into a newer image, whose migrations then bring it up to date.
//
// Left out: the search index (an FTS5 table the app rebuilds on the first search after a restore,
// as scripts/d1-logical-export.mjs explains), cook sessions in progress, and the session secret,
// so a backup can't sign anyone in and a new server signs everyone out once.
import { createReadStream, createWriteStream, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

export const BACKUP_FORMAT = 1;
const MANIFEST = "spoonjoy-backup.json";
const DATABASE = "database.json";
const PHOTOS = "photos.json";
const FTS_SHADOW_SUFFIXES = ["_data", "_idx", "_content", "_docsize", "_config"];
const BACKUP_FILE = /^spoonjoy-(auto|manual|before-restore)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)\.tar\.gz$/;

// ---- The archive: a plain ustar tar, gzipped, written and read as a stream. ----

const BLOCK = 512;

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

export function tarHeader(name, size, mtimeSeconds) {
  const nameBytes = Buffer.from(name, "utf8");
  if (nameBytes.length > 100) throw new Error(`The backup entry name "${name}" is longer than 100 bytes.`);
  const header = Buffer.alloc(BLOCK);
  nameBytes.copy(header, 0);
  header.write(octal(0o644, 8), 100, "ascii");
  header.write(octal(0, 8), 108, "ascii");
  header.write(octal(0, 8), 116, "ascii");
  header.write(octal(size, 12), 124, "ascii");
  header.write(octal(mtimeSeconds, 12), 136, "ascii");
  header.write("        ", 148, "ascii");
  header.write("0", 156, "ascii");
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return header;
}

function padding(size) {
  return Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);
}

/**
 * Writes `entries` (an async iterable of `{ name, data }`) to `file` as a .tar.gz. It writes to a
 * temporary file beside it and renames it at the end, so a half-written backup never has the name.
 */
export async function writeTarGz(file, entries, now = new Date()) {
  const mtime = Math.floor(now.getTime() / 1000);
  const partial = `${file}.partial`;
  async function* blocks() {
    for await (const { name, data } of entries) {
      const bytes = Buffer.from(data);
      yield tarHeader(name, bytes.length, mtime);
      yield bytes;
      yield padding(bytes.length);
    }
    yield Buffer.alloc(BLOCK * 2);
  }
  try {
    await pipeline(blocks, createGzip(), createWriteStream(partial, { mode: 0o600 }));
  } catch (error) {
    try {
      unlinkSync(partial);
    } catch {
      // Nothing was written.
    }
    throw error;
  }
  renameSync(partial, file);
}

function readOctal(header, start, width) {
  return Number.parseInt(header.subarray(start, start + width).toString("ascii").replace(/\0.*$/s, "").trim(), 8);
}

function checkHeader(header) {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
  if (sum !== readOctal(header, 148, 8)) throw new Error("The backup file is damaged: a tar header's checksum doesn't match.");
}

/** Reads a .tar.gz that `writeTarGz` wrote, yielding each file's `{ name, data }` in order. */
export async function* readTarGz(file) {
  const chunks = [];
  let buffered = 0;
  const input = createReadStream(file).pipe(createGunzip())[Symbol.asyncIterator]();
  const take = async (size) => {
    while (buffered < size) {
      const { value, done } = await input.next();
      if (done) throw new Error("The backup file ends early: it may still be copying, or be damaged.");
      chunks.push(value);
      buffered += value.length;
    }
    const all = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
    chunks.length = 0;
    const out = all.subarray(0, size);
    if (all.length > size) chunks.push(all.subarray(size));
    buffered = all.length - size;
    return out;
  };
  for (;;) {
    const header = await take(BLOCK);
    if (header.every((byte) => byte === 0)) return;
    checkHeader(header);
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const size = readOctal(header, 124, 12);
    const data = Buffer.from(await take(size));
    await take(padding(size).length);
    yield { name, data };
  }
}

// ---- What goes in it. ----

const quote = (name) => `"${name.replaceAll('"', '""')}"`;

function isVirtualTable(entry) {
  return entry.type === "table" && /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(entry.sql);
}

/**
 * The parts of a database's schema (sqlite_master rows) a backup keeps: its tables with their rows,
 * the full-text search tables created empty (their own `_data`, `_idx` and other shadow tables come
 * with them), and the indexes and triggers. D1's internal `_cf_` tables and SQLite's own stay out.
 */
export function planSchema(schema) {
  const own = schema.filter((entry) => entry.sql && !entry.name.startsWith("_cf_") && !entry.name.startsWith("sqlite_"));
  const virtual = own.filter(isVirtualTable);
  const isShadow = (name) => virtual.some((table) => FTS_SHADOW_SUFFIXES.some((suffix) => name === `${table.name}${suffix}`));
  const tables = own.filter((entry) => entry.type === "table" && !isVirtualTable(entry) && !isShadow(entry.name));
  return {
    tables: tableOrder(tables),
    virtualTables: virtual,
    indexes: own.filter((entry) => entry.type === "index"),
    triggers: own.filter((entry) => entry.type === "trigger"),
    views: own.filter((entry) => entry.type === "view"),
  };
}

/** Tables ordered so each comes after the tables its foreign keys reference, where that's possible. */
export function tableOrder(tables) {
  const names = tables.map((table) => table.name);
  const parents = new Map(tables.map((table) => [table.name, new Set(
    [...table.sql.matchAll(/REFERENCES\s+["'`[]?([A-Za-z0-9_]+)["'`\]]?/gi)]
      .map((match) => match[1])
      .filter((parent) => parent !== table.name && names.includes(parent)),
  )]));
  const ordered = [];
  while (ordered.length < tables.length) {
    const done = new Set(ordered.map((table) => table.name));
    const next = tables.find((table) => !done.has(table.name) && [...parents.get(table.name)].every((parent) => done.has(parent)))
      ?? tables.find((table) => !done.has(table.name));
    ordered.push(next);
  }
  return ordered;
}

// D1 hands a BLOB back as an array of byte values (Miniflare) or as bytes; JSON keeps it as base64.
function encodeValue(value) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return { $blob: Buffer.from(Uint8Array.from(value)).toString("base64") };
  return value;
}

function decodeValue(value) {
  if (value && typeof value === "object" && typeof value.$blob === "string") {
    return new Uint8Array(Buffer.from(value.$blob, "base64"));
  }
  return value;
}

const SCHEMA_SQL = 'SELECT "type", "name", "tbl_name", "sql" FROM sqlite_master ORDER BY rowid';

/** The database's schema and rows, read in one D1 batch, which is one transaction. */
export async function readDatabase(db) {
  const schema = (await db.prepare(SCHEMA_SQL).all()).results;
  const plan = planSchema(schema);
  const results = await db.batch([
    db.prepare(SCHEMA_SQL),
    ...plan.tables.map((table) => db.prepare(`SELECT * FROM ${quote(table.name)}`)),
  ]);
  if (JSON.stringify(results[0].results) !== JSON.stringify(schema)) {
    throw new Error("The database schema changed while the backup was starting; back up again.");
  }
  const tables = plan.tables.map((table, index) => {
    const rows = results[index + 1].results;
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { name: table.name, columns, rows: rows.map((row) => columns.map((column) => encodeValue(row[column]))) };
  });
  return { schema, tables };
}

/** Every photo in the store, as `{ key, contentType, customMetadata }`, following the list's pages. */
export async function listPhotos(photos) {
  const out = [];
  let cursor;
  do {
    const page = await photos.list({ cursor, include: ["httpMetadata", "customMetadata"] });
    for (const object of page.objects) {
      out.push({
        key: object.key,
        size: object.size,
        contentType: object.httpMetadata?.contentType ?? null,
        customMetadata: object.customMetadata ?? {},
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

const photoEntry = (index) => `photos/${String(index + 1).padStart(6, "0")}`;

/**
 * Writes a backup of the database and photo store to `file`, and says what went in. Photos are
 * read one at a time as they're written, so a large kitchen doesn't sit in memory.
 */
export async function createBackup({ db, photos, file, version, now = new Date() }) {
  const database = await readDatabase(db);
  const photoList = await listPhotos(photos);
  const migrations = database.tables.find((table) => table.name === "d1_migrations");
  const nameColumn = migrations?.columns.indexOf("name") ?? -1;
  const manifest = {
    format: BACKUP_FORMAT,
    app: "spoonjoy",
    version,
    createdAt: now.toISOString(),
    migrations: nameColumn === -1 ? [] : migrations.rows.map((row) => row[nameColumn]),
    tables: database.tables.length,
    rows: database.tables.reduce((sum, table) => sum + table.rows.length, 0),
    photos: photoList.length,
    photoBytes: photoList.reduce((sum, photo) => sum + photo.size, 0),
  };
  async function* entries() {
    yield { name: MANIFEST, data: JSON.stringify(manifest, null, 2) };
    yield { name: DATABASE, data: JSON.stringify(database) };
    yield { name: PHOTOS, data: JSON.stringify(photoList.map((photo, index) => ({ ...photo, file: photoEntry(index) }))) };
    for (const [index, photo] of photoList.entries()) {
      const object = await photos.get(photo.key);
      if (!object) throw new Error(`The photo ${photo.key} went missing during the backup; back up again.`);
      yield { name: photoEntry(index), data: new Uint8Array(await object.arrayBuffer()) };
    }
  }
  await writeTarGz(file, entries(), now);
  return { file, ...manifest };
}

/**
 * The statements that replace the database with the backup's, as one D1 batch: drop what's there,
 * create the backup's tables, indexes and search tables, put the rows back parents first, then the
 * triggers and views. Foreign keys are checked once, when the batch commits.
 */
export function restoreStatements(current, backup) {
  const now = planSchema(current);
  const then = planSchema(backup.schema);
  const statements = [{ sql: "PRAGMA defer_foreign_keys = on" }];
  for (const entry of [...now.triggers, ...now.views]) {
    statements.push({ sql: `DROP ${entry.type.toUpperCase()} IF EXISTS ${quote(entry.name)}` });
  }
  // Children before parents: dropping a parent first empties it, and the ON DELETE actions that
  // sets off in a child would look up the child's other parents, which may be gone already.
  for (const table of [...now.virtualTables, ...[...now.tables].reverse()]) {
    statements.push({ sql: `DROP TABLE IF EXISTS ${quote(table.name)}` });
  }
  for (const entry of [...then.tables, ...then.indexes, ...then.virtualTables]) statements.push({ sql: entry.sql });
  const byName = new Map(backup.tables.map((table) => [table.name, table]));
  for (const table of then.tables) {
    const saved = byName.get(table.name);
    const columns = saved.columns.map(quote).join(", ");
    const marks = saved.columns.map(() => "?").join(", ");
    for (const row of saved.rows) {
      statements.push({ sql: `INSERT INTO ${quote(table.name)} (${columns}) VALUES (${marks})`, params: row.map(decodeValue) });
    }
  }
  for (const entry of [...then.triggers, ...then.views]) statements.push({ sql: entry.sql });
  return statements;
}

async function readJson(entry, expected) {
  if (!entry || entry.name !== expected) {
    throw new Error(`This isn't a Spoonjoy backup: it should have ${expected} next, not ${entry?.name ?? "nothing"}.`);
  }
  return JSON.parse(entry.data.toString("utf8"));
}

/**
 * Replaces the database and photo store with a backup's. `knownMigrations` are the migrations this
 * image has: a backup from a newer Spoonjoy, with migrations this one lacks, is refused before
 * anything changes. The caller applies this image's migrations afterwards.
 */
export async function restoreBackup({ db, photos, file, knownMigrations }) {
  const entries = readTarGz(file)[Symbol.asyncIterator]();
  const next = async () => (await entries.next()).value;
  const manifest = await readJson(await next(), MANIFEST);
  if (manifest.app !== "spoonjoy" || manifest.format !== BACKUP_FORMAT) {
    throw new Error(`This backup's format (${manifest.app} ${manifest.format}) isn't one this Spoonjoy reads.`);
  }
  const known = new Set(knownMigrations);
  const newer = manifest.migrations.filter((name) => !known.has(name));
  if (newer.length > 0) {
    throw new Error(`This backup comes from a newer Spoonjoy (${manifest.version}): update this server's image first. It doesn't know ${newer.join(", ")}.`);
  }
  const backup = await readJson(await next(), DATABASE);
  const photoList = await readJson(await next(), PHOTOS);

  const current = (await db.prepare(SCHEMA_SQL).all()).results;
  const statements = restoreStatements(current, backup);
  await db.batch(statements.map(({ sql, params }) => (params ? db.prepare(sql).bind(...params) : db.prepare(sql))));

  for (const photo of await listPhotos(photos)) await photos.delete(photo.key);
  const byFile = new Map(photoList.map((photo) => [photo.file, photo]));
  let restoredPhotos = 0;
  for (let entry = await next(); entry; entry = await next()) {
    const photo = byFile.get(entry.name);
    if (!photo) throw new Error(`The backup has a file it doesn't list: ${entry.name}.`);
    await photos.put(photo.key, entry.data, {
      ...(photo.contentType ? { httpMetadata: { contentType: photo.contentType } } : {}),
      customMetadata: photo.customMetadata,
    });
    restoredPhotos += 1;
  }
  if (restoredPhotos !== photoList.length) {
    throw new Error(`The backup lists ${photoList.length} photos but holds ${restoredPhotos}.`);
  }
  return { file, version: manifest.version, createdAt: manifest.createdAt, rows: manifest.rows, photos: restoredPhotos };
}

// ---- The backups folder. ----

/** The file name for a backup made at `now`: `kind` is auto (scheduled), manual or before-restore. */
export function backupFileName(kind, now = new Date()) {
  return `spoonjoy-${kind}-${now.toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-")}.tar.gz`;
}

/** The backups in a folder, newest first, as `{ name, kind, size, createdAt }`. */
export function listBackups(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => ({ name, match: BACKUP_FILE.exec(name) }))
    .filter(({ match }) => match)
    .map(({ name, match }) => ({
      name,
      kind: match[1],
      size: statSync(path.join(dir, name)).size,
      createdAt: match[2].replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, "T$1:$2:$3Z"),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
}

/** Deletes the oldest scheduled backups beyond `keep`, and names what it deleted. */
export function pruneBackups(dir, keep) {
  const removed = listBackups(dir).filter((backup) => backup.kind === "auto").slice(keep).map((backup) => backup.name);
  for (const name of removed) unlinkSync(path.join(dir, name));
  return removed;
}
