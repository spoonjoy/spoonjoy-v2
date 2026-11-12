import type { AppLoadContext } from "react-router";
import { createUserSession, getSessionSignIn, getUserId, isSessionIdentityCurrent, type SessionEnv, type SignInMethod } from "~/lib/session.server";
import { getAppleOAuthConfig, getGitHubOAuthConfig, getGoogleOAuthConfig } from "~/lib/env.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { requestD1 } from "~/lib/d1-read.server";
import { D1_WRITE_UNAVAILABLE_CODE, isD1Unavailable } from "~/lib/d1-write-retry.server";
import { handleAppleOAuthCallback } from "~/lib/apple-oauth-callback.server";
import {
  APPLE_EMAIL_UNAVAILABLE,
  claimPendingAppleLinkFromCookie,
  createPendingAppleLink,
  rememberPendingAppleLink,
} from "~/lib/pending-apple-link.server";
import { verifyAppleCallback } from "~/lib/apple-oauth.server";
import { handleGitHubOAuthCallback } from "~/lib/github-oauth-callback.server";
import { verifyGitHubCallback } from "~/lib/github-oauth.server";
import { handleGoogleOAuthCallback } from "~/lib/google-oauth-callback.server";
import { verifyGoogleCallback } from "~/lib/google-oauth.server";
import type { OAuthProviderFailureKind } from "~/lib/oauth-provider-call.server";
import {
  type AuthFailurePhase,
  type AuthProvider,
  type AuthTelemetry,
  type AuthVerifyCapture,
  authTelemetryFromContext,
} from "~/lib/auth-telemetry.server";
import {
  buildAppleReturnUrl,
  buildOAuthCallbackUrl,
  destroyOAuthStartSession,
  getOAuthEnv,
  isValidOAuthState,
  readOAuthStartSession,
  redirectWithOAuthError,
  type OAuthStartSessionData,
} from "~/lib/oauth-route.server";

const SOCIAL_CALLBACK_EVENT = "spoonjoy.oauth.social_callback";

// The signed-in user a linking callback links to. Apple posts its callback
// cross-site, so the Lax session cookie can be missing; then fall back to the
// user who started linking, but only while that session is still current (not
// revoked by a password change or "Sign out everywhere" since, user not deleted).
async function currentLinkingUserId(
  request: Request,
  stored: OAuthStartSessionData,
  env?: SessionEnv | null,
): Promise<string | null> {
  const sessionUserId = await getUserId(request, env);
  if (sessionUserId) return sessionUserId;
  if (!stored.linkingUserId) return null;

  // A linking start recorded before session versions existed counts as version 0.
  const identity = { userId: stored.linkingUserId, sessionVersion: stored.linkingSessionVersion ?? 0 };
  return (await isSessionIdentityCurrent(identity, env)) ? identity.userId : null;
}

interface OAuthFailureTelemetry {
  failureKind: OAuthProviderFailureKind | "database";
  retryable: boolean;
}

/** A callback that could not save its sign-in because the database was briefly unavailable. */
interface D1UnavailableCallback {
  success: false;
  userId?: undefined;
  action?: undefined;
  error: typeof D1_WRITE_UNAVAILABLE_CODE;
  redirectTo: string;
}

/**
 * Runs a provider callback's account writes. Each runs again after a transient D1 error; if the
 * database stays unavailable, the sign-in fails with a retryable error the sign-in page explains,
 * instead of a 500. The provider's code is spent, so the chef starts the sign-in again.
 */
async function withD1Unavailable<T extends { success: boolean }>(run: () => Promise<T>): Promise<T | D1UnavailableCallback> {
  try {
    return await run();
  } catch (error) {
    if (!isD1Unavailable(error)) throw error;
    return { success: false, error: D1_WRITE_UNAVAILABLE_CODE, redirectTo: "" };
  }
}

function oauthFailureTelemetry(
  errorCode: string | undefined,
  supplied?: Partial<OAuthFailureTelemetry>,
): OAuthFailureTelemetry | undefined {
  if (supplied?.failureKind && supplied.retryable !== undefined) {
    return {
      failureKind: supplied.failureKind,
      retryable: supplied.retryable,
    };
  }

  if (errorCode === "provider_timeout") {
    return { failureKind: "timeout", retryable: true };
  }
  if (errorCode === "network_error") {
    return { failureKind: "network", retryable: true };
  }
  if (errorCode === "upstream_error") {
    return { failureKind: "upstream", retryable: true };
  }
  if (errorCode === "email_required") {
    return { failureKind: "missing_email", retryable: false };
  }
  if (errorCode === D1_WRITE_UNAVAILABLE_CODE) {
    return { failureKind: "database", retryable: true };
  }
  return undefined;
}

/**
 * Emit a `spoonjoy.oauth.social_callback` error event for an OAuth callback
 * exit, then return the user-facing error redirect. Every dark
 * `redirectWithOAuthError` exit (provider error, CSRF/invalid_state, missing
 * config, verify failure, link/session failure) routes through here so the
 * outcome is observable. `error_code` is the machine code already surfaced to
 * the client; `phase` distinguishes a provider/infra failure from user error.
 */
function redirectWithCapturedOAuthError(
  telemetry: AuthTelemetry,
  request: Request,
  provider: AuthProvider,
  failureRedirect: string,
  errorCode: string | undefined,
  phase: AuthFailurePhase,
  env?: Parameters<typeof redirectWithOAuthError>[4],
  failure?: OAuthFailureTelemetry,
) {
  telemetry.captureEvent(SOCIAL_CALLBACK_EVENT, "server", {
    provider,
    outcome: "error",
    error_code: errorCode ?? "oauth_error",
    phase,
    ...(failure
      ? { failure_kind: failure.failureKind, retryable: failure.retryable }
      : {}),
  });
  return redirectWithOAuthError(request, provider, failureRedirect, errorCode, env);
}

/**
 * Adapt the telemetry sink into the provider-agnostic `capture` callback the
 * verify helpers accept, tagging every capture with the provider so a single
 * outage is attributable.
 */
function verifyCaptureFor(
  telemetry: AuthTelemetry,
  provider: AuthProvider,
): (input: AuthVerifyCapture) => void {
  return ({ error, phase, httpStatus, failureKind, retryable }) => {
    telemetry.captureException(error, {
      provider,
      phase,
      httpStatus,
      ...(failureKind ? { failure_kind: failureKind } : {}),
      ...(retryable !== undefined ? { retryable } : {}),
    });
  };
}

async function readFormPostParams(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return new URLSearchParams(await request.text());
  }

  if (contentType.includes("multipart/form-data")) {
    const fallbackRequest = request.clone();

    try {
      const formData = await request.formData();
      const params = new URLSearchParams();

      for (const [key, value] of formData) {
        if (typeof value === "string") {
          params.append(key, value);
        }
      }

      return params;
    } catch {
      return new URLSearchParams(await fallbackRequest.text());
    }
  }

  return new URLSearchParams(await request.text());
}

/**
 * Linking another sign-in method to the signed-in account is not a new sign-in: the re-issued
 * cookie keeps the existing sign-in time, so linking a provider account cannot stand in for the
 * recent sign-in that account deletion asks for (account-reauthentication.server.ts). A signed-out
 * visitor whose provider account is linked by its verified email did sign in, so that cookie gets
 * a new sign-in time.
 */
async function sessionOptionsFor(
  provider: SignInMethod,
  callbackResult: { action?: string; userId?: string },
  request: Request,
  env: SessionEnv | null | undefined,
) {
  if (callbackResult.action !== "account_linked") return { signInMethod: provider };
  if ((await getUserId(request, env)) !== callbackResult.userId) return { signInMethod: provider };
  // Linking another method to the signed-in account is not a new sign-in: keep the existing one.
  return getSessionSignIn(request, env);
}

export async function handleAppleCallback(request: Request, context: AppLoadContext) {
  const env = context.cloudflare?.env;
  const telemetry = authTelemetryFromContext(context);
  const formData = await readFormPostParams(request);
  const stored = await readOAuthStartSession(request, "apple", env);
  const failureRedirect = stored?.failureRedirect ?? "/login";
  const providerError = formData.get("error") ?? undefined;

  if (providerError) {
    return redirectWithCapturedOAuthError(telemetry, request, "apple", failureRedirect, providerError, "provider_error", env);
  }

  const callbackState = formData.get("state");
  if (!stored) {
    return redirectWithCapturedOAuthError(telemetry, request, "apple", failureRedirect, "invalid_state", "invalid_state", env);
  }

  if (!callbackState || !isValidOAuthState(stored.state, callbackState)) {
    return redirectWithCapturedOAuthError(telemetry, request, "apple", failureRedirect, "invalid_state", "invalid_state", env);
  }

  let config;
  let redirectUri: string;
  try {
    config = getAppleOAuthConfig(getOAuthEnv(context));
    redirectUri = stored.redirectUri ?? buildAppleReturnUrl(
      request,
      stored.linking ? "linkAppleAccount" : "loginWithApple",
      "legacy",
      env?.SPOONJOY_BASE_URL,
    );
  } catch (error) {
    telemetry.captureException(error, { provider: "apple", phase: "config" });
    return redirectWithCapturedOAuthError(telemetry, request, "apple", failureRedirect, "oauth_unconfigured", "config", env);
  }

  let verifyResult;
  try {
    verifyResult = await verifyAppleCallback(
      config,
      redirectUri,
      {
        code: formData.get("code") ?? "",
        state: callbackState,
        user: formData.get("user") ?? undefined,
      },
      verifyCaptureFor(telemetry, "apple"),
    );
  } catch (error) {
    // verifyAppleCallback flattens its own failures, so this only fires for a
    // truly unexpected throw — capture it before flattening to a generic error.
    telemetry.captureException(error, { provider: "apple", phase: "verify" });
    return redirectWithCapturedOAuthError(telemetry, request, "apple", failureRedirect, "oauth_error", "verify", env);
  }

  if (!verifyResult.success || !verifyResult.appleUser) {
    return redirectWithCapturedOAuthError(telemetry, request, "apple", failureRedirect, verifyResult.error, "verify", env);
  }

  const currentUserId = stored.linking
    ? await currentLinkingUserId(request, stored, env)
    : null;
  if (stored.linking && !currentUserId) {
    return redirectWithCapturedOAuthError(telemetry, request, "apple", failureRedirect, "login_required", "link_account", env);
  }

  const database = await getRequestDb(context);
  const appleUser = verifyResult.appleUser;
  const callbackResult = await withD1Unavailable(() => handleAppleOAuthCallback({
    db: database,
    d1: requestD1(context),
    appleUser,
    currentUserId,
    redirectTo: stored.redirectTo,
  }));

  if (callbackResult.error === APPLE_EMAIL_UNAVAILABLE) {
    // A verified Apple ID with no email and no linked account: this browser keeps it as a pending
    // link, and its next sign-in by another method links Apple to that account.
    // If the link can't be saved, the chef still gets the same explanation, just without the link.
    const pendingLink = await createPendingAppleLink(database, { appleSub: appleUser.id, providerUsername: appleUser.fullName })
      .catch((error: unknown) => {
        telemetry.captureException(error, { provider: "apple", phase: "link_account", step: "pending_apple_link" });
        return null;
      });
    const response = await redirectWithCapturedOAuthError(telemetry, request, "apple", failureRedirect, callbackResult.error, "link_account", env);
    if (pendingLink) response.headers.append("Set-Cookie", await rememberPendingAppleLink(env, request, pendingLink));
    return response;
  }

  if (!callbackResult.success || !callbackResult.userId) {
    return redirectWithCapturedOAuthError(telemetry, request, "apple", failureRedirect, callbackResult.error, "link_account", env);
  }

  const response = await createUserSession(callbackResult.userId, callbackResult.redirectTo, env, request, await sessionOptionsFor("apple", callbackResult, request, env));
  response.headers.append("Set-Cookie", await destroyOAuthStartSession(request, env));
  return response;
}

/** After a successful Google or GitHub sign-in: connect a pending Apple link this browser holds. */
async function appendPendingAppleLinkClaim(response: Response, request: Request, context: AppLoadContext, userId: string) {
  const cleared = await claimPendingAppleLinkFromCookie(() => getRequestDb(context), request, context.cloudflare?.env, userId);
  if (cleared) response.headers.append("Set-Cookie", cleared);
}

export async function handleGitHubCallback(request: Request, context: AppLoadContext) {
  const env = context.cloudflare?.env;
  const telemetry = authTelemetryFromContext(context);
  const url = new URL(request.url);
  const stored = await readOAuthStartSession(request, "github", env);
  const failureRedirect = stored?.failureRedirect ?? "/login";
  const providerError = url.searchParams.get("error");
  const callbackState = url.searchParams.get("state");

  if (providerError) {
    return redirectWithCapturedOAuthError(telemetry, request, "github", failureRedirect, providerError, "provider_error", env);
  }

  if (!stored) {
    return redirectWithCapturedOAuthError(telemetry, request, "github", failureRedirect, "invalid_state", "invalid_state", env);
  }

  if (!callbackState || !isValidOAuthState(stored.state, callbackState)) {
    return redirectWithCapturedOAuthError(telemetry, request, "github", failureRedirect, "invalid_state", "invalid_state", env);
  }

  let config;
  let redirectUri: string;
  try {
    config = getGitHubOAuthConfig(getOAuthEnv(context));
    redirectUri = stored.redirectUri ?? buildOAuthCallbackUrl(
      request,
      "github",
      env?.SPOONJOY_BASE_URL,
    );
  } catch (error) {
    telemetry.captureException(error, { provider: "github", phase: "config" });
    return redirectWithCapturedOAuthError(telemetry, request, "github", failureRedirect, "oauth_unconfigured", "config", env);
  }

  let verifyResult;
  try {
    verifyResult = await verifyGitHubCallback(
      config,
      redirectUri,
      {
        code: url.searchParams.get("code") ?? "",
        state: callbackState,
      },
      verifyCaptureFor(telemetry, "github"),
    );
  } catch (error) {
    // verifyGitHubCallback rethrows unexpected (non-OAuth, non-network) errors —
    // capture the original before flattening it to a generic OAuth error.
    telemetry.captureException(error, { provider: "github", phase: "verify" });
    return redirectWithCapturedOAuthError(telemetry, request, "github", failureRedirect, "oauth_error", "verify", env);
  }

  if (!verifyResult.success || !verifyResult.githubUser) {
    return redirectWithCapturedOAuthError(
      telemetry,
      request,
      "github",
      failureRedirect,
      verifyResult.error,
      "verify",
      env,
      oauthFailureTelemetry(verifyResult.error, verifyResult),
    );
  }

  const currentUserId = stored.linking
    ? await currentLinkingUserId(request, stored, env)
    : null;
  if (stored.linking && !currentUserId) {
    return redirectWithCapturedOAuthError(telemetry, request, "github", failureRedirect, "login_required", "link_account", env);
  }

  const database = await getRequestDb(context);
  const githubUser = verifyResult.githubUser;
  const callbackResult = await withD1Unavailable(() => handleGitHubOAuthCallback({
    db: database,
    d1: requestD1(context),
    githubUser,
    currentUserId,
    redirectTo: stored.redirectTo,
  }));

  if (!callbackResult.success || !callbackResult.userId) {
    return redirectWithCapturedOAuthError(
      telemetry,
      request,
      "github",
      failureRedirect,
      callbackResult.error,
      "link_account",
      env,
      oauthFailureTelemetry(callbackResult.error),
    );
  }

  const response = await createUserSession(callbackResult.userId, callbackResult.redirectTo, env, request, await sessionOptionsFor("github", callbackResult, request, env));
  response.headers.append("Set-Cookie", await destroyOAuthStartSession(request, env));
  await appendPendingAppleLinkClaim(response, request, context, callbackResult.userId);
  return response;
}

export async function handleGoogleCallback(request: Request, context: AppLoadContext) {
  const env = context.cloudflare?.env;
  const telemetry = authTelemetryFromContext(context);
  const url = new URL(request.url);
  const stored = await readOAuthStartSession(request, "google", env);
  const failureRedirect = stored?.failureRedirect ?? "/login";
  const providerError = url.searchParams.get("error");
  const callbackState = url.searchParams.get("state");

  if (providerError) {
    return redirectWithCapturedOAuthError(telemetry, request, "google", failureRedirect, providerError, "provider_error", env);
  }

  if (!stored) {
    return redirectWithCapturedOAuthError(telemetry, request, "google", failureRedirect, "invalid_state", "invalid_state", env);
  }

  if (!callbackState || !isValidOAuthState(stored.state, callbackState)) {
    return redirectWithCapturedOAuthError(telemetry, request, "google", failureRedirect, "invalid_state", "invalid_state", env);
  }

  if (!stored.codeVerifier) {
    return redirectWithCapturedOAuthError(telemetry, request, "google", failureRedirect, "invalid_code_verifier", "invalid_code_verifier", env);
  }

  let config;
  let redirectUri: string;
  try {
    config = getGoogleOAuthConfig(getOAuthEnv(context));
    redirectUri = stored.redirectUri ?? buildOAuthCallbackUrl(
      request,
      "google",
      env?.SPOONJOY_BASE_URL,
    );
  } catch (error) {
    telemetry.captureException(error, { provider: "google", phase: "config" });
    return redirectWithCapturedOAuthError(telemetry, request, "google", failureRedirect, "oauth_unconfigured", "config", env);
  }

  let verifyResult;
  try {
    verifyResult = await verifyGoogleCallback(
      config,
      redirectUri,
      {
        code: url.searchParams.get("code") ?? "",
        state: callbackState,
        codeVerifier: stored.codeVerifier,
      },
      verifyCaptureFor(telemetry, "google"),
    );
  } catch (error) {
    // verifyGoogleCallback flattens its own failures, so this only fires for a
    // truly unexpected throw — capture it before flattening to a generic error.
    telemetry.captureException(error, { provider: "google", phase: "verify" });
    return redirectWithCapturedOAuthError(telemetry, request, "google", failureRedirect, "oauth_error", "verify", env);
  }

  if (!verifyResult.success || !verifyResult.googleUser) {
    return redirectWithCapturedOAuthError(
      telemetry,
      request,
      "google",
      failureRedirect,
      verifyResult.error,
      "verify",
      env,
      oauthFailureTelemetry(verifyResult.error, verifyResult),
    );
  }

  const currentUserId = stored.linking
    ? await currentLinkingUserId(request, stored, env)
    : null;
  if (stored.linking && !currentUserId) {
    return redirectWithCapturedOAuthError(telemetry, request, "google", failureRedirect, "login_required", "link_account", env);
  }

  const database = await getRequestDb(context);
  const googleUser = verifyResult.googleUser;
  const callbackResult = await withD1Unavailable(() => handleGoogleOAuthCallback({
    db: database,
    d1: requestD1(context),
    googleUser,
    currentUserId,
    redirectTo: stored.redirectTo,
  }));

  if (!callbackResult.success || !callbackResult.userId) {
    return redirectWithCapturedOAuthError(
      telemetry,
      request,
      "google",
      failureRedirect,
      callbackResult.error,
      "link_account",
      env,
      oauthFailureTelemetry(callbackResult.error),
    );
  }

  const response = await createUserSession(callbackResult.userId, callbackResult.redirectTo, env, request, await sessionOptionsFor("google", callbackResult, request, env));
  response.headers.append("Set-Cookie", await destroyOAuthStartSession(request, env));
  await appendPendingAppleLinkClaim(response, request, context, callbackResult.userId);
  return response;
}
