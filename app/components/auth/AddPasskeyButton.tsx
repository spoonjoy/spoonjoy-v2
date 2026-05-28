/**
 * "Add a passkey" control for account settings.
 *
 * Prompts the authenticator to create a new passkey for the logged-in user
 * and registers it server-side. Shows inline success / error status.
 *
 * WebAuthn support is resolved after mount (not during render) so the
 * server render and the first client render agree — the support check is
 * false on the server and true in a capable browser, so checking it during
 * render would cause a hydration mismatch. Renders nothing until resolved,
 * then either the button (supported) or an explainer (unsupported).
 */

import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import {
  browserSupportsPasskeys,
  registerPasskey,
} from "~/lib/webauthn-client";

export interface AddPasskeyButtonProps {
  /** Test seam: override the support check. */
  supportsPasskeys?: boolean;
  /** Called after a passkey is successfully added (e.g. to refresh a list). */
  onAdded?: () => void;
}

export function AddPasskeyButton({ supportsPasskeys, onAdded }: AddPasskeyButtonProps) {
  const [support, setSupport] = useState<"unknown" | "supported" | "unsupported">("unknown");
  const [status, setStatus] = useState<"idle" | "pending" | "added">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupport(
      (supportsPasskeys ?? browserSupportsPasskeys()) ? "supported" : "unsupported",
    );
  }, [supportsPasskeys]);

  if (support === "unknown") return null;
  if (support === "unsupported") {
    return (
      <Text className="text-sm text-[var(--sj-ink-muted)]">
        This browser doesn't support passkeys.
      </Text>
    );
  }

  async function handleClick() {
    setError(null);
    setStatus("pending");
    const result = await registerPasskey();
    if (result.ok) {
      setStatus("added");
      onAdded?.();
    } else {
      setStatus("idle");
      setError(result.error);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" disabled={status === "pending"} onClick={handleClick}>
        {status === "pending" ? "Waiting for passkey…" : "Add a passkey"}
      </Button>
      {status === "added" && (
        <Text className="text-sm text-[var(--sj-pesto,#4a7c59)]" role="status">
          Passkey added. You can now sign in with it.
        </Text>
      )}
      {error && (
        <Text className="text-sm text-[var(--sj-tomato)]" role="alert">
          {error}
        </Text>
      )}
    </div>
  );
}
