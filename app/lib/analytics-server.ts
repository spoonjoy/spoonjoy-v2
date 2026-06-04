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
 * Privacy posture: server payloads use explicit safe metadata. They do not
 * include request bodies, cookies, auth headers, tokens, raw query strings,
 * or nested objects that could hide user-entered content.
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

export function requestContentBytes(request: Request): number {
  const raw = request.headers.get("Content-Length");
  if (!raw) return 0;
  const bytes = Number(raw);
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : 0;
}

export function safeHeaderHost(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (isIpLiteralHost(hostname)) return undefined;
    return url.host.toLowerCase();
  } catch {
    return undefined;
  }
}

function isIpLiteralHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) {
    return normalized.split(".").every((segment) => {
      const byte = Number(segment);
      return Number.isInteger(byte) && byte >= 0 && byte <= 255;
    });
  }
  return normalized.includes(":") && /^[0-9a-f:.]+$/i.test(normalized);
}

export function userAgentFamily(userAgent: string | null): string {
  const value = (userAgent ?? "").toLowerCase();
  if (!value) return "unknown";
  if (value.includes("pebble")) return "pebble";
  if (value.includes("curl")) return "curl";
  if (value.includes("postman")) return "postman";
  if (value.includes("undici") || value.includes("node")) return "node";
  if (value.includes("mozilla") || value.includes("chrome") || value.includes("safari") || value.includes("firefox")) {
    return "browser";
  }
  return "other";
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

export interface CaptureEventInput {
  /** Controlled event name. Server events must live under the `spoonjoy.*` namespace. */
  event: string;
  /** Distinct id for PostHog. Use a user id when known, otherwise a stable string like `anon`. */
  distinctId: string;
  /** Structured, privacy-safe metadata. Unsafe keys and nested objects are dropped. */
  properties?: Record<string, unknown>;
}

interface CapturePayload {
  api_key: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

const SERVER_EVENT_NAME_RE = /^spoonjoy(?:\.[a-z0-9_]+)+$/;
const UNSAFE_PROPERTY_KEYS = new Set([
  "authorization",
  "authheader",
  "authheaders",
  "body",
  "clientsecret",
  "code",
  "codechallenge",
  "codeverifier",
  "cookie",
  "cookies",
  "headers",
  "password",
  "rawquery",
  "rawquerystring",
  "request",
  "requestbody",
  "response",
  "responsebody",
  "secret",
  "setcookie",
  "stack",
  "token",
  "accesstoken",
  "refreshtoken",
]);

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

function postHogCaptureUrl(host: string) {
  return `${host.replace(/\/$/, "")}/i/v0/e/`;
}

function assertServerEventName(event: string) {
  if (!SERVER_EVENT_NAME_RE.test(event)) {
    throw new Error("PostHog server events must use a spoonjoy.* event name");
  }
}

function normalizedPropertyKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isUnsafePropertyKey(key: string) {
  return UNSAFE_PROPERTY_KEYS.has(normalizedPropertyKey(key));
}

function safeAnalyticsValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const safeValues = value.map(safeAnalyticsValue);
    return safeValues.every((item) => item !== undefined) ? safeValues : undefined;
  }

  return undefined;
}

export function safeAnalyticsProperties(properties?: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  if (!properties) return safe;

  for (const [key, value] of Object.entries(properties)) {
    if (key === "$lib" || isUnsafePropertyKey(key)) continue;

    const safeValue = safeAnalyticsValue(value);
    if (safeValue !== undefined) {
      safe[key] = safeValue;
    }
  }

  return safe;
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
 * Build the PostHog capture payload for a controlled, non-exception server
 * event. Payload construction is strict so callers cannot accidentally emit
 * arbitrary PostHog browser events or raw request data from server code.
 */
export function buildCaptureEventPayload(
  config: Extract<PostHogServerConfig, { enabled: true }>,
  input: CaptureEventInput,
  now: () => Date = () => new Date(),
): CapturePayload {
  assertServerEventName(input.event);

  return {
    api_key: config.key,
    event: input.event,
    distinct_id: input.distinctId,
    timestamp: now().toISOString(),
    properties: {
      ...safeAnalyticsProperties(input.properties),
      $lib: "spoonjoy-server",
    },
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
  await postCapturePayload(config.host, payload, fetchImpl);
}

/**
 * Fire-and-forget generic server event capture. It never throws, including
 * payload-validation failures, because telemetry must not affect responses.
 */
export async function captureEvent(
  config: PostHogServerConfig,
  input: CaptureEventInput,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!config.enabled) return;

  try {
    const payload = buildCaptureEventPayload(config, input);
    await postCapturePayload(config.host, payload, fetchImpl);
  } catch {
    // Intentional: invalid telemetry input or PostHog outage must not surface
    // as an app/API error.
  }
}

async function postCapturePayload(
  host: string,
  payload: CapturePayload,
  fetchImpl: typeof fetch,
): Promise<void> {
  const url = postHogCaptureUrl(host);

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
