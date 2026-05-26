import type { AppLoadContext } from "react-router";
import { redirect } from "react-router";
import { generateState } from "arctic";
import type { OAuthEnv } from "~/lib/env.server";
import { getCloudflareEnv } from "~/lib/route-platform.server";
import { getSession, getUserId, sessionStorage } from "~/lib/session.server";

export type OAuthProvider = "google" | "github" | "apple";

export interface OAuthStartSessionData {
  state: string;
  codeVerifier?: string;
  redirectTo: string;
  failureRedirect: string;
  linking: boolean;
}

const OAUTH_SESSION_PREFIX = "oauth";
const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::\d{1,5})?$/i;

function oauthSessionKey(provider: OAuthProvider, key: keyof OAuthStartSessionData) {
  return `${OAUTH_SESSION_PREFIX}:${provider}:${key}`;
}

export function generateOAuthState(): string {
  return generateState();
}

export function getOAuthEnv(context: AppLoadContext): OAuthEnv {
  return (getCloudflareEnv(context) ?? process.env) as OAuthEnv;
}

function forwardedOrigin(request: Request): string | null {
  const forwardedHost = request.headers.get("X-Forwarded-Host")?.split(",")[0]?.trim();
  if (!forwardedHost || !HOST_PATTERN.test(forwardedHost)) return null;

  const forwardedProto = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim().toLowerCase();
  const protocol = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : "https";
  return `${protocol}://${forwardedHost}`;
}

export function buildOAuthCallbackUrl(request: Request, provider: OAuthProvider): string {
  const url = new URL(request.url);
  return `${forwardedOrigin(request) ?? url.origin}/auth/${provider}/callback`;
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
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  return value;
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

export async function assertCanStartOAuthLinking(request: Request, data: OAuthStartSessionData) {
  if (!data.linking) return null;

  const userId = await getUserId(request);
  if (userId) return null;

  return redirect("/login?redirectTo=/account/settings&oauthError=login_required");
}

export async function commitOAuthStartSession(
  request: Request,
  provider: OAuthProvider,
  data: OAuthStartSessionData
): Promise<string> {
  const session = await getSession(request);

  session.set(oauthSessionKey(provider, "state"), data.state);
  session.set(oauthSessionKey(provider, "redirectTo"), data.redirectTo);
  session.set(oauthSessionKey(provider, "failureRedirect"), data.failureRedirect);
  session.set(oauthSessionKey(provider, "linking"), data.linking ? "true" : "false");

  if (data.codeVerifier) {
    session.set(oauthSessionKey(provider, "codeVerifier"), data.codeVerifier);
  } else {
    session.unset(oauthSessionKey(provider, "codeVerifier"));
  }

  return sessionStorage.commitSession(session);
}

export async function readOAuthStartSession(
  request: Request,
  provider: OAuthProvider
): Promise<OAuthStartSessionData | null> {
  const session = await getSession(request);
  const state = session.get(oauthSessionKey(provider, "state"));

  if (typeof state !== "string" || !state) {
    return null;
  }

  const codeVerifier = session.get(oauthSessionKey(provider, "codeVerifier"));
  const redirectTo = session.get(oauthSessionKey(provider, "redirectTo"));
  const failureRedirect = session.get(oauthSessionKey(provider, "failureRedirect"));
  const linking = session.get(oauthSessionKey(provider, "linking"));

  return {
    state,
    codeVerifier: typeof codeVerifier === "string" ? codeVerifier : undefined,
    redirectTo: sanitizeInternalRedirect(
      typeof redirectTo === "string" ? redirectTo : null,
      "/recipes"
    ),
    failureRedirect: sanitizeInternalRedirect(
      typeof failureRedirect === "string" ? failureRedirect : null,
      "/login"
    ),
    linking: linking === "true",
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
  error: string | undefined
) {
  const session = await getSession(request);
  clearOAuthStartSession(session, provider);

  return redirectTo(appendOAuthError(failureRedirect, error), {
    "Set-Cookie": await sessionStorage.commitSession(session),
  });
}

export function clearOAuthStartSession(
  session: Awaited<ReturnType<typeof sessionStorage.getSession>>,
  provider: OAuthProvider
) {
  session.unset(oauthSessionKey(provider, "state"));
  session.unset(oauthSessionKey(provider, "codeVerifier"));
  session.unset(oauthSessionKey(provider, "redirectTo"));
  session.unset(oauthSessionKey(provider, "failureRedirect"));
  session.unset(oauthSessionKey(provider, "linking"));
}

export function isValidOAuthState(storedState: string | undefined, callbackState: string | null) {
  return Boolean(storedState && callbackState && storedState === callbackState);
}
