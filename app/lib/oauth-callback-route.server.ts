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
  const env = context.cloudflare?.env;
  const formData = await request.formData();
  const stored = await readOAuthStartSession(request, "apple", env);
  const failureRedirect = stored?.failureRedirect ?? "/login";
  const providerError = formData.get("error")?.toString();

  if (providerError) {
    return redirectWithOAuthError(request, "apple", failureRedirect, providerError, env);
  }

  const callbackState = formData.get("state")?.toString();
  if (!stored) {
    return redirectWithOAuthError(request, "apple", failureRedirect, "invalid_state", env);
  }

  if (!callbackState || !isValidOAuthState(stored.state, callbackState)) {
    return redirectWithOAuthError(request, "apple", failureRedirect, "invalid_state", env);
  }

  let config;
  try {
    config = getAppleOAuthConfig(getOAuthEnv(context));
  } catch {
    return redirectWithOAuthError(request, "apple", failureRedirect, "oauth_unconfigured", env);
  }

  const redirectUri = stored.redirectUri ?? buildOAuthCallbackUrl(request, "apple");
  const verifyResult = await verifyAppleCallback(config, redirectUri, {
    code: formData.get("code")?.toString() ?? "",
    state: callbackState,
    user: formData.get("user")?.toString(),
  });

  if (!verifyResult.success || !verifyResult.appleUser) {
    return redirectWithOAuthError(request, "apple", failureRedirect, verifyResult.error, env);
  }

  const currentUserId = stored.linking
    ? (await getUserId(request, env)) ?? stored.linkingUserId ?? null
    : null;
  if (stored.linking && !currentUserId) {
    return redirectWithOAuthError(request, "apple", failureRedirect, "login_required", env);
  }

  const database = await getRequestDb(context);
  const callbackResult = await handleAppleOAuthCallback({
    db: database,
    appleUser: verifyResult.appleUser,
    currentUserId,
    redirectTo: stored.redirectTo,
  });

  if (!callbackResult.success || !callbackResult.userId) {
    return redirectWithOAuthError(request, "apple", failureRedirect, callbackResult.error, env);
  }

  const response = await createUserSession(callbackResult.userId, callbackResult.redirectTo, env);
  response.headers.append("Set-Cookie", await destroyOAuthStartSession(request, env));
  return response;
}

export async function handleGitHubCallback(request: Request, context: AppLoadContext) {
  const env = context.cloudflare?.env;
  const url = new URL(request.url);
  const stored = await readOAuthStartSession(request, "github", env);
  const failureRedirect = stored?.failureRedirect ?? "/login";
  const providerError = url.searchParams.get("error");
  const callbackState = url.searchParams.get("state");

  if (providerError) {
    return redirectWithOAuthError(request, "github", failureRedirect, providerError, env);
  }

  if (!stored) {
    return redirectWithOAuthError(request, "github", failureRedirect, "invalid_state", env);
  }

  if (!callbackState || !isValidOAuthState(stored.state, callbackState)) {
    return redirectWithOAuthError(request, "github", failureRedirect, "invalid_state", env);
  }

  let config;
  try {
    config = getGitHubOAuthConfig(getOAuthEnv(context));
  } catch {
    return redirectWithOAuthError(request, "github", failureRedirect, "oauth_unconfigured", env);
  }

  const redirectUri = stored.redirectUri ?? buildOAuthCallbackUrl(request, "github");
  const verifyResult = await verifyGitHubCallback(config, redirectUri, {
    code: url.searchParams.get("code") ?? "",
    state: callbackState,
  });

  if (!verifyResult.success || !verifyResult.githubUser) {
    return redirectWithOAuthError(request, "github", failureRedirect, verifyResult.error, env);
  }

  const currentUserId = stored.linking
    ? (await getUserId(request, env)) ?? stored.linkingUserId ?? null
    : null;
  if (stored.linking && !currentUserId) {
    return redirectWithOAuthError(request, "github", failureRedirect, "login_required", env);
  }

  const database = await getRequestDb(context);
  const callbackResult = await handleGitHubOAuthCallback({
    db: database,
    githubUser: verifyResult.githubUser,
    currentUserId,
    redirectTo: stored.redirectTo,
  });

  if (!callbackResult.success || !callbackResult.userId) {
    return redirectWithOAuthError(request, "github", failureRedirect, callbackResult.error, env);
  }

  const response = await createUserSession(callbackResult.userId, callbackResult.redirectTo, env);
  response.headers.append("Set-Cookie", await destroyOAuthStartSession(request, env));
  return response;
}

export async function handleGoogleCallback(request: Request, context: AppLoadContext) {
  const env = context.cloudflare?.env;
  const url = new URL(request.url);
  const stored = await readOAuthStartSession(request, "google", env);
  const failureRedirect = stored?.failureRedirect ?? "/login";
  const providerError = url.searchParams.get("error");
  const callbackState = url.searchParams.get("state");

  if (providerError) {
    return redirectWithOAuthError(request, "google", failureRedirect, providerError, env);
  }

  if (!stored) {
    return redirectWithOAuthError(request, "google", failureRedirect, "invalid_state", env);
  }

  if (!callbackState || !isValidOAuthState(stored.state, callbackState)) {
    return redirectWithOAuthError(request, "google", failureRedirect, "invalid_state", env);
  }

  if (!stored.codeVerifier) {
    return redirectWithOAuthError(request, "google", failureRedirect, "invalid_code_verifier", env);
  }

  let config;
  try {
    config = getGoogleOAuthConfig(getOAuthEnv(context));
  } catch {
    return redirectWithOAuthError(request, "google", failureRedirect, "oauth_unconfigured", env);
  }

  const redirectUri = stored.redirectUri ?? buildOAuthCallbackUrl(request, "google");
  const verifyResult = await verifyGoogleCallback(config, redirectUri, {
    code: url.searchParams.get("code") ?? "",
    state: callbackState,
    codeVerifier: stored.codeVerifier,
  });

  if (!verifyResult.success || !verifyResult.googleUser) {
    return redirectWithOAuthError(request, "google", failureRedirect, verifyResult.error, env);
  }

  const currentUserId = stored.linking
    ? (await getUserId(request, env)) ?? stored.linkingUserId ?? null
    : null;
  if (stored.linking && !currentUserId) {
    return redirectWithOAuthError(request, "google", failureRedirect, "login_required", env);
  }

  const database = await getRequestDb(context);
  const callbackResult = await handleGoogleOAuthCallback({
    db: database,
    googleUser: verifyResult.googleUser,
    currentUserId,
    redirectTo: stored.redirectTo,
  });

  if (!callbackResult.success || !callbackResult.userId) {
    return redirectWithOAuthError(request, "google", failureRedirect, callbackResult.error, env);
  }

  const response = await createUserSession(callbackResult.userId, callbackResult.redirectTo, env);
  response.headers.append("Set-Cookie", await destroyOAuthStartSession(request, env));
  return response;
}
