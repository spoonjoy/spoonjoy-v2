/**
 * Google OAuth callback handler.
 *
 * Orchestrates the full OAuth callback flow including:
 * - User creation (new OAuth user)
 * - Returning user login
 * - Account linking (existing user)
 * - Redirect logic
 */

import type { PrismaClient } from "@prisma/client";
import type { GoogleUser } from "./google-oauth.server";
import {
  createOAuthUser,
  findExistingOAuthAccount,
  linkOAuthAccount,
  linkOAuthAccountByVerifiedEmail,
} from "./oauth-user.server";

/**
 * Parameters for handling Google OAuth callback.
 */
export interface GoogleOAuthCallbackParams {
  /** Prisma database client */
  db: PrismaClient;
  /** Google user data from verified callback */
  googleUser: GoogleUser;
  /** Current logged-in user ID (null if not logged in) */
  currentUserId: string | null;
  /** Where to redirect after successful auth */
  redirectTo: string | null;
}

/**
 * Actions that can result from the callback.
 */
export type GoogleOAuthCallbackAction =
  | "user_created"
  | "user_logged_in"
  | "account_linked";

/**
 * Result of handling Google OAuth callback.
 */
export interface GoogleOAuthCallbackResult {
  success: boolean;
  /** The user ID (for session creation) */
  userId?: string;
  /** What action was performed */
  action?: GoogleOAuthCallbackAction;
  /** Where to redirect */
  redirectTo: string;
  /** Error code on failure */
  error?: string;
  /** Error message on failure */
  message?: string;
}

/**
 * Handles Google OAuth callback after token verification.
 *
 * Flow:
 * 1. If user is logged in (currentUserId): Link Google account to existing user
 * 2. If Google account exists in DB: Log in returning user
 * 3. If verified email exists in DB: Restore the missing Google OAuth link
 * 4. Otherwise: Create new user
 *
 * @param params - Callback parameters
 * @returns Result with userId on success, or error details on failure
 */
export async function handleGoogleOAuthCallback(
  params: GoogleOAuthCallbackParams
): Promise<GoogleOAuthCallbackResult> {
  const { db, googleUser, currentUserId, redirectTo } = params;

  // Default redirect destination
  const defaultRedirect = redirectTo ?? "/";

  // Flow 1: User is logged in - link Google account to existing user
  if (currentUserId) {
    const linkResult = await linkOAuthAccount(db, currentUserId, {
      provider: "google",
      providerUserId: googleUser.id,
      providerUsername: googleUser.name ?? googleUser.email,
    });

    if (!linkResult.success) {
      return {
        success: false,
        error: linkResult.error,
        message: linkResult.message,
        redirectTo: defaultRedirect,
      };
    }

    return {
      success: true,
      userId: currentUserId,
      action: "account_linked",
      redirectTo: defaultRedirect,
    };
  }

  // Flow 2: Check if Google account already exists (returning user)
  const existingOAuthAccount = await findExistingOAuthAccount(
    db,
    "google",
    googleUser.id
  );

  if (existingOAuthAccount) {
    return {
      success: true,
      userId: existingOAuthAccount.userId,
      action: "user_logged_in",
      redirectTo: defaultRedirect,
    };
  }

  if (!googleUser.emailVerified) {
    return {
      success: false,
      error: "email_unverified",
      message: "Google must return a verified email address before Spoonjoy can use it for sign-in.",
      redirectTo: defaultRedirect,
    };
  }

  // Flow 3: Restore a missing OAuth row for a migrated/existing account when
  // Google returns the same verified email and no other user owns this Google id.
  const restoredLink = await linkOAuthAccountByVerifiedEmail(db, {
    provider: "google",
    providerUserId: googleUser.id,
    providerUsername: googleUser.name ?? googleUser.email,
    email: googleUser.email,
    emailVerified: googleUser.emailVerified,
  });

  if (restoredLink.success && restoredLink.userId) {
    return {
      success: true,
      userId: restoredLink.userId,
      action: "account_linked",
      redirectTo: defaultRedirect,
    };
  }

  if (restoredLink.error !== "account_not_found") {
    return {
      success: false,
      error: restoredLink.error,
      message: restoredLink.message,
      redirectTo: defaultRedirect,
    };
  }

  // Flow 4: Create new user
  const createResult = await createOAuthUser(db, {
    provider: "google",
    providerUserId: googleUser.id,
    providerUsername: googleUser.name ?? googleUser.email,
    email: googleUser.email,
    name: googleUser.name,
  });

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
