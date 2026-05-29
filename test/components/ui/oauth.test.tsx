import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OAuthButtonGroup } from "~/components/ui/oauth";

describe("OAuthButtonGroup", () => {
  it("renders all providers by default", () => {
    render(<OAuthButtonGroup />);

    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeInTheDocument();
  });

  it("renders nothing when no providers are configured", () => {
    const { container } = render(<OAuthButtonGroup providers={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("posts to the bare provider route when no redirectTo is given", () => {
    render(<OAuthButtonGroup providers={["apple"]} />);

    const form = screen.getByRole("button", { name: "Continue with Apple" }).closest("form");
    expect(form).toHaveAttribute("action", "/auth/apple");
  });

  it("carries redirectTo into the provider form action so login returns to the connector", () => {
    const returnTo = "/oauth/authorize?client_id=abc&response_type=code";
    render(<OAuthButtonGroup providers={["apple"]} redirectTo={returnTo} />);

    const form = screen.getByRole("button", { name: "Continue with Apple" }).closest("form");
    expect(form).toHaveAttribute("action", `/auth/apple?redirectTo=${encodeURIComponent(returnTo)}`);
  });
});
