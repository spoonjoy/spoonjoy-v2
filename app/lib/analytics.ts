export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);
const SAFE_CLIENT_EVENT_NAMES = new Set([
  "spoonjoy.developer.docs.viewed",
  "spoonjoy.developer.playground.viewed",
  "spoonjoy.developer.playground.surface_selected",
  "spoonjoy.developer.playground.operation_selected",
  "spoonjoy.developer.playground.auth_mode_selected",
  "spoonjoy.developer.playground.sign_in_clicked",
  "spoonjoy.developer.playground.request_submitted",
  "spoonjoy.developer.playground.response_received",
]);
const SAFE_CLIENT_PROPERTY_KEYS = new Set([
  "auth_flow_count",
  "auth_mode",
  "auth_status",
  "client_scenario_count",
  "method",
  "operation_auth",
  "operation_count",
  "operation_group",
  "operation_id",
  "operation_kind",
  "operation_risk",
  "outcome",
  "page",
  "request_body_present",
  "response_status",
  "response_status_class",
  "surface",
  "validation_error_count",
  "latency_bucket",
]);
const SAFE_CLIENT_STRING_PATTERN = /^[A-Za-z0-9 _./:{}-]+$/;
const SECRET_VALUE_PATTERN = /\b(?:sj|ort|sjdc|oac)_[A-Za-z0-9_-]+\b/i;
const UNSAFE_STRING_PATTERN = /(?:https?:\/\/|\?|#|Bearer\s+|Authorization|Cookie|clientMutationId|code_verifier|raw_|request_body|response_body)/i;

export type PostHogEnv = {
  readonly VITE_POSTHOG_KEY?: string | boolean;
  readonly VITE_POSTHOG_HOST?: string | boolean;
  readonly VITE_POSTHOG_DISABLED?: string | boolean;
};

export type SafeClientTelemetryEventName =
  | "spoonjoy.developer.docs.viewed"
  | "spoonjoy.developer.playground.viewed"
  | "spoonjoy.developer.playground.surface_selected"
  | "spoonjoy.developer.playground.operation_selected"
  | "spoonjoy.developer.playground.auth_mode_selected"
  | "spoonjoy.developer.playground.sign_in_clicked"
  | "spoonjoy.developer.playground.request_submitted"
  | "spoonjoy.developer.playground.response_received";

export type SafeClientTelemetryProperties = Record<string, string | number | boolean | null | undefined>;

export type PostHogCaptureClient = {
  capture?: (event: string, properties?: Record<string, string | number | boolean | null>) => void;
} | null | undefined;

export type PostHogConfig =
  | { enabled: true; key: string; host: string }
  | { enabled: false; reason: "disabled" | "missing-key" };

export function isTruthyEnvFlag(value: string | boolean | undefined) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;

  return TRUE_ENV_VALUES.has(value.trim().toLowerCase());
}

function readEnvString(value: string | boolean | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

export function resolvePostHogConfig(env: PostHogEnv): PostHogConfig {
  if (isTruthyEnvFlag(env.VITE_POSTHOG_DISABLED)) {
    return { enabled: false, reason: "disabled" };
  }

  const key = readEnvString(env.VITE_POSTHOG_KEY);
  if (!key) {
    return { enabled: false, reason: "missing-key" };
  }

  return {
    enabled: true,
    key,
    host: readEnvString(env.VITE_POSTHOG_HOST) || DEFAULT_POSTHOG_HOST,
  };
}

export function toAnalyticsPageUrl(location: Pick<Location | URL, "origin" | "pathname">) {
  return `${location.origin}${location.pathname}`;
}

export function responseStatusClass(status: number) {
  if (!Number.isFinite(status) || status <= 0) return "network";
  const hundreds = Math.floor(status / 100);
  if (hundreds >= 2 && hundreds <= 5) return `${hundreds}xx`;
  return "unknown";
}

export function latencyBucket(elapsedMs: number | null | undefined) {
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0) return "unknown";
  if (elapsedMs < 100) return "lt_100ms";
  if (elapsedMs < 500) return "100_499ms";
  if (elapsedMs < 1500) return "500_1499ms";
  if (elapsedMs < 5000) return "1500_4999ms";
  return "gte_5000ms";
}

function safeClientPropertyValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!SAFE_CLIENT_STRING_PATTERN.test(trimmed)) return undefined;
  if (SECRET_VALUE_PATTERN.test(trimmed) || UNSAFE_STRING_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

export function safeClientTelemetryProperties(properties: Record<string, unknown>) {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!SAFE_CLIENT_PROPERTY_KEYS.has(key)) continue;
    const safeValue = safeClientPropertyValue(value);
    if (safeValue !== undefined) safe[key] = safeValue;
  }
  return safe;
}

export function captureSafeClientEvent(
  client: PostHogCaptureClient,
  event: string,
  properties: Record<string, unknown> = {},
) {
  if (!client?.capture || !SAFE_CLIENT_EVENT_NAMES.has(event)) return;
  client.capture(event, safeClientTelemetryProperties(properties));
}
