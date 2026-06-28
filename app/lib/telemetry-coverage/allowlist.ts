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

  // --- expected client (4xx) outcomes handled by the caller ---
  {
    file: "app/lib/recipe-create.server.ts",
    category: "expected-4xx",
    reason:
      "Validation/draft-parse catch maps to a 4xx form error returned to the user; not an unexpected server exception.",
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
    file: "app/lib/recipe-detail.server.ts",
    category: "backfill",
    reason:
      "Recipe detail/spoon mutation paths have catch blocks that flatten to error responses without exception capture. Backfill: capture unexpected (non-4xx) failures with recipe/spoon context.",
  },
  {
    file: "app/lib/recipe-import-fetch.server.ts",
    category: "backfill",
    reason:
      "Source-fetch wrapper for recipe import; network/timeout failures are mapped to ImportRecipeError. Backfill: capture genuine upstream failures (the orchestrator captures only a subset).",
  },
  {
    file: "app/lib/recipe-import-video.server.ts",
    category: "backfill",
    reason:
      "Video oEmbed import adapter; provider/oEmbed failures degrade silently. Backfill: capture upstream failures with the provider + host family.",
  },
  {
    file: "app/lib/safe-image-fetch.server.ts",
    category: "backfill",
    reason:
      "SSRF-guarded image fetch used by cover/import flows; fetch failures return a typed miss. Backfill: capture unexpected fetch failures (distinct from policy rejections).",
  },
  {
    file: "app/lib/image-gen.server.ts",
    category: "backfill",
    reason:
      "Lower-level image-generation helper; some catches flatten provider errors without capture. Backfill: route remaining provider failures through captureImageGenerationException.",
  },
  {
    file: "app/lib/notification-triggers.server.ts",
    category: "backfill",
    reason:
      "Notification trigger evaluation; catches around fan-out scheduling swallow errors. Backfill: capture trigger-evaluation failures with the trigger kind.",
  },
  {
    file: "app/lib/web-push.server.ts",
    category: "backfill",
    reason:
      "Web Push send wrapper; non-410 send failures are not captured here. Backfill: capture unexpected push-send failures (the dispatcher captures a subset).",
  },
  {
    file: "app/lib/spoonjoy-api.server.ts",
    category: "backfill",
    reason:
      "Native-app API client surface; several catches map upstream failures to client responses without capture. Backfill: capture unexpected upstream failures with the operation name.",
  },
  {
    file: "app/lib/spoonjoy-api-request.server.ts",
    category: "backfill",
    reason:
      "Request helper for the native-app API surface; transport catch maps to a typed error. Backfill: capture unexpected transport failures.",
  },
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
