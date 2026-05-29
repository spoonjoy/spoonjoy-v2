import { createCookie, createCookieSessionStorage } from "react-router";

// Session cookie configuration
const DEFAULT_DEV_SESSION_SECRET = "default-dev-secret-please-change-in-production";

export interface SessionEnv {
  SESSION_SECRET?: string;
  // NODE_ENV is read so we surface a loud warning when SESSION_SECRET is
  // missing in production. We don't throw because wrangler.json sets
  // NODE_ENV=production for both real prod AND `wrangler dev` (no env.dev
  // override exists), so a hard throw would break e2e/dev too.
  NODE_ENV?: string;
}

const storageCache = new Map<string, ReturnType<typeof createSessionStorageForSecret>>();
const oauthStorageCache = new Map<string, ReturnType<typeof createOAuthSessionStorageForSecret>>();

// Module-scope flag so the warning fires once per process, not once per
// request. Real prod never legitimately hits this path (the Worker has
// SESSION_SECRET set as a wrangler secret), so a single noisy log is all
// the signal an operator needs.
let warnedAboutFallbackInProduction = false;

/** Test-only: reset the once-per-process warning latch. */
export function _resetSessionWarningLatchForTests(): void {
  warnedAboutFallbackInProduction = false;
}

function isProduction(env?: SessionEnv | null): boolean {
  return env?.NODE_ENV === "production" || process.env.NODE_ENV === "production";
}

function resolveSessionSecret(env?: SessionEnv | null): string {
  if (env?.SESSION_SECRET) {
    return env.SESSION_SECRET;
  }

  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }

  // The audit flagged this as P2 hardening: signing prod sessions with the
  // committed dev fallback is equivalent to no signing. We can't *throw*
  // (wrangler.json sets NODE_ENV=production in dev too), so we emit a
  // once-per-process loud warning — operators see it immediately if a real
  // prod deploy ever lands without SESSION_SECRET configured.
  if (isProduction(env) && !warnedAboutFallbackInProduction) {
    warnedAboutFallbackInProduction = true;
    console.warn(
      "[session.server] WARNING: SESSION_SECRET is not set while NODE_ENV=production. " +
        "Falling back to the committed dev secret — sessions are NOT securely signed. " +
        "Set SESSION_SECRET as a wrangler secret before this hits real production traffic.",
    );
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

function createSessionStorageForSecret(secret: string) {
  return createCookieSessionStorage({
    cookie: createCookie("__session", {
      secrets: [secret],
      sameSite: "lax",
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
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

function sessionStorageForEnv(env?: SessionEnv | null) {
  const secret = resolveSessionSecret(env);
  const cached = storageCache.get(secret);
  if (cached) return cached;

  const storage = createSessionStorageForSecret(secret);
  storageCache.set(secret, storage);
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

// Default storage exports remain for tests and local helpers. Runtime routes
// should pass Cloudflare env into the helper functions below.
export const sessionStorage = sessionStorageForEnv();
export const oauthSessionStorage = oauthSessionStorageForEnv();

// Helper to get session from request
export async function getSession(request: Request, env?: SessionEnv | null) {
  const cookie = request.headers.get("Cookie");
  return sessionStorageForEnv(env).getSession(cookie);
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
  env?: SessionEnv | null
): Promise<string> {
  const storage = sessionStorageForEnv(env);
  const session = await storage.getSession();
  session.set("userId", userId);
  return storage.commitSession(session);
}

// Helper to create user session
export async function createUserSession(
  userId: string,
  redirectTo: string,
  env?: SessionEnv | null
) {
  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": await createUserSessionCookie(userId, env),
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
  const storage = sessionStorageForEnv(env);
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
