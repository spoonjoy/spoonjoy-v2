/**
 * Apple OAuth callback handler.
 *
 * Orchestrates the full OAuth callback flow including:
 * - User creation (new OAuth user)
 * - Returning user login
 * - Account linking (existing user)
 * - Redirect logic
 */

import type { PrismaClient } from "@prisma/client";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import type { AppleUser } from "./apple-oauth.server";
import {
  createOAuthUser,
  findExistingOAuthAccount,
  linkOAuthAccount,
  markEmailVerifiedByProvider,
} from "./oauth-user.server";

/**
 * Parameters for handling Apple OAuth callback.
 */
export interface AppleOAuthCallbackParams {
  /** Prisma database client */
  db: PrismaClient;
  /** The request's D1 binding: a new user and its OAuth link are then written as one atomic batch */
  d1?: D1ReadDatabase | null;
  /** Apple user data from verified callback */
  appleUser: AppleUser;
  /** Current logged-in user ID (null if not logged in) */
  currentUserId: string | null;
  /** Where to redirect after successful auth */
  redirectTo: string | null;
}

/**
 * Actions that can result from the callback.
 */
export type AppleOAuthCallbackAction =
  | "user_created"
  | "user_logged_in"
  | "account_linked";

/**
 * Result of handling Apple OAuth callback.
 */
export interface AppleOAuthCallbackResult {
  success: boolean;
  /** The user ID (for session creation) */
  userId?: string;
  /** What action was performed */
  action?: AppleOAuthCallbackAction;
  /** Where to redirect */
  redirectTo: string;
  /** Error code on failure */
  error?: string;
  /** Error message on failure */
  message?: string;
}

/**
 * Handles Apple OAuth callback after token verification.
 *
 * Flow:
 * 1. If user is logged in (currentUserId): Link Apple account to existing user
 * 2. If Apple account exists in DB: Log in returning user
 * 3. If email exists in DB: Error (user should log in to link)
 * 4. Otherwise: Create new user
 *
 * @param params - Callback parameters
 * @returns Result with userId on success, or error details on failure
 */
export async function handleAppleOAuthCallback(
  params: AppleOAuthCallbackParams
): Promise<AppleOAuthCallbackResult> {
  const { db, d1 = null, appleUser, currentUserId, redirectTo } = params;

  // Default redirect destination
  const defaultRedirect = redirectTo ?? "/";

  // Flow 1: User is logged in - link Apple account to existing user
  if (currentUserId) {
    const linkResult = await linkOAuthAccount(db, currentUserId, {
      provider: "apple",
      providerUserId: appleUser.id,
      providerUsername: appleUser.fullName ?? appleUser.email,
    });

    if (!linkResult.success) {
      return {
        success: false,
        error: linkResult.error,
        message: linkResult.message,
        redirectTo: defaultRedirect,
      };
    }

    await markEmailVerifiedByProvider(db, currentUserId, appleUser.email, appleUser.emailVerified);

    return {
      success: true,
      userId: currentUserId,
      action: "account_linked",
      redirectTo: defaultRedirect,
    };
  }

  // Flow 2: Check if Apple account already exists (returning user)
  const existingOAuthAccount = await findExistingOAuthAccount(
    db,
    "apple",
    appleUser.id
  );

  if (existingOAuthAccount) {
    return {
      success: true,
      userId: existingOAuthAccount.userId,
      action: "user_logged_in",
      redirectTo: defaultRedirect,
    };
  }

  // Flow 3: Check if email exists (case-insensitive)
  // Use raw SQL for case-insensitive email comparison in SQLite
  const normalizedEmail = appleUser.email.toLowerCase();
  const existingUsersByEmail = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM User WHERE LOWER(email) = ${normalizedEmail}
  `;

  if (existingUsersByEmail.length > 0) {
    return {
      success: false,
      error: "account_exists",
      message:
        "An account with this email already exists. Please log in to link your Apple account.",
      redirectTo: defaultRedirect,
    };
  }

  // Flow 4: Create new user
  const createResult = await createOAuthUser(db, {
    provider: "apple",
    providerUserId: appleUser.id,
    providerUsername: appleUser.fullName ?? appleUser.email,
    email: appleUser.email,
    name: appleUser.fullName,
    emailVerified: appleUser.emailVerified,
  }, d1);

  if (!createResult.success) {
    return {
      success: false,
      error: createResult.error,
      message: createResult.message,
      redirectTo: defaultRedirect,
    };
  }

  return {
    success: true,
    userId: createResult.user!.id,
    action: "user_created",
    redirectTo: defaultRedirect,
  };
}
