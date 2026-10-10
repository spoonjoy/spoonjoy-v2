import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { MobileNav } from "~/components/navigation/mobile-nav";
import { DockContext } from "~/components/navigation";

function renderAt(path: string, isAuthenticated = true) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MobileNav isAuthenticated={isAuthenticated} />
    </MemoryRouter>,
  );
}

function tabBar() {
  return screen.getByRole("navigation", { name: "Spoonjoy navigation" });
}

function tabNames() {
  return within(tabBar())
    .getAllByRole("link")
    .map((link) => link.getAttribute("aria-label") ?? link.textContent?.trim());
}

function currentTab() {
  return within(tabBar())
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.getAttribute("aria-label") ?? link.textContent?.trim());
}

describe("MobileNav signed in", () => {
  it("is a phone-only bar of four labeled tabs plus Search in its own circle", () => {
    renderAt("/");

    expect(tabBar()).toHaveClass("lg:hidden");
    expect(tabNames()).toEqual(["Kitchen", "Recipes", "Cookbooks", "Shopping", "Search"]);
    expect(screen.getByRole("link", { name: "Kitchen" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Recipes" })).toHaveAttribute("href", "/my-recipes");
    expect(screen.getByRole("link", { name: "Cookbooks" })).toHaveAttribute("href", "/cookbooks");
    expect(screen.getByRole("link", { name: "Shopping" })).toHaveAttribute("href", "/shopping-list");
    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("href", "/search");
    // The four tabs share one list, each growing to an equal share of it.
    const items = within(tabBar()).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    for (const item of items) expect(item).toHaveClass("flex-1");
  });

  it("is the same on every page: no page actions, no buttons, no drawer", () => {
    for (const path of ["/", "/my-recipes", "/recipes/r-1", "/cookbooks/c-1", "/shopping-list", "/search", "/account/settings", "/users/someone"]) {
      const { unmount } = renderAt(path);
      expect(tabNames(), path).toEqual(["Kitchen", "Recipes", "Cookbooks", "Shopping", "Search"]);
      expect(within(tabBar()).queryAllByRole("button"), path).toEqual([]);
      unmount();
    }
  });

  it.each([
    ["/", "Kitchen"],
    ["/account/settings", "Kitchen"],
    ["/chefs", "Kitchen"],
    ["/users/someone", "Kitchen"],
    ["/my-recipes", "Recipes"],
    ["/saved-recipes", "Recipes"],
    ["/recipes", "Recipes"],
    ["/recipes/r-1", "Recipes"],
    ["/cookbooks", "Cookbooks"],
    ["/cookbooks/c-1", "Cookbooks"],
    ["/shopping-list", "Shopping"],
    ["/search", "Search"],
  ])("marks the tab that owns %s as current (%s)", (path, tab) => {
    renderAt(path);
    expect(currentTab()).toEqual([tab]);
  });

  it("marks no tab current on an unrelated page", () => {
    renderAt("/privacy");
    expect(currentTab()).toEqual([]);
  });

  it.each([
    "/recipes/new",
    "/cookbooks/new",
    "/recipes/r-1/edit",
    "/recipes/r-1/steps/new",
    "/recipes/r-1/steps/s-1/edit",
    "/oauth/authorize",
    "/logout",
  ])("stays out of %s", (path) => {
    renderAt(path);
    expect(screen.queryByRole("navigation", { name: "Spoonjoy navigation" })).not.toBeInTheDocument();
  });

  it("keeps the tab bar on a recipe whose id starts with \"edit\"", () => {
    renderAt("/recipes/editors-pick");
    expect(tabBar()).toBeInTheDocument();
  });

  it("hides while a page suppresses it", () => {
    render(
      <DockContext.Provider value={{ isSuppressed: true, setSuppressed: () => {} }}>
        <MemoryRouter initialEntries={["/"]}>
          <MobileNav />
        </MemoryRouter>
      </DockContext.Provider>,
    );
    expect(screen.queryByRole("navigation", { name: "Spoonjoy navigation" })).not.toBeInTheDocument();
  });

  it("draws the bar and the search circle on solid charcoal", () => {
    renderAt("/");
    expect(within(tabBar()).getByRole("list")).toHaveClass("bg-[var(--sj-photo-charcoal)]");
    expect(screen.getByRole("link", { name: "Search" })).toHaveClass("bg-[var(--sj-photo-charcoal)]");
    for (const element of [within(tabBar()).getByRole("list"), screen.getByRole("link", { name: "Search" })]) {
      expect(element.className).not.toMatch(/backdrop-blur|\/9\d\b/);
    }
  });
});

describe("MobileNav signed out", () => {
  it("offers Home, Recipes and Log in, plus Search", () => {
    renderAt("/", false);
    expect(tabNames()).toEqual(["Home", "Recipes", "Log in", "Search"]);
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Recipes" })).toHaveAttribute("href", "/recipes");
    expect(currentTab()).toEqual(["Home"]);
  });

  it("stays out of the login and signup pages", () => {
    for (const path of ["/login", "/signup"]) {
      const { unmount } = renderAt(path, false);
      expect(screen.queryByRole("navigation", { name: "Spoonjoy navigation" })).not.toBeInTheDocument();
      unmount();
    }
  });
});
