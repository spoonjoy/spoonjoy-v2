/**
 * Video recipe-import adapter.
 *
 * Owns hostname detection for YouTube / TikTok URLs. The orchestrator in
 * `recipe-import.server.ts` dispatches to this module for video sources and
 * continues to use the existing HTML pipeline for web URLs.
 *
 * Subsequent units in I2 add `fetchOEmbedMetadata` and `extractVideoRecipe`.
 */

export type ImportSource = "youtube" | "tiktok" | "web";

const YOUTUBE_HOSTS: ReadonlySet<string> = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

const TIKTOK_HOSTS: ReadonlySet<string> = new Set([
  "tiktok.com",
  "www.tiktok.com",
  "m.tiktok.com",
  "vm.tiktok.com",
]);

/**
 * Classify a parsed URL into the import-source kind.
 *
 * Exact-host match against curated allowlists. Hostname is lowercased before
 * comparison. Suffix-spoofs like `youtube.com.evil.example` fall through to
 * `"web"` because they're not in the set.
 */
export function detectImportSource(url: URL): ImportSource {
  const host = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(host)) return "youtube";
  if (TIKTOK_HOSTS.has(host)) return "tiktok";
  return "web";
}
