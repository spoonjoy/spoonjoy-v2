import type { Route } from "./+types/auth.apple.callback";
import { createUserSession, getUserId } from "~/lib/session.server";
import { getAppleOAuthConfig } from "~/lib/env.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { handleAppleOAuthCallback } from "~/lib/apple-oauth-callback.server";
import { verifyAppleCallback } from "~/lib/apple-oauth.server";
import {
  buildOAuthCallbackUrl,
  getOAuthEnv,
  isValidOAuthState,
  readOAuthStartSession,
  redirectWithOAuthError,
} from "~/lib/oauth-route.server";

async function handleAppleCallback(request: Request, context: Route.ActionArgs["context"]) {
  const formData = await request.formData();
  const stored = await readOAuthStartSession(request, "apple");
  const failureRedirect = stored?.failureRedirect ?? "/login";
  const providerError = formData.get("error")?.toString();

  if (providerError) {
    return redirectWithOAuthError(request, "apple", failureRedirect, providerError);
  }

  const callbackState = formData.get("state")?.toString();
  if (!stored) {
    return redirectWithOAuthError(request, "apple", failureRedirect, "invalid_state");
  }

  if (!callbackState || !isValidOAuthState(stored.state, callbackState)) {
    return redirectWithOAuthError(request, "apple", failureRedirect, "invalid_state");
  }

  let config;
  try {
    config = getAppleOAuthConfig(getOAuthEnv(context));
  } catch {
    return redirectWithOAuthError(request, "apple", failureRedirect, "oauth_unconfigured");
  }

  const redirectUri = buildOAuthCallbackUrl(request, "apple");
  const verifyResult = await verifyAppleCallback(config, redirectUri, {
    code: formData.get("code")?.toString() ?? "",
    state: callbackState,
    user: formData.get("user")?.toString(),
  });

  if (!verifyResult.success || !verifyResult.appleUser) {
    return redirectWithOAuthError(request, "apple", failureRedirect, verifyResult.error);
  }

  const currentUserId = stored.linking ? await getUserId(request) : null;
  if (stored.linking && !currentUserId) {
    return redirectWithOAuthError(request, "apple", failureRedirect, "login_required");
  }

  const database = await getRequestDb(context);
  const callbackResult = await handleAppleOAuthCallback({
    db: database,
    appleUser: verifyResult.appleUser,
    currentUserId,
    redirectTo: stored.redirectTo,
  });

  if (!callbackResult.success || !callbackResult.userId) {
    return redirectWithOAuthError(request, "apple", failureRedirect, callbackResult.error);
  }

  return createUserSession(callbackResult.userId, callbackResult.redirectTo);
}

export async function action({ request, context }: Route.ActionArgs) {
  return handleAppleCallback(request, context);
}

export async function loader({ request }: Route.LoaderArgs) {
  const stored = await readOAuthStartSession(request, "apple");
  return redirectWithOAuthError(request, "apple", stored?.failureRedirect ?? "/login", "invalid_request");
}

export default function AppleOAuthCallbackRoute() {
  return null;
}
