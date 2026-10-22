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
import { TextField } from "~/components/ouro/text-field/text-field";
import { Button } from "~/components/button";
import { Text } from "~/components/ouro/text/text";
import {
  browserSupportsPasskeys,
  registerPasskey,
} from "~/lib/webauthn-client";

export interface AddPasskeyButtonProps {
  /** Test seam: override the support check. */
  supportsPasskeys?: boolean;
  /** Called after a passkey is successfully added (e.g. to refresh the list). */
  onAdded?: () => void;
}

export function AddPasskeyButton({ supportsPasskeys, onAdded }: AddPasskeyButtonProps) {
  const [support, setSupport] = useState<"unknown" | "supported" | "unsupported">("unknown");
  const [status, setStatus] = useState<"idle" | "pending" | "added">("idle");
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    setSupport(
      (supportsPasskeys ?? browserSupportsPasskeys()) ? "supported" : "unsupported",
    );
  }, [supportsPasskeys]);

  if (support === "unknown") return null;
  if (support === "unsupported") {
    return (
      <Text size="sm" tone="default">
        This browser doesn't support passkeys.
      </Text>
    );
  }

  async function handleClick() {
    setError(null);
    setStatus("pending");
    const result = await registerPasskey({ name: name.trim() || undefined });
    if (result.ok) {
      setStatus("added");
      setName("");
      onAdded?.();
    } else {
      setStatus("idle");
      setError(result.error);
    }
  }

  return (
    <div className="grid gap-3 [--success:var(--sj-pesto,#4a7c59)]">
      <TextField
        label="Name (optional)"
        name="passkey-name"
        placeholder="e.g. MacBook Touch ID"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button type="button" className="justify-self-start" disabled={status === "pending"} onClick={handleClick}>
        {status === "pending" ? "Waiting for passkey…" : "Add a passkey"}
      </Button>
      {status === "added" && (
        <Text size="sm" tone="success" role="status">
          Passkey added. You can now sign in with it.
        </Text>
      )}
      {error && (
        <Text size="sm" tone="destructive" role="alert">
          {error}
        </Text>
      )}
    </div>
  );
}
