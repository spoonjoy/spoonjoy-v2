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
} from "~/lib/oauth-route.server";

const SOCIAL_CALLBACK_EVENT = "spoonjoy.oauth.social_callback";

interface OAuthFailureTelemetry {
  failureKind: OAuthProviderFailureKind;
  retryable: boolean;
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
  try {
    config = getAppleOAuthConfig(getOAuthEnv(context));
  } catch (error) {
    telemetry.captureException(error, { provider: "apple", phase: "config" });
    return redirectWithCapturedOAuthError(telemetry, request, "apple", failureRedirect, "oauth_unconfigured", "config", env);
  }

  const redirectUri =
    stored.redirectUri ?? buildAppleReturnUrl(request, stored.linking ? "linkAppleAccount" : "loginWithApple");
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
    ? (await getUserId(request, env)) ?? stored.linkingUserId ?? null
    : null;
  if (stored.linking && !currentUserId) {
    return redirectWithCapturedOAuthError(telemetry, request, "apple", failureRedirect, "login_required", "link_account", env);
  }

  const database = await getRequestDb(context);
  const callbackResult = await handleAppleOAuthCallback({
    db: database,
    appleUser: verifyResult.appleUser,
    currentUserId,
    redirectTo: stored.redirectTo,
  });

  if (!callbackResult.success || !callbackResult.userId) {
    return redirectWithCapturedOAuthError(telemetry, request, "apple", failureRedirect, callbackResult.error, "link_account", env);
  }

  const response = await createUserSession(callbackResult.userId, callbackResult.redirectTo, env, request);
  response.headers.append("Set-Cookie", await destroyOAuthStartSession(request, env));
  return response;
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
  try {
    config = getGitHubOAuthConfig(getOAuthEnv(context));
  } catch (error) {
    telemetry.captureException(error, { provider: "github", phase: "config" });
    return redirectWithCapturedOAuthError(telemetry, request, "github", failureRedirect, "oauth_unconfigured", "config", env);
  }

  const redirectUri = stored.redirectUri ?? buildOAuthCallbackUrl(request, "github");
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
    ? (await getUserId(request, env)) ?? stored.linkingUserId ?? null
    : null;
  if (stored.linking && !currentUserId) {
    return redirectWithCapturedOAuthError(telemetry, request, "github", failureRedirect, "login_required", "link_account", env);
  }

  const database = await getRequestDb(context);
  const callbackResult = await handleGitHubOAuthCallback({
    db: database,
    githubUser: verifyResult.githubUser,
    currentUserId,
    redirectTo: stored.redirectTo,
  });

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

  const response = await createUserSession(callbackResult.userId, callbackResult.redirectTo, env, request);
  response.headers.append("Set-Cookie", await destroyOAuthStartSession(request, env));
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
  try {
    config = getGoogleOAuthConfig(getOAuthEnv(context));
  } catch (error) {
    telemetry.captureException(error, { provider: "google", phase: "config" });
    return redirectWithCapturedOAuthError(telemetry, request, "google", failureRedirect, "oauth_unconfigured", "config", env);
  }

  const redirectUri = stored.redirectUri ?? buildOAuthCallbackUrl(request, "google");
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
    ? (await getUserId(request, env)) ?? stored.linkingUserId ?? null
    : null;
  if (stored.linking && !currentUserId) {
    return redirectWithCapturedOAuthError(telemetry, request, "google", failureRedirect, "login_required", "link_account", env);
  }

  const database = await getRequestDb(context);
  const callbackResult = await handleGoogleOAuthCallback({
    db: database,
    googleUser: verifyResult.googleUser,
    currentUserId,
    redirectTo: stored.redirectTo,
  });

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

  const response = await createUserSession(callbackResult.userId, callbackResult.redirectTo, env, request);
  response.headers.append("Set-Cookie", await destroyOAuthStartSession(request, env));
  return response;
}
