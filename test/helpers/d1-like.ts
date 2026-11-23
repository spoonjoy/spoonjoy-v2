// D1's LIKE for the test databases. The same approach as the move-in lane's 23702b4b
// (arimendelow/move-in-job), in a file of its own until that lands.
import type Database from "better-sqlite3";

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
  let source = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (escape !== undefined && char === escape) source += escapeRegex(foldAscii(text[++index] ?? ""));
    else if (char === "%") source += "[\\s\\S]*";
    else if (char === "_") source += "[\\s\\S]";
    else source += escapeRegex(foldAscii(char));
  }
  return new RegExp(`^${source}$`).test(foldAscii(String(value))) ? 1 : 0;
}

/** Make this connection's LIKE refuse a pattern D1 would refuse. */
export function refuseLongLikePatterns(sqlite: Database.Database): void {
  sqlite.function("like", { varargs: true, deterministic: true }, (...args: unknown[]) => d1Like(args[0], args[1], args[2]));
}
