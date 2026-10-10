import type { PrismaClient } from "@prisma/client";
import { verifyPassword } from "~/lib/auth.server";
import type { NativeAppleCredentialInput } from "~/lib/apple-native-auth.server";

// Proof that the person asking for a dangerous account change (deleting the account) is its owner
// right now, not someone holding a stolen session cookie or token:
// - an account with a password: the current password;
// - an account without one, on the web: a sign-in within the last RECENT_SIGN_IN_WINDOW_MS (the
//   session cookie records when the person signed in, see session.server.ts);
// - an account without one, in the iPhone app: a fresh Sign in with Apple credential for the
//   Apple ID linked to the account.

export const RECENT_SIGN_IN_WINDOW_MS = 10 * 60 * 1000;

export interface AccountOwnerProof {
  password?: string | null;
  /** A fresh native Sign in with Apple credential. */
  apple?: NativeAppleCredentialInput | null;
  /** When the session cookie's sign-in happened (ms since the epoch), for browser requests. */
  sessionAuthenticatedAt?: number | null;
}

export type AccountOwnerProofResult =
  | { ok: true; method: "password" | "apple" | "recent_sign_in" }
  | {
    ok: false;
    reason: "account_not_found" | "password_required" | "password_incorrect" | "apple_account_mismatch" | "recent_sign_in_required";
    message: string;
  };

export interface AccountOwnerProofDeps {
  /** Verifies a native Apple credential and returns the Apple user id (`sub`). Throws when invalid. */
  verifyAppleCredential?: (credential: NativeAppleCredentialInput) => Promise<string>;
  now?: () => number;
}

type ProofDb = Pick<PrismaClient, "user">;

export async function verifyAccountOwnerProof(
  db: ProofDb,
  userId: string,
  proof: AccountOwnerProof,
  deps: AccountOwnerProofDeps = {},
): Promise<AccountOwnerProofResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { hashedPassword: true, OAuth: { where: { provider: "apple" }, select: { providerUserId: true } } },
  });
  if (!user) return { ok: false, reason: "account_not_found", message: "Account not found." };

  if (user.hashedPassword) {
    if (!proof.password) {
      return { ok: false, reason: "password_required", message: "Enter your current password to confirm it's you." };
    }
    return (await verifyPassword(proof.password, user.hashedPassword))
      ? { ok: true, method: "password" }
      : { ok: false, reason: "password_incorrect", message: "That password isn't right." };
  }

  if (proof.apple && deps.verifyAppleCredential) {
    // Errors from the verifier (an expired or forged token) propagate to the caller.
    const appleUserId = await deps.verifyAppleCredential(proof.apple);
    return user.OAuth.some((link) => link.providerUserId === appleUserId)
      ? { ok: true, method: "apple" }
      : { ok: false, reason: "apple_account_mismatch", message: "That Apple ID isn't the one linked to this account." };
  }

  const now = (deps.now ?? Date.now)();
  const signedInAt = proof.sessionAuthenticatedAt;
  if (typeof signedInAt === "number" && signedInAt <= now && now - signedInAt <= RECENT_SIGN_IN_WINDOW_MS) {
    return { ok: true, method: "recent_sign_in" };
  }
  return {
    ok: false,
    reason: "recent_sign_in_required",
    message: "For your safety, sign in again, then delete your account within 10 minutes.",
  };
}
