/**
 * Deployed-identity proof for the web / Cloudflare Workers surface.
 *
 * `sourceSha` is the git commit the running Worker was built from, injected at
 * build time by the Vite `__SPOONJOY_SOURCE_SHA__` define (see `vite.config.ts`).
 * `deployment` is Cloudflare's own version metadata for the running Worker, read
 * from the `CF_VERSION_METADATA` binding at request time. Together they let a
 * caller prove the exact change is live on this surface, instead of trusting a
 * screenshot or a task-status claim.
 */

declare const __SPOONJOY_SOURCE_SHA__: string | undefined;

const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

/** Sentinel returned when no valid build SHA is available. */
export const UNKNOWN_SOURCE_SHA = "unknown";

export interface DeploymentMetadata {
  /** Cloudflare Worker version id for the running deployment. */
  id: string;
  /** Deploy tag Cloudflare attached to the version (empty string if none). */
  tag: string;
  /** ISO timestamp Cloudflare recorded for the version (empty string if none). */
  timestamp: string;
}

/**
 * The build-time git SHA, or `null` when running outside a Vite build (for
 * example under vitest, where the `define` is not applied).
 */
function rawSourceSha(): string | null {
  /* istanbul ignore next -- @preserve replaced by the Vite `define` at build time; unset under vitest */
  return typeof __SPOONJOY_SOURCE_SHA__ === "string" ? __SPOONJOY_SOURCE_SHA__ : null;
}

/**
 * Normalize a candidate SHA to a 40-char lowercase-hex commit, or the
 * {@link UNKNOWN_SOURCE_SHA} sentinel when it is missing or malformed. Pure so it
 * stays fully testable without the build-time define.
 */
export function normalizeSourceSha(candidate: string | null | undefined): string {
  return typeof candidate === "string" && GIT_SHA_PATTERN.test(candidate) ? candidate : UNKNOWN_SOURCE_SHA;
}

/** The git commit the running Worker was built from, or `"unknown"`. */
export function buildSourceSha(): string {
  return normalizeSourceSha(rawSourceSha());
}

/**
 * Read Cloudflare's version metadata for the running Worker from the request
 * env, or `null` when the `CF_VERSION_METADATA` binding is unavailable.
 */
export function deploymentMetadataFromEnv(
  env: { CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string } } | null | undefined,
): DeploymentMetadata | null {
  const meta = env?.CF_VERSION_METADATA;
  if (!meta || typeof meta.id !== "string" || meta.id.length === 0) {
    return null;
  }
  return {
    id: meta.id,
    tag: typeof meta.tag === "string" ? meta.tag : "",
    timestamp: typeof meta.timestamp === "string" ? meta.timestamp : "",
  };
}
