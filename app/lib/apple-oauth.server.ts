/**
 * Apple OAuth utilities.
 *
 * Functions for generating Apple Sign In authorization URLs and handling callbacks.
 * Uses Arctic library for OAuth flows.
 */

import {
  Apple,
  decodeIdToken,
  OAuth2RequestError,
  generateState as arcticGenerateState,
} from "arctic";
import type { AppleOAuthConfig } from "./env.server";

/**
 * Data received from Apple's OAuth callback (POST request body).
 */
export interface AppleCallbackData {
  /** Authorization code from Apple */
  code: string;
  /** CSRF protection state */
  state: string;
  /** User info JSON (only provided on first sign-in) */
  user?: string;
}

/**
 * Apple user data extracted from the callback.
 */
export interface AppleUser {
  /** Apple's unique user identifier (sub claim from ID token) */
  id: string;
  /** User's email address */
  email: string;
  /** Whether the email is verified (always true for Apple) */
  emailVerified: boolean;
  /** Whether this is a private relay email (Hide My Email) */
  isPrivateEmail: boolean;
  /** User's first name (only on first sign-in, may be null) */
  firstName: string | null;
  /** User's last name (only on first sign-in, may be null) */
  lastName: string | null;
  /** Full name constructed from first and last name */
  fullName: string | null;
}

/**
 * Result of verifying Apple OAuth callback.
 */
export interface AppleCallbackResult {
  success: boolean;
  appleUser?: AppleUser;
  error?: string;
  message?: string;
}

/**
 * Generates a cryptographically random state string for CSRF protection.
 * Returns a URL-safe string suitable for OAuth 2.0 state parameter.
 *
 * Uses Arctic library's generateState() internally.
 */
export function generateOAuthState(): string {
  return arcticGenerateState();
}

function encodeApplePrivateKey(privateKey: string): Uint8Array {
  const base64 = privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  try {
    const binary = atob(base64);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    // Keep fake/test keys usable for URL generation; Apple token exchange will still fail for invalid real keys.
    return new TextEncoder().encode(privateKey);
  }
}

function createAppleClient(config: AppleOAuthConfig, redirectUri: string): Apple {
  return new Apple(
    config.clientId,
    config.teamId,
    config.keyId,
    encodeApplePrivateKey(config.privateKey),
    redirectUri
  );
}

/**
 * Creates an Apple authorization URL for initiating Sign in with Apple.
 *
 * @param config - Apple OAuth configuration (from env.server.ts)
 * @param redirectUri - The callback URL Apple will redirect to
 * @param state - CSRF protection state (generate via generateOAuthState)
 * @returns URL object pointing to Apple's authorization endpoint
 *
 * Note: Apple requires response_mode=form_post when requesting scopes.
 * This means the callback will be a POST request, not GET.
 */
export function createAppleAuthorizationURL(
  config: AppleOAuthConfig,
  redirectUri: string,
  state: string
): URL {
  const apple = createAppleClient(config, redirectUri);

  // Arctic's createAuthorizationURL handles the core OAuth URL construction
  const scopes = ["email", "name"];
  const url = apple.createAuthorizationURL(state, scopes);

  // Apple requires response_mode=form_post when requesting scopes
  // This must be added manually as Arctic doesn't set it by default
  url.searchParams.set("response_mode", "form_post");
  url.searchParams.set("redirect_uri", redirectUri);

  return url;
}

/**
 * Interface for Apple's ID token claims.
 */
interface AppleIdTokenClaims {
  sub: string;
  email: string;
  email_verified: string | boolean;
  is_private_email?: string | boolean;
}

/**
 * Interface for user data from Apple's user parameter (first sign-in only).
 */
interface AppleUserParameter {
  name?: {
    firstName?: string;
    lastName?: string;
  };
  email?: string;
}

/**
 * Verifies Apple OAuth callback and extracts user data.
 *
 * @param config - Apple OAuth configuration (from env.server.ts)
 * @param redirectUri - The callback URL used in the initial authorization request
 * @param callbackData - Data from Apple's POST callback (code, state, user)
 * @returns Result with appleUser on success, or error details on failure
 *
 * Note: This function validates the authorization code with Apple,
 * decodes the ID token, and extracts user information.
 */
export async function verifyAppleCallback(
  config: AppleOAuthConfig,
  redirectUri: string,
  callbackData: AppleCallbackData
): Promise<AppleCallbackResult> {
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

  // Parse user parameter (only provided on first sign-in)
  let userParam: AppleUserParameter | null = null;
  if (callbackData.user) {
    try {
      userParam = JSON.parse(callbackData.user) as AppleUserParameter;
    } catch {
      // Invalid JSON in user parameter - continue without name info
      userParam = null;
    }
  }

  try {
    const apple = createAppleClient(config, redirectUri);

    // Exchange authorization code for tokens
    const tokens = await apple.validateAuthorizationCode(callbackData.code);

    // Decode the ID token to get user claims
    const idToken = tokens.idToken();
    const claims = decodeIdToken(idToken) as AppleIdTokenClaims;

    // Extract name from user parameter (first sign-in only)
    const firstName = userParam?.name?.firstName ?? null;
    const lastName = userParam?.name?.lastName ?? null;

    // Construct full name
    let fullName: string | null = null;
    if (firstName && lastName) {
      fullName = `${firstName} ${lastName}`;
    } else if (firstName) {
      fullName = firstName;
    } else if (lastName) {
      fullName = lastName;
    }

    // Handle Apple quirk: email_verified can be string "true" instead of boolean
    const emailVerified =
      claims.email_verified === true || claims.email_verified === "true";

    // Handle private email (Hide My Email)
    const isPrivateEmail =
      claims.is_private_email === true || claims.is_private_email === "true";

    const appleUser: AppleUser = {
      id: claims.sub,
      email: claims.email,
      emailVerified,
      isPrivateEmail,
      firstName,
      lastName,
      fullName,
    };

    return {
      success: true,
      appleUser,
    };
  } catch (error) {
    // Handle OAuth2RequestError from Arctic (check name for mock compatibility)
    if (
      error instanceof OAuth2RequestError ||
      (error instanceof Error && error.name === "OAuth2RequestError")
    ) {
      return {
        success: false,
        error: "oauth_error",
        message: error.message || "OAuth error occurred",
      };
    }

    // Handle network/fetch errors
    if (
      error instanceof Error &&
      (error.message.includes("fetch") ||
        error.message.includes("network") ||
        error.name === "TypeError")
    ) {
      return {
        success: false,
        error: "network_error",
        message: "Network error occurred while validating authorization code",
      };
    }

    // For invalid authorization code errors, return invalid_code
    return {
      success: false,
      error: "invalid_code",
      message: "Invalid authorization code",
    };
  }
}
