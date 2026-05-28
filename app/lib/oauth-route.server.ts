import type { AppLoadContext } from "react-router";
import { redirect } from "react-router";
import { generateState } from "arctic";
import { requestCanonicalOrigin } from "~/lib/canonical-host.server";
import type { OAuthEnv } from "~/lib/env.server";
import { getCloudflareEnv } from "~/lib/route-platform.server";
import { getOAuthSessionStorage, getUserId, sanitizeSessionRedirect, type SessionEnv } from "~/lib/session.server";

export type OAuthProvider = "google" | "github" | "apple";

export interface OAuthStartSessionData {
  state: string;
  codeVerifier?: string;
  redirectUri?: string;
  redirectTo: string;
  failureRedirect: string;
  linking: boolean;
  linkingUserId?: string;
}

const OAUTH_SESSION_PREFIX = "oauth";
const CALLBACK_PATHS: Record<OAuthProvider, string> = {
  apple: "/auth/apple/callback",
  github: "/auth/github/callback",
  google: "/auth/google/callback",
};

function oauthSessionKey(provider: OAuthProvider, key: keyof OAuthStartSessionData) {
  return `${OAUTH_SESSION_PREFIX}:${provider}:${key}`;
}

export function generateOAuthState(): string {
  return generateState();
}

export function getOAuthEnv(context: AppLoadContext): OAuthEnv {
  return (getCloudflareEnv(context) ?? process.env) as OAuthEnv;
}

export function buildOAuthCallbackUrl(request: Request, provider: OAuthProvider): string {
  return `${requestCanonicalOrigin(request)}${CALLBACK_PATHS[provider]}`;
}

export function redirectTo(location: string, headers?: HeadersInit) {
  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      Location: location,
    },
  });
}

export function sanitizeInternalRedirect(value: string | null | undefined, fallback: string): string {
  return sanitizeSessionRedirect(value, fallback);
}

function sameOriginReferer(request: Request): URL | null {
  const referer = request.headers.get("Referer") || request.referrer;
  if (!referer || referer === "about:client") return null;

  try {
    const requestUrl = new URL(request.url);
    const refererUrl = new URL(referer);
    return refererUrl.origin === requestUrl.origin ? refererUrl : null;
  } catch {
    return null;
  }
}

export function resolveOAuthStartSessionData(
  request: Request,
  state: string,
  options?: { codeVerifier?: string }
): OAuthStartSessionData {
  const url = new URL(request.url);
  const refererUrl = sameOriginReferer(request);
  const linking = url.searchParams.get("linking") === "true";
  const refererPath = refererUrl?.pathname;
  const defaultFailureRedirect = refererPath === "/signup" ? "/signup" : "/login";
  const defaultRedirectTo = linking ? "/account/settings" : "/recipes";

  const requestedRedirectTo =
    url.searchParams.get("redirectTo") ?? refererUrl?.searchParams.get("redirectTo");
  const requestedFailureRedirect = url.searchParams.get("failureRedirect");

  return {
    state,
    codeVerifier: options?.codeVerifier,
    redirectTo: sanitizeInternalRedirect(requestedRedirectTo, defaultRedirectTo),
    failureRedirect: linking
      ? "/account/settings"
      : sanitizeInternalRedirect(requestedFailureRedirect, defaultFailureRedirect),
    linking,
  };
}

export async function assertCanStartOAuthLinking(
  request: Request,
  data: OAuthStartSessionData,
  env?: SessionEnv | null
) {
  if (!data.linking) return null;

  const userId = await getUserId(request, env);
  if (userId) {
    data.linkingUserId = userId;
    return null;
  }

  return redirect("/login?redirectTo=/account/settings&oauthError=login_required");
}

export async function commitOAuthStartSession(
  request: Request,
  provider: OAuthProvider,
  data: OAuthStartSessionData,
  env?: SessionEnv | null
): Promise<string> {
  const storage = getOAuthSessionStorage(env);
  const session = await storage.getSession(request.headers.get("Cookie"));

  session.set(oauthSessionKey(provider, "state"), data.state);
  session.set(oauthSessionKey(provider, "redirectTo"), data.redirectTo);
  session.set(oauthSessionKey(provider, "failureRedirect"), data.failureRedirect);
  session.set(oauthSessionKey(provider, "linking"), data.linking ? "true" : "false");

  if (data.codeVerifier) {
    session.set(oauthSessionKey(provider, "codeVerifier"), data.codeVerifier);
  } else {
    session.unset(oauthSessionKey(provider, "codeVerifier"));
  }

  if (data.redirectUri) {
    session.set(oauthSessionKey(provider, "redirectUri"), data.redirectUri);
  } else {
    session.unset(oauthSessionKey(provider, "redirectUri"));
  }

  if (data.linkingUserId) {
    session.set(oauthSessionKey(provider, "linkingUserId"), data.linkingUserId);
  } else {
    session.unset(oauthSessionKey(provider, "linkingUserId"));
  }

  return storage.commitSession(session);
}

export async function readOAuthStartSession(
  request: Request,
  provider: OAuthProvider,
  env?: SessionEnv | null
): Promise<OAuthStartSessionData | null> {
  const session = await getOAuthSessionStorage(env).getSession(request.headers.get("Cookie"));
  const state = session.get(oauthSessionKey(provider, "state"));

  if (typeof state !== "string" || !state) {
    return null;
  }

  const codeVerifier = session.get(oauthSessionKey(provider, "codeVerifier"));
  const redirectTo = session.get(oauthSessionKey(provider, "redirectTo"));
  const redirectUri = session.get(oauthSessionKey(provider, "redirectUri"));
  const failureRedirect = session.get(oauthSessionKey(provider, "failureRedirect"));
  const linking = session.get(oauthSessionKey(provider, "linking"));
  const linkingUserId = session.get(oauthSessionKey(provider, "linkingUserId"));

  return {
    state,
    codeVerifier: typeof codeVerifier === "string" ? codeVerifier : undefined,
    redirectUri: typeof redirectUri === "string" ? redirectUri : undefined,
    redirectTo: sanitizeInternalRedirect(
      typeof redirectTo === "string" ? redirectTo : null,
      "/recipes"
    ),
    failureRedirect: sanitizeInternalRedirect(
      typeof failureRedirect === "string" ? failureRedirect : null,
      "/login"
    ),
    linking: linking === "true",
    linkingUserId: typeof linkingUserId === "string" ? linkingUserId : undefined,
  };
}

export function appendOAuthError(redirectTo: string, error: string | undefined): string {
  const url = new URL(redirectTo, "http://spoonjoy.local");
  url.searchParams.set("oauthError", error || "oauth_error");
  return `${url.pathname}${url.search}`;
}

export async function redirectWithOAuthError(
  request: Request,
  provider: OAuthProvider,
  failureRedirect: string,
  error: string | undefined,
  env?: SessionEnv | null
) {
  return redirectTo(appendOAuthError(failureRedirect, error), {
    "Set-Cookie": await destroyOAuthStartSession(request, env),
  });
}

export async function destroyOAuthStartSession(
  request: Request,
  env?: SessionEnv | null
): Promise<string> {
  const storage = getOAuthSessionStorage(env);
  const session = await storage.getSession(request.headers.get("Cookie"));
  return storage.destroySession(session);
}

export function isValidOAuthState(storedState: string | undefined, callbackState: string | null) {
  return Boolean(storedState && callbackState && storedState === callbackState);
}
