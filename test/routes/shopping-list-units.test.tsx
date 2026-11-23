import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet } from "react-router";
import { createTestRoutesStub } from "../utils";
import ShoppingList, { amountLabel } from "~/routes/shopping-list";
import type { UnitSystem } from "~/domains/food-knowledge";

const listData = {
  shoppingList: {
    id: "list-1",
    items: [
      { id: "item-1", quantity: 2, checked: false, unit: { name: "lbs" }, ingredientRef: { name: "chicken thigh" }, categoryKey: "protein", iconKey: "beef" },
      { id: "item-2", quantity: 3, checked: false, unit: { name: "whole" }, ingredientRef: { name: "lemon" }, categoryKey: "produce", iconKey: "citrus" },
    ],
  },
  recipes: [],
};

function renderList({ flags, unitSystem }: { flags: string[]; unitSystem: UnitSystem }) {
  const Stub = createTestRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ flags }),
      Component: Outlet,
      children: [{ path: "shopping-list", Component: ShoppingList, loader: () => ({ ...listData, unitSystem }) }],
    },
  ]);
  return render(<Stub initialEntries={["/shopping-list"]} />);
}

function chicken() {
  return screen.findByRole("checkbox", { name: "chicken thigh" });
}

afterEach(() => {
  cleanup();
  document.cookie = "sj_units=; Path=/; Max-Age=0";
});

describe("shopping list units", () => {
  it("writes an item's amount in a unit system, rounding counted things up", () => {
    expect(amountLabel({ quantity: 2, unit: { name: "lbs" } }, "metric")).toBe("905 g");
    expect(amountLabel({ quantity: 1.25, unit: { name: "whole" } }, "metric")).toBe("2");
    expect(amountLabel({ quantity: 2, unit: { name: "lbs" } })).toBe("2 lbs");
  });

  it("shows amounts in the cook's units while unit conversion is on", async () => {
    renderList({ flags: ["unit-conversion"], unitSystem: "metric" });
    expect(await chicken()).toHaveAccessibleDescription(/905 g$/);
  });

  it("shows amounts as written, with no units in the menu, while unit conversion is off", async () => {
    const user = userEvent.setup();
    renderList({ flags: [], unitSystem: "metric" });
    expect(await chicken()).toHaveAccessibleDescription(/2 lbs$/);
    await user.click(screen.getByRole("button", { name: "List actions" }));
    expect(await screen.findByRole("menuitem", { name: "Clear all" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitemradio", { name: "Metric" })).not.toBeInTheDocument();
  });

  it("switches units from the list's menu and keeps the choice in a cookie", async () => {
    const user = userEvent.setup();
    renderList({ flags: ["unit-conversion"], unitSystem: "original" });
    expect(await chicken()).toHaveAccessibleDescription(/2 lbs$/);

    await user.click(screen.getByRole("button", { name: "List actions" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Metric" }));

    expect(screen.getByRole("checkbox", { name: "chicken thigh" })).toHaveAccessibleDescription(/905 g$/);
    expect(screen.getByRole("checkbox", { name: "lemon" })).toHaveAccessibleDescription(/3$/);
    expect(document.cookie).toContain("sj_units=metric");
  });
});
