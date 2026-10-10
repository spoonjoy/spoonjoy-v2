/**
 * GitHub OAuth utilities.
 *
 * GitHub is required for v1 account continuity: a small set of migrated users
 * only have GitHub OAuth records and no password/passkey/Apple login path.
 */

import {
  ArcticFetchError,
  GitHub,
  UnexpectedErrorResponseBodyError,
  UnexpectedResponseError,
} from "arctic";
import type { GitHubOAuthConfig } from "./env.server";
import type { AuthVerifyCapture } from "./auth-telemetry.server";
import {
  OAuthProviderCallError,
  fetchOAuthProviderJson,
  isRetryableProviderStatus,
  withOAuthProviderTimeout,
  type OAuthProviderFailureKind,
} from "./oauth-provider-call.server";

/**
 * Optional capture callback threaded in by the callback-route orchestration.
 * Lets a provider outage (token exchange, /user or /user/emails non-2xx,
 * network) be captured with its truthful failure class and upstream status,
 * without coupling this helper to the PostHog config.
 */
export type AuthVerifyCaptureFn = (input: AuthVerifyCapture) => void;

export interface GitHubCallbackData {
  code: string;
  state: string;
}

export interface GitHubUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface GitHubCallbackResult {
  success: boolean;
  githubUser?: GitHubUser;
  error?: string;
  message?: string;
  failureKind?: OAuthProviderFailureKind;
  retryable?: boolean;
}

interface GitHubUserResponse {
  id: number;
  login: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

interface GitHubEmailResponse {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
}

export function createGitHubAuthorizationURL(
  config: GitHubOAuthConfig,
  redirectUri: string,
  state: string
): URL {
  const github = new GitHub(config.clientId, config.clientSecret, redirectUri);
  return github.createAuthorizationURL(state, ["read:user", "user:email"]);
}

function isOAuthRequestError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === "OAuth2RequestError" ||
    error.message.startsWith("OAuth request error:")
  );
}

function isUnexpectedOAuthResponseError(error: unknown): boolean {
  return (
    error instanceof UnexpectedResponseError ||
    error instanceof UnexpectedErrorResponseBodyError ||
    (error instanceof Error &&
      (error.name === "UnexpectedResponseError" ||
        error.name === "UnexpectedErrorResponseBodyError"))
  );
}

function isNetworkError(error: unknown): boolean {
  return (
    error instanceof ArcticFetchError ||
    (error instanceof Error &&
      (error.message.includes("fetch") ||
        error.message.includes("network") ||
        error.name === "TypeError"))
  );
}

function errorStatus(error: unknown): number | undefined {
  if (!(error instanceof Error) || !("status" in error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}

function providerCallFailureResult(
  error: unknown,
  capture?: AuthVerifyCaptureFn,
): GitHubCallbackResult | null {
  if (!(error instanceof OAuthProviderCallError)) return null;

  capture?.({
    error: error.originalError ?? error,
    phase: error.phase,
    httpStatus: error.httpStatus,
    failureKind: error.failureKind,
    retryable: error.retryable,
  });
  return {
    success: false,
    error: error.code,
    message: error.message,
    failureKind: error.failureKind,
    retryable: error.retryable,
  };
}

async function fetchGitHubJson<T>(
  url: string,
  accessToken: string,
): Promise<T> {
  return fetchOAuthProviderJson<T>(
    url,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "Spoonjoy",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
    "userinfo",
    `GitHub ${url}`,
  );
}

function primaryVerifiedEmail(emails: GitHubEmailResponse[]): string | null {
  const primary = emails.find((email) => email.primary && email.verified);
  if (primary) return primary.email;

  return emails.find((email) => email.verified)?.email ?? null;
}

export async function verifyGitHubCallback(
  config: GitHubOAuthConfig,
  redirectUri: string,
  callbackData: GitHubCallbackData,
  capture?: AuthVerifyCaptureFn
): Promise<GitHubCallbackResult> {
  if (!callbackData.state) {
    return {
      success: false,
      error: "invalid_state",
      message: "Missing state parameter",
      failureKind: "client",
      retryable: false,
    };
  }

  if (!callbackData.code) {
    return {
      success: false,
      error: "invalid_code",
      message: "Missing authorization code",
      failureKind: "client",
      retryable: false,
    };
  }

  try {
    const github = new GitHub(config.clientId, config.clientSecret, redirectUri);
    const tokens = await withOAuthProviderTimeout(
      github.validateAuthorizationCode(callbackData.code),
      "token_exchange",
    );
    const accessToken = tokens.accessToken();

    const profile = await fetchGitHubJson<GitHubUserResponse>(
      "https://api.github.com/user",
      accessToken,
    );

    // The public profile email is whatever the person typed into their profile, and GitHub does
    // not say whether it is verified. Only an address GitHub lists as verified on /user/emails
    // counts, because a verified email lets Spoonjoy create a verified account or link to one.
    const emails = await fetchGitHubJson<GitHubEmailResponse[]>(
      "https://api.github.com/user/emails",
      accessToken,
    );
    // The public address is kept when GitHub lists it as verified, so a returning person keeps the
    // address they chose to show; otherwise the primary verified one.
    const verifiedEmail =
      emails.find((entry) => entry.verified && entry.email === profile.email)?.email ?? primaryVerifiedEmail(emails);
    const email = verifiedEmail ?? profile.email ?? null;

    return {
      success: true,
      githubUser: {
        id: String(profile.id),
        email,
        emailVerified: verifiedEmail !== null,
        login: profile.login,
        name: profile.name ?? null,
        avatarUrl: profile.avatar_url ?? null,
      },
    };
  } catch (error) {
    const providerFailure = providerCallFailureResult(error, capture);
    if (providerFailure) return providerFailure;

    if (isOAuthRequestError(error)) {
      capture?.({
        error,
        phase: "token_exchange",
        failureKind: "client",
        retryable: false,
      });
      return {
        success: false,
        error: "oauth_error",
        message:
          error instanceof Error && error.message
            ? error.message
            : "OAuth error occurred",
        failureKind: "client",
        retryable: false,
      };
    }

    if (isUnexpectedOAuthResponseError(error)) {
      const status = errorStatus(error);
      const upstream = new OAuthProviderCallError(
        "upstream_error",
        "upstream",
        status === undefined || isRetryableProviderStatus(status),
        "token_exchange",
        status === undefined
          ? "GitHub token exchange returned an invalid response"
          : `GitHub token exchange responded ${status}`,
        status,
        error,
      );
      return providerCallFailureResult(upstream, capture)!;
    }

    if (isNetworkError(error)) {
      capture?.({
        error,
        phase: "token_exchange",
        failureKind: "network",
        retryable: true,
      });
      return {
        success: false,
        error: "network_error",
        message: "Network error occurred while validating GitHub OAuth",
        failureKind: "network",
        retryable: true,
      };
    }

    // Unexpected errors are rethrown for the callback-route orchestration to
    // capture + flatten to a generic OAuth error.
    throw error;
  }
}
