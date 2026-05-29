import type { Route } from "./+types/auth.apple";
import { redirect } from "react-router";
import { getAppleOAuthConfig } from "~/lib/env.server";
import { createAppleAuthorizationURL } from "~/lib/apple-oauth.server";
import {
  appendOAuthError,
  assertCanStartOAuthLinking,
  buildAppleReturnUrl,
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

  // Apple validates redirect_uri against the Service ID's registered Return
  // URLs — which is the legacy RedwoodJS dbAuth-oauth path, not /auth/apple/
  // callback. Send the registered path so Apple doesn't reject on its consent
  // screen. The compat route (routes/redwood-functions-auth-oauth.tsx) handles
  // the form_post callback.
  const redirectUri = buildAppleReturnUrl(request, sessionData.linking ? "linkAppleAccount" : "loginWithApple");
  sessionData.redirectUri = redirectUri;
  let authorizationUrl;
  try {
    authorizationUrl = createAppleAuthorizationURL(config, redirectUri, state);
  } catch {
    return redirect(appendOAuthError(sessionData.failureRedirect, "oauth_unconfigured"));
  }

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
