import type { ApiCredential, PrismaClient as PrismaClientType, User } from "@prisma/client";
import { getSessionIdentity, isCurrentSession, type SessionEnv } from "~/lib/session.server";
import { resolveIssuerOrigin } from "~/lib/oauth-metadata.server";

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
};

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
    (credential.expiresAt !== null && credential.expiresAt.getTime() <= Date.now())
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
  db: PrismaClientType,
  request: Request,
  env?: (SessionEnv & { SPOONJOY_BASE_URL?: string }) | null,
  options: ApiAuthOptions = {},
): Promise<ApiPrincipal | null> {
  const bearerToken = extractBearerToken(request);
  if (bearerToken) {
    return authenticateApiToken(
      db,
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

  const user = await db.user.findUnique({
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
