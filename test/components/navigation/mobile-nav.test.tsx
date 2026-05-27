import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ArrowLeft, Edit, Share2 } from "lucide-react";
import { MobileNav } from "~/components/navigation/mobile-nav";
import { DockContext, DockContextProvider, type DockAction } from "~/components/navigation";

describe("MobileNav unauthenticated variant", () => {
  it("renders a mobile-only Spoonjoy dock", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <MobileNav isAuthenticated={false} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation")).toHaveClass("lg:hidden");
    expect(screen.getByRole("navigation")).toHaveAccessibleName("Spoonjoy navigation");
  });

  it("shows public place, login primary action, and search tool", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <MobileNav isAuthenticated={false} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /spoonjoy public/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /log in/i })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: /search/i })).toHaveAttribute("href", "/search");
    expect(screen.queryByRole("link", { name: /create recipe/i })).not.toBeInTheDocument();
  });

  it("does not render the floating dock on auth routes", () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <MobileNav isAuthenticated={false} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("navigation", { name: "Spoonjoy navigation" })).not.toBeInTheDocument();
  });
});

describe("MobileNav", () => {
  describe("root cookbook dock", () => {
    it("renders the approved place / primary / tools structure", () => {
      render(
        <MemoryRouter initialEntries={["/"]}>
          <MobileNav />
        </MemoryRouter>,
      );

      expect(screen.getByRole("link", { name: /kitchen home/i })).toHaveAttribute("href", "/");
      expect(screen.getByTestId("dock-center")).toContainElement(
        screen.getByRole("link", { name: /create recipe/i }),
      );
      expect(screen.getByRole("link", { name: /search/i })).toHaveAttribute("href", "/search");
      expect(screen.getByRole("link", { name: /shopping list/i })).toHaveAttribute("href", "/shopping-list");
      expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute("href", "/account/settings");
    });

    it("does not render the old dashboard navigation labels", () => {
      render(
        <MemoryRouter initialEntries={["/"]}>
          <MobileNav />
        </MemoryRouter>,
      );

      expect(screen.queryByText("Recipes")).not.toBeInTheDocument();
      expect(screen.queryByText("Cookbooks")).not.toBeInTheDocument();
      expect(screen.queryByText("Profile")).not.toBeInTheDocument();
    });

    it("marks the kitchen place active only on the home route", () => {
      const { unmount } = render(
        <MemoryRouter initialEntries={["/"]}>
          <MobileNav />
        </MemoryRouter>,
      );

      expect(screen.getByRole("link", { name: /kitchen home/i })).toHaveAttribute("aria-current", "page");
      unmount();

      render(
        <MemoryRouter initialEntries={["/shopping-list"]}>
          <MobileNav />
        </MemoryRouter>,
      );

      expect(screen.getByRole("link", { name: /kitchen/i })).not.toHaveAttribute("aria-current");
    });
  });

  describe("route-aware docks", () => {
    it("stays out of write-heavy recipe and cookbook forms while allowing recipe detail navigation", () => {
      const { rerender } = render(
        <MemoryRouter initialEntries={["/recipes/new"]}>
          <MobileNav />
        </MemoryRouter>,
      );

      expect(screen.queryByRole("navigation", { name: "Spoonjoy navigation" })).not.toBeInTheDocument();

      rerender(
        <MemoryRouter initialEntries={["/cookbooks/new"]} key="cookbook-new">
          <MobileNav />
        </MemoryRouter>,
      );

      expect(screen.queryByRole("navigation", { name: "Spoonjoy navigation" })).not.toBeInTheDocument();

      rerender(
        <MemoryRouter initialEntries={["/recipes/recipe-1"]} key="recipe-detail">
          <MobileNav />
        </MemoryRouter>,
      );

      expect(screen.getByRole("navigation", { name: "Spoonjoy navigation" })).toBeInTheDocument();

      rerender(
        <MemoryRouter initialEntries={["/recipes/recipe-1/edit"]} key="recipe-edit">
          <MobileNav />
        </MemoryRouter>,
      );

      expect(screen.queryByRole("navigation", { name: "Spoonjoy navigation" })).not.toBeInTheDocument();

      rerender(
        <MemoryRouter initialEntries={["/cookbooks/cookbook-1"]} key="cookbook-detail">
          <MobileNav />
        </MemoryRouter>,
      );

      expect(screen.queryByRole("navigation", { name: "Spoonjoy navigation" })).not.toBeInTheDocument();
    });

    it("stays out of step writing screens", () => {
      const { rerender, unmount } = render(
        <MemoryRouter initialEntries={["/recipes/recipe-1/steps/new"]}>
          <MobileNav />
        </MemoryRouter>,
      );

      expect(screen.queryByRole("navigation", { name: "Spoonjoy navigation" })).not.toBeInTheDocument();

      rerender(
        <MemoryRouter initialEntries={["/recipes/recipe-1/steps/step-1/edit"]}>
          <MobileNav />
        </MemoryRouter>,
      );

      expect(screen.queryByRole("navigation", { name: "Spoonjoy navigation" })).not.toBeInTheDocument();

      unmount();

      render(
        <MemoryRouter initialEntries={["/recipes/recipe-1/steps/step-1"]}>
          <MobileNav />
        </MemoryRouter>,
      );

      expect(screen.queryByRole("navigation", { name: "Spoonjoy navigation" })).not.toBeInTheDocument();
    });

    it("turns search into the place slot on search routes", () => {
      render(
        <MemoryRouter initialEntries={["/search?q=tomato"]}>
          <MobileNav />
        </MemoryRouter>,
      );

      expect(screen.getByRole("link", { name: /search index/i })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: /kitchen/i })).toHaveAttribute("href", "/");
      expect(screen.getByRole("link", { name: /shopping list/i })).toHaveAttribute("href", "/shopping-list");
    });

    it("turns shopping list into the place slot and exposes Add as the primary action", () => {
      render(
        <MemoryRouter initialEntries={["/shopping-list"]}>
          <MobileNav />
        </MemoryRouter>,
      );

      expect(screen.getByRole("link", { name: /list market/i })).toHaveAttribute("aria-current", "page");
      expect(screen.getByTestId("dock-center")).toContainElement(screen.getByRole("link", { name: /add/i }));
      expect(screen.getByRole("link", { name: /add/i })).toHaveAttribute("href", "/shopping-list#add-item");
    });

    it("provides explicit back navigation for profile-style screens", () => {
      render(
        <MemoryRouter initialEntries={["/users/ari/fellow-chefs"]}>
          <MobileNav />
        </MemoryRouter>,
      );

      expect(screen.getByRole("link", { name: /back kitchen/i })).toHaveAttribute("href", "/");
      expect(screen.getByRole("link", { name: /create recipe/i })).toHaveAttribute("href", "/recipes/new");
    });

    it("turns account settings into the place slot", () => {
      render(
        <MemoryRouter initialEntries={["/account/settings"]}>
          <MobileNav />
        </MemoryRouter>,
      );

      expect(screen.getByRole("link", { name: /account settings/i })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: /kitchen/i })).toHaveAttribute("href", "/");
    });

    it("turns cookbooks into the shelf place slot", () => {
      render(
        <MemoryRouter initialEntries={["/cookbooks"]}>
          <MobileNav />
        </MemoryRouter>,
      );

      expect(screen.getByRole("link", { name: /shelf cookbooks/i })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: /create cookbook/i })).toHaveAttribute("href", "/cookbooks/new");
    });
  });

  describe("contextual actions via DockContext", () => {
    it("renders default nav items when context has no actions", () => {
      render(
        <MemoryRouter initialEntries={["/"]}>
          <DockContextProvider>
            <MobileNav />
          </DockContextProvider>
        </MemoryRouter>,
      );

      expect(screen.getByRole("link", { name: /create recipe/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /shopping list/i })).toBeInTheDocument();
    });

    it("adapts legacy side actions into the new place / primary / tools model", () => {
      const actions: DockAction[] = [
        { id: "back", icon: ArrowLeft, label: "Back", onAction: "/recipes", position: "left" },
        { id: "edit", icon: Edit, label: "Edit", onAction: () => {}, position: "right" },
        { id: "share", icon: Share2, label: "Share", onAction: () => {}, position: "right" },
      ];

      render(
        <MemoryRouter initialEntries={["/users/ari"]}>
          <DockContext.Provider value={{ actions, setActions: () => {}, config: null, setConfig: () => {}, isContextual: true }}>
            <MobileNav />
          </DockContext.Provider>
        </MemoryRouter>,
      );

      expect(screen.getByRole("link", { name: /back back/i })).toHaveAttribute("href", "/recipes");
      expect(screen.getByTestId("dock-center")).toContainElement(screen.getByRole("button", { name: /edit/i }));
      expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /shopping list/i })).not.toBeInTheDocument();
    });

    it("calls function actions and preserves string actions as links", async () => {
      const user = userEvent.setup();
      const handleEdit = vi.fn();
      const actions: DockAction[] = [
        { id: "back", icon: ArrowLeft, label: "Back", onAction: "/recipes", position: "left" },
        { id: "edit", icon: Edit, label: "Edit", onAction: handleEdit, position: "right" },
      ];

      render(
        <MemoryRouter initialEntries={["/users/ari"]}>
          <DockContext.Provider value={{ actions, setActions: () => {}, config: null, setConfig: () => {}, isContextual: true }}>
            <MobileNav />
          </DockContext.Provider>
        </MemoryRouter>,
      );

      expect(screen.getByRole("link", { name: /back back/i })).toHaveAttribute("href", "/recipes");

      await user.click(screen.getByRole("button", { name: /edit/i }));
      expect(handleEdit).toHaveBeenCalledTimes(1);
    });

    it("falls back to route-aware root config when context is cleared", () => {
      const actions: DockAction[] = [
        { id: "back", icon: ArrowLeft, label: "Back", onAction: "/recipes", position: "left" },
        { id: "edit", icon: Edit, label: "Edit", onAction: () => {}, position: "right" },
      ];

      const { rerender } = render(
        <MemoryRouter initialEntries={["/users/ari"]}>
          <DockContext.Provider value={{ actions, setActions: () => {}, config: null, setConfig: () => {}, isContextual: true }}>
            <MobileNav />
          </DockContext.Provider>
        </MemoryRouter>,
      );

      expect(screen.getByRole("link", { name: /back back/i })).toBeInTheDocument();

      rerender(
        <MemoryRouter initialEntries={["/users/ari"]}>
          <DockContext.Provider value={{ actions: null, setActions: () => {}, config: null, setConfig: () => {}, isContextual: false }}>
            <MobileNav />
          </DockContext.Provider>
        </MemoryRouter>,
      );

      expect(screen.queryByRole("link", { name: /back back/i })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: /create recipe/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /shopping list/i })).toBeInTheDocument();
    });

    it("renders the center slot even when a contextual caller has no actions", () => {
      render(
        <MemoryRouter initialEntries={["/users/ari"]}>
          <DockContext.Provider value={{ actions: null, setActions: () => {}, config: null, setConfig: () => {}, isContextual: true }}>
            <MobileNav />
          </DockContext.Provider>
        </MemoryRouter>,
      );

      expect(screen.getByTestId("dock-center")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /create recipe/i })).toBeInTheDocument();
    });
  });
});
