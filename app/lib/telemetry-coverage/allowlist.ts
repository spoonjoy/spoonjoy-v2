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
    category: "backfill",
    reason:
      "OAuth provider-server route helper; catches flatten to OAuth error responses. Backfill: capture unexpected (non-protocol) failures via the auth telemetry sink.",
  },
  {
    file: "app/lib/oauth-routes.server.ts",
    category: "backfill",
    reason:
      "OAuth authorize/token/register/revoke handlers; many catches return spec-compliant OAuth errors. Backfill: capture only the unexpected server failures (most catches are expected protocol 4xx).",
  },
  {
    file: "app/lib/oauth-server.server.ts",
    category: "backfill",
    reason:
      "OAuth server core; catch guards token/grant handling. Backfill: capture unexpected grant-processing failures.",
  },
  {
    file: "app/lib/apple-oauth.server.ts",
    category: "backfill",
    reason:
      "Apple client-secret JWT + token exchange. The callback orchestrator captures verify failures via the auth sink, but the low-level helper's own catches are uncaptured. Backfill: pass a capture callback (mirrors google/github helpers' phase capture).",
  },
  {
    file: "app/lib/google-oauth.server.ts",
    category: "backfill",
    reason:
      "Google token/userinfo helper; low-level catches map provider failures to errors surfaced upstream. Backfill: thread the verify-phase capture callback through (callback route captures the flattened error).",
  },
  {
    file: "app/lib/github-oauth.server.ts",
    category: "backfill",
    reason:
      "GitHub token/userinfo helper; low-level catch surfaces provider failures upstream. Backfill: thread the verify-phase capture callback through (callback route captures the flattened error).",
  },

  // --- route-level backfill candidates ---
  {
    file: "app/routes/api.push.preferences.ts",
    category: "backfill",
    reason:
      "Push-preferences action; catch flattens persistence failures to an error response without capture. Backfill: capture unexpected failures with the action name.",
  },
  {
    file: "app/routes/api.push.public-key.ts",
    category: "backfill",
    reason:
      "Public VAPID key endpoint; catch guards config read. Backfill: capture unexpected config/read failures.",
  },
  {
    file: "app/routes/api.push.subscriptions.ts",
    category: "backfill",
    reason:
      "Push-subscription create/delete action; catch flattens persistence failures. Backfill: capture unexpected failures with the subscription operation.",
  },
  {
    file: "app/routes/recipes.$id.tsx",
    category: "backfill",
    reason:
      "Recipe detail route action(s); catches flatten mutation failures to error UI. Backfill: capture unexpected (non-4xx) action failures with the recipe id present.",
  },
  {
    file: "app/routes/recipes.$id.fork.tsx",
    category: "backfill",
    reason:
      "Recipe fork action; catch flattens fork failures to an error response. Backfill: capture unexpected fork failures.",
  },
  {
    file: "app/routes/recipes.$id.steps.new.tsx",
    category: "backfill",
    reason:
      "Add-step action; catch flattens persistence failures. Backfill: capture unexpected step-create failures.",
  },
  {
    file: "app/routes/recipes.$id.steps.$stepId.edit.tsx",
    category: "backfill",
    reason:
      "Edit-step action; catch flattens persistence failures. Backfill: capture unexpected step-edit failures.",
  },
  {
    file: "app/routes/cookbooks.$id.tsx",
    category: "backfill",
    reason:
      "Cookbook detail route action(s); catches flatten mutation failures. Backfill: capture unexpected (non-4xx) failures with the cookbook id.",
  },
  {
    file: "app/routes/cookbooks.new.tsx",
    category: "backfill",
    reason:
      "Create-cookbook action; catch flattens persistence failures. Backfill: capture unexpected create failures.",
  },

  // --- owned by the parallel LLM-telemetry workstream ---
  {
    file: "app/lib/recipe-import-llm.server.ts",
    category: "llm-owned",
    reason:
      "LLM fallback extractor for recipe import. Instrumentation of the OpenAI call failure path is owned by the parallel LLM-telemetry PR (captureLlmCallFailure); not touched here.",
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
