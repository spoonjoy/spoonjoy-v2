import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OuroProvider } from "~/lib/ouro/ouro-provider";
import { Link } from "~/components/ouro/link/link";
import { OuroRouterLink } from "~/components/navigation/ouro-router-link";
import { createTestRoutesStub } from "../../utils";

describe("OuroRouterLink", () => {
  it("makes an Ouro UI link navigate inside the app, without a page load", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/",
        Component: () => (
          <OuroProvider linkComponent={OuroRouterLink}>
            <Link href="/cookbooks" className="mt-2">Cookbooks</Link>
          </OuroProvider>
        ),
      },
      { path: "/cookbooks", Component: () => <h1>Your cookbooks</h1> },
    ]);
    render(<Stub initialEntries={["/"]} />);

    const link = await screen.findByRole("link", { name: "Cookbooks" });
    expect(link).toHaveAttribute("href", "/cookbooks");
    expect(link).toHaveClass("mt-2");

    fireEvent.click(link);
    expect(await screen.findByRole("heading", { name: "Your cookbooks" })).toBeInTheDocument();
  });
});
