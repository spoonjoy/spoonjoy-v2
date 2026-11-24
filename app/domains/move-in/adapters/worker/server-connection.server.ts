// A move-in from the other app's server keeps the cook's address and API token in storage until it finishes. They are
// kept sealed: encrypted with AES-GCM under a key derived from the deployment's SESSION_SECRET, which only the Worker
// holds, and bound to the storage key they were written under, so a copy read elsewhere, or moved to another job's
// key, opens as nothing. A finished or failed move-in deletes them (run-move-in.ts's discard), and the archive sweep
// deletes any a quiet job left behind.
import { signedCookieSettings, type SessionEnv } from "~/lib/session.server";

/** Where the server is, and the cook's token for it. */
export interface ServerConnection {
  address: string;
  token: string;
}

/** The secret a server connection is sealed under: the deployment's SESSION_SECRET, required in production. */
export function serverConnectionSecret(env: SessionEnv | null | undefined): string {
  return signedCookieSettings(env).secret;
}

// Changing this label makes every connection sealed under the old one open as nothing.
const KEY_LABEL = "spoonjoy move-in server connection v1";
const encoder = new TextEncoder();

async function sealingKey(secret: string): Promise<CryptoKey> {
  const root = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = new Uint8Array(await crypto.subtle.sign("HMAC", root, encoder.encode(KEY_LABEL)));
  return crypto.subtle.importKey("raw", derived, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** The connection sealed for storage at `storageKey`. */
export async function sealServerConnection(secret: string, storageKey: string, connection: ServerConnection): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(storageKey) },
    await sealingKey(secret),
    encoder.encode(JSON.stringify({ address: connection.address, token: connection.token })),
  );
  return encoder.encode(JSON.stringify({ sealed: 1, iv: toBase64(iv), data: toBase64(new Uint8Array(data)) }));
}

/**
 * The connection sealed at `storageKey`, or null when the bytes aren't one this secret sealed there: another secret,
 * another key, a change to any byte, or a connection kept in the clear before they were sealed.
 */
export async function openServerConnection(secret: string, storageKey: string, bytes: Uint8Array): Promise<ServerConnection | null> {
  try {
    const stored = JSON.parse(new TextDecoder().decode(bytes)) as { sealed?: unknown; iv?: unknown; data?: unknown };
    if (stored.sealed !== 1 || typeof stored.iv !== "string" || typeof stored.data !== "string") return null;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(stored.iv), additionalData: encoder.encode(storageKey) },
      await sealingKey(secret),
      fromBase64(stored.data),
    );
    // Only sealServerConnection writes what opens here, so it is the address and token it sealed.
    const { address, token } = JSON.parse(new TextDecoder().decode(plain)) as ServerConnection;
    return { address, token };
  } catch {
    return null;
  }
}
