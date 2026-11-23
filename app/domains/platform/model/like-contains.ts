// D1 refuses a LIKE pattern over 50 bytes ("LIKE or GLOB pattern too complex",
// https://developers.cloudflare.com/d1/platform/limits/). Prisma's `contains` sends LIKE '%text%', so
// text over 48 bytes fails there. A search sends a prefix that fits, then checks the full text in code.

/** The most bytes of text a `contains` filter can carry: D1's 50, less the two % around it. */
export const LIKE_CONTAINS_MAX_BYTES = 48;

const encoder = new TextEncoder();
const foldAscii = (text: string) => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/** The longest start of `text` that fits in LIKE_CONTAINS_MAX_BYTES of UTF-8, never splitting a character. */
export function likeContainsPrefix(text: string): string {
  let bytes = 0;
  let prefix = "";
  for (const char of text) {
    bytes += encoder.encode(char).length;
    if (bytes > LIKE_CONTAINS_MAX_BYTES) break;
    prefix += char;
  }
  return prefix;
}

/** Whether `text` holds `query` as LIKE '%query%' would match it: ASCII letters in either case, other characters exactly. */
export function likeContains(text: string | null | undefined, query: string): boolean {
  return text != null && foldAscii(text).includes(foldAscii(query));
}

export interface LikeContainsSearch {
  /** The text to give Prisma's `contains`. */
  pattern: string;
  /**
   * True when `pattern` is only a prefix of the query. Then the database returns a superset: fetch
   * without a row limit, keep the rows `matches` accepts, and apply the limit after.
   */
  narrowed: boolean;
  /** Whether any of the texts holds the full query, as LIKE would match it. */
  matches(...texts: Array<string | null | undefined>): boolean;
}

/** How to search for `query` with `contains` within D1's LIKE limit. */
export function likeContainsSearch(query: string): LikeContainsSearch {
  const pattern = likeContainsPrefix(query);
  return {
    pattern,
    narrowed: pattern !== query,
    matches: (...texts) => texts.some((text) => likeContains(text, query)),
  };
}
