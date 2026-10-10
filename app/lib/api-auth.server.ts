import type { ApiCredential, PrismaClient as PrismaClientType, User } from "@prisma/client";
import { getSessionIdentity, isCurrentSession, type SessionEnv } from "~/lib/session.server";
import { resolveIssuerOrigin } from "~/lib/oauth-metadata.server";
import { d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";

export type ApiPrincipalSource = "session" | "bearer" | "environment";

export const API_CREDENTIAL_SCOPE_VALUES = [
  "public:read",
  "recipes:read",
  "shopping_list:read",
  "shopping_list:write",
  "cookbooks:read",
  "account:read",
  "account:write",
  "tokens:read",
  "tokens:write",
  "offline_access",
  "kitchen:read",
  "kitchen:write",
] as const;

export type ApiCredentialScope = (typeof API_CREDENTIAL_SCOPE_VALUES)[number];

export const DEFAULT_PERSONAL_API_TOKEN_SCOPES = [
  "cookbooks:read",
  "account:read",
  "account:write",
  "public:read",
  "recipes:read",
  "shopping_list:read",
  "shopping_list:write",
  "tokens:read",
  "tokens:write",
] as const satisfies readonly ApiCredentialScope[];

export const ALL_FIRST_SLICE_SCOPES = [
  ...DEFAULT_PERSONAL_API_TOKEN_SCOPES,
  "kitchen:read",
  "kitchen:write",
  "offline_access",
] as const satisfies readonly ApiCredentialScope[];

const LEGACY_SCOPE_EXPANSIONS = {
  "kitchen:read": ["cookbooks:read", "public:read", "recipes:read", "shopping_list:read"],
  "kitchen:write": ["shopping_list:write"],
} as const satisfies Record<"kitchen:read" | "kitchen:write", readonly ApiCredentialScope[]>;

const API_CREDENTIAL_SCOPE_SET = new Set<string>(API_CREDENTIAL_SCOPE_VALUES);

export interface ApiPrincipal {
  id: string;
  email: string;
  username: string;
  source: ApiPrincipalSource;
  credentialId?: string;
  oauthClientId?: string | null;
  oauthIssuer?: string | null;
  oauthResource?: string | null;
  scopes: string[];
}

export interface CreatedApiCredential {
  token: string;
  credential: ApiCredential;
}

export class ApiAuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiAuthError";
    this.status = status;
  }
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header) return null;

  const [scheme, token, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0) {
    throw new ApiAuthError("Malformed Authorization header", 400);
  }

  return token;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function hashApiToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(digest));
}

export function generateApiToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `sj_${bytesToBase64Url(bytes)}`;
}

function parseScopeParts(scopes: string | readonly string[]): string[] {
  const parts: readonly string[] = typeof scopes === "string" ? scopes.trim().split(/\s+/) : scopes;
  return parts.map((scope) => scope.trim()).filter(Boolean);
}

export function normalizeCredentialScopes(scopes?: string | string[] | null): string {
  const rawScopes = scopes ?? DEFAULT_PERSONAL_API_TOKEN_SCOPES;
  const uniqueScopes = new Set<string>();

  for (const scope of parseScopeParts(rawScopes)) {
    if (!API_CREDENTIAL_SCOPE_SET.has(scope)) {
      throw new ApiAuthError(`Unknown API credential scope: ${scope}`, 400);
    }
    uniqueScopes.add(scope);
  }

  return Array.from(uniqueScopes).sort().join(" ");
}

export function expandCredentialScopes(scopes: string | null | undefined): string[] {
  const expanded = new Set<string>();

  for (const scope of parseScopeParts(scopes ?? "")) {
    if (!API_CREDENTIAL_SCOPE_SET.has(scope)) {
      throw new ApiAuthError(`Unknown API credential scope: ${scope}`, 400);
    }

    if (scope === "kitchen:read" || scope === "kitchen:write") {
      expanded.add(scope);
      for (const expandedScope of LEGACY_SCOPE_EXPANSIONS[scope]) {
        expanded.add(expandedScope);
      }
      continue;
    }

    expanded.add(scope);
  }

  return Array.from(expanded).sort();
}

function toPrincipal(
  user: Pick<User, "id" | "email" | "username">,
  source: ApiPrincipalSource,
  credentialId?: string,
  scopes: readonly string[] = ALL_FIRST_SLICE_SCOPES,
  oauthClientId?: string | null,
  oauthIssuer?: string | null,
  oauthResource?: string | null,
): ApiPrincipal {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    source,
    credentialId,
    oauthClientId,
    oauthIssuer,
    oauthResource,
    scopes: [...scopes],
  };
}

export async function principalFromUserEmail(
  db: PrismaClientType,
  email: string,
  source: ApiPrincipalSource = "environment"
): Promise<ApiPrincipal | null> {
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, email: true, username: true },
  });

  return user ? toPrincipal(user, source) : null;
}

/**
 * OAuth access credentials issued before MCP tokens had an expiry (migration 0031) have
 * `expiresAt` NULL. They stop working at this cutover, 90 days after the change shipped, and the
 * client refreshes. Personal and delegated tokens (no OAuth client) keep a NULL expiry as chosen.
 */
export const LEGACY_OAUTH_ACCESS_EXPIRES_AT = new Date("2027-01-07T00:00:00.000Z");

/** When a credential stops working, or null when it never does. */
export function effectiveCredentialExpiry(credential: { expiresAt: Date | null; oauthClientId: string | null }): Date | null {
  if (credential.expiresAt) return credential.expiresAt;
  return credential.oauthClientId ? LEGACY_OAUTH_ACCESS_EXPIRES_AT : null;
}

/** Personal API tokens expire after this many days unless the caller chooses otherwise. */
export const DEFAULT_PERSONAL_API_TOKEN_TTL_DAYS = 90;
export const MAX_PERSONAL_API_TOKEN_TTL_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a new personal API token expires. Omitted means the 90-day default; a whole number of
 * days from 1 to 365 sets it; `null` or "never" makes a non-expiring token, which callers must
 * ask for explicitly so a leaked token does not work forever by default.
 */
export function resolvePersonalTokenExpiry(value: unknown, now: Date = new Date()): Date | null {
  if (value === undefined) return new Date(now.getTime() + DEFAULT_PERSONAL_API_TOKEN_TTL_DAYS * DAY_MS);
  if (value === null || value === "never") return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_PERSONAL_API_TOKEN_TTL_DAYS
  ) {
    throw new ApiAuthError(
      `expiresInDays must be a whole number of days from 1 to ${MAX_PERSONAL_API_TOKEN_TTL_DAYS}, or null or "never" for a token that never expires`,
      400,
    );
  }
  return new Date(now.getTime() + value * DAY_MS);
}

export async function createApiCredential(
  db: PrismaClientType,
  userId: string,
  name: string,
  options: { expiresAt?: Date | null; scopes?: string | string[] | null; oauthClientId?: string | null; oauthIssuer?: string | null; oauthResource?: string | null; oauthConnectionKey?: string | null; oauthGrantId?: string | null } = {}
): Promise<CreatedApiCredential> {
  const token = generateApiToken();
  const tokenHash = await hashApiToken(token);
  const credential = await db.apiCredential.create({
    data: {
      userId,
      name: name.trim(),
      tokenHash,
      tokenPrefix: token.slice(0, 12),
      scopes: normalizeCredentialScopes(options.scopes),
      oauthClientId: options.oauthClientId ?? null,
      oauthIssuer: options.oauthIssuer ?? null,
      oauthResource: options.oauthResource ?? null,
      oauthConnectionKey: options.oauthConnectionKey ?? null,
      oauthGrantId: options.oauthGrantId ?? null,
      expiresAt: options.expiresAt ?? null,
    },
  });

  return { token, credential };
}

function isRecordNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2025";
}

/** `lastUsedAt` is advisory, so it is refreshed at most this often per credential. */
export const LAST_USED_AT_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export type ApiAuthOptions = {
  /** Runs the throttled `lastUsedAt` write after the response instead of before it. */
  waitUntil?: (promise: Promise<unknown>) => void;
  /**
   * The request's D1 binding. A browser session's user is then read from it, so a cookie request
   * never needs a Prisma client.
   */
  d1?: D1ReadDatabase | null;
};

/** A Prisma client, or a function that builds one only when a read needs it. */
export type ApiAuthDatabase = PrismaClientType | (() => Promise<PrismaClientType>);

const SESSION_USER_SQL = 'SELECT "id", "email", "username", "sessionVersion" FROM "User" WHERE "id" = ?';

/** The browser session's user, read from D1 in one statement; null when the user is gone. */
async function readSessionUserFromD1(
  d1: D1ReadDatabase,
  userId: string,
): Promise<Pick<User, "id" | "email" | "username" | "sessionVersion"> | null> {
  const [[row]] = await d1ReadBatch(d1, [[SESSION_USER_SQL, userId]]);
  if (!row) return null;
  const { id, email, username, sessionVersion } = row;
  if (typeof id !== "string" || typeof email !== "string" || typeof username !== "string" || typeof sessionVersion !== "number") {
    throw new Error("D1 user row is missing its id, email, username or session version");
  }
  return { id, email, username, sessionVersion };
}

export async function authenticateApiToken(
  db: PrismaClientType,
  token: string,
  expectedOAuthIssuer: string,
  options: ApiAuthOptions = {},
): Promise<ApiPrincipal> {
  const tokenHash = await hashApiToken(token);
  const credential = await db.apiCredential.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true, username: true } } },
  });

  if (
    !credential ||
    credential.revokedAt ||
    (effectiveCredentialExpiry(credential)?.getTime() ?? Infinity) <= Date.now()
  ) {
    throw new ApiAuthError("Invalid API token", 401);
  }

  let oauthIssuer = credential.oauthIssuer;
  if (credential.oauthClientId) {
    if (oauthIssuer !== null && oauthIssuer !== expectedOAuthIssuer) {
      throw new ApiAuthError("Invalid API token", 401);
    }
    // Legacy clients registered before issuers existed are bound to the first
    // issuer that uses them. Read first so a bound client (every client after
    // its first use) costs one read and no write on the request path.
    let client = await db.oAuthClient.findFirst({
      where: { id: credential.oauthClientId, revokedAt: null },
      select: { id: true, issuer: true },
    });
    if (client && client.issuer === null) {
      await db.oAuthClient.updateMany({
        where: { id: credential.oauthClientId, issuer: null, revokedAt: null },
        data: { issuer: expectedOAuthIssuer },
      });
      client = await db.oAuthClient.findFirst({
        where: { id: credential.oauthClientId, revokedAt: null },
        select: { id: true, issuer: true },
      });
    }
    if (!client || client.issuer !== expectedOAuthIssuer) throw new ApiAuthError("Invalid API token", 401);

    if (oauthIssuer === null) {
      await db.apiCredential.updateMany({
        where: { id: credential.id, oauthIssuer: null },
        data: { oauthIssuer: expectedOAuthIssuer },
      });
      oauthIssuer = (await db.apiCredential.findUniqueOrThrow({
        where: { id: credential.id },
        select: { oauthIssuer: true },
      })).oauthIssuer;
    }
    if (oauthIssuer !== expectedOAuthIssuer) throw new ApiAuthError("Invalid API token", 401);
  } else if (oauthIssuer !== null) {
    throw new ApiAuthError("Invalid API token", 401);
  }

  const now = Date.now();
  if (credential.lastUsedAt === null || now - credential.lastUsedAt.getTime() >= LAST_USED_AT_WRITE_INTERVAL_MS) {
    // `update`, not `updateMany`: Prisma's D1 adapter runs updateMany as an
    // implicit transaction and warns that D1 cannot do one.
    const touch = db.apiCredential.update({
      where: { id: credential.id },
      data: { lastUsedAt: new Date(now) },
    });
    if (options.waitUntil) {
      options.waitUntil(touch.catch((error: unknown) => {
        console.warn("[api-auth] lastUsedAt update failed", error);
      }));
    } else {
      try {
        await touch;
      } catch (error) {
        // P2025: the credential was deleted after we read it. The request was
        // already authenticated, and there is nothing left to record.
        if (!isRecordNotFound(error)) throw error;
      }
    }
  }

  return toPrincipal(
    credential.user,
    "bearer",
    credential.id,
    expandCredentialScopes(credential.scopes),
    credential.oauthClientId,
    oauthIssuer,
    credential.oauthResource,
  );
}

export async function authenticateApiRequest(
  db: ApiAuthDatabase,
  request: Request,
  env?: (SessionEnv & { SPOONJOY_BASE_URL?: string }) | null,
  options: ApiAuthOptions = {},
): Promise<ApiPrincipal | null> {
  const prisma = () => (typeof db === "function" ? db() : Promise.resolve(db));
  const bearerToken = extractBearerToken(request);
  if (bearerToken) {
    return authenticateApiToken(
      await prisma(),
      bearerToken,
      resolveIssuerOrigin(request.url, env?.SPOONJOY_BASE_URL),
      options,
    );
  }

  const cookie = request.headers.get("Cookie");
  if (!/(^|;\s*)__session=/.test(cookie ?? "")) {
    return null;
  }

  // Browser session: one user read both loads the principal and checks that the
  // cookie's session version is still current (not revoked, user not deleted).
  const identity = await getSessionIdentity(request, env);
  if (!identity) return null;

  const user = options.d1
    ? await readSessionUserFromD1(options.d1, identity.userId)
    : await (await prisma()).user.findUnique({
      where: { id: identity.userId },
      select: { id: true, email: true, username: true, sessionVersion: true },
    });
  return user && isCurrentSession(identity, user.sessionVersion) ? toPrincipal(user, "session") : null;
}

export function requireApiPrincipal(principal: ApiPrincipal | null | undefined): ApiPrincipal {
  if (!principal) {
    throw new ApiAuthError("Authentication required", 401);
  }

  return principal;
}

export function assertCanUseOwnerEmail(principal: ApiPrincipal | null | undefined, ownerEmail: string) {
  if (principal && principal.email.toLowerCase() !== ownerEmail.toLowerCase()) {
    throw new ApiAuthError("Authenticated principal cannot act for a different owner", 403);
  }
}
