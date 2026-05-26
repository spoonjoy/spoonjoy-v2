import type { Route } from "./+types/auth.apple";
import { redirect } from "react-router";
import { getAppleOAuthConfig } from "~/lib/env.server";
import { createAppleAuthorizationURL } from "~/lib/apple-oauth.server";
import {
  appendOAuthError,
  assertCanStartOAuthLinking,
  buildOAuthCallbackUrl,
  commitOAuthStartSession,
  generateOAuthState,
  getOAuthEnv,
  redirectTo,
  resolveOAuthStartSessionData,
} from "~/lib/oauth-route.server";

async function initiateAppleOAuth({ request, context }: Route.LoaderArgs | Route.ActionArgs) {
  const state = generateOAuthState();
  const sessionData = resolveOAuthStartSessionData(request, state);
  const env = context.cloudflare?.env;
  const linkingRedirect = await assertCanStartOAuthLinking(request, sessionData, env);
  if (linkingRedirect) return linkingRedirect;

  let config;
  try {
    config = getAppleOAuthConfig(getOAuthEnv(context));
  } catch {
    return redirect(appendOAuthError(sessionData.failureRedirect, "oauth_unconfigured"));
  }

  const redirectUri = buildOAuthCallbackUrl(request, "apple");
  sessionData.redirectUri = redirectUri;
  const authorizationUrl = createAppleAuthorizationURL(config, redirectUri, state);
  const cookie = await commitOAuthStartSession(request, "apple", sessionData, env);

  return redirectTo(authorizationUrl.toString(), { "Set-Cookie": cookie });
}

export async function loader(args: Route.LoaderArgs) {
  return initiateAppleOAuth(args);
}

export async function action(args: Route.ActionArgs) {
  return initiateAppleOAuth(args);
}

export default function AppleOAuthRoute() {
  return null;
}
