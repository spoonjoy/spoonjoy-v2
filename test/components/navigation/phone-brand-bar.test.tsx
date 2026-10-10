import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { PhoneBrandBar } from "~/components/navigation/phone-brand-bar";

function renderBar() {
  const router = createMemoryRouter([{ path: "*", element: <PhoneBrandBar /> }], { initialEntries: ["/recipes/r1"] });
  return render(<RouterProvider router={router} />);
}

describe("PhoneBrandBar", () => {
  it("names Spoonjoy and links home, so a visitor from a shared link knows whose site this is", () => {
    renderBar();

    const bar = screen.getByTestId("phone-brand-bar");
    const home = within(bar).getByRole("link", { name: "Spoonjoy" });
    expect(home).toHaveAttribute("href", "/");
    expect(home.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("offers sign-up from the first screen", () => {
    renderBar();

    expect(within(screen.getByTestId("phone-brand-bar")).getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/signup");
  });

  it("shows only below the desktop breakpoint and never in print", () => {
    renderBar();

    const bar = screen.getByTestId("phone-brand-bar");
    expect(bar).toHaveClass("lg:hidden", "print:hidden", "sj-phone-brandbar");
  });
});
