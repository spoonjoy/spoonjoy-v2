import type { Route } from "./+types/auth.google";
import { redirect } from "react-router";
import { getGoogleOAuthConfig } from "~/lib/env.server";
import {
  buildOAuthCallbackUrl,
  commitOAuthStartSession,
  generateOAuthState,
  getOAuthEnv,
  resolveOAuthStartSessionData,
  assertCanStartOAuthLinking,
  appendOAuthError,
  redirectTo,
} from "~/lib/oauth-route.server";
import { createGoogleAuthorizationURL, generateCodeVerifier } from "~/lib/google-oauth.server";

async function initiateGoogleOAuth({ request, context }: Route.LoaderArgs | Route.ActionArgs) {
  const state = generateOAuthState();
  const codeVerifier = generateCodeVerifier();
  const sessionData = resolveOAuthStartSessionData(request, state, { codeVerifier });
  const linkingRedirect = await assertCanStartOAuthLinking(request, sessionData);
  if (linkingRedirect) return linkingRedirect;

  let config;
  try {
    config = getGoogleOAuthConfig(getOAuthEnv(context));
  } catch {
    return redirect(appendOAuthError(sessionData.failureRedirect, "oauth_unconfigured"));
  }

  const redirectUri = buildOAuthCallbackUrl(request, "google");
  sessionData.redirectUri = redirectUri;
  const authorizationUrl = createGoogleAuthorizationURL(config, redirectUri, state, codeVerifier);
  const cookie = await commitOAuthStartSession(request, "google", sessionData);

  return redirectTo(authorizationUrl.toString(), { "Set-Cookie": cookie });
}

export async function loader(args: Route.LoaderArgs) {
  return initiateGoogleOAuth(args);
}

export async function action(args: Route.ActionArgs) {
  return initiateGoogleOAuth(args);
}

export default function GoogleOAuthRoute() {
  return null;
}
