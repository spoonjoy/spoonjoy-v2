/**
 * "Sign in with a passkey" control for the login page.
 *
 * Username-first flow: the email comes from the login form's single shared
 * email field (passed in as a prop). Clicking prompts the authenticator; on
 * success the server sets a session cookie and we navigate to the
 * post-login destination.
 *
 * WebAuthn support is detected after mount (not during render) so the
 * server render and the first client render agree. The support check is
 * false on the server (no `window.PublicKeyCredential`) and true in a
 * capable browser — checking it during render would cause a hydration
 * mismatch. We render nothing until mounted + supported.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import {
  authenticatePasskey,
  browserSupportsPasskeys,
} from "~/lib/webauthn-client";

export interface PasskeySignInButtonProps {
  /** Email from the login form's shared email field. */
  email: string;
  redirectTo?: string;
  /** Test seam: override the support check. */
  supportsPasskeys?: boolean;
  /** Test seam: override the navigate function. */
  onNavigate?: (to: string) => void;
}

export function PasskeySignInButton({
  email,
  redirectTo,
  supportsPasskeys,
  onNavigate,
}: PasskeySignInButtonProps) {
  const navigate = useNavigate();
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<"idle" | "pending">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported(supportsPasskeys ?? browserSupportsPasskeys());
  }, [supportsPasskeys]);

  if (!supported) return null;

  const go = (to: string) => (onNavigate ? onNavigate(to) : navigate(to));

  async function handleClick() {
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email above to use a passkey.");
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
    <div className="space-y-2">
      <Button
        type="button"
        plain
        className="w-full"
        disabled={status === "pending"}
        onClick={handleClick}
      >
        {status === "pending" ? "Waiting for passkey…" : "Sign in with a passkey"}
      </Button>
      {error && (
        <Text className="text-sm text-[var(--sj-tomato)]" role="alert">
          {error}
        </Text>
      )}
    </div>
  );
}
