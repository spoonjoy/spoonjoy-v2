#!/usr/bin/env node
// Strips network logs and session state from every Playwright trace under the given
// directories, in place, before the journeys report is uploaded as a public artifact.
//
// A Playwright 1.58 trace is a zip. The test runner merges each browser context's trace into
// one test-level `trace.zip` holding:
//   - `test.trace`: the runner's own step log (JSON lines);
//   - `<n>-trace.trace` (or `trace.trace`): the context's action log, DOM snapshots and
//     screencast-frame events (JSON lines). Its `context-options` event embeds the context's
//     `storageState` — the session cookies — when a journey starts signed in, and the `after`
//     event of a `storageState()` call carries the cookies as its result;
//   - `<n>-trace.network` (or `trace.network`): the HAR-style network log, including every
//     `Cookie` / `Set-Cookie` / `Authorization` header;
//   - `<n>-trace.stacks`: client-side call stacks;
//   - `resources/<sha1>[.ext]`: blobs referenced by sha1 — screencast frames, snapshot
//     resources and attachments from the `.trace` entries, and request/response bodies from
//     the `.network` entries; `resources/src@<sha1>.txt` holds the test's own source.
//
// For each trace zip this removes every `.network` entry and every resource that only the
// network log referenced, redacts cookie/storage-state values and sensitive header values in
// the remaining `.trace` events (dropping any line that is not valid JSON), and keeps the
// action log, DOM snapshots, screencast frames and sources so the trace still opens in the
// viewer. It then re-reads the written zip and fails if a network entry or an unredacted
// value is still there. Zips without a `.trace` entry are not traces and are left alone.
//
// Usage: node scripts/sanitize-journey-traces.mjs <directory> [<directory> ...]
// A directory that does not exist is skipped (a run that failed before Playwright wrote
// anything has no test-results/ or journeys-report/).
import { readFile as nodeReadFile, readdir as nodeReaddir, writeFile as nodeWriteFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";

export const REDACTED = "[redacted]";

// Object keys whose whole value is session state: a context's storage state, its cookie jar,
// and its per-origin localStorage.
const SESSION_STATE_KEYS = new Set(["storagestate", "cookies", "origins"]);

// Header names whose value is a credential, whether they appear as `{ name, value }` pairs
// or as keys of a header map.
const SENSITIVE_HEADER_NAMES = new Set(["cookie", "set-cookie", "authorization", "proxy-authorization"]);

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;
const ZIP64_SENTINEL_16 = 0xffff;
const FLAG_UTF8 = 0x0800;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const ZIP_VERSION = 20;

function findEndOfCentralDirectory(buffer) {
  const lowest = Math.max(0, buffer.length - EOCD_SIZE - MAX_COMMENT_SIZE);
  for (let offset = buffer.length - EOCD_SIZE; offset >= lowest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("not a zip archive (no end-of-central-directory record)");
}

function inflateEntry(method, compressed, name) {
  if (method === METHOD_STORED) return Buffer.from(compressed);
  if (method === METHOD_DEFLATE) return zlib.inflateRawSync(compressed);
  throw new Error(`entry "${name}" uses unsupported compression method ${method}`);
}

/**
 * Reads every entry of a (non-ZIP64) zip archive, decompressed and CRC-checked. Sizes come
 * from the central directory, so entries written with a trailing data descriptor (as
 * Playwright's zip writer does for streamed entries) read correctly.
 * @param {Buffer} buffer
 * @returns {Array<{ name: string, data: Buffer, time: number, date: number }>}
 */
export function readZip(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount === ZIP64_SENTINEL_16 || centralOffset === ZIP64_SENTINEL_32) {
    throw new Error("ZIP64 archives are not supported");
  }

  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error("corrupt zip central directory");
    const method = buffer.readUInt16LE(offset + 10);
    const time = buffer.readUInt16LE(offset + 12);
    const date = buffer.readUInt16LE(offset + 14);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if ([compressedSize, size, localOffset].includes(ZIP64_SENTINEL_32)) {
      throw new Error("ZIP64 archives are not supported");
    }
    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error(`corrupt local header for "${name}"`);
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = inflateEntry(method, buffer.subarray(dataStart, dataStart + compressedSize), name);
    if (zlib.crc32(data) !== crc) throw new Error(`CRC mismatch for "${name}"`);
    entries.push({ name, data, time, date });
  }
  return entries;
}

/**
 * Writes entries as a deflate-compressed, UTF-8-named zip archive.
 * @param {Array<{ name: string, data: Buffer, time?: number, date?: number }>} entries
 * @returns {Buffer}
 */
export function writeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = zlib.deflateRawSync(entry.data);
    const crc = zlib.crc32(entry.data);
    const time = entry.time ?? 0;
    const date = entry.date ?? 0x21;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(ZIP_VERSION, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(ZIP_VERSION, 4);
    central.writeUInt16LE(ZIP_VERSION, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(METHOD_DEFLATE, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    localParts.push(local, name, compressed);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(EOCD_SIZE);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

/**
 * Returns a copy of a parsed trace event with every session-state value and sensitive header
 * value replaced by REDACTED.
 * @param {unknown} value
 * @returns {unknown}
 */
export function redactTraceValue(value) {
  if (Array.isArray(value)) return value.map(redactTraceValue);
  if (value === null || typeof value !== "object") return value;
  const headerName = typeof value.name === "string" ? value.name.toLowerCase() : "";
  const redacted = {};
  for (const [key, child] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    if (SESSION_STATE_KEYS.has(lowerKey) || SENSITIVE_HEADER_NAMES.has(lowerKey)) {
      redacted[key] = REDACTED;
    } else if (key === "value" && SENSITIVE_HEADER_NAMES.has(headerName)) {
      redacted[key] = REDACTED;
    } else {
      redacted[key] = redactTraceValue(child);
    }
  }
  return redacted;
}

/**
 * Redacts every JSON line of a `.trace` entry; blank lines and lines that are not valid JSON
 * are dropped, since their content cannot be checked.
 * @param {string} text
 * @returns {{ text: string, droppedLines: number }}
 */
export function sanitizeTraceText(text) {
  const lines = [];
  let droppedLines = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      lines.push(JSON.stringify(redactTraceValue(JSON.parse(line))));
    } catch {
      droppedLines += 1;
    }
  }
  return { text: lines.join("\n"), droppedLines };
}

const isTraceEntry = (name) => name.endsWith(".trace");
const isNetworkEntry = (name) => name.endsWith(".network");
const isResourceEntry = (name) => name.startsWith("resources/");

/**
 * Sanitizes one trace zip. Returns null when the zip holds no `.trace` entry (not a trace).
 * @param {Buffer} buffer
 */
export function sanitizeTraceZip(buffer) {
  const entries = readZip(buffer);
  if (!entries.some((entry) => isTraceEntry(entry.name))) return null;

  let removedNetworkLogs = 0;
  let droppedLines = 0;
  const kept = [];
  for (const entry of entries) {
    if (isNetworkEntry(entry.name)) {
      removedNetworkLogs += 1;
    } else if (isTraceEntry(entry.name)) {
      const sanitized = sanitizeTraceText(entry.data.toString("utf8"));
      droppedLines += sanitized.droppedLines;
      kept.push({ ...entry, data: Buffer.from(sanitized.text, "utf8") });
    } else {
      kept.push(entry);
    }
  }

  // A resource survives only if a remaining (non-resource) entry still names it; test source
  // files are looked up by the viewer from stack frames rather than by name, so keep those.
  const references = kept
    .filter((entry) => !isResourceEntry(entry.name))
    .map((entry) => entry.data.toString("utf8"))
    .join("\n");
  let removedResources = 0;
  const output = kept.filter((entry) => {
    if (!isResourceEntry(entry.name)) return true;
    const resourceName = entry.name.slice("resources/".length);
    if (resourceName.startsWith("src@") || references.includes(resourceName)) return true;
    removedResources += 1;
    return false;
  });

  return { buffer: writeZip(output), removedNetworkLogs, removedResources, droppedLines };
}

/**
 * Lists what is still unsafe in a (re-read) trace zip: network entries, and `.trace` lines
 * that redaction would still change.
 * @param {Array<{ name: string, data: Buffer }>} entries
 * @returns {string[]}
 */
export function findTraceLeaks(entries) {
  const leaks = [];
  for (const entry of entries) {
    if (isNetworkEntry(entry.name)) leaks.push(`network log "${entry.name}" is still present`);
    if (isTraceEntry(entry.name)) {
      const text = entry.data.toString("utf8");
      if (sanitizeTraceText(text).text !== text) leaks.push(`"${entry.name}" still has unredacted content`);
    }
  }
  return leaks;
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function defaultReaddir(directory) {
  return nodeReaddir(directory, { withFileTypes: true, recursive: true });
}

/**
 * @param {string[]} argv
 * @param {{ readdir?: Function, readFile?: Function, writeFile?: Function, io?: { log: Function, error: Function }, exit?: Function }} deps
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const {
    readdir = defaultReaddir,
    readFile = nodeReadFile,
    writeFile = nodeWriteFile,
    io = console,
    exit = (code) => {
      process.exitCode = code;
    },
  } = deps;

  if (argv.length === 0) {
    io.error("Usage: sanitize-journey-traces.mjs <directory> [<directory> ...]");
    exit(1);
    return;
  }

  let failed = false;
  let sanitizedTraces = 0;
  let removedNetworkLogs = 0;
  let removedResources = 0;
  let droppedLines = 0;

  for (const directory of argv) {
    let entries;
    try {
      entries = await readdir(directory);
    } catch (error) {
      if (error.code === "ENOENT") {
        io.log(`sanitize-journey-traces: ${directory} does not exist; nothing to sanitize there.`);
      } else {
        io.error(`sanitize-journey-traces: cannot read directory "${directory}": ${errorMessage(error)}`);
        failed = true;
      }
      continue;
    }

    const zips = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".zip"))
      .map((entry) => path.join(entry.parentPath ?? entry.path ?? directory, entry.name));

    for (const file of zips) {
      try {
        const result = sanitizeTraceZip(await readFile(file));
        if (!result) continue;
        await writeFile(file, result.buffer);
        const leaks = findTraceLeaks(readZip(await readFile(file)));
        for (const leak of leaks) io.error(`${file}: ${leak}`);
        if (leaks.length > 0) failed = true;
        sanitizedTraces += 1;
        removedNetworkLogs += result.removedNetworkLogs;
        removedResources += result.removedResources;
        droppedLines += result.droppedLines;
      } catch (error) {
        io.error(`${file}: ${errorMessage(error)}`);
        failed = true;
      }
    }
  }

  io.log(
    `Sanitized ${sanitizedTraces} trace(s): removed ${removedNetworkLogs} network log(s) and ${removedResources} network resource(s), dropped ${droppedLines} unparseable trace line(s).`,
  );
  if (failed) exit(1);
}

export function isCliEntry(moduleUrl, argv1 = process.argv[1]) {
  return typeof argv1 === "string" && moduleUrl === pathToFileURL(argv1).href;
}

export function defaultCliErrorHandler(error, io = console) {
  io.error(errorMessage(error));
  process.exitCode = 1;
}

export function runCliIfEntry({
  moduleUrl = import.meta.url,
  argv1 = process.argv[1],
  runMain = main,
  onError = defaultCliErrorHandler,
} = {}) {
  if (!isCliEntry(moduleUrl, argv1)) return false;
  runMain(process.argv.slice(2)).catch(onError);
  return true;
}

runCliIfEntry();
