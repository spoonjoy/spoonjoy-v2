import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { retryD1Write } from "~/lib/d1-write-retry.server";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { normalizeCredentialScopes } from "~/lib/api-auth.server";
import { handleAppleOAuthCallback } from "~/lib/apple-oauth-callback.server";
import type { AppleUser } from "~/lib/apple-oauth.server";
import {
  APPLE_EMAIL_UNAVAILABLE,
  tryCreatePendingAppleLink,
  PENDING_APPLE_LINK_MESSAGE,
  type PendingAppleLink,
} from "~/lib/pending-apple-link.server";
import type { AppleNativeAuthConfig } from "~/lib/env.server";
import {
  issueConnectorTokens,
  requireSessionVersionFence,
  SPOONJOY_APPLE_NATIVE_CLIENT_ID,
  type IssuedConnectorTokens,
} from "~/lib/oauth-server.server";

type Database = PrismaClientType;

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";

export const NATIVE_APPLE_CLIENT_ID = SPOONJOY_APPLE_NATIVE_CLIENT_ID;
export const NATIVE_APPLE_CLIENT_NAME = "Spoonjoy Apple";
const NATIVE_APPLE_TOKEN_SCOPES = [
  "kitchen:read",
  "kitchen:write",
  "shopping_list:read",
  "shopping_list:write",
  "account:read",
  "account:write",
] as const;
normalizeCredentialScopes([...NATIVE_APPLE_TOKEN_SCOPES]);
export const NATIVE_APPLE_TOKEN_SCOPE = NATIVE_APPLE_TOKEN_SCOPES.join(" ");

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
  /** Accepted from the app for compatibility and ignored: only the token's verified email counts. */
  email?: string | null;
}

/**
 * A verified native Apple identity. `email` is null when Apple's token carries none: Apple puts the
 * address in a returning Apple ID's token only when the app's first authorization shared it, and
 * a reauthentication that asks for no scopes gets no address either.
 */
export type NativeAppleUser = AppleUser;

export interface NativeAppleAuthResult {
  action: "user_created" | "user_logged_in";
  userId: string;
  clientId: string;
  tokens: IssuedConnectorTokens;
}

export class NativeAppleAuthError extends Error {
  status: number;
  code: string;
  /** Set when the Apple ID verified but carried no email and matched no account. */
  pendingLink?: PendingAppleLink;

  constructor(code: string, message: string, status = 400, pendingLink?: PendingAppleLink) {
    super(message);
    this.name = "NativeAppleAuthError";
    this.code = code;
    this.status = status;
    this.pendingLink = pendingLink;
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

export async function nativeAppleOAuthClientId(issuer: string): Promise<string> {
  return issuer === "https://spoonjoy.app"
    ? NATIVE_APPLE_CLIENT_ID
    : `${NATIVE_APPLE_CLIENT_ID}:${await sha256Hex(issuer)}`;
}

export async function ensureNativeAppleOAuthClient(
  db: Database,
  issuer: string,
): Promise<string> {
  const clientId = await nativeAppleOAuthClientId(issuer);
  // An upsert by its fixed id, so after a transient D1 error it simply runs again.
  await retryD1Write({ scope: "oauth.ensure_native_client" }, () => db.oAuthClient.upsert({
    where: { id: clientId },
    create: {
      id: clientId,
      clientName: NATIVE_APPLE_CLIENT_NAME,
      redirectUris: "spoonjoy-native://apple-sign-in spoonjoy-native://password-sign-in",
      issuer,
    },
    update: {
      clientName: NATIVE_APPLE_CLIENT_NAME,
    },
  }));
  return clientId;
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
    throw new NativeAppleAuthError("apple_keys_unavailable", "Apple's Sign in with Apple key server didn't answer, so Spoonjoy can't check this sign-in.", 502);
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
): Promise<NativeAppleUser> {
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
  if (!id) {
    throw new NativeAppleAuthError("invalid_identity_token", "Apple identity token is missing required account claims.", 401);
  }
  // Apple vouches only for the email in its signed token, and only when it marks it verified.
  // An address the app sent in the request body is never used (#675), and an unverified one in
  // the token is dropped, so neither can match or create an account.
  const emailVerified = boolClaim(payload.email_verified);
  const email = emailVerified ? stringClaim(payload.email) : null;

  return {
    id,
    email,
    emailVerified: email !== null,
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
  options: { issuer: string; fetcher?: typeof fetch; now?: Date; d1?: D1ReadDatabase | null },
): Promise<NativeAppleAuthResult> {
  const verified = await verifyNativeAppleIdentityToken(input, config, {
    fetcher: options.fetcher,
    now: options.now,
  });
  const callback = await handleAppleOAuthCallback({
    db,
    d1: options.d1,
    appleUser: verified,
    currentUserId: null,
    redirectTo: null,
  });
  if (callback.error === APPLE_EMAIL_UNAVAILABLE) {
    // A verified Apple ID with no email and no linked account: keep it as a pending link the app
    // sends back with its next sign-in by another method, which then links Apple to that account.
    // If the link can't be saved, the chef still gets the explanation, just without a token.
    const pendingLink = await tryCreatePendingAppleLink(db, {
      appleSub: verified.id,
      providerUsername: verified.fullName,
    }, { now: options.now });
    throw new NativeAppleAuthError(APPLE_EMAIL_UNAVAILABLE, PENDING_APPLE_LINK_MESSAGE, 409, pendingLink ?? undefined);
  }
  if (!callback.success || !callback.userId) {
    throw new NativeAppleAuthError(callback.error ?? "apple_sign_in_failed", callback.message ?? "Apple sign-in didn't finish: Spoonjoy returned no account for it.", 409);
  }

  const action = callback.action === "user_created" ? "user_created" : "user_logged_in";
  const sessionVersion = await requireSessionVersionFence(db, callback.userId);
  const clientId = await ensureNativeAppleOAuthClient(
    db,
    options.issuer,
  );
  // Sign out everywhere or a password change that lands part way through refuses this sign-in
  // (an OAuthError with reason `revoked_by_user`, which the API asks the chef to retry).
  const tokens = await issueConnectorTokens(db, {
    userId: callback.userId,
    clientId,
    scope: NATIVE_APPLE_TOKEN_SCOPE,
    resource: null,
    issuer: options.issuer,
    now: options.now,
    sessionVersion,
  });

  return { action, userId: callback.userId, clientId, tokens };
}
