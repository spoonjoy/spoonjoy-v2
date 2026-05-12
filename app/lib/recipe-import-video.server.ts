/**
 * Video recipe-import adapter.
 *
 * Owns hostname detection for YouTube / TikTok URLs and oEmbed fetching.
 * The orchestrator in `recipe-import.server.ts` dispatches to this module for
 * video sources and continues to use the existing HTML pipeline for web URLs.
 */

import { z } from "zod";
import type { RecipeLlmRunner } from "~/lib/recipe-import-llm.server";

export type ImportSource = "youtube" | "tiktok" | "web";

const VIDEO_LLM_PROMPT_PREFIX =
  "You are extracting a recipe from a social-media video's metadata. " +
  "You are given the video's title, the author's display name, and (sometimes) a description. " +
  "The full recipe is rarely present — leave fields null or arrays empty when uncertain. " +
  "Do not invent quantities. If the metadata clearly references a recipe, extract what you can; " +
  "otherwise return empty strings/arrays. If you include the author, fold the credit into the description " +
  "(e.g., \"Recipe by joe's_kitchen on YouTube\"). English only.";

const OEMBED_TIMEOUT_MS = 15_000;
const OEMBED_MAX_BYTES = 1 * 1024 * 1024;
const YOUTUBE_OEMBED_BASE = "https://www.youtube.com/oembed";
const TIKTOK_OEMBED_BASE = "https://www.tiktok.com/oembed";

export type OEmbedErrorCode = "oembed-failed" | "video-unavailable";

export class OEmbedError extends Error {
  readonly code: OEmbedErrorCode;
  readonly status: number;
  constructor(code: OEmbedErrorCode, status: number, message: string) {
    super(message);
    this.name = "OEmbedError";
    this.code = code;
    this.status = status;
  }
}

export interface OEmbedMetadata {
  title: string;
  authorName: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  source: "youtube" | "tiktok";
  sourceUrl: string;
}

export interface VideoFetchDeps {
  fetchImpl?: typeof fetch;
}

const OEmbedResponseSchema = z
  .object({
    title: z.string().min(1),
    author_name: z.string().nullish(),
    thumbnail_url: z.string().url().nullish(),
    description: z.string().nullish(),
  })
  .passthrough();

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

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  return value.trim().toLowerCase().startsWith("application/json");
}

async function readBodyCapped(
  response: Response,
  controller: AbortController,
): Promise<Uint8Array> {
  const body = response.body;
  if (!body) {
    throw new OEmbedError("oembed-failed", 502, "oEmbed response had no body");
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > OEMBED_MAX_BYTES) {
      controller.abort();
      throw new OEmbedError(
        "oembed-failed",
        502,
        "oEmbed response body exceeds 1MB cap",
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function buildEndpoint(url: string, source: "youtube" | "tiktok"): string {
  const encoded = encodeURIComponent(url);
  if (source === "youtube") {
    return `${YOUTUBE_OEMBED_BASE}?url=${encoded}&format=json`;
  }
  return `${TIKTOK_OEMBED_BASE}?url=${encoded}`;
}

/**
 * Fetch oEmbed JSON metadata for a video URL.
 *
 * Enforces:
 *   - 15s timeout (AbortController).
 *   - 1MB body cap (streamed byte counting).
 *   - `application/json` content-type prefix.
 *   - Zod-validated shape (`title` required and non-empty; `thumbnail_url`
 *     must parse as URL when present).
 *
 * Maps response status to error codes:
 *   - 4xx → `video-unavailable` (private / deleted / region-locked).
 *   - 5xx and network failures → `oembed-failed`.
 */
export async function fetchOEmbedMetadata(
  url: string,
  source: "youtube" | "tiktok",
  deps: VideoFetchDeps = {},
): Promise<OEmbedMetadata> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const endpoint = buildEndpoint(url, source);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OEMBED_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(endpoint, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err && (err as { name?: string }).name === "AbortError") {
      throw new OEmbedError("oembed-failed", 502, "oEmbed request timed out");
    }
    throw new OEmbedError("oembed-failed", 502, "oEmbed network error");
  }
  clearTimeout(timer);

  if (response.status >= 400 && response.status < 500) {
    throw new OEmbedError(
      "video-unavailable",
      502,
      "video metadata unavailable; try a different URL",
    );
  }
  if (!response.ok) {
    throw new OEmbedError(
      "oembed-failed",
      502,
      `oEmbed status ${response.status}`,
    );
  }

  const contentType = response.headers.get("content-type");
  if (!isJsonContentType(contentType)) {
    throw new OEmbedError(
      "oembed-failed",
      502,
      `oEmbed returned non-JSON content-type: ${contentType ?? "(none)"}`,
    );
  }

  const bytes = await readBodyCapped(response, controller);
  const text = new TextDecoder("utf-8").decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OEmbedError("oembed-failed", 502, "oEmbed body was not JSON");
  }
  const validated = OEmbedResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new OEmbedError(
      "oembed-failed",
      502,
      `oEmbed shape rejected: ${validated.error.message}`,
    );
  }
  const data = validated.data;
  return {
    title: data.title,
    authorName: data.author_name ?? null,
    thumbnailUrl: data.thumbnail_url ?? null,
    description: data.description ?? null,
    source,
    sourceUrl: url,
  };
}

export interface VideoRecipeExtractionDeps {
  llmRunner: RecipeLlmRunner;
}

export interface VideoRecipeExtraction {
  title: string;
  description: string | null;
  servings: string | null;
  ingredients: string[];
  steps: string[];
}

/**
 * Extract a recipe from oEmbed metadata via the shared LLM runner.
 *
 * Tells the model explicitly that this is video metadata where the full recipe
 * may not be present, and folds the author credit into the description. Does
 * NOT catch `RecipeLlmError` — the orchestrator maps it to `llm-failed`/502.
 */
export async function extractVideoRecipe(
  meta: OEmbedMetadata,
  deps: VideoRecipeExtractionDeps,
): Promise<VideoRecipeExtraction> {
  const text = [
    VIDEO_LLM_PROMPT_PREFIX,
    "",
    `Source: ${meta.source}`,
    `Title: ${meta.title}`,
    `Author: ${meta.authorName ?? "unknown"}`,
    `Description: ${meta.description ?? "(none)"}`,
  ].join("\n");
  return deps.llmRunner.extract(text);
}
