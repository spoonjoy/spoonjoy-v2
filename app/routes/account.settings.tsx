import type { Route } from "./+types/account.settings";
import { useLoaderData, useActionData, useRevalidator, useFetcher, Form as RouterForm } from "react-router";
import { useState, useEffect } from "react";
import {
  handleAccountSettingsAction,
  loadAccountSettings,
  type AccountSettingsActionResponse,
  type AccountSettingsActionResult,
  type AccountSettingsLoaderData,
} from "~/lib/account-settings.server";
import { LogOut } from "lucide-react";
import { Text } from "~/components/ouro/text/text";
import { Button } from "~/components/ouro/button/button";
import { Checkbox } from "~/components/ouro/checkbox/checkbox";
import { Form } from "~/components/ouro/form/form";
import { TextField } from "~/components/ouro/text-field/text-field";
import { useFormErrors, useIntentAnswer } from "~/hooks/use-form-errors";
import { OAuthError } from "~/components/oauth";
import { NotificationsSection } from "~/components/notifications-section";
import { AddPasskeyButton } from "~/components/auth/AddPasskeyButton";
import { ProfilePhotoField } from "~/components/account/ProfilePhotoField";
import { AccountDataSection } from "~/components/account/AccountDataSection";
import { CookbookPage, SettingsPanel } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { clearCookProgressCache } from "~/lib/cook-session-sync";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Account settings - Spoonjoy" },
    { name: "description", content: "Manage your Spoonjoy account settings." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  return loadAccountSettings({ request, context });
}

export async function action({ request, context }: Route.ActionArgs): Promise<AccountSettingsActionResponse> {
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

// The action answers every form on the page with one fieldErrors object. Each form takes the
// errors for its own fields.
const USER_INFO_FIELDS = ["email", "username", "currentPassword"] as const;
const NEW_PASSWORD_FIELDS = ["newPassword"] as const;
const USER_INFO_INTENTS = ["updateUserInfo"] as const;
const DELETE_INTENTS = ["deleteAccount"] as const;

export default function AccountSettings() {
  const { user, oauthError, notifications } = useLoaderData<AccountSettingsLoaderData>();
  const actionData = useActionData<AccountSettingsActionResult>();
  const [initialActionData] = useState(actionData);
  const userInfoAnswer = useIntentAnswer(actionData, USER_INFO_INTENTS);
  const passwordFetcher = useFetcher<AccountSettingsActionResult>();
  const [passwordBaseline, setPasswordBaseline] = useState(initialActionData);
  const passwordAnswer = passwordFetcher.data;
  const passwordData = passwordAnswer ?? passwordBaseline;
  const deleteAnswer = useIntentAnswer(actionData, DELETE_INTENTS);
  const userInfoErrors = useFormErrors((userInfoAnswer ?? initialActionData)?.fieldErrors, USER_INFO_FIELDS, userInfoAnswer);
  const newPasswordErrors = useFormErrors({
    ...passwordData?.fieldErrors,
    general: passwordData?.success === false && !passwordData.fieldErrors ? passwordData.message : undefined,
  }, NEW_PASSWORD_FIELDS, passwordAnswer);
  const revalidator = useRevalidator();
  const [isEditing, setIsEditing] = useState(false);
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(null);
  const [removingPasskeyId, setRemovingPasskeyId] = useState<string | null>(null);
  const [renamingPasskeyId, setRenamingPasskeyId] = useState<string | null>(null);
  const [passwordFormState, setPasswordFormState] = useState<"idle" | "change" | "set" | "removeConfirm">(
    // Initial progressive-post errors are display only, never client acceptance authority.
    initialActionData?.fieldErrors?.newPassword ? (user.hasPassword ? "change" : "set") : "idle",
  );
  const [isConfirmingSignOutEverywhere, setIsConfirmingSignOutEverywhere] = useState(false);
  const apiCredentials = user.apiCredentials ?? [];
  const oauthConnections = user.oauthConnections ?? [];

  // Restore form state when there are field errors (e.g., after form submission fails), and
  // close a form once its submission succeeds; the banner below confirms it.
  useEffect(() => {
    if (actionData?.fieldErrors?.email || actionData?.fieldErrors?.username || actionData?.fieldErrors?.currentPassword) {
      setIsEditing(true);
    }
    if (actionData?.success && actionData.intent === "updateUserInfo") {
      setIsEditing(false);
    }
  }, [actionData, user.hasPassword]);

  useEffect(() => {
    if (passwordAnswer?.success) setPasswordFormState("idle");
  }, [passwordAnswer]);

  const openPasswordForm = (mode: "change" | "set") => {
    passwordFetcher.reset();
    setPasswordBaseline(undefined);
    setPasswordFormState(mode);
  };
  const cancelPasswordForm = () => {
    // Router owns cancellation and drops the response; no submit counter or guessed receipt.
    passwordFetcher.reset();
    setPasswordBaseline(undefined);
    setPasswordFormState("idle");
  };

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
      <PageHeader
        eyebrow="Kitchen identity"
        title="Account settings"
        actions={(
          // Desktop logs out from its top navigation; a phone logs out here. A plain form post,
          // so it works before the page hydrates and the next page loads fresh.
          <RouterForm method="post" action="/logout" className="m-0 lg:hidden" onSubmit={clearCookProgressCache}>
            <Button type="submit" variant="outline" tone="secondary">
              <LogOut data-slot="icon" className="size-4" />
              Log out
            </Button>
          </RouterForm>
        )}
        size="lg"
        divider
        description="Keep your chef profile, sign-in methods, and photo ready for family, guests, and agents."
      />

      <OAuthError error={oauthError} className="mt-4" />

      {/* Success/Error Messages (only show global banner when there are no field-level errors; a
          photo upload's error shows next to the photo instead) */}
      {actionData?.message && !actionData?.fieldErrors && actionData.intent !== "uploadPhoto" && actionData.intent !== "deleteAccount" && (
        <div
          role={actionData.success ? "status" : "alert"}
          className={`mt-4 border-y py-4 ${
            actionData.success
              ? "border-[var(--sj-border-strong)] bg-[color-mix(in_srgb,var(--sj-action)_10%,var(--sj-panel-solid))] text-[var(--sj-ink)]"
              : "border-[var(--sj-tomato)] bg-[color-mix(in_srgb,var(--sj-tomato)_10%,var(--sj-panel-solid))] text-[var(--sj-tomato)]"
          }`}
        >
          {actionData.message}
        </div>
      )}

      {/* User Info Section (the anchor brings a chef back here after "Sign in again") */}
      <div id="user-info">
      <SettingsPanel
        testId="user-info-section"
        title="User information"
        action={!isEditing ? (
            <Button variant="outline" tone="secondary" onClick={() => setIsEditing(true)}>
              Edit
            </Button>
        ) : null}
      >
        <Text tone="muted">The email and username attached to your kitchen.</Text>
        {isEditing ? (
          <Form method="post" errors={userInfoErrors} render={<RouterForm />} className="mt-4 gap-4">
            <input type="hidden" name="intent" value="updateUserInfo" />
            <TextField label="Email" type="email" name="email" defaultValue={user.email} />
            <TextField label="Username" name="username" defaultValue={user.username} />
            {/* Changing the email needs proof it's the owner: the password, or for an account
                without one, a recent sign-in. A username-only save needs neither. */}
            {user.hasPassword ? (
              <TextField
                label="Current password"
                description="Needed only to change your email."
                type="password"
                name="currentPassword"
                autoComplete="current-password"
              />
            ) : (
              <Text tone="muted" size="sm" className="leading-6">
                To change your email, you need to have signed in within the last 10 minutes. If it has been longer,
                sign in again first.
              </Text>
            )}
            <div className="flex flex-wrap gap-3">
              <Button type="submit">
                Save
              </Button>
              <Button type="button" variant="outline" tone="secondary" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            </div>
          </Form>
        ) : null}
        {isEditing && !user.hasPassword ? (
          <RouterForm method="post" className="mt-3">
            <input type="hidden" name="intent" value="reauthenticate" />
            <input type="hidden" name="for" value="email" />
            <Button type="submit" variant="outline" tone="secondary">
              Sign in again
            </Button>
          </RouterForm>
        ) : null}
        {!isEditing && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 border-y border-[var(--sj-border)] py-4"><Text tone="muted" className="[overflow-wrap:anywhere]">
              <span className="font-sj-ui block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">Email</span>
              {user.email}
            </Text></div>
            <div className="min-w-0 border-y border-[var(--sj-border)] py-4"><Text tone="muted" className="[overflow-wrap:anywhere]">
              <span className="font-sj-ui block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">Username</span>
              {user.username}
            </Text></div>
          </div>
        )}
      </SettingsPanel>
      </div>

      {/* Profile Photo Section */}
      <SettingsPanel testId="profile-photo-section" title="Profile photo">
        <Text tone="muted" className="mt-1">Make your kitchen feel human before anyone reads a recipe.</Text>
        <ProfilePhotoField photoUrl={user.photoUrl} />
      </SettingsPanel>

      {/* OAuth Providers Section */}
      <SettingsPanel testId="oauth-providers-section" title="Connected accounts">
        <Text tone="muted" className="mt-1">Use OAuth when it helps, but never make it the only way in unless you choose to.</Text>

        {/* Warning when can't unlink */}
        {!canUnlinkOAuth && user.oauthAccounts.length > 0 && (
          <p className="text-base/6 text-[var(--sj-ink-soft)] mt-3 border-y border-[var(--sj-brass)] bg-[color-mix(in_srgb,var(--sj-brass)_12%,var(--sj-panel-solid))] py-3 text-sm text-[var(--sj-brass)]">
            You cannot unlink your OAuth provider because it is your only authentication method. Please set a password first.
          </p>
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
                        <Text tone="default"><strong className="font-medium">
                          {capitalizeProvider(provider)}
                        </strong></Text>
                      )}
                      <Text tone="muted" size="sm">{account!.providerUsername}</Text>
                    </>
                  ) : (
                    <Text tone="default"><strong className="font-medium">
                      {capitalizeProvider(provider)}
                    </strong></Text>
                  )}
                </div>
                {isLinked ? (
                  isShowingUnlinkConfirm ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Text tone="muted" size="sm">Are you sure?</Text>
                      <RouterForm method="post" className="inline">
                        <input type="hidden" name="intent" value="unlinkOAuth" />
                        <input type="hidden" name="provider" value={provider} />
                        <Button
                          type="submit"
                          variant="soft" tone="destructive"
                          aria-label={`Confirm unlink ${capitalizeProvider(provider)}`}
                        >
                          Confirm
                        </Button>
                      </RouterForm>
                      <Button
                        type="button"
                        variant="outline" tone="secondary"
                        onClick={() => setUnlinkingProvider(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline" tone="secondary"
                      aria-label={`Unlink ${capitalizeProvider(provider)}`}
                      disabled={!canUnlinkOAuth}
                      onClick={() => setUnlinkingProvider(provider)}
                    >
                      Unlink
                    </Button>
                  )
                ) : (
                  <RouterForm method="post">
                    <input type="hidden" name="intent" value="linkOAuth" />
                    <input type="hidden" name="provider" value={provider} />
                    <Button
                      type="submit"
                      variant="outline" tone="secondary"
                      aria-label={`Link ${capitalizeProvider(provider)}`}
                    >
                      Link
                    </Button>
                  </RouterForm>
                )}
              </div>
            );
          })}
        </div>
      </SettingsPanel>

      <SettingsPanel testId="api-access-section" title="API and app access">
        <Text tone="muted" className="mt-1">
          Revoke personal, delegated, and OAuth app access without exposing token secrets.
        </Text>

        <div className="mt-5 space-y-6">
          <div>
            <p className="text-base/6 text-[var(--sj-ink-soft)] font-sj-ui text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
              Bearer credentials
            </p>
            {apiCredentials.length > 0 ? (
              <div className="mt-2 space-y-3">
                {apiCredentials.map((credential) => (
                  <div
                    key={credential.id}
                    className="flex flex-col gap-3 border-b border-[var(--sj-border)] py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <Text tone="default"><strong className="font-medium">{credential.name}</strong></Text>
                      <Text tone="muted" size="sm" className="break-words">
                        {credential.tokenPrefix}... · {credential.scopes.join(", ") || "No scopes"}
                      </Text>
                      <p className="text-base/6 text-[var(--sj-ink-soft)] text-xs">
                        Created {formatPasskeyDate(credential.createdAt)}
                        {credential.lastUsedAt ? ` · Last used ${formatPasskeyDate(credential.lastUsedAt)}` : ""}
                        {credential.expiresAt ? ` · Expires ${formatPasskeyDate(credential.expiresAt)}` : ""}
                      </p>
                    </div>
                    <RouterForm method="post">
                      <input type="hidden" name="intent" value="revokeApiCredential" />
                      <input type="hidden" name="credentialId" value={credential.id} />
                      <Button type="submit" variant="soft" tone="destructive" aria-label={`Revoke ${credential.name}`}>
                        Revoke
                      </Button>
                    </RouterForm>
                  </div>
                ))}
              </div>
            ) : (
              <Text tone="muted" size="sm" className="mt-2">No active bearer credentials.</Text>
            )}
          </div>

          <div>
            <p className="text-base/6 text-[var(--sj-ink-soft)] font-sj-ui text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
              OAuth app connections
            </p>
            {oauthConnections.length > 0 ? (
              <div className="mt-2 space-y-3">
                {oauthConnections.map((connection) => {
                  const appName = connection.clientName || connection.clientId;
                  return (
                    <div
                      key={`${connection.clientId}:${connection.issuer}:${connection.resource ?? ""}:${connection.connectionKeys.join(",")}`}
                      className="flex flex-col gap-3 border-b border-[var(--sj-border)] py-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <Text tone="default"><strong className="font-medium">{appName}</strong></Text>
                        <Text tone="muted" size="sm" className="break-words">
                          {connection.resource || "REST API"} · {connection.scopes.join(", ") || "No scopes"}
                        </Text>
                        <p className="text-base/6 text-[var(--sj-ink-soft)] break-words text-xs">Issued by {connection.issuer}</p>
                        <p className="text-base/6 text-[var(--sj-ink-soft)] text-xs">
                          Connected {formatPasskeyDate(connection.createdAt)} · {connection.refreshTokenCount} refresh token{connection.refreshTokenCount === 1 ? "" : "s"} · {connection.accessTokenCount} live access token{connection.accessTokenCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      <RouterForm method="post">
                        <input type="hidden" name="intent" value="disconnectOAuthClient" />
                        <input type="hidden" name="clientId" value={connection.clientId} />
                        <input type="hidden" name="issuer" value={connection.issuer} />
                        <input type="hidden" name="resource" value={connection.resource ?? ""} />
                        {connection.connectionKeys.map((connectionKey) => (
                          <input key={connectionKey} type="hidden" name="connectionKey" value={connectionKey} />
                        ))}
                        <Button type="submit" variant="soft" tone="destructive" aria-label={`Disconnect ${appName} from ${connection.issuer}`}>
                          Disconnect
                        </Button>
                      </RouterForm>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Text tone="muted" size="sm" className="mt-2">No active OAuth app connections.</Text>
            )}
          </div>
        </div>
      </SettingsPanel>

      {/* Passkeys Section */}
      <SettingsPanel testId="passkeys-section" title="Passkeys">
        <Text tone="muted" className="mt-1">
          Sign in without a password using your device's biometrics or a security key.
        </Text>

        {!canRemovePasskey && user.passkeys.length > 0 && (
          <p className="text-base/6 text-[var(--sj-ink-soft)] mt-3 border-y border-[var(--sj-brass)] bg-[color-mix(in_srgb,var(--sj-brass)_12%,var(--sj-panel-solid))] py-3 text-sm text-[var(--sj-brass)]">
            This passkey is your only way to sign in. Add a password or another passkey before removing it.
          </p>
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
                    <RouterForm method="post" className="flex w-full flex-col gap-3 sm:flex-row sm:items-end">
                      <input type="hidden" name="intent" value="renamePasskey" />
                      <input type="hidden" name="credentialId" value={passkey.id} />
                      <TextField
                        label="Passkey name"
                        name="name"
                        defaultValue={passkey.name ?? ""}
                        placeholder="e.g. MacBook Touch ID"
                        className="flex-1"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit">Save</Button>
                        <Button type="button" variant="outline" tone="secondary" onClick={() => setRenamingPasskeyId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </RouterForm>
                  ) : (
                    <>
                      <div>
                        <Text tone="default"><strong className="font-medium">{label}</strong></Text>
                        {passkey.createdAt && (
                          <Text tone="muted" size="sm">Added {formatPasskeyDate(passkey.createdAt)}</Text>
                        )}
                      </div>
                      {isConfirming ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Text tone="muted" size="sm">Are you sure?</Text>
                          <RouterForm method="post" className="inline">
                            <input type="hidden" name="intent" value="removePasskey" />
                            <input type="hidden" name="credentialId" value={passkey.id} />
                            <Button
                              type="submit"
                              variant="soft" tone="destructive"
                              aria-label={`Confirm remove ${label}`}
                            >
                              Confirm
                            </Button>
                          </RouterForm>
                          <Button type="button" variant="outline" tone="secondary" onClick={() => setRemovingPasskeyId(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline" tone="secondary"
                            aria-label={`Rename ${label}`}
                            onClick={() => setRenamingPasskeyId(passkey.id)}
                          >
                            Rename
                          </Button>
                          <Button
                            type="button"
                            variant="outline" tone="secondary"
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
        <Text tone="muted" className="mt-1">A first-class fallback for any client, browser, or future importer.</Text>
        {passwordAnswer?.success && passwordAnswer.message ? (
          <div role="status" className="mt-4 text-sm text-[var(--sj-herb)]">{passwordAnswer.message}</div>
        ) : null}
        <div className="mt-4">
          {user.hasPassword ? (
            passwordFormState === "change" ? (
              <Form method="post" errors={newPasswordErrors} render={<passwordFetcher.Form />} className="gap-4">
                <input type="hidden" name="intent" value="changePassword" />
                <TextField label="Current password" type="password" name="currentPassword" autoComplete="current-password" />
                <TextField
                  label="New password"
                  description="Must be at least 8 characters"
                  type="password"
                  name="newPassword"
                  autoComplete="new-password"
                />
                <TextField label="Confirm password" type="password" name="confirmPassword" autoComplete="new-password" />
                <input type="hidden" name="connectionsChoice" value="1" />
                <Checkbox
                  label="Also sign out other devices and disconnect apps, agents and API tokens"
                  description="Recommended if someone else may know your old password. You stay signed in here."
                  name="revokeConnections"
                  value="1"
                  defaultChecked
                />
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" disabled={passwordFetcher.state !== "idle"} aria-busy={passwordFetcher.state !== "idle"}>
                    Change password
                  </Button>
                  <Button type="button" variant="outline" tone="secondary" onClick={cancelPasswordForm}>
                    Cancel
                  </Button>
                </div>
              </Form>
            ) : passwordFormState === "removeConfirm" ? (
              <div className="space-y-4">
                <Text tone="muted">Are you sure you want to remove your password? You will only be able to sign in using your linked OAuth accounts.</Text>
                <RouterForm method="post" className="grid gap-4">
                  <input type="hidden" name="intent" value="removePassword" />
                  <TextField label="Current password" type="password" name="currentPassword" autoComplete="current-password" />
                  <div className="flex flex-wrap gap-3">
                    <Button type="submit" variant="soft" tone="destructive">
                      Confirm
                    </Button>
                    <Button type="button" variant="outline" tone="secondary" onClick={() => setPasswordFormState("idle")}>
                      Cancel
                    </Button>
                  </div>
                </RouterForm>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="outline" tone="secondary" onClick={() => openPasswordForm("change")}>
                  Change password
                </Button>
                {canRemovePassword && (
                  <Button type="button" variant="soft" tone="destructive" onClick={() => setPasswordFormState("removeConfirm")}>
                    Remove password
                  </Button>
                )}
              </div>
            )
          ) : (
            passwordFormState === "set" ? (
              <Form method="post" errors={newPasswordErrors} render={<passwordFetcher.Form />} className="gap-4">
                <input type="hidden" name="intent" value="setPassword" />
                <TextField
                  label="New password"
                  description="Must be at least 8 characters"
                  type="password"
                  name="newPassword"
                  autoComplete="new-password"
                />
                <TextField label="Confirm password" type="password" name="confirmPassword" autoComplete="new-password" />
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" disabled={passwordFetcher.state !== "idle"} aria-busy={passwordFetcher.state !== "idle"}>
                    Set password
                  </Button>
                  <Button type="button" variant="outline" tone="secondary" onClick={cancelPasswordForm}>
                    Cancel
                  </Button>
                </div>
              </Form>
            ) : (
              <div>
                <Text tone="muted" className="mb-4">
                  You don't have a password set. Set one to enable email/password login.
                </Text>
                <Button type="button" variant="outline" tone="secondary" onClick={() => openPasswordForm("set")}>
                  Set password
                </Button>
              </div>
            )
          )}
        </div>

        <div className="mt-6 border-t border-[var(--sj-border)] pt-4" data-testid="sign-out-everywhere">
          <Text tone="default"><strong className="font-medium">Sign out everywhere</strong></Text>
          <Text tone="muted" size="sm" className="mt-1">
            Signs you out of every other browser and device, including the Spoonjoy iPhone app, and disconnects every app,
            agent and API token, including Claude. You stay signed in here; reconnect what you still use afterwards.
          </Text>
          {isConfirmingSignOutEverywhere ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Text tone="muted" size="sm">Are you sure?</Text>
              <RouterForm method="post" className="inline" onSubmit={() => setIsConfirmingSignOutEverywhere(false)}>
                <input type="hidden" name="intent" value="signOutEverywhere" />
                <Button type="submit" variant="soft" tone="destructive" aria-label="Confirm sign out everywhere">
                  Confirm
                </Button>
              </RouterForm>
              <Button type="button" variant="outline" tone="secondary" onClick={() => setIsConfirmingSignOutEverywhere(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="mt-3">
              <Button type="button" variant="outline" tone="secondary" onClick={() => setIsConfirmingSignOutEverywhere(true)}>
                Sign out everywhere
              </Button>
            </div>
          )}
        </div>
      </SettingsPanel>

      <NotificationsSection
        initiallySubscribed={notifications.pushSubscribed}
        initialPreferences={notifications.preferences}
      />

      <AccountDataSection
        username={user.username}
        hasPassword={user.hasPassword}
        deleteError={deleteAnswer}
      />
      </div>
    </CookbookPage>
  );
}
