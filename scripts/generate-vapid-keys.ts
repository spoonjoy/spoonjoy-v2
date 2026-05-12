/**
 * VAPID key generation script.
 *
 * Generates an ECDSA P-256 keypair for use as Web Push VAPID identifier.
 * Outputs a dotenv-style block to stdout suitable for piping into a `.env`
 * file or copying into `wrangler secret put`.
 *
 * Usage: `tsx scripts/generate-vapid-keys.ts`
 *
 * The public key is the base64url-encoded uncompressed P-256 point (65 bytes,
 * leading 0x04). The private key is the base64url-encoded raw 'd' component
 * (32 bytes). Both are SubtleCrypto-importable as JWK.
 */

export const DEFAULT_VAPID_SUBJECT = "mailto:ari@mendelow.me";

const BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;

export function isBase64Url(value: string): boolean {
  return BASE64URL_REGEX.test(value);
}

export function base64UrlToUint8Array(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export interface VapidPublicJwkComponents {
  x: string;
  y: string;
}

export interface VapidPrivateJwkComponents {
  d: string;
}

export interface VapidKeyPair {
  publicKey: string;
  privateKey: string;
  publicKeyJwk: VapidPublicJwkComponents;
  privateKeyJwk: VapidPrivateJwkComponents;
}

export async function generateVapidKeyPair(): Promise<VapidKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );

  const publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const privateJwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;

  const x = publicJwk.x ?? "";
  const y = publicJwk.y ?? "";
  const d = privateJwk.d ?? "";

  // Compose the uncompressed P-256 point: 0x04 || X || Y.
  const xBytes = base64UrlToUint8Array(x);
  const yBytes = base64UrlToUint8Array(y);
  const uncompressed = new Uint8Array(1 + xBytes.length + yBytes.length);
  uncompressed[0] = 0x04;
  uncompressed.set(xBytes, 1);
  uncompressed.set(yBytes, 1 + xBytes.length);

  return {
    publicKey: uint8ArrayToBase64Url(uncompressed),
    privateKey: d,
    publicKeyJwk: { x, y },
    privateKeyJwk: { d },
  };
}

export interface VapidEnvBlockInput {
  publicKey: string;
  privateKey: string;
  subject?: string;
}

export function formatVapidEnv(input: VapidEnvBlockInput): string {
  const subject = input.subject ?? DEFAULT_VAPID_SUBJECT;
  return [
    `VAPID_PUBLIC_KEY=${input.publicKey}`,
    `VAPID_PRIVATE_KEY=${input.privateKey}`,
    `VAPID_SUBJECT=${subject}`,
    "",
  ].join("\n");
}

const invokedAsCli =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /generate-vapid-keys(\.ts|\.js|\.mjs)?$/.test(process.argv[1]);

if (invokedAsCli) {
  void (async () => {
    const pair = await generateVapidKeyPair();
    process.stdout.write(
      formatVapidEnv({ publicKey: pair.publicKey, privateKey: pair.privateKey }),
    );
  })();
}
