import { findUsernameConflict } from "~/lib/account-identity.server";
import type { PrismaClient } from "@prisma/client";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Guard, d1Timestamp, d1WriteBatch, isD1GuardFailure } from "~/lib/d1-write.server";

export interface OAuthUserData {
  provider: string;
  providerUserId: string;
  providerUsername: string;
  email: string | null;
  name: string | null;
  // True when the provider vouches that the user owns `email` (Google's email_verified, GitHub's
  // verified primary address, Apple's email_verified). The new account starts verified then.
  emailVerified?: boolean;
}

export interface CreateOAuthUserResult {
  success: boolean;
  user?: {
    id: string;
    email: string;
    username: string;
  };
  error?: string;
  message?: string;
}

export interface ExistingOAuthAccount {
  userId: string;
  email: string;
  username: string;
  provider: string;
  providerUserId: string;
  providerUsername: string;
}

export interface LinkOAuthData {
  provider: string;
  providerUserId: string;
  providerUsername: string;
}

export interface LinkOAuthByEmailData extends LinkOAuthData {
  email: string;
  emailVerified: boolean;
}

export interface LinkOAuthResult {
  success: boolean;
  oauthRecord?: {
    provider: string;
    providerUserId: string;
    providerUsername: string;
  };
  userId?: string;
  error?: string;
  message?: string;
}

export interface UnlinkOAuthResult {
  success: boolean;
  unlinkedProvider?: {
    provider: string;
    providerUserId: string;
    providerUsername: string;
  };
  error?: string;
  message?: string;
}

/**
 * Generate a username from a name or email address.
 * Handles collisions by appending numbers.
 */
export async function generateUsername(
  db: PrismaClient,
  name: string | null,
  email: string | null
): Promise<string> {
  let baseUsername = "";

  // Try to derive username from name first
  const trimmedName = name?.trim();
  if (trimmedName) {
    // Lowercase, replace spaces with hyphens, remove special characters (keep only alphanumeric and hyphens)
    baseUsername = trimmedName
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }

  // Fall back to email local part if no usable name
  if (!baseUsername && email) {
    const localPart = email.split("@")[0];
    // Handle + in email (strip everything after +)
    const beforePlus = localPart.split("+")[0];
    // Replace dots with hyphens, remove special characters
    baseUsername = beforePlus
      .toLowerCase()
      .replace(/\./g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }

  // Random fallback if nothing else works
  if (!baseUsername) {
    baseUsername = `user-${Math.random().toString(36).substring(2, 10)}`;
  }

  // Check for collisions and append number if needed
  let candidate = baseUsername;
  let counter = 0;

  // Taken regardless of letter case, or another account's ID (account-identity.server.ts).
  while (true) {
    if (!(await findUsernameConflict(db, candidate))) {
      return candidate;
    }

    counter++;
    candidate = `${baseUsername}-${counter}`;
  }
}

/** A unique-constraint failure, from Prisma (P2002) or from a D1 batch. */
function isUniqueConflict(error: unknown): boolean {
  if (error && typeof error === "object" && (error as { code?: unknown }).code === "P2002") return true;
  const message = error instanceof Error ? error.message : "";
  return message.includes("UNIQUE constraint failed");
}

async function findUserIdByEmail(db: PrismaClient, normalizedEmail: string): Promise<string | null> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM User WHERE LOWER(email) = ${normalizedEmail} LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

const ACCOUNT_EXISTS: CreateOAuthUserResult = {
  success: false,
  error: "account_exists",
  message:
    "An account with this email already exists. Please log in to link your OAuth account.",
};

// A new username can lose a race to another sign-up choosing the same name; pick again.
const USERNAME_RACE_ATTEMPTS = 3;

/**
 * Writes the user and its OAuth link. With a D1 binding they are one atomic batch, so a
 * user can never exist without the link it was created for. Without one (unit tests,
 * scripts) Prisma writes them as one nested create.
 */
async function writeOAuthUser(
  db: PrismaClient,
  d1: D1ReadDatabase | null,
  oauthData: OAuthUserData,
  normalizedEmail: string,
  username: string,
): Promise<{ id: string; email: string; username: string }> {
  if (d1) {
    const id = crypto.randomUUID();
    const at = d1Timestamp(new Date());
    const verifiedAt = oauthData.emailVerified ? at : null;
    await d1WriteBatch(d1, [
      // The unique index on email is case-sensitive; this stops a racing sign-up that stored
      // the same email in another case from leaving two accounts.
      d1Guard(`NOT EXISTS (SELECT 1 FROM "User" WHERE LOWER("email") = ?)`, normalizedEmail),
      [
        `INSERT INTO "User" ("id", "email", "username", "hashedPassword", "salt", "emailVerifiedAt", "createdAt", "updatedAt")
         VALUES (?, ?, ?, NULL, NULL, ?, ?, ?)`,
        id,
        normalizedEmail,
        username,
        verifiedAt,
        at,
        at,
      ],
      [
        `INSERT INTO "OAuth" ("provider", "providerUserId", "providerUsername", "userId", "createdAt")
         VALUES (?, ?, ?, ?, ?)`,
        oauthData.provider,
        oauthData.providerUserId,
        oauthData.providerUsername,
        id,
        at,
      ],
    ]);
    return { id, email: normalizedEmail, username };
  }

  return db.user.create({
    data: {
      email: normalizedEmail,
      username,
      hashedPassword: null,
      salt: null,
      emailVerifiedAt: oauthData.emailVerified ? new Date() : null,
      OAuth: {
        create: {
          provider: oauthData.provider,
          providerUserId: oauthData.providerUserId,
          providerUsername: oauthData.providerUsername,
        },
      },
    },
    select: {
      id: true,
      email: true,
      username: true,
    },
  });
}

/**
 * Create a new user from OAuth provider data.
 * Returns error if email already exists (user should log in to link account).
 *
 * Two first sign-ins with the same provider identity can race: both find no account, and
 * the second write fails on the unique email or provider identity. That request then signs
 * in to the account the first one created instead of failing, so there is one account and
 * no lockout.
 */
export async function createOAuthUser(
  db: PrismaClient,
  oauthData: OAuthUserData,
  d1: D1ReadDatabase | null = null,
): Promise<CreateOAuthUserResult> {
  // Handle missing email from provider (e.g., Apple "Hide My Email")
  if (!oauthData.email) {
    return {
      success: false,
      error: "email_required",
      message:
        "An email address is required to create an account. Please allow access to your email when signing in.",
    };
  }

  const normalizedEmail = oauthData.email.toLowerCase();

  // Check if email already exists (case-insensitive)
  if (await findUserIdByEmail(db, normalizedEmail)) {
    return ACCOUNT_EXISTS;
  }

  for (let attempt = 1; ; attempt++) {
    // Generate a unique username
    const username = await generateUsername(db, oauthData.name, oauthData.email);
    try {
      const user = await writeOAuthUser(db, d1, oauthData, normalizedEmail, username);
      return { success: true, user };
    } catch (error) {
      // A guard failure means the email (in any case) was taken in between.
      if (!isUniqueConflict(error) && !isD1GuardFailure(error)) throw error;
      // Another request created this provider identity first: sign in to that account.
      const existing = await findExistingOAuthAccount(db, oauthData.provider, oauthData.providerUserId);
      if (existing) {
        return {
          success: true,
          user: { id: existing.userId, email: existing.email, username: existing.username },
        };
      }
      // Another account took the email first (for example through another provider).
      if (await findUserIdByEmail(db, normalizedEmail)) return ACCOUNT_EXISTS;
      // Otherwise the username was taken in between; choose again.
      if (attempt === USERNAME_RACE_ATTEMPTS) throw error;
    }
  }
}

/**
 * Find an existing OAuth account by provider and provider user ID.
 * Returns user data if found, null otherwise.
 * Use this to check if a returning user has already linked their OAuth account.
 */
export async function findExistingOAuthAccount(
  db: PrismaClient,
  provider: string,
  providerUserId: string
): Promise<ExistingOAuthAccount | null> {
  const oauthRecord = await db.oAuth.findUnique({
    where: {
      provider_providerUserId: {
        provider,
        providerUserId,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          username: true,
        },
      },
    },
  });

  if (!oauthRecord) {
    return null;
  }

  return {
    userId: oauthRecord.user.id,
    email: oauthRecord.user.email,
    username: oauthRecord.user.username,
    provider: oauthRecord.provider,
    providerUserId: oauthRecord.providerUserId,
    providerUsername: oauthRecord.providerUsername,
  };
}

/**
 * Sign in with a provider whose identity is not linked yet, to the existing account that has the
 * same email. This restores links for migrated accounts whose provider row went missing.
 *
 * Both sides must vouch for the address: the provider must say the email is verified, and the
 * Spoonjoy account must have verified it too (`emailVerifiedAt`). Without the second check anyone
 * could sign up with someone else's address and wait for them to "Sign in with Google" into an
 * account the attacker still holds the password for, or change an account's email to an address
 * they control at Google and then sign in to it. An unverified account gets
 * `account_exists_unverified`: sign in to it another way, then link the provider in settings.
 */
export async function linkOAuthAccountByVerifiedEmail(
  db: PrismaClient,
  oauthData: LinkOAuthByEmailData
): Promise<LinkOAuthResult> {
  if (!oauthData.emailVerified) {
    return {
      success: false,
      error: "email_unverified",
      message: "Your OAuth provider must return a verified email address.",
    };
  }

  const normalizedEmail = oauthData.email.toLowerCase();
  const existingUsers = await db.$queryRaw<Array<{ id: string; emailVerifiedAt: unknown }>>`
    SELECT id, emailVerifiedAt FROM User WHERE LOWER(email) = ${normalizedEmail} LIMIT 2
  `;

  // Older accounts can share an address that differs only in case. Linking would pick one of them
  // at random, so the provider sign-in is refused and the person signs in the way they usually do.
  if (existingUsers.length > 1) {
    return {
      success: false,
      error: "account_exists_unverified",
      message:
        "An account with this email already exists. Sign in to it the way you usually do, then link this sign-in from Account settings.",
    };
  }

  const existingUser = existingUsers[0];
  if (!existingUser) {
    return {
      success: false,
      error: "account_not_found",
      message: "No account exists for this verified email address.",
    };
  }

  if (existingUser.emailVerifiedAt === null || existingUser.emailVerifiedAt === undefined) {
    return {
      success: false,
      error: "account_exists_unverified",
      message:
        "An account with this email already exists. Sign in to it the way you usually do, then link this sign-in from Account settings.",
    };
  }

  const linkResult = await linkOAuthAccount(db, existingUser.id, oauthData);
  if (!linkResult.success) {
    return linkResult;
  }

  return {
    ...linkResult,
    userId: existingUser.id,
  };
}

/**
 * After a signed-in user links a provider that vouches for the same address their account uses,
 * the account's email counts as verified.
 */
export async function markEmailVerifiedByProvider(
  db: PrismaClient,
  userId: string,
  providerEmail: string | null,
  providerEmailVerified: boolean,
): Promise<boolean> {
  if (!providerEmail || !providerEmailVerified) return false;
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
  if (!user || user.emailVerifiedAt || user.email.toLowerCase() !== providerEmail.toLowerCase()) return false;
  // A typed write, so the timestamp is stored in the same format as every other Prisma DateTime.
  // The write re-checks the address it read: an email change landing between the read and this
  // write would otherwise mark the new, unproven address as verified.
  const result = await db.user.updateMany({
    where: { id: userId, emailVerifiedAt: null, email: user.email },
    data: { emailVerifiedAt: new Date() },
  });
  return result.count === 1;
}

/**
 * Link an OAuth provider to an existing logged-in user.
 * Use this when a user wants to add another OAuth provider to their account.
 */
export async function linkOAuthAccount(
  db: PrismaClient,
  userId: string,
  oauthData: LinkOAuthData
): Promise<LinkOAuthResult> {
  // Check if user exists
  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    return {
      success: false,
      error: "user_not_found",
      message: "User not found.",
    };
  }

  // Check if this user already has this provider linked
  const existingProviderForUser = await db.oAuth.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: oauthData.provider,
      },
    },
  });

  if (existingProviderForUser) {
    return {
      success: false,
      error: "provider_already_linked",
      message: `A ${oauthData.provider} account is already linked to your profile.`,
    };
  }

  // Check if this OAuth account is already linked to a different user
  const existingOAuthAccount = await db.oAuth.findUnique({
    where: {
      provider_providerUserId: {
        provider: oauthData.provider,
        providerUserId: oauthData.providerUserId,
      },
    },
  });

  if (existingOAuthAccount) {
    return {
      success: false,
      error: "provider_account_taken",
      message: "This OAuth account is already linked to a different account.",
    };
  }

  // Create the OAuth record
  const oauthRecord = await db.oAuth.create({
    data: {
      userId,
      provider: oauthData.provider,
      providerUserId: oauthData.providerUserId,
      providerUsername: oauthData.providerUsername,
    },
  });

  return {
    success: true,
    oauthRecord: {
      provider: oauthRecord.provider,
      providerUserId: oauthRecord.providerUserId,
      providerUsername: oauthRecord.providerUsername,
    },
  };
}

/**
 * Unlink an OAuth provider from an existing user.
 * Prevents unlinking if it's the user's only authentication method.
 */
export async function unlinkOAuthAccount(
  db: PrismaClient,
  userId: string,
  provider: string
): Promise<UnlinkOAuthResult> {
  // Check if user exists
  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    return {
      success: false,
      error: "user_not_found",
      message: "User not found.",
    };
  }

  // Check if this provider is linked to the user
  const oauthRecord = await db.oAuth.findUnique({
    where: {
      userId_provider: {
        userId,
        provider,
      },
    },
  });

  if (!oauthRecord) {
    return {
      success: false,
      error: "provider_not_linked",
      message: `${provider} is not linked to your account.`,
    };
  }

  // Check if this is the only auth method. A passkey counts as a way to log in,
  // so unlinking is allowed when the user keeps a password, another OAuth
  // provider, or at least one enrolled passkey.
  const hasPassword = user.hashedPassword !== null;
  const oauthCount = await db.oAuth.count({
    where: { userId },
  });
  const passkeyCount = await db.userCredential.count({
    where: { userId },
  });

  if (!hasPassword && oauthCount === 1 && passkeyCount === 0) {
    return {
      success: false,
      error: "only_auth_method",
      message:
        "Cannot unlink this provider because it is your only way to log in. Please add a password, another OAuth provider, or a passkey first.",
    };
  }

  // Delete the OAuth record
  await db.oAuth.delete({
    where: {
      userId_provider: {
        userId,
        provider,
      },
    },
  });

  return {
    success: true,
    unlinkedProvider: {
      provider: oauthRecord.provider,
      providerUserId: oauthRecord.providerUserId,
      providerUsername: oauthRecord.providerUsername,
    },
  };
}
