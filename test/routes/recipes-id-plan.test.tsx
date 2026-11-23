import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet } from "react-router";
import { createTestRoutesStub } from "../utils";
import RecipeDetail from "~/routes/recipes.$id";

function recipeData(overrides: Record<string, unknown> = {}) {
  return {
    recipe: {
      id: "recipe-1",
      title: "Plannable Soup",
      description: null,
      servings: "4",
      coverImageUrl: null,
      chef: { id: "chef-2", username: "otherchef" },
      steps: [],
    },
    isOwner: false,
    isAuthenticated: true,
    ...overrides,
  };
}

function renderRecipe(flags: string[], overrides: Record<string, unknown> = {}) {
  const Stub = createTestRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ flags }),
      Component: () => <Outlet />,
      children: [{ path: "recipes/:id", Component: RecipeDetail, loader: () => recipeData(overrides) }],
    },
  ]);
  render(<Stub initialEntries={["/recipes/recipe-1"]} />);
}

async function openRecipeActions() {
  await screen.findByRole("heading", { name: "Plannable Soup" });
  await userEvent.click(screen.getByRole("button", { name: "Recipe actions" }));
  await screen.findByRole("menuitem", { name: "Log cook" });
}

describe("recipe page: plan this meal", () => {
  afterEach(() => cleanup());

  it("offers a signed-in cook a way to put the recipe on their meal plan while the planner is on", async () => {
    renderRecipe(["meal-planner"]);
    await openRecipeActions();
    expect(screen.getByRole("menuitem", { name: "Plan this meal" })).toHaveAttribute("href", "/plan?recipe=recipe-1");
  });

  it("leaves the planner out while its flag is off", async () => {
    renderRecipe([]);
    await openRecipeActions();
    expect(screen.queryByRole("menuitem", { name: "Plan this meal" })).toBeNull();
  });

  it("leaves the planner out for someone who isn't signed in", async () => {
    renderRecipe(["meal-planner"], { isAuthenticated: false });
    await openRecipeActions();
    expect(screen.queryByRole("menuitem", { name: "Plan this meal" })).toBeNull();
  });
});
