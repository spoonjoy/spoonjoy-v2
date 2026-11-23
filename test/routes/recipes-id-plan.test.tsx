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

function renderRecipe(flags: string[], overrides: Record<string, unknown> = {}, path = "/recipes/recipe-1") {
  const Stub = createTestRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ flags }),
      Component: () => <Outlet />,
      children: [{ path: "recipes/:id", Component: RecipeDetail, loader: () => recipeData(overrides) }],
    },
  ]);
  render(<Stub initialEntries={[path]} />);
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

describe("recipe page: opened from the meal plan", () => {
  afterEach(() => {
    cleanup();
    // Opening a recipe stores its cook progress, scale included, in this browser.
    localStorage.clear();
    sessionStorage.clear();
  });

  async function scaleShown() {
    await screen.findByRole("heading", { name: "Plannable Soup" });
    await userEvent.click(await screen.findByTestId("recipe-serves-trigger"));
    return ((await screen.findByRole("textbox", { name: "Scale" })) as HTMLInputElement).value;
  }

  it("opens at the servings the meal was planned for", async () => {
    renderRecipe(["meal-planner"], {}, "/recipes/recipe-1?scale=2");
    expect(await scaleShown()).toBe("2");
  });

  it("opens at the planned servings over the scale this browser kept from an earlier cook", async () => {
    renderRecipe(["meal-planner"], {}, "/recipes/recipe-1?scale=3");
    expect(await scaleShown()).toBe("3");
    cleanup();
    renderRecipe(["meal-planner"], {}, "/recipes/recipe-1?scale=2");
    expect(await scaleShown()).toBe("2");
  });

  it("opens as written when the scale in the link isn't one it can cook", async () => {
    for (const scale of ["0", "51", "lots"]) {
      renderRecipe(["meal-planner"], {}, `/recipes/recipe-1?scale=${scale}`);
      expect(await scaleShown()).toBe("1");
      cleanup();
      localStorage.clear();
      sessionStorage.clear();
    }
  });
});
