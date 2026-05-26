import type { AppLoadContext } from "react-router";
import { createUserSession, getUserId } from "~/lib/session.server";
import { getAppleOAuthConfig, getGitHubOAuthConfig, getGoogleOAuthConfig } from "~/lib/env.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { handleAppleOAuthCallback } from "~/lib/apple-oauth-callback.server";
import { verifyAppleCallback } from "~/lib/apple-oauth.server";
import { handleGitHubOAuthCallback } from "~/lib/github-oauth-callback.server";
import { verifyGitHubCallback } from "~/lib/github-oauth.server";
import { handleGoogleOAuthCallback } from "~/lib/google-oauth-callback.server";
import { verifyGoogleCallback } from "~/lib/google-oauth.server";
import {
  buildOAuthCallbackUrl,
  destroyOAuthStartSession,
  getOAuthEnv,
  isValidOAuthState,
  readOAuthStartSession,
  redirectWithOAuthError,
} from "~/lib/oauth-route.server";

export async function handleAppleCallback(request: Request, context: AppLoadContext) {
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

  const redirectUri = stored.redirectUri ?? buildOAuthCallbackUrl(request, "apple");
  const verifyResult = await verifyAppleCallback(config, redirectUri, {
    code: formData.get("code")?.toString() ?? "",
    state: callbackState,
    user: formData.get("user")?.toString(),
  });

  if (!verifyResult.success || !verifyResult.appleUser) {
    return redirectWithOAuthError(request, "apple", failureRedirect, verifyResult.error);
  }

  const currentUserId = stored.linking
    ? (await getUserId(request)) ?? stored.linkingUserId ?? null
    : null;
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

  const response = await createUserSession(callbackResult.userId, callbackResult.redirectTo);
  response.headers.append("Set-Cookie", await destroyOAuthStartSession(request));
  return response;
}

export async function handleGitHubCallback(request: Request, context: AppLoadContext) {
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

  const redirectUri = stored.redirectUri ?? buildOAuthCallbackUrl(request, "github");
  const verifyResult = await verifyGitHubCallback(config, redirectUri, {
    code: url.searchParams.get("code") ?? "",
    state: callbackState,
  });

  if (!verifyResult.success || !verifyResult.githubUser) {
    return redirectWithOAuthError(request, "github", failureRedirect, verifyResult.error);
  }

  const currentUserId = stored.linking
    ? (await getUserId(request)) ?? stored.linkingUserId ?? null
    : null;
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

  const response = await createUserSession(callbackResult.userId, callbackResult.redirectTo);
  response.headers.append("Set-Cookie", await destroyOAuthStartSession(request));
  return response;
}

export async function handleGoogleCallback(request: Request, context: AppLoadContext) {
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

  const redirectUri = stored.redirectUri ?? buildOAuthCallbackUrl(request, "google");
  const verifyResult = await verifyGoogleCallback(config, redirectUri, {
    code: url.searchParams.get("code") ?? "",
    state: callbackState,
    codeVerifier: stored.codeVerifier,
  });

  if (!verifyResult.success || !verifyResult.googleUser) {
    return redirectWithOAuthError(request, "google", failureRedirect, verifyResult.error);
  }

  const currentUserId = stored.linking
    ? (await getUserId(request)) ?? stored.linkingUserId ?? null
    : null;
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

  const response = await createUserSession(callbackResult.userId, callbackResult.redirectTo);
  response.headers.append("Set-Cookie", await destroyOAuthStartSession(request));
  return response;
}
