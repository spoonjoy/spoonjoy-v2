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
