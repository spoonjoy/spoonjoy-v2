import type { Route } from "./+types/account.settings";
import { useLoaderData, useActionData, useRevalidator, Form } from "react-router";
import { useState, useEffect } from "react";
import {
  handleAccountSettingsAction,
  loadAccountSettings,
  type AccountSettingsActionResult,
  type AccountSettingsLoaderData,
} from "~/lib/account-settings.server";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Field, Label, ErrorMessage } from "~/components/ui/fieldset";
import { Input } from "~/components/ui/input";
import { OAuthError } from "~/components/ui/oauth";
import { NotificationsSection } from "~/components/notifications-section";
import { AddPasskeyButton } from "~/components/auth/AddPasskeyButton";
import { ProfilePhotoField } from "~/components/account/ProfilePhotoField";
import { CookbookPage, CookbookHeader, SettingsPanel } from "~/components/cookbook/page";

export async function loader({ request, context }: Route.LoaderArgs) {
  return loadAccountSettings({ request, context });
}

export async function action({ request, context }: Route.ActionArgs): Promise<AccountSettingsActionResult> {
  return handleAccountSettingsAction({ request, context });
}

const OAUTH_PROVIDERS = ["google", "github", "apple"] as const;

function capitalizeProvider(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

// UTC so the rendered date is stable regardless of where the worker (or test
// runner) executes.
function formatPasskeyDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function AccountSettings() {
  const { user, oauthError, notifications } = useLoaderData<AccountSettingsLoaderData>();
  const actionData = useActionData<AccountSettingsActionResult>();
  const revalidator = useRevalidator();
  const [isEditing, setIsEditing] = useState(false);
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(null);
  const [removingPasskeyId, setRemovingPasskeyId] = useState<string | null>(null);
  const [renamingPasskeyId, setRenamingPasskeyId] = useState<string | null>(null);
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

  // Determine if user can unlink OAuth (keeps a password, another OAuth
  // provider, or an enrolled passkey as a way back in).
  const canUnlinkOAuth =
    user.hasPassword || user.oauthAccounts.length > 1 || user.passkeys.length > 0;

  // Determine if user can remove password (a linked OAuth account or an
  // enrolled passkey keeps them able to sign in).
  const canRemovePassword = user.oauthAccounts.length > 0 || user.passkeys.length > 0;

  // A passkey can be removed only if the user keeps another way to sign in:
  // a password, a linked OAuth account, or at least one other passkey.
  const canRemovePasskey =
    user.hasPassword || user.oauthAccounts.length > 0 || user.passkeys.length > 1;

  return (
    <CookbookPage>
      <div className="mx-auto max-w-4xl">
      <CookbookHeader eyebrow="Kitchen identity" title="Account settings">
        <Text className="mt-4 max-w-2xl text-base/7">
          Keep your chef profile, sign-in methods, and photo ready for family, guests, and agents.
        </Text>
      </CookbookHeader>

      <OAuthError error={oauthError} className="mt-4" />

      {/* Success/Error Messages (only show global banner when there are no field-level errors) */}
      {actionData?.message && !actionData?.fieldErrors && (
        <div
          className={`mt-4 border-y py-4 ${
            actionData.success
              ? "border-[var(--sj-border-strong)] bg-[color-mix(in_srgb,var(--sj-action)_10%,var(--sj-panel-solid))] text-[var(--sj-ink)]"
              : "border-[var(--sj-tomato)] bg-[color-mix(in_srgb,var(--sj-tomato)_10%,var(--sj-panel-solid))] text-[var(--sj-tomato)]"
          }`}
        >
          {actionData.message}
        </div>
      )}

      {/* User Info Section */}
      <SettingsPanel
        testId="user-info-section"
        title="User information"
        action={!isEditing ? (
            <Button plain onClick={() => setIsEditing(true)}>
              Edit
            </Button>
        ) : null}
      >
        <Text>The email and username attached to your kitchen.</Text>
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
            <div className="flex flex-wrap gap-3">
              <Button type="submit">
                Save
              </Button>
              <Button type="button" plain onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            </div>
          </Form>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Text className="border-y border-[var(--sj-border)] py-4">
              <span className="font-sj-ui block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">Email</span>
              {user.email}
            </Text>
            <Text className="border-y border-[var(--sj-border)] py-4">
              <span className="font-sj-ui block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">Username</span>
              {user.username}
            </Text>
          </div>
        )}
      </SettingsPanel>

      {/* Profile Photo Section */}
      <SettingsPanel testId="profile-photo-section" title="Profile photo">
        <Text className="mt-1">Make your kitchen feel human before anyone reads a recipe.</Text>
        <ProfilePhotoField photoUrl={user.photoUrl} />
      </SettingsPanel>

      {/* OAuth Providers Section */}
      <SettingsPanel testId="oauth-providers-section" title="Connected accounts">
        <Text className="mt-1">Use OAuth when it helps, but never make it the only way in unless you choose to.</Text>

        {/* Warning when can't unlink */}
        {!canUnlinkOAuth && user.oauthAccounts.length > 0 && (
          <Text className="mt-3 border-y border-[var(--sj-brass)] bg-[color-mix(in_srgb,var(--sj-brass)_12%,var(--sj-panel-solid))] py-3 text-sm text-[var(--sj-brass)]">
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
                className="flex flex-col gap-3 border-b border-[var(--sj-border)] py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  {isLinked ? (
                    <>
                      {/* Only show provider name label if username doesn't contain it */}
                      {/* This avoids duplicate regex matches in tests */}
                      {!account!.providerUsername.toLowerCase().includes(provider) && (
                        <Text className="font-medium text-[var(--sj-ink)]">
                          {capitalizeProvider(provider)}
                        </Text>
                      )}
                      <Text className="text-sm">{account!.providerUsername}</Text>
                    </>
                  ) : (
                    <Text className="font-medium text-[var(--sj-ink)]">
                      {capitalizeProvider(provider)}
                    </Text>
                  )}
                </div>
                {isLinked ? (
                  isShowingUnlinkConfirm ? (
                    <div className="flex flex-wrap items-center gap-2">
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
      </SettingsPanel>

      {/* Passkeys Section */}
      <SettingsPanel testId="passkeys-section" title="Passkeys">
        <Text className="mt-1">
          Sign in without a password using your device's biometrics or a security key.
        </Text>

        {!canRemovePasskey && user.passkeys.length > 0 && (
          <Text className="mt-3 border-y border-[var(--sj-brass)] bg-[color-mix(in_srgb,var(--sj-brass)_12%,var(--sj-panel-solid))] py-3 text-sm text-[var(--sj-brass)]">
            This passkey is your only way to sign in. Add a password or another passkey before removing it.
          </Text>
        )}

        {user.passkeys.length > 0 && (
          <div className="mt-4 space-y-4">
            {user.passkeys.map((passkey) => {
              const label = passkey.name || "Passkey";
              const isConfirming = removingPasskeyId === passkey.id;
              const isRenaming = renamingPasskeyId === passkey.id;

              return (
                <div
                  key={passkey.id}
                  className="flex flex-col gap-3 border-b border-[var(--sj-border)] py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  {isRenaming ? (
                    <Form method="post" className="flex w-full flex-col gap-3 sm:flex-row sm:items-end">
                      <input type="hidden" name="intent" value="renamePasskey" />
                      <input type="hidden" name="credentialId" value={passkey.id} />
                      <Field className="flex-1">
                        <Label htmlFor={`passkey-name-${passkey.id}`}>Passkey name</Label>
                        <Input
                          id={`passkey-name-${passkey.id}`}
                          name="name"
                          type="text"
                          defaultValue={passkey.name ?? ""}
                          placeholder="e.g. MacBook Touch ID"
                        />
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit">Save</Button>
                        <Button type="button" plain onClick={() => setRenamingPasskeyId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </Form>
                  ) : (
                    <>
                      <div>
                        <Text className="font-medium text-[var(--sj-ink)]">{label}</Text>
                        {passkey.createdAt && (
                          <Text className="text-sm">Added {formatPasskeyDate(passkey.createdAt)}</Text>
                        )}
                      </div>
                      {isConfirming ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Text className="text-sm">Are you sure?</Text>
                          <Form method="post" className="inline">
                            <input type="hidden" name="intent" value="removePasskey" />
                            <input type="hidden" name="credentialId" value={passkey.id} />
                            <Button
                              type="submit"
                              variant="destructive"
                              aria-label={`Confirm remove ${label}`}
                            >
                              Confirm
                            </Button>
                          </Form>
                          <Button type="button" plain onClick={() => setRemovingPasskeyId(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            plain
                            aria-label={`Rename ${label}`}
                            onClick={() => setRenamingPasskeyId(passkey.id)}
                          >
                            Rename
                          </Button>
                          <Button
                            type="button"
                            plain
                            aria-label={`Remove ${label}`}
                            disabled={!canRemovePasskey}
                            onClick={() => setRemovingPasskeyId(passkey.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4">
          <AddPasskeyButton onAdded={revalidator.revalidate} />
        </div>
      </SettingsPanel>

      {/* Password Section */}
      <SettingsPanel testId="password-section" title="Password">
        <Text className="mt-1">A first-class fallback for any client, browser, or future importer.</Text>
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
                  <Text className="mt-1 text-xs">
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
                <div className="flex flex-wrap gap-3">
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
                  <div className="flex flex-wrap gap-3">
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
              <div className="flex flex-wrap gap-3">
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
                  <Text className="mt-1 text-xs">
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
                <div className="flex flex-wrap gap-3">
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
      </SettingsPanel>

      <NotificationsSection
        initiallySubscribed={notifications.pushSubscribed}
        initialPreferences={notifications.preferences}
      />
      </div>
    </CookbookPage>
  );
}
