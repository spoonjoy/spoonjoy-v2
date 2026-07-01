import { createCookie, createCookieSessionStorage } from "react-router";

// Session cookie configuration
const DEFAULT_DEV_SESSION_SECRET = "default-dev-secret-please-change-in-production";

export interface SessionEnv {
  SESSION_SECRET?: string;
  // NODE_ENV is read so production fails closed when SESSION_SECRET is absent.
  NODE_ENV?: string;
  SPOONJOY_BASE_URL?: string;
  SPOONJOY_ALLOW_INSECURE_LOCAL_SESSIONS?: string;
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

// Helper to get user ID from session
export async function getUserId(request: Request, env?: SessionEnv | null): Promise<string | null> {
  const session = await getSession(request, env);
  const userId = session.get("userId");
  return userId || null;
}

// Helper to require user ID (throws if not authenticated)
export async function requireUserId(
  request: Request,
  redirectTo: string = "/login",
  env?: SessionEnv | null
): Promise<string> {
  const userId = await getUserId(request, env);
  if (!userId) {
    const url = new URL(request.url);
    const searchParams = new URLSearchParams([["redirectTo", url.pathname]]);
    throw new Response(null, {
      status: 302,
      headers: {
        Location: `${redirectTo}?${searchParams}`,
      },
    });
  }
  return userId;
}

// Helper to mint a `__session` Set-Cookie string for a user, without
// building a Response. Useful when the caller wants to attach the session
// to a non-redirect response (e.g. a JSON passkey-login response).
export async function createUserSessionCookie(
  userId: string,
  env?: SessionEnv | null,
  request?: Request | null
): Promise<string> {
  const storage = sessionStorageForEnv(env, request);
  const session = await storage.getSession();
  session.set("userId", userId);
  return storage.commitSession(session);
}

// Helper to create user session
export async function createUserSession(
  userId: string,
  redirectTo: string,
  env?: SessionEnv | null,
  request?: Request | null
) {
  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": await createUserSessionCookie(userId, env, request),
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
