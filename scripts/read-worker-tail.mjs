#!/usr/bin/env node
// Reads the raw files the Journeys workflow's two Worker tails wrote, one per connection
// (.worker-tail/tail-<tail>-<connection>.json, each a `wrangler tail --format json` stream of
// pretty-printed JSON values), and writes every invocation once, oldest first, one JSON line each,
// for scripts/summarize-worker-tail.jq. Both tails see the same invocations, so a copy is dropped
// when another with the same content was already kept.
//
// It prints counts only, as JSON, so the log can say what each tail delivered:
//   { tails: { <tail>: { connections, events, overloadNotices, unreadableLines, cutOff } },
//     eventsSeen, eventsKept }
// overloadNotices counts the tail's own "Tail is currently in sampling mode" messages, sent when
// Cloudflare drops events from that tail; they are not invocations and are not written.
// unreadableLines counts text that is not part of a JSON value, which is skipped instead of ending
// the read; cutOff counts connections whose last value was cut off by the stop or a drop.
//
// Usage: node scripts/read-worker-tail.mjs <events.ndjson> <tail file>...
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

/** The tail and connection a file belongs to, from its name; a name without a tail is tail "a". */
export function tailOfFile(file) {
  const match = /^tail-(?:([a-z])-)?(\d+)\.json$/.exec(basename(file));
  return match ? { tail: match[1] ?? "a", connection: Number(match[2]) } : null;
}

/**
 * Splits a stream of top-level JSON values, each either on one line or pretty-printed from a "{"
 * line to a "}" line, into the values, the count of lines that belong to none, and whether the
 * stream ended inside a value.
 */
export function readJsonStream(text) {
  const values = [];
  let unreadableLines = 0;
  let buffer = null;
  for (const line of text.split("\n")) {
    if (buffer === null) {
      if (line.startsWith("{")) {
        const single = parseOrNull(line);
        if (single !== null) values.push(single);
        else buffer = [line];
      } else if (line.trim() !== "") {
        unreadableLines += 1;
      }
      continue;
    }
    // A value starts only at column 0, so a "{" there means the open value was cut off.
    if (line.startsWith("{")) {
      unreadableLines += buffer.length;
      const single = parseOrNull(line);
      if (single !== null) {
        values.push(single);
        buffer = null;
      } else {
        buffer = [line];
      }
      continue;
    }
    buffer.push(line);
    if (line.startsWith("}")) {
      const value = parseOrNull(buffer.join("\n"));
      if (value !== null) values.push(value);
      else unreadableLines += buffer.length;
      buffer = null;
    }
  }
  return { values, unreadableLines, cutOff: buffer !== null };
}

function parseOrNull(text) {
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** A message from the tail about itself ({ message, type }, bare or as the event), not an invocation. */
export function tailNotice(value) {
  const info = typeof value.message === "string" && typeof value.type === "string"
    ? value
    : value.event && typeof value.event === "object" && typeof value.event.message === "string" &&
        typeof value.event.type === "string" && !("request" in value.event)
      ? value.event
      : null;
  return info ? info.type : null;
}

// The same invocation from either tail, whatever its key order.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Reads the files ({ name, text }) into the invocations, each once and oldest first, and the counts. */
export function readTails(files) {
  const tails = {};
  const seen = new Set();
  const kept = [];
  let eventsSeen = 0;
  for (const { name, text } of files) {
    const owner = tailOfFile(name);
    if (!owner) continue;
    const stats = (tails[owner.tail] ??= { connections: 0, events: 0, overloadNotices: 0, unreadableLines: 0, cutOff: 0 });
    stats.connections += 1;
    const { values, unreadableLines, cutOff } = readJsonStream(text);
    stats.unreadableLines += unreadableLines;
    if (cutOff) stats.cutOff += 1;
    for (const value of values) {
      const notice = tailNotice(value);
      if (notice !== null) {
        if (notice === "overload") stats.overloadNotices += 1;
        continue;
      }
      stats.events += 1;
      eventsSeen += 1;
      const key = canonical(value);
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(value);
    }
  }
  const time = (value) => (typeof value.eventTimestamp === "number" ? value.eventTimestamp : 0);
  kept.sort((left, right) => time(left) - time(right));
  return { events: kept, stats: { tails, eventsSeen, eventsKept: kept.length } };
}

export function main(argv, { read = (path) => readFileSync(path, "utf8"), exists = existsSync, write = writeFileSync, print = console.log } = {}) {
  const [output, ...paths] = argv;
  if (!output) throw new Error("Usage: read-worker-tail.mjs <events.ndjson> <tail file>...");
  const files = paths.filter((path) => exists(path)).map((path) => ({ name: path, text: read(path) }));
  const { events, stats } = readTails(files);
  write(output, events.map((event) => `${JSON.stringify(event)}\n`).join(""));
  print(JSON.stringify(stats));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
