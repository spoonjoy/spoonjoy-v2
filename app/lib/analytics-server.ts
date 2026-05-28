/**
 * Server-side analytics for Spoonjoy.
 *
 * Wraps PostHog's HTTP capture API directly (no `posthog-node` SDK
 * dependency) so it works in Cloudflare Workers without pulling Node
 * polyfills. Used today for capturing server-side exceptions; can be
 * extended for other server-emitted events as needed.
 *
 * Configuration: `POSTHOG_KEY` is required to enable capture. `POSTHOG_HOST`
 * overrides the ingestion endpoint (defaults to `https://us.i.posthog.com`).
 * `POSTHOG_DISABLED=1/true/yes/on` is a hard kill-switch.
 *
 * Privacy posture: server payloads are limited to error type, message,
 * stack trace, and the request route + method. They do not include
 * request bodies, cookies, or query/hash strings.
 */

import { DEFAULT_POSTHOG_HOST, isTruthyEnvFlag } from "~/lib/analytics";

export type PostHogServerEnv = {
  readonly POSTHOG_KEY?: string;
  readonly POSTHOG_HOST?: string;
  readonly POSTHOG_DISABLED?: string;
};

export type PostHogServerConfig =
  | { enabled: true; key: string; host: string }
  | { enabled: false; reason: "disabled" | "missing-key" };

export function resolvePostHogServerConfig(env: PostHogServerEnv): PostHogServerConfig {
  if (isTruthyEnvFlag(env.POSTHOG_DISABLED)) {
    return { enabled: false, reason: "disabled" };
  }

  const key = (env.POSTHOG_KEY ?? "").trim();
  if (!key) {
    return { enabled: false, reason: "missing-key" };
  }

  const host = (env.POSTHOG_HOST ?? "").trim() || DEFAULT_POSTHOG_HOST;
  return { enabled: true, key, host };
}

export interface CaptureExceptionInput {
  /** The error to capture. */
  error: unknown;
  /** Distinct id for PostHog. Use a user id when known, otherwise a stable string like `anon`. */
  distinctId: string;
  /** Route or pathname the error came from. Origin/path only — no query/hash. */
  route?: string;
  /** HTTP method, if known. */
  method?: string;
  /** Additional structured properties. Caller is responsible for redacting PII. */
  extras?: Record<string, unknown>;
}

interface CapturePayload {
  api_key: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

function errorToProps(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      $exception_type: error.name || "Error",
      $exception_message: error.message,
      $exception_stack_trace_raw: error.stack ?? null,
    };
  }
  // Non-Error throws (strings, plain objects). Stringify defensively.
  let message: string;
  try {
    message = typeof error === "string" ? error : JSON.stringify(error);
  } catch {
    message = String(error);
  }
  return {
    $exception_type: "NonError",
    $exception_message: message,
    $exception_stack_trace_raw: null,
  };
}

/**
 * Build the PostHog capture payload for an exception. Pure function so it
 * can be unit-tested without touching the network.
 */
export function buildCaptureExceptionPayload(
  config: Extract<PostHogServerConfig, { enabled: true }>,
  input: CaptureExceptionInput,
  now: () => Date = () => new Date(),
): CapturePayload {
  const props: Record<string, unknown> = {
    ...errorToProps(input.error),
    $lib: "spoonjoy-server",
  };
  if (input.route) props.route = input.route;
  if (input.method) props.method = input.method;
  if (input.extras) {
    for (const [k, v] of Object.entries(input.extras)) {
      if (!(k in props)) props[k] = v;
    }
  }

  return {
    api_key: config.key,
    event: "$exception",
    distinct_id: input.distinctId,
    timestamp: now().toISOString(),
    properties: props,
  };
}

/**
 * Fire-and-forget exception capture. Resolves once the request completes
 * (or the network call fails); never throws — capture failures are
 * swallowed because they must not affect the request response.
 *
 * When called inside a Workers handler, wrap with `ctx.waitUntil()` so the
 * Worker keeps the connection alive after returning the response:
 *
 *     ctx.waitUntil(captureException(config, { error, distinctId, ... }))
 */
export async function captureException(
  config: PostHogServerConfig,
  input: CaptureExceptionInput,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!config.enabled) return;

  const payload = buildCaptureExceptionPayload(config, input);
  const url = `${config.host.replace(/\/$/, "")}/i/v0/e/`;

  try {
    await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Intentional: PostHog outage must not surface as an app error.
  }
}
