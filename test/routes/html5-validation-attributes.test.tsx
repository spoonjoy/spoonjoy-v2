import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestRoutesStub } from "../utils";
import NewRecipe from "~/routes/recipes.new";
import EditRecipe from "~/routes/recipes.$id.edit";
import NewStep from "~/routes/recipes.$id.steps.new";
import EditStep from "~/routes/recipes.$id.steps.$stepId.edit";
import {
  TITLE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  STEP_DESCRIPTION_MAX_LENGTH,
  STEP_TITLE_MAX_LENGTH,
  SERVINGS_MAX_LENGTH,
  UNIT_NAME_MAX_LENGTH,
  INGREDIENT_NAME_MAX_LENGTH,
  QUANTITY_MIN,
  QUANTITY_MAX,
} from "~/lib/validation";

// Mock localStorage for IngredientInputToggle
let localStorageStore: Record<string, string> = {};

const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageStore[key];
  }),
  clear: vi.fn(() => {
    localStorageStore = {};
  }),
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

/**
 * Tests for HTML5 validation attributes on recipe CRUD forms.
 * These attributes provide immediate client-side feedback for better UX.
 */

describe("HTML5 validation attributes", () => {
  describe("recipes.new (Create Recipe)", () => {
    const renderNewRecipe = async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/new",
          Component: NewRecipe,
          loader: () => null,
        },
      ]);

      render(<Stub initialEntries={["/recipes/new"]} />);
      await screen.findByRole("heading", { name: "Write the version future-you can actually cook." });
    };

    it("title field has required attribute", async () => {
      await renderNewRecipe();
      const titleInput = screen.getByLabelText(/Title/);
      expect(titleInput).toBeRequired();
    });

    it("title field has maxLength attribute", async () => {
      await renderNewRecipe();
      const titleInput = screen.getByLabelText(/Title/);
      expect(titleInput).toHaveAttribute("maxLength", String(TITLE_MAX_LENGTH));
    });

    it("description field has maxLength attribute", async () => {
      await renderNewRecipe();
      const descriptionTextarea = screen.getByLabelText(/Description/);
      expect(descriptionTextarea).toHaveAttribute("maxLength", String(DESCRIPTION_MAX_LENGTH));
    });

    it("servings field has maxLength attribute", async () => {
      await renderNewRecipe();
      const servingsInput = screen.getByLabelText(/Servings/);
      expect(servingsInput).toHaveAttribute("maxLength", String(SERVINGS_MAX_LENGTH));
    });
  });

  describe("recipes.$id.edit (Edit Recipe)", () => {
    const mockRecipe = {
      id: "test-recipe-id",
      title: "Test Recipe",
      description: "Test description",
      servings: "4",
      coverImageUrl: "https://example.com/image.jpg",
      steps: [],
    };

    const renderEditRecipe = async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => ({ recipe: mockRecipe, formattedSteps: [] }),
        },
      ]);

      render(<Stub initialEntries={["/recipes/test-recipe-id/edit"]} />);
      await screen.findByRole("heading", { name: "Tune the recipe until it feels cookable." });
    };

    it("title field has required attribute", async () => {
      await renderEditRecipe();
      const titleInput = screen.getByLabelText(/Title/);
      expect(titleInput).toBeRequired();
    });

    it("title field has maxLength attribute", async () => {
      await renderEditRecipe();
      const titleInput = screen.getByLabelText(/Title/);
      expect(titleInput).toHaveAttribute("maxLength", String(TITLE_MAX_LENGTH));
    });

    it("description field has maxLength attribute", async () => {
      await renderEditRecipe();
      const descriptionTextarea = screen.getByLabelText(/Description/);
      expect(descriptionTextarea).toHaveAttribute("maxLength", String(DESCRIPTION_MAX_LENGTH));
    });

    it("servings field has maxLength attribute", async () => {
      await renderEditRecipe();
      const servingsInput = screen.getByLabelText(/Servings/);
      expect(servingsInput).toHaveAttribute("maxLength", String(SERVINGS_MAX_LENGTH));
    });
  });

  describe("recipes.$id.steps.new (Create Step)", () => {
    const mockData = {
      recipe: { id: "test-recipe-id", title: "Test Recipe" },
      nextStepNum: 1,
    };

    const renderNewStep = async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/new",
          Component: NewStep,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/test-recipe-id/steps/new"]} />);
      await screen.findByRole("heading", { name: /Add Step/i });
    };

    it("stepTitle field has maxLength attribute", async () => {
      await renderNewStep();
      const stepTitleInput = screen.getByLabelText(/Step Title/);
      expect(stepTitleInput).toHaveAttribute("maxLength", String(STEP_TITLE_MAX_LENGTH));
    });

    it("description field has required attribute", async () => {
      await renderNewStep();
      const descriptionTextarea = screen.getByLabelText(/Description/);
      expect(descriptionTextarea).toBeRequired();
    });

    it("description field has maxLength attribute", async () => {
      await renderNewStep();
      const descriptionTextarea = screen.getByLabelText(/Description/);
      expect(descriptionTextarea).toHaveAttribute("maxLength", String(STEP_DESCRIPTION_MAX_LENGTH));
    });
  });

  describe("recipes.$id.steps.$stepId.edit (Edit Step)", () => {
    const mockData = {
      recipe: { id: "test-recipe-id", title: "Test Recipe" },
      step: {
        id: "test-step-id",
        stepNum: 1,
        stepTitle: "Test Step",
        description: "Test step description",
        ingredients: [],
      },
    };

    const renderEditStep = async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/test-recipe-id/steps/test-step-id/edit"]} />);
      await screen.findByRole("heading", { name: /Edit Step/i });
    };

    it("stepTitle field has maxLength attribute", async () => {
      await renderEditStep();
      const stepTitleInput = screen.getByLabelText(/Step Title/);
      expect(stepTitleInput).toHaveAttribute("maxLength", String(STEP_TITLE_MAX_LENGTH));
    });

    it("description field has required attribute", async () => {
      await renderEditStep();
      const descriptionTextarea = screen.getByLabelText(/Description/);
      expect(descriptionTextarea).toBeRequired();
    });

    it("description field has maxLength attribute", async () => {
      await renderEditStep();
      const descriptionTextarea = screen.getByLabelText(/Description/);
      expect(descriptionTextarea).toHaveAttribute("maxLength", String(STEP_DESCRIPTION_MAX_LENGTH));
    });
  });

  describe("recipes.$id.steps.$stepId.edit ingredient form", () => {
    const mockData = {
      recipe: { id: "test-recipe-id", title: "Test Recipe" },
      step: {
        id: "test-step-id",
        stepNum: 1,
        stepTitle: "Test Step",
        description: "Test step description",
        ingredients: [],
      },
    };

    beforeEach(() => {
      // Reset localStorage mock before each test
      localStorageStore = {};
      vi.clearAllMocks();
    });

    const renderEditStepWithIngredientForm = async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/steps/:stepId/edit",
          Component: EditStep,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/recipes/test-recipe-id/steps/test-step-id/edit"]} />);
      await screen.findByRole("heading", { name: /Edit Step/i });

      // Click "Add Ingredient" button to show the form
      const addButton = screen.getByRole("button", { name: /Add Ingredient/i });
      await userEvent.click(addButton);

      // Wait for the AI mode toggle to be visible
      const toggle = await screen.findByRole("switch");

      // Toggle to manual mode to access the quantity/unit/ingredient fields
      // (AI mode is now the default, so we need to switch to manual)
      await userEvent.click(toggle);

      // Wait for manual mode fields to appear (quantity is a spinbutton)
      await waitFor(() => {
        expect(screen.getByRole("spinbutton", { name: /Quantity/i })).toBeInTheDocument();
      });
    };

    it("quantity field has min attribute", async () => {
      await renderEditStepWithIngredientForm();
      const quantityInput = await screen.findByLabelText(/Quantity/);
      expect(quantityInput).toHaveAttribute("min", String(QUANTITY_MIN));
    });

    it("quantity field has max attribute", async () => {
      await renderEditStepWithIngredientForm();
      const quantityInput = await screen.findByLabelText(/Quantity/);
      expect(quantityInput).toHaveAttribute("max", String(QUANTITY_MAX));
    });

    it("quantity field has required attribute", async () => {
      await renderEditStepWithIngredientForm();
      const quantityInput = await screen.findByLabelText(/Quantity/);
      expect(quantityInput).toBeRequired();
    });

    it("unitName field has required attribute", async () => {
      await renderEditStepWithIngredientForm();
      const unitNameInput = await screen.findByLabelText(/Unit/);
      expect(unitNameInput).toBeRequired();
    });

    it("unitName field has maxLength attribute", async () => {
      await renderEditStepWithIngredientForm();
      const unitNameInput = await screen.findByLabelText(/Unit/);
      expect(unitNameInput).toHaveAttribute("maxLength", String(UNIT_NAME_MAX_LENGTH));
    });

    it("ingredientName field has required attribute", async () => {
      await renderEditStepWithIngredientForm();
      const ingredientNameInput = await screen.findByLabelText(/Ingredient/);
      expect(ingredientNameInput).toBeRequired();
    });

    it("ingredientName field has maxLength attribute", async () => {
      await renderEditStepWithIngredientForm();
      const ingredientNameInput = await screen.findByLabelText(/Ingredient/);
      expect(ingredientNameInput).toHaveAttribute("maxLength", String(INGREDIENT_NAME_MAX_LENGTH));
    });
  });
});
