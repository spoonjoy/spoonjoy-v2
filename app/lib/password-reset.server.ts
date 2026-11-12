import { Buffer } from "node:buffer";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { hashPassword } from "~/lib/auth.server";
import { revokeAllAccountAccess } from "~/lib/account-revocation.server";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { retryD1Write } from "~/lib/d1-write-retry.server";
import { canSendAccountEmail, sendTransactionalEmail, type TransactionalEmailEnv } from "~/lib/transactional-email.server";
import { captureEvent, resolvePostHogServerConfig, type PostHogServerEnv } from "~/lib/analytics-server";
import { PASSWORD_MIN_LENGTH } from "~/lib/password-policy";

export { PASSWORD_MIN_LENGTH };

// Forgot-password links. A link is a random token sent to the account's address; only the SHA-256
// of the token is stored, in AccountEmailToken with purpose "reset_password" (migration 0029). A
// link works once, for PASSWORD_RESET_TTL_MS, and stops working when it is used, when a newer link
// is sent, when the account's password is set, changed or removed, or when the account's email
// changes. Using one sets the new password and signs the account out everywhere, the way "Sign out
// everywhere" does.

export const PASSWORD_RESET_PURPOSE = "reset_password";
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
/** Reset mails one account can be sent per PASSWORD_RESET_WINDOW_MS, so the form can't mail-bomb anyone. */
export const PASSWORD_RESET_MAX_PER_WINDOW = 3;
export const PASSWORD_RESET_WINDOW_MS = 60 * 60 * 1000;

type Database = PrismaClientType;

/** True when this environment can mail a reset link, so the flow is offered at all. */
export function passwordResetAvailable(env?: TransactionalEmailEnv | null): boolean {
  return canSendAccountEmail(env);
}

export function generatePasswordResetToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export async function hashPasswordResetToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Buffer.from(digest).toString("hex");
}

export type PasswordResetRequestOutcome = "sent" | "no_account" | "throttled" | "send_failed";

/**
 * Mails a reset link to the account with this email, if there is one. The caller answers the same
 * way whatever this returns (and runs it after the response where it can), so the form never says
 * whether an address has an account.
 */
export async function requestPasswordReset(
  db: Database,
  env: TransactionalEmailEnv | null | undefined,
  email: string,
  now: Date = new Date(),
): Promise<PasswordResetRequestOutcome> {
  const normalized = email.trim().toLowerCase();
  const matches = await db.$queryRaw<Array<{ id: string; email: string }>>`
    SELECT "id", "email" FROM "User" WHERE LOWER("email") = ${normalized} LIMIT 2
  `;
  // Two accounts whose addresses differ only in case: mail neither rather than guess.
  if (matches.length !== 1) return "no_account";
  const user = matches[0];

  const recent = await db.accountEmailToken.count({
    where: {
      userId: user.id,
      purpose: PASSWORD_RESET_PURPOSE,
      createdAt: { gt: new Date(now.getTime() - PASSWORD_RESET_WINDOW_MS) },
    },
  });
  if (recent >= PASSWORD_RESET_MAX_PER_WINDOW) return "throttled";

  // Only the newest link works.
  await invalidatePasswordResetTokens(db, user.id, now);

  const token = generatePasswordResetToken();
  const tokenHash = await hashPasswordResetToken(token);
  await retryD1Write(
    {
      scope: "password_reset.create",
      applied: async () => ((await db.accountEmailToken.findUnique({ where: { tokenHash }, select: { id: true } })) ? true : null),
    },
    async () => {
      await db.accountEmailToken.create({
        data: {
          userId: user.id,
          purpose: PASSWORD_RESET_PURPOSE,
          tokenHash,
          email: user.email,
          expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
          createdAt: now,
        },
      });
      return true;
    },
  );

  const baseUrl = env?.SPOONJOY_BASE_URL?.trim() || "https://spoonjoy.app";
  const link = `${baseUrl}/reset-password?token=${token}`;
  try {
    await sendTransactionalEmail(db, env, {
      to: user.email,
      purpose: "reset_password",
      subject: "Reset your Spoonjoy password",
      text: [
        "Someone asked to reset the password for your Spoonjoy account. If it was you, choose a new password here:",
        link,
        "The link works once, for the next 30 minutes. Resetting your password signs you out on every other device and disconnects apps, agents and API tokens.",
        "If you didn't ask for this, ignore this email; your password stays as it is.",
      ].join("\n\n"),
    });
  } catch {
    // Mail refused (already recorded by sendTransactionalEmail). The person sees the same answer
    // either way and can ask again.
    return "send_failed";
  }
  return "sent";
}

/**
 * Ends the account's unused reset links after a password set, change or removal that has already
 * been written. Best effort: the password change stands even if this write fails, so a failure is
 * recorded rather than turned into an error for a change that happened.
 */
export async function endPasswordResetLinksAfterPasswordChange(
  db: Database,
  userId: string,
  env: PostHogServerEnv | null | undefined,
): Promise<void> {
  try {
    await invalidatePasswordResetTokens(db, userId);
  } catch (error) {
    await recordPasswordResetEvent(env, "spoonjoy.password_reset.invalidate_failed", {
      error_name: errorName(error),
    });
  }
}

/**
 * Runs `requestPasswordReset` for the forgot-password form and records its outcome, never throwing.
 * The event carries the outcome and, on a failure, the error's class name, never the address, so a
 * broken mailer shows up without leaking who asked.
 */
export async function requestPasswordResetAndRecord(
  db: Promise<Database>,
  env: TransactionalEmailEnv | null | undefined,
  email: string,
): Promise<void> {
  try {
    const outcome = await requestPasswordReset(await db, env, email);
    await recordPasswordResetEvent(env, "spoonjoy.password_reset.requested", { outcome });
  } catch (error) {
    await recordPasswordResetEvent(env, "spoonjoy.password_reset.requested", {
      outcome: "error",
      error_name: errorName(error),
    });
  }
}

/** An error's class name for telemetry, never its message (which can hold an address). */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** A password-reset event in PostHog, with no address and no token. */
export async function recordPasswordResetEvent(
  env: PostHogServerEnv | null | undefined,
  event: string,
  properties: Record<string, string>,
): Promise<void> {
  if (!env) return;
  await captureEvent(resolvePostHogServerConfig(env), { event, distinctId: "system", properties });
}

/** Ends every reset link the account has not used yet. Called on any password change. */
export async function invalidatePasswordResetTokens(db: Database, userId: string, now: Date = new Date()): Promise<void> {
  await retryD1Write({ scope: "password_reset.invalidate" }, () => db.accountEmailToken.updateMany({
    where: { userId, purpose: PASSWORD_RESET_PURPOSE, usedAt: null },
    data: { usedAt: now },
  }));
}

interface ValidResetToken {
  id: string;
  userId: string;
  email: string;
}

/** The reset link's row when it can still be used, else null. Does not use it up. */
export async function findUsablePasswordResetToken(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<ValidResetToken | null> {
  if (!token) return null;
  const row = await db.accountEmailToken.findUnique({
    where: { tokenHash: await hashPasswordResetToken(token) },
    select: { id: true, userId: true, email: true, purpose: true, usedAt: true, expiresAt: true, user: { select: { email: true } } },
  });
  if (!row || row.purpose !== PASSWORD_RESET_PURPOSE || row.usedAt || row.expiresAt.getTime() <= now.getTime()) return null;
  // The link was sent to an address the account no longer has.
  if (row.user.email.toLowerCase() !== row.email.toLowerCase()) return null;
  return { id: row.id, userId: row.userId, email: row.email };
}

export type PasswordResetFieldErrors = { password?: string; confirmPassword?: string };

export function validateNewPassword(password: string, confirmPassword: string): PasswordResetFieldErrors | null {
  if (!password) return { password: "Enter a new password" };
  if (password.length < PASSWORD_MIN_LENGTH) return { password: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  if (password !== confirmPassword) return { confirmPassword: "Passwords do not match" };
  return null;
}

export type PasswordResetResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid_token" }
  | { ok: false; reason: "invalid_password"; fieldErrors: PasswordResetFieldErrors };

/**
 * Uses a reset link: spends the token (so a second use, even a concurrent one, fails), then sets
 * the password and revokes every session and bearer credential in one atomic step. The person
 * proved they read mail at the account's address, so the address is marked verified.
 */
export async function resetPasswordWithToken(
  db: Database,
  input: { token: string; password: string; confirmPassword: string; d1?: D1ReadDatabase | null; now?: Date },
): Promise<PasswordResetResult> {
  const now = input.now ?? new Date();
  const usable = await findUsablePasswordResetToken(db, input.token, now);
  if (!usable) return { ok: false, reason: "invalid_token" };

  const fieldErrors = validateNewPassword(input.password, input.confirmPassword);
  if (fieldErrors) return { ok: false, reason: "invalid_password", fieldErrors };

  const claimed = await retryD1Write(
    {
      scope: "password_reset.claim",
      applied: async () => {
        const row = await db.accountEmailToken.findUnique({ where: { id: usable.id }, select: { usedAt: true } });
        return row?.usedAt?.getTime() === now.getTime() ? true : null;
      },
    },
    async () => (await db.accountEmailToken.updateMany({
      where: { id: usable.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    })).count === 1,
  );
  if (!claimed) return { ok: false, reason: "invalid_token" };

  const password = await hashPassword(input.password);
  await revokeAllAccountAccess(db, usable.userId, { d1: input.d1, password, now });
  await invalidatePasswordResetTokens(db, usable.userId, now);
  await retryD1Write({ scope: "password_reset.verify_email" }, () => db.user.updateMany({
    where: { id: usable.userId, email: usable.email, emailVerifiedAt: null },
    data: { emailVerifiedAt: now },
  }));
  return { ok: true, userId: usable.userId };
}
