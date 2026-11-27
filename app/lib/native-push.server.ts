/**
 * Native push: notifications on the Spoonjoy iPhone, iPad and Mac app, sent through the push relay
 * (docs/push-relay.md), which holds Apple's key. spoonjoy.app and self-hosted
 * servers send the same way, each with its own relay key.
 *
 * Status mapping, like web push's (web-push.server.ts):
 *   Apple took it               → "delivered"
 *   the relay says revoke       → "expired"  (Apple says the token is dead: the dispatcher revokes the device)
 *   anything else               → "failed"   (transient, or the relay isn't set up: the device stays)
 */
import type { NotificationPayload } from "~/lib/web-push.server";
import { nativePushTokenSecret } from "~/lib/native-push-token.server";
import type { SessionEnv } from "~/lib/session.server";

// The relay's address, RELAY_URL in workers/push-relay/index.ts (a test pins every copy to it).
export const DEFAULT_PUSH_RELAY_URL = "https://spoonjoy-push-relay.mendelow-studio.workers.dev";
export const NATIVE_PUSH_TIMEOUT_MS = 10_000;

export interface NativePushConfig {
  /** The relay's origin, such as DEFAULT_PUSH_RELAY_URL. */
  relayUrl: string;
  /** This server's relay key, from the relay's POST /v1/servers. */
  relayKey: string;
  /** The secret device tokens are sealed under (native-push-token.server.ts). */
  tokenSecret: string;
}

export type NativePushEnv = SessionEnv & {
  SPOONJOY_PUSH_RELAY_URL?: string;
  SPOONJOY_PUSH_RELAY_KEY?: string;
};

/**
 * The server's native push settings, or null when it has no relay key, or SPOONJOY_PUSH_RELAY_URL
 * is "off": then notifications go to browsers only.
 */
export function getNativePushConfig(env: NativePushEnv | null | undefined): NativePushConfig | null {
  const relayKey = env?.SPOONJOY_PUSH_RELAY_KEY?.trim();
  const relayUrl = env?.SPOONJOY_PUSH_RELAY_URL?.trim() || DEFAULT_PUSH_RELAY_URL;
  if (!relayKey || relayUrl.toLowerCase() === "off") return null;
  return { relayUrl: relayUrl.replace(/\/+$/, ""), relayKey, tokenSecret: nativePushTokenSecret(env) };
}

export interface NativePushTarget {
  token: string;
  environment: string;
}

/** The device tokens Apple issues, as the relay checks them (workers/push-relay/index.ts). */
const APPLE_DEVICE_TOKEN = /^[0-9a-f]{64,200}$/i;

/**
 * delivered: Apple took it. expired: the token is dead, so revoke the device. unavailable: the relay
 * has no Apple push key yet (503 not_configured), an expected state, not a failure. failed: anything else.
 */
export type NativePushStatus = "delivered" | "expired" | "unavailable" | "failed";

export interface NativePushResult {
  status: NativePushStatus;
  /** The relay's HTTP status, or 0 when it didn't answer. */
  httpStatus: number;
  /** Apple's status, when the relay reached Apple. */
  apnsStatus?: number;
  /** Apple's reason, or the relay's error code. */
  reason?: string;
}

/** The notification as Apple's payload: the alert, and the page to open in `url`. */
export function nativePushPayload(content: NotificationPayload): Record<string, unknown> {
  return { aps: { alert: { title: content.title, body: content.body }, sound: "default" }, url: content.url };
}

export async function sendNativePush(
  config: NativePushConfig,
  target: NativePushTarget,
  content: NotificationPayload,
  options: { collapseId?: string; fetch?: typeof fetch } = {},
): Promise<NativePushResult> {
  // Apple's tokens are hex (the relay takes nothing else); any other text can never be delivered.
  if (!APPLE_DEVICE_TOKEN.test(target.token)) return { status: "expired", httpStatus: 0, reason: "not_an_apple_token" };
  const fetchImpl = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${config.relayUrl}/v1/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.relayKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        token: target.token,
        environment: target.environment,
        payload: nativePushPayload(content),
        ...(options.collapseId ? { collapseId: options.collapseId } : {}),
      }),
      signal: AbortSignal.timeout(NATIVE_PUSH_TIMEOUT_MS),
    });
  } catch (error) {
    const cause = error instanceof Error ? error.name : "a non-Error throw";
    return { status: "failed", httpStatus: 0, reason: `The push relay at ${config.relayUrl} did not answer (${cause}).` };
  }
  let body: { status?: unknown; reason?: unknown; revoke?: unknown; error?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // An answer that isn't the relay's JSON is a failure with no reason.
  }
  if (response.status === 503 && body?.error === "not_configured") {
    return { status: "unavailable", httpStatus: 503, reason: "not_configured" };
  }
  if (!response.ok) {
    return { status: "failed", httpStatus: response.status, ...(typeof body?.error === "string" ? { reason: body.error } : {}) };
  }
  const apnsStatus = typeof body?.status === "number" ? body.status : undefined;
  const reason = typeof body?.reason === "string" ? body.reason : undefined;
  // BadDeviceToken: Apple will never take this token here (for example a development build's token
  // registered as production), so it is as dead as an unregistered one.
  const dead = body?.revoke === true || (apnsStatus === 400 && reason === "BadDeviceToken");
  const status: NativePushStatus = dead ? "expired" : apnsStatus === 200 ? "delivered" : "failed";
  return { status, httpStatus: response.status, ...(apnsStatus === undefined ? {} : { apnsStatus }), ...(reason ? { reason } : {}) };
}
