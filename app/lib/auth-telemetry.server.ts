/**
 * Auth-surface telemetry sink.
 *
 * The OAuth callback and WebAuthn route handlers run inside a Workers request
 * and have access to `context.cloudflare.{env, ctx}`. This module turns that
 * context into a small capture sink that:
 *
 *   - resolves `PostHogServerConfig` once from the env, and
 *   - wraps every `captureException`/`captureEvent` in `ctx.waitUntil` so the
 *     capture network call never blocks (or breaks) the response.
 *
 * When PostHog is disabled, the key is missing, or `waitUntil` is unavailable
 * (e.g. unit tests that pass a bare context), every method is a safe no-op.
 *
 * The low-level OAuth verify helpers (`verify{Apple,Google,GitHub}Callback`)
 * do NOT import this module — they accept an optional, provider-agnostic
 * `capture` callback that the callback-route orchestration derives from a
 * sink. That keeps the crypto/token helpers pure and unit-testable without a
 * PostHog config, while still letting a provider outage be captured with the
 * original error at the point it is flattened to a generic client error.
 */

import type { AppLoadContext } from "react-router";
import type { OAuthProviderFailureKind } from "~/lib/oauth-provider-call.server";
import {
  captureEvent,
  captureException,
  resolvePostHogServerConfig,
} from "~/lib/analytics-server";

/** OAuth providers covered by the social-login callback surface. */
export type AuthProvider = "apple" | "google" | "github";

/**
 * Where in an auth flow a failure surfaced. Recorded as a property so a
 * provider outage (token/userinfo/jwks/network) is distinguishable from a
 * normal user error (invalid_state/CSRF) in PostHog.
 */
export type AuthFailurePhase =
  // OAuth social-login callback phases
  | "callback"
  | "provider_error"
  | "invalid_state"
  | "invalid_code_verifier"
  | "config"
  | "verify"
  | "token_exchange"
  | "userinfo"
  | "jwks"
  | "link_account"
  | "session"
  // OAuth initiate phases
  | "initiate"
  // WebAuthn phases
  | "register_options"
  | "register_verify"
  | "authenticate_options"
  | "authenticate_verify";

/** Structured capture passed up from a low-level verify helper. */
export interface AuthVerifyCapture {
  /** The original error, before it was flattened to a generic client code. */
  error: unknown;
  /** The flow phase the failure occurred in. */
  phase: AuthFailurePhase;
  /** Upstream HTTP status, when the failure came from a provider response. */
  httpStatus?: number;
  /** Stable failure class for alerting and retry UX. */
  failureKind?: OAuthProviderFailureKind;
  /** Whether restarting the provider flow can reasonably succeed. */
  retryable?: boolean;
}

export interface AuthTelemetry {
  /** Whether capture is actually wired (PostHog enabled + waitUntil present). */
  readonly enabled: boolean;
  /** Capture an unexpected exception with the standard $exception payload. */
  captureException(error: unknown, extras?: Record<string, unknown>): void;
  /** Capture a controlled `spoonjoy.*` server event. */
  captureEvent(
    event: string,
    distinctId: string,
    properties?: Record<string, unknown>,
  ): void;
}

const NOOP_AUTH_TELEMETRY: AuthTelemetry = {
  enabled: false,
  captureException() {},
  captureEvent() {},
};

/**
 * Build a telemetry sink from a route `AppLoadContext`. Returns a no-op sink
 * when env/waitUntil are unavailable or PostHog is disabled, so callers can
 * always invoke the methods unconditionally.
 */
export function authTelemetryFromContext(context: AppLoadContext): AuthTelemetry {
  const cloudflare = context.cloudflare;
  const env = cloudflare?.env;
  const waitUntil = cloudflare?.ctx?.waitUntil
    ? cloudflare.ctx.waitUntil.bind(cloudflare.ctx)
    : undefined;
  if (!env || !waitUntil) return NOOP_AUTH_TELEMETRY;

  const config = resolvePostHogServerConfig(env);
  if (!config.enabled) return NOOP_AUTH_TELEMETRY;

  return {
    enabled: true,
    captureException(error, extras) {
      waitUntil(
        captureException(config, {
          error,
          distinctId: "server",
          extras,
        }),
      );
    },
    captureEvent(event, distinctId, properties) {
      waitUntil(
        captureEvent(config, {
          event,
          distinctId,
          properties,
        }),
      );
    },
  };
}
