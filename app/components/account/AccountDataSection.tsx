import { useMemo, useState } from "react";
import { Form as RouterForm } from "react-router";
import { Download } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Form, type FormErrors } from "~/components/ouro/form/form";
import { TextField } from "~/components/ouro/text-field/text-field";
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

// Which field a failed deletion's message belongs on; any other failure is about the whole form.
const DELETE_ERROR_FIELDS: Record<string, string> = {
  confirmation_mismatch: "confirmUsername",
  password_incorrect: "password",
  password_required: "password",
};

// "Your data": download everything as JSON, or delete the account. Deleting asks for the username
// typed back and, for an account with a password, that password; an account without one needs a
// recent sign-in, so its form offers "Sign in again".
export function AccountDataSection({ username, hasPassword, deleteError, defaultOpen = false }: AccountDataSectionProps) {
  const [isDeleting, setIsDeleting] = useState(defaultOpen || Boolean(deleteError));
  const [typedUsername, setTypedUsername] = useState("");
  const needsFreshSignIn = deleteError?.error === "recent_sign_in_required";
  const formErrors = useMemo<FormErrors | undefined>(() => {
    if (!deleteError?.message) return undefined;
    // An account without a password has no password field to put the message on.
    const field = DELETE_ERROR_FIELDS[deleteError.error ?? ""];
    return { [field && (field !== "password" || hasPassword) ? field : "form"]: deleteError.message };
  }, [deleteError, hasPassword]);

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
            <Form
              method="post"
              errors={formErrors}
              render={<RouterForm />}
              className="mt-4 gap-4"
              onSubmit={clearCookProgressCache}
            >
              <input type="hidden" name="intent" value="deleteAccount" />
              <TextField
                label={`Type your username, ${username}, to confirm`}
                name="confirmUsername"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={typedUsername}
                onChange={(event) => setTypedUsername(event.target.value)}
              />
              {hasPassword ? (
                <TextField label="Current password" type="password" name="password" autoComplete="current-password" />
              ) : needsFreshSignIn ? null : (
                // Neutral guidance before any attempt; a failed attempt's message replaces it.
                <Text className="text-sm/6">
                  Your account has no password, so you need to have signed in within the last 10 minutes. If it has
                  been longer, sign in again first.
                </Text>
              )}
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
            <RouterForm method="post" className="mt-3">
              <input type="hidden" name="intent" value="reauthenticate" />
              <Button type="submit" plain>
                Sign in again
              </Button>
            </RouterForm>
          ) : null}
        </div>
      </SettingsPanel>
    </div>
  );
}
