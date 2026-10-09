/**
 * GitHub OAuth callback handling.
 */

import type { PrismaClient } from "@prisma/client";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import type { GitHubUser } from "./github-oauth.server";
import {
  createOAuthUser,
  findExistingOAuthAccount,
  linkOAuthAccount,
  markEmailVerifiedByProvider,
  linkOAuthAccountByVerifiedEmail,
} from "./oauth-user.server";

export interface GitHubOAuthCallbackParams {
  db: PrismaClient;
  /** The request's D1 binding: a new user and its OAuth link are then written as one atomic batch */
  d1?: D1ReadDatabase | null;
  githubUser: GitHubUser;
  currentUserId?: string | null;
  redirectTo?: string | null;
}

export type GitHubOAuthCallbackAction =
  | "user_created"
  | "user_logged_in"
  | "account_linked";

export interface GitHubOAuthCallbackResult {
  success: boolean;
  userId?: string;
  action?: GitHubOAuthCallbackAction;
  redirectTo: string;
  error?: string;
  message?: string;
}

export async function handleGitHubOAuthCallback(
  params: GitHubOAuthCallbackParams
): Promise<GitHubOAuthCallbackResult> {
  const { db, d1 = null, githubUser, currentUserId } = params;
  const redirectTo = params.redirectTo ?? "/recipes";

  if (currentUserId) {
    const linkResult = await linkOAuthAccount(db, currentUserId, {
      provider: "github",
      providerUserId: githubUser.id,
      providerUsername: githubUser.login,
    });

    if (!linkResult.success) {
      return {
        success: false,
        error: linkResult.error,
        message: linkResult.message,
        redirectTo,
      };
    }

    await markEmailVerifiedByProvider(db, currentUserId, githubUser.email, githubUser.emailVerified);

    return {
      success: true,
      userId: currentUserId,
      action: "account_linked",
      redirectTo,
    };
  }

  const existingOAuthAccount = await findExistingOAuthAccount(db, "github", githubUser.id);
  if (existingOAuthAccount) {
    // A returning sign-in whose provider vouches for the account's own address verifies it, so
    // accounts made before verification existed become verified as people sign in.
    await markEmailVerifiedByProvider(db, existingOAuthAccount.userId, githubUser.email, githubUser.emailVerified);
    return {
      success: true,
      userId: existingOAuthAccount.userId,
      action: "user_logged_in",
      redirectTo,
    };
  }

  if (githubUser.email && githubUser.emailVerified) {
    const restoredLink = await linkOAuthAccountByVerifiedEmail(db, {
      provider: "github",
      providerUserId: githubUser.id,
      providerUsername: githubUser.login,
      email: githubUser.email,
      emailVerified: githubUser.emailVerified,
    });

    if (restoredLink.success && restoredLink.userId) {
      return {
        success: true,
        userId: restoredLink.userId,
        action: "account_linked",
        redirectTo,
      };
    }

    if (restoredLink.error !== "account_not_found") {
      return {
        success: false,
        error: restoredLink.error,
        message: restoredLink.message,
        redirectTo,
      };
    }
  }

  const createResult = await createOAuthUser(db, {
    provider: "github",
    providerUserId: githubUser.id,
    providerUsername: githubUser.login,
    email: githubUser.email,
    name: githubUser.name ?? githubUser.login,
    emailVerified: githubUser.emailVerified,
  }, d1);

  if (!createResult.success || !createResult.user) {
    return {
      success: false,
      error: createResult.error,
      message: createResult.message,
      redirectTo,
    };
  }

  return {
    success: true,
    userId: createResult.user.id,
    action: "user_created",
    redirectTo,
  };
}
