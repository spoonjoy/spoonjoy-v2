/**
 * GitHub OAuth utilities.
 *
 * GitHub is required for v1 account continuity: a small set of migrated users
 * only have GitHub OAuth records and no password/passkey/Apple login path.
 */

import { GitHub } from "arctic";
import type { GitHubOAuthConfig } from "./env.server";

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
  return error instanceof Error && error.name === "OAuth2RequestError";
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

async function fetchGitHubJson<T>(url: string, accessToken: string): Promise<T | null> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "Spoonjoy",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
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
  callbackData: GitHubCallbackData
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

    const profile = await fetchGitHubJson<GitHubUserResponse>("https://api.github.com/user", accessToken);
    if (!profile) {
      return {
        success: false,
        error: "userinfo_error",
        message: "Failed to fetch user info from GitHub",
      };
    }

    let email = profile.email ?? null;
    if (!email) {
      const emails = await fetchGitHubJson<GitHubEmailResponse[]>("https://api.github.com/user/emails", accessToken);
      if (!emails) {
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
      return {
        success: false,
        error: "oauth_error",
        message: error instanceof Error && error.message ? error.message : "OAuth error occurred",
      };
    }

    if (isNetworkError(error)) {
      return {
        success: false,
        error: "network_error",
        message: "Network error occurred while validating GitHub OAuth",
      };
    }

    throw error;
  }
}
