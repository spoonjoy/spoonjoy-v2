/**
 * Sign-in with a self-hosted server owner's own OpenID Connect provider (Authentik, Authelia,
 * Keycloak and the like), set by SPOONJOY_OIDC_* (env.server.ts getOidcConfig).
 *
 * The provider is found through `${issuer}/.well-known/openid-configuration`. Sign-in is the
 * authorization-code flow with PKCE (S256), state and a nonce. The ID token's signature is checked
 * with WebCrypto against the provider's published keys (or, for HS256, the client secret), and its
 * issuer, audience, expiry and nonce must match. Nothing here needs Node's crypto, so it runs on
 * Workers.
 */

import { generateState } from "arctic";
import type { OidcConfig } from "./env.server";
import type { AuthVerifyCapture } from "./auth-telemetry.server";
import {
  OAuthProviderCallError,
  fetchOAuthProviderJson,
  type OAuthProviderCallPhase,
  type OAuthProviderFailureKind,
} from "./oauth-provider-call.server";

export type AuthVerifyCaptureFn = (input: AuthVerifyCapture) => void;

export interface OidcCallbackData {
  code: string;
  codeVerifier: string;
  nonce: string;
}

export interface OidcUser {
  /** The provider's `sub`, unique within its issuer. */
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  /** Shown in Account settings beside the link: preferred_username, then email, then sub. */
  username: string;
}

export interface OidcCallbackResult {
  success: boolean;
  oidcUser?: OidcUser;
  error?: string;
  message?: string;
  failureKind?: OAuthProviderFailureKind;
  retryable?: boolean;
}

interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
}

interface OidcJsonWebKey {
  kid?: string;
  kty?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

interface OidcIdTokenClaims {
  iss?: unknown;
  aud?: unknown;
  azp?: unknown;
  exp?: unknown;
  iat?: unknown;
  nonce?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  preferred_username?: unknown;
}

interface OidcTokenResponse {
  id_token?: unknown;
  access_token?: unknown;
}

const CACHE_MS = 60 * 60 * 1000;
// Clock skew allowed between this server and the provider.
const CLOCK_SKEW_SECONDS = 60;

const discoveryCache = new Map<string, { value: OidcDiscovery; expiresAt: number }>();
const jwksCache = new Map<string, { keys: OidcJsonWebKey[]; expiresAt: number }>();

/** Test-only: forget cached discovery documents and keys. */
export function _resetOidcCachesForTests(): void {
  discoveryCache.clear();
  jwksCache.clear();
}

/**
 * The OAuth table's provider for this issuer. The issuer is part of it, so pointing the server at
 * another provider never signs anyone in to an account linked through the old one.
 */
export function oidcProviderKey(config: Pick<OidcConfig, "issuer">): string {
  return `oidc:${config.issuer}`;
}

export function generateOidcNonce(): string {
  return generateState();
}

class OidcIdTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcIdTokenError";
  }
}

function discoveryError(phase: OAuthProviderCallPhase, message: string): OAuthProviderCallError {
  return new OAuthProviderCallError("upstream_error", "upstream", false, phase, message);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

async function discover(config: OidcConfig): Promise<OidcDiscovery> {
  const cached = discoveryCache.get(config.issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const document = await fetchOAuthProviderJson<Partial<OidcDiscovery> | null>(
    `${config.issuer}/.well-known/openid-configuration`,
    { headers: { Accept: "application/json" } },
    "discovery",
    "OpenID Connect discovery",
  );
  if (!document || typeof document.issuer !== "string" || withoutTrailingSlash(document.issuer) !== config.issuer) {
    throw discoveryError("discovery", `The provider's discovery document names another issuer than ${config.issuer}`);
  }
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
    if (typeof document[key] !== "string" || !URL.canParse(document[key])) {
      throw discoveryError("discovery", `The provider's discovery document has no ${key}`);
    }
  }
  const value = document as OidcDiscovery;
  discoveryCache.set(config.issuer, { value, expiresAt: Date.now() + CACHE_MS });
  return value;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function decodeJsonPart<T>(value: string): T {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(value)));
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    return parsed as T;
  } catch {
    throw new OidcIdTokenError("The provider's ID token is malformed");
  }
}

async function codeChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function createOidcAuthorizationURL(
  config: OidcConfig,
  redirectUri: string,
  state: string,
  codeVerifier: string,
  nonce: string,
): Promise<URL> {
  const discovery = await discover(config);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", await codeChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

function formEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

async function exchangeCode(
  config: OidcConfig,
  discovery: OidcDiscovery,
  redirectUri: string,
  data: OidcCallbackData,
): Promise<OidcTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: data.code,
    redirect_uri: redirectUri,
    code_verifier: data.codeVerifier,
  });
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  // client_secret_basic is the default (OpenID Connect Discovery 1.0); a provider that lists only
  // client_secret_post gets the client in the body instead.
  const methods = discovery.token_endpoint_auth_methods_supported;
  if (methods && !methods.includes("client_secret_basic") && methods.includes("client_secret_post")) {
    body.set("client_id", config.clientId);
    body.set("client_secret", config.clientSecret);
  } else {
    headers.Authorization = `Basic ${btoa(`${formEncode(config.clientId)}:${formEncode(config.clientSecret)}`)}`;
  }
  const tokens = await fetchOAuthProviderJson<OidcTokenResponse | null>(
    discovery.token_endpoint,
    { method: "POST", headers, body: body.toString() },
    "token_exchange",
    "OpenID Connect token exchange",
  );
  return tokens ?? {};
}

const SIGNING_ALGORITHMS = {
  RS256: { kty: "RSA", importParams: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, verifyParams: { name: "RSASSA-PKCS1-v1_5" } },
  RS384: { kty: "RSA", importParams: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" }, verifyParams: { name: "RSASSA-PKCS1-v1_5" } },
  RS512: { kty: "RSA", importParams: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" }, verifyParams: { name: "RSASSA-PKCS1-v1_5" } },
  PS256: { kty: "RSA", importParams: { name: "RSA-PSS", hash: "SHA-256" }, verifyParams: { name: "RSA-PSS", saltLength: 32 } },
  ES256: { kty: "EC", importParams: { name: "ECDSA", namedCurve: "P-256" }, verifyParams: { name: "ECDSA", hash: "SHA-256" } },
  ES384: { kty: "EC", importParams: { name: "ECDSA", namedCurve: "P-384" }, verifyParams: { name: "ECDSA", hash: "SHA-384" } },
} as const;

type AsymmetricAlgorithm = keyof typeof SIGNING_ALGORITHMS;

function isAsymmetricAlgorithm(alg: unknown): alg is AsymmetricAlgorithm {
  return typeof alg === "string" && Object.hasOwn(SIGNING_ALGORITHMS, alg);
}

async function providerKeys(jwksUri: string, refresh: boolean): Promise<OidcJsonWebKey[]> {
  const cached = jwksCache.get(jwksUri);
  if (!refresh && cached && cached.expiresAt > Date.now()) return cached.keys;
  const jwks = await fetchOAuthProviderJson<{ keys?: unknown } | null>(
    jwksUri,
    { headers: { Accept: "application/json" } },
    "jwks",
    "OpenID Connect keys",
  );
  const keys = Array.isArray(jwks?.keys) ? (jwks.keys as OidcJsonWebKey[]) : [];
  jwksCache.set(jwksUri, { keys, expiresAt: Date.now() + CACHE_MS });
  return keys;
}

function matchingKey(keys: OidcJsonWebKey[], alg: AsymmetricAlgorithm, kid: string | null): OidcJsonWebKey | undefined {
  return keys.find((key) =>
    key.kty === SIGNING_ALGORITHMS[alg].kty &&
    (key.use === undefined || key.use === "sig") &&
    (key.alg === undefined || key.alg === alg) &&
    (kid === null || key.kid === kid));
}

async function verificationKey(
  discovery: OidcDiscovery,
  alg: AsymmetricAlgorithm,
  kid: string | null,
): Promise<CryptoKey> {
  // A key the cached set doesn't have may be a rotation, so the set is fetched again once.
  const jwk = matchingKey(await providerKeys(discovery.jwks_uri, false), alg, kid)
    ?? matchingKey(await providerKeys(discovery.jwks_uri, true), alg, kid);
  if (!jwk) throw new OidcIdTokenError("The provider's ID token is signed with a key it doesn't publish");
  const { kty, n, e, crv, x, y } = jwk;
  try {
    return await crypto.subtle.importKey(
      "jwk",
      { kty, n, e, crv, x, y, ext: true },
      SIGNING_ALGORITHMS[alg].importParams,
      false,
      ["verify"],
    );
  } catch {
    throw new OidcIdTokenError("The provider published a signing key Spoonjoy can't read");
  }
}

async function verifySignature(
  config: OidcConfig,
  discovery: OidcDiscovery,
  header: { alg?: unknown; kid?: unknown },
  signingInput: Uint8Array<ArrayBuffer>,
  signature: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  if (header.alg === "HS256") {
    // A provider with no signing key of its own (Authentik's default, for one) signs with the
    // client secret.
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(config.clientSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify("HMAC", key, signature, signingInput);
  }
  if (!isAsymmetricAlgorithm(header.alg)) {
    throw new OidcIdTokenError("The provider's ID token uses a signing algorithm Spoonjoy doesn't accept");
  }
  const key = await verificationKey(discovery, header.alg, stringValue(header.kid));
  return crypto.subtle.verify(SIGNING_ALGORITHMS[header.alg].verifyParams, key, signature, signingInput);
}

async function verifyIdToken(
  config: OidcConfig,
  discovery: OidcDiscovery,
  idToken: unknown,
  nonce: string,
  now: Date,
): Promise<OidcIdTokenClaims & { sub: string }> {
  const parts = typeof idToken === "string" ? idToken.split(".") : [];
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new OidcIdTokenError("The provider returned no usable ID token");
  }
  const header = decodeJsonPart<{ alg?: unknown; kid?: unknown }>(parts[0]);
  const claims = decodeJsonPart<OidcIdTokenClaims>(parts[1]);
  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  if (!(await verifySignature(config, discovery, header, signingInput, base64UrlDecode(parts[2])))) {
    throw new OidcIdTokenError("The provider's ID token signature is invalid");
  }

  if (claims.iss !== discovery.issuer) {
    throw new OidcIdTokenError("The ID token was issued by another provider");
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.clientId) || (claims.azp !== undefined && claims.azp !== config.clientId)) {
    throw new OidcIdTokenError("The ID token was issued to another client");
  }
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS <= nowSeconds) {
    throw new OidcIdTokenError("The ID token has expired");
  }
  if (typeof claims.iat === "number" && claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) {
    throw new OidcIdTokenError("The ID token is not valid yet");
  }
  if (claims.nonce !== nonce) {
    throw new OidcIdTokenError("The ID token's nonce doesn't match this sign-in");
  }
  const sub = stringValue(claims.sub);
  if (!sub) throw new OidcIdTokenError("The ID token names no user");
  return { ...claims, sub };
}

/**
 * Providers that keep the ID token small (Authelia does by default) give the email only from the
 * userinfo endpoint. Its answer counts only for the same `sub` as the verified ID token.
 */
async function userinfoClaims(
  discovery: OidcDiscovery,
  accessToken: unknown,
  sub: string,
): Promise<OidcIdTokenClaims> {
  if (!discovery.userinfo_endpoint || typeof accessToken !== "string" || !accessToken) return {};
  const userinfo = await fetchOAuthProviderJson<OidcIdTokenClaims | null>(
    discovery.userinfo_endpoint,
    { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } },
    "userinfo",
    "OpenID Connect userinfo",
  );
  return userinfo?.sub === sub ? userinfo : {};
}

function userFromClaims(sub: string, claims: OidcIdTokenClaims): OidcUser {
  const email = stringValue(claims.email);
  const emailVerified = email !== null && (claims.email_verified === true || claims.email_verified === "true");
  const preferredUsername = stringValue(claims.preferred_username);
  return {
    id: sub,
    email,
    emailVerified,
    name: stringValue(claims.name) ?? preferredUsername,
    username: preferredUsername ?? email ?? sub,
  };
}

export async function verifyOidcCallback(
  config: OidcConfig,
  redirectUri: string,
  data: OidcCallbackData,
  capture?: AuthVerifyCaptureFn,
  now: Date = new Date(),
): Promise<OidcCallbackResult> {
  if (!data.code) {
    return { success: false, error: "invalid_code", message: "Missing authorization code", failureKind: "client", retryable: false };
  }

  try {
    const discovery = await discover(config);
    const tokens = await exchangeCode(config, discovery, redirectUri, data);
    const idClaims = await verifyIdToken(config, discovery, tokens.id_token, data.nonce, now);
    const claims = stringValue(idClaims.email)
      ? idClaims
      : { ...idClaims, ...(await userinfoClaims(discovery, tokens.access_token, idClaims.sub)) };
    return { success: true, oidcUser: userFromClaims(idClaims.sub, claims) };
  } catch (error) {
    if (error instanceof OAuthProviderCallError) {
      capture?.({
        error: error.originalError ?? error,
        phase: error.phase,
        httpStatus: error.httpStatus,
        failureKind: error.failureKind,
        retryable: error.retryable,
      });
      return { success: false, error: error.code, message: error.message, failureKind: error.failureKind, retryable: error.retryable };
    }
    if (error instanceof OidcIdTokenError) {
      capture?.({ error, phase: "verify", failureKind: "client", retryable: false });
      return { success: false, error: "invalid_id_token", message: error.message, failureKind: "client", retryable: false };
    }
    throw error;
  }
}
