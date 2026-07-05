/**
 * Spoonjoy as an OAuth 2.1 authorization server for remote MCP connectors
 * (the claude.ai / Claude Desktop one-click connector).
 *
 * This module is the transport-agnostic core: client registration (RFC 7591
 * Dynamic Client Registration), the PKCE authorization-code lifecycle
 * (RFC 6749 + RFC 7636, S256 only), and scope handling. The HTTP routes layer
 * the OAuth wire format on top.
 *
 * Access tokens are `ApiCredential`s minted at the token endpoint (see
 * `createApiCredential`). Generic OAuth app credentials expire quickly and
 * refresh through rotating `refresh_token` values; MCP-bound credentials stay
 * valid until the user disconnects the connection.
 */

import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { createApiCredential } from "~/lib/api-auth.server";

type Database = PrismaClientType;

/** Scopes Spoonjoy understands for delegated OAuth consent. */
export const SUPPORTED_SCOPES = [
  "account:read",
  "account:write",
  "cookbooks:read",
  "kitchen:read",
  "kitchen:write",
  "public:read",
  "recipes:read",
  "shopping_list:read",
  "shopping_list:write",
] as const;
export const DEFAULT_SCOPE = "kitchen:read";

/** Authorization codes are single-use and expire fast (RFC 6749 §4.1.2). */
const AUTH_CODE_TTL_SECONDS = 60;

/** Generic OAuth access tokens are short-lived. MCP credentials are durable. */
export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

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
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
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
  if (url.hash || url.username || url.password || url.hostname.includes("*")) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

/**
 * Reduce a requested scope string to the supported subset. An empty/absent
 * request grants the read-only default; an unsupported scope is rejected so
 * the client never silently gets less than it asked for.
 */
export function normalizeScope(requested: string | null | undefined): string {
  const trimmed = (requested ?? "").trim();
  if (!trimmed) return DEFAULT_SCOPE;
  const parts = Array.from(new Set(trimmed.split(/\s+/)));
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

export interface IssuedConnectorTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number | null;
  scope: string;
  resource: string | null;
}

function oauthCredentialName(clientName: string | null | undefined): string {
  return `${clientName?.trim() || "OAuth client"} (OAuth)`;
}

function isMcpProtectedResource(resource: string | null | undefined): boolean {
  if (!resource) return false;
  try {
    return new URL(resource).pathname === "/mcp";
  } catch {
    return false;
  }
}

/**
 * Mint a fresh access token plus a refresh token bound to the same
 * user/client/scope. Used by both the authorization_code grant and refresh
 * rotation.
 */
export async function issueConnectorTokens(
  db: Database,
  input: { userId: string; clientId: string; scope: string; resource?: string | null; now?: Date; connectionKey?: string | null },
): Promise<IssuedConnectorTokens> {
  const now = input.now ?? new Date();
  const client = await getOAuthClient(db, input.clientId);
  const connectionKey = input.connectionKey ?? randomToken("ocn_", 16);
  const persistentAccessToken = isMcpProtectedResource(input.resource ?? null);
  const expiresIn = persistentAccessToken ? null : OAUTH_ACCESS_TOKEN_TTL_SECONDS;
  const { token: accessToken } = await createApiCredential(
    db,
    input.userId,
    oauthCredentialName(client?.clientName),
    {
      expiresAt: expiresIn === null ? null : new Date(now.getTime() + expiresIn * 1000),
      scopes: input.scope,
      oauthClientId: input.clientId,
      oauthResource: input.resource ?? null,
    },
  );
  const refreshToken = randomToken("ort_");
  await db.oAuthRefreshToken.create({
    data: {
      tokenHash: await sha256Hex(refreshToken),
      userId: input.userId,
      clientId: input.clientId,
      scope: input.scope,
      resource: input.resource ?? null,
      connectionKey,
    },
  });
  return {
    accessToken,
    refreshToken,
    expiresIn,
    scope: input.scope,
    resource: input.resource ?? null,
  };
}

/** Revoke one rotating OAuth refresh token for native/extension disconnect flows. */
export async function revokeConnectorRefreshToken(
  db: Database,
  input: { refreshToken: string; clientId?: string; now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  if (!input.refreshToken) throw new OAuthError("invalid_request", "Missing refresh token");

  const record = await db.oAuthRefreshToken.findUnique({
    where: { tokenHash: await sha256Hex(input.refreshToken) },
  });
  if (!record) return false;
  if (input.clientId && record.clientId !== input.clientId) {
    throw new OAuthError("invalid_grant", "Refresh token was issued to a different client");
  }
  if (record.revokedAt) return false;

  await db.oAuthRefreshToken.update({
    where: { id: record.id },
    data: { revokedAt: now },
  });
  await db.apiCredential.updateMany({
    where: {
      userId: record.userId,
      oauthClientId: record.clientId,
      oauthResource: record.resource,
      revokedAt: null,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    },
    data: { revokedAt: now },
  });
  return true;
}

/**
 * Exchange a refresh token for a new token pair (RFC 6749 §6) with rotation:
 * the presented token is atomically revoked and a new pair issued, so a
 * replayed refresh token is rejected.
 */
export async function rotateConnectorTokens(
  db: Database,
  input: { refreshToken: string; clientId: string; now?: Date },
): Promise<IssuedConnectorTokens> {
  const now = input.now ?? new Date();
  if (!input.refreshToken) throw new OAuthError("invalid_grant", "Missing refresh token");

  const record = await db.oAuthRefreshToken.findUnique({
    where: { tokenHash: await sha256Hex(input.refreshToken) },
  });
  if (!record || record.revokedAt) {
    throw new OAuthError("invalid_grant", "Unknown or revoked refresh token");
  }
  if (record.clientId !== input.clientId) {
    throw new OAuthError("invalid_grant", "Refresh token was issued to a different client");
  }

  const revoked = await db.oAuthRefreshToken.updateMany({
    where: { id: record.id, revokedAt: null },
    data: { revokedAt: now },
  });
  if (revoked.count !== 1) {
    throw new OAuthError("invalid_grant", "Refresh token already used");
  }

  return issueConnectorTokens(db, {
    userId: record.userId,
    clientId: record.clientId,
    scope: record.scope,
    resource: record.resource,
    now,
    connectionKey: record.connectionKey ?? record.id,
  });
}
