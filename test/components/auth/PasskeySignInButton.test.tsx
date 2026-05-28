import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestRoutesStub } from "../../utils";

vi.mock("~/lib/webauthn-client", () => ({
  authenticatePasskey: vi.fn(),
  browserSupportsPasskeys: vi.fn(() => true),
}));

import { PasskeySignInButton, type PasskeySignInButtonProps } from "~/components/auth/PasskeySignInButton";
import { authenticatePasskey } from "~/lib/webauthn-client";

function renderButton(props: Partial<PasskeySignInButtonProps> = {}) {
  const finalProps: PasskeySignInButtonProps = { email: "", ...props };
  const Stub = createTestRoutesStub([
    { path: "/", Component: () => <PasskeySignInButton {...finalProps} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

const queryButton = () => screen.queryByRole("button", { name: /sign in with a passkey/i });
const findButton = () => screen.findByRole("button", { name: /sign in with a passkey/i });

describe("PasskeySignInButton", () => {
  beforeEach(() => {
    vi.mocked(authenticatePasskey).mockReset();
  });

  it("renders nothing when passkeys aren't supported", () => {
    renderButton({ supportsPasskeys: false });
    // After the mount effect resolves support to false, nothing renders.
    expect(queryButton()).not.toBeInTheDocument();
  });

  it("renders the button once mounted + supported", async () => {
    renderButton({ supportsPasskeys: true, email: "chef@example.com" });
    expect(await findButton()).toBeInTheDocument();
  });

  it("requires an email before starting the ceremony", async () => {
    renderButton({ supportsPasskeys: true, email: "" });
    const user = userEvent.setup();
    await user.click(await findButton());
    expect(screen.getByText(/enter your email above/i)).toBeInTheDocument();
    expect(authenticatePasskey).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only email as empty", async () => {
    renderButton({ supportsPasskeys: true, email: "   " });
    const user = userEvent.setup();
    await user.click(await findButton());
    expect(screen.getByText(/enter your email above/i)).toBeInTheDocument();
    expect(authenticatePasskey).not.toHaveBeenCalled();
  });

  it("authenticates and navigates to the returned redirect", async () => {
    vi.mocked(authenticatePasskey).mockResolvedValue({ ok: true, redirectTo: "/recipes" });
    const onNavigate = vi.fn();
    renderButton({ supportsPasskeys: true, onNavigate, email: "chef@example.com", redirectTo: "/cookbooks" });

    const user = userEvent.setup();
    await user.click(await findButton());

    expect(authenticatePasskey).toHaveBeenCalledWith("chef@example.com", "/cookbooks");
    expect(onNavigate).toHaveBeenCalledWith("/recipes");
  });

  it("navigates home when the server returns no redirect", async () => {
    vi.mocked(authenticatePasskey).mockResolvedValue({ ok: true });
    const onNavigate = vi.fn();
    renderButton({ supportsPasskeys: true, onNavigate, email: "chef@example.com" });

    const user = userEvent.setup();
    await user.click(await findButton());

    expect(onNavigate).toHaveBeenCalledWith("/");
  });

  it("shows an error when authentication fails", async () => {
    vi.mocked(authenticatePasskey).mockResolvedValue({ ok: false, error: "Unknown credential" });
    const onNavigate = vi.fn();
    renderButton({ supportsPasskeys: true, onNavigate, email: "chef@example.com" });

    const user = userEvent.setup();
    await user.click(await findButton());

    expect(await screen.findByText("Unknown credential")).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("trims whitespace from the email", async () => {
    vi.mocked(authenticatePasskey).mockResolvedValue({ ok: true, redirectTo: "/" });
    const onNavigate = vi.fn();
    renderButton({ supportsPasskeys: true, onNavigate, email: "  chef@example.com  " });

    const user = userEvent.setup();
    await user.click(await findButton());

    expect(authenticatePasskey).toHaveBeenCalledWith("chef@example.com", undefined);
  });

  it("falls back to the real support check + navigate when seams omitted", async () => {
    // browserSupportsPasskeys mocked true → renders. No onNavigate → uses
    // router navigate (no-op in the stub). authenticatePasskey resolves ok.
    vi.mocked(authenticatePasskey).mockResolvedValue({ ok: true, redirectTo: "/recipes" });
    renderButton({ email: "chef@example.com" });
    const user = userEvent.setup();
    await user.click(await findButton());
    expect(authenticatePasskey).toHaveBeenCalled();
  });
});
