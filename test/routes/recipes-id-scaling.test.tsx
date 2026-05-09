import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  describe("component scaling behavior", () => {
    it("should render new components with scale selector", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: "A test recipe for scaling",
          servings: "Serves 4",
          imageUrl: "https://example.com/image.jpg",
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

      // Scale selector should be present
      expect(screen.getByTestId("scale-display")).toBeInTheDocument();
      expect(screen.getByTestId("scale-display")).toHaveTextContent("Serves 4");

      // Scale buttons should be present
      expect(screen.getByTestId("scale-plus")).toBeInTheDocument();
      expect(screen.getByTestId("scale-minus")).toBeInTheDocument();
    });

    it("should update servings text when scale changes", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
          description: null,
          servings: "Serves 4",
          imageUrl: null,
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
      expect(screen.getByText(/serves 4/i)).toBeInTheDocument();

      // Click plus button 4 times to get to 2× scale
      const plusButton = screen.getByTestId("scale-plus");
      fireEvent.click(plusButton);
      fireEvent.click(plusButton);
      fireEvent.click(plusButton);
      fireEvent.click(plusButton);

      // Verify scale display shows 2×
      expect(screen.getByTestId("scale-display")).toHaveTextContent("Serves 8");

      // Servings should now show "Serves 8"
      expect(screen.getByText(/serves 8/i)).toBeInTheDocument();
    });

    it("should scale ingredient quantities across all steps", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Multi-Step Recipe",
          description: null,
          servings: "Serves 2",
          imageUrl: null,
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
      expect(screen.getByText("flour")).toBeInTheDocument();
      expect(screen.getByTestId("ingredient-quantity-ing-1")).toHaveTextContent("1 cup");
      expect(screen.getByText("sugar")).toBeInTheDocument();
      expect(screen.getByTestId("ingredient-quantity-ing-2")).toHaveTextContent("½ cup");

      // Scale to 2×
      const plusButton = screen.getByTestId("scale-plus");
      fireEvent.click(plusButton);
      fireEvent.click(plusButton);
      fireEvent.click(plusButton);
      fireEvent.click(plusButton);

      // Quantities should be doubled
      expect(screen.getByTestId("ingredient-quantity-ing-1")).toHaveTextContent("2 cup");
      expect(screen.getByTestId("ingredient-quantity-ing-2")).toHaveTextContent("1 cup");
    });

    it("should preserve ingredient check state when scaling", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Recipe with Checkboxes",
          description: null,
          servings: "Serves 2",
          imageUrl: null,
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
      const flourCheckbox = screen.getByRole("checkbox", { name: "Mark flour as used" });
      const sugarCheckbox = screen.getByRole("checkbox", { name: "Mark sugar as used" });
      expect(flourCheckbox).not.toBeChecked();

      fireEvent.click(flourCheckbox);
      expect(flourCheckbox).toBeChecked();

      // Click again to uncheck (tests the delete branch)
      fireEvent.click(flourCheckbox);
      expect(flourCheckbox).not.toBeChecked();

      // Check again and then scale
      fireEvent.click(flourCheckbox);
      expect(flourCheckbox).toBeChecked();

      // Now scale the recipe
      const plusButton = screen.getByTestId("scale-plus");
      fireEvent.click(plusButton);

      // The checkbox should still be checked
      expect(screen.getByRole("checkbox", { name: "Mark flour as used" })).toBeChecked();
      expect(sugarCheckbox).not.toBeChecked();
    });

    it("should render recipe image when provided", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Recipe with Image",
          description: null,
          servings: null,
          imageUrl: "https://example.com/delicious.jpg",
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
          imageUrl: null,
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
          imageUrl: null,
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
          imageUrl: null,
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

      // Step output uses section should be present (inline with ingredients)
      const stepOutputSection = screen.getByTestId("step-output-uses-section");
      expect(stepOutputSection).toBeInTheDocument();
      // Verify the step reference appears in the section
      expect(stepOutputSection).toHaveTextContent("Step 1");
      expect(stepOutputSection).toHaveTextContent("Make the base");
    });

    it("should show owner controls when isOwner is true", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "My Recipe",
          description: null,
          servings: null,
          imageUrl: null,
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

      // Edit is handled by contextual dock actions; delete remains page-level for owners.
      expect(screen.queryByRole("link", { name: /edit/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete Recipe" })).toBeInTheDocument();
    });

    it("should not show owner controls when isOwner is false", async () => {
      const mockData = {
        recipe: {
          id: "recipe-1",
          title: "Someone Else's Recipe",
          description: null,
          servings: null,
          imageUrl: null,
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
          imageUrl: null,
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
      expect(screen.getByText(/feeds 2-4 people/i)).toBeInTheDocument();

      // Scale to 2×
      const plusButton = screen.getByTestId("scale-plus");
      fireEvent.click(plusButton);
      fireEvent.click(plusButton);
      fireEvent.click(plusButton);
      fireEvent.click(plusButton);

      // Range should be doubled: 2-4 becomes 4-8
      expect(screen.getByText(/feeds 4-8 people/i)).toBeInTheDocument();
    });
  });
});
