/**
 * WebAuthn (passkey) server helpers.
 *
 * Wraps `@simplewebauthn/server` with Spoonjoy's relying-party config and
 * credential mapping against the existing `UserCredential` Prisma model and
 * `User.webAuthnChallenge` field.
 *
 * Two flows:
 *
 * - **Registration** (logged-in user adds a passkey): generate options with
 *   the challenge stored in `User.webAuthnChallenge`, then verify the
 *   attestation and persist a `UserCredential` row.
 * - **Authentication** (sign in with a passkey, username-first): the user
 *   supplies their email, we look up their credentials, generate options
 *   with the challenge stored in `User.webAuthnChallenge`, then verify the
 *   assertion and rotate the stored signature counter.
 *
 * The `@simplewebauthn` calls are injectable so orchestration logic can be
 * unit-tested without real WebAuthn crypto.
 */

import {
  generateRegistrationOptions as defaultGenerateRegistrationOptions,
  verifyRegistrationResponse as defaultVerifyRegistrationResponse,
  generateAuthenticationOptions as defaultGenerateAuthenticationOptions,
  verifyAuthenticationResponse as defaultVerifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";

export interface WebAuthnConfig {
  rpName: string;
  rpID: string;
  origin: string;
}

/**
 * Derive the relying-party config from the canonical base URL.
 * - rpID is the registrable domain (hostname), e.g. `spoonjoy.app` or `localhost`.
 * - origin is the full scheme + host, e.g. `https://spoonjoy.app`.
 */
export function resolveWebAuthnConfig(baseUrl: string): WebAuthnConfig {
  const url = new URL(baseUrl);
  return {
    rpName: "Spoonjoy",
    rpID: url.hostname,
    origin: url.origin,
  };
}

/** A stored credential, in the shape this module reads/writes. */
export interface StoredCredential {
  id: string;
  publicKey: Uint8Array;
  counter: bigint;
  transports: string | null;
}

const VALID_TRANSPORTS: ReadonlySet<string> = new Set([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
]);

export function parseTransports(
  transports: string | null,
): AuthenticatorTransportFuture[] | undefined {
  if (!transports) return undefined;
  const parsed = transports
    .split(",")
    .map((t) => t.trim())
    .filter((t): t is AuthenticatorTransportFuture => VALID_TRANSPORTS.has(t));
  return parsed.length > 0 ? parsed : undefined;
}

export type GenerateRegistrationOptionsFn = typeof defaultGenerateRegistrationOptions;
export type VerifyRegistrationResponseFn = typeof defaultVerifyRegistrationResponse;
export type GenerateAuthenticationOptionsFn = typeof defaultGenerateAuthenticationOptions;
export type VerifyAuthenticationResponseFn = typeof defaultVerifyAuthenticationResponse;

export async function buildRegistrationOptions(
  config: WebAuthnConfig,
  user: { id: string; username: string; email: string },
  existingCredentials: StoredCredential[],
  generate: GenerateRegistrationOptionsFn = defaultGenerateRegistrationOptions,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generate({
    rpName: config.rpName,
    rpID: config.rpID,
    userName: user.email,
    userDisplayName: user.username,
    // Stable user handle so re-registration replaces rather than duplicates.
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existingCredentials.map((cred) => ({
      id: cred.id,
      transports: parseTransports(cred.transports),
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
}

export async function verifyRegistration(
  config: WebAuthnConfig,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
  verify: VerifyRegistrationResponseFn = defaultVerifyRegistrationResponse,
): Promise<VerifiedRegistrationResponse> {
  return verify({
    response,
    expectedChallenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpID,
    requireUserVerification: false,
  });
}

/** Map a verified registration into a row for the `UserCredential` table. */
export function credentialFromRegistration(
  verification: VerifiedRegistrationResponse,
): StoredCredential | null {
  if (!verification.verified || !verification.registrationInfo) return null;
  const { credential } = verification.registrationInfo;
  return {
    id: credential.id,
    publicKey: credential.publicKey,
    counter: BigInt(credential.counter),
    transports: credential.transports ? credential.transports.join(",") : null,
  };
}

export async function buildAuthenticationOptions(
  config: WebAuthnConfig,
  credentials: StoredCredential[],
  generate: GenerateAuthenticationOptionsFn = defaultGenerateAuthenticationOptions,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generate({
    rpID: config.rpID,
    userVerification: "preferred",
    allowCredentials: credentials.map((cred) => ({
      id: cred.id,
      transports: parseTransports(cred.transports),
    })),
  });
}

export async function verifyAuthentication(
  config: WebAuthnConfig,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  credential: StoredCredential,
  verify: VerifyAuthenticationResponseFn = defaultVerifyAuthenticationResponse,
): Promise<VerifiedAuthenticationResponse> {
  return verify({
    response,
    expectedChallenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpID,
    requireUserVerification: false,
    credential: {
      id: credential.id,
      // Copy into a fresh ArrayBuffer-backed view to satisfy the library's
      // `Uint8Array<ArrayBuffer>` typing (Prisma `Bytes` come back as the
      // looser `Uint8Array<ArrayBufferLike>`).
      publicKey: new Uint8Array(credential.publicKey),
      counter: Number(credential.counter),
      transports: parseTransports(credential.transports),
    },
  });
}
