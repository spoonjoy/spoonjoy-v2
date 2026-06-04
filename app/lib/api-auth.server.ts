import type { ApiCredential, PrismaClient as PrismaClientType, User } from "@prisma/client";
import { getUserId, type SessionEnv } from "~/lib/session.server";

export type ApiPrincipalSource = "session" | "bearer" | "environment";

export const API_CREDENTIAL_SCOPE_VALUES = [
  "public:read",
  "recipes:read",
  "shopping_list:read",
  "shopping_list:write",
  "cookbooks:read",
  "tokens:read",
  "tokens:write",
  "offline_access",
  "kitchen:read",
  "kitchen:write",
] as const;

export type ApiCredentialScope = (typeof API_CREDENTIAL_SCOPE_VALUES)[number];

export const DEFAULT_PERSONAL_API_TOKEN_SCOPES = [
  "cookbooks:read",
  "public:read",
  "recipes:read",
  "shopping_list:read",
  "shopping_list:write",
  "tokens:read",
  "tokens:write",
] as const satisfies readonly ApiCredentialScope[];

export const ALL_FIRST_SLICE_SCOPES = [
  ...DEFAULT_PERSONAL_API_TOKEN_SCOPES,
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
  oauthResource?: string | null,
): ApiPrincipal {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    source,
    credentialId,
    oauthClientId,
    oauthResource,
    scopes: [...scopes],
  };
}

export async function principalFromUserId(
  db: PrismaClientType,
  userId: string,
  source: ApiPrincipalSource = "session",
  credentialId?: string
): Promise<ApiPrincipal | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, username: true },
  });

  return user ? toPrincipal(user, source, credentialId) : null;
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
  options: { expiresAt?: Date | null; scopes?: string | string[] | null; oauthClientId?: string | null; oauthResource?: string | null } = {}
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
      oauthResource: options.oauthResource ?? null,
      expiresAt: options.expiresAt ?? null,
    },
  });

  return { token, credential };
}

export async function authenticateApiToken(db: PrismaClientType, token: string): Promise<ApiPrincipal> {
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

  await db.apiCredential.update({
    where: { id: credential.id },
    data: { lastUsedAt: new Date() },
  });

  return toPrincipal(
    credential.user,
    "bearer",
    credential.id,
    expandCredentialScopes(credential.scopes),
    credential.oauthClientId,
    credential.oauthResource,
  );
}

export async function authenticateApiRequest(
  db: PrismaClientType,
  request: Request,
  env?: SessionEnv | null
): Promise<ApiPrincipal | null> {
  const bearerToken = extractBearerToken(request);
  if (bearerToken) {
    return authenticateApiToken(db, bearerToken);
  }

  const sessionUserId = await getUserId(request, env);
  return sessionUserId ? principalFromUserId(db, sessionUserId, "session") : null;
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
