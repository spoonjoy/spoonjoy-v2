import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";

vi.mock("~/components/recipe/IngredientInputToggle", () => ({
  IngredientInputToggle: ({ mode, onChange }: { mode: "ai" | "manual"; onChange: (mode: "ai" | "manual") => void }) => (
    <div>
      <span>Current mode: {mode}</span>
      <button type="button" onClick={() => onChange("manual")}>Use manual mode</button>
      <button type="button" onClick={() => onChange("ai")}>Use AI mode</button>
    </div>
  ),
}));

vi.mock("~/components/recipe/ManualIngredientInput", () => ({
  ManualIngredientInput: ({
    onAdd,
  }: {
    onAdd: (ingredient: { quantity: number; unit: string; ingredientName: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() => onAdd({ quantity: 1.5, unit: "cups", ingredientName: "manual flour" })}
    >
      Add manual ingredient
    </button>
  ),
}));

vi.mock("~/components/recipe/IngredientParseInput", () => ({
  IngredientParseInput: ({
    onParsed,
    onSwitchToManual,
  }: {
    onParsed: (ingredients: Array<{ quantity: number; unit: string; ingredientName: string }>) => void;
    onSwitchToManual: () => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => onParsed([
          { quantity: 2, unit: "tbsp", ingredientName: "parsed butter" },
          { quantity: 1, unit: "pinch", ingredientName: "parsed salt" },
        ])}
      >
        Emit parsed ingredients
      </button>
      <button type="button" onClick={onSwitchToManual}>Parse switch to manual</button>
    </div>
  ),
}));

vi.mock("~/components/recipe/ParsedIngredientList", () => ({
  ParsedIngredientList: ({
    ingredients,
    onEdit,
    onRemove,
    onAddAll,
  }: {
    ingredients: Array<{ quantity: number; unit: string; ingredientName: string }>;
    onEdit: (index: number, ingredient: { quantity: number; unit: string; ingredientName: string }) => void;
    onRemove: (index: number) => void;
    onAddAll: (ingredients: Array<{ quantity: number; unit: string; ingredientName: string }>) => void;
  }) => (
    <div aria-label="Parsed ingredient mock">
      {ingredients.map((ingredient, index) => (
        <div key={`${ingredient.ingredientName}-${index}`}>
          <span>{ingredient.quantity} {ingredient.unit} {ingredient.ingredientName}</span>
          <button
            type="button"
            onClick={() => onEdit(index, { quantity: 4, unit: "oz", ingredientName: "edited butter" })}
          >
            Edit {ingredient.ingredientName}
          </button>
          <button type="button" onClick={() => onRemove(index)}>Remove {ingredient.ingredientName}</button>
        </div>
      ))}
      <button type="button" onClick={() => onAddAll(ingredients)}>Add all parsed</button>
    </div>
  ),
}));

import NewStep from "~/routes/recipes.$id.steps.new";

function renderNewStep() {
  const Stub = createTestRoutesStub([
    {
      path: "/recipes/:id/steps/new",
      Component: NewStep,
      loader: () => ({
        recipe: {
          id: "recipe-1",
          title: "Test Recipe",
        },
        nextStepNum: 2,
        availableSteps: [{ stepNum: 1, stepTitle: "Prep" }],
      }),
    },
  ]);

  return render(<Stub initialEntries={["/recipes/recipe-1/steps/new"]} />);
}

describe("Recipes $id Steps New callback rendering", () => {
  it("updates parsed ingredients through parse list edit, remove, and add-all callbacks", async () => {
    renderNewStep();

    fireEvent.click(await screen.findByRole("button", { name: "Emit parsed ingredients" }));
    expect(screen.getByText("2 tbsp parsed butter")).toBeInTheDocument();
    expect(screen.getByText("1 pinch parsed salt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit parsed butter" }));
    expect(screen.getByText("4 oz edited butter")).toBeInTheDocument();
    expect(screen.queryByText("2 tbsp parsed butter")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove parsed salt" }));
    expect(screen.queryByText("1 pinch parsed salt")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add all parsed" }));
    expect(screen.queryByLabelText("Parsed ingredient mock")).not.toBeInTheDocument();

    const list = screen.getByRole("list");
    expect(list).toHaveTextContent("4 oz edited butter");
    expect((document.querySelector('input[name="ingredientsJson"]') as HTMLInputElement).value).toBe(
      JSON.stringify([{ quantity: 4, unit: "oz", ingredientName: "edited butter" }])
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("No ingredients added yet")).toBeInTheDocument();
    expect((document.querySelector('input[name="ingredientsJson"]') as HTMLInputElement).value).toBe("[]");
  });

  it("switches to manual mode from both toggle and parse callback and adds manual ingredients", async () => {
    renderNewStep();

    fireEvent.click(await screen.findByRole("button", { name: "Parse switch to manual" }));
    expect(screen.getByText("Current mode: manual")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add manual ingredient" }));
    expect(screen.getByRole("list")).toHaveTextContent("1.5 cups manual flour");
    expect((document.querySelector('input[name="ingredientsJson"]') as HTMLInputElement).value).toBe(
      JSON.stringify([{ quantity: 1.5, unit: "cups", ingredientName: "manual flour" }])
    );

    fireEvent.click(screen.getByRole("button", { name: "Use AI mode" }));
    expect(screen.getByText("Current mode: ai")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use manual mode" }));
    expect(screen.getByText("Current mode: manual")).toBeInTheDocument();
  });
});
