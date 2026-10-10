import { useState } from "react";
import { Form } from "react-router";
import { Download } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Field, Label } from "~/components/ui/fieldset";
import { Input } from "~/components/ui/input";
import { Text, TextLink } from "~/components/ui/text";
import { SettingsPanel } from "~/components/cookbook/page";
import { clearCookProgressCache } from "~/lib/cook-session-sync";

export interface AccountDataSectionProps {
  username: string;
  hasPassword: boolean;
  /** The result of the last deleteAccount submission, if it failed. */
  deleteError?: { error?: string; message?: string } | null;
  /** Open the deletion form on first render (Storybook). */
  defaultOpen?: boolean;
}

// "Your data": download everything as JSON, or delete the account. Deleting asks for the username
// typed back and, for an account with a password, that password; an account without one needs a
// recent sign-in, so its form offers "Sign in again".
export function AccountDataSection({ username, hasPassword, deleteError, defaultOpen = false }: AccountDataSectionProps) {
  const [isDeleting, setIsDeleting] = useState(defaultOpen || Boolean(deleteError));
  const [typedUsername, setTypedUsername] = useState("");
  const needsFreshSignIn = deleteError?.error === "recent_sign_in_required";

  return (
    <div id="delete-account">
      <SettingsPanel testId="account-data-section" title="Your data">
        <Text>
          Download everything you've put into Spoonjoy: your recipes with their steps and ingredients, cookbooks,
          shopping list, cooks and photo links, as one JSON file.
        </Text>
        <div className="mt-3">
          <Button href="/account/export" plain reloadDocument download>
            <Download data-slot="icon" className="size-4" />
            Download my data
          </Button>
        </div>

        <div className="mt-6 border-t border-[var(--sj-border)] pt-4" data-testid="delete-account">
          <Text className="font-medium text-[var(--sj-ink)]">Delete account</Text>
          <Text className="mt-1 text-sm/6">
            Permanently deletes your account, recipes, cookbooks, shopping list, cooks and photos, and signs out every
            app and agent you connected. Recipes other cooks forked, saved or cooked stay up,
            credited to a “Deleted chef” placeholder; their forks stay theirs. This can't be undone, so download your data first if you want a copy.
          </Text>
          <TextLink href="/privacy#deletion" className="text-sm">What gets deleted</TextLink>
          {isDeleting ? (
            <Form method="post" className="mt-4 space-y-4" onSubmit={clearCookProgressCache}>
              <input type="hidden" name="intent" value="deleteAccount" />
              <Field>
                <Label>Type your username, {username}, to confirm</Label>
                <Input
                  type="text"
                  name="confirmUsername"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={typedUsername}
                  onChange={(event) => setTypedUsername(event.target.value)}
                  invalid={deleteError?.error === "confirmation_mismatch"}
                />
              </Field>
              {hasPassword ? (
                <Field>
                  <Label>Current password</Label>
                  <Input
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    invalid={deleteError?.error === "password_incorrect" || deleteError?.error === "password_required"}
                  />
                </Field>
              ) : needsFreshSignIn ? null : (
                // Neutral guidance before any attempt; a failed attempt's message replaces it.
                <Text className="text-sm/6">
                  Your account has no password, so you need to have signed in within the last 10 minutes. If it has
                  been longer, sign in again first.
                </Text>
              )}
              {deleteError?.message ? (
                <Text role="alert" className="text-sm text-[var(--sj-tomato)]">{deleteError.message}</Text>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button type="submit" variant="destructive" disabled={typedUsername.trim() !== username}>
                  Delete my account
                </Button>
                <Button type="button" plain onClick={() => setIsDeleting(false)}>
                  Cancel
                </Button>
              </div>
            </Form>
          ) : (
            <div className="mt-3">
              <Button type="button" variant="destructive" onClick={() => setIsDeleting(true)}>
                Delete account…
              </Button>
            </div>
          )}
          {isDeleting && !hasPassword ? (
            <Form method="post" className="mt-3">
              <input type="hidden" name="intent" value="reauthenticate" />
              <Button type="submit" plain>
                Sign in again
              </Button>
            </Form>
          ) : null}
        </div>
      </SettingsPanel>
    </div>
  );
}
