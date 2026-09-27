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
// Typed passwords. Playwright 1.58 records every <input>'s live value in trace DOM snapshots
// (snapshotterInjected.js writes it as the `__playwright_value_` attribute of each INPUT and
// TEXTAREA node, password inputs included), and on failure writes an ARIA page snapshot
// (error-context.md) that prints a textbox's value, including a password input's, as
// `- textbox "Password" [ref=e5]: <value>`. That page snapshot is also attached to the test,
// so it is copied into the trace zip as a `resources/<sha1>` entry and into the HTML report as
// `data/<sha1>.md`. This script therefore also:
//   - redacts the value of every password input (by type, password autocomplete, or a name/id
//     naming a password) in every `frame-snapshot` event;
//   - redacts the value of every textbox whose accessible name names a password, passcode,
//     secret, token or credential, in every text resource inside a trace zip and in every
//     .md/.txt/.yml/.yaml file under the given directories (error-context.md, report copies);
// and fails if a re-read file still has such a value.
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

// An <input> that holds a password: type=password, a password or one-time-code autocomplete
// hint, or a name/id that says so.
const SECRET_AUTOCOMPLETE = /(?:current|new)-password|one-time-code/i;
const SECRET_INPUT_NAME = /passw(?:or)?d|passcode/i;
// Snapshot attributes that carry an input's value: the live value, and the markup's value=.
const SNAPSHOT_VALUE_ATTRIBUTES = ["__playwright_value_", "value"];

// Page snapshots (Playwright 1.58's renderAriaTree) print a textbox's value either inline,
//   - textbox "Password" [ref=e5]: <value>
// or, when the textbox has props such as a placeholder, on a child line:
//   - textbox "Password" [ref=e5]:
//     - /placeholder: ••••
//     - text: <value>
// and YAML single-quotes the whole key when the name holds ": ", " #" and the like:
//   - 'textbox "Password: 8+ characters" [ref=e5]': <value>
// A textbox is secret when its accessible name names a password, passcode, secret, token or
// credential.
const SNAPSHOT_ITEM_LINE = /^(\s*)- (.*)$/;
const TEXTBOX_KEY = /^textbox "((?:[^"\\]|\\.)*)"(?:\s*\[[^\]]*\])*$/;
const SECRET_TEXTBOX_NAME = /passw(?:or)?d|passcode|secret|token|credential/i;
const TEXT_CHILD_LINE = /^(\s*- text):[ \t]*\S/;

// Text files the report and test results can hold a page snapshot in.
const TEXT_FILE_PATTERN = /\.(?:md|txt|ya?ml)$/i;

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

function isSnapshotAttributes(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSecretInput(nodeName, attributes) {
  if (nodeName.toUpperCase() !== "INPUT") return false;
  const attribute = (name) => (typeof attributes[name] === "string" ? attributes[name] : "");
  return (
    attribute("type").toLowerCase() === "password" ||
    SECRET_AUTOCOMPLETE.test(attribute("autocomplete")) ||
    SECRET_INPUT_NAME.test(attribute("name")) ||
    SECRET_INPUT_NAME.test(attribute("id"))
  );
}

/**
 * Returns a copy of a trace DOM-snapshot node with every password input's value redacted. A
 * node is `[nodeName, attributes?, ...children]`; a child is a node, a text string, or a
 * reference to a node of an earlier snapshot (`[[snapshotsAgo, nodeIndex]]`), which is left as
 * it is, since the node it points to is redacted where it was first recorded.
 * @param {unknown} node
 * @returns {unknown}
 */
export function redactSnapshotNode(node) {
  if (!Array.isArray(node) || typeof node[0] !== "string") return node;
  const [nodeName, ...rest] = node;
  return [
    nodeName,
    ...rest.map((part, index) => {
      if (index !== 0 || !isSnapshotAttributes(part)) return redactSnapshotNode(part);
      if (!isSecretInput(nodeName, part)) return part;
      const redacted = { ...part };
      for (const name of SNAPSHOT_VALUE_ATTRIBUTES) {
        if (typeof redacted[name] === "string" && redacted[name] !== "") redacted[name] = REDACTED;
      }
      return redacted;
    }),
  ];
}

// Splits a page-snapshot item ("- <key>: <value>", "- <key>:" or "- <key>") into its key text
// (unquoted if YAML quoted it), the raw key as written, and what follows the key. Returns undefined
// for a line that is not an item or whose quoted key never closes.
function splitSnapshotItem(body) {
  if (body.startsWith("'")) {
    // A doubled quote ('') inside a single-quoted YAML key is an escaped quote.
    let close = 1;
    while (close < body.length && !(body[close] === "'" && body[close + 1] !== "'")) {
      close += body[close] === "'" ? 2 : 1;
    }
    if (close >= body.length) return undefined;
    return {
      key: body.slice(1, close).replace(/''/g, "'"),
      rawKey: body.slice(0, close + 1),
      rest: body.slice(close + 1),
    };
  }
  const colon = body.search(/:(?:[ \t]|$)/);
  if (colon === -1) return { key: body, rawKey: body, rest: "" };
  return { key: body.slice(0, colon), rawKey: body.slice(0, colon), rest: body.slice(colon) };
}

function isSecretTextboxKey(key) {
  const match = TEXTBOX_KEY.exec(key);
  return Boolean(match && SECRET_TEXTBOX_NAME.test(match[1]));
}

/**
 * Redacts the value of every textbox whose accessible name names a password or other secret in
 * ARIA page-snapshot text (error-context.md and its copies), whether the value is inline or on a
 * child "- text:" line, and whether or not YAML quoted the key. Idempotent.
 * @param {string} text
 * @returns {string}
 */
export function redactPageSnapshotText(text) {
  const lines = text.split("\n");
  // Indent of a secret textbox whose value sits on child lines, while inside its block.
  let secretBlockIndent = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const item = SNAPSHOT_ITEM_LINE.exec(line);
    const indent = item ? item[1].length : null;

    if (secretBlockIndent !== null) {
      if (line.trim() === "") continue;
      if (indent !== null && indent > secretBlockIndent) {
        const child = TEXT_CHILD_LINE.exec(line);
        if (child) lines[index] = `${child[1]}: ${REDACTED}`;
        continue;
      }
      secretBlockIndent = null;
    }

    if (!item) continue;
    const parts = splitSnapshotItem(item[2]);
    if (!parts || !isSecretTextboxKey(parts.key)) continue;
    const value = parts.rest.replace(/^:[ \t]*/, "");
    if (parts.rest.startsWith(":") && value !== "") {
      lines[index] = `${item[1]}- ${parts.rawKey}: ${REDACTED}`;
    } else if (parts.rest.startsWith(":")) {
      secretBlockIndent = indent;
    }
  }
  return lines.join("\n");
}

// Session state and headers everywhere (redactTraceValue), and password inputs in DOM snapshots.
function redactTraceEvent(event) {
  const redacted = redactTraceValue(event);
  if (redacted?.type === "frame-snapshot" && isSnapshotAttributes(redacted.snapshot)) {
    redacted.snapshot = { ...redacted.snapshot, html: redactSnapshotNode(redacted.snapshot.html) };
  }
  return redacted;
}

// A resource's bytes as text when they are valid UTF-8 (a page snapshot, a stylesheet), or
// undefined for binary data (screencast frames, images).
function resourceText(data) {
  const decoded = data.toString("utf8");
  return Buffer.from(decoded, "utf8").equals(data) ? decoded : undefined;
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
      lines.push(JSON.stringify(redactTraceEvent(JSON.parse(line))));
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
    } else if (isResourceEntry(entry.name)) {
      // An attached page snapshot (error-context) keeps its sha1 name: the viewer looks it up by
      // the name the trace events use, not by hashing the content.
      const resource = resourceText(entry.data);
      const redacted = resource === undefined ? undefined : redactPageSnapshotText(resource);
      kept.push(redacted === undefined || redacted === resource ? entry : { ...entry, data: Buffer.from(redacted, "utf8") });
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
 * Lists what is still unsafe in a (re-read) trace zip: network entries, `.trace` lines that
 * redaction would still change, and text resources with an unredacted password textbox.
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
    if (isResourceEntry(entry.name)) {
      const resource = resourceText(entry.data);
      if (resource !== undefined && redactPageSnapshotText(resource) !== resource) {
        leaks.push(`"${entry.name}" still has an unredacted password value`);
      }
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
  let redactedTextFiles = 0;

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

    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath ?? entry.path ?? directory, entry.name));
    const zips = files.filter((file) => file.endsWith(".zip"));
    const textFiles = files.filter((file) => TEXT_FILE_PATTERN.test(file));

    for (const file of textFiles) {
      try {
        const original = (await readFile(file)).toString("utf8");
        const redacted = redactPageSnapshotText(original);
        if (redacted === original) continue;
        await writeFile(file, redacted);
        const reread = (await readFile(file)).toString("utf8");
        if (redactPageSnapshotText(reread) !== reread) {
          io.error(`${file}: still has an unredacted password value`);
          failed = true;
        }
        redactedTextFiles += 1;
      } catch (error) {
        io.error(`${file}: ${errorMessage(error)}`);
        failed = true;
      }
    }

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
  io.log(`Redacted password values in ${redactedTextFiles} page snapshot file(s).`);
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
