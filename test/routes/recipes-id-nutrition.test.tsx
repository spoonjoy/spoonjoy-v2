import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Outlet } from "react-router";
import { createTestRoutesStub } from "../utils";
import RecipeDetail from "~/routes/recipes.$id";

const recipeData = {
  recipe: {
    id: "recipe-1",
    title: "Garlic Rice",
    description: null,
    servings: "2",
    coverImageUrl: null,
    chef: { id: "user-1", username: "testchef" },
    steps: [
      {
        id: "step-1",
        stepNum: 1,
        stepTitle: null,
        description: "Cook the rice with the garlic.",
        ingredients: [
          { id: "ing-1", quantity: 1, unit: { name: "cup" }, ingredientRef: { name: "jasmine rice" } },
          { id: "ing-2", quantity: 2, unit: { name: "cloves" }, ingredientRef: { name: "garlic" } },
        ],
        usingSteps: [],
      },
    ],
  },
  isOwner: false,
  cookbooks: [],
  savedInCookbookIds: [],
};

function renderRecipe(flags: string[]) {
  const Stub = createTestRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ flags }),
      Component: Outlet,
      children: [{ path: "recipes/:id", Component: RecipeDetail, loader: () => recipeData }],
    },
  ]);
  return render(<Stub initialEntries={["/recipes/recipe-1"]} />);
}

afterEach(cleanup);

describe("a recipe's nutrition", () => {
  it("shows per serving on the recipe's page while nutrition is on", async () => {
    renderRecipe(["nutrition"]);
    expect(await screen.findByRole("heading", { level: 2, name: "Nutrition" })).toBeInTheDocument();
    expect(screen.getByText("Per serving, from 2 of 2 ingredients.")).toBeInTheDocument();
  });

  it("stays off the page while nutrition is off", async () => {
    renderRecipe([]);
    await screen.findByRole("heading", { level: 1, name: "Garlic Rice" });
    expect(screen.queryByRole("heading", { name: "Nutrition" })).not.toBeInTheDocument();
  });
});
