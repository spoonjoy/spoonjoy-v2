import type { AppLoadContext } from "react-router";
import { redirect } from "react-router";
import { getCloudflareEnv, getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { unlinkOAuthAccount } from "~/lib/oauth-user.server";
import { hashPassword, verifyPassword } from "~/lib/auth.server";
import { listUserPasskeys, removeUserPasskey, renameUserPasskey } from "~/lib/webauthn-route.server";
import {
  deleteStoredImage,
  hasUploadedImageFile,
  storeImage,
  validateImageFile,
} from "~/lib/image-storage.server";
import { PROFILE_IMAGE_TYPES } from "~/lib/recipe-image";

export interface NotificationPreferenceFlags {
  notifySpoonOnMyRecipe: boolean;
  notifyForkOfMyRecipe: boolean;
  notifyCookbookSaveOfMine: boolean;
  notifyFellowChefOriginCook: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferenceFlags = {
  notifySpoonOnMyRecipe: true,
  notifyForkOfMyRecipe: true,
  notifyCookbookSaveOfMine: true,
  notifyFellowChefOriginCook: true,
};

export interface AccountSettingsLoaderData {
  user: {
    id: string;
    email: string;
    username: string;
    hasPassword: boolean;
    photoUrl: string | null;
    oauthAccounts: Array<{
      provider: string;
      providerUsername: string;
    }>;
    passkeys: Array<{
      id: string;
      name: string | null;
      transports: string | null;
      createdAt: string | null;
    }>;
    apiCredentials?: Array<{
      id: string;
      name: string;
      tokenPrefix: string;
      scopes: string[];
      createdAt: string;
      lastUsedAt: string | null;
      expiresAt: string | null;
    }>;
    oauthConnections?: Array<{
      clientId: string;
      clientName: string | null;
      resource: string | null;
      scopes: string[];
      createdAt: string;
      refreshTokenCount: number;
      accessTokenCount: number;
    }>;
  };
  notifications: {
    pushSubscribed: boolean;
    preferences: NotificationPreferenceFlags;
  };
  oauthError?: string;
}

export interface AccountSettingsActionResult {
  success: boolean;
  error?:
    | "email_taken"
    | "username_taken"
    | "validation_error"
    | "no_file"
    | "invalid_file_type"
    | "file_too_large"
    | "last_auth_method"
    | "provider_not_linked"
    | "invalid_provider"
    | "provider_already_linked"
    | "invalid_current_password"
    | "password_mismatch"
    | "password_too_short"
    | "password_required"
    | "current_password_required"
    | "no_password_set"
    | "same_password"
    | "password_already_set"
    | "no_password_to_remove"
    | "passkey_not_found"
    | "credential_not_found"
    | "oauth_connection_not_found";
  message?: string;
  fieldErrors?: {
    email?: string;
    username?: string;
    newPassword?: string;
  };
  photoUrl?: string;
}

interface AccountSettingsRouteArgs {
  request: Request;
  context: AppLoadContext;
}

const VALID_PROVIDERS = ["google", "github", "apple"] as const;
type ValidProvider = typeof VALID_PROVIDERS[number];

function isValidProvider(provider: string): provider is ValidProvider {
  return VALID_PROVIDERS.includes(provider as ValidProvider);
}

function isValidEmail(email: string): boolean {
  // Basic email validation - contains @ and at least one character on each side
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function loadAccountSettings({
  request,
  context,
}: AccountSettingsRouteArgs): Promise<AccountSettingsLoaderData> {
  const userId = await requireUserId(request, "/login", getCloudflareEnv(context));
  const url = new URL(request.url);
  const oauthError = url.searchParams.get("oauthError") ?? undefined;

  const database = await getRequestDb(context);

  const user = await database.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      hashedPassword: true,
      photoUrl: true,
      OAuth: {
        select: {
          provider: true,
          providerUsername: true,
        },
      },
    },
  });

  /* istanbul ignore next -- @preserve user should exist if session is valid */
  if (!user) {
    throw new Response("User not found", { status: 404 });
  }

  const passkeys = await listUserPasskeys(database, userId);
  const pushCount = await database.pushSubscription.count({ where: { userId } });
  const prefRow = await database.notificationPreference.findUnique({
    where: { userId },
  });
  const preferences: NotificationPreferenceFlags = prefRow
    ? {
        notifySpoonOnMyRecipe: prefRow.notifySpoonOnMyRecipe,
        notifyForkOfMyRecipe: prefRow.notifyForkOfMyRecipe,
        notifyCookbookSaveOfMine: prefRow.notifyCookbookSaveOfMine,
        notifyFellowChefOriginCook: prefRow.notifyFellowChefOriginCook,
      }
    : DEFAULT_NOTIFICATION_PREFERENCES;
  const apiCredentials = await database.apiCredential.findMany({
    where: {
      userId,
      revokedAt: null,
      oauthClientId: null,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      scopes: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
  });
  const activeRefreshTokens = await database.oAuthRefreshToken.findMany({
    where: { userId, revokedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      clientId: true,
      resource: true,
      scope: true,
      createdAt: true,
    },
  });
  const oauthClientIds = [...new Set(activeRefreshTokens.map((token) => token.clientId))];
  const oauthClients = oauthClientIds.length
    ? await database.oAuthClient.findMany({
        where: { id: { in: oauthClientIds } },
        select: { id: true, clientName: true },
      })
    : [];
  const clientNames = new Map(oauthClients.map((client) => [client.id, client.clientName]));
  const accessCredentialCounts = await database.apiCredential.groupBy({
    by: ["oauthClientId", "oauthResource"],
    where: {
      userId,
      revokedAt: null,
      oauthClientId: { in: oauthClientIds.length ? oauthClientIds : ["__none__"] },
    },
    _count: { _all: true },
  });
  const accessCounts = new Map(
    accessCredentialCounts.map((row) => [
      `${row.oauthClientId!}\u0000${row.oauthResource ?? ""}`,
      row._count._all,
    ]),
  );
  const oauthConnectionGroups = new Map<string, {
    clientId: string;
    clientName: string | null;
    resource: string | null;
    scopes: Set<string>;
    createdAt: Date;
    refreshTokenCount: number;
    accessTokenCount: number;
  }>();
  for (const token of activeRefreshTokens) {
    const key = `${token.clientId}\u0000${token.resource ?? ""}`;
    const existing = oauthConnectionGroups.get(key);
    if (existing) {
      for (const scope of token.scope.trim().split(/\s+/).filter(Boolean)) existing.scopes.add(scope);
      if (token.createdAt < existing.createdAt) existing.createdAt = token.createdAt;
      existing.refreshTokenCount += 1;
      continue;
    }
    oauthConnectionGroups.set(key, {
      clientId: token.clientId,
      clientName: clientNames.get(token.clientId) ?? null,
      resource: token.resource,
      scopes: new Set(token.scope.trim().split(/\s+/).filter(Boolean)),
      createdAt: token.createdAt,
      refreshTokenCount: 1,
      accessTokenCount: accessCounts.get(key) ?? 0,
    });
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      hasPassword: user.hashedPassword !== null,
      photoUrl: user.photoUrl,
      oauthAccounts: user.OAuth,
      passkeys: passkeys.map((passkey) => ({
        id: passkey.id,
        name: passkey.name,
        transports: passkey.transports,
        createdAt: passkey.createdAt ? passkey.createdAt.toISOString() : null,
      })),
      apiCredentials: apiCredentials.map((credential) => ({
        id: credential.id,
        name: credential.name,
        tokenPrefix: credential.tokenPrefix,
        scopes: credential.scopes.trim().split(/\s+/).filter(Boolean),
        createdAt: credential.createdAt.toISOString(),
        lastUsedAt: credential.lastUsedAt ? credential.lastUsedAt.toISOString() : null,
        expiresAt: credential.expiresAt ? credential.expiresAt.toISOString() : null,
      })),
      oauthConnections: Array.from(oauthConnectionGroups.values()).map((connection) => ({
        clientId: connection.clientId,
        clientName: connection.clientName,
        resource: connection.resource,
        scopes: Array.from(connection.scopes).sort(),
        createdAt: connection.createdAt.toISOString(),
        refreshTokenCount: connection.refreshTokenCount,
        accessTokenCount: connection.accessTokenCount,
      })),
    },
    notifications: {
      pushSubscribed: pushCount > 0,
      preferences,
    },
    oauthError,
  };
}

export async function handleAccountSettingsAction({
  request,
  context,
}: AccountSettingsRouteArgs): Promise<AccountSettingsActionResult> {
  const userId = await requireUserId(request, "/login", getCloudflareEnv(context));

  const database = await getRequestDb(context);

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "updateUserInfo") {
    const email = formData.get("email")?.toString() || "";
    const username = formData.get("username")?.toString() || "";

    // Validation
    const fieldErrors: { email?: string; username?: string } = {};

    if (!email.trim()) {
      fieldErrors.email = "Email is required";
    } else if (!isValidEmail(email)) {
      fieldErrors.email = "Please enter a valid email address";
    }

    if (!username.trim()) {
      fieldErrors.username = "Username is required";
    }

    if (Object.keys(fieldErrors).length > 0) {
      return {
        success: false,
        error: "validation_error",
        fieldErrors,
      };
    }

    const normalizedEmail = email.toLowerCase();

    // Get current user to check if values actually changed
    const currentUser = await database.user.findUnique({
      where: { id: userId },
      select: { email: true, username: true },
    });

    /* istanbul ignore next -- @preserve user should exist if session is valid */
    if (!currentUser) {
      return {
        success: false,
        error: "validation_error",
        message: "User not found",
      };
    }

    // Check email uniqueness (case-insensitive) if email changed
    if (normalizedEmail !== currentUser.email.toLowerCase()) {
      // Use raw SQL for case-insensitive email check (SQLite doesn't support Prisma's mode: "insensitive")
      const existingEmail = await database.$queryRaw<{ id: string }[]>`
        SELECT id FROM User WHERE LOWER(email) = ${normalizedEmail} AND id != ${userId}
      `;

      if (existingEmail.length > 0) {
        return {
          success: false,
          error: "email_taken",
          message: "This email is already in use by another account",
        };
      }
    }

    // Check username uniqueness if username changed
    if (username !== currentUser.username) {
      const existingUsername = await database.user.findUnique({
        where: { username },
        select: { id: true },
      });

      if (existingUsername && existingUsername.id !== userId) {
        return {
          success: false,
          error: "username_taken",
          message: "This username is already taken",
        };
      }
    }

    // Update user
    await database.user.update({
      where: { id: userId },
      data: {
        email: normalizedEmail,
        username,
      },
    });

    return { success: true };
  }

  if (intent === "uploadPhoto") {
    const photo = formData.get("photo");

    // Check if file was provided
    if (!hasUploadedImageFile(photo)) {
      return {
        success: false,
        error: "no_file",
        message: "Please select a photo to upload",
      };
    }

    // Check file type
    const imageError = validateImageFile(photo, {
      allowedTypes: PROFILE_IMAGE_TYPES,
      messages: {
        invalidType: "Please upload an image file",
        fileTooLarge: "Photo must be less than 5MB",
      },
    });

    if (imageError === "Please upload an image file") {
      return {
        success: false,
        error: "invalid_file_type",
        message: imageError,
      };
    }

    if (imageError === "Photo must be less than 5MB") {
      return {
        success: false,
        error: "file_too_large",
        message: imageError,
      };
    }

    const photoUrl = await storeImage({
      bucket: getCloudflareEnv(context)?.PHOTOS,
      file: photo,
      namespace: `profiles/${userId}`,
    });

    await database.user.update({
      where: { id: userId },
      data: { photoUrl },
    });

    return { success: true, photoUrl };
  }

  if (intent === "removePhoto") {
    // Get current photo URL to delete from R2
    const user = await database.user.findUnique({
      where: { id: userId },
      select: { photoUrl: true },
    });

    await deleteStoredImage({
      bucket: getCloudflareEnv(context)?.PHOTOS,
      imageUrl: user?.photoUrl,
    });

    await database.user.update({
      where: { id: userId },
      data: { photoUrl: null },
    });

    return { success: true };
  }

  if (intent === "unlinkOAuth") {
    const provider = formData.get("provider")?.toString();

    // Validate provider
    if (!provider || !isValidProvider(provider)) {
      return {
        success: false,
        error: "invalid_provider",
        message: "Invalid OAuth provider",
      };
    }

    const result = await unlinkOAuthAccount(database, userId, provider);

    // Map the error from oauth-user.server.ts to match test expectations
    if (!result.success) {
      if (result.error === "only_auth_method") {
        return {
          success: false,
          error: "last_auth_method",
          message: "Cannot unlink your last authentication method. Please add a password or another OAuth provider first.",
        };
      }
      return {
        success: false,
        error: result.error as AccountSettingsActionResult["error"],
        message: result.message,
      };
    }

    return {
      success: true,
      message: `${provider.charAt(0).toUpperCase() + provider.slice(1)} account unlinked successfully`,
    };
  }

  if (intent === "revokeApiCredential") {
    const credentialId = formData.get("credentialId")?.toString() || "";
    if (!credentialId) {
      return {
        success: false,
        error: "credential_not_found",
        message: "API credential not found",
      };
    }

    const result = await database.apiCredential.updateMany({
      where: { id: credentialId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (result.count === 0) {
      return {
        success: false,
        error: "credential_not_found",
        message: "API credential not found or already revoked",
      };
    }

    return {
      success: true,
      message: "API credential revoked",
    };
  }

  if (intent === "disconnectOAuthClient") {
    const clientId = formData.get("clientId")?.toString() || "";
    const resourceValue = formData.get("resource")?.toString() || "";
    const resource = resourceValue || null;
    if (!clientId) {
      return {
        success: false,
        error: "oauth_connection_not_found",
        message: "OAuth connection not found",
      };
    }

    const now = new Date();
    const refresh = await database.oAuthRefreshToken.updateMany({
      where: { userId, clientId, resource, revokedAt: null },
      data: { revokedAt: now },
    });
    const access = await database.apiCredential.updateMany({
      where: { userId, oauthClientId: clientId, oauthResource: resource, revokedAt: null },
      data: { revokedAt: now },
    });

    if (refresh.count === 0 && access.count === 0) {
      return {
        success: false,
        error: "oauth_connection_not_found",
        message: "OAuth connection not found or already disconnected",
      };
    }

    return {
      success: true,
      message: "OAuth connection disconnected",
    };
  }

  if (intent === "linkOAuth") {
    const provider = formData.get("provider")?.toString();

    // Validate provider
    if (!provider || !isValidProvider(provider)) {
      return {
        success: false,
        error: "invalid_provider",
        message: "Invalid OAuth provider",
      };
    }

    // Check if provider is already linked
    const existingOAuth = await database.oAuth.findUnique({
      where: {
        userId_provider: {
          userId,
          provider,
        },
      },
    });

    if (existingOAuth) {
      return {
        success: false,
        error: "provider_already_linked",
        message: `Your ${provider.charAt(0).toUpperCase() + provider.slice(1)} account is already linked.`,
      };
    }

    // Redirect to OAuth initiation endpoint with linking flag
    throw redirect(`/auth/${provider}?linking=true`);
  }

  if (intent === "changePassword") {
    const currentPassword = formData.get("currentPassword")?.toString() || "";
    const newPassword = formData.get("newPassword")?.toString() || "";
    const confirmPassword = formData.get("confirmPassword")?.toString() || "";

    // Check if user has a password set
    const user = await database.user.findUnique({
      where: { id: userId },
      select: { hashedPassword: true },
    });

    if (!user?.hashedPassword) {
      return {
        success: false,
        error: "no_password_set",
        message: "You don't have a password set. Please set a password instead.",
      };
    }

    // Validate current password is provided
    if (!currentPassword) {
      return {
        success: false,
        error: "current_password_required",
        message: "Please enter your current password",
      };
    }

    // Validate new password is provided
    if (!newPassword) {
      return {
        success: false,
        error: "password_required",
        message: "Please enter a new password",
      };
    }

    // Validate password length
    if (newPassword.length < 8) {
      return {
        success: false,
        error: "password_too_short",
        message: "Password must be at least 8 characters",
        fieldErrors: {
          newPassword: "Password must be at least 8 characters",
        },
      };
    }

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      return {
        success: false,
        error: "password_mismatch",
        message: "Passwords do not match",
      };
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword, user.hashedPassword);
    if (!isValid) {
      return {
        success: false,
        error: "invalid_current_password",
        message: "Your current password is incorrect",
      };
    }

    // Check if new password is same as current
    const isSamePassword = await verifyPassword(newPassword, user.hashedPassword);
    if (isSamePassword) {
      return {
        success: false,
        error: "same_password",
        message: "New password must be different from your current password",
      };
    }

    // Hash and save new password
    const { hashedPassword, salt } = await hashPassword(newPassword);
    await database.user.update({
      where: { id: userId },
      data: { hashedPassword, salt },
    });

    return {
      success: true,
      message: "Your password has been changed successfully",
    };
  }

  if (intent === "setPassword") {
    const newPassword = formData.get("newPassword")?.toString() || "";
    const confirmPassword = formData.get("confirmPassword")?.toString() || "";

    // Check if user already has a password
    const user = await database.user.findUnique({
      where: { id: userId },
      select: { hashedPassword: true },
    });

    if (user?.hashedPassword) {
      return {
        success: false,
        error: "password_already_set",
        message: "You already have a password set. Use change password instead.",
      };
    }

    // Validate new password is provided
    if (!newPassword) {
      return {
        success: false,
        error: "password_required",
        message: "Please enter a password",
      };
    }

    // Validate password length
    if (newPassword.length < 8) {
      return {
        success: false,
        error: "password_too_short",
        message: "Password must be at least 8 characters",
        fieldErrors: {
          newPassword: "Password must be at least 8 characters",
        },
      };
    }

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      return {
        success: false,
        error: "password_mismatch",
        message: "Passwords do not match",
      };
    }

    // Hash and save password
    const { hashedPassword, salt } = await hashPassword(newPassword);
    await database.user.update({
      where: { id: userId },
      data: { hashedPassword, salt },
    });

    return {
      success: true,
      message: "Your password has been set successfully",
    };
  }

  if (intent === "removePassword") {
    const currentPassword = formData.get("currentPassword")?.toString() || "";

    // Check if user has a password to remove
    const user = await database.user.findUnique({
      where: { id: userId },
      select: {
        hashedPassword: true,
        _count: {
          select: { OAuth: true, credentials: true },
        },
      },
    });

    if (!user?.hashedPassword) {
      return {
        success: false,
        error: "no_password_to_remove",
        message: "You don't have a password to remove",
      };
    }

    // Check if the password is the only auth method. A linked OAuth account or
    // an enrolled passkey both count as a remaining way to log in.
    if (user._count.OAuth === 0 && user._count.credentials === 0) {
      return {
        success: false,
        error: "last_auth_method",
        message: "Cannot remove password. You must have at least one way to log in.",
      };
    }

    // Verify current password if provided (for extra security)
    if (currentPassword) {
      const isValid = await verifyPassword(currentPassword, user.hashedPassword);
      if (!isValid) {
        return {
          success: false,
          error: "invalid_current_password",
          message: "Your current password is incorrect",
        };
      }
    }

    // Remove password
    await database.user.update({
      where: { id: userId },
      data: { hashedPassword: null, salt: null },
    });

    return {
      success: true,
      message: "Password removed successfully",
    };
  }

  if (intent === "removePasskey") {
    const credentialId = formData.get("credentialId")?.toString() || "";

    if (!credentialId) {
      return {
        success: false,
        error: "validation_error",
        message: "Missing passkey identifier",
      };
    }

    // Don't let the user delete their last remaining way to sign in. A passkey
    // counts as an auth method, so removal is allowed only when the user keeps a
    // password, a linked OAuth account, or at least one other passkey.
    const user = await database.user.findUnique({
      where: { id: userId },
      select: {
        hashedPassword: true,
        _count: { select: { OAuth: true, credentials: true } },
      },
    });

    /* istanbul ignore next -- @preserve user should exist if session is valid */
    if (!user) {
      return {
        success: false,
        error: "validation_error",
        message: "User not found",
      };
    }

    const hasOtherAuthMethod =
      user.hashedPassword !== null ||
      user._count.OAuth > 0 ||
      user._count.credentials > 1;

    if (!hasOtherAuthMethod) {
      return {
        success: false,
        error: "last_auth_method",
        message: "Cannot remove your last passkey. You must have at least one way to log in.",
      };
    }

    const { removed } = await removeUserPasskey(database, userId, credentialId);
    if (!removed) {
      return {
        success: false,
        error: "passkey_not_found",
        message: "That passkey could not be found",
      };
    }

    return {
      success: true,
      message: "Passkey removed successfully",
    };
  }

  if (intent === "renamePasskey") {
    const credentialId = formData.get("credentialId")?.toString() || "";
    const name = formData.get("name")?.toString() || "";

    if (!credentialId) {
      return {
        success: false,
        error: "validation_error",
        message: "Missing passkey identifier",
      };
    }

    const { renamed } = await renameUserPasskey(database, userId, credentialId, name);
    if (!renamed) {
      return {
        success: false,
        error: "passkey_not_found",
        message: "That passkey could not be found",
      };
    }

    return {
      success: true,
      message: "Passkey renamed successfully",
    };
  }

  return { success: false };
}
