import type { Route } from "./+types/auth.apple";
import { redirect } from "react-router";
import {
  getAppleOAuthCallbackConfig,
  getAppleOAuthConfig,
} from "~/lib/env.server";
import { createRegisteredAppleAuthorizationURL } from "~/lib/apple-oauth.server";
import { authTelemetryFromContext } from "~/lib/auth-telemetry.server";
import {
  appendOAuthError,
  assertCanStartOAuthLinking,
  buildAppleReturnUrl,
  buildRegisteredAppleReturnUrls,
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

  const telemetry = authTelemetryFromContext(context);

  let config;
  let callbackConfig;
  try {
    const oauthEnv = getOAuthEnv(context);
    config = getAppleOAuthConfig(oauthEnv);
    callbackConfig = getAppleOAuthCallbackConfig(oauthEnv);
  } catch (error) {
    telemetry.captureException(error, { provider: "apple", phase: "initiate" });
    return redirect(appendOAuthError(sessionData.failureRedirect, "oauth_unconfigured"));
  }

  const callbackMethod = sessionData.linking ? "linkAppleAccount" : "loginWithApple";
  const redirectUri = buildAppleReturnUrl(request, callbackMethod, callbackConfig.mode);
  const registeredRedirectUris = buildRegisteredAppleReturnUrls(
    request,
    callbackMethod,
    callbackConfig
  );
  sessionData.redirectUri = redirectUri;
  let authorizationUrl;
  try {
    authorizationUrl = createRegisteredAppleAuthorizationURL(
      config,
      redirectUri,
      state,
      registeredRedirectUris
    );
  } catch (error) {
    telemetry.captureException(error, { provider: "apple", phase: "initiate" });
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
