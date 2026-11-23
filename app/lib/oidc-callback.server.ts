/**
 * What a verified OpenID Connect sign-in does to Spoonjoy accounts. The rules are GitHub's and
 * Google's (oauth-user.server.ts): a returning provider identity signs in to its account; a new
 * one links to an existing account only by an email both sides have verified; otherwise it makes a
 * new account, which a self-hosted server's account-creation gate must let in.
 */

import type { PrismaClient } from "@prisma/client";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import type { ServerAccessEnv } from "~/lib/server-access.server";
import type { OidcUser } from "./oidc.server";
import {
  createOAuthUser,
  findExistingOAuthAccount,
  linkOAuthAccount,
  linkOAuthAccountByVerifiedEmail,
  markEmailVerifiedByProvider,
} from "./oauth-user.server";

export interface OidcOAuthCallbackParams {
  db: PrismaClient;
  /** The request's D1 binding: a new user and its OAuth link are then written as one atomic batch */
  d1?: D1ReadDatabase | null;
  /** The Worker's settings: on a self-hosted server a new account must pass its account-creation gate */
  env?: ServerAccessEnv | null;
  /** The invite link sign-up started from, which lets a new account onto an invite-only server */
  inviteToken?: string | null;
  /** The OAuth table's provider for this issuer (oidcProviderKey). */
  provider: string;
  oidcUser: OidcUser;
  currentUserId?: string | null;
  redirectTo?: string | null;
}

export interface OidcOAuthCallbackResult {
  success: boolean;
  userId?: string;
  action?: "user_created" | "user_logged_in" | "account_linked";
  redirectTo: string;
  error?: string;
  message?: string;
}

export async function handleOidcOAuthCallback(params: OidcOAuthCallbackParams): Promise<OidcOAuthCallbackResult> {
  const { db, d1 = null, env = null, inviteToken = null, provider, oidcUser, currentUserId } = params;
  const redirectTo = params.redirectTo ?? "/recipes";
  const link = { provider, providerUserId: oidcUser.id, providerUsername: oidcUser.username };

  if (currentUserId) {
    const linkResult = await linkOAuthAccount(db, currentUserId, link);
    if (!linkResult.success) {
      return { success: false, error: linkResult.error, message: linkResult.message, redirectTo };
    }
    await markEmailVerifiedByProvider(db, currentUserId, oidcUser.email, oidcUser.emailVerified);
    return { success: true, userId: currentUserId, action: "account_linked", redirectTo };
  }

  const existing = await findExistingOAuthAccount(db, provider, oidcUser.id);
  if (existing) {
    await markEmailVerifiedByProvider(db, existing.userId, oidcUser.email, oidcUser.emailVerified);
    return { success: true, userId: existing.userId, action: "user_logged_in", redirectTo };
  }

  if (oidcUser.email && oidcUser.emailVerified) {
    const restored = await linkOAuthAccountByVerifiedEmail(db, {
      ...link,
      email: oidcUser.email,
      emailVerified: true,
    });
    if (restored.success && restored.userId) {
      return { success: true, userId: restored.userId, action: "account_linked", redirectTo };
    }
    if (restored.error !== "account_not_found") {
      return { success: false, error: restored.error, message: restored.message, redirectTo };
    }
  }

  const created = await createOAuthUser(db, {
    ...link,
    email: oidcUser.email,
    name: oidcUser.name ?? oidcUser.username,
    emailVerified: oidcUser.emailVerified,
  }, d1, env, inviteToken);
  if (!created.success || !created.user) {
    return { success: false, error: created.error, message: created.message, redirectTo };
  }
  return { success: true, userId: created.user.id, action: "user_created", redirectTo };
}
