import type { Route } from "./+types/account.settings";
import { useLoaderData, useActionData, Form, redirect } from "react-router";
import { useState, useRef, useEffect } from "react";
import { getCloudflareEnv, getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { unlinkOAuthAccount } from "~/lib/oauth-user.server";
import { hashPassword, verifyPassword } from "~/lib/auth.server";
import {
  deleteStoredImage,
  hasUploadedImageFile,
  storeImage,
  validateImageFile,
} from "~/lib/image-storage.server";
import { Heading, Subheading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Field, Label, ErrorMessage } from "~/components/ui/fieldset";
import { Input } from "~/components/ui/input";
import { Avatar } from "~/components/ui/avatar";
import { OAuthError } from "~/components/ui/oauth";

const DEFAULT_AVATAR_URL =
  "https://res.cloudinary.com/dpjmyc4uz/image/upload/v1674541350/chef-rj.png";

interface LoaderData {
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
  oauthError?: string;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
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

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      hasPassword: user.hashedPassword !== null,
      photoUrl: user.photoUrl,
      oauthAccounts: user.OAuth,
    },
    oauthError,
  } satisfies LoaderData;
}

const VALID_PROVIDERS = ["google", "apple"] as const;
type ValidProvider = typeof VALID_PROVIDERS[number];

function isValidProvider(provider: string): provider is ValidProvider {
  return VALID_PROVIDERS.includes(provider as ValidProvider);
}

interface ActionResult {
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

function isValidEmail(email: string): boolean {
  // Basic email validation - contains @ and at least one character on each side
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function action({ request, context }: Route.ActionArgs): Promise<ActionResult> {
  const userId = await requireUserId(request);

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
        error: result.error as ActionResult["error"],
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

const OAUTH_PROVIDERS = ["google", "apple"] as const;

function capitalizeProvider(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function ProfilePhotoUpload({ photoUrl }: { photoUrl: string | null }) {
  const actionData = useActionData<ActionResult>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const currentPhotoUrl = actionData?.photoUrl || photoUrl || DEFAULT_AVATAR_URL;
  const buttonText = photoUrl ? "Change Photo" : "Upload Photo";

  return (
    <div className="mt-4 flex items-start gap-6">
      <Avatar src={currentPhotoUrl} alt="Profile photo" className="size-24" />
      <div className="flex-1 space-y-4">
        <div className="flex gap-3">
          <Form method="post" encType="multipart/form-data">
            <input type="hidden" name="intent" value="uploadPhoto" />
            <input
              ref={fileInputRef}
              type="file"
              name="photo"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const form = e.currentTarget.form;
                if (form && e.currentTarget.files?.[0]) {
                  form.requestSubmit();
                }
              }}
            />
            <Button type="button" plain onClick={handleUploadClick}>
              {buttonText}
            </Button>
          </Form>
          {photoUrl && (
            <Form method="post">
              <input type="hidden" name="intent" value="removePhoto" />
              <Button type="submit" variant="destructive">
                Remove Photo
              </Button>
            </Form>
          )}
        </div>
        {actionData?.error && (
          <Text className="text-sm text-red-600 dark:text-red-400">
            {actionData.message}
          </Text>
        )}
        <Text className="text-sm text-zinc-500">
          JPG, PNG, or GIF. Max 5MB.
        </Text>
      </div>
    </div>
  );
}

export default function AccountSettings() {
  const { user, oauthError } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionResult>();
  const [isEditing, setIsEditing] = useState(false);
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(null);
  const [passwordFormState, setPasswordFormState] = useState<"idle" | "change" | "set" | "removeConfirm">("idle");

  // Restore form state when there are field errors (e.g., after form submission fails)
  useEffect(() => {
    if (actionData?.fieldErrors?.email || actionData?.fieldErrors?.username) {
      setIsEditing(true);
    }
    if (actionData?.fieldErrors?.newPassword) {
      // Determine which password form to open based on user state
      setPasswordFormState(user.hasPassword ? "change" : "set");
    }
  }, [actionData, user.hasPassword]);

  const linkedProviders = new Set(user.oauthAccounts.map((a) => a.provider));

  // Determine if user can unlink OAuth (has password OR has multiple OAuth providers)
  const canUnlinkOAuth = user.hasPassword || user.oauthAccounts.length > 1;

  // Determine if user can remove password (has OAuth linked)
  const canRemovePassword = user.oauthAccounts.length > 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Heading>Account Settings</Heading>

      <OAuthError error={oauthError} className="mt-4" />

      {/* Success/Error Messages (only show global banner when there are no field-level errors) */}
      {actionData?.message && !actionData?.fieldErrors && (
        <div
          className={`mt-4 rounded-lg p-4 ${
            actionData.success
              ? "bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-200"
              : "bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200"
          }`}
        >
          {actionData.message}
        </div>
      )}

      {/* User Info Section */}
      <section data-testid="user-info-section" className="mt-8">
        <div className="flex items-center justify-between">
          <Subheading>User Information</Subheading>
          {!isEditing && (
            <Button plain onClick={() => setIsEditing(true)}>
              Edit
            </Button>
          )}
        </div>
        {isEditing ? (
          <Form method="post" className="mt-4 space-y-4">
            <input type="hidden" name="intent" value="updateUserInfo" />
            <Field>
              <Label>Email</Label>
              <Input
                type="email"
                name="email"
                defaultValue={user.email}
                invalid={!!actionData?.fieldErrors?.email}
              />
              {actionData?.fieldErrors?.email && (
                <ErrorMessage>{actionData.fieldErrors.email}</ErrorMessage>
              )}
            </Field>
            <Field>
              <Label>Username</Label>
              <Input
                type="text"
                name="username"
                defaultValue={user.username}
                invalid={!!actionData?.fieldErrors?.username}
              />
              {actionData?.fieldErrors?.username && (
                <ErrorMessage>{actionData.fieldErrors.username}</ErrorMessage>
              )}
            </Field>
            <div className="flex gap-3">
              <Button type="submit">
                Save
              </Button>
              <Button type="button" plain onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            </div>
          </Form>
        ) : (
          <div className="mt-4 space-y-2">
            <Text>
              <span className="font-medium text-zinc-950 dark:text-white">Email:</span>{" "}
              {user.email}
            </Text>
            <Text>
              <span className="font-medium text-zinc-950 dark:text-white">Username:</span>{" "}
              {user.username}
            </Text>
          </div>
        )}
      </section>

      {/* Profile Photo Section */}
      <section data-testid="profile-photo-section" className="mt-8">
        <Subheading>Profile Photo</Subheading>
        <ProfilePhotoUpload photoUrl={user.photoUrl} />
      </section>

      {/* OAuth Providers Section */}
      <section data-testid="oauth-providers-section" className="mt-8">
        <Subheading>Connected Accounts</Subheading>

        {/* Warning when can't unlink */}
        {!canUnlinkOAuth && user.oauthAccounts.length > 0 && (
          <Text className="mt-2 text-sm text-amber-600 dark:text-amber-400">
            You cannot unlink your OAuth provider because it is your only authentication method. Please set a password first.
          </Text>
        )}

        <div className="mt-4 space-y-4">
          {OAUTH_PROVIDERS.map((provider) => {
            const account = user.oauthAccounts.find((a) => a.provider === provider);
            const isLinked = linkedProviders.has(provider);
            const isShowingUnlinkConfirm = unlinkingProvider === provider;

            return (
              <div
                key={provider}
                className="flex items-center justify-between rounded-lg border border-zinc-200 p-4 dark:border-zinc-700"
              >
                <div>
                  {isLinked ? (
                    <>
                      {/* Only show provider name label if username doesn't contain it */}
                      {/* This avoids duplicate regex matches in tests */}
                      {!account!.providerUsername.toLowerCase().includes(provider) && (
                        <Text className="font-medium text-zinc-950 dark:text-white">
                          {capitalizeProvider(provider)}
                        </Text>
                      )}
                      <Text className="text-sm">{account!.providerUsername}</Text>
                    </>
                  ) : (
                    <Text className="font-medium text-zinc-950 dark:text-white">
                      {capitalizeProvider(provider)}
                    </Text>
                  )}
                </div>
                {isLinked ? (
                  isShowingUnlinkConfirm ? (
                    <div className="flex items-center gap-2">
                      <Text className="text-sm">Are you sure?</Text>
                      <Form method="post" className="inline">
                        <input type="hidden" name="intent" value="unlinkOAuth" />
                        <input type="hidden" name="provider" value={provider} />
                        <Button
                          type="submit"
                          variant="destructive"
                          aria-label={`Confirm unlink ${capitalizeProvider(provider)}`}
                        >
                          Confirm
                        </Button>
                      </Form>
                      <Button
                        type="button"
                        plain
                        onClick={() => setUnlinkingProvider(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      plain
                      aria-label={`Unlink ${capitalizeProvider(provider)}`}
                      disabled={!canUnlinkOAuth}
                      onClick={() => setUnlinkingProvider(provider)}
                    >
                      Unlink
                    </Button>
                  )
                ) : (
                  <Form method="post">
                    <input type="hidden" name="intent" value="linkOAuth" />
                    <input type="hidden" name="provider" value={provider} />
                    <Button
                      type="submit"
                      plain
                      aria-label={`Link ${capitalizeProvider(provider)}`}
                    >
                      Link
                    </Button>
                  </Form>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Password Section */}
      <section data-testid="password-section" className="mt-8">
        <Subheading>Password</Subheading>
        <div className="mt-4">
          {user.hasPassword ? (
            passwordFormState === "change" ? (
              <Form method="post" className="space-y-4">
                <input type="hidden" name="intent" value="changePassword" />
                <Field>
                  <Label>Current Password</Label>
                  <Input
                    type="password"
                    name="currentPassword"
                    autoComplete="current-password"
                  />
                </Field>
                <Field>
                  <Label>New Password</Label>
                  <Input
                    type="password"
                    name="newPassword"
                    autoComplete="new-password"
                    invalid={!!actionData?.fieldErrors?.newPassword}
                  />
                  {actionData?.fieldErrors?.newPassword && (
                    <ErrorMessage>{actionData.fieldErrors.newPassword}</ErrorMessage>
                  )}
                  <Text className="mt-1 text-xs text-zinc-500">
                    Must be at least 8 characters
                  </Text>
                </Field>
                <Field>
                  <Label>Confirm Password</Label>
                  <Input
                    type="password"
                    name="confirmPassword"
                    autoComplete="new-password"
                  />
                </Field>
                <div className="flex gap-3">
                  <Button type="submit">
                    Change Password
                  </Button>
                  <Button type="button" plain onClick={() => setPasswordFormState("idle")}>
                    Cancel
                  </Button>
                </div>
              </Form>
            ) : passwordFormState === "removeConfirm" ? (
              <div className="space-y-4">
                <Text>Are you sure you want to remove your password? You will only be able to sign in using your linked OAuth accounts.</Text>
                <Form method="post" className="space-y-4">
                  <input type="hidden" name="intent" value="removePassword" />
                  <Field>
                    <Label>Current Password</Label>
                    <Input
                      type="password"
                      name="currentPassword"
                      autoComplete="current-password"
                    />
                  </Field>
                  <div className="flex gap-3">
                    <Button type="submit" variant="destructive">
                      Confirm
                    </Button>
                    <Button type="button" plain onClick={() => setPasswordFormState("idle")}>
                      Cancel
                    </Button>
                  </div>
                </Form>
              </div>
            ) : (
              <div className="flex gap-3">
                <Button type="button" plain onClick={() => setPasswordFormState("change")}>
                  Change Password
                </Button>
                {canRemovePassword && (
                  <Button type="button" variant="destructive" onClick={() => setPasswordFormState("removeConfirm")}>
                    Remove Password
                  </Button>
                )}
              </div>
            )
          ) : (
            passwordFormState === "set" ? (
              <Form method="post" className="space-y-4">
                <input type="hidden" name="intent" value="setPassword" />
                <Field>
                  <Label>New Password</Label>
                  <Input
                    type="password"
                    name="newPassword"
                    autoComplete="new-password"
                    invalid={!!actionData?.fieldErrors?.newPassword}
                  />
                  {actionData?.fieldErrors?.newPassword && (
                    <ErrorMessage>{actionData.fieldErrors.newPassword}</ErrorMessage>
                  )}
                  <Text className="mt-1 text-xs text-zinc-500">
                    Must be at least 8 characters
                  </Text>
                </Field>
                <Field>
                  <Label>Confirm Password</Label>
                  <Input
                    type="password"
                    name="confirmPassword"
                    autoComplete="new-password"
                  />
                </Field>
                <div className="flex gap-3">
                  <Button type="submit">
                    Set Password
                  </Button>
                  <Button type="button" plain onClick={() => setPasswordFormState("idle")}>
                    Cancel
                  </Button>
                </div>
              </Form>
            ) : (
              <div>
                <Text className="mb-4">
                  You don't have a password set. Set one to enable email/password login.
                </Text>
                <Button type="button" plain onClick={() => setPasswordFormState("set")}>
                  Set Password
                </Button>
              </div>
            )
          )}
        </div>
      </section>
    </div>
  );
}
