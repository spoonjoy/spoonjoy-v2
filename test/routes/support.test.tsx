import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import Support, { meta } from "~/routes/support";

describe("/support", () => {
  it("declares support metadata", () => {
    expect(meta({} as never)).toEqual([
      { title: "Support | Spoonjoy" },
      { name: "description", content: "Get help with Spoonjoy: contact us, delete your account, report content and export your data." },
    ]);
  });

  it("gives the contact address and answers account, report and export questions", async () => {
    const Stub = createTestRoutesStub([{ path: "/support", Component: Support }]);
    render(<Stub initialEntries={["/support"]} />);

    expect(await screen.findByRole("heading", { name: "Support", level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "ari@spoonjoy.app" })[0]).toHaveAttribute("href", "mailto:ari@spoonjoy.app");
    expect(screen.getByRole("heading", { name: "How do I delete my account?" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How do I report something or block a chef?" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How do I export my data?" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings, Blocked chefs" })).toHaveAttribute("href", "/account/settings#blocked-chefs");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
  });
});
