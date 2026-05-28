import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/webauthn-client", () => ({
  registerPasskey: vi.fn(),
  browserSupportsPasskeys: vi.fn(() => true),
}));

import { AddPasskeyButton } from "~/components/auth/AddPasskeyButton";
import { registerPasskey } from "~/lib/webauthn-client";

describe("AddPasskeyButton", () => {
  it("shows an unsupported message when passkeys aren't available", () => {
    render(<AddPasskeyButton supportsPasskeys={false} />);
    expect(screen.getByText(/doesn't support passkeys/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add a passkey/i })).not.toBeInTheDocument();
  });

  it("registers a passkey and shows success + fires onAdded", async () => {
    vi.mocked(registerPasskey).mockResolvedValue({ ok: true });
    const onAdded = vi.fn();
    render(<AddPasskeyButton supportsPasskeys onAdded={onAdded} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /add a passkey/i }));

    expect(registerPasskey).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toHaveTextContent(/passkey added/i);
    expect(onAdded).toHaveBeenCalledTimes(1);
  });

  it("shows an error when registration fails", async () => {
    vi.mocked(registerPasskey).mockResolvedValue({ ok: false, error: "bad attestation" });
    render(<AddPasskeyButton supportsPasskeys />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /add a passkey/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("bad attestation");
  });

  it("works without an onAdded callback", async () => {
    vi.mocked(registerPasskey).mockResolvedValue({ ok: true });
    render(<AddPasskeyButton supportsPasskeys />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /add a passkey/i }));
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("falls back to the real support check when no prop is given", () => {
    vi.mocked(
      // browserSupportsPasskeys is mocked to return true at module level
      registerPasskey,
    );
    render(<AddPasskeyButton />);
    // mocked browserSupportsPasskeys() returns true → button renders
    expect(screen.getByRole("button", { name: /add a passkey/i })).toBeInTheDocument();
  });
});
