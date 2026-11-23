// D1's LIKE and GLOB for the test databases. The same approach as the move-in lane's 23702b4b
// (arimendelow/move-in-job), in a file of its own until that lands.
import Database from "better-sqlite3";

/** D1 refuses a LIKE pattern longer than this (https://developers.cloudflare.com/d1/platform/limits/). */
export const D1_LIKE_PATTERN_BYTES = 50;

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const foldAscii = (text: string) => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/**
 * SQLite's LIKE, but refusing a pattern over D1's limit with D1's error, so a query that fails on D1 fails here too.
 * Case is folded for ASCII letters only, as SQLite does.
 */
export function d1Like(pattern: unknown, value: unknown, escape?: unknown): number | null {
  if (pattern === null || value === null) return null;
  const text = String(pattern);
  if (Buffer.byteLength(text) > D1_LIKE_PATTERN_BYTES) throw new Error("LIKE or GLOB pattern too complex");
  // By character, not UTF-16 unit, so _ stands for one character as in SQLite.
  const chars = Array.from(text);
  let source = "";
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    if (escape !== undefined && char === escape) source += escapeRegex(foldAscii(chars[++index] ?? ""));
    else if (char === "%") source += "[\\s\\S]*";
    else if (char === "_") source += "[\\s\\S]";
    else source += escapeRegex(foldAscii(char));
  }
  return new RegExp(`^${source}$`, "u").test(foldAscii(String(value))) ? 1 : 0;
}

// SQLite's own GLOB, on a connection that keeps the built-in one.
let builtIn: Database.Database | undefined;

/** SQLite's GLOB, but refusing a pattern over D1's limit with D1's error, as D1's limit covers GLOB too. */
export function d1Glob(pattern: unknown, value: unknown): number | null {
  if (pattern === null || value === null) return null;
  const text = String(pattern);
  if (Buffer.byteLength(text) > D1_LIKE_PATTERN_BYTES) throw new Error("LIKE or GLOB pattern too complex");
  builtIn ??= new Database(":memory:");
  return (builtIn.prepare("SELECT ? GLOB ? AS hit").get(String(value), text) as { hit: number }).hit;
}

/** Make this connection's LIKE and GLOB refuse a pattern D1 would refuse. */
export function refuseLongLikePatterns(sqlite: Database.Database): void {
  sqlite.function("like", { varargs: true, deterministic: true }, (...args: unknown[]) => d1Like(args[0], args[1], args[2]));
  sqlite.function("glob", { deterministic: true }, (pattern: unknown, value: unknown) => d1Glob(pattern, value));
}
