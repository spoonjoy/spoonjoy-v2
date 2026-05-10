import type { Route } from "./+types/auth.google.callback";
import { createUserSession, getUserId } from "~/lib/session.server";
import { getGoogleOAuthConfig } from "~/lib/env.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { handleGoogleOAuthCallback } from "~/lib/google-oauth-callback.server";
import { verifyGoogleCallback } from "~/lib/google-oauth.server";
import {
  buildOAuthCallbackUrl,
  getOAuthEnv,
  isValidOAuthState,
  readOAuthStartSession,
  redirectWithOAuthError,
} from "~/lib/oauth-route.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const stored = await readOAuthStartSession(request, "google");
  const failureRedirect = stored?.failureRedirect ?? "/login";
  const providerError = url.searchParams.get("error");
  const callbackState = url.searchParams.get("state");

  if (providerError) {
    return redirectWithOAuthError(request, "google", failureRedirect, providerError);
  }

  if (!stored) {
    return redirectWithOAuthError(request, "google", failureRedirect, "invalid_state");
  }

  if (!callbackState || !isValidOAuthState(stored.state, callbackState)) {
    return redirectWithOAuthError(request, "google", failureRedirect, "invalid_state");
  }

  if (!stored.codeVerifier) {
    return redirectWithOAuthError(request, "google", failureRedirect, "invalid_code_verifier");
  }

  let config;
  try {
    config = getGoogleOAuthConfig(getOAuthEnv(context));
  } catch {
    return redirectWithOAuthError(request, "google", failureRedirect, "oauth_unconfigured");
  }

  const redirectUri = buildOAuthCallbackUrl(request, "google");
  const verifyResult = await verifyGoogleCallback(config, redirectUri, {
    code: url.searchParams.get("code") ?? "",
    state: callbackState,
    codeVerifier: stored.codeVerifier,
  });

  if (!verifyResult.success || !verifyResult.googleUser) {
    return redirectWithOAuthError(request, "google", failureRedirect, verifyResult.error);
  }

  const currentUserId = stored.linking ? await getUserId(request) : null;
  if (stored.linking && !currentUserId) {
    return redirectWithOAuthError(request, "google", failureRedirect, "login_required");
  }

  const database = await getRequestDb(context);
  const callbackResult = await handleGoogleOAuthCallback({
    db: database,
    googleUser: verifyResult.googleUser,
    currentUserId,
    redirectTo: stored.redirectTo,
  });

  if (!callbackResult.success || !callbackResult.userId) {
    return redirectWithOAuthError(request, "google", failureRedirect, callbackResult.error);
  }

  return createUserSession(callbackResult.userId, callbackResult.redirectTo);
}

export default function GoogleOAuthCallbackRoute() {
  return null;
}
