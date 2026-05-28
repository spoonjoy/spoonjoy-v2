import type { PrismaClient } from "@prisma/client";

export interface OAuthUserData {
  provider: string;
  providerUserId: string;
  providerUsername: string;
  email: string | null;
  name: string | null;
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

export interface LinkOAuthResult {
  success: boolean;
  oauthRecord?: {
    provider: string;
    providerUserId: string;
    providerUsername: string;
  };
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

  while (true) {
    const existing = await db.user.findUnique({
      where: { username: candidate },
    });

    if (!existing) {
      return candidate;
    }

    counter++;
    candidate = `${baseUsername}-${counter}`;
  }
}

/**
 * Create a new user from OAuth provider data.
 * Returns error if email already exists (user should log in to link account).
 */
export async function createOAuthUser(
  db: PrismaClient,
  oauthData: OAuthUserData
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
  const existingUsers = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM User WHERE LOWER(email) = ${normalizedEmail} LIMIT 1
  `;

  if (existingUsers.length > 0) {
    return {
      success: false,
      error: "account_exists",
      message:
        "An account with this email already exists. Please log in to link your OAuth account.",
    };
  }

  // Generate a unique username
  const username = await generateUsername(db, oauthData.name, oauthData.email);

  // Create user and OAuth record in a transaction
  const user = await db.user.create({
    data: {
      email: normalizedEmail,
      username,
      hashedPassword: null,
      salt: null,
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

  return {
    success: true,
    user,
  };
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
