import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestRoutesStub } from "../../utils";

vi.mock("~/lib/webauthn-client", () => ({
  authenticatePasskey: vi.fn(),
  browserSupportsPasskeys: vi.fn(() => true),
}));

import { PasskeySignInButton, type PasskeySignInButtonProps } from "~/components/auth/PasskeySignInButton";
import { authenticatePasskey } from "~/lib/webauthn-client";

type RenderOptions = Partial<PasskeySignInButtonProps> & {
  /** Initial value of the identifier field the button reads. */
  identifier?: string;
};

// Renders the button next to a real identifier field, as on the login page.
function renderButton({ identifier = "", ...props }: RenderOptions = {}) {
  function Harness() {
    const identifierRef = useRef<HTMLInputElement>(null);
    return (
      <>
        <input aria-label="Username or email" ref={identifierRef} defaultValue={identifier} />
        <PasskeySignInButton identifierRef={identifierRef} {...props} />
      </>
    );
  }
  const Stub = createTestRoutesStub([
    { path: "/", Component: Harness },
    { path: "/recipes", Component: () => <div>Recipes</div> },
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
    renderButton({ supportsPasskeys: true, identifier: "chef@example.com" });
    expect(await findButton()).toBeInTheDocument();
  });

  it("requires an identifier before starting the ceremony", async () => {
    renderButton({ supportsPasskeys: true, identifier: "" });
    const user = userEvent.setup();
    await user.click(await findButton());
    expect(screen.getByText(/enter your username or email above/i)).toBeInTheDocument();
    expect(authenticatePasskey).not.toHaveBeenCalled();
  });

  it("treats a missing identifier field as empty", async () => {
    renderButton({ supportsPasskeys: true, identifierRef: { current: null } });
    const user = userEvent.setup();
    await user.click(await findButton());
    expect(screen.getByText(/enter your username or email above/i)).toBeInTheDocument();
    expect(authenticatePasskey).not.toHaveBeenCalled();
  });

  it("reads the field when clicked, including a value set without an input event", async () => {
    // iOS Keychain and password managers can fill the field without firing an
    // event React sees, so the button must read the live DOM value.
    vi.mocked(authenticatePasskey).mockResolvedValue({ ok: true, redirectTo: "/recipes" });
    const onNavigate = vi.fn();
    renderButton({ supportsPasskeys: true, onNavigate });

    const button = await findButton();
    (screen.getByLabelText("Username or email") as HTMLInputElement).value = "autofilled_chef";
    const user = userEvent.setup();
    await user.click(button);

    expect(authenticatePasskey).toHaveBeenCalledWith("autofilled_chef", undefined);
    expect(onNavigate).toHaveBeenCalledWith("/recipes");
  });

  it("treats a whitespace-only identifier as empty", async () => {
    renderButton({ supportsPasskeys: true, identifier: "   " });
    const user = userEvent.setup();
    await user.click(await findButton());
    expect(screen.getByText(/enter your username or email above/i)).toBeInTheDocument();
    expect(authenticatePasskey).not.toHaveBeenCalled();
  });

  it("authenticates and navigates to the returned redirect", async () => {
    vi.mocked(authenticatePasskey).mockResolvedValue({ ok: true, redirectTo: "/recipes" });
    const onNavigate = vi.fn();
    renderButton({ supportsPasskeys: true, onNavigate, identifier: "chef@example.com", redirectTo: "/cookbooks" });

    const user = userEvent.setup();
    await user.click(await findButton());

    expect(authenticatePasskey).toHaveBeenCalledWith("chef@example.com", "/cookbooks");
    expect(onNavigate).toHaveBeenCalledWith("/recipes");
  });

  it("authenticates with a username identifier", async () => {
    vi.mocked(authenticatePasskey).mockResolvedValue({ ok: true, redirectTo: "/recipes" });
    const onNavigate = vi.fn();
    renderButton({ supportsPasskeys: true, onNavigate, identifier: "chef_username" });

    const user = userEvent.setup();
    await user.click(await findButton());

    expect(authenticatePasskey).toHaveBeenCalledWith("chef_username", undefined);
    expect(onNavigate).toHaveBeenCalledWith("/recipes");
  });

  it("navigates home when the server returns no redirect", async () => {
    vi.mocked(authenticatePasskey).mockResolvedValue({ ok: true });
    const onNavigate = vi.fn();
    renderButton({ supportsPasskeys: true, onNavigate, identifier: "chef@example.com" });

    const user = userEvent.setup();
    await user.click(await findButton());

    expect(onNavigate).toHaveBeenCalledWith("/");
  });

  it("shows an error when authentication fails", async () => {
    vi.mocked(authenticatePasskey).mockResolvedValue({ ok: false, error: "Unknown credential" });
    const onNavigate = vi.fn();
    renderButton({ supportsPasskeys: true, onNavigate, identifier: "chef@example.com" });

    const user = userEvent.setup();
    await user.click(await findButton());

    expect(await screen.findByText("Unknown credential")).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("trims whitespace from the identifier", async () => {
    vi.mocked(authenticatePasskey).mockResolvedValue({ ok: true, redirectTo: "/" });
    const onNavigate = vi.fn();
    renderButton({ supportsPasskeys: true, onNavigate, identifier: "  chef@example.com  " });

    const user = userEvent.setup();
    await user.click(await findButton());

    expect(authenticatePasskey).toHaveBeenCalledWith("chef@example.com", undefined);
  });

  it("falls back to the real support check + navigate when seams omitted", async () => {
    // browserSupportsPasskeys mocked true → renders. No onNavigate → uses
    // router navigate (no-op in the stub). authenticatePasskey resolves ok.
    vi.mocked(authenticatePasskey).mockResolvedValue({ ok: true, redirectTo: "/recipes" });
    renderButton({ identifier: "chef@example.com" });
    const user = userEvent.setup();
    await user.click(await findButton());
    expect(authenticatePasskey).toHaveBeenCalled();
  });
});
