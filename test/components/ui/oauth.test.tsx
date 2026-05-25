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
});
