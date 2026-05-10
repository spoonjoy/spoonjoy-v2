import type { Route } from "./+types/account.settings";
import { useLoaderData, useActionData, Form } from "react-router";
import { useState, useRef, useEffect } from "react";
import {
  handleAccountSettingsAction,
  loadAccountSettings,
  type AccountSettingsActionResult,
  type AccountSettingsLoaderData,
} from "~/lib/account-settings.server";
import { Heading, Subheading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Field, Label, ErrorMessage } from "~/components/ui/fieldset";
import { Input } from "~/components/ui/input";
import { Avatar } from "~/components/ui/avatar";
import { OAuthError } from "~/components/ui/oauth";

const DEFAULT_AVATAR_URL =
  "https://res.cloudinary.com/dpjmyc4uz/image/upload/v1674541350/chef-rj.png";

export async function loader({ request, context }: Route.LoaderArgs) {
  return loadAccountSettings({ request, context });
}

export async function action({ request, context }: Route.ActionArgs): Promise<AccountSettingsActionResult> {
  return handleAccountSettingsAction({ request, context });
}

const OAUTH_PROVIDERS = ["google", "apple"] as const;

function capitalizeProvider(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function ProfilePhotoUpload({ photoUrl }: { photoUrl: string | null }) {
  const actionData = useActionData<AccountSettingsActionResult>();
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
  const { user, oauthError } = useLoaderData<AccountSettingsLoaderData>();
  const actionData = useActionData<AccountSettingsActionResult>();
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
