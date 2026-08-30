import type { Route } from "./+types/auth.github";
import { redirect } from "react-router";
import { getGitHubOAuthConfig } from "~/lib/env.server";
import { createGitHubAuthorizationURL } from "~/lib/github-oauth.server";
import { authTelemetryFromContext } from "~/lib/auth-telemetry.server";
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

async function initiateGitHubOAuth({ request, context }: Route.LoaderArgs | Route.ActionArgs) {
  const state = generateOAuthState();
  const sessionData = resolveOAuthStartSessionData(request, state);
  const env = context.cloudflare?.env;
  const linkingRedirect = await assertCanStartOAuthLinking(request, sessionData, env);
  if (linkingRedirect) return linkingRedirect;

  let config;
  try {
    config = getGitHubOAuthConfig(getOAuthEnv(context));
  } catch (error) {
    authTelemetryFromContext(context).captureException(error, { provider: "github", phase: "initiate" });
    return redirect(appendOAuthError(sessionData.failureRedirect, "oauth_unconfigured"));
  }

  let authorizationUrl;
  try {
    const redirectUri = buildOAuthCallbackUrl(request, "github", env?.SPOONJOY_BASE_URL);
    sessionData.redirectUri = redirectUri;
    authorizationUrl = createGitHubAuthorizationURL(config, redirectUri, state);
  } catch (error) {
    authTelemetryFromContext(context).captureException(error, { provider: "github", phase: "initiate" });
    return redirect(appendOAuthError(sessionData.failureRedirect, "oauth_unconfigured"));
  }
  const cookie = await commitOAuthStartSession(request, "github", sessionData, env);

  return redirectTo(authorizationUrl.toString(), { "Set-Cookie": cookie });
}

export async function loader(args: Route.LoaderArgs) {
  return initiateGitHubOAuth(args);
}

export async function action(args: Route.ActionArgs) {
  return initiateGitHubOAuth(args);
}

export default function GitHubOAuthRoute() {
  return null;
}
