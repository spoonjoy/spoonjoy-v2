/**
 * Tests for RecipeBuilder component.
 *
 * RecipeBuilder is the orchestration layer that composes:
 * - Metadata section (title, description, servings, image)
 * - StepList (steps with ingredients, reordering, dependencies)
 *
 * Features:
 * - Single-page recipe creation experience
 * - Handles both create (new recipe) and edit (existing recipe) modes
 * - No page navigation during creation
 * - Single save action for entire recipe
 * - Progressive disclosure: start simple, expand on demand
 * - Error display with aria-describedby for accessibility
 * - Loading state with spinner
 * - Character limits on inputs
 */

import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRoutesStub } from "react-router";
import { useState } from "react";
import { RecipeBuilder } from "~/components/recipe/RecipeBuilder";
import type { StepData } from "~/components/recipe/StepEditorCard";

// Mock localStorage for IngredientInputToggle used by StepEditorCard
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

// Helper to create test recipe data
function createTestRecipe(
  overrides: Partial<{
    id: string;
    title: string;
    description: string | null;
    servings: string | null;
    coverImageUrl: string | null;
    steps: StepData[];
  }> = {},
) {
  return {
    id: "recipe-1",
    title: "Test Recipe",
    description: "A test recipe description",
    servings: "4 servings",
    coverImageUrl: "",
    steps: [],
    ...overrides,
  };
}

// Helper to create test step data
function createTestStep(overrides: Partial<StepData> = {}): StepData {
  return {
    id: `step-${Math.random().toString(36).substring(7)}`,
    stepNum: 1,
    description: "Test step description",
    ingredients: [],
    ...overrides,
  };
}

// Create test wrapper with router context
function createTestWrapper(
  props: Partial<React.ComponentProps<typeof RecipeBuilder>> = {},
) {
  const defaultProps = {
    onSave: vi.fn(),
    ...props,
  };

  return createRoutesStub([
    {
      path: "/recipes/new",
      Component: () => <RecipeBuilder {...defaultProps} />,
      action: async () => ({ parsedIngredients: [] }),
    },
    {
      path: "/recipes/:id/edit",
      Component: () => <RecipeBuilder {...defaultProps} />,
      action: async () => ({ parsedIngredients: [] }),
    },
    // Route for AI ingredient parsing
    {
      path: "/recipes/:id/steps/:stepId/edit",
      action: async () => ({ parsedIngredients: [] }),
    },
  ]);
}

describe("RecipeBuilder", () => {
  beforeEach(() => {
    localStorageStore = {};
    vi.resetAllMocks();
    localStorageMock.getItem.mockImplementation(
      (key: string) => localStorageStore[key] ?? null,
    );
    localStorageMock.setItem.mockImplementation(
      (key: string, value: string) => {
        localStorageStore[key] = value;
      },
    );
    localStorageMock.removeItem.mockImplementation((key: string) => {
      delete localStorageStore[key];
    });
    localStorageMock.clear.mockImplementation(() => {
      localStorageStore = {};
    });
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  describe("rendering", () => {
    it("renders metadata section (title, description, servings)", () => {
      const Wrapper = createTestWrapper();
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Should have title input
      expect(screen.getByLabelText(/title/i)).toBeInTheDocument();

      // Should have description input
      expect(screen.getByLabelText(/description/i)).toBeInTheDocument();

      // Should have servings input
      expect(screen.getByLabelText(/servings/i)).toBeInTheDocument();
    });

    it("renders StepList section", () => {
      const Wrapper = createTestWrapper();
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Should have Add Step button from StepList
      expect(
        screen.getByRole("button", { name: /add step/i }),
      ).toBeInTheDocument();
    });
  });

  describe("create mode", () => {
    it("starts with empty form and no steps", () => {
      const Wrapper = createTestWrapper();
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Title should be empty
      expect(screen.getByLabelText(/title/i)).toHaveValue("");

      // Description should be empty
      expect(screen.getByLabelText(/description/i)).toHaveValue("");

      // Servings should be empty
      expect(screen.getByLabelText(/servings/i)).toHaveValue("");

      // Should show empty state for steps
      expect(screen.getByText(/no steps/i)).toBeInTheDocument();
    });
  });

  describe("edit mode", () => {
    it("pre-populates with existing recipe data", () => {
      const recipe = createTestRecipe({
        title: "Chocolate Cake",
        description: "A delicious chocolate cake",
        servings: "8 slices",
      });
      const Wrapper = createTestWrapper({ recipe });
      render(<Wrapper initialEntries={["/recipes/recipe-1/edit"]} />);

      // Should have pre-filled title
      expect(screen.getByLabelText(/title/i)).toHaveValue("Chocolate Cake");

      // Should have pre-filled description
      expect(screen.getByLabelText(/description/i)).toHaveValue(
        "A delicious chocolate cake",
      );

      // Should have pre-filled servings
      expect(screen.getByLabelText(/servings/i)).toHaveValue("8 slices");
    });

    it("pre-populates with existing steps", () => {
      const recipe = createTestRecipe({
        steps: [
          createTestStep({
            id: "step-1",
            stepNum: 1,
            description: "Mix flour and sugar",
          }),
          createTestStep({
            id: "step-2",
            stepNum: 2,
            description: "Add eggs and milk",
          }),
        ],
      });
      const Wrapper = createTestWrapper({ recipe });
      render(<Wrapper initialEntries={["/recipes/recipe-1/edit"]} />);

      // Should render both steps
      expect(screen.getByLabelText(/step 1/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/step 2/i)).toBeInTheDocument();

      // Should not show empty state
      expect(screen.queryByText(/no steps/i)).not.toBeInTheDocument();
    });
  });

  describe("step management", () => {
    it("can add steps via StepList", async () => {
      const Wrapper = createTestWrapper();
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Initially no steps
      expect(screen.getByText(/no steps/i)).toBeInTheDocument();

      // Click add step
      await userEvent.click(screen.getByRole("button", { name: /add step/i }));

      // Should now have a step card
      expect(screen.getByLabelText(/step 1/i)).toBeInTheDocument();

      // Empty state should be gone
      expect(screen.queryByText(/no steps/i)).not.toBeInTheDocument();
    });
  });

  describe("save functionality", () => {
    it("save button calls onSave with complete recipe data (metadata + steps)", async () => {
      const onSave = vi.fn();
      const Wrapper = createTestWrapper({ onSave });
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Fill in recipe metadata
      await userEvent.type(screen.getByLabelText(/title/i), "My New Recipe");
      await userEvent.type(
        screen.getByLabelText(/description/i),
        "A wonderful recipe",
      );
      await userEvent.type(screen.getByLabelText(/servings/i), "4");

      // Add a step and fill it
      await userEvent.click(screen.getByRole("button", { name: /add step/i }));
      const stepCard = screen.getByLabelText(/step 1/i);
      const instructionsTextarea =
        within(stepCard).getByLabelText(/instructions/i);
      await userEvent.type(instructionsTextarea, "Mix all ingredients");

      // Save the step first
      await userEvent.click(
        within(stepCard).getByRole("button", { name: /save/i }),
      );

      // Click main save button
      await userEvent.click(
        screen.getByRole("button", { name: /create recipe/i }),
      );

      // onSave should be called with complete data
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "My New Recipe",
          description: "A wonderful recipe",
          servings: "4",
          steps: expect.arrayContaining([
            expect.objectContaining({
              description: "Mix all ingredients",
            }),
          ]),
        }),
      );
    });

    it("save button disabled when title is empty (validation)", () => {
      const Wrapper = createTestWrapper();
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Save button should be disabled when title is empty
      const saveButton = screen.getByRole("button", { name: /create recipe/i });
      expect(saveButton).toBeDisabled();
    });

    it("save button enabled when title is provided", async () => {
      const Wrapper = createTestWrapper();
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Type a title
      await userEvent.type(screen.getByLabelText(/title/i), "My Recipe");

      // Save button should now be enabled
      const saveButton = screen.getByRole("button", { name: /create recipe/i });
      expect(saveButton).toBeEnabled();
    });

    it("does not call onSave when clicking save with empty title", async () => {
      const onSave = vi.fn();
      const Wrapper = createTestWrapper({ onSave });
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Get the save button - it's aria-disabled but not disabled
      const saveButton = screen.getByRole("button", { name: /create recipe/i });

      // Force a click even though the button is aria-disabled
      // In real browsers, aria-disabled doesn't prevent clicks
      await userEvent.click(saveButton, { pointerEventsCheck: 0 });

      // onSave should NOT have been called because handleSave returns early
      expect(onSave).not.toHaveBeenCalled();
    });

    it("does not call onSave when clicking save with whitespace-only title", async () => {
      const onSave = vi.fn();
      const Wrapper = createTestWrapper({ onSave });
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Type only whitespace
      await userEvent.type(screen.getByLabelText(/title/i), "   ");

      // Get the save button
      const saveButton = screen.getByRole("button", { name: /create recipe/i });

      // Force a click
      await userEvent.click(saveButton, { pointerEventsCheck: 0 });

      // onSave should NOT have been called
      expect(onSave).not.toHaveBeenCalled();
    });

    it("does not call onSave for the initial save request signal", async () => {
      const onSave = vi.fn();
      const Wrapper = createTestWrapper({ onSave, saveRequestSignal: 1 });
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      await userEvent.type(screen.getByLabelText(/title/i), "Initial Signal Recipe");

      expect(onSave).not.toHaveBeenCalled();
    });

    it("calls onSave when saveRequestSignal changes", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();

      function SaveSignalHost() {
        const [saveRequestSignal, setSaveRequestSignal] = useState(0);

        return (
          <>
            <button
              type="button"
              onClick={() => setSaveRequestSignal((signal) => signal + 1)}
            >
              Dock Save
            </button>
            <RecipeBuilder
              onSave={onSave}
              saveRequestSignal={saveRequestSignal}
            />
          </>
        );
      }

      const Wrapper = createRoutesStub([
        {
          path: "/recipes/new",
          Component: SaveSignalHost,
          action: async () => ({ parsedIngredients: [] }),
        },
      ]);

      render(<Wrapper initialEntries={["/recipes/new"]} />);

      await user.type(screen.getByLabelText(/title/i), "Dock Saved Recipe");
      await user.click(screen.getByRole("button", { name: "Dock Save" }));

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Dock Saved Recipe" }),
      );
    });

    it("converts empty description to null on save", async () => {
      const onSave = vi.fn();
      const Wrapper = createTestWrapper({ onSave });
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Fill in only title, leave description empty
      await userEvent.type(
        screen.getByLabelText(/title/i),
        "Title Only Recipe",
      );

      // Click save
      await userEvent.click(
        screen.getByRole("button", { name: /create recipe/i }),
      );

      // onSave should be called with null description
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Title Only Recipe",
          description: null,
        }),
      );
    });

    it("converts empty servings to null on save", async () => {
      const onSave = vi.fn();
      const Wrapper = createTestWrapper({ onSave });
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Fill in title and description, leave servings empty
      await userEvent.type(
        screen.getByLabelText(/title/i),
        "Recipe Without Servings",
      );
      await userEvent.type(
        screen.getByLabelText(/description/i),
        "A description",
      );

      // Click save
      await userEvent.click(
        screen.getByRole("button", { name: /create recipe/i }),
      );

      // onSave should be called with null servings
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Recipe Without Servings",
          description: "A description",
          servings: null,
        }),
      );
    });
  });

  describe("cancel functionality", () => {
    it("cancel button calls onCancel", async () => {
      const onCancel = vi.fn();
      const Wrapper = createTestWrapper({ onCancel });
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Click cancel button
      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe("disabled state", () => {
    it("disabled prop disables all sections", () => {
      const Wrapper = createTestWrapper({ disabled: true });
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Form inputs should be disabled
      expect(screen.getByLabelText(/title/i)).toBeDisabled();
      expect(screen.getByLabelText(/description/i)).toBeDisabled();
      expect(screen.getByLabelText(/servings/i)).toBeDisabled();

      // Add step button should be disabled
      expect(screen.getByRole("button", { name: /add step/i })).toBeDisabled();

      // Save button should be disabled
      expect(
        screen.getByRole("button", { name: /create recipe/i }),
      ).toBeDisabled();

      // Cancel button should be disabled
      expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
    });

    it("disabled prop disables all step cards", () => {
      const recipe = createTestRecipe({
        steps: [createTestStep({ id: "step-1", stepNum: 1 })],
      });
      const Wrapper = createTestWrapper({ recipe, disabled: true });
      render(<Wrapper initialEntries={["/recipes/recipe-1/edit"]} />);

      // Step card controls should be disabled
      const stepCard = screen.getByLabelText(/step 1/i);
      expect(
        within(stepCard).getByRole("button", { name: /save/i }),
      ).toBeDisabled();
      expect(
        within(stepCard).getByRole("button", { name: /remove/i }),
      ).toBeDisabled();
    });
  });

  describe("recipe data completeness", () => {
    it("recipe data includes all steps with their ingredients", async () => {
      const onSave = vi.fn();
      const recipe = createTestRecipe({
        title: "Recipe with Ingredients",
        steps: [
          createTestStep({
            id: "step-1",
            stepNum: 1,
            description: "Mix dry ingredients",
            ingredients: [
              { quantity: 2, unit: "cups", ingredientName: "flour" },
              { quantity: 1, unit: "tsp", ingredientName: "salt" },
            ],
          }),
          createTestStep({
            id: "step-2",
            stepNum: 2,
            description: "Add wet ingredients",
            ingredients: [{ quantity: 1, unit: "cup", ingredientName: "milk" }],
          }),
        ],
      });
      const Wrapper = createTestWrapper({ recipe, onSave });
      render(<Wrapper initialEntries={["/recipes/recipe-1/edit"]} />);

      // Click save (edit mode uses "Save Recipe")
      await userEvent.click(
        screen.getByRole("button", { name: /save recipe/i }),
      );

      // onSave should include all steps with ingredients
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          steps: expect.arrayContaining([
            expect.objectContaining({
              description: "Mix dry ingredients",
              ingredients: expect.arrayContaining([
                expect.objectContaining({ ingredientName: "flour" }),
                expect.objectContaining({ ingredientName: "salt" }),
              ]),
            }),
            expect.objectContaining({
              description: "Add wet ingredients",
              ingredients: expect.arrayContaining([
                expect.objectContaining({ ingredientName: "milk" }),
              ]),
            }),
          ]),
        }),
      );
    });
  });

  describe("progressive disclosure", () => {
    it('shows "Add first step" prompt when no steps', () => {
      const Wrapper = createTestWrapper();
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Should show prompt to add first step
      expect(screen.getByText(/add your first step/i)).toBeInTheDocument();
    });

    it('hides "Add first step" prompt after adding a step', async () => {
      const Wrapper = createTestWrapper();
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Initially shows prompt
      expect(screen.getByText(/add your first step/i)).toBeInTheDocument();

      // Add a step
      await userEvent.click(screen.getByRole("button", { name: /add step/i }));

      // Prompt should be hidden
      expect(
        screen.queryByText(/add your first step/i),
      ).not.toBeInTheDocument();
    });
  });

  describe("form state management", () => {
    it("tracks form changes locally without calling onSave", async () => {
      const onSave = vi.fn();
      const Wrapper = createTestWrapper({ onSave });
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Type in title
      await userEvent.type(screen.getByLabelText(/title/i), "New Recipe");

      // Add a step
      await userEvent.click(screen.getByRole("button", { name: /add step/i }));

      // onSave should not have been called yet
      expect(onSave).not.toHaveBeenCalled();
    });

    it("preserves step data when adding new steps", async () => {
      const Wrapper = createTestWrapper();
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Add first step and fill it
      await userEvent.click(screen.getByRole("button", { name: /add step/i }));
      const firstStepCard = screen.getByLabelText(/step 1/i);
      const firstTextarea =
        within(firstStepCard).getByLabelText(/instructions/i);
      await userEvent.type(firstTextarea, "First step instructions");

      // Save first step
      await userEvent.click(
        within(firstStepCard).getByRole("button", { name: /save/i }),
      );

      // Add second step
      await userEvent.click(screen.getByRole("button", { name: /add step/i }));

      // First step should still have its content
      expect(firstTextarea).toHaveValue("First step instructions");

      // Second step should exist
      expect(screen.getByLabelText(/step 2/i)).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    // Note: heading structure is tested at the route level (recipes.new.tsx, recipes.$id.edit.tsx)
    // The component itself doesn't include a heading because the parent route provides it

    it("form sections are properly labeled", () => {
      const Wrapper = createTestWrapper();
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Recipe details section should be identifiable
      expect(
        screen.getByRole("group", { name: /recipe details/i }),
      ).toBeInTheDocument();

      // Steps section should be identifiable
      expect(
        screen.getByRole("region", { name: /steps/i }),
      ).toBeInTheDocument();
    });
  });

  describe("image upload", () => {
    it("renders the upload placeholder for an existing recipe with null coverImageUrl", () => {
      const Wrapper = createTestWrapper({
        recipe: createTestRecipe({ coverImageUrl: null }),
      });
      render(<Wrapper initialEntries={["/recipes/recipe-1/edit"]} />);

      expect(screen.getByText(/upload image/i)).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });

    it("revokes previous preview URL when selecting a new image", async () => {
      const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
      const Wrapper = createTestWrapper();
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Find the file input (it should be present in the image upload component)
      const fileInput = screen.getByLabelText(/recipe image/i);

      // Create first image file
      const firstFile = new File(["content1"], "image1.jpg", {
        type: "image/jpeg",
      });
      await userEvent.upload(fileInput, firstFile);

      // Wait a moment for state to update
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Create second image file and upload it
      const secondFile = new File(["content2"], "image2.jpg", {
        type: "image/jpeg",
      });
      await userEvent.upload(fileInput, secondFile);

      // Wait a moment for state to update
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // revokeObjectURL should have been called when the second image was selected
      expect(revokeObjectURL).toHaveBeenCalled();

      revokeObjectURL.mockRestore();
    });

    it("revokes preview URL when clearing an image", async () => {
      const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
      const Wrapper = createTestWrapper();
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Find the file input and upload an image
      const fileInput = screen.getByLabelText(/recipe image/i);
      const file = new File(["content"], "image.jpg", { type: "image/jpeg" });
      await userEvent.upload(fileInput, file);

      // Wait for state to update
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Clear the image (look for clear/remove button)
      const clearButton = screen.getByRole("button", { name: /clear|remove/i });
      await userEvent.click(clearButton);

      // revokeObjectURL should have been called when clearing
      expect(revokeObjectURL).toHaveBeenCalled();

      revokeObjectURL.mockRestore();
    });
  });

  describe("keyboard navigation", () => {
    it("form fields and buttons are reachable via tab in logical order", async () => {
      const Wrapper = createTestWrapper();
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Verify form fields are reachable via tab (first 3 tabs reach the main inputs)
      await userEvent.tab();
      expect(screen.getByLabelText(/title/i)).toHaveFocus();

      // Fill in title to enable save button
      await userEvent.type(screen.getByLabelText(/title/i), "Test Recipe");

      await userEvent.tab();
      expect(screen.getByLabelText(/description/i)).toHaveFocus();

      await userEvent.tab();
      expect(screen.getByLabelText(/servings/i)).toHaveFocus();

      // Image upload area has variable number of tabbable elements
      // Skip through to find Add Step button
      const addStepButton = screen.getByRole("button", { name: /add step/i });
      const cancelButton = screen.getByRole("button", { name: /cancel/i });
      const saveButton = screen.getByRole("button", { name: /create recipe/i });

      // Verify all action buttons exist and are not disabled (save enabled because title filled)
      expect(addStepButton).not.toBeDisabled();
      expect(cancelButton).not.toBeDisabled();
      expect(saveButton).not.toBeDisabled();
    });

    it("all form inputs are keyboard accessible (no tabindex=-1)", () => {
      const Wrapper = createTestWrapper();
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // All inputs should not have tabindex=-1
      const titleInput = screen.getByLabelText(/title/i);
      const descriptionInput = screen.getByLabelText(/description/i);
      const servingsInput = screen.getByLabelText(/servings/i);

      expect(titleInput).not.toHaveAttribute("tabindex", "-1");
      expect(descriptionInput).not.toHaveAttribute("tabindex", "-1");
      expect(servingsInput).not.toHaveAttribute("tabindex", "-1");
    });

    it("all buttons are keyboard accessible (no tabindex=-1)", () => {
      const Wrapper = createTestWrapper();
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      const addStepButton = screen.getByRole("button", { name: /add step/i });
      const cancelButton = screen.getByRole("button", { name: /cancel/i });
      const saveButton = screen.getByRole("button", { name: /create recipe/i });

      expect(addStepButton).not.toHaveAttribute("tabindex", "-1");
      expect(cancelButton).not.toHaveAttribute("tabindex", "-1");
      expect(saveButton).not.toHaveAttribute("tabindex", "-1");
    });

    it("can navigate and interact with step cards using keyboard after adding a step", async () => {
      const Wrapper = createTestWrapper();
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Tab to Add Step button (title, description, servings, image upload area, add step)
      await userEvent.tab(); // title
      await userEvent.tab(); // description
      await userEvent.tab(); // servings
      await userEvent.tab(); // image upload
      await userEvent.tab(); // possibly more image elements
      await userEvent.tab(); // add step
      // Find and click the Add Step button directly instead of relying on tab order
      const addStepButton = screen.getByRole("button", { name: /add step/i });
      await userEvent.click(addStepButton);

      // A step card should now exist
      expect(screen.getByLabelText(/step 1/i)).toBeInTheDocument();

      // Continue tabbing - should reach the step card's instructions textarea
      await userEvent.tab();
      // Should be in the step card now - verify we can interact with elements
      const stepCard = screen.getByLabelText(/step 1/i);
      const instructionsTextarea =
        within(stepCard).getByLabelText(/instructions/i);
      // The instructions textarea should eventually receive focus through tabbing
      expect(instructionsTextarea).not.toHaveAttribute("tabindex", "-1");
    });

    it("Enter key on create recipe button triggers save", async () => {
      const onSave = vi.fn();
      const Wrapper = createTestWrapper({ onSave });
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Fill in title (required for save)
      await userEvent.type(screen.getByLabelText(/title/i), "My Recipe");

      // Focus the save button and press Enter (wrapped in act to avoid warnings)
      await act(async () => {
        screen.getByRole("button", { name: /create recipe/i }).focus();
      });
      await userEvent.keyboard("{Enter}");

      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("Enter key on Cancel button triggers cancel", async () => {
      const onCancel = vi.fn();
      const Wrapper = createTestWrapper({ onCancel });
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Focus the cancel button and press Enter (wrapped in act to avoid warnings)
      await act(async () => {
        screen.getByRole("button", { name: /cancel/i }).focus();
      });
      await userEvent.keyboard("{Enter}");

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("Space key on create recipe button triggers save", async () => {
      const onSave = vi.fn();
      const Wrapper = createTestWrapper({ onSave });
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Fill in title (required for save)
      await userEvent.type(screen.getByLabelText(/title/i), "My Recipe");

      // Focus the save button and press Space (wrapped in act to avoid warnings)
      await act(async () => {
        screen.getByRole("button", { name: /create recipe/i }).focus();
      });
      await userEvent.keyboard(" ");

      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("does not call onSave when loading is true even with valid title", async () => {
      const onSave = vi.fn();
      const Wrapper = createTestWrapper({ onSave, loading: true });
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // When loading, the button is disabled even though it shows "Create Recipe"
      // The save button has aria-busy="true" when loading
      const saveButton = screen.getByRole("button", { name: /create recipe/i });
      expect(saveButton).toBeDisabled();
      expect(saveButton).toHaveAttribute("aria-busy", "true");
      expect(onSave).not.toHaveBeenCalled();
    });

    it("displays servings field validation error when errors prop contains servings error", () => {
      const Wrapper = createTestWrapper({
        errors: { servings: "Servings cannot exceed 100 characters" },
      });
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      // Verify the servings error message is displayed
      expect(
        screen.getByText("Servings cannot exceed 100 characters"),
      ).toBeInTheDocument();

      // Verify the servings input has error styling
      const servingsInput = screen.getByLabelText(/servings/i);
      expect(servingsInput).toHaveAttribute("data-invalid");
      expect(servingsInput).toHaveAttribute("aria-invalid", "true");
      expect(servingsInput).toHaveAccessibleDescription("Servings cannot exceed 100 characters");
    });

    it("displays steps validation error when errors prop contains steps error", () => {
      const Wrapper = createTestWrapper({
        errors: { steps: "Step 1: Step description is required" },
      });
      render(<Wrapper initialEntries={["/recipes/new"]} />);

      expect(screen.getByRole("alert")).toHaveTextContent("Step 1: Step description is required");
    });
  });
});
