/**
 * Telemetry-coverage contract: the vocabulary of server telemetry calls and
 * the rules the gate enforces.
 *
 * This is the Spoonjoy analogue of the ouroboros "nerve coverage" contract.
 * Spoonjoy has no single `emitNervesEvent` envelope; instead a small set of
 * named functions emit PostHog `spoonjoy.*` events / `$exception`s
 * (see `app/lib/analytics-server.ts` + the `*-telemetry.server.ts` wrappers).
 *
 * The gate enforces two rules against the production source (static scan):
 *
 *   1. ERROR-CONTEXT  — every telemetry call carries at least one non-empty,
 *      privacy-safe diagnostic property (adapts ouroboros Rule 3: error events
 *      must carry non-empty meta). A bare `captureException(config, { error,
 *      distinctId })` with no `route`/`method`/`extras` is a violation: the
 *      exception lands in PostHog with zero queryable context.
 *
 *   2. NO-NEW-GAP RATCHET — every server file that contains a `catch` block
 *      (a potential silent error path) must either contain a telemetry call or
 *      be on the documented allowlist. Anything new that is neither fails the
 *      gate. This freezes today's gaps (green on day one) while blocking new
 *      uninstrumented error paths (adapts ouroboros `file-completeness`).
 */

/**
 * The named telemetry emitters. A call to any of these in production source is
 * a "telemetry call" for both the error-context rule and the file ratchet.
 *
 * - Low-level sinks live in `analytics-server.ts`.
 * - Domain wrappers (`captureImageGeneration*`, `captureLlmCallFailure`) live
 *   in the `*-telemetry.server.ts` modules and ALWAYS pass structured
 *   properties, so they are context-safe by construction.
 * - `authTelemetryFromContext(...).captureException/Event` is the auth-surface
 *   sink; the scanner resolves the method-call shape via the same names.
 */
export const TELEMETRY_FUNCTIONS = [
  "captureException",
  "captureEvent",
  "captureImageGenerationSkipped",
  "captureImageGenerationException",
  "captureImageGenerationProviderFallback",
  "captureLlmCallFailure",
  "captureSafeClientEvent",
] as const;

export type TelemetryFunction = (typeof TELEMETRY_FUNCTIONS)[number];

/**
 * Domain-wrapper emitters that build their PostHog properties internally from a
 * typed input object (see `image-gen-telemetry.server.ts` /
 * `llm-telemetry.server.ts`). Their first/only argument is the typed input,
 * not a free-form options literal, so the error-context rule is satisfied by
 * construction — the scanner does not inspect their argument literal.
 */
export const CONTEXT_SAFE_BY_CONSTRUCTION = new Set<string>([
  "captureImageGenerationSkipped",
  "captureImageGenerationException",
  "captureImageGenerationProviderFallback",
  "captureLlmCallFailure",
  "captureSafeClientEvent",
]);

/**
 * Identity keys that are present on (essentially) every capture and therefore
 * carry NO path-specific diagnostics on their own. The error-context rule
 * requires at least one key OUTSIDE this set.
 *
 * The two sink shapes the rule sees:
 *   - low-level: `captureException(config, { error, distinctId, route, method,
 *     extras })` — `route`/`method`/`extras` are the context keys.
 *   - auth sink: `telemetry.captureException(error, { provider, phase })` —
 *     the second-arg object IS the `extras`; `provider`/`phase` are context.
 *
 * A capture whose options object contains ONLY identity keys (or is empty)
 * lands in PostHog with nothing queryable and is a violation.
 */
export const IDENTITY_KEYS = new Set<string>([
  "error",
  "distinctId",
  "event",
  "config",
  "fetchImpl",
]);

/** A telemetry call located in source, with the key names it passed. */
export interface TelemetryCall {
  /** The emitter function name. */
  fn: TelemetryFunction;
  /** Top-level key names found in the call's options literal (best-effort). */
  keys: string[];
  /** 1-based line number of the call in its source file (for diagnostics). */
  line: number;
  /**
   * True when the call is a domain wrapper or its argument could not be parsed
   * as a plain options-object literal (e.g. spread arg, variable). Such calls
   * are treated as context-safe and skipped by the error-context rule.
   */
  contextSafeByConstruction: boolean;
}
