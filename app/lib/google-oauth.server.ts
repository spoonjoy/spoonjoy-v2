/**
 * Google OAuth utilities.
 *
 * Functions for generating Google Sign In authorization URLs and handling callbacks.
 * Uses Arctic library for OAuth flows with PKCE (Proof Key for Code Exchange).
 */

import {
  Google,
  generateCodeVerifier as arcticGenerateCodeVerifier,
} from "arctic";
import type { GoogleOAuthConfig } from "./env.server";
import type { AuthVerifyCapture } from "./auth-telemetry.server";

/**
 * Optional capture callback threaded in by the callback-route orchestration.
 * Lets a provider outage (token exchange, JWKS, userinfo non-2xx, network) be
 * captured with the ORIGINAL error before it is flattened to a generic error
 * code, without coupling this helper to the PostHog config.
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
    };
  }

  // Validate code
  if (!callbackData.code) {
    return {
      success: false,
      error: "invalid_code",
      message: "Missing authorization code",
    };
  }

  // Validate codeVerifier
  if (!callbackData.codeVerifier) {
    return {
      success: false,
      error: "invalid_code_verifier",
      message: "Missing code verifier",
    };
  }

  try {
    // Import Arctic's Google class dynamically to enable mocking
    const { Google, OAuth2RequestError } = await import("arctic");

    // Create Arctic Google client
    const google = new Google(config.clientId, config.clientSecret, redirectUri);

    // Exchange authorization code for tokens (PKCE)
    const tokens = await google.validateAuthorizationCode(
      callbackData.code,
      callbackData.codeVerifier
    );

    // Fetch user info from Google's userinfo endpoint
    const accessToken = tokens.accessToken();

    let userinfo: GoogleUserinfoResponse;
    try {
      const response = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        // A non-2xx userinfo response (token revoked, Google 5xx) is otherwise
        // invisible — preserve the upstream status for incident triage.
        capture?.({
          error: new Error(`Google userinfo responded ${response.status}`),
          phase: "userinfo",
          httpStatus: response.status,
        });
        return {
          success: false,
          error: "userinfo_error",
          message: "Failed to fetch user info from Google",
        };
      }

      userinfo = (await response.json()) as GoogleUserinfoResponse;
    } catch (error) {
      // Handle network errors during userinfo fetch
      if (
        error instanceof Error &&
        (error.message.includes("fetch") ||
          error.message.includes("network") ||
          error.name === "TypeError")
      ) {
        capture?.({ error, phase: "userinfo" });
        return {
          success: false,
          error: "network_error",
          message:
            "Network error occurred while fetching user info from Google",
        };
      }
      throw error;
    }

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
    // Handle OAuth2RequestError from Arctic (check name for mock compatibility)
    if (error instanceof Error && error.name === "OAuth2RequestError") {
      capture?.({ error, phase: "token_exchange" });
      return {
        success: false,
        error: "oauth_error",
        message: error.message || "OAuth error occurred",
      };
    }

    // Handle network/fetch errors during token exchange
    if (
      error instanceof Error &&
      (error.message.includes("fetch") ||
        error.message.includes("network") ||
        error.name === "TypeError")
    ) {
      capture?.({ error, phase: "token_exchange" });
      return {
        success: false,
        error: "network_error",
        message: "Network error occurred while validating authorization code",
      };
    }

    // Anything else (JWKS, unexpected token-exchange failures) is flattened to a
    // generic `invalid_code`. Capture the ORIGINAL error so a Google outage is
    // distinguishable from a genuinely bad authorization code.
    capture?.({ error, phase: "token_exchange" });
    return {
      success: false,
      error: "invalid_code",
      message: "Invalid authorization code",
    };
  }
}
