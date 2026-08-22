import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { OAuthButtonGroup } from "~/components/ui/oauth";

function renderOAuth(ui: ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("OAuthButtonGroup", () => {
  it("renders all providers by default", () => {
    renderOAuth(<OAuthButtonGroup />);

    expect(screen.getByRole("link", { name: "Continue with Google" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue with GitHub" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue with Apple" })).toBeInTheDocument();
  });

  it("renders nothing when no providers are configured", () => {
    const { container } = renderOAuth(<OAuthButtonGroup providers={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("targets the bare provider route when no redirectTo is given", () => {
    renderOAuth(<OAuthButtonGroup providers={["apple"]} />);

    expect(screen.getByRole("link", { name: "Continue with Apple" })).toHaveAttribute(
      "href",
      "/auth/apple",
    );
  });

  it("renders every provider as a forced full-document navigation", () => {
    renderOAuth(<OAuthButtonGroup providers={["google", "github", "apple"]} />);

    for (const [name, provider] of [
      ["Continue with Google", "google"],
      ["Continue with GitHub", "github"],
      ["Continue with Apple", "apple"],
    ] as const) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", `/auth/${provider}`);
      expect(link.closest("form")).toBeNull();
    }
  });

  it("encodes redirectTo exactly once into every provider href", () => {
    const returnTo = "/oauth/authorize?client_id=abc&response_type=code";
    renderOAuth(
      <OAuthButtonGroup providers={["google", "github", "apple"]} redirectTo={returnTo} />,
    );

    for (const [name, provider] of [
      ["Continue with Google", "google"],
      ["Continue with GitHub", "github"],
      ["Continue with Apple", "apple"],
    ] as const) {
      expect(screen.getByRole("link", { name })).toHaveAttribute(
        "href",
        `/auth/${provider}?redirectTo=${encodeURIComponent(returnTo)}`,
      );
    }
  });

  it.each([undefined, ""])("uses a bare provider href for redirectTo=%p", (redirectTo) => {
    renderOAuth(<OAuthButtonGroup providers={["apple"]} redirectTo={redirectTo} />);

    expect(screen.getByRole("link", { name: "Continue with Apple" })).toHaveAttribute(
      "href",
      "/auth/apple",
    );
  });
});
