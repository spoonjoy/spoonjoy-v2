import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestRoutesStub } from "../utils";
import EditRecipe from "~/routes/recipes.$id.edit";
import NewStep from "~/routes/recipes.$id.steps.new";
import EditStep from "~/routes/recipes.$id.steps.$stepId.edit";
import { ToastProvider } from "~/components/ui/toast";

describe("Focused Step Editor Flow (E2E)", () => {
  it("renders compact step list cards with edit/delete/reorder controls and no inline editor", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/recipes/:id/edit",
        Component: EditRecipe,
        loader: () => ({
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
            description: null,
            servings: null,
            coverImageUrl: "",
            steps: [
              {
                id: "step-1",
                stepNum: 1,
                stepTitle: "Prep",
                description: "Mix ingredients",
                duration: null,
                ingredients: [{ id: "ing-1" }, { id: "ing-2" }],
              },
              {
                id: "step-2",
                stepNum: 2,
                stepTitle: null,
                description: "Bake",
                duration: null,
                ingredients: [],
              },
            ],
          },
          formattedSteps: [],
        }),
      },
    ]);

    render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);

    expect(await screen.findByRole("heading", { name: "Recipe Steps" })).toBeInTheDocument();
    expect(screen.getByText("Step 1")).toBeInTheDocument();
    expect(screen.getByText("Prep")).toBeInTheDocument();
    expect(screen.getByText("2 ingredients")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Edit" })[0]).toHaveAttribute("href", "/recipes/recipe-1/steps/step-1/edit");

    expect(screen.getAllByRole("button", { name: "Move Up" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Move Down" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);

    expect(screen.queryByLabelText(/instructions/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
  });

  it("deletes a step from list view through confirmation dialog", async () => {
    const submitted: Record<string, string> = {};
    const Stub = createTestRoutesStub([
      {
        path: "/recipes/:id/edit",
        Component: EditRecipe,
        loader: () => ({
          recipe: {
            id: "recipe-1",
            title: "Test Recipe",
            description: null,
            servings: null,
            coverImageUrl: "",
            steps: [{ id: "step-1", stepNum: 1, stepTitle: "Prep", description: "Mix", duration: null, ingredients: [] }],
          },
          formattedSteps: [],
        }),
        action: async ({ request }) => {
          const formData = await request.formData();
          submitted.intent = String(formData.get("intent") || "");
          submitted.stepId = String(formData.get("stepId") || "");
          return { success: true };
        },
      },
    ]);

    render(<Stub initialEntries={["/recipes/recipe-1/edit"]} />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(submitted.intent).toBe("deleteStep");
      expect(submitted.stepId).toBe("step-1");
    });
  });

  it("uses Add Step/Create labels in new focused editor", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/recipes/:id/steps/new",
        Component: NewStep,
        loader: () => ({
          recipe: { id: "recipe-1", title: "Recipe" },
          nextStepNum: 2,
          availableSteps: [{ stepNum: 1, stepTitle: "Prep" }],
        }),
      },
    ]);

    render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);

    expect(await screen.findByRole("heading", { name: "Add Step" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
    expect(screen.getAllByText("Ingredients", { selector: "label" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Create Step & Add Ingredients/i })).not.toBeInTheDocument();
  });

  it("uses Edit Step/Update labels, removes delete button, and shows create success feedback", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/recipes/:id/steps/:stepId/edit",
        Component: () => (
          <ToastProvider>
            <EditStep />
          </ToastProvider>
        ),
        loader: () => ({
          recipe: { id: "recipe-1", title: "Recipe" },
          step: {
            id: "step-1",
            recipeId: "recipe-1",
            stepNum: 2,
            description: "Mix and bake",
            stepTitle: "Bake",
            ingredients: [],
            usingSteps: [],
          },
          availableSteps: [{ stepNum: 1, stepTitle: "Prep" }],
        }),
      },
    ]);

    render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit?created=1"]} />);

    expect(await screen.findByRole("heading", { name: "Edit Step" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Step" })).not.toBeInTheDocument();
    expect(await screen.findByText("Step created successfully.")).toBeInTheDocument();
  });
});
