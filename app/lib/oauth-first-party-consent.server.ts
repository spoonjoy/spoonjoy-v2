/**
 * When /oauth/authorize may skip the consent screen for Spoonjoy's own iPhone and Mac app.
 *
 * The skip needs every one of these:
 * - the client is the canonical "Spoonjoy Apple" registration: that name, exactly one redirect URI,
 *   and that URI is Spoonjoy's own callback (registration refuses the name with any other redirect);
 * - the request's redirect_uri is that callback, byte for byte;
 * - PKCE S256 (the authorize request validation already refuses anything else);
 * - the scopes are a subset of the app's own scopes, with no resource indicator;
 * - the person signed in during this authorize request's own login round trip: a signed marker
 *   cookie set at the login redirect names this request, and the session's sign-in time is after it.
 *
 * Skipping consent never signs anyone in. A session that existed before the request sees consent.
 */
import { createCookie } from "react-router";
import {
  hashOAuthOpaqueToken,
  isCanonicalOAuthClientRegistration,
  SPOONJOY_APPLE_OAUTH_CLIENT_NAME,
  SPOONJOY_APPLE_OAUTH_REDIRECT_URI,
  type RegisteredOAuthClient,
} from "~/lib/oauth-server.server";
import { getSessionAuthenticatedAt, signedCookieSettings, type SessionEnv } from "~/lib/session.server";

/** The scopes Spoonjoy Apple asks for. A request for anything else sees consent. */
export const FIRST_PARTY_AUTO_APPROVE_SCOPES: readonly string[] = [
  "kitchen:read",
  "kitchen:write",
  "shopping_list:read",
  "shopping_list:write",
  "account:read",
  "account:write",
];

/** How long the login round trip may take before the marker no longer counts. */
export const FIRST_PARTY_LOGIN_MARKER_MAX_AGE_SECONDS = 10 * 60;

export type FirstPartyLoginProvider = "google" | "github" | "login_page";

export interface FirstPartyAuthorizeParams {
  clientId: string;
  redirectUri: string;
  responseType: string;
  state: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
}

interface MarkerEnv {
  SESSION_SECRET?: string;
  SPOONJOY_BASE_URL?: string;
}

function markerCookie(env: MarkerEnv | null | undefined, request: Request) {
  const { secret, secure } = signedCookieSettings(env as SessionEnv | null | undefined, request);
  return createCookie("__sj_fp_authorize", {
    secrets: [secret],
    secure,
    httpOnly: true,
    sameSite: "lax",
    path: "/oauth/authorize",
    maxAge: FIRST_PARTY_LOGIN_MARKER_MAX_AGE_SECONDS,
  });
}

/**
 * True when the client, redirect, PKCE method, scopes and resource allow skipping consent. The
 * caller still needs a same-flow sign-in (`firstPartySameFlowLogin`).
 */
export function isFirstPartyAutoApprovalRequest(
  client: RegisteredOAuthClient | null | undefined,
  params: FirstPartyAuthorizeParams,
  validated: { scope: string; resource: string | null },
): boolean {
  return isCanonicalOAuthClientRegistration(client, SPOONJOY_APPLE_OAUTH_CLIENT_NAME, SPOONJOY_APPLE_OAUTH_REDIRECT_URI)
    && params.redirectUri === SPOONJOY_APPLE_OAUTH_REDIRECT_URI
    && params.codeChallengeMethod === "S256"
    && params.codeChallenge.length > 0
    && validated.resource === null
    && validated.scope.split(" ").every((scope) => FIRST_PARTY_AUTO_APPROVE_SCOPES.includes(scope));
}

/** Names one authorize request: every parameter that decides what the code grants and where it goes. */
async function authorizeFingerprint(params: FirstPartyAuthorizeParams): Promise<string> {
  return hashOAuthOpaqueToken(JSON.stringify([
    params.clientId,
    params.redirectUri,
    params.responseType,
    params.state,
    params.scope,
    params.codeChallenge,
    params.codeChallengeMethod,
    params.resource,
  ]));
}

/** The Set-Cookie value that marks this authorize request as sent to sign in. */
export async function firstPartyLoginMarkerCookie(
  env: MarkerEnv | null | undefined,
  request: Request,
  params: FirstPartyAuthorizeParams,
  provider: FirstPartyLoginProvider,
  now: number = Date.now(),
): Promise<string> {
  return markerCookie(env, request).serialize({ h: await authorizeFingerprint(params), at: now, p: provider });
}

/** The Set-Cookie value that removes the marker, so it is used once. */
export async function clearFirstPartyLoginMarkerCookie(env: MarkerEnv | null | undefined, request: Request): Promise<string> {
  return markerCookie(env, request).serialize("", { maxAge: 0 });
}

/**
 * The sign-in provider when the request's session was created during this request's own login round
 * trip, or null. The marker must name these exact parameters, be fresh, and predate the sign-in.
 */
export async function firstPartySameFlowLogin(
  env: MarkerEnv | null | undefined,
  request: Request,
  params: FirstPartyAuthorizeParams,
  now: number = Date.now(),
): Promise<FirstPartyLoginProvider | null> {
  const value = await markerCookie(env, request).parse(request.headers.get("Cookie"));
  if (!value || typeof value !== "object") return null;
  const { h, at, p } = value as { h?: unknown; at?: unknown; p?: unknown };
  if (typeof h !== "string" || typeof at !== "number" || !Number.isSafeInteger(at)) return null;
  if (now - at > FIRST_PARTY_LOGIN_MARKER_MAX_AGE_SECONDS * 1000 || at > now) return null;
  if (h !== await authorizeFingerprint(params)) return null;
  const authenticatedAt = await getSessionAuthenticatedAt(request, env as SessionEnv | null | undefined);
  if (authenticatedAt === null || authenticatedAt < at) return null;
  return p === "google" || p === "github" ? p : "login_page";
}
