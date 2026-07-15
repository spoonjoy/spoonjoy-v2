/**
 * Google OAuth utilities.
 *
 * Functions for generating Google Sign In authorization URLs and handling callbacks.
 * Uses Arctic library for OAuth flows with PKCE (Proof Key for Code Exchange).
 */

import {
  ArcticFetchError,
  Google,
  UnexpectedErrorResponseBodyError,
  UnexpectedResponseError,
  generateCodeVerifier as arcticGenerateCodeVerifier,
} from "arctic";
import type { GoogleOAuthConfig } from "./env.server";
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
 * Lets provider failures be captured with their original error, phase, and
 * retry classification without coupling this helper to the PostHog config.
 */
export type AuthVerifyCaptureFn = (input: AuthVerifyCapture) => void;

/**
 * Data received from Google's OAuth callback (GET request query params).
 */
export interface GoogleCallbackData {
  /** Authorization code from Google */
  code: string;
  /** CSRF protection state */
  state: string;
  /** PKCE code verifier (stored client-side during initiation) */
  codeVerifier: string;
}

/**
 * Google user data extracted from the callback.
 */
export interface GoogleUser {
  /** Google's unique user identifier (sub claim) */
  id: string;
  /** User's email address */
  email: string;
  /** Whether the email is verified */
  emailVerified: boolean;
  /** User's full display name */
  name: string | null;
  /** User's given (first) name */
  givenName: string | null;
  /** User's family (last) name */
  familyName: string | null;
  /** Profile picture URL */
  picture: string | null;
}

/**
 * Result of verifying Google OAuth callback.
 */
export interface GoogleCallbackResult {
  success: boolean;
  googleUser?: GoogleUser;
  error?: string;
  message?: string;
  failureKind?: OAuthProviderFailureKind;
  retryable?: boolean;
}

/**
 * Generates a cryptographically random code verifier for PKCE.
 * Returns a URL-safe string suitable for OAuth 2.0 PKCE flow.
 *
 * Per RFC 7636, code verifier must be:
 * - Between 43 and 128 characters
 * - Only unreserved characters: [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
 *
 * Uses Arctic library's generateCodeVerifier() internally.
 */
export function generateCodeVerifier(): string {
  return arcticGenerateCodeVerifier();
}

/**
 * Creates a Google authorization URL for initiating Sign in with Google.
 *
 * @param config - Google OAuth configuration (from env.server.ts)
 * @param redirectUri - The callback URL Google will redirect to
 * @param state - CSRF protection state (generate via generateOAuthState)
 * @param codeVerifier - PKCE code verifier (generate via generateCodeVerifier)
 * @returns URL object pointing to Google's authorization endpoint
 *
 * Note: Google uses standard OAuth 2.0 redirect flow (GET callback).
 * PKCE is handled by Arctic - the code_challenge is derived from codeVerifier internally.
 */
export function createGoogleAuthorizationURL(
  config: GoogleOAuthConfig,
  redirectUri: string,
  state: string,
  codeVerifier: string
): URL {
  // Create Arctic Google client with the redirect URI
  const google = new Google(config.clientId, config.clientSecret, redirectUri);

  // Arctic's createAuthorizationURL handles PKCE code_challenge generation internally
  const scopes = ["openid", "email", "profile"];
  const url = google.createAuthorizationURL(state, codeVerifier, scopes);

  return url;
}

/**
 * Interface for Google's userinfo endpoint response.
 */
interface GoogleUserinfoResponse {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

function providerCallFailureResult(
  error: unknown,
  capture?: AuthVerifyCaptureFn,
): GoogleCallbackResult | null {
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

function oauthClientFailure(message: string): GoogleCallbackResult {
  return {
    success: false,
    error: "oauth_error",
    message: message || "OAuth error occurred",
    failureKind: "client",
    retryable: false,
  };
}

function errorStatus(error: unknown): number | undefined {
  if (!(error instanceof Error) || !("status" in error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
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

/**
 * Verifies Google OAuth callback and extracts user data.
 *
 * @param config - Google OAuth configuration (from env.server.ts)
 * @param redirectUri - The callback URL used in the initial authorization request
 * @param callbackData - Data from Google's GET callback (code, state, codeVerifier)
 * @returns Result with googleUser on success, or error details on failure
 *
 * Note: This function validates the authorization code with Google using PKCE,
 * then fetches user info from the userinfo endpoint.
 */
export async function verifyGoogleCallback(
  config: GoogleOAuthConfig,
  redirectUri: string,
  callbackData: GoogleCallbackData,
  capture?: AuthVerifyCaptureFn
): Promise<GoogleCallbackResult> {
  // Validate state
  if (!callbackData.state) {
    return {
      success: false,
      error: "invalid_state",
      message: "Missing state parameter",
      failureKind: "client",
      retryable: false,
    };
  }

  // Validate code
  if (!callbackData.code) {
    return {
      success: false,
      error: "invalid_code",
      message: "Missing authorization code",
      failureKind: "client",
      retryable: false,
    };
  }

  // Validate codeVerifier
  if (!callbackData.codeVerifier) {
    return {
      success: false,
      error: "invalid_code_verifier",
      message: "Missing code verifier",
      failureKind: "client",
      retryable: false,
    };
  }

  try {
    // Import Arctic's Google class dynamically to enable mocking
    const { Google } = await import("arctic");

    // Create Arctic Google client
    const google = new Google(config.clientId, config.clientSecret, redirectUri);

    // Exchange authorization code for tokens (PKCE)
    const tokens = await withOAuthProviderTimeout(
      google.validateAuthorizationCode(
        callbackData.code,
        callbackData.codeVerifier,
      ),
      "token_exchange",
    );

    // Fetch user info from Google's userinfo endpoint
    const accessToken = tokens.accessToken();

    const userinfo = await fetchOAuthProviderJson<GoogleUserinfoResponse>(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      "userinfo",
      "Google userinfo",
    );

    const googleUser: GoogleUser = {
      id: userinfo.sub,
      email: userinfo.email,
      emailVerified: userinfo.email_verified,
      name: userinfo.name ?? null,
      givenName: userinfo.given_name ?? null,
      familyName: userinfo.family_name ?? null,
      picture: userinfo.picture ?? null,
    };

    return {
      success: true,
      googleUser,
    };
  } catch (error) {
    const providerFailure = providerCallFailureResult(error, capture);
    if (providerFailure) return providerFailure;

    // Handle OAuth2RequestError from Arctic (check name for mock compatibility)
    if (error instanceof Error && error.name === "OAuth2RequestError") {
      capture?.({
        error,
        phase: "token_exchange",
        failureKind: "client",
        retryable: false,
      });
      return oauthClientFailure(error.message);
    }

    if (isUnexpectedOAuthResponseError(error)) {
      const status = errorStatus(error);
      const upstream = new OAuthProviderCallError(
        "upstream_error",
        "upstream",
        status === undefined || isRetryableProviderStatus(status),
        "token_exchange",
        status === undefined
          ? "Google token exchange returned an invalid response"
          : `Google token exchange responded ${status}`,
        status,
        error,
      );
      return providerCallFailureResult(upstream, capture)!;
    }

    // Handle network/fetch errors during token exchange
    if (
      error instanceof ArcticFetchError ||
      (error instanceof Error &&
        (error.message.includes("fetch") ||
          error.message.includes("network") ||
          error.name === "TypeError"))
    ) {
      capture?.({
        error,
        phase: "token_exchange",
        failureKind: "network",
        retryable: true,
      });
      return {
        success: false,
        error: "network_error",
        message: "Network error occurred while validating authorization code",
        failureKind: "network",
        retryable: true,
      };
    }

    // Preserve the legacy invalid-code behavior for unknown token failures.
    // Known Arctic transport and protocol failures are classified above.
    capture?.({
      error,
      phase: "token_exchange",
      failureKind: "client",
      retryable: false,
    });
    return {
      success: false,
      error: "invalid_code",
      message: "Invalid authorization code",
      failureKind: "client",
      retryable: false,
    };
  }
}
