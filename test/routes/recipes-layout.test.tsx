import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import Recipes, * as recipesLayoutRoute from "~/routes/recipes";

/**
 * Tests for the Recipes Layout Route (recipes.tsx)
 *
 * This is a public layout route that:
 * - Has no loader (child routes own their data)
 * - Renders an Outlet for child routes
 *
 * Child routes enforce authentication only when they mutate data.
 */
describe("Recipes Layout Route", () => {
  describe("loader", () => {
    it("has none, so navigations under /recipes (such as leaving cook mode) fetch nothing for the layout", () => {
      expect("loader" in recipesLayoutRoute).toBe(false);
    });
  });

  describe("component", () => {
    it("should render child routes via Outlet", async () => {
      // The Recipes component is a layout that renders <Outlet />
      // Test that it properly renders child content
      const Stub = createTestRoutesStub([
        {
          path: "/recipes",
          Component: Recipes,
          loader: () => null,
          children: [
            {
              index: true,
              Component: () => <div data-testid="child-content">Recipe List Child</div>,
              loader: () => null,
            },
          ],
        },
      ]);

      render(<Stub initialEntries={["/recipes"]} />);

      // The Outlet should render the child route
      expect(await screen.findByTestId("child-content")).toBeInTheDocument();
      expect(screen.getByText("Recipe List Child")).toBeInTheDocument();
    });
  });
});
