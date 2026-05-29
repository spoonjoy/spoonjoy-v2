import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import Privacy, { meta } from "~/routes/privacy";

describe("Privacy route", () => {
  it("returns privacy metadata", () => {
    expect(meta({} as any)).toEqual([
      { title: "Privacy Policy | Spoonjoy" },
      { name: "description", content: "How Spoonjoy collects, uses, and protects your data." },
    ]);
  });

  it("renders the policy with key sections and a contact link", async () => {
    const Stub = createTestRoutesStub([{ path: "/privacy", Component: Privacy }]);
    render(<Stub initialEntries={["/privacy"]} />);

    expect(await screen.findByRole("heading", { name: "Privacy Policy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Information we collect" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Service providers we rely on" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your choices" })).toBeInTheDocument();
    expect(screen.getByText(/share it for advertising/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ari@spoonjoy.app" })).toHaveAttribute(
      "href",
      "mailto:ari@spoonjoy.app",
    );
  });
});
