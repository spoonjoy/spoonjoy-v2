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
import type { AuthTelemetry } from "~/lib/auth-telemetry.server";
import { requestCanonicalOrigin } from "~/lib/canonical-host.server";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Guard, d1Timestamp, d1WriteBatch, isD1GuardFailure } from "~/lib/d1-write.server";

const WEBAUTHN_FAILURE_EVENT = "spoonjoy.webauthn.failure";

export class WebAuthnError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "WebAuthnError";
    this.status = status;
  }
}

type WebAuthnPhase =
  | "register_options"
  | "register_verify"
  | "authenticate_options"
  | "authenticate_verify";

/**
 * Capture an unexpected WebAuthn failure. `WebAuthnError` instances are
 * intentional client errors (missing user/challenge, unknown credential,
 * verification declined) — those are surfaced as `spoonjoy.webauthn.failure`
 * events by the verify paths, not as exceptions — so they are skipped here to
 * avoid burying real infra faults (D1 read/write failures, crypto crashes).
 */
function captureWebAuthnUnexpected(
  telemetry: AuthTelemetry | undefined,
  error: unknown,
  phase: WebAuthnPhase,
  distinctId: string,
) {
  if (!telemetry || error instanceof WebAuthnError) return;
  telemetry.captureException(error, { surface: "webauthn", phase, distinct_id: distinctId });
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
  telemetry?: AuthTelemetry,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  try {
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
  } catch (error) {
    // A missing-user 404 is an expected client error; anything else (a D1 read/
    // write failure, options-builder crash) is an infra fault that would
    // otherwise vanish behind a generic 400/404.
    captureWebAuthnUnexpected(telemetry, error, "register_options", userId);
    throw error;
  }
}

export async function finishRegistration(
  db: PrismaClient,
  userId: string,
  config: WebAuthnConfig,
  response: RegistrationResponseJSON,
  name?: string | null,
  telemetry?: AuthTelemetry,
): Promise<{ verified: true; credentialId: string }> {
  let user;
  try {
    user = await db.user.findUnique({
      where: { id: userId },
      select: { webAuthnChallenge: true },
    });
  } catch (error) {
    captureWebAuthnUnexpected(telemetry, error, "register_verify", userId);
    throw error;
  }
  if (!user) throw new WebAuthnError("User not found", 404);
  if (!user.webAuthnChallenge) {
    throw new WebAuthnError("No registration in progress", 400);
  }

  let verification;
  try {
    verification = await verifyRegistration(config, response, user.webAuthnChallenge);
  } catch (error) {
    // A thrown verification (bad attestation, RP-ID/origin mismatch) collapses
    // to a 400 with no detail — capture the original cause so a systematic
    // attestation/config regression is visible.
    telemetry?.captureEvent(WEBAUTHN_FAILURE_EVENT, userId, {
      surface: "webauthn",
      phase: "register_verify",
      outcome: "verify_threw",
    });
    captureWebAuthnUnexpected(telemetry, error, "register_verify", userId);
    throw new WebAuthnError(
      error instanceof Error ? error.message : "Registration verification failed",
      400,
    );
  }

  const credential = credentialFromRegistration(verification);
  if (!credential) {
    // verifyRegistration resolved but produced no usable credential — a
    // declined registration. Surface it distinctly from a thrown verification.
    telemetry?.captureEvent(WEBAUTHN_FAILURE_EVENT, userId, {
      surface: "webauthn",
      phase: "register_verify",
      outcome: "unverified",
    });
    throw new WebAuthnError("Registration could not be verified", 400);
  }

  // Copy into a fresh ArrayBuffer-backed view so it satisfies Prisma's
  // `Bytes` typing (`Uint8Array<ArrayBuffer>`).
  const publicKey = new Uint8Array(credential.publicKey);

  // Persist (upsert so re-registering the same authenticator is idempotent),
  // then clear the one-time challenge.
  const trimmedName = typeof name === "string" ? name.trim() : "";
  try {
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
  } catch (error) {
    // The passkey verified but persisting it (or clearing the challenge) failed
    // — a silent data-layer fault that strands the user mid-enrollment.
    captureWebAuthnUnexpected(telemetry, error, "register_verify", userId);
    throw error;
  }

  return { verified: true, credentialId: credential.id };
}

export async function startAuthentication(
  db: PrismaClient,
  email: string,
  config: WebAuthnConfig,
  telemetry?: AuthTelemetry,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  try {
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
  } catch (error) {
    // A D1 read/write fault or options-builder crash here otherwise collapses
    // to a generic 400 — capture so the data-layer failure is visible. Distinct
    // id is the email (a login attempt has no user id yet).
    captureWebAuthnUnexpected(telemetry, error, "authenticate_options", email);
    throw error;
  }
}

interface SignInWrite {
  userId: string;
  credentialId: string;
  /** The exact challenge the assertion was verified against. */
  challenge: string;
  newCounter: number;
}

/**
 * The counter rule from WebAuthn: a signature counter only moves forward, except that an
 * authenticator that does not count reports 0 every time.
 */
const COUNTER_ADVANCES = `("counter" < ? OR (? = 0 AND "counter" = 0))`;

/**
 * One D1 batch, so the counter rotation and the challenge clear apply together or not at
 * all. The guards stop the batch when the challenge was already consumed (or replaced) or
 * the stored counter has caught up with this assertion's; returns false then.
 */
async function completeSignInOnD1(d1: D1ReadDatabase, write: SignInWrite): Promise<boolean> {
  try {
    await d1WriteBatch(d1, [
      d1Guard(`EXISTS (SELECT 1 FROM "User" WHERE "id" = ? AND "webAuthnChallenge" = ?)`, write.userId, write.challenge),
      d1Guard(
        `EXISTS (SELECT 1 FROM "UserCredential" WHERE "id" = ? AND "userId" = ? AND ${COUNTER_ADVANCES})`,
        write.credentialId,
        write.userId,
        write.newCounter,
        write.newCounter,
      ),
      [`UPDATE "UserCredential" SET "counter" = ? WHERE "id" = ?`, write.newCounter, write.credentialId],
      [
        `UPDATE "User" SET "webAuthnChallenge" = NULL, "updatedAt" = ? WHERE "id" = ? AND "webAuthnChallenge" = ?`,
        d1Timestamp(new Date()),
        write.userId,
        write.challenge,
      ],
    ]);
    return true;
  } catch (error) {
    if (isD1GuardFailure(error)) return false;
    throw error;
  }
}

/**
 * Without a D1 binding (unit tests, scripts) the two writes cannot share a transaction.
 * Each is conditional on the same rules, and the challenge is consumed first, so a
 * failure in between leaves the challenge spent and the sign-in failed rather than a
 * challenge that can be presented again.
 */
async function completeSignInWithPrisma(db: PrismaClient, write: SignInWrite): Promise<boolean> {
  const consumed = await db.user.updateMany({
    where: { id: write.userId, webAuthnChallenge: write.challenge },
    data: { webAuthnChallenge: null },
  });
  if (consumed.count !== 1) return false;
  const rotated = await db.userCredential.updateMany({
    where: {
      id: write.credentialId,
      userId: write.userId,
      counter: write.newCounter === 0 ? 0n : { lt: BigInt(write.newCounter) },
    },
    data: { counter: BigInt(write.newCounter) },
  });
  return rotated.count === 1;
}

export async function finishAuthentication(
  db: PrismaClient,
  email: string,
  config: WebAuthnConfig,
  response: AuthenticationResponseJSON,
  telemetry?: AuthTelemetry,
  d1?: D1ReadDatabase | null,
): Promise<{ verified: true; userId: string; sessionVersion: number }> {
  let user;
  let credentialRow;
  try {
    // sessionVersion is read with the challenge, so the session minted for this
    // sign-in cannot pick up a version bumped while the assertion is verified.
    user = await db.user.findUnique({
      where: { email },
      select: { id: true, webAuthnChallenge: true, sessionVersion: true },
    });
    if (!user || !user.webAuthnChallenge) {
      throw new WebAuthnError("No authentication in progress", 400);
    }

    credentialRow = await db.userCredential.findUnique({
      where: { id: response.id },
    });
  } catch (error) {
    captureWebAuthnUnexpected(telemetry, error, "authenticate_verify", email);
    throw error;
  }
  if (!credentialRow || credentialRow.userId !== user.id) {
    throw new WebAuthnError("Unknown credential", 400);
  }

  const distinctId = user.id;
  let verification;
  try {
    verification = await verifyAuthentication(
      config,
      response,
      user.webAuthnChallenge,
      toStoredCredential(credentialRow),
    );
  } catch (error) {
    // A thrown verification (signature-counter regression, RP-ID/origin
    // mismatch, malformed assertion) collapses to a generic 400 with no
    // telemetry — capture the original cause so an attack or config regression
    // is visible, and emit a distinct failure event.
    telemetry?.captureEvent(WEBAUTHN_FAILURE_EVENT, distinctId, {
      surface: "webauthn",
      phase: "authenticate_verify",
      outcome: "verify_threw",
    });
    captureWebAuthnUnexpected(telemetry, error, "authenticate_verify", distinctId);
    throw new WebAuthnError(
      error instanceof Error ? error.message : "Authentication verification failed",
      400,
    );
  }

  if (!verification.verified) {
    // verifyAuthentication resolved but reported the assertion as not verified —
    // distinct from a thrown verification, and equally invisible otherwise.
    telemetry?.captureEvent(WEBAUTHN_FAILURE_EVENT, distinctId, {
      surface: "webauthn",
      phase: "authenticate_verify",
      outcome: "unverified",
    });
    throw new WebAuthnError("Authentication could not be verified", 400);
  }

  // Rotate the signature counter and consume the one-time challenge, only if the
  // challenge is still the one this assertion was verified against and the counter
  // still moves forward. Otherwise a concurrent submission of the same assertion (or
  // another sign-in with this authenticator) got there first: fail this sign-in.
  const signIn = {
    userId: user.id,
    credentialId: credentialRow.id,
    challenge: user.webAuthnChallenge,
    newCounter: verification.authenticationInfo.newCounter,
  };
  let applied: boolean;
  try {
    applied = d1 ? await completeSignInOnD1(d1, signIn) : await completeSignInWithPrisma(db, signIn);
  } catch (error) {
    // The assertion verified but rotating the counter / clearing the challenge
    // failed — a silent fault that can replay-block or strand the login.
    captureWebAuthnUnexpected(telemetry, error, "authenticate_verify", distinctId);
    throw error;
  }
  if (!applied) {
    telemetry?.captureEvent(WEBAUTHN_FAILURE_EVENT, distinctId, {
      surface: "webauthn",
      phase: "authenticate_verify",
      outcome: "challenge_or_counter_stale",
    });
    throw new WebAuthnError("Authentication could not be completed", 400);
  }

  return { verified: true, userId: user.id, sessionVersion: user.sessionVersion };
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
