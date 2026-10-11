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
 * `createApiCredential`). Generic OAuth app credentials expire after 15 minutes
 * and MCP-bound credentials after 90 days; both refresh through rotating
 * `refresh_token` values, each valid for 180 days. Presenting a refresh token
 * that was already rotated, outside a short grace window, marks the whole
 * connection compromised and revokes it.
 */

import type { OAuthRefreshToken as OAuthRefreshTokenRecord, PrismaClient as PrismaClientType } from "@prisma/client";
import { createApiCredential, generateApiToken, hashApiToken, normalizeCredentialScopes } from "~/lib/api-auth.server";
import { newReservationId } from "~/lib/api-idempotency.server";
import { d1ReadBatch, type D1Query, type D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Guard, d1Timestamp, d1WriteBatch, isD1GuardFailure } from "~/lib/d1-write.server";
import { retryD1Write } from "~/lib/d1-write-retry.server";
import {
  hasProhibitedOAuthClientNameCharacters,
  MAX_OAUTH_CLIENT_NAME_CODE_POINTS,
} from "~/lib/oauth-client-metadata";
import { readSessionVersion, sessionVersionUnchanged } from "~/lib/session-version-fence.server";

type Database = PrismaClientType;

export type OAuthPersistenceStage =
  | "code_consumption"
  | "grant_insert"
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

/** Generic OAuth access tokens are short-lived. */
export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/**
 * MCP-bound access tokens (the Claude connector) last 90 days. They were durable until the
 * 2026-10-09 audit (commit 56784ee7 made them so after 15-minute tokens broke Claude's reauth);
 * 90 days keeps the connector working while a leaked token stops working eventually.
 */
export const OAUTH_MCP_ACCESS_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;
/** Each refresh token is refused 180 days after it was issued; rotation issues a fresh one. */
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60;
/**
 * Refresh tokens issued before they had an expiry (migration 0031) have `expiresAt` NULL and are
 * accepted until this cutover, 180 days after the change shipped. Rotating one issues a token with
 * its own 180-day expiry, so a connection in use never reaches the cutover.
 */
export const LEGACY_OAUTH_REFRESH_EXPIRES_AT = new Date("2027-04-07T00:00:00.000Z");
/**
 * A refresh token replayed this soon after its rotation is refused without revoking the
 * connection: two refreshes racing from the same client are not an attack. Later replays mean
 * someone holds a copy of an old token.
 */
export const OAUTH_REFRESH_REUSE_GRACE_SECONDS = 60;
/**
 * The grace for Spoonjoy's own iPhone app. Its main app, root view and App Intents each refresh
 * on their own, and a process the system suspended between reading the Keychain and sending its
 * refresh can replay the token it read minutes later; revoking then would sign the chef out.
 *
 * Accepted risk: if an attacker redeems a stolen current refresh token first, the app's own
 * replay inside this window revokes nothing, and the attacker keeps a renewing session until the
 * chef signs out everywhere. It goes back to 60 seconds once the app shares one refresh across
 * its processes (spoonjoy/spoonjoy-apple#113).
 */
export const FIRST_PARTY_NATIVE_REFRESH_REUSE_GRACE_SECONDS = 15 * 60;
/** The iPhone app's client id; other servers than spoonjoy.app suffix it with `:<origin hash>`. */
export const SPOONJOY_APPLE_NATIVE_CLIENT_ID = "spoonjoy-apple-native";
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
/**
 * Why a refresh was refused. `OAuthErrorReason` is for clients that act on it:
 * `revoked_by_user` means the chef ended this session on purpose (sign out everywhere, a password
 * change, or a disconnect), so the iPhone app signs out quietly instead of reporting an error.
 * `OAuthRefreshRefusal` is for telemetry and triage only (never sent to the client): a replay
 * inside the grace window, a replay that revoked the connection as compromised, or an expired
 * refresh token that ended its connection.
 */
export type OAuthErrorReason = "revoked_by_user";
export type OAuthRefreshRefusal = "grace_replay" | "reuse_revoked" | "expired";

export class OAuthError extends Error {
  code: string;
  status: number;
  reason?: OAuthErrorReason;
  refusal?: OAuthRefreshRefusal;
  constructor(code: string, message: string, status = 400, reason?: OAuthErrorReason) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
    this.status = status;
    if (reason) this.reason = reason;
  }
}

// Grant revocations the chef made: a disconnect, or sign out everywhere / a password change
// (`security_event`, from account-revocation). Expiry, client or administrative revocation and
// reuse detection (`compromised`) are not the chef's doing.
const USER_REVOCATION_REASONS: ReadonlySet<string | null> = new Set(["disconnect", "security_event"]);

/**
 * The refusal for a refresh token that is no longer usable, saying `revoked_by_user` when its
 * grant was revoked by the chef. Tokens from before grants existed (no `grantId`) and tokens of
 * a deleted account (no row at all) cannot be told apart from unknown ones.
 */
async function refusedRefreshError(db: Database, record: OAuthRefreshTokenRecord): Promise<OAuthError> {
  const grant = record.grantId
    ? await db.oAuthGrant.findUnique({ where: { id: record.grantId }, select: { status: true, statusReason: true } })
    : null;
  const byUser = grant?.status === "revoked" && USER_REVOCATION_REASONS.has(grant.statusReason);
  return byUser
    ? sessionRevokedError()
    : new OAuthError("invalid_grant", "Unknown or revoked refresh token");
}

/** `revoked_by_user`: the chef disconnected this session, signed out everywhere or changed their password. */
function sessionRevokedError(): OAuthError {
  return new OAuthError("invalid_grant", "Session revoked", 400, "revoked_by_user");
}

/**
 * The account's session version, read before a flow's first write that an account-wide
 * revocation would undo; `issueConnectorTokens` checks it again after creating a grant.
 */
export async function requireSessionVersionFence(db: Database, userId: string): Promise<number> {
  const sessionVersion = await readSessionVersion(db, userId);
  if (sessionVersion === null) throw new OAuthError("invalid_grant", "Unknown account");
  return sessionVersion;
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

/**
 * `promoteLegacyOAuthIssuerForUser` as D1 statements, for one batch. A D1 batch is atomic,
 * which the Prisma version is not on D1: Prisma's D1 adapter ignores transactions, so its
 * reads and `updateMany` calls run as separate queries. The statements change exactly the
 * same rows: clients behind the user's legacy (issuer-less) tokens and access credentials
 * are bound to `issuer` if they are unbound, then the legacy rows whose client is bound to
 * `issuer` take it. Access credentials also get a new `updatedAt`, as `updateMany` sets it.
 */
export function legacyOAuthIssuerPromotionStatements(userId: string, issuer: string, now: Date): D1Query[] {
  const legacyClientIds = `SELECT "clientId" FROM "OAuthRefreshToken" WHERE "userId" = ? AND "issuer" IS NULL
    UNION SELECT "oauthClientId" FROM "ApiCredential"
      WHERE "userId" = ? AND "oauthClientId" IS NOT NULL AND "oauthIssuer" IS NULL`;
  const clientsBoundToIssuer = `SELECT "id" FROM "OAuthClient" WHERE "issuer" = ?`;
  return [
    [
      `UPDATE "OAuthClient" SET "issuer" = ? WHERE "issuer" IS NULL AND "id" IN (${legacyClientIds})`,
      issuer,
      userId,
      userId,
    ],
    [
      `UPDATE "OAuthRefreshToken" SET "issuer" = ?
       WHERE "userId" = ? AND "issuer" IS NULL AND "clientId" IN (${clientsBoundToIssuer})`,
      issuer,
      userId,
      issuer,
    ],
    [
      `UPDATE "ApiCredential" SET "oauthIssuer" = ?, "updatedAt" = ?
       WHERE "userId" = ? AND "oauthIssuer" IS NULL AND "oauthClientId" IN (${clientsBoundToIssuer})`,
      issuer,
      now.toISOString(),
      userId,
      issuer,
    ],
  ];
}

/**
 * `promoteLegacyOAuthIssuerForUser` on a D1 binding, as one atomic batch. It only fills issuers
 * that are still empty, so after a transient D1 error it simply runs again.
 */
export async function promoteLegacyOAuthIssuerForUserOnD1(
  db: D1ReadDatabase,
  userId: string,
  issuer: string,
  now: Date = new Date(),
): Promise<void> {
  const statements = legacyOAuthIssuerPromotionStatements(userId, issuer, now);
  await retryD1Write({ scope: "oauth.promote_legacy_issuer" }, () => d1ReadBatch(db, statements));
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
  /** The account's session version, read before the code was burned: the fence for `issueConnectorTokens`. */
  sessionVersion: number;
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

  // Read before the burn: a revocation that lands earlier has already spent the code, so the burn
  // below fails; one that lands later moves the version, so the grant fence refuses.
  const sessionVersion = await requireSessionVersionFence(db, record.userId);
  // Burn the code; the guard makes a concurrent second exchange a no-op.
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("code_consumption", "before");
  }
  // After a transient D1 error the burn runs again; a try that had committed left the code
  // consumed at this request's own time, which the retry recognises as its own burn.
  const codeId = record.id;
  const burned = await retryD1Write({
    scope: "oauth.consume_code",
    applied: async () => {
      const code = await db.oAuthAuthCode.findUnique({ where: { id: codeId }, select: { consumedAt: true } });
      return code?.consumedAt?.getTime() === now.getTime() ? { count: 1 } : null;
    },
  }, () => db.oAuthAuthCode.updateMany({
    where: { id: codeId, consumedAt: null },
    data: { consumedAt: now },
  }));
  if (burned.count !== 1) {
    throw new OAuthError("invalid_grant", "Authorization code already used");
  }
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("code_consumption", "after");
  }

  return { userId: record.userId, scope: record.scope, resource: record.resource, sessionVersion };
}

export interface IssuedConnectorTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
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

const ACTIVE_GRANT_STATUSES: ReadonlySet<string> = new Set(["active"]);
const REVOCABLE_GRANT_STATUSES: ReadonlySet<string> = new Set(["active", "revoked", "compromised"]);

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
  // Revoking a token that is already dead succeeds (RFC 7009 §2.2), whatever ended its grant:
  // a disconnect, sign out everywhere, expiry or reuse detection. Otherwise the iPhone app's
  // sign-out, which waits for the revoke call, fails after the account was revoked elsewhere.
  const permittedStatuses = allowDisconnected ? REVOCABLE_GRANT_STATUSES : ACTIVE_GRANT_STATUSES;
  if (!grant || !grantIdentityMatches(grant, expected) || !permittedStatuses.has(grant.status)) {
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
    sessionVersion: number;
    now: Date;
  },
  dependencies: OAuthPersistenceDependencies,
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
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("grant_insert", "before");
  }
  // The id is chosen before the first try, so a retry after a transient D1 error fails on it
  // when an earlier try committed, and that grant is the one used.
  const newGrantId = newReservationId(input.now);
  const created = await retryD1Write({
    scope: "oauth.grant_create",
    applied: () => db.oAuthGrant.findUnique({ where: { id: newGrantId } }),
  }, () => db.oAuthGrant.create({
    data: {
      id: newGrantId,
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
  }));
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("grant_insert", "after");
  }
  // The session-version fence: sign out everywhere or a password change that landed since the flow
  // read the version revoked every grant then, before this one existed, so this one must not
  // survive it. One that lands after this check finds the grant and revokes it. (This read is
  // consistent with the revocation's write because D1 read replication is off.)
  if (!(await sessionVersionUnchanged(db, input.userId, input.sessionVersion))) {
    await db.oAuthGrant.updateMany({
      where: { id: created.id, status: "active" },
      data: { status: "revoked", statusReason: "security_event", statusChangedAt: input.now },
    });
    throw sessionRevokedError();
  }
  return created.id;
}

function oauthCredentialName(clientName: string | null): string {
  return `${clientName?.trim() || "OAuth client"} (OAuth)`;
}

/** The secrets of one access and refresh token pair. */
export interface ConnectorTokenSecrets {
  accessToken: string;
  refreshToken: string;
}

export interface IssueConnectorTokensInput {
  userId: string;
  clientId: string;
  scope: string;
  resource?: string | null;
  persistentMcpResource?: string | null;
  issuer: string;
  now?: Date;
  connectionKey?: string | null;
  grantId?: string | null;
  /**
   * The account's session version, read at the start of the flow (see
   * `requireSessionVersionFence`). A new grant is kept only while it is unchanged.
   */
  sessionVersion: number;
  /** The pair's secrets when the caller chose them (a rotation derives them); otherwise new ones. */
  secrets?: ConnectorTokenSecrets;
}

const SUCCESSOR_DERIVATION_LABEL = "spoonjoy.oauth.refresh-successor.v1";

/**
 * The token pair a refresh token rotates to. With a key (the deployment's SESSION_SECRET), the
 * pair is derived from the presented refresh token and its row id, so every request that rotates
 * the same refresh token computes the same pair. That is what lets a client whose rotation
 * committed after its answer was lost (the request gave up with a 503, and D1 applied the write
 * late) present the old token again and receive the pair that is now live, rather than nothing
 * (see `replayUnusedSuccessor`). Deriving needs the presented secret, which only its holder has,
 * the row id, which only the database has, and the key; with all three one already holds an
 * account's sessions, so it gives nothing new. Without a key the pair is random and is never
 * replayed: a lost answer then leaves the client to sign in again, as before.
 */
export async function successorTokenSecrets(
  parentRefreshToken: string,
  parentId: string,
  key: string | null | undefined,
): Promise<ConnectorTokenSecrets> {
  if (!key) return newConnectorTokenSecrets();
  const encoder = new TextEncoder();
  const hmac = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derive = async (kind: string) => base64UrlEncode(new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    hmac,
    encoder.encode(`${SUCCESSOR_DERIVATION_LABEL}\u0000${kind}\u0000${parentId}\u0000${parentRefreshToken}`),
  )));
  return { accessToken: `sj_${await derive("access")}`, refreshToken: `ort_${await derive("refresh")}` };
}

function newConnectorTokenSecrets(): ConnectorTokenSecrets {
  return { accessToken: generateApiToken(), refreshToken: createOAuthOpaqueToken("ort_") };
}

/** What a new pair is bound to: the client, the connection, its grant and the access lifetime. */
interface PreparedConnectorIssue {
  clientName: string | null;
  clientIssuer: string | null;
  connectionKey: string;
  canonicalScope: string;
  grantId: string;
  expiresIn: number;
}

async function prepareConnectorIssue(
  db: Database,
  input: IssueConnectorTokensInput & { now: Date },
  dependencies: OAuthPersistenceDependencies,
): Promise<PreparedConnectorIssue> {
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
    sessionVersion: input.sessionVersion,
    now: input.now,
  }, dependencies);
  const persistentAccessToken = Boolean(
    input.resource &&
    input.persistentMcpResource &&
    input.resource === input.persistentMcpResource,
  );
  return {
    clientName: client.clientName,
    clientIssuer: client.issuer,
    connectionKey,
    canonicalScope,
    grantId,
    expiresIn: persistentAccessToken ? OAUTH_MCP_ACCESS_TOKEN_TTL_SECONDS : OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  };
}

/**
 * Mint a fresh access token plus a refresh token bound to the same
 * user/client/scope. Used by the authorization_code grant, native sign-in and,
 * without a D1 binding, refresh rotation.
 *
 * Each insert chooses its id and secret before the first try, so after a transient D1 error it
 * runs again and, if an earlier try had committed, answers that row with the same secret.
 */
export async function issueConnectorTokens(
  db: Database,
  input: IssueConnectorTokensInput,
  dependencies: OAuthPersistenceDependencies = {},
): Promise<IssuedConnectorTokens> {
  const now = input.now ?? new Date();
  const issue = await prepareConnectorIssue(db, { ...input, now }, dependencies);
  const secrets = input.secrets ?? newConnectorTokenSecrets();
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("access_insert", "before");
  }
  await createApiCredential(db, input.userId, oauthCredentialName(issue.clientName), {
    token: secrets.accessToken,
    expiresAt: new Date(now.getTime() + issue.expiresIn * 1000),
    scopes: issue.canonicalScope,
    oauthClientId: input.clientId,
    oauthIssuer: issue.clientIssuer,
    oauthResource: input.resource ?? null,
    oauthConnectionKey: issue.connectionKey,
    oauthGrantId: issue.grantId,
  });
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("access_insert", "after");
    await dependencies.onPersistenceMutation("refresh_insert", "before");
  }
  const refreshId = newReservationId(now);
  const tokenHash = await hashOAuthOpaqueToken(secrets.refreshToken);
  await retryD1Write({
    scope: "oauth.refresh_create",
    applied: () => db.oAuthRefreshToken.findFirst({ where: { id: refreshId, tokenHash } }),
  }, () => db.oAuthRefreshToken.create({
    data: {
      id: refreshId,
      tokenHash,
      userId: input.userId,
      clientId: input.clientId,
      issuer: issue.clientIssuer,
      scope: input.scope,
      resource: input.resource ?? null,
      connectionKey: issue.connectionKey,
      grantId: issue.grantId,
      expiresAt: new Date(now.getTime() + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000),
    },
  }));
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("refresh_insert", "after");
  }
  return {
    accessToken: secrets.accessToken,
    refreshToken: secrets.refreshToken,
    expiresIn: issue.expiresIn,
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

function connectionKeyOf(record: Pick<OAuthRefreshTokenRecord, "id" | "connectionKey">): string {
  return record.connectionKey ?? record.id;
}

/**
 * Revokes every refresh token and access credential on one connection and moves its grant to
 * `status`. Rotation keeps `connectionKey` across a connection's refresh tokens, and a legacy
 * token without one is the connection's key itself. Access tokens minted before migration 0026
 * carry no connection key, so, as on disconnect, every unkeyed access token this client holds
 * for the chef is revoked with the connection: it cannot be told which connection it belongs to.
 */
async function revokeConnection(
  db: Database,
  record: OAuthRefreshTokenRecord,
  now: Date,
  grant: { status: "compromised"; statusReason: "refresh_reuse" } | { status: "revoked"; statusReason: "inactivity_expiry" },
): Promise<void> {
  const connectionKey = connectionKeyOf(record);
  await db.oAuthRefreshToken.updateMany({
    where: {
      userId: record.userId,
      clientId: record.clientId,
      revokedAt: null,
      OR: [{ connectionKey }, { connectionKey: null, id: connectionKey }],
    },
    data: { revokedAt: now },
  });
  await db.apiCredential.updateMany({
    where: {
      userId: record.userId,
      oauthClientId: record.clientId,
      revokedAt: null,
      ...oauthAccessConnectionOwnership([connectionKey], now),
    },
    data: { revokedAt: now },
  });
  await db.oAuthGrant.updateMany({
    where: { userId: record.userId, clientId: record.clientId, connectionKey, status: "active" },
    data: { ...grant, statusChangedAt: now },
  });
}

/**
 * A refresh token that was already rotated came back. Within the grace window that is a race
 * between two refreshes from the same client; later, someone holds a copy of an old token, so
 * the whole connection is revoked and its grant marked compromised (OAuth 2.1 §4.3.1). A
 * connection that was disconnected has nothing active left and stays as it is.
 */
async function revokeConnectionOnRefreshReuse(
  db: Database,
  record: OAuthRefreshTokenRecord,
  now: Date,
): Promise<OAuthRefreshRefusal | undefined> {
  const revokedAt = record.revokedAt;
  /* istanbul ignore if -- @preserve callers pass only revoked records */
  if (!revokedAt) return undefined;
  if (await withinReuseGrace(db, record.clientId, revokedAt, now)) return "grace_replay";
  const connectionKey = connectionKeyOf(record);
  const stillActive = await db.oAuthRefreshToken.count({
    where: {
      userId: record.userId,
      clientId: record.clientId,
      revokedAt: null,
      OR: [{ connectionKey }, { connectionKey: null, id: connectionKey }],
    },
  });
  if (stillActive === 0) return undefined;
  await revokeConnection(db, record, now, { status: "compromised", statusReason: "refresh_reuse" });
  return "reuse_revoked";
}

/** Whether a refresh token revoked at `revokedAt` is still inside its client's reuse grace. */
async function withinReuseGrace(db: Database, clientId: string, revokedAt: Date, now: Date): Promise<boolean> {
  const graceSeconds = await isFirstPartyNativeClient(db, clientId)
    ? FIRST_PARTY_NATIVE_REFRESH_REUSE_GRACE_SECONDS
    : OAUTH_REFRESH_REUSE_GRACE_SECONDS;
  return now.getTime() - revokedAt.getTime() <= graceSeconds * 1000;
}

/**
 * The pair a rotated refresh token rotated to, when its holder presents it again inside the reuse
 * grace and nobody has used that pair yet: the rotation committed, but its answer never reached
 * the client (the request gave up with a 503 and D1 applied the write late). The client gets the
 * one pair that is live, so it is neither left with no valid token nor given a second pair.
 *
 * The pair is found by its derived secrets (`successorTokenSecrets`), so this needs the key.
 * It must still be untouched: its refresh token not rotated or revoked, its access token never
 * used and not expired, and its grant active. A pair already in use means its holder got it, so
 * the replay is refused as before (`grace_replay`), which also keeps a copy of an old refresh
 * token from picking up a pair someone is using.
 */
async function replayUnusedSuccessor(
  db: Database,
  parent: OAuthRefreshTokenRecord,
  input: { refreshToken: string; issuer: string; successorKey?: string | null },
  now: Date,
): Promise<IssuedConnectorTokens | null> {
  if (!input.successorKey || !parent.revokedAt) return null;
  if (!(await withinReuseGrace(db, parent.clientId, parent.revokedAt, now))) return null;
  const secrets = await successorTokenSecrets(input.refreshToken, parent.id, input.successorKey);
  const successor = await db.oAuthRefreshToken.findUnique({
    where: { tokenHash: await hashOAuthOpaqueToken(secrets.refreshToken) },
  });
  if (
    !successor
    || successor.revokedAt
    || successor.userId !== parent.userId
    || successor.clientId !== parent.clientId
    || successor.issuer !== input.issuer
    || successor.connectionKey !== connectionKeyOf(parent)
    || !successor.expiresAt
    || successor.expiresAt.getTime() <= now.getTime()
  ) {
    return null;
  }
  const access = await db.apiCredential.findUnique({
    where: { tokenHash: await hashApiToken(secrets.accessToken) },
    select: { revokedAt: true, lastUsedAt: true, expiresAt: true, oauthConnectionKey: true },
  });
  if (
    !access
    || access.revokedAt
    || access.lastUsedAt
    || access.oauthConnectionKey !== successor.connectionKey
    || !access.expiresAt
    || access.expiresAt.getTime() - now.getTime() < 1000
  ) {
    return null;
  }
  const expiresIn = Math.floor((access.expiresAt.getTime() - now.getTime()) / 1000);
  try {
    await requireLinkedConnectorGrant(db, successor);
  } catch (error) {
    /* istanbul ignore if -- @preserve the grant check throws only OAuthError */
    if (!(error instanceof OAuthError)) throw error;
    return null;
  }
  return {
    accessToken: secrets.accessToken,
    refreshToken: secrets.refreshToken,
    expiresIn,
    scope: successor.scope,
    resource: successor.resource,
  };
}

/**
 * Spoonjoy's own iPhone app: the native sign-in client, or the reserved "Spoonjoy Apple" OAuth
 * registration, which can only use Spoonjoy's own callback.
 */
async function isFirstPartyNativeClient(db: Database, clientId: string): Promise<boolean> {
  if (clientId === SPOONJOY_APPLE_NATIVE_CLIENT_ID || clientId.startsWith(`${SPOONJOY_APPLE_NATIVE_CLIENT_ID}:`)) {
    return true;
  }
  const client = await db.oAuthClient.findUnique({ where: { id: clientId }, select: { clientName: true, redirectUris: true } });
  return client?.clientName?.trim().toLowerCase() === SPOONJOY_APPLE_OAUTH_CLIENT_NAME.toLowerCase()
    && client.redirectUris.trim() === SPOONJOY_APPLE_OAUTH_REDIRECT_URI;
}

/** A refused refresh with the reason telemetry records, for triage. */
function refusedRefresh(message: string, refusal: OAuthRefreshRefusal): OAuthError {
  const error = new OAuthError("invalid_grant", message);
  error.refusal = refusal;
  return error;
}

/**
 * A refresh token past its expiry ends its connection: nothing on it can be refreshed again.
 * Every rotation renews the expiry, so this is an inactivity timeout, not an absolute one.
 */
async function expireConnection(db: Database, record: OAuthRefreshTokenRecord, now: Date): Promise<void> {
  await revokeConnection(db, record, now, { status: "revoked", statusReason: "inactivity_expiry" });
}

export interface RotateConnectorTokensInput {
  refreshToken: string;
  clientId: string;
  issuer: string;
  now?: Date;
  legacyMcpResource?: string | null;
  /**
   * The request's D1 binding. With it, revoking the presented refresh token and inserting the new
   * pair are one D1 batch, so either all of it applies or none does.
   */
  d1?: D1ReadDatabase | null;
  /** The key the new pair is derived with (the deployment's SESSION_SECRET); see `successorTokenSecrets`. */
  successorKey?: string | null;
}

/**
 * Exchange a refresh token for a new token pair (RFC 6749 §6) with rotation:
 * the presented token is revoked as the new pair is issued, so a replayed
 * refresh token is rejected.
 *
 * After a transient D1 error the rotation is safe to retry, and a lost answer never leaves the
 * client without a valid token or with a second live pair:
 *
 * - With a D1 binding, the revoke and both inserts are one batch, guarded on the presented token
 *   still being unrevoked and its grant active. A batch that never ran is run again with the same
 *   ids and secrets. One that committed but whose answer was lost makes the retry stop on the
 *   guard; the retry then finds its own new refresh token by id and answers the pair it holds.
 * - If every try fails, the request answers a retryable 503. Either nothing committed, and the
 *   presented token still works, or the batch commits late, and presenting the old token again
 *   inside the reuse grace answers the pair it rotated to (`replayUnusedSuccessor`).
 * - A rotation that loses a race with another request for the same token reads it again: the
 *   other request's pair is answered when it is unused, otherwise the replay is refused as before.
 */
export async function rotateConnectorTokens(
  db: Database,
  input: RotateConnectorTokensInput,
  dependencies: OAuthPersistenceDependencies = {},
): Promise<IssuedConnectorTokens> {
  return rotate(db, input, dependencies, false);
}

async function rotate(
  db: Database,
  input: RotateConnectorTokensInput,
  dependencies: OAuthPersistenceDependencies,
  afterLostRace: boolean,
): Promise<IssuedConnectorTokens> {
  const now = input.now ?? new Date();
  if (!input.refreshToken) throw new OAuthError("invalid_grant", "Missing refresh token");

  let record = await db.oAuthRefreshToken.findUnique({
    where: { tokenHash: await hashOAuthOpaqueToken(input.refreshToken) },
  });
  if (!record) {
    throw new OAuthError("invalid_grant", "Unknown or revoked refresh token");
  }
  if (record.revokedAt) {
    if (record.clientId !== input.clientId) {
      throw new OAuthError("invalid_grant", "Unknown or revoked refresh token");
    }
    const replayed = await replayUnusedSuccessor(db, record, input, now);
    if (replayed) return replayed;
    // Reuse detection runs first: it leaves a connection the chef already ended as it is, so the
    // reason below still sees that revocation.
    const refusal = await revokeConnectionOnRefreshReuse(db, record, now);
    // The reason is told only to the client and issuer the token was issued to.
    const error = record.issuer === null || record.issuer === input.issuer
      ? await refusedRefreshError(db, record)
      : new OAuthError("invalid_grant", "Unknown or revoked refresh token");
    if (refusal) error.refusal = refusal;
    throw error;
  }
  if (record.clientId !== input.clientId) {
    throw new OAuthError("invalid_grant", "Refresh token was issued to a different client");
  }
  if ((record.expiresAt ?? LEGACY_OAUTH_REFRESH_EXPIRES_AT).getTime() <= now.getTime()) {
    await expireConnection(db, record, now);
    throw refusedRefresh("Refresh token expired", "expired");
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
  // Read before the parent is revoked: a revocation that lands earlier has already revoked it, so
  // the revoke below fails; one that lands later moves the version, so a legacy token's new grant
  // is refused.
  const sessionVersion = await requireSessionVersionFence(db, record.userId);
  // The access token issued with the presented refresh token stays valid until its own expiry:
  // the iPhone app's processes refresh independently, and revoking it here would fail requests
  // another process has in flight. Reuse detection, disconnect and account revocation end it.
  const issueInput = {
    userId: record.userId,
    clientId: record.clientId,
    scope: record.scope,
    resource,
    persistentMcpResource: input.legacyMcpResource,
    issuer: input.issuer,
    now,
    connectionKey: record.connectionKey ?? record.id,
    grantId: record.grantId,
    sessionVersion,
    secrets: await successorTokenSecrets(input.refreshToken, record.id, input.successorKey),
  };
  const lostRace = () => {
    // Revoking is one-way, so the second read finds the token revoked; if it somehow does not, give up.
    if (afterLostRace) throw new OAuthError("invalid_grant", "Refresh token already used");
    return rotate(db, input, dependencies, true);
  };
  if (input.d1) {
    try {
      return await rotateOnD1(db, input.d1, record.id, issueInput, dependencies);
    } catch (error) {
      if (!isD1GuardFailure(error)) throw error;
      return lostRace();
    }
  }
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("parent_revoke", "before");
  }
  const revoked = await db.oAuthRefreshToken.updateMany({
    where: { id: record.id, revokedAt: null },
    data: { revokedAt: now },
  });
  if (revoked.count !== 1) return lostRace();
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("parent_revoke", "after");
    await dependencies.onPersistenceMutation("replacement_insert", "before");
  }
  const replacement = await issueConnectorTokens(db, issueInput, dependencies);
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("replacement_insert", "after");
  }
  return replacement;
}

/**
 * Rotation as one D1 batch: guards that the presented refresh token is still unrevoked and its
 * grant active, then its revoke and the new access and refresh tokens. A guard that stops it
 * throws a D1 guard failure, and nothing in the batch applies.
 */
async function rotateOnD1(
  db: Database,
  d1: D1ReadDatabase,
  parentId: string,
  input: IssueConnectorTokensInput & { now: Date; secrets: ConnectorTokenSecrets },
  dependencies: OAuthPersistenceDependencies,
): Promise<IssuedConnectorTokens> {
  const issue = await prepareConnectorIssue(db, input, dependencies);
  const { now, secrets } = input;
  const at = d1Timestamp(now);
  const accessId = newReservationId(now);
  const refreshId = newReservationId(now);
  const tokens: IssuedConnectorTokens = {
    accessToken: secrets.accessToken,
    refreshToken: secrets.refreshToken,
    expiresIn: issue.expiresIn,
    scope: input.scope,
    resource: input.resource ?? null,
  };
  const statements: D1Query[] = [
    d1Guard(`EXISTS (SELECT 1 FROM "OAuthRefreshToken" WHERE "id" = ? AND "revokedAt" IS NULL)`, parentId),
    d1Guard(`EXISTS (SELECT 1 FROM "OAuthGrant" WHERE "id" = ? AND "status" = 'active')`, issue.grantId),
    [`UPDATE "OAuthRefreshToken" SET "revokedAt" = ? WHERE "id" = ? AND "revokedAt" IS NULL`, at, parentId],
    [
      `INSERT INTO "ApiCredential" (
         "id", "userId", "name", "tokenHash", "tokenPrefix", "scopes", "oauthClientId", "oauthIssuer",
         "oauthResource", "oauthConnectionKey", "oauthGrantId", "expiresAt", "createdAt", "updatedAt"
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      accessId,
      input.userId,
      oauthCredentialName(issue.clientName),
      await hashApiToken(secrets.accessToken),
      secrets.accessToken.slice(0, 12),
      issue.canonicalScope,
      input.clientId,
      issue.clientIssuer,
      input.resource ?? null,
      issue.connectionKey,
      issue.grantId,
      d1Timestamp(new Date(now.getTime() + issue.expiresIn * 1000)),
      at,
      at,
    ],
    [
      `INSERT INTO "OAuthRefreshToken" (
         "id", "tokenHash", "userId", "clientId", "issuer", "scope", "resource", "connectionKey",
         "grantId", "expiresAt", "createdAt"
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      refreshId,
      await hashOAuthOpaqueToken(secrets.refreshToken),
      input.userId,
      input.clientId,
      issue.clientIssuer,
      input.scope,
      input.resource ?? null,
      issue.connectionKey,
      issue.grantId,
      d1Timestamp(new Date(now.getTime() + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000)),
      at,
    ],
  ];
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("parent_revoke", "before");
  }
  await retryD1Write({
    scope: "oauth.rotate_refresh",
    // The new refresh token's id is this request's own, so finding it means an earlier try committed.
    applied: async () => (await db.oAuthRefreshToken.findUnique({ where: { id: refreshId }, select: { id: true } })) ? tokens : null,
  }, async () => {
    await d1WriteBatch(d1, statements);
    return tokens;
  });
  if (dependencies.onPersistenceMutation) {
    await dependencies.onPersistenceMutation("replacement_insert", "after");
  }
  return tokens;
}
