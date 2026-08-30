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

import type { OAuthRefreshToken as OAuthRefreshTokenRecord, PrismaClient as PrismaClientType } from "@prisma/client";
import { createApiCredential, normalizeCredentialScopes } from "~/lib/api-auth.server";
import {
  hasProhibitedOAuthClientNameCharacters,
  MAX_OAUTH_CLIENT_NAME_CODE_POINTS,
} from "~/lib/oauth-client-metadata";

type Database = PrismaClientType;

export type OAuthPersistenceStage =
  | "code_consumption"
  | "access_insert"
  | "refresh_insert"
  | "parent_revoke"
  | "replacement_insert"
  | "legacy_resource_refresh"
  | "legacy_resource_access"
  | "legacy_resource_grant"
  | "disconnect_refresh_revoke"
  | "disconnect_access_revoke";

export type OAuthPersistenceTiming = "before" | "after";

export interface OAuthPersistenceDependencies {
  onPersistenceMutation?: (
    stage: OAuthPersistenceStage,
    timing: OAuthPersistenceTiming,
  ) => void | Promise<void>;
}

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
// Each refresh ownership query binds every key twice (connectionKey + legacy id).
// D1 allows 100 bound parameters, so 32 leaves headroom for fixed predicates,
// mutation values, and adapter-added pagination bindings.
export const OAUTH_CONNECTION_KEY_BATCH_SIZE = 32;

export function oauthRefreshConnectionOwnership(connectionKeys: string[]) {
  return {
    OR: [
      { connectionKey: { in: connectionKeys } },
      { connectionKey: null, id: { in: connectionKeys } },
    ],
  };
}

export function oauthAccessConnectionOwnership(connectionKeys: string[], legacyCutoff: Date) {
  return {
    OR: [
      { oauthConnectionKey: { in: connectionKeys } },
      { oauthConnectionKey: null, createdAt: { lte: legacyCutoff } },
    ],
  };
}

interface ConnectorGrantConnectionIdentity {
  userId: string;
  clientId: string;
  issuer: string;
  resource: string | null;
  connectionKeys: string[];
}

export async function validateConnectorGrantConnectionKeys(
  db: Database,
  input: ConnectorGrantConnectionIdentity,
): Promise<void> {
  if (input.connectionKeys.length === 0) return;
  const linkedGrants = await db.oAuthGrant.findMany({
    where: { connectionKey: { in: input.connectionKeys } },
  });
  if (linkedGrants.some((grant) => grant.userId !== input.userId
    || grant.clientId !== input.clientId
    || grant.issuer !== input.issuer
    || grant.resource !== input.resource)) {
    throw new OAuthError("invalid_grant", "OAuth grant identity does not match the connector");
  }
}

export async function revokeConnectorGrantsByConnectionKeys(
  db: Database,
  input: ConnectorGrantConnectionIdentity & {
    now: Date;
  },
): Promise<number> {
  if (input.connectionKeys.length === 0) return 0;
  await validateConnectorGrantConnectionKeys(db, input);
  const result = await db.oAuthGrant.updateMany({
    where: {
      userId: input.userId,
      clientId: input.clientId,
      issuer: input.issuer,
      resource: input.resource,
      connectionKey: { in: input.connectionKeys },
      status: "active",
    },
    data: {
      status: "revoked",
      statusReason: "disconnect",
      statusChangedAt: input.now,
    },
  });
  return result.count;
}

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

export function createOAuthOpaqueToken(prefix: string, byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return `${prefix}${base64UrlEncode(bytes)}`;
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function hashOAuthOpaqueToken(input: string): Promise<string> {
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
  issuer: string;
}

export const CLAUDE_MCP_CLIENT_NAME = "Claude";
export const CLAUDE_MCP_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
export const SPOONJOY_APPLE_OAUTH_CLIENT_NAME = "Spoonjoy Apple";
export const SPOONJOY_APPLE_OAUTH_REDIRECT_URI = "https://spoonjoy.app/oauth/callback";

export function isCanonicalOAuthClientRegistration(
  client: RegisteredOAuthClient | null | undefined,
  clientName: string,
  redirectUri: string,
): boolean {
  return client?.clientName?.trim().toLowerCase() === clientName.toLowerCase()
    && client.redirectUris.length === 1
    && client.redirectUris[0] === redirectUri;
}

export function isClaudeMcpOAuthClient(client: RegisteredOAuthClient | null | undefined): boolean {
  return isCanonicalOAuthClientRegistration(client, CLAUDE_MCP_CLIENT_NAME, CLAUDE_MCP_REDIRECT_URI);
}

export function validateOAuthClientRegistration(input: {
  clientName?: string | null;
  redirectUris: string[];
}): { clientName: string | null; redirectUris: string[] } {
  const redirectUris = input.redirectUris.map((uri) => uri.trim()).filter(Boolean);
  if (redirectUris.length === 0) {
    throw new OAuthError("invalid_redirect_uri", "At least one redirect_uri is required");
  }
  for (const uri of redirectUris) {
    if (!isValidRedirectUri(uri)) {
      throw new OAuthError("invalid_redirect_uri", `Invalid redirect_uri: ${uri}`);
    }
  }
  if (new Set(redirectUris).size !== redirectUris.length) {
    throw new OAuthError("invalid_client_metadata", "redirect_uris must not contain duplicates");
  }

  const clientName = input.clientName?.trim() || null;
  if (clientName) {
    if (
      Array.from(clientName).length > MAX_OAUTH_CLIENT_NAME_CODE_POINTS
      || hasProhibitedOAuthClientNameCharacters(clientName)
    ) {
      throw new OAuthError(
        "invalid_client_metadata",
        `client_name must be at most ${MAX_OAUTH_CLIENT_NAME_CODE_POINTS} Unicode code points and contain no control or bidirectional formatting characters`,
      );
    }
    const reservedRegistration = [
      [CLAUDE_MCP_CLIENT_NAME, CLAUDE_MCP_REDIRECT_URI],
      [SPOONJOY_APPLE_OAUTH_CLIENT_NAME, SPOONJOY_APPLE_OAUTH_REDIRECT_URI],
    ].find(([reservedName]) => clientName.toLowerCase() === reservedName.toLowerCase());
    if (
      reservedRegistration
      && (redirectUris.length !== 1 || redirectUris[0] !== reservedRegistration[1])
    ) {
      throw new OAuthError(
        "invalid_client_metadata",
        `${reservedRegistration[0]} must use its canonical redirect_uri`,
      );
    }
  }
  return { clientName, redirectUris };
}

/**
 * Dynamic Client Registration. Validates that at least one well-formed
 * redirect URI is supplied, then persists the client and returns its id.
 */
export async function registerOAuthClient(
  db: Database,
  input: { clientName?: string | null; redirectUris: string[]; issuer: string },
): Promise<RegisteredOAuthClient> {
  const { clientName, redirectUris } = validateOAuthClientRegistration(input);
  const client = await db.oAuthClient.create({
    data: {
      clientName,
      redirectUris: redirectUris.join(" "),
      issuer: input.issuer,
    },
  });

  return { clientId: client.id, clientName: client.clientName, redirectUris, issuer: input.issuer };
}

/** Look up a registered client and its allowed redirect URIs. */
export async function getOAuthClient(
  db: Database,
  clientId: string,
  issuer: string,
): Promise<RegisteredOAuthClient | null> {
  if (!clientId) return null;
  let client = await db.oAuthClient.findFirst({
    where: { id: clientId, issuer, revokedAt: null },
  });
  if (!client) {
    await db.oAuthClient.updateMany({
      where: { id: clientId, issuer: null, revokedAt: null },
      data: { issuer },
    });
    client = await db.oAuthClient.findFirst({
      where: { id: clientId, issuer, revokedAt: null },
    });
  }
  if (!client) return null;
  return {
    clientId: client.id,
    clientName: client.clientName,
    redirectUris: client.redirectUris.split(/\s+/).filter(Boolean),
    issuer,
  };
}

/** Bind pre-issuer connector rows to this deployment's configured issuer once. */
export async function promoteLegacyOAuthIssuerForUser(
  db: Database,
  userId: string,
  issuer: string,
): Promise<void> {
  const [refreshRows, credentialRows] = await Promise.all([
    db.oAuthRefreshToken.findMany({ where: { userId, issuer: null }, select: { clientId: true } }),
    db.apiCredential.findMany({
      where: { userId, oauthClientId: { not: null }, oauthIssuer: null },
      select: { oauthClientId: true },
    }),
  ]);
  const clientIds = [...new Set([
    ...refreshRows.map((row) => row.clientId),
    ...credentialRows.map((row) => row.oauthClientId!),
  ])];
  if (clientIds.length === 0) return;

  await db.oAuthClient.updateMany({
    where: { id: { in: clientIds }, issuer: null },
    data: { issuer },
  });
  const boundClientIds = (await db.oAuthClient.findMany({
    where: { id: { in: clientIds }, issuer },
    select: { id: true },
  })).map((client) => client.id);
  if (boundClientIds.length === 0) return;

  await Promise.all([
    db.oAuthRefreshToken.updateMany({
      where: { userId, clientId: { in: boundClientIds }, issuer: null },
      data: { issuer },
    }),
    db.apiCredential.updateMany({
      where: { userId, oauthClientId: { in: boundClientIds }, oauthIssuer: null },
      data: { oauthIssuer: issuer },
    }),
  ]);
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
  issuer: string;
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
  const code = createOAuthOpaqueToken("oac_");
  await db.oAuthAuthCode.create({
    data: {
      codeHash: await hashOAuthOpaqueToken(code),
      clientId: input.clientId,
      issuer: input.issuer,
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
  issuer: string;
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
  dependencies: OAuthPersistenceDependencies = {},
): Promise<ConsumedAuthorizationCode> {
  const now = input.now ?? new Date();
  if (!input.code) throw new OAuthError("invalid_grant", "Missing authorization code");
  let record = await db.oAuthAuthCode.findUnique({
    where: { codeHash: await hashOAuthOpaqueToken(input.code) },
  });
  if (!record) throw new OAuthError("invalid_grant", "Unknown authorization code");
  if (record.consumedAt) throw new OAuthError("invalid_grant", "Authorization code already used");
  if (record.expiresAt.getTime() <= now.getTime()) {
    throw new OAuthError("invalid_grant", "Authorization code expired");
  }
  if (record.clientId !== input.clientId) {
    throw new OAuthError("invalid_grant", "Authorization code was issued to a different client");
  }
  if (record.issuer !== null && record.issuer !== input.issuer) {
    throw new OAuthError("invalid_grant", "Authorization code was issued by a different issuer");
  }
  if (!await getOAuthClient(db, input.clientId, input.issuer)) {
    throw new OAuthError("invalid_client", "Unknown or revoked OAuth client");
  }
  if (record.issuer === null) {
    await db.oAuthAuthCode.updateMany({ where: { id: record.id, issuer: null }, data: { issuer: input.issuer } });
    record = await db.oAuthAuthCode.findUniqueOrThrow({ where: { id: record.id } });
  }
  /* istanbul ignore if -- @preserve issuer promotion above must converge; retain a fail-closed guard for concurrent corruption. */
  if (record.issuer !== input.issuer) {
    throw new OAuthError("invalid_grant", "Authorization code was issued by a different issuer");
  }
  if (record.redirectUri !== input.redirectUri) {
    throw new OAuthError("invalid_grant", "redirect_uri does not match the authorization request");
  }
  if (!(await verifyPkceS256(input.codeVerifier, record.codeChallenge))) {
    throw new OAuthError("invalid_grant", "PKCE verification failed");
  }

  // Burn the code; the guard makes a concurrent second exchange a no-op.
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("code_consumption", "before");
  }
  const burned = await db.oAuthAuthCode.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (burned.count !== 1) {
    throw new OAuthError("invalid_grant", "Authorization code already used");
  }
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("code_consumption", "after");
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

function grantIdentityMatches(
  grant: {
    userId: string;
    clientId: string;
    issuer: string;
    resource: string | null;
    scope: string;
    connectionKey: string;
  },
  input: {
    userId: string;
    clientId: string;
    issuer: string;
    resource: string | null;
    scope: string;
    connectionKey: string;
  },
): boolean {
  return grant.userId === input.userId
    && grant.clientId === input.clientId
    && grant.issuer === input.issuer
    && grant.resource === input.resource
    && grant.scope === input.scope
    && grant.connectionKey === input.connectionKey;
}

function grantMatches(
  grant: Parameters<typeof grantIdentityMatches>[0] & { status: string },
  input: Parameters<typeof grantIdentityMatches>[1],
): boolean {
  return grantIdentityMatches(grant, input) && grant.status === "active";
}

async function requireLinkedConnectorGrant(
  db: Database,
  record: {
    grantId: string | null;
    userId: string;
    clientId: string;
    issuer: string | null;
    resource: string | null;
    scope: string;
    connectionKey: string | null;
  },
  allowDisconnected = false,
) {
  if (!record.grantId) return null;
  if (!record.issuer || !record.connectionKey) {
    throw new OAuthError("invalid_grant", "Linked OAuth token identity is incomplete");
  }
  const grant = await db.oAuthGrant.findUnique({ where: { id: record.grantId } });
  const expected = {
    userId: record.userId,
    clientId: record.clientId,
    issuer: record.issuer,
    resource: record.resource,
    scope: normalizeCredentialScopes(record.scope),
    connectionKey: record.connectionKey,
  };
  const permittedStatus = grant?.status === "active"
    || (allowDisconnected && grant?.status === "revoked" && grant.statusReason === "disconnect");
  if (!grant || !grantIdentityMatches(grant, expected) || !permittedStatus) {
    throw new OAuthError("invalid_grant", "OAuth grant identity does not match the connector");
  }
  return grant;
}

async function convergeLinkedLegacyMcpResource(
  db: Database,
  record: OAuthRefreshTokenRecord,
  grantId: string,
  resource: string,
  dependencies: OAuthPersistenceDependencies,
): Promise<OAuthRefreshTokenRecord> {
  if (!record.issuer || !record.connectionKey) {
    throw new OAuthError("invalid_grant", "Linked OAuth token identity is incomplete");
  }
  const canonicalScope = normalizeCredentialScopes(record.scope);
  const [grant, credentials] = await Promise.all([
    db.oAuthGrant.findUnique({ where: { id: grantId } }),
    db.apiCredential.findMany({ where: { oauthGrantId: grantId } }),
  ]);
  const allowedResources = new Set([null, resource]);
  const grantMatchesExceptResource = grant
    && grant.userId === record.userId
    && grant.clientId === record.clientId
    && grant.issuer === record.issuer
    && grant.scope === canonicalScope
    && grant.connectionKey === record.connectionKey
    && grant.status === "active";
  const credentialsMatchExceptResource = credentials.every((credential) =>
    credential.userId === record.userId
    && credential.oauthClientId === record.clientId
    && credential.oauthIssuer === record.issuer
    && credential.scopes === canonicalScope
    && credential.oauthConnectionKey === record.connectionKey
    && allowedResources.has(credential.oauthResource));
  if (!grantMatchesExceptResource
    || !allowedResources.has(record.resource)
    || !allowedResources.has(grant.resource)
    || !credentialsMatchExceptResource) {
    throw new OAuthError("invalid_grant", "OAuth grant identity does not match the connector");
  }

  if (record.resource === null) {
    await dependencies.onPersistenceMutation?.("legacy_resource_refresh", "before");
    const promoted = await db.oAuthRefreshToken.updateMany({
      where: {
        id: record.id,
        userId: record.userId,
        clientId: record.clientId,
        issuer: record.issuer,
        resource: null,
        scope: record.scope,
        connectionKey: record.connectionKey,
        grantId,
        revokedAt: null,
      },
      data: { resource },
    });
    if (promoted.count !== 1) {
      throw new OAuthError("invalid_grant", "OAuth refresh resource promotion did not converge");
    }
    await dependencies.onPersistenceMutation?.("legacy_resource_refresh", "after");
  }

  if (credentials.some((credential) => credential.oauthResource === null)) {
    await dependencies.onPersistenceMutation?.("legacy_resource_access", "before");
    await db.apiCredential.updateMany({
      where: {
        userId: record.userId,
        oauthClientId: record.clientId,
        oauthIssuer: record.issuer,
        oauthConnectionKey: record.connectionKey,
        oauthGrantId: grantId,
        oauthResource: null,
      },
      data: { oauthResource: resource },
    });
    await dependencies.onPersistenceMutation?.("legacy_resource_access", "after");
  }

  if (grant.resource === null) {
    await dependencies.onPersistenceMutation?.("legacy_resource_grant", "before");
    const promoted = await db.oAuthGrant.updateMany({
      where: {
        id: grantId,
        userId: record.userId,
        clientId: record.clientId,
        issuer: record.issuer,
        resource: null,
        scope: canonicalScope,
        connectionKey: record.connectionKey,
        status: "active",
      },
      data: { resource },
    });
    if (promoted.count !== 1) {
      throw new OAuthError("invalid_grant", "OAuth grant resource promotion did not converge");
    }
    await dependencies.onPersistenceMutation?.("legacy_resource_grant", "after");
  }

  const converged = await db.oAuthRefreshToken.findUniqueOrThrow({ where: { id: record.id } });
  await requireLinkedConnectorGrant(db, converged);
  const unconvergedCredential = await db.apiCredential.findFirst({
    where: {
      oauthGrantId: grantId,
      OR: [
        { oauthResource: null },
        { oauthResource: { not: resource } },
      ],
    },
    select: { id: true },
  });
  if (unconvergedCredential) {
    throw new OAuthError("invalid_grant", "OAuth access resource promotion did not converge");
  }
  return converged;
}

async function resolveConnectorGrant(
  db: Database,
  input: {
    userId: string;
    clientId: string;
    issuer: string;
    resource: string | null;
    scope: string;
    connectionKey: string;
    grantId?: string | null;
    now: Date;
  },
): Promise<string> {
  const existing = input.grantId
    ? await db.oAuthGrant.findUnique({ where: { id: input.grantId } })
    : await db.oAuthGrant.findUnique({ where: { connectionKey: input.connectionKey } });
  if (existing) {
    if (!grantMatches(existing, input)) {
      throw new OAuthError("invalid_grant", "OAuth grant identity does not match the connector");
    }
    return existing.id;
  }
  if (input.grantId) {
    throw new OAuthError("invalid_grant", "OAuth grant no longer exists");
  }
  const created = await db.oAuthGrant.create({
    data: {
      userId: input.userId,
      clientId: input.clientId,
      issuer: input.issuer,
      resource: input.resource,
      scope: input.scope,
      connectionKey: input.connectionKey,
      status: "active",
      statusChangedAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    },
  });
  return created.id;
}

function oauthCredentialName(clientName: string | null): string {
  return `${clientName?.trim() || "OAuth client"} (OAuth)`;
}

/**
 * Mint a fresh access token plus a refresh token bound to the same
 * user/client/scope. Used by both the authorization_code grant and refresh
 * rotation.
 */
export async function issueConnectorTokens(
  db: Database,
  input: {
    userId: string;
    clientId: string;
    scope: string;
    resource?: string | null;
    persistentMcpResource?: string | null;
    issuer: string;
    now?: Date;
    connectionKey?: string | null;
    grantId?: string | null;
  },
  dependencies: OAuthPersistenceDependencies = {},
): Promise<IssuedConnectorTokens> {
  const now = input.now ?? new Date();
  const client = await getOAuthClient(db, input.clientId, input.issuer);
  if (!client) throw new OAuthError("invalid_client", "Unknown or revoked OAuth client");
  const connectionKey = input.connectionKey ?? createOAuthOpaqueToken("ocn_", 16);
  const canonicalScope = normalizeCredentialScopes(input.scope);
  const grantId = await resolveConnectorGrant(db, {
    userId: input.userId,
    clientId: input.clientId,
    issuer: input.issuer,
    resource: input.resource ?? null,
    scope: canonicalScope,
    connectionKey,
    grantId: input.grantId,
    now,
  });
  const persistentAccessToken = Boolean(
    input.resource &&
    input.persistentMcpResource &&
    input.resource === input.persistentMcpResource,
  );
  const expiresIn = persistentAccessToken ? null : OAUTH_ACCESS_TOKEN_TTL_SECONDS;
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("access_insert", "before");
  }
  const { token: accessToken } = await createApiCredential(db, input.userId, oauthCredentialName(client.clientName), {
    expiresAt: expiresIn === null ? null : new Date(now.getTime() + expiresIn * 1000),
    scopes: canonicalScope,
    oauthClientId: input.clientId,
    oauthIssuer: client.issuer,
    oauthResource: input.resource ?? null,
    oauthConnectionKey: connectionKey,
    oauthGrantId: grantId,
  });
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("access_insert", "after");
  }
  const refreshToken = createOAuthOpaqueToken("ort_");
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("refresh_insert", "before");
  }
  await db.oAuthRefreshToken.create({
    data: {
      tokenHash: await hashOAuthOpaqueToken(refreshToken),
      userId: input.userId,
      clientId: input.clientId,
      issuer: client.issuer,
      scope: input.scope,
      resource: input.resource ?? null,
      connectionKey,
      grantId,
    },
  });
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("refresh_insert", "after");
  }
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
  input: { refreshToken: string; clientId?: string; issuer: string; now?: Date },
  dependencies: OAuthPersistenceDependencies = {},
): Promise<boolean> {
  const now = input.now ?? new Date();
  if (!input.refreshToken) throw new OAuthError("invalid_request", "Missing refresh token");

  let record = await db.oAuthRefreshToken.findUnique({
    where: { tokenHash: await hashOAuthOpaqueToken(input.refreshToken) },
  });
  if (!record) return false;
  if (input.clientId && record.clientId !== input.clientId) {
    return false;
  }
  if (record.issuer !== null && record.issuer !== input.issuer) return false;
  const client = await getOAuthClient(db, record.clientId, input.issuer);
  if (!client) return false;
  const linkedGrant = await requireLinkedConnectorGrant(db, record, true);
  if (record.issuer === null) {
    await db.oAuthRefreshToken.updateMany({ where: { id: record.id, issuer: null }, data: { issuer: input.issuer } });
    record = await db.oAuthRefreshToken.findUniqueOrThrow({ where: { id: record.id } });
  }
  /* istanbul ignore if -- @preserve issuer promotion above must converge; retain a fail-closed guard for concurrent corruption. */
  if (record.issuer !== input.issuer) {
    return false;
  }
  const wasActive = record.revokedAt === null;

  await db.apiCredential.updateMany({
    where: { userId: record.userId, oauthClientId: record.clientId, oauthIssuer: null },
    data: { oauthIssuer: input.issuer },
  });
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("disconnect_refresh_revoke", "before");
  }
  await db.oAuthRefreshToken.updateMany({
    where: { id: record.id, revokedAt: null },
    data: { revokedAt: now },
  });
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("disconnect_refresh_revoke", "after");
    await dependencies.onPersistenceMutation("disconnect_access_revoke", "before");
  }
  await db.apiCredential.updateMany({
    where: {
      userId: record.userId,
      oauthClientId: record.clientId,
      oauthIssuer: record.issuer,
      oauthResource: record.resource,
      revokedAt: null,
      OR: [
        ...(record.connectionKey ? [{ oauthConnectionKey: record.connectionKey }] : []),
        { oauthConnectionKey: null, createdAt: { lte: record.revokedAt ?? now } },
      ],
      AND: [{ OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ] }],
    },
    data: { revokedAt: now },
  });
  if (record.grantId) {
    const revokedGrant = await db.oAuthGrant.updateMany({
      where: {
        id: record.grantId,
        userId: record.userId,
        clientId: record.clientId,
        issuer: record.issuer,
        resource: record.resource,
        scope: normalizeCredentialScopes(record.scope),
        connectionKey: record.connectionKey!,
        status: "active",
      },
      data: { status: "revoked", statusReason: "disconnect", statusChangedAt: now },
    });
    if (linkedGrant?.status === "active" && revokedGrant.count !== 1) {
      throw new OAuthError("invalid_grant", "OAuth grant disconnect did not converge");
    }
  }
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("disconnect_access_revoke", "after");
  }
  return wasActive;
}

/**
 * Exchange a refresh token for a new token pair (RFC 6749 §6) with rotation:
 * the presented token is revoked before a new pair is issued, so a replayed
 * refresh token is rejected. Native D1 transaction hardening is tracked in PR5.
 */
export async function rotateConnectorTokens(
  db: Database,
  input: { refreshToken: string; clientId: string; issuer: string; now?: Date; legacyMcpResource?: string | null },
  dependencies: OAuthPersistenceDependencies = {},
): Promise<IssuedConnectorTokens> {
  const now = input.now ?? new Date();
  if (!input.refreshToken) throw new OAuthError("invalid_grant", "Missing refresh token");

  let record = await db.oAuthRefreshToken.findUnique({
    where: { tokenHash: await hashOAuthOpaqueToken(input.refreshToken) },
  });
  if (!record || record.revokedAt) {
    throw new OAuthError("invalid_grant", "Unknown or revoked refresh token");
  }
  if (record.clientId !== input.clientId) {
    throw new OAuthError("invalid_grant", "Refresh token was issued to a different client");
  }
  if (record.issuer !== null && record.issuer !== input.issuer) {
    throw new OAuthError("invalid_grant", "Refresh token was issued by a different issuer");
  }
  const client = await getOAuthClient(db, record.clientId, input.issuer);
  if (!client) throw new OAuthError("invalid_client", "Unknown or revoked OAuth client");
  if (record.grantId
    && input.legacyMcpResource
    && isClaudeMcpOAuthClient(client)
    && (record.resource === null || record.resource === input.legacyMcpResource)) {
    record = await convergeLinkedLegacyMcpResource(
      db,
      record,
      record.grantId,
      input.legacyMcpResource,
      dependencies,
    );
  } else {
    await requireLinkedConnectorGrant(db, record);
  }
  if (record.issuer === null) {
    await db.oAuthRefreshToken.updateMany({ where: { id: record.id, issuer: null }, data: { issuer: input.issuer } });
    record = await db.oAuthRefreshToken.findUniqueOrThrow({ where: { id: record.id } });
  }
  /* istanbul ignore if -- @preserve issuer promotion above must converge; retain a fail-closed guard for concurrent corruption. */
  if (record.issuer !== input.issuer) {
    throw new OAuthError("invalid_grant", "Refresh token was issued by a different issuer");
  }
  const resource = !record.resource && input.legacyMcpResource && isClaudeMcpOAuthClient(client)
    ? input.legacyMcpResource
    : record.resource;
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("parent_revoke", "before");
  }
  const revoked = await db.oAuthRefreshToken.updateMany({
    where: { id: record.id, revokedAt: null },
    data: { revokedAt: now },
  });
  if (revoked.count !== 1) {
    throw new OAuthError("invalid_grant", "Refresh token already used");
  }
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("parent_revoke", "after");
    await dependencies.onPersistenceMutation("replacement_insert", "before");
  }
  const replacement = await issueConnectorTokens(db, {
    userId: record.userId,
    clientId: record.clientId,
    scope: record.scope,
    resource,
    persistentMcpResource: input.legacyMcpResource,
    issuer: input.issuer,
    now,
    connectionKey: record.connectionKey ?? record.id,
    grantId: record.grantId,
  }, dependencies);
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("replacement_insert", "after");
  }
  return replacement;
}
