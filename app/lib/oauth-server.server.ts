/**
 * Spoonjoy as an OAuth 2.1 authorization server for remote MCP connectors
 * (the claude.ai / Claude Desktop one-click connector).
 *
 * This module is the transport-agnostic core: client registration (RFC 7591
 * Dynamic Client Registration), the PKCE authorization-code lifecycle
 * (RFC 6749 + RFC 7636, S256 only), and scope handling. The HTTP routes layer
 * the OAuth wire format on top.
 *
 * Access tokens are long-lived `ApiCredential`s minted at the token endpoint
 * (see `createApiCredential`), so there are no refresh tokens — the
 * authorization code is the only short-lived, single-use secret here.
 */

import type { PrismaClient as PrismaClientType } from "@prisma/client";

type Database = PrismaClientType;

/** Scopes Spoonjoy understands, mirroring the agent-connection delegated grant. */
export const SUPPORTED_SCOPES = ["kitchen:read", "kitchen:write"] as const;
export const DEFAULT_SCOPE = "kitchen:read kitchen:write";

/** Authorization codes are single-use and expire fast (RFC 6749 §4.1.2). */
const AUTH_CODE_TTL_SECONDS = 60;

/** OAuth 2.1 error, carrying an RFC 6749 error code for the wire response. */
export class OAuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
    this.status = status;
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(prefix: string, byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return `${prefix}${base64UrlEncode(bytes)}`;
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(digest));
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Verify a PKCE `code_verifier` against the stored S256 `code_challenge`. */
export async function verifyPkceS256(verifier: string, challenge: string): Promise<boolean> {
  if (!verifier || !challenge) return false;
  return (await sha256Base64Url(verifier)) === challenge;
}

/** A redirect URI must be an absolute https URL (localhost allowed for dev). */
export function isValidRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

/**
 * Reduce a requested scope string to the supported subset. An empty/absent
 * request grants the default (read+write); an unsupported scope is rejected so
 * the client never silently gets less than it asked for.
 */
export function normalizeScope(requested: string | null | undefined): string {
  const trimmed = (requested ?? "").trim();
  if (!trimmed) return DEFAULT_SCOPE;
  const parts = trimmed.split(/\s+/);
  for (const part of parts) {
    if (!SUPPORTED_SCOPES.includes(part as (typeof SUPPORTED_SCOPES)[number])) {
      throw new OAuthError("invalid_scope", `Unsupported scope: ${part}`);
    }
  }
  return parts.join(" ");
}

export interface RegisteredOAuthClient {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
}

/**
 * Dynamic Client Registration. Validates that at least one well-formed
 * redirect URI is supplied, then persists the client and returns its id.
 */
export async function registerOAuthClient(
  db: Database,
  input: { clientName?: string | null; redirectUris: string[] },
): Promise<RegisteredOAuthClient> {
  const redirectUris = input.redirectUris.map((uri) => uri.trim()).filter(Boolean);
  if (redirectUris.length === 0) {
    throw new OAuthError("invalid_redirect_uri", "At least one redirect_uri is required");
  }
  for (const uri of redirectUris) {
    if (!isValidRedirectUri(uri)) {
      throw new OAuthError("invalid_redirect_uri", `Invalid redirect_uri: ${uri}`);
    }
  }

  const clientName = input.clientName?.trim() || null;
  const client = await db.oAuthClient.create({
    data: { clientName, redirectUris: redirectUris.join(" ") },
  });

  return { clientId: client.id, clientName: client.clientName, redirectUris };
}

/** Look up a registered client and its allowed redirect URIs. */
export async function getOAuthClient(
  db: Database,
  clientId: string,
): Promise<RegisteredOAuthClient | null> {
  if (!clientId) return null;
  const client = await db.oAuthClient.findUnique({ where: { id: clientId } });
  if (!client) return null;
  return {
    clientId: client.id,
    clientName: client.clientName,
    redirectUris: client.redirectUris.split(/\s+/).filter(Boolean),
  };
}

/** Whether `redirectUri` exactly matches one the client registered. */
export function clientAllowsRedirect(client: RegisteredOAuthClient, redirectUri: string): boolean {
  return client.redirectUris.includes(redirectUri);
}

export interface CreateAuthorizationCodeInput {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource?: string | null;
  ttlSeconds?: number;
  now?: Date;
}

/**
 * Mint a single-use authorization code after the user consents. Only the
 * SHA-256 of the code is stored, so a leaked database row can't be replayed.
 */
export async function createAuthorizationCode(
  db: Database,
  input: CreateAuthorizationCodeInput,
): Promise<string> {
  const now = input.now ?? new Date();
  const ttl = input.ttlSeconds ?? AUTH_CODE_TTL_SECONDS;
  const code = randomToken("oac_");
  await db.oAuthAuthCode.create({
    data: {
      codeHash: await sha256Hex(code),
      clientId: input.clientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      scope: input.scope,
      resource: input.resource ?? null,
      expiresAt: new Date(now.getTime() + ttl * 1000),
    },
  });
  return code;
}

export interface ConsumeAuthorizationCodeInput {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  now?: Date;
}

export interface ConsumedAuthorizationCode {
  userId: string;
  scope: string;
  resource: string | null;
}

/**
 * Exchange an authorization code for its grant. Enforces every binding from
 * RFC 6749 §4.1.3 + RFC 7636: the code exists, is unexpired and unconsumed, was
 * issued to this client + redirect URI, and the PKCE verifier matches. The code
 * is burned atomically so a replay can't double-spend it.
 */
export async function consumeAuthorizationCode(
  db: Database,
  input: ConsumeAuthorizationCodeInput,
): Promise<ConsumedAuthorizationCode> {
  const now = input.now ?? new Date();
  if (!input.code) throw new OAuthError("invalid_grant", "Missing authorization code");

  const record = await db.oAuthAuthCode.findUnique({
    where: { codeHash: await sha256Hex(input.code) },
  });
  if (!record) throw new OAuthError("invalid_grant", "Unknown authorization code");
  if (record.consumedAt) throw new OAuthError("invalid_grant", "Authorization code already used");
  if (record.expiresAt.getTime() <= now.getTime()) {
    throw new OAuthError("invalid_grant", "Authorization code expired");
  }
  if (record.clientId !== input.clientId) {
    throw new OAuthError("invalid_grant", "Authorization code was issued to a different client");
  }
  if (record.redirectUri !== input.redirectUri) {
    throw new OAuthError("invalid_grant", "redirect_uri does not match the authorization request");
  }
  if (!(await verifyPkceS256(input.codeVerifier, record.codeChallenge))) {
    throw new OAuthError("invalid_grant", "PKCE verification failed");
  }

  // Burn the code; the guard makes a concurrent second exchange a no-op.
  const burned = await db.oAuthAuthCode.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (burned.count !== 1) {
    throw new OAuthError("invalid_grant", "Authorization code already used");
  }

  return { userId: record.userId, scope: record.scope, resource: record.resource };
}
