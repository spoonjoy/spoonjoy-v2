/**
 * "Sign in with a passkey" control for the login page.
 *
 * Username-first flow: the user enters their email, clicks the button, and
 * the browser prompts for their passkey. On success the server sets a
 * session cookie and we navigate to the post-login destination.
 *
 * Renders nothing if the browser doesn't support WebAuthn.
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { Field, Label, ErrorMessage } from "~/components/ui/fieldset";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import {
  authenticatePasskey,
  browserSupportsPasskeys,
} from "~/lib/webauthn-client";

export interface PasskeySignInButtonProps {
  redirectTo?: string;
  /** Test seam: override the support check. */
  supportsPasskeys?: boolean;
  /** Test seam: override the navigate function. */
  onNavigate?: (to: string) => void;
}

export function PasskeySignInButton({
  redirectTo,
  supportsPasskeys,
  onNavigate,
}: PasskeySignInButtonProps) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "pending">("idle");
  const [error, setError] = useState<string | null>(null);

  const supported = supportsPasskeys ?? browserSupportsPasskeys();
  if (!supported) return null;

  const go = (to: string) => (onNavigate ? onNavigate(to) : navigate(to));

  async function handleClick() {
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email to use a passkey.");
      return;
    }

    setStatus("pending");
    const result = await authenticatePasskey(trimmed, redirectTo);
    setStatus("idle");

    if (result.ok) {
      go(result.redirectTo || "/");
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="space-y-3">
      <Field>
        <Label htmlFor="passkey-email">Email</Label>
        <Input
          type="email"
          id="passkey-email"
          name="passkey-email"
          autoComplete="username webauthn"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          invalid={!!error}
        />
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </Field>
      <Button
        type="button"
        plain
        className="w-full"
        disabled={status === "pending"}
        onClick={handleClick}
      >
        {status === "pending" ? "Waiting for passkey…" : "Sign in with a passkey"}
      </Button>
    </div>
  );
}
