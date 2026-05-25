import type { Route } from "./+types/auth.github.callback";
import { createUserSession, getUserId } from "~/lib/session.server";
import { getGitHubOAuthConfig } from "~/lib/env.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { handleGitHubOAuthCallback } from "~/lib/github-oauth-callback.server";
import { verifyGitHubCallback } from "~/lib/github-oauth.server";
import {
  buildOAuthCallbackUrl,
  getOAuthEnv,
  isValidOAuthState,
  readOAuthStartSession,
  redirectWithOAuthError,
} from "~/lib/oauth-route.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const stored = await readOAuthStartSession(request, "github");
  const failureRedirect = stored?.failureRedirect ?? "/login";
  const providerError = url.searchParams.get("error");
  const callbackState = url.searchParams.get("state");

  if (providerError) {
    return redirectWithOAuthError(request, "github", failureRedirect, providerError);
  }

  if (!stored) {
    return redirectWithOAuthError(request, "github", failureRedirect, "invalid_state");
  }

  if (!callbackState || !isValidOAuthState(stored.state, callbackState)) {
    return redirectWithOAuthError(request, "github", failureRedirect, "invalid_state");
  }

  let config;
  try {
    config = getGitHubOAuthConfig(getOAuthEnv(context));
  } catch {
    return redirectWithOAuthError(request, "github", failureRedirect, "oauth_unconfigured");
  }

  const redirectUri = buildOAuthCallbackUrl(request, "github");
  const verifyResult = await verifyGitHubCallback(config, redirectUri, {
    code: url.searchParams.get("code") ?? "",
    state: callbackState,
  });

  if (!verifyResult.success || !verifyResult.githubUser) {
    return redirectWithOAuthError(request, "github", failureRedirect, verifyResult.error);
  }

  const currentUserId = stored.linking ? await getUserId(request) : null;
  if (stored.linking && !currentUserId) {
    return redirectWithOAuthError(request, "github", failureRedirect, "login_required");
  }

  const database = await getRequestDb(context);
  const callbackResult = await handleGitHubOAuthCallback({
    db: database,
    githubUser: verifyResult.githubUser,
    currentUserId,
    redirectTo: stored.redirectTo,
  });

  if (!callbackResult.success || !callbackResult.userId) {
    return redirectWithOAuthError(request, "github", failureRedirect, callbackResult.error);
  }

  return createUserSession(callbackResult.userId, callbackResult.redirectTo);
}

export default function GitHubOAuthCallbackRoute() {
  return null;
}
