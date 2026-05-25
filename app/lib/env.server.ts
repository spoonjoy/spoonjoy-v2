/**
 * OAuth environment configuration validation.
 *
 * Functions for validating required environment variables for OAuth providers.
 * Environment variables are passed via the `env` object (Cloudflare Workers pattern).
 *
 * Required environment variables:
 * - Google OAuth: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 * - Apple OAuth: APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY
 *
 * Set secrets in production via: wrangler secret put <SECRET_NAME>
 */

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface AppleOAuthConfig {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
}

export interface OAuthEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
}

export type OAuthProvider = "google" | "apple";

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface VapidEnv {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

/**
 * Validates and returns Google OAuth configuration.
 * Throws an error if any required environment variable is missing or empty.
 */
export function getGoogleOAuthConfig(env: OAuthEnv): GoogleOAuthConfig {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new Error("Missing required environment variable: GOOGLE_CLIENT_ID");
  }
  if (!env.GOOGLE_CLIENT_SECRET) {
    throw new Error(
      "Missing required environment variable: GOOGLE_CLIENT_SECRET"
    );
  }

  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}

/**
 * Validates and returns Apple OAuth configuration.
 * Throws an error if any required environment variable is missing or empty.
 */
export function getAppleOAuthConfig(env: OAuthEnv): AppleOAuthConfig {
  if (!env.APPLE_CLIENT_ID) {
    throw new Error("Missing required environment variable: APPLE_CLIENT_ID");
  }
  if (!env.APPLE_TEAM_ID) {
    throw new Error("Missing required environment variable: APPLE_TEAM_ID");
  }
  if (!env.APPLE_KEY_ID) {
    throw new Error("Missing required environment variable: APPLE_KEY_ID");
  }
  if (!env.APPLE_PRIVATE_KEY) {
    throw new Error("Missing required environment variable: APPLE_PRIVATE_KEY");
  }

  return {
    clientId: env.APPLE_CLIENT_ID,
    teamId: env.APPLE_TEAM_ID,
    keyId: env.APPLE_KEY_ID,
    privateKey: env.APPLE_PRIVATE_KEY,
  };
}

const ALL_OAUTH_ENV_VARS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "APPLE_CLIENT_ID",
  "APPLE_TEAM_ID",
  "APPLE_KEY_ID",
  "APPLE_PRIVATE_KEY",
] as const;

/**
 * Validates all OAuth environment variables at once.
 * Throws a single error listing ALL missing variables (better DX than one-at-a-time).
 * Returns true if all variables are present and non-empty.
 */
export function validateOAuthEnv(env: OAuthEnv): true {
  const missing = ALL_OAUTH_ENV_VARS.filter(
    (key) => !env[key as keyof OAuthEnv]
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  return true;
}

export function getConfiguredOAuthProviders(env: OAuthEnv): OAuthProvider[] {
  const providers: OAuthProvider[] = [];

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push("google");
  }

  if (
    env.APPLE_CLIENT_ID &&
    env.APPLE_TEAM_ID &&
    env.APPLE_KEY_ID &&
    env.APPLE_PRIVATE_KEY
  ) {
    providers.push("apple");
  }

  return providers;
}

/**
 * Validates and returns the VAPID push-notification configuration.
 * Throws if any of VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 * is missing or empty. Empty strings are treated as missing — same pattern
 * as the OAuth helpers above.
 */
export function getVapidConfig(env: VapidEnv): VapidConfig {
  if (!env.VAPID_PUBLIC_KEY) {
    throw new Error("Missing required environment variable: VAPID_PUBLIC_KEY");
  }
  if (!env.VAPID_PRIVATE_KEY) {
    throw new Error("Missing required environment variable: VAPID_PRIVATE_KEY");
  }
  if (!env.VAPID_SUBJECT) {
    throw new Error("Missing required environment variable: VAPID_SUBJECT");
  }

  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  };
}
