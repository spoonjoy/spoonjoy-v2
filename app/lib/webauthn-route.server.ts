/**
 * WebAuthn route orchestration.
 *
 * Sits between the thin route modules and the crypto wrappers in
 * `~/lib/webauthn.server`. Handles challenge persistence (in
 * `User.webAuthnChallenge`), credential lookup/persistence
 * (`UserCredential`), and signature-counter rotation.
 *
 * Functions take an explicit Prisma client so they can be tested against
 * the local D1 test database. The crypto wrappers are mocked in unit tests.
 */

import type { PrismaClient } from "@prisma/client";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  type StoredCredential,
  type WebAuthnConfig,
  buildAuthenticationOptions,
  buildRegistrationOptions,
  credentialFromRegistration,
  verifyAuthentication,
  verifyRegistration,
} from "~/lib/webauthn.server";
import { requestCanonicalOrigin } from "~/lib/canonical-host.server";

export class WebAuthnError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "WebAuthnError";
    this.status = status;
  }
}

function toStoredCredential(row: {
  id: string;
  publicKey: Uint8Array;
  counter: bigint;
  transports: string | null;
}): StoredCredential {
  return {
    id: row.id,
    publicKey: row.publicKey,
    counter: row.counter,
    transports: row.transports,
  };
}

export async function startRegistration(
  db: PrismaClient,
  userId: string,
  config: WebAuthnConfig,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, email: true },
  });
  if (!user) throw new WebAuthnError("User not found", 404);

  const existing = await db.userCredential.findMany({ where: { userId } });
  const options = await buildRegistrationOptions(
    config,
    user,
    existing.map(toStoredCredential),
  );

  await db.user.update({
    where: { id: userId },
    data: { webAuthnChallenge: options.challenge },
  });

  return options;
}

export async function finishRegistration(
  db: PrismaClient,
  userId: string,
  config: WebAuthnConfig,
  response: RegistrationResponseJSON,
  name?: string | null,
): Promise<{ verified: true; credentialId: string }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { webAuthnChallenge: true },
  });
  if (!user) throw new WebAuthnError("User not found", 404);
  if (!user.webAuthnChallenge) {
    throw new WebAuthnError("No registration in progress", 400);
  }

  let verification;
  try {
    verification = await verifyRegistration(config, response, user.webAuthnChallenge);
  } catch (error) {
    throw new WebAuthnError(
      error instanceof Error ? error.message : "Registration verification failed",
      400,
    );
  }

  const credential = credentialFromRegistration(verification);
  if (!credential) throw new WebAuthnError("Registration could not be verified", 400);

  // Copy into a fresh ArrayBuffer-backed view so it satisfies Prisma's
  // `Bytes` typing (`Uint8Array<ArrayBuffer>`).
  const publicKey = new Uint8Array(credential.publicKey);

  // Persist (upsert so re-registering the same authenticator is idempotent),
  // then clear the one-time challenge.
  const trimmedName = typeof name === "string" ? name.trim() : "";
  await db.userCredential.upsert({
    where: { id: credential.id },
    create: {
      id: credential.id,
      userId,
      publicKey,
      counter: credential.counter,
      transports: credential.transports,
      name: trimmedName || null,
      createdAt: new Date(),
    },
    update: {
      publicKey,
      counter: credential.counter,
      transports: credential.transports,
    },
  });
  await db.user.update({
    where: { id: userId },
    data: { webAuthnChallenge: null },
  });

  return { verified: true, credentialId: credential.id };
}

export async function startAuthentication(
  db: PrismaClient,
  email: string,
  config: WebAuthnConfig,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });

  // Username-first flow: if the user has no credentials (or doesn't exist),
  // return options with an empty allowlist. The browser will surface "no
  // passkey" rather than us leaking which emails are registered with a hard
  // error.
  const credentials = user
    ? await db.userCredential.findMany({ where: { userId: user.id } })
    : [];

  const options = await buildAuthenticationOptions(
    config,
    credentials.map(toStoredCredential),
  );

  if (user) {
    await db.user.update({
      where: { id: user.id },
      data: { webAuthnChallenge: options.challenge },
    });
  }

  return options;
}

export async function finishAuthentication(
  db: PrismaClient,
  email: string,
  config: WebAuthnConfig,
  response: AuthenticationResponseJSON,
): Promise<{ verified: true; userId: string }> {
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, webAuthnChallenge: true },
  });
  if (!user || !user.webAuthnChallenge) {
    throw new WebAuthnError("No authentication in progress", 400);
  }

  const credentialRow = await db.userCredential.findUnique({
    where: { id: response.id },
  });
  if (!credentialRow || credentialRow.userId !== user.id) {
    throw new WebAuthnError("Unknown credential", 400);
  }

  let verification;
  try {
    verification = await verifyAuthentication(
      config,
      response,
      user.webAuthnChallenge,
      toStoredCredential(credentialRow),
    );
  } catch (error) {
    throw new WebAuthnError(
      error instanceof Error ? error.message : "Authentication verification failed",
      400,
    );
  }

  if (!verification.verified) {
    throw new WebAuthnError("Authentication could not be verified", 400);
  }

  // Rotate the signature counter and clear the one-time challenge.
  await db.userCredential.update({
    where: { id: credentialRow.id },
    data: { counter: BigInt(verification.authenticationInfo.newCounter) },
  });
  await db.user.update({
    where: { id: user.id },
    data: { webAuthnChallenge: null },
  });

  return { verified: true, userId: user.id };
}

export interface PasskeySummary {
  id: string;
  name: string | null;
  transports: string | null;
  createdAt: Date | null;
}

/** List a user's enrolled passkeys for account-settings management (newest first). */
export async function listUserPasskeys(
  db: PrismaClient,
  userId: string,
): Promise<PasskeySummary[]> {
  const rows = await db.userCredential.findMany({
    where: { userId },
    select: { id: true, name: true, transports: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? null,
    transports: row.transports ?? null,
    createdAt: row.createdAt ?? null,
  }));
}

/**
 * Remove one of a user's passkeys. Scoped by userId so a posted credential id
 * cannot delete another user's passkey. Returns whether a row was removed.
 */
export async function removeUserPasskey(
  db: PrismaClient,
  userId: string,
  credentialId: string,
): Promise<{ removed: boolean }> {
  const result = await db.userCredential.deleteMany({
    where: { id: credentialId, userId },
  });
  return { removed: result.count > 0 };
}

/**
 * Rename one of a user's passkeys. Scoped by userId so a posted credential id
 * cannot rename another user's passkey. A blank label clears the name (the row
 * falls back to a generic label in the UI). Returns whether a row was updated.
 */
export async function renameUserPasskey(
  db: PrismaClient,
  userId: string,
  credentialId: string,
  name: string,
): Promise<{ renamed: boolean }> {
  const trimmedName = name.trim();
  const result = await db.userCredential.updateMany({
    where: { id: credentialId, userId },
    data: { name: trimmedName || null },
  });
  return { renamed: result.count > 0 };
}

/**
 * Derive WebAuthn config (rpID + origin) for the request. The RP ID and origin
 * MUST match the host the browser is actually on. The public domain fronts the
 * worker, so `request.url` is the internal `*.workers.dev` host — using it
 * produces an RP ID the browser rejects ("RP ID … is invalid for this domain").
 * `requestCanonicalOrigin` resolves the forwarded public host (spoonjoy.app in
 * prod, localhost in dev), which is the same origin the OAuth callbacks use.
 */
export function configFromRequest(request: Request): WebAuthnConfig {
  const origin = requestCanonicalOrigin(request);
  return {
    rpName: "Spoonjoy",
    rpID: new URL(origin).hostname,
    origin,
  };
}
