import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import Terms, { meta } from "~/routes/terms";

describe("Terms route", () => {
  it("returns terms metadata", () => {
    expect(meta({} as any)).toEqual([
      { title: "Terms of Service | Spoonjoy" },
      { name: "description", content: "The terms for using Spoonjoy." },
    ]);
  });

  it("renders the terms with key sections and links to the privacy policy", async () => {
    const Stub = createTestRoutesStub([{ path: "/terms", Component: Terms }]);
    render(<Stub initialEntries={["/terms"]} />);

    expect(await screen.findByRole("heading", { name: "Terms of Service" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your content" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "API tokens and connectors" })).toBeInTheDocument();
    expect(screen.getByText(/you keep ownership of the recipes/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "ari@spoonjoy.app" })).toHaveAttribute(
      "href",
      "mailto:ari@spoonjoy.app",
    );
  });
});
