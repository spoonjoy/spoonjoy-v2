// An Apple device's push token, kept so notifications can be sent to it through the push relay
// (docs/push-relay.md). It is kept sealed: encrypted with AES-GCM under a key derived from the
// deployment's SESSION_SECRET, which only the Worker holds, and bound to the device it was
// registered for (account, device id, platform and environment), so a sealed token copied to
// another device's row, or read under another secret, opens as nothing.
import { signedCookieSettings, type SessionEnv } from "~/lib/session.server";

/** The device a token was registered for. */
export interface NativePushDeviceKey {
  userId: string;
  deviceId: string;
  platform: string;
  environment: string;
}

/** The secret device tokens are sealed under: the deployment's SESSION_SECRET, required in production. */
export function nativePushTokenSecret(env: SessionEnv | null | undefined): string {
  return signedCookieSettings(env).secret;
}

// Changing this label makes every token sealed under the old one open as nothing.
const KEY_LABEL = "spoonjoy native push token v1";
const encoder = new TextEncoder();

async function sealingKey(secret: string): Promise<CryptoKey> {
  const root = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = new Uint8Array(await crypto.subtle.sign("HMAC", root, encoder.encode(KEY_LABEL)));
  return crypto.subtle.importKey("raw", derived, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function boundTo(device: NativePushDeviceKey): Uint8Array<ArrayBuffer> {
  return encoder.encode([device.userId, device.deviceId, device.platform, device.environment].join("\u0000"));
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** The token sealed for `device`, as text for the sealedToken column: `v1.<iv>.<ciphertext>`. */
export async function sealNativePushToken(secret: string, device: NativePushDeviceKey, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: boundTo(device) }, await sealingKey(secret), encoder.encode(token));
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(data))}`;
}

/** The token sealed for `device`, or null when there is none or this secret didn't seal it for that device. */
export async function openNativePushToken(secret: string, device: NativePushDeviceKey, sealed: string | null): Promise<string | null> {
  if (!sealed) return null;
  const [version, iv, data, extra] = sealed.split(".");
  if (version !== "v1" || !iv || !data || extra !== undefined) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(iv), additionalData: boundTo(device) },
      await sealingKey(secret),
      fromBase64(data),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
