import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import RecipeDetail from "~/routes/recipes.$id";
import { createUser } from "~/lib/auth.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { faker } from "@faker-js/faker";

/**
 * Integration tests for recipe view scaling functionality.
 * Tests the new RecipeHeader + StepCard components with scale state management.
 */
describe("Recipe View Scaling Integration", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("component scaling behavior", () => {
    it("should render new components with scale selector", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: "A test recipe for scaling",
          servings: "Serves 4",
          coverImageUrl: "https://example.com/image.jpg",
          chef: { id: "user-1", username: "testchef" },
          steps: [
            {
              id: "step-1",
              stepNum: 1,
              stepTitle: "Mix ingredients",
              description: "Combine all ingredients",
              ingredients: [
                {
                  id: "ing-1",
                  quantity: 2,
                  unit: { name: "cups" },
                  ingredientRef: { name: "flour" },
                },
              ],
              usingSteps: [],
            },
          ],
        },
        isOwner: false,
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id",
          Component: RecipeDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1"]} />);

      // Wait for recipe to render
      expect(await screen.findByRole("heading", { name: "Test Recipe" })).toBeInTheDocument();

      // The scale is Ouro HX's NumberField, described by the servings it makes
      const scale = screen.getByRole("textbox", { name: "Scale" });
      expect(scale).toHaveValue("1");
      expect(scale).toHaveAccessibleDescription("Serves 4");
      expect(screen.getByRole("button", { name: "Increase scale" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Decrease scale" })).toBeInTheDocument();
    });

    it("should update servings text when scale changes", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: null,
          servings: "Serves 4",
          coverImageUrl: null,
          chef: { id: "user-1", username: "testchef" },
          steps: [],
        },
        isOwner: false,
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id",
          Component: RecipeDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1"]} />);

      // Wait for recipe to render
      await screen.findByRole("heading", { name: "Test Recipe" });

      // Initial servings should show "Serves 4"
      expect(within(screen.getByTestId("recipe-header-controls")).getByText(/serves 4/i)).toBeInTheDocument();

      // Click plus button 4 times to get to 2× scale
      const plusButton = screen.getByRole("button", { name: "Increase scale" });
      for (const _ of [1, 2, 3, 4]) await userEvent.click(plusButton);

      // Verify the scale shows 2×
      expect(screen.getByRole("textbox", { name: "Scale" })).toHaveValue("2");
      expect(screen.getByRole("textbox", { name: "Scale" })).toHaveAccessibleDescription("Serves 8");

      // Servings should now show "Serves 8"
      expect(within(screen.getByTestId("recipe-header-controls")).getByText(/serves 8/i)).toBeInTheDocument();
      // The printed page carries the scaled yield, since paper has no scale control.
      expect(screen.getByTestId("recipe-print-yield")).toHaveTextContent(/^Yield: serves 8 · Quantities at 2× the recipe$/i);
    });

    it("should scale ingredient quantities across all steps", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Multi-Step Recipe",
          description: null,
          servings: "Serves 2",
          coverImageUrl: null,
          chef: { id: "user-1", username: "testchef" },
          steps: [
            {
              id: "step-1",
              stepNum: 1,
              stepTitle: "Step 1",
              description: "First step",
              ingredients: [
                {
                  id: "ing-1",
                  quantity: 1,
                  unit: { name: "cup" },
                  ingredientRef: { name: "flour" },
                },
              ],
              usingSteps: [],
            },
            {
              id: "step-2",
              stepNum: 2,
              stepTitle: "Step 2",
              description: "Second step",
              ingredients: [
                {
                  id: "ing-2",
                  quantity: 0.5,
                  unit: { name: "cup" },
                  ingredientRef: { name: "sugar" },
                },
              ],
              usingSteps: [],
            },
          ],
        },
        isOwner: false,
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id",
          Component: RecipeDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1"]} />);

      // Wait for recipe to render
      await screen.findByRole("heading", { name: "Multi-Step Recipe" });

      // Initial quantities
      expect(screen.getByRole("checkbox", { name: "flour" })).toHaveAccessibleDescription("Pantry 1 cup");
      expect(screen.getByRole("checkbox", { name: "sugar" })).toHaveAccessibleDescription("Pantry ½ cup");

      // Scale to 2×
      const plusButton = screen.getByRole("button", { name: "Increase scale" });
      for (const _ of [1, 2, 3, 4]) await userEvent.click(plusButton);

      // Quantities should be doubled
      expect(screen.getByRole("checkbox", { name: "flour" })).toHaveAccessibleDescription("Pantry 2 cups");
      expect(screen.getByRole("checkbox", { name: "sugar" })).toHaveAccessibleDescription("Pantry 1 cup");
    });

    it("should preserve ingredient check state when scaling", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Recipe with Checkboxes",
          description: null,
          servings: "Serves 2",
          coverImageUrl: null,
          chef: { id: "user-1", username: "testchef" },
          steps: [
            {
              id: "step-1",
              stepNum: 1,
              stepTitle: "Step 1",
              description: "Mix everything",
              ingredients: [
                {
                  id: "ing-1",
                  quantity: 2,
                  unit: { name: "cups" },
                  ingredientRef: { name: "flour" },
                },
                {
                  id: "ing-2",
                  quantity: 1,
                  unit: { name: "cup" },
                  ingredientRef: { name: "sugar" },
                },
              ],
              usingSteps: [],
            },
          ],
        },
        isOwner: false,
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id",
          Component: RecipeDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1"]} />);

      // Wait for recipe to render
      await screen.findByRole("heading", { name: "Recipe with Checkboxes" });

      // Find and check the first ingredient
      const flourCheckbox = screen.getByRole("checkbox", { name: "flour" });
      const sugarCheckbox = screen.getByRole("checkbox", { name: "sugar" });
      expect(flourCheckbox).not.toBeChecked();

      await userEvent.click(flourCheckbox);
      expect(flourCheckbox).toBeChecked();

      // Click again to uncheck (tests the delete branch)
      await userEvent.click(flourCheckbox);
      expect(flourCheckbox).not.toBeChecked();

      // Check again and then scale
      await userEvent.click(flourCheckbox);
      expect(flourCheckbox).toBeChecked();

      // Now scale the recipe
      await userEvent.click(screen.getByRole("button", { name: "Increase scale" }));

      // The checkbox should still be checked
      expect(screen.getByRole("checkbox", { name: "flour" })).toBeChecked();
      expect(sugarCheckbox).not.toBeChecked();
    });

    it("should render recipe image when provided", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Recipe with Image",
          description: null,
          servings: null,
          chef: { id: "user-1", username: "testchef" },
          steps: [],
        },
        coverImageUrl: "https://example.com/delicious.jpg",
        isOwner: false,
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id",
          Component: RecipeDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1"]} />);

      await screen.findByRole("heading", { name: "Recipe with Image" });

      // Image should be present
      const image = screen.getByTestId("recipe-image");
      expect(image).toBeInTheDocument();
    });

    it("should render placeholder when no image provided", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Recipe without Image",
          description: null,
          servings: null,
          coverImageUrl: null,
          chef: { id: "user-1", username: "testchef" },
          steps: [],
        },
        isOwner: false,
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id",
          Component: RecipeDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1"]} />);

      await screen.findByRole("heading", { name: "Recipe without Image" });

      // Placeholder should be present
      const placeholder = screen.getByTestId("recipe-image-placeholder");
      expect(placeholder).toBeInTheDocument();
    });

    it("should render step cards with step numbers", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Multi-Step Recipe",
          description: null,
          servings: null,
          coverImageUrl: null,
          chef: { id: "user-1", username: "testchef" },
          steps: [
            {
              id: "step-1",
              stepNum: 1,
              stepTitle: "First Step",
              description: "Do the first thing",
              ingredients: [],
              usingSteps: [],
            },
            {
              id: "step-2",
              stepNum: 2,
              stepTitle: "Second Step",
              description: "Do the second thing",
              ingredients: [],
              usingSteps: [],
            },
            {
              id: "step-3",
              stepNum: 3,
              stepTitle: null,
              description: "Do the third thing",
              ingredients: [],
              usingSteps: [],
            },
          ],
        },
        isOwner: false,
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id",
          Component: RecipeDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1"]} />);

      await screen.findByRole("heading", { name: "Multi-Step Recipe" });

      // All step numbers should be visible
      const stepNumbers = screen.getAllByTestId("step-number");
      expect(stepNumbers).toHaveLength(3);
      expect(stepNumbers[0]).toHaveTextContent("Step 1");
      expect(stepNumbers[1]).toHaveTextContent("Step 2");
      expect(stepNumbers[2]).toHaveTextContent("Step 3");

      // Step titles should be visible
      expect(screen.getByRole("heading", { name: "First Step" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Second Step" })).toBeInTheDocument();

      // Descriptions should be visible
      expect(screen.getByText("Do the first thing")).toBeInTheDocument();
      expect(screen.getByText("Do the second thing")).toBeInTheDocument();
      expect(screen.getByText("Do the third thing")).toBeInTheDocument();
    });

    it("should render step output uses with callout", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Recipe with Step References",
          description: null,
          servings: null,
          coverImageUrl: null,
          chef: { id: "user-1", username: "testchef" },
          steps: [
            {
              id: "step-1",
              stepNum: 1,
              stepTitle: "Make the base",
              description: "Prepare the base layer",
              ingredients: [],
              usingSteps: [],
            },
            {
              id: "step-2",
              stepNum: 2,
              stepTitle: "Add topping",
              description: "Add the topping",
              ingredients: [],
              usingSteps: [
                {
                  id: "use-1",
                  outputStepNum: 1,
                  outputOfStep: { stepNum: 1, stepTitle: "Make the base" },
                },
              ],
            },
          ],
        },
        isOwner: false,
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id",
          Component: RecipeDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1"]} />);

      await screen.findByRole("heading", { name: "Recipe with Step References" });

      // The earlier step's output is ticked off in the step's checklist, before its ingredients
      const stepOutput = screen.getByRole("checkbox", { name: "Step 1: Make the base" });
      expect(stepOutput).toHaveAccessibleDescription("Step output");
      expect(stepOutput).not.toBeChecked();
    });

    it("should show owner controls when isOwner is true", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "My Recipe",
          description: null,
          servings: null,
          coverImageUrl: null,
          chef: { id: "user-1", username: "me" },
          steps: [],
        },
        isOwner: true,
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id",
          Component: RecipeDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1"]} />);

      await screen.findByRole("heading", { name: "My Recipe" });

      // Edit is one tap away in the masthead; the rest of maintenance stays collapsed.
      expect(screen.getByTestId("recipe-header-edit-action")).toHaveAttribute("href", "/recipes/recipe-1/edit");
      expect(screen.queryByRole("link", { name: "Edit recipe" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    });

    it("should not show owner controls when isOwner is false", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Someone Else's Recipe",
          description: null,
          servings: null,
          coverImageUrl: null,
          chef: { id: "user-2", username: "someone" },
          steps: [],
        },
        isOwner: false,
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id",
          Component: RecipeDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1"]} />);

      await screen.findByRole("heading", { name: "Someone Else's Recipe" });

      // Edit and delete buttons should NOT be visible
      expect(screen.queryByRole("link", { name: /edit/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    });

    it("should handle scale range servings text correctly", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Recipe with Range Servings",
          description: null,
          servings: "Feeds 2-4 people",
          coverImageUrl: null,
          chef: { id: "user-1", username: "testchef" },
          steps: [],
        },
        isOwner: false,
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id",
          Component: RecipeDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/recipe-1"]} />);

      await screen.findByRole("heading", { name: "Recipe with Range Servings" });

      // Initial servings
      expect(within(screen.getByTestId("recipe-header-controls")).getByText(/feeds 2-4 people/i)).toBeInTheDocument();

      // Scale to 2×
      const plusButton = screen.getByRole("button", { name: "Increase scale" });
      for (const _ of [1, 2, 3, 4]) await userEvent.click(plusButton);

      // Range should be doubled: 2-4 becomes 4-8
      expect(within(screen.getByTestId("recipe-header-controls")).getByText(/feeds 4-8 people/i)).toBeInTheDocument();
    });
  });
});
