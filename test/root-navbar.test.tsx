import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { ColorSchemeProvider } from "~/lib/ouro/color-scheme";
import type { OAuthProvider } from "~/lib/env.server";
import { AppNavbar } from "~/root";

function renderNavbar(userId: string | null = null, path = "/", oauthProviders: OAuthProvider[] = [], cookingNowCount?: number) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <ColorSchemeProvider storageKey="spoonjoy-theme">
            <AppNavbar userId={userId} oauthProviders={oauthProviders} cookingNowCount={cookingNowCount} />
          </ColorSchemeProvider>
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
            <ColorSchemeProvider storageKey="spoonjoy-theme">
              <AppNavbar userId="user-1" />
            </ColorSchemeProvider>
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
    expect(within(brandLink).getByText("SPOONJOY")).toBeInTheDocument();
    expect(brandLink.closest('[data-ouro="navbar"]')).not.toBeNull();

    const mark = brandLink.querySelector("svg");
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveAttribute("data-slot", "icon");
    expect(mark).toHaveAttribute("viewBox", "0 0 500 300");

    expect(container.querySelector(".sj-nav-mark")).not.toBeInTheDocument();
  });

  it("keeps the unauthenticated desktop brand on the same real mark", () => {
    const { container } = renderNavbar();

    expect(screen.getByRole("link", { name: /spoonjoy/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /spoonjoy/i }).querySelector('svg[viewBox="0 0 500 300"]')).toBeInTheDocument();
    expect(container.querySelector(".sj-nav-mark")).not.toBeInTheDocument();
  });

  it("offers login as a desktop menu instead of a page-only nav link", async () => {
    renderNavbar();

    const loginButton = screen.getByRole("button", { name: "Log in" });
    expect(loginButton).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
  });

  it("signs in from an HX Popover with the password and signup ways in", async () => {
    renderNavbar();

    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    const popover = await screen.findByRole("dialog", { name: "Sign in to SPOONJOY" });
    expect(within(popover).getByText(/OAuth is not configured here/)).toBeInTheDocument();
    expect(within(popover).getByRole("link", { name: "Use Password" })).toHaveAttribute("href", "/login");
    expect(within(popover).getByRole("link", { name: "Create Account" })).toHaveAttribute("href", "/signup");
  });

  it("offers the configured providers in the sign-in popover", async () => {
    renderNavbar(null, "/", ["github"]);

    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    const popover = await screen.findByRole("dialog", { name: "Sign in to SPOONJOY" });
    expect(within(popover).queryByText(/OAuth is not configured here/)).not.toBeInTheDocument();
    expect(within(popover).getByRole("link", { name: /GitHub/i })).toHaveAttribute("href", expect.stringContaining("github"));
  });

  it("marks Account as the current page in account settings", () => {
    renderNavbar("chef-1", "/account/settings");

    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("aria-current", "page");
  });

  it("marks no link on a page outside the bar", () => {
    renderNavbar("chef-1", "/privacy");

    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(nav).getAllByRole("link").filter((link) => link.hasAttribute("aria-current"))).toEqual([]);
    expect(screen.getByRole("link", { name: "Account" })).not.toHaveAttribute("aria-current");
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
    expect(recipes).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Kitchen" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "My Recipes" })).not.toHaveAttribute("aria-current");

    const centerLinks = within(nav).getAllByRole("link").map((link) => link.textContent);
    expect(centerLinks.slice(0, 2)).toEqual(["Kitchen", "Recipes"]);
  });

  it("keeps Recipes unmarked on the kitchen home page", () => {
    renderNavbar("chef-1", "/");

    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(nav).getByRole("link", { name: "Recipes", exact: true })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "Kitchen" })).toHaveAttribute("aria-current", "page");
  });

  it("shows the Cooking pill, signed in or out, only with something in progress", () => {
    const { unmount } = renderNavbar("user-1", "/recipes", [], 3);
    expect(screen.getByRole("link", { name: "Cooking · 3" })).toHaveAttribute("href", "/#cooking-now");
    unmount();

    const signedOut = renderNavbar(null, "/", [], 1);
    expect(screen.getByRole("link", { name: "Cooking · 1" })).toBeInTheDocument();
    signedOut.unmount();

    renderNavbar("user-1");
    expect(screen.queryByTestId("cooking-now-pill")).toBeNull();
  });
});
