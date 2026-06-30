/**
 * Ratchet allowlist: catch-bearing server files that are KNOWN to have no
 * telemetry call today and are accepted as current gaps.
 *
 * This is the heart of the "no-new-gap" ratchet. Every entry here keeps the
 * gate GREEN on day one while still blocking any NEW catch-bearing server file
 * that ships without telemetry (and without a deliberate allowlist entry).
 *
 * Each entry carries a category + reason so the gap report is honest:
 *
 *   - "swallow"    — the catch is an intentional swallow with a documented
 *                    reason (parse fallback, best-effort cleanup, optional
 *                    feature). No user-facing failure is hidden; no telemetry
 *                    is needed. Lowest backfill priority.
 *   - "rethrow"    — the catch only re-throws / recovers a race and surfaces
 *                    the error to an instrumented caller. No silent path.
 *   - "expected-4xx" — the catch maps to an expected client error (validation,
 *                    not-found, auth-rejected) handled by the caller. No
 *                    exception capture warranted.
 *   - "non-request" — module is not on a user-facing request path (stdio MCP
 *                    transport, build/codegen helper, dev-only fallback).
 *   - "delegated"  — the catch IS instrumented, but the capture happens in a
 *                    shared helper the file delegates to (so no telemetry call
 *                    appears in the file itself). Not a real gap; allowlisted
 *                    so the file ratchet does not false-positive.
 *   - "backfill"   — a genuine user-facing server error path that SHOULD emit
 *                    telemetry but does not yet. Tracked here for a follow-up
 *                    instrumentation PR (see docs/telemetry-coverage.md).
 *   - "llm-owned"  — owned by the parallel LLM-telemetry workstream; left to
 *                    that PR to instrument. Do not touch here.
 *
 * To CLOSE a gap: instrument the file, then DELETE its entry here. The ratchet
 * fails if an allowlisted file becomes instrumented but its entry lingers
 * (stale allowlist), so backfill cannot silently rot the list.
 */

export type GapCategory =
  | "swallow"
  | "rethrow"
  | "expected-4xx"
  | "non-request"
  | "delegated"
  | "backfill"
  | "llm-owned";

export interface AllowlistEntry {
  /** Repo-relative path (POSIX separators), as produced by the audit. */
  file: string;
  category: GapCategory;
  reason: string;
}

export const TELEMETRY_GAP_ALLOWLIST: AllowlistEntry[] = [
  // --- intentional swallows / parse fallbacks (no user-facing failure) ---
  {
    file: "app/lib/db.server.ts",
    category: "swallow",
    reason:
      "Dev/test platform-proxy bind failure falls back to a local SQLite db; restricted sandboxes legitimately cannot bind loopback ports.",
  },
  {
    file: "app/lib/recipe-import-jsonld.server.ts",
    category: "swallow",
    reason:
      "Pure JSON-LD parser. Malformed <script> blocks are skipped so import can fall through to the next extractor; the orchestrator owns failure telemetry.",
  },
  {
    file: "app/lib/recipe-image-assignment.server.ts",
    category: "swallow",
    reason:
      "Best-effort cover assignment fallback; failure leaves the recipe without an auto-assigned cover, which is a non-fatal degraded state.",
  },

  // --- pure rethrow / race recovery (surfaced to instrumented callers) ---
  {
    file: "app/lib/api-idempotency.server.ts",
    category: "rethrow",
    reason:
      "Catch only recovers a unique-constraint idempotency race or re-throws; the API route layer (api-v1.server.ts) captures the surfaced exception.",
  },
  {
    file: "app/lib/recipe-import-fetch.server.ts",
    category: "rethrow",
    reason:
      "Pure DI fetch wrapper (no PostHog config). Fetch/timeout catches throw a typed SafeFetchError; the import orchestrator maps it to ImportRecipeError, which api.$.ts captures with import_code for non-expected codes. The one bare catch (og:image URL parse) is a best-effort swallow that degrades the OG image hint to null.",
  },
  {
    file: "app/lib/recipe-import-video.server.ts",
    category: "rethrow",
    reason:
      "Video oEmbed adapter (no PostHog config). Every catch throws a typed OEmbedError preserving upstreamStatus/cause; the orchestrator's mapOEmbedError forwards the cause into ImportRecipeError, captured at api.$.ts. Not silent — surfaced to an instrumented caller.",
  },
  {
    file: "app/lib/safe-image-fetch.server.ts",
    category: "rethrow",
    reason:
      "SSRF-guarded DI fetch wrapper (no PostHog config). Catches map fetch/timeout to a typed Error surfaced to instrumented callers: the import orchestrator captures it via captureImportCoverException, and image-gen wraps it into ImageGenError captured by the stylization caller.",
  },
  {
    file: "app/lib/image-gen.server.ts",
    category: "rethrow",
    reason:
      "Lower-level image-gen helper (no PostHog config). Every catch wraps the provider error into ImageGenError/ImageProviderAttemptError preserving code/status/cause and rethrows; callers (spoon-cover-stylization.server.ts, ai-placeholder-cover.server.ts) emit captureImageGenerationException on the surfaced typed error.",
  },

  // --- expected client (4xx) outcomes handled by the caller ---
  {
    file: "app/lib/recipe-create.server.ts",
    category: "expected-4xx",
    reason:
      "Validation/draft-parse catch maps to a 4xx form error returned to the user; not an unexpected server exception.",
  },
  {
    file: "app/lib/spoonjoy-api-request.server.ts",
    category: "expected-4xx",
    reason:
      "Sole catch is in resolveApiPrincipal: it swallows an expected 401 (ApiAuthError) only for public bootstrap ops and rethrows any other auth error so protected ops fail closed; the surfaced error is captured at the api.$.ts / http-mcp.server.ts route boundary. No transport catch exists.",
  },
  {
    file: "app/lib/api-v1-recipe-writes.server.ts",
    category: "expected-4xx",
    reason:
      "Sole catch maps known fork domain errors (missing source recipe or exhausted title choices) to typed API v1 4xx results; unexpected fork failures rethrow to the instrumented api-v1.server route boundary.",
  },
  {
    file: "app/lib/shopping-list.server.ts",
    category: "expected-4xx",
    reason:
      "Ingredient-parse fallback inside a user action; failure degrades to unparsed text, surfaced as a normal action result rather than a server exception.",
  },

  // --- not on a user-facing request path ---
  {
    file: "app/lib/mcp/json-rpc-stdio.server.ts",
    category: "non-request",
    reason:
      "Local stdio MCP transport for the dev CLI server; not reachable over the Workers request path. The HTTP MCP surface (http-mcp.server.ts) is instrumented.",
  },
  {
    file: "app/lib/mcp/json-rpc.server.ts",
    category: "non-request",
    reason:
      "Transport-level JSON-RPC framing/dispatch shared by the stdio CLI; protocol-level errors are returned as JSON-RPC error objects. The HTTP MCP entrypoint owns request telemetry.",
  },
  {
    file: "app/lib/mcp/spoonjoy-token-cache.server.ts",
    category: "non-request",
    reason:
      "Dev CLI token cache for the local MCP server; file-IO catch falls back to no cache. Not part of the deployed request path.",
  },
  // --- catch IS instrumented in a shared helper the file delegates to ---
  {
    file: "app/lib/recipe-detail.server.ts",
    category: "delegated",
    reason:
      "Spoon-notify / origin-cook fan-out catches swallow only local getVapidConfig absence; the actual dispatch failures are captured by enqueueNotification via the threaded postHogConfig (proven by recipe-detail-posthog-wiring.test.ts). The remaining catches are a P2002 idempotent re-add (rethrows anything else) and an archiveRecipeCover -> 400 (expected-4xx).",
  },
  {
    file: "app/lib/web-push.server.ts",
    category: "delegated",
    reason:
      "Both catches return a typed SendPushResult ({ status: 'failed', httpStatus, error }) rather than throwing; the sole caller (notification-dispatch.server.ts) captures that result as a spoonjoy.push.send_failed event with the failureMode. Capture is delegated to the dispatcher.",
  },
  {
    file: "app/lib/spoonjoy-api.server.ts",
    category: "delegated",
    reason:
      "Handler catches are expected-4xx (coverLifecycleApiError -> ApiAuthError 400; fork -> ApiAuthError 404/409 else rethrow) or notification swallows that delegate capture to enqueueNotification via the threaded postHogConfig (proven by spoonjoy-api-posthog-wiring.test.ts). Genuine unexpected failures are captured at the api.$.ts and http-mcp.server.ts route boundaries.",
  },
  {
    file: "app/routes/auth.webauthn.register.options.ts",
    category: "delegated",
    reason:
      "Route catch delegates capture to webauthn-route.server.ts (startRegistration), which emits captureException + spoonjoy.webauthn failure events with the surface/phase. No capture call in the route itself.",
  },
  {
    file: "app/routes/auth.webauthn.register.verify.ts",
    category: "delegated",
    reason:
      "Route catch delegates capture to webauthn-route.server.ts (verifyRegistration), which emits captureException + spoonjoy.webauthn failure events. No capture call in the route itself.",
  },
  {
    file: "app/routes/auth.webauthn.authenticate.options.ts",
    category: "delegated",
    reason:
      "Route catch delegates capture to webauthn-route.server.ts (startAuthentication), which emits captureException + spoonjoy.webauthn failure events. No capture call in the route itself.",
  },
  {
    file: "app/routes/auth.webauthn.authenticate.verify.ts",
    category: "delegated",
    reason:
      "Route catch delegates capture to webauthn-route.server.ts (verifyAuthentication), which emits captureException + spoonjoy.webauthn failure events. No capture call in the route itself.",
  },

  // --- backfill candidates: real user-facing server error paths ---
  {
    file: "app/lib/oauth-route.server.ts",
    category: "swallow",
    reason:
      "Sole catch is in sameOriginReferer(): a malformed/absent Referer header is parsed to null so no same-origin default redirect is derived. Pure parse fallback; no user-facing failure is hidden, so no exception capture is warranted.",
  },
  {
    file: "app/lib/oauth-routes.server.ts",
    category: "rethrow",
    reason:
      "authorize/token/register/revoke handlers: catches either return spec-compliant OAuthError 4xx responses, parse-fail to 400, or best-effort telemetry-metadata fallbacks. The only unexpected (non-OAuthError) path re-throws via oauthErrorResponse() to the platform, where entry.server.tsx handleError captures it with route+method. No silent swallow.",
  },
  {
    file: "app/lib/oauth-server.server.ts",
    category: "expected-4xx",
    reason:
      "Sole catch is in isValidRedirectUri(): an unparseable redirect_uri returns false, which the caller maps to an invalid_redirect_uri client (4xx) error. Validation predicate over a client-supplied value; not an unexpected server exception.",
  },
  {
    file: "app/lib/apple-oauth.server.ts",
    category: "delegated",
    reason:
      "Every catch in verifyAppleCallback already calls the threaded capture callback (capture?.({ error, phase })). The sole production caller (oauth-callback-route.server.ts) passes verifyCaptureFor(telemetry, provider), so a provider/crypto outage IS captured via the auth-telemetry PostHog sink with provider+phase. The static scanner cannot see the local-callback indirection; no capture call appears in the file itself.",
  },
  {
    file: "app/lib/google-oauth.server.ts",
    category: "delegated",
    reason:
      "Every catch in verifyGoogleCallback (token exchange, userinfo non-2xx, network) already calls the threaded capture callback. The sole production caller (oauth-callback-route.server.ts) passes verifyCaptureFor(telemetry, provider), so failures ARE captured via the auth-telemetry sink with provider+phase+httpStatus. No capture call appears in the file itself (local-callback indirection the scanner cannot resolve).",
  },
  {
    file: "app/lib/github-oauth.server.ts",
    category: "delegated",
    reason:
      "verifyGitHubCallback captures /user|/user/emails non-2xx and token-exchange/network failures via the threaded capture callback, and re-throws truly unexpected errors to the callback route (which captures + flattens). The sole production caller passes verifyCaptureFor(telemetry, provider), so failures reach the auth-telemetry sink with provider+phase+httpStatus. No capture call appears in the file itself (local-callback indirection).",
  },

  // --- route-level: client-only swallow (server capture lives elsewhere) ---
  {
    file: "app/routes/recipes.$id.tsx",
    category: "swallow",
    reason:
      "The only catches here are client-side cook-progress localStorage parse/read/write fallbacks (window-guarded); a corrupt or unavailable store degrades to a fresh session, no user-facing failure. The server action delegates to recipe-detail.server.ts, which owns mutation-failure capture.",
  },

  // --- owned by the parallel LLM-telemetry workstream ---
  {
    file: "app/lib/recipe-import-llm.server.ts",
    category: "llm-owned",
    reason:
      "LLM fallback extractor for recipe import. Instrumentation of the OpenAI call failure path is owned by the parallel LLM-telemetry PR (captureLlmCallFailure); not touched here.",
  },
  {
    file: "app/lib/gemini-text.server.ts",
    category: "rethrow",
    reason:
      "Generic Gemini text adapter (no PostHog config). Every catch throws a typed GeminiTextError preserving status/code/cause for timeout/network/non-2xx/non-JSON/empty-content; the sole caller (ingredient-parse.server.ts parseWithGemini -> parseIngredients) captures the surfaced failure via captureLlmCallFailure with provider='gemini'. Not silent — surfaced to an instrumented caller.",
  },
];

/** Allowlist as a `file -> reason` map for the ratchet check. */
export function allowlistMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of TELEMETRY_GAP_ALLOWLIST) {
    map.set(entry.file, `[${entry.category}] ${entry.reason}`);
  }
  return map;
}
