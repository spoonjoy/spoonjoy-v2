import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { ThemeProvider } from "~/components/ui/theme-provider";
import { AppNavbar } from "~/root";

function renderNavbar(userId: string | null = null, path = "/") {
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
    { initialEntries: [path] },
  );

  return render(
    <RouterProvider router={router} />,
  );
}

describe("AppNavbar", () => {
  it("clears cached cook progress when the cook logs out", async () => {
    window.localStorage.setItem("spoonjoy-cook-progress:user:user-1:recipe-1", "{}");
    window.localStorage.setItem("spoonjoy-cook-progress:recipe-1", "{}");
    window.localStorage.setItem("spoonjoy-theme", "dark");
    const router = createMemoryRouter(
      [
        {
          path: "/logout",
          action: () => null,
          element: <p>Signed out</p>,
        },
        {
          path: "*",
          element: (
            <ThemeProvider>
              <AppNavbar userId="user-1" />
            </ThemeProvider>
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => {
      expect(router.state.navigation.state).toBe("idle");
    });
    expect(window.localStorage.getItem("spoonjoy-cook-progress:user:user-1:recipe-1")).toBeNull();
    expect(window.localStorage.getItem("spoonjoy-cook-progress:recipe-1")).toBeNull();
    expect(window.localStorage.getItem("spoonjoy-theme")).toBe("dark");
    window.localStorage.clear();
  });

  it("uses the real Spoonjoy mark for the desktop brand", () => {
    const { container } = renderNavbar("chef-1");

    const brandLink = screen.getByRole("link", { name: /spoonjoy/i });
    expect(brandLink).toHaveAttribute("href", "/");
    expect(brandLink).toHaveAttribute("data-current", "true");

    const brandScope = within(brandLink);
    expect(brandScope.getByText("SPOONJOY")).toHaveClass("sj-desktop-brand-word");

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

  it("offers login as a desktop menu instead of a page-only nav link", async () => {
    renderNavbar();

    const loginButton = screen.getByRole("button", { name: "Login" });
    expect(loginButton).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Login" })).not.toBeInTheDocument();
  });

  it("uses clear signed-in kitchen drawer navigation", () => {
    renderNavbar("chef-1");

    expect(screen.getByRole("link", { name: "Kitchen" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "My Recipes" })).toHaveAttribute("href", "/my-recipes");
    expect(screen.getByRole("link", { name: "Saved" })).toHaveAttribute("href", "/saved-recipes");
    expect(screen.getByRole("link", { name: "Cookbooks" })).toHaveAttribute("href", "/cookbooks");
    expect(screen.getByRole("link", { name: "Shopping List" })).toHaveAttribute("href", "/shopping-list");
    expect(screen.getByRole("link", { name: "Chefs" })).toHaveAttribute("href", "/chefs");
    expect(screen.getByRole("link", { name: "Kitchen Search" })).toHaveAttribute("href", "/search");
    expect(screen.queryByRole("link", { name: "List" })).not.toBeInTheDocument();
  });

  it("lets signed-in cooks reach every public recipe from the desktop navigation", () => {
    renderNavbar("chef-1", "/recipes");

    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    const recipes = within(nav).getByRole("link", { name: "Recipes", exact: true });
    expect(recipes).toHaveAttribute("href", "/recipes");
    expect(recipes).toHaveAttribute("data-current", "true");
    expect(within(nav).getByRole("link", { name: "Kitchen" })).toHaveAttribute("data-current", "false");
    expect(within(nav).getByRole("link", { name: "My Recipes" })).toHaveAttribute("data-current", "false");

    const centerLinks = within(nav).getAllByRole("link").map((link) => link.textContent);
    expect(centerLinks.slice(1, 3)).toEqual(["Kitchen", "Recipes"]);
  });

  it("keeps Recipes unmarked on the kitchen home page", () => {
    renderNavbar("chef-1", "/");

    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(nav).getByRole("link", { name: "Recipes", exact: true })).toHaveAttribute("data-current", "false");
    expect(within(nav).getByRole("link", { name: "Kitchen" })).toHaveAttribute("data-current", "true");
  });
});
