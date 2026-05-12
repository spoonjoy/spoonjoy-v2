/**
 * Push client helpers — runs in the browser only.
 *
 * Server-safe: every public function checks for `navigator` and returns
 * a safe value when called during SSR.
 */

export type PushSupportResult =
  | { supported: true }
  | {
      supported: false;
      reason: "no_service_worker" | "no_push_manager" | "insecure_context";
    };

interface SafeNavigator {
  serviceWorker?: {
    register: (url: string, opts: { scope: string }) => Promise<unknown>;
    getRegistration?: () => Promise<unknown>;
    ready?: Promise<{
      pushManager: {
        subscribe: (opts: {
          userVisibleOnly: boolean;
          applicationServerKey: Uint8Array;
        }) => Promise<PushSubscriptionLike>;
        getSubscription: () => Promise<PushSubscriptionLike | null>;
      };
    }>;
  };
  userAgent?: string;
  standalone?: boolean;
}

interface PushSubscriptionLike {
  endpoint: string;
  getKey?: (name: string) => ArrayBuffer | null;
  toJSON?: () => {
    endpoint?: string;
    keys?: { p256dh: string; auth: string };
  };
  unsubscribe?: () => Promise<boolean>;
}

function getNav(): SafeNavigator | null {
  if (typeof navigator === "undefined") return null;
  return navigator as unknown as SafeNavigator;
}

export function isPushSupported(): PushSupportResult {
  const nav = getNav();
  if (!nav || !nav.serviceWorker) {
    return { supported: false, reason: "no_service_worker" };
  }
  if (typeof (globalThis as unknown as { PushManager?: unknown }).PushManager === "undefined") {
    return { supported: false, reason: "no_push_manager" };
  }
  if (
    (globalThis as unknown as { isSecureContext?: boolean }).isSecureContext === false
  ) {
    return { supported: false, reason: "insecure_context" };
  }
  return { supported: true };
}

export function isIosNonStandalone(): boolean {
  const nav = getNav();
  if (!nav) return false;
  const ua = nav.userAgent ?? "";
  const isIos = /iPhone|iPad|iPod/.test(ua);
  if (!isIos) return false;
  return nav.standalone !== true;
}

export function base64UrlToUint8Array(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function registerServiceWorker(): Promise<unknown | null> {
  const nav = getNav();
  if (!nav?.serviceWorker) return null;
  const existing = nav.serviceWorker.getRegistration
    ? await nav.serviceWorker.getRegistration()
    : null;
  if (existing) return existing;
  return nav.serviceWorker.register("/sw.js", { scope: "/" });
}

export type SubscribeResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "unsupported"
        | "permission_denied"
        | "permission_dismissed"
        | "public_key_unavailable"
        | "server_error";
    };

async function fetchPublicKey(): Promise<string | null> {
  const res = await fetch("/api/push/public-key");
  if (!res.ok) return null;
  const json = (await res.json()) as { key?: string };
  return json.key ?? null;
}

function subscriptionToBody(
  sub: PushSubscriptionLike,
): { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string } {
  if (sub.toJSON) {
    const j = sub.toJSON();
    if (j.endpoint && j.keys?.p256dh && j.keys?.auth) {
      return { endpoint: j.endpoint, keys: j.keys, userAgent: getNav()?.userAgent };
    }
  }
  const p256 = sub.getKey ? sub.getKey("p256dh") : null;
  const auth = sub.getKey ? sub.getKey("auth") : null;
  return {
    endpoint: sub.endpoint,
    keys: {
      p256dh: p256 ? bufferToBase64Url(p256) : "",
      auth: auth ? bufferToBase64Url(auth) : "",
    },
    userAgent: getNav()?.userAgent,
  };
}

export async function subscribeToPush(publicKey?: string): Promise<SubscribeResult> {
  const support = isPushSupported();
  if (!support.supported) return { ok: false, reason: "unsupported" };

  let key = publicKey;
  if (!key) {
    const fetched = await fetchPublicKey();
    if (!fetched) return { ok: false, reason: "public_key_unavailable" };
    key = fetched;
  }

  const Notif = (globalThis as unknown as { Notification: { requestPermission: () => Promise<NotificationPermission> } }).Notification;
  const permission = await Notif.requestPermission();
  if (permission === "denied") return { ok: false, reason: "permission_denied" };
  if (permission !== "granted") return { ok: false, reason: "permission_dismissed" };

  const nav = getNav()!;
  const reg = await nav.serviceWorker!.ready!;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(key),
  });

  const body = subscriptionToBody(sub);
  const res = await fetch("/api/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, reason: "server_error" };
  return { ok: true };
}

export type UnsubscribeResult =
  | { ok: true; alreadyUnsubscribed?: boolean }
  | { ok: false; reason: "unsupported" | "server_error" };

export async function unsubscribeFromPush(): Promise<UnsubscribeResult> {
  const nav = getNav();
  if (!nav?.serviceWorker) return { ok: false, reason: "unsupported" };
  const reg = await nav.serviceWorker.ready!;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { ok: true, alreadyUnsubscribed: true };
  if (sub.unsubscribe) await sub.unsubscribe();
  const res = await fetch("/api/push/subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  if (!res.ok && res.status !== 404) return { ok: false, reason: "server_error" };
  return { ok: true };
}
