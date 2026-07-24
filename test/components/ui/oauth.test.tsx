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

  it("targets the bare provider route when no redirectTo is given", () => {
    render(<OAuthButtonGroup providers={["apple"]} />);

    const form = screen.getByRole("button", { name: "Continue with Apple" }).closest("form");
    expect(form).toHaveAttribute("action", "/auth/apple");
  });

  // Regression guard for the P0 where every OAuth login silently did nothing.
  // Spoonjoy's service worker (public/sw.js) controls every client via
  // clients.claim(); a controlled client ABORTS a top-level navigation whose
  // response is a cross-origin redirect — exactly what OAuth start returns (a 302
  // to the provider). The SW resolves GET navigations in-worker but bypasses
  // POST, so a POST form aborted with net::ERR_ABORTED and the user stayed on the
  // login page. The OAuth form MUST submit as GET. Do not change this back to POST.
  it("submits OAuth start as a GET navigation so the service worker doesn't abort the provider redirect", () => {
    render(<OAuthButtonGroup providers={["google", "github", "apple"]} />);

    for (const name of ["Continue with Google", "Continue with GitHub", "Continue with Apple"]) {
      const form = screen.getByRole("button", { name }).closest("form");
      expect(form).toHaveAttribute("method", "get");
    }
  });

  it("carries redirectTo as a query param so login returns to the connector", () => {
    const returnTo = "/oauth/authorize?client_id=abc&response_type=code";
    render(<OAuthButtonGroup providers={["apple"]} redirectTo={returnTo} />);

    const form = screen.getByRole("button", { name: "Continue with Apple" }).closest("form");
    // GET form: the action stays bare and redirectTo rides as a hidden input that
    // the browser serializes into the query string (?redirectTo=...), which the
    // route loader reads exactly as the old POST action did.
    expect(form).toHaveAttribute("action", "/auth/apple");
    const hidden = form?.querySelector('input[name="redirectTo"]');
    expect(hidden).toHaveAttribute("value", returnTo);
  });
});
