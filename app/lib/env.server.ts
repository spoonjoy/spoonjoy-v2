/**
 * OAuth environment configuration validation.
 *
 * Functions for validating required environment variables for OAuth providers.
 * Environment variables are passed via the `env` object (Cloudflare Workers pattern).
 *
 * Required environment variables:
 * - Google OAuth: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 * - GitHub OAuth: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
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

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface OAuthEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
}

export type OAuthProvider = "google" | "github" | "apple";

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

const PLACEHOLDER_ENV_VALUES = new Set([
  "not configured",
  "not enabled",
  "not yet enabled",
  "todo",
  "tbd",
]);

function normalizeEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const unquoted = trimmed.replace(/^['"]+|['"]+$/g, "").trim();
  if (!unquoted || PLACEHOLDER_ENV_VALUES.has(unquoted.toLowerCase())) {
    return undefined;
  }

  return unquoted;
}

function requireEnvValue<K extends string>(
  env: Partial<Record<K, string | undefined>>,
  key: K
): string {
  const value = normalizeEnvValue(env[key]);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

/**
 * Validates and returns Google OAuth configuration.
 * Throws an error if any required environment variable is missing or empty.
 */
export function getGoogleOAuthConfig(env: OAuthEnv): GoogleOAuthConfig {
  return {
    clientId: requireEnvValue(env, "GOOGLE_CLIENT_ID"),
    clientSecret: requireEnvValue(env, "GOOGLE_CLIENT_SECRET"),
  };
}

/**
 * Validates and returns GitHub OAuth configuration.
 * Throws an error if any required environment variable is missing or empty.
 */
export function getGitHubOAuthConfig(env: OAuthEnv): GitHubOAuthConfig {
  return {
    clientId: requireEnvValue(env, "GITHUB_CLIENT_ID"),
    clientSecret: requireEnvValue(env, "GITHUB_CLIENT_SECRET"),
  };
}

/**
 * Validates and returns Apple OAuth configuration.
 * Throws an error if any required environment variable is missing or empty.
 */
export function getAppleOAuthConfig(env: OAuthEnv): AppleOAuthConfig {
  return {
    clientId: requireEnvValue(env, "APPLE_CLIENT_ID"),
    teamId: requireEnvValue(env, "APPLE_TEAM_ID"),
    keyId: requireEnvValue(env, "APPLE_KEY_ID"),
    privateKey: requireEnvValue(env, "APPLE_PRIVATE_KEY"),
  };
}

const ALL_OAUTH_ENV_VARS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
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
    (key) => !normalizeEnvValue(env[key])
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

  if (
    normalizeEnvValue(env.GOOGLE_CLIENT_ID) &&
    normalizeEnvValue(env.GOOGLE_CLIENT_SECRET)
  ) {
    providers.push("google");
  }

  if (
    normalizeEnvValue(env.GITHUB_CLIENT_ID) &&
    normalizeEnvValue(env.GITHUB_CLIENT_SECRET)
  ) {
    providers.push("github");
  }

  if (
    normalizeEnvValue(env.APPLE_CLIENT_ID) &&
    normalizeEnvValue(env.APPLE_TEAM_ID) &&
    normalizeEnvValue(env.APPLE_KEY_ID) &&
    normalizeEnvValue(env.APPLE_PRIVATE_KEY)
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
  return {
    publicKey: requireEnvValue(env, "VAPID_PUBLIC_KEY"),
    privateKey: requireEnvValue(env, "VAPID_PRIVATE_KEY"),
    subject: requireEnvValue(env, "VAPID_SUBJECT"),
  };
}
