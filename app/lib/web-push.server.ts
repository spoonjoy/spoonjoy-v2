/**
 * Web Push send adapter.
 *
 * Wraps `@block65/webcrypto-web-push` `buildPushPayload` + global `fetch`.
 * Provides a thin, swappable surface so an alternate library (e.g.
 * `@pushforge/builder`) can be dropped in without touching call sites.
 *
 * Status mapping:
 *   2xx       → "delivered"
 *   404 / 410 → "expired"  (the dispatcher prunes these subscriptions)
 *   any other → "failed"   (transient — leave the subscription in place)
 *
 * Endpoints are checked against the known browser push services before any
 * request is made. A subscription row whose endpoint is not on that list (rows
 * saved before the subscribe route enforced it) is reported as "expired", so
 * the dispatcher prunes it instead of letting the Worker POST to an arbitrary
 * host. Each send is also bounded by a timeout so a slow host cannot hold the
 * Worker open.
 */

import {
  buildPushPayload,
  type PushMessage,
  type PushSubscription as LibPushSubscription,
  type VapidKeys,
} from "@block65/webcrypto-web-push";

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface NotificationPayload {
  title: string;
  body: string;
  url: string;
  icon?: string;
}

export interface SendPushDeps {
  fetch?: typeof fetch;
}

export type SendPushStatus = "delivered" | "expired" | "failed";

export interface SendPushResult {
  status: SendPushStatus;
  httpStatus: number;
  providerEndpoint: string;
  error?: string;
}

const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24h
export const PUSH_SEND_TIMEOUT_MS = 10_000;

/**
 * Hosts of the Web Push services that real browsers hand out endpoints for:
 *   - fcm.googleapis.com: Chrome, Android, Brave, Opera, Samsung Internet
 *   - *.push.apple.com (web.push.apple.com): Safari on macOS and iOS
 *   - *.push.services.mozilla.com (updates.push.services.mozilla.com): Firefox
 *   - *.notify.windows.com (wns2-*.notify.windows.com): Microsoft Edge
 */
const EXACT_PUSH_HOSTS = new Set(["fcm.googleapis.com"]);
const PUSH_HOST_SUFFIXES = [".push.apple.com", ".push.services.mozilla.com", ".notify.windows.com"];

/**
 * True when `endpoint` is an https URL on a known Web Push service, on the
 * default port and with no credentials in it.
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return EXACT_PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function classify(httpStatus: number): SendPushStatus {
  if (httpStatus >= 200 && httpStatus < 300) return "delivered";
  if (httpStatus === 404 || httpStatus === 410) return "expired";
  return "failed";
}

export async function sendPush(
  subscription: PushSubscriptionRecord,
  payload: NotificationPayload,
  vapid: VapidKeys,
  deps: SendPushDeps = {},
): Promise<SendPushResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;

  if (!isAllowedPushEndpoint(subscription.endpoint)) {
    return {
      status: "expired",
      httpStatus: 0,
      providerEndpoint: subscription.endpoint,
      error: "Endpoint is not on a known Web Push service",
    };
  }

  const libSub: LibPushSubscription = {
    endpoint: subscription.endpoint,
    expirationTime: null,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
  };

  const message: PushMessage = {
    data: JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url,
      icon: payload.icon,
    }),
    options: { ttl: DEFAULT_TTL_SECONDS },
  };

  let built: Awaited<ReturnType<typeof buildPushPayload>>;
  try {
    built = await buildPushPayload(message, libSub, vapid);
  } catch (err) {
    return {
      status: "failed",
      httpStatus: 0,
      providerEndpoint: subscription.endpoint,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const response = await fetchImpl(subscription.endpoint, {
      method: built.method,
      headers: built.headers as unknown as HeadersInit,
      body: built.body as unknown as BodyInit,
      signal: AbortSignal.timeout(PUSH_SEND_TIMEOUT_MS),
    });
    return {
      status: classify(response.status),
      httpStatus: response.status,
      providerEndpoint: subscription.endpoint,
    };
  } catch (err) {
    return {
      status: "failed",
      httpStatus: 0,
      providerEndpoint: subscription.endpoint,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
