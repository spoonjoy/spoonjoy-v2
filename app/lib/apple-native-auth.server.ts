import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { handleAppleOAuthCallback } from "~/lib/apple-oauth-callback.server";
import type { AppleUser } from "~/lib/apple-oauth.server";
import type { AppleNativeAuthConfig } from "~/lib/env.server";
import { issueConnectorTokens, normalizeScope, type IssuedConnectorTokens } from "~/lib/oauth-server.server";

type Database = PrismaClientType;

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";

export const NATIVE_APPLE_CLIENT_ID = "spoonjoy-apple-native";
export const NATIVE_APPLE_CLIENT_NAME = "Spoonjoy Apple";
export const NATIVE_APPLE_TOKEN_SCOPE = normalizeScope([
  "kitchen:read",
  "kitchen:write",
  "shopping_list:read",
  "shopping_list:write",
  "account:read",
  "account:write",
].join(" "));

interface AppleJwtHeader {
  alg?: string;
  kid?: string;
}

interface AppleIdTokenPayload {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  is_private_email?: string | boolean;
  nonce?: string;
}

interface AppleJsonWebKey {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

interface AppleJwks {
  keys?: AppleJsonWebKey[];
}

export interface NativeAppleCredentialInput {
  identityToken: string;
  rawNonce: string;
  fullName?: string | null;
  email?: string | null;
}

export interface NativeAppleAuthResult {
  action: "user_created" | "user_logged_in";
  userId: string;
  tokens: IssuedConnectorTokens;
}

export class NativeAppleAuthError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "NativeAppleAuthError";
    this.code = code;
    this.status = status;
  }
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64UrlDecodeJson<T>(value: string): T {
  const json = new TextDecoder().decode(base64UrlDecode(value));
  return JSON.parse(json) as T;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stringClaim(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolClaim(value: string | boolean | undefined): boolean {
  return value === true || value === "true";
}

async function importApplePublicKey(jwk: AppleJsonWebKey): Promise<CryptoKey> {
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) {
    throw new NativeAppleAuthError("invalid_apple_key", "Apple published an unsupported Sign in with Apple key.", 502);
  }
  return await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

async function appleJwks(fetcher: typeof fetch = fetch): Promise<AppleJwks> {
  const response = await fetcher(APPLE_JWKS_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new NativeAppleAuthError("apple_keys_unavailable", "Could not load Apple's Sign in with Apple keys.", 502);
  }
  return await response.json() as AppleJwks;
}

function assertAudience(payload: AppleIdTokenPayload, allowedClientIds: readonly string[]) {
  const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!audiences.some((audience) => allowedClientIds.includes(audience))) {
    throw new NativeAppleAuthError("invalid_audience", "Apple credential was not issued to Spoonjoy's native app.", 401);
  }
}

export async function verifyNativeAppleIdentityToken(
  input: NativeAppleCredentialInput,
  config: AppleNativeAuthConfig,
  options: { fetcher?: typeof fetch; now?: Date } = {},
): Promise<AppleUser> {
  const parts = input.identityToken.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new NativeAppleAuthError("invalid_identity_token", "Apple identity token is malformed.", 400);
  }
  if (!input.rawNonce.trim()) {
    throw new NativeAppleAuthError("invalid_nonce", "Apple sign-in nonce is required.", 400);
  }

  const header = base64UrlDecodeJson<AppleJwtHeader>(parts[0]);
  if (header.alg !== "RS256" || !header.kid) {
    throw new NativeAppleAuthError("invalid_identity_token", "Apple identity token uses an unsupported signing key.", 401);
  }

  const jwks = await appleJwks(options.fetcher);
  const jwk = jwks.keys?.find((key) => key.kid === header.kid);
  if (!jwk) {
    throw new NativeAppleAuthError("invalid_identity_token", "Apple identity token key is not currently trusted.", 401);
  }

  const signingInput = exactArrayBuffer(new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  const signature = exactArrayBuffer(base64UrlDecode(parts[2]));
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    await importApplePublicKey(jwk),
    signature,
    signingInput,
  );
  if (!validSignature) {
    throw new NativeAppleAuthError("invalid_identity_token", "Apple identity token signature is invalid.", 401);
  }

  const payload = base64UrlDecodeJson<AppleIdTokenPayload>(parts[1]);
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (payload.iss !== APPLE_ISSUER) {
    throw new NativeAppleAuthError("invalid_issuer", "Apple credential was issued by an unexpected identity provider.", 401);
  }
  assertAudience(payload, config.clientIds);
  if (!payload.exp || payload.exp <= nowSeconds) {
    throw new NativeAppleAuthError("expired_identity_token", "Apple identity token has expired.", 401);
  }
  if (payload.iat && payload.iat > nowSeconds + 300) {
    throw new NativeAppleAuthError("invalid_identity_token", "Apple identity token is not valid yet.", 401);
  }
  if (payload.nonce !== await sha256Hex(input.rawNonce)) {
    throw new NativeAppleAuthError("invalid_nonce", "Apple sign-in nonce did not match this app session.", 401);
  }

  const id = stringClaim(payload.sub);
  const email = stringClaim(payload.email) ?? stringClaim(input.email);
  if (!id || !email) {
    throw new NativeAppleAuthError("invalid_identity_token", "Apple identity token is missing required account claims.", 401);
  }

  return {
    id,
    email,
    emailVerified: boolClaim(payload.email_verified),
    isPrivateEmail: boolClaim(payload.is_private_email),
    firstName: null,
    lastName: null,
    fullName: stringClaim(input.fullName),
  };
}

export async function handleNativeAppleSignIn(
  db: Database,
  input: NativeAppleCredentialInput,
  config: AppleNativeAuthConfig,
  options: { fetcher?: typeof fetch; now?: Date } = {},
): Promise<NativeAppleAuthResult> {
  const appleUser = await verifyNativeAppleIdentityToken(input, config, options);
  const callback = await handleAppleOAuthCallback({
    db,
    appleUser,
    currentUserId: null,
    redirectTo: null,
  });
  if (!callback.success || !callback.userId) {
    throw new NativeAppleAuthError(callback.error ?? "apple_sign_in_failed", callback.message ?? "Apple sign-in failed.", 409);
  }

  const action = callback.action === "user_created" ? "user_created" : "user_logged_in";
  await db.oAuthClient.upsert({
    where: { id: NATIVE_APPLE_CLIENT_ID },
    create: {
      id: NATIVE_APPLE_CLIENT_ID,
      clientName: NATIVE_APPLE_CLIENT_NAME,
      redirectUris: "spoonjoy-native://apple-sign-in",
    },
    update: {
      clientName: NATIVE_APPLE_CLIENT_NAME,
    },
  });
  const tokens = await issueConnectorTokens(db, {
    userId: callback.userId,
    clientId: NATIVE_APPLE_CLIENT_ID,
    scope: NATIVE_APPLE_TOKEN_SCOPE,
    resource: null,
    now: options.now,
  });

  return { action, userId: callback.userId, tokens };
}
