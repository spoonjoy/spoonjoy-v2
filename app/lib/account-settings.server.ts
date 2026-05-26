import type { AppLoadContext } from "react-router";
import { redirect } from "react-router";
import { getCloudflareEnv, getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { unlinkOAuthAccount } from "~/lib/oauth-user.server";
import { hashPassword, verifyPassword } from "~/lib/auth.server";
import {
  deleteStoredImage,
  hasUploadedImageFile,
  RECIPE_IMAGE_TYPES,
  storeImage,
  validateImageFile,
} from "~/lib/image-storage.server";

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
    | "no_password_to_remove";
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

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      hasPassword: user.hashedPassword !== null,
      photoUrl: user.photoUrl,
      oauthAccounts: user.OAuth,
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
      allowedTypes: RECIPE_IMAGE_TYPES,
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
          select: { OAuth: true },
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

    // Check if password is the only auth method (no OAuth)
    if (user._count.OAuth === 0) {
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

  return { success: false };
}
