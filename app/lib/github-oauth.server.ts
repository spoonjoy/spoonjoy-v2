/**
 * GitHub OAuth utilities.
 *
 * GitHub is required for v1 account continuity: a small set of migrated users
 * only have GitHub OAuth records and no password/passkey/Apple login path.
 */

import { GitHub } from "arctic";
import type { GitHubOAuthConfig } from "./env.server";
import type { AuthVerifyCapture } from "./auth-telemetry.server";

/**
 * Optional capture callback threaded in by the callback-route orchestration.
 * Lets a provider outage (token exchange, /user or /user/emails non-2xx,
 * network) be captured with the upstream status before it is flattened to a
 * generic `userinfo_error`/`email_required`, without coupling this helper to
 * the PostHog config.
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
  return error instanceof Error && (
    error.name === "UnexpectedResponseError" ||
    error.name === "UnexpectedErrorResponseBodyError"
  );
}

function isNetworkError(error: unknown): boolean {
  return error instanceof Error && (
    error.message.includes("fetch") ||
    error.message.includes("network") ||
    error.name === "TypeError"
  );
}

async function fetchGitHubJson<T>(
  url: string,
  accessToken: string,
  phase: AuthVerifyCapture["phase"],
  capture?: AuthVerifyCaptureFn,
): Promise<T | null> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "Spoonjoy",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    // The non-2xx status + body are otherwise discarded (we just return null).
    // Capture the upstream status so a GitHub outage is distinguishable from a
    // user who simply has no verified email.
    capture?.({
      error: new Error(`GitHub ${url} responded ${response.status}`),
      phase,
      httpStatus: response.status,
    });
    return null;
  }

  return (await response.json()) as T;
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
    };
  }

  if (!callbackData.code) {
    return {
      success: false,
      error: "invalid_code",
      message: "Missing authorization code",
    };
  }

  try {
    const github = new GitHub(config.clientId, config.clientSecret, redirectUri);
    const tokens = await github.validateAuthorizationCode(callbackData.code);
    const accessToken = tokens.accessToken();

    const profile = await fetchGitHubJson<GitHubUserResponse>(
      "https://api.github.com/user",
      accessToken,
      "userinfo",
      capture,
    );
    if (!profile) {
      return {
        success: false,
        error: "userinfo_error",
        message: "Failed to fetch user info from GitHub",
      };
    }

    let email = profile.email ?? null;
    if (!email) {
      const emails = await fetchGitHubJson<GitHubEmailResponse[]>(
        "https://api.github.com/user/emails",
        accessToken,
        "userinfo",
        capture,
      );
      if (!emails) {
        // Note: `email_required` is misleading — it is returned when the emails
        // API CALL itself failed (captured above with the upstream status), not
        // because the user genuinely lacks a verified email.
        return {
          success: false,
          error: "email_required",
          message: "Unable to read a verified email address from GitHub",
        };
      }
      email = primaryVerifiedEmail(emails);
    }

    return {
      success: true,
      githubUser: {
        id: String(profile.id),
        email,
        emailVerified: Boolean(email),
        login: profile.login,
        name: profile.name ?? null,
        avatarUrl: profile.avatar_url ?? null,
      },
    };
  } catch (error) {
    if (isOAuthRequestError(error) || isUnexpectedOAuthResponseError(error)) {
      capture?.({ error, phase: "token_exchange" });
      return {
        success: false,
        error: "oauth_error",
        message: error instanceof Error && error.message ? error.message : "OAuth error occurred",
      };
    }

    if (isNetworkError(error)) {
      capture?.({ error, phase: "token_exchange" });
      return {
        success: false,
        error: "network_error",
        message: "Network error occurred while validating GitHub OAuth",
      };
    }

    // Unexpected errors are rethrown for the callback-route orchestration to
    // capture + flatten to a generic OAuth error.
    throw error;
  }
}
