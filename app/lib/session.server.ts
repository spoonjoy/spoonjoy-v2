import { createCookie, createCookieSessionStorage } from "react-router";

// Session cookie configuration
/* istanbul ignore next -- @preserve fallback evaluated at module load time */
const SESSION_SECRET = process.env.SESSION_SECRET || "default-dev-secret-please-change-in-production";

// Create a cookie for session management
const sessionCookie = createCookie("__session", {
  secrets: [SESSION_SECRET],
  sameSite: "lax",
  path: "/",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 30, // 30 days
});

const oauthSessionCookie = createCookie("__oauth", {
  secrets: [SESSION_SECRET],
  sameSite: "none",
  path: "/",
  httpOnly: true,
  secure: true,
  maxAge: 60 * 10,
});

// Create cookie session storage
export const sessionStorage = createCookieSessionStorage({
  cookie: sessionCookie,
});

export const oauthSessionStorage = createCookieSessionStorage({
  cookie: oauthSessionCookie,
});

// Helper to get session from request
export async function getSession(request: Request) {
  const cookie = request.headers.get("Cookie");
  return sessionStorage.getSession(cookie);
}

// Helper to get user ID from session
export async function getUserId(request: Request): Promise<string | null> {
  const session = await getSession(request);
  const userId = session.get("userId");
  return userId || null;
}

// Helper to require user ID (throws if not authenticated)
export async function requireUserId(request: Request, redirectTo: string = "/login"): Promise<string> {
  const userId = await getUserId(request);
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

// Helper to create user session
export async function createUserSession(userId: string, redirectTo: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);

  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": await sessionStorage.commitSession(session),
      Location: redirectTo,
    },
  });
}

// Helper to destroy user session
/* istanbul ignore next -- @preserve default parameter branch */
export async function destroyUserSession(request: Request, redirectTo: string = "/") {
  const session = await getSession(request);

  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": await sessionStorage.destroySession(session),
      Location: redirectTo,
    },
  });
}
