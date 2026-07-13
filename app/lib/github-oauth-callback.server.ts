/**
 * GitHub OAuth callback handling.
 */

import type { PrismaClient } from "@prisma/client";
import type { GitHubUser } from "./github-oauth.server";
import {
  createOAuthUser,
  findExistingOAuthAccount,
  linkOAuthAccount,
  linkOAuthAccountByVerifiedEmail,
} from "./oauth-user.server";

export interface GitHubOAuthCallbackParams {
  db: PrismaClient;
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
  const { db, githubUser, currentUserId } = params;
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

    return {
      success: true,
      userId: currentUserId,
      action: "account_linked",
      redirectTo,
    };
  }

  const existingOAuthAccount = await findExistingOAuthAccount(db, "github", githubUser.id);
  if (existingOAuthAccount) {
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
  });

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
