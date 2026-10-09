import { createCookie, createCookieSessionStorage, type Session } from "react-router";
import { getLocalDb } from "~/lib/db.server";

// Session cookie configuration
const DEFAULT_DEV_SESSION_SECRET = "default-dev-secret-please-change-in-production";

export interface SessionEnv {
  SESSION_SECRET?: string;
  // NODE_ENV is read so production fails closed when SESSION_SECRET is absent.
  NODE_ENV?: string;
  SPOONJOY_BASE_URL?: string;
  SPOONJOY_ALLOW_INSECURE_LOCAL_SESSIONS?: string;
  // The request's D1 binding. Session reads check the user's session version
  // with a raw statement on it; without it (unit tests, scripts) they use Prisma
  // on the local database.
  DB?: D1Database;
}

const USER_ID_KEY = "userId";
const SESSION_VERSION_KEY = "sessionVersion";
// When the person last proved who they are by signing in (ms since the epoch). Re-issuing a cookie
// for the same sign-in (a session version bump, linking another sign-in method) keeps it.
const AUTHENTICATED_AT_KEY = "authenticatedAt";

/** Who a signed session cookie says the visitor is, before any database check. */
export interface SessionIdentity {
  userId: string;
  sessionVersion: number;
}

const storageCache = new Map<string, ReturnType<typeof createSessionStorageForSecret>>();
const oauthStorageCache = new Map<string, ReturnType<typeof createOAuthSessionStorageForSecret>>();
type CookieSessionStorage = ReturnType<typeof createSessionStorageForSecret>;

/** Test-only: reset the once-per-process warning latch. */
export function _resetSessionWarningLatchForTests(): void {
  // Kept for backwards-compatible tests that import this helper.
}

function isProduction(env?: SessionEnv | null): boolean {
  return env?.NODE_ENV === "production" || process.env.NODE_ENV === "production";
}

function normalizedHostname(hostname: string): string {
  const lowercased = hostname.toLowerCase();
  return lowercased.startsWith("[") && lowercased.endsWith("]") ? lowercased.slice(1, -1) : lowercased;
}

function isLocalhostHostname(hostname: string): boolean {
  const normalized = normalizedHostname(hostname);
  return normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "127.0.0.1" || normalized === "::1";
}

function isLocalhostURL(value: string | undefined): boolean {
  return Boolean(value && URL.canParse(value) && isLocalhostHostname(new URL(value).hostname));
}

function isLocalhostRequest(request?: Request | null): boolean {
  return Boolean(request && isLocalhostURL(request.url));
}

function isEnabledEnvFlag(value: unknown): boolean {
  return typeof value === "string" && /^(1|true|yes)$/i.test(value.trim());
}

function allowsInsecureLocalSessions(env?: SessionEnv | null, request?: Request | null): boolean {
  if (!isLocalhostRequest(request)) return false;
  return (
    isLocalhostURL(env?.SPOONJOY_BASE_URL) ||
    isLocalhostURL(process.env.SPOONJOY_BASE_URL) ||
    isEnabledEnvFlag(env?.SPOONJOY_ALLOW_INSECURE_LOCAL_SESSIONS) ||
    isEnabledEnvFlag(process.env.SPOONJOY_ALLOW_INSECURE_LOCAL_SESSIONS)
  );
}

function shouldUseSecureSessionCookie(env?: SessionEnv | null, request?: Request | null): boolean {
  return isProduction(env) && !allowsInsecureLocalSessions(env, request);
}

function sessionCacheKey(secret: string, secure: boolean): string {
  return `${secure ? "secure" : "local"}:${secret}`;
}

function resolveSessionSecret(env?: SessionEnv | null, request?: Request | null): string {
  if (env?.SESSION_SECRET) {
    return env.SESSION_SECRET;
  }

  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }

  if (isProduction(env) && !allowsInsecureLocalSessions(env, request)) {
    throw new Error("SESSION_SECRET is required when NODE_ENV=production.");
  }

  return DEFAULT_DEV_SESSION_SECRET;
}

export function sanitizeSessionRedirect(
  redirectTo: string | null | undefined,
  fallback: string = "/"
): string {
  if (
    !redirectTo ||
    !redirectTo.startsWith("/") ||
    redirectTo.startsWith("//") ||
    /[\u0000-\u001F\u007F\\]/.test(redirectTo)
  ) {
    return fallback;
  }

  return redirectTo;
}

function createSessionStorageForSecret(secret: string, secure: boolean) {
  return createCookieSessionStorage({
    cookie: createCookie("__session", {
      secrets: [secret],
      sameSite: "lax",
      path: "/",
      httpOnly: true,
      secure,
      maxAge: 60 * 60 * 24 * 30, // 30 days
    }),
  });
}

function createOAuthSessionStorageForSecret(secret: string) {
  return createCookieSessionStorage({
    cookie: createCookie("__oauth", {
      secrets: [secret],
      sameSite: "none",
      path: "/",
      httpOnly: true,
      secure: true,
      maxAge: 60 * 10,
    }),
  });
}

function sessionStorageForEnv(env?: SessionEnv | null, request?: Request | null) {
  const secret = resolveSessionSecret(env, request);
  const secure = shouldUseSecureSessionCookie(env, request);
  const key = sessionCacheKey(secret, secure);
  const cached = storageCache.get(key);
  if (cached) return cached;

  const storage = createSessionStorageForSecret(secret, secure);
  storageCache.set(key, storage);
  return storage;
}

function oauthSessionStorageForEnv(env?: SessionEnv | null) {
  const secret = resolveSessionSecret(env);
  const cached = oauthStorageCache.get(secret);
  if (cached) return cached;

  const storage = createOAuthSessionStorageForSecret(secret);
  oauthStorageCache.set(secret, storage);
  return storage;
}

function lazyCookieSessionStorage(getStorage: () => CookieSessionStorage): CookieSessionStorage {
  return {
    getSession: (...args) => getStorage().getSession(...args),
    commitSession: (...args) => getStorage().commitSession(...args),
    destroySession: (...args) => getStorage().destroySession(...args),
  };
}

// Default storage exports remain for tests and local helpers. They are lazy so
// the production Worker can import this module before request-scoped env exists.
export const sessionStorage = lazyCookieSessionStorage(() => sessionStorageForEnv());
export const oauthSessionStorage = lazyCookieSessionStorage(() => oauthSessionStorageForEnv());

// Helper to get session from request
export async function getSession(request: Request, env?: SessionEnv | null) {
  const cookie = request.headers.get("Cookie");
  return sessionStorageForEnv(env, request).getSession(cookie);
}

function identityFromSession(session: Session): SessionIdentity | null {
  const userId = session.get(USER_ID_KEY);
  if (typeof userId !== "string" || !userId) return null;

  // Cookies issued before session versions existed carry no version. They count
  // as version 0, so they stay valid until the user's first bump.
  const rawVersion = session.get(SESSION_VERSION_KEY);
  const sessionVersion = rawVersion === undefined ? 0 : rawVersion;
  if (!Number.isSafeInteger(sessionVersion) || sessionVersion < 0) return null;

  return { userId, sessionVersion };
}

/**
 * Reads the signed session cookie without checking the database. Callers that
 * trust the identity must also check it with `isCurrentSession` against the
 * user's current `sessionVersion` (see `getUserId` and `authenticateApiRequest`).
 */
export async function getSessionIdentity(
  request: Request,
  env?: SessionEnv | null
): Promise<SessionIdentity | null> {
  return identityFromSession(await getSession(request, env));
}

/** A cookie is current only while its user exists and its version is the user's current one. */
export function isCurrentSession(identity: SessionIdentity, currentSessionVersion: number | null | undefined): boolean {
  return identity.sessionVersion === currentSessionVersion;
}

// The slice of a D1 binding the session check uses.
interface SessionVersionD1 {
  prepare(query: string): {
    bind(...values: unknown[]): { first<T>(): Promise<T | null> };
  };
}

const SESSION_VERSION_SQL = 'SELECT "sessionVersion" FROM "User" WHERE "id" = ?';

// One primary-key lookup that selects only the version. On the Worker it is a
// raw prepared statement on the D1 binding: constructing a PrismaClient for it
// costs far more CPU than the query, on every request that carries a session.
// Prisma is used only where there is no binding (unit tests, local scripts).
async function readCurrentSessionVersion(userId: string, env?: SessionEnv | null): Promise<number | null> {
  if (env?.DB) {
    const row = await (env.DB as SessionVersionD1)
      .prepare(SESSION_VERSION_SQL)
      .bind(userId)
      .first<{ sessionVersion: number }>();
    return row ? row.sessionVersion : null;
  }

  const db = await getLocalDb();
  const user = await db.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
  return user ? user.sessionVersion : null;
}

/**
 * Checks an identity from a signed cookie against the database: true only while
 * the user exists and the identity's version is the user's current one.
 */
export async function isSessionIdentityCurrent(
  identity: SessionIdentity,
  env?: SessionEnv | null
): Promise<boolean> {
  return isCurrentSession(identity, await readCurrentSessionVersion(identity.userId, env));
}

interface SessionCheck {
  session: Session;
  // The cookie's identity, only when it is still current.
  identity: SessionIdentity | null;
  // True when the request carried a signed-in cookie that is no longer valid.
  stale: boolean;
}

async function checkSession(request: Request, env?: SessionEnv | null): Promise<SessionCheck> {
  const session = await getSession(request, env);
  const identity = identityFromSession(session);
  if (!identity) return { session, identity: null, stale: session.has(USER_ID_KEY) };

  return (await isSessionIdentityCurrent(identity, env))
    ? { session, identity, stale: false }
    : { session, identity: null, stale: true };
}

// The root loader and a route loader read the session for the same Request
// object, so the version lookup runs once per request (and environment).
const sessionChecks = new WeakMap<Request, Map<SessionEnv | null, Promise<SessionCheck>>>();

function checkSessionOnce(request: Request, env?: SessionEnv | null): Promise<SessionCheck> {
  const key = env ?? null;
  let checksForRequest = sessionChecks.get(request);
  if (!checksForRequest) {
    checksForRequest = new Map();
    sessionChecks.set(request, checksForRequest);
  }

  let check = checksForRequest.get(key);
  if (!check) {
    check = checkSession(request, env);
    checksForRequest.set(key, check);
  }
  return check;
}

/** The signed-in identity (user id and session version), or null when signed out or revoked. */
export async function getCurrentSessionIdentity(
  request: Request,
  env?: SessionEnv | null
): Promise<SessionIdentity | null> {
  return (await checkSessionOnce(request, env)).identity;
}

// Helper to get user ID from session. A cookie for a deleted user, or one whose
// version is behind the user's current session version, counts as signed out.
export async function getUserId(request: Request, env?: SessionEnv | null): Promise<string | null> {
  return (await getCurrentSessionIdentity(request, env))?.userId ?? null;
}

// Helper to require user ID (throws if not authenticated). A stale cookie is
// cleared on the way to the sign-in page.
export async function requireUserId(
  request: Request,
  redirectTo: string = "/login",
  env?: SessionEnv | null
): Promise<string> {
  const check = await checkSessionOnce(request, env);
  if (!check.identity) {
    const url = new URL(request.url);
    const searchParams = new URLSearchParams([["redirectTo", url.pathname]]);
    const headers = new Headers({ Location: `${redirectTo}?${searchParams}` });
    if (check.stale) {
      headers.set("Set-Cookie", await sessionStorageForEnv(env, request).destroySession(check.session));
    }
    throw new Response(null, { status: 302, headers });
  }
  return check.identity.userId;
}

export interface CreateUserSessionOptions {
  // The user's current session version, when the caller already has it (for
  // example straight after bumping it). Otherwise it is read from the database.
  sessionVersion?: number;
  // When the person signed in. Omitted: now, because this cookie is for a sign-in. A number or
  // null: the existing cookie's value (see getSessionAuthenticatedAt), for a cookie re-issued
  // without a new sign-in; null records none.
  authenticatedAt?: number | null;
}

/**
 * When the request's session cookie says the person signed in (ms since the epoch), or null when
 * it records no time. Only meaningful for a session that is also current (getUserId).
 */
export async function getSessionAuthenticatedAt(request: Request, env?: SessionEnv | null): Promise<number | null> {
  const value = (await getSession(request, env)).get(AUTHENTICATED_AT_KEY);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

// Helper to mint a `__session` Set-Cookie string for a user, without
// building a Response. Useful when the caller wants to attach the session
// to a non-redirect response (e.g. a JSON passkey-login response). The cookie
// carries the user's session version, so bumping the version revokes it.
export async function createUserSessionCookie(
  userId: string,
  env?: SessionEnv | null,
  request?: Request | null,
  options: CreateUserSessionOptions = {}
): Promise<string> {
  const sessionVersion = options.sessionVersion ?? (await readCurrentSessionVersion(userId, env)) ?? 0;
  const storage = sessionStorageForEnv(env, request);
  const session = await storage.getSession();
  session.set(USER_ID_KEY, userId);
  session.set(SESSION_VERSION_KEY, sessionVersion);
  const authenticatedAt = options.authenticatedAt === undefined ? Date.now() : options.authenticatedAt;
  if (authenticatedAt !== null) session.set(AUTHENTICATED_AT_KEY, authenticatedAt);
  return storage.commitSession(session);
}

// Helper to create user session
export async function createUserSession(
  userId: string,
  redirectTo: string,
  env?: SessionEnv | null,
  request?: Request | null,
  options: CreateUserSessionOptions = {}
) {
  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": await createUserSessionCookie(userId, env, request, options),
      Location: sanitizeSessionRedirect(redirectTo),
    },
  });
}

// Helper to destroy user session
/* istanbul ignore next -- @preserve default parameter branch */
export async function destroyUserSession(
  request: Request,
  redirectTo: string = "/",
  env?: SessionEnv | null
) {
  const storage = sessionStorageForEnv(env, request);
  const session = await getSession(request, env);

  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": await storage.destroySession(session),
      Location: sanitizeSessionRedirect(redirectTo),
    },
  });
}

export function getOAuthSessionStorage(env?: SessionEnv | null) {
  return oauthSessionStorageForEnv(env);
}
