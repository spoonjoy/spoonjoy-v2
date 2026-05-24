import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { ThemeProvider } from "~/components/ui/theme-provider";
import { AppNavbar } from "~/root";

function renderNavbar(userId: string | null = null) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <ThemeProvider>
            <AppNavbar userId={userId} />
          </ThemeProvider>
        ),
      },
    ],
    { initialEntries: ["/"] },
  );

  return render(
    <RouterProvider router={router} />,
  );
}

describe("AppNavbar", () => {
  it("uses the real Spoonjoy mark for the desktop brand", () => {
    const { container } = renderNavbar("chef-1");

    const brandLink = screen.getByRole("link", { name: /spoonjoy/i });
    expect(brandLink).toHaveAttribute("href", "/");
    expect(brandLink).toHaveAttribute("data-current", "true");

    const brandScope = within(brandLink);
    expect(brandScope.getByText("Spoonjoy")).toHaveClass("sj-desktop-brand-word");

    const mark = brandLink.querySelector("svg.sj-desktop-brand-logo");
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveAttribute("data-slot", "icon");
    expect(mark).toHaveAttribute("viewBox", "0 0 500 300");

    expect(container.querySelector(".sj-nav-mark")).not.toBeInTheDocument();
  });

  it("keeps the unauthenticated desktop brand on the same real mark", () => {
    const { container } = renderNavbar();

    expect(screen.getByRole("link", { name: /spoonjoy/i })).toHaveAttribute("href", "/");
    expect(container.querySelector("svg.sj-desktop-brand-logo")).toBeInTheDocument();
    expect(container.querySelector(".sj-nav-mark")).not.toBeInTheDocument();
  });
});
