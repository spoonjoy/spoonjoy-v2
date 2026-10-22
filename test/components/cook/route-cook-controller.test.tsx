import { act, render, renderHook, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecipeCookView } from "~/components/cook/RecipeCookView";
import {
  getCookProgressStorageKey,
  toCookRecipe,
  useRouteCookController,
  type RecipeDetailLoaderData,
} from "~/hooks/use-route-cook-controller";
import { createTestRoutesStub } from "../../utils";
import loaderFixture from "../../fixtures/cook/recipe-detail-loader.json";
import { describeCookView } from "./recipe-cook-view.contract";

// Recorded from the real recipe loader (loadRecipeDetail) for a signed-out visitor.
const LOADER_DATA = loaderFixture as RecipeDetailLoaderData;
const RECIPE_PATH = `/recipes/${LOADER_DATA.recipe.id}`;

function inRecipeRoute(view: ReactElement, entry = RECIPE_PATH): ReactElement {
  const Stub = createTestRoutesStub([{ path: "/recipes/:id", Component: () => view }]);
  return <Stub initialEntries={[entry]} />;
}

function RouteCookView({ loaderData = LOADER_DATA }: { loaderData?: RecipeDetailLoaderData }) {
  return <RecipeCookView controller={useRouteCookController(loaderData)} />;
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describeCookView("route controller", () => ({
  useController: () => useRouteCookController(LOADER_DATA),
  wrap: (view) => inRecipeRoute(view),
}));

describe("toCookRecipe", () => {
  it("turns the loader's recipe into the cook view's recipe", () => {
    const recipe = toCookRecipe(LOADER_DATA.recipe);
    const [rinse, simmer, fluff] = LOADER_DATA.recipe.steps;

    expect(recipe.id).toBe("fixture-lemon-rice");
    expect(recipe.title).toBe("Lemon Herb Rice");
    expect(recipe.steps).toEqual([
      { id: rinse.id, stepNum: 1, stepTitle: "Rinse the rice", description: "Rinse until the water runs clear.", duration: null },
      { id: simmer.id, stepNum: 2, stepTitle: "Simmer", description: "Cover and simmer gently.", duration: 15 },
      { id: fluff.id, stepNum: 3, stepTitle: "Fluff", description: "Fluff with a fork and fold in the zest.", duration: null },
    ]);
    expect(recipe.ingredientsByStep.get(rinse.id)).toEqual([
      expect.objectContaining({ id: rinse.ingredients[0].id, quantity: 2, unit: "cup", name: "jasmine rice" }),
    ]);
    expect(recipe.ingredientsByStep.get(rinse.id)?.[0].iconKey).toEqual(expect.any(String));
    expect(recipe.stepOutputUsesByStep.get(rinse.id)).toEqual([]);
    expect(recipe.stepOutputUsesByStep.get(simmer.id)).toEqual([
      { id: simmer.usingSteps![0].id, stepNumber: 1, stepTitle: "Rinse the rice" },
    ]);
  });

  it("reads a step without step-output uses as having none", () => {
    const [step] = LOADER_DATA.recipe.steps;
    const recipe = toCookRecipe({ ...LOADER_DATA.recipe, steps: [{ ...step, usingSteps: undefined }] });

    expect(recipe.stepOutputUsesByStep.get(step.id)).toEqual([]);
  });
});

describe("useRouteCookController", () => {
  function wrapper({ children }: { children: ReactNode }) {
    return inRecipeRoute(<>{children}</>);
  }

  it("keeps the step inside the recipe", async () => {
    const { result } = renderHook(() => useRouteCookController(LOADER_DATA), { wrapper });

    await act(async () => result.current.goToStep(8));
    expect(result.current.activeStepIndex).toBe(2);
    await act(async () => result.current.goToStep(-1));
    expect(result.current.activeStepIndex).toBe(0);
  });

  it("opens cook mode from a #cook link at the saved step", async () => {
    window.localStorage.setItem(getCookProgressStorageKey(LOADER_DATA.recipe.id), JSON.stringify({
      version: 1,
      activeStepIndex: 1,
      activeStepId: LOADER_DATA.recipe.steps[1].id,
      scaleFactor: 2,
      checkedIngredientIds: [],
      checkedStepOutputIds: [],
      updatedAt: "2026-10-18T00:00:00.000Z",
    }));
    render(inRecipeRoute(<RouteCookView />, `${RECIPE_PATH}#cook`));

    const panel = await screen.findByTestId("cook-mode-panel");
    expect(within(panel).getAllByText("Step 2 of 3")[0]).toBeInTheDocument();
    expect(within(panel).getByRole("textbox", { name: "Scale" })).toHaveValue("2");
  });

  it("server-renders with no progress, hydrates without a mismatch, then restores saved progress", async () => {
    const [rinse] = LOADER_DATA.recipe.steps;
    window.localStorage.setItem(getCookProgressStorageKey(LOADER_DATA.recipe.id), JSON.stringify({
      version: 1,
      activeStepIndex: 0,
      activeStepId: rinse.id,
      scaleFactor: 1,
      checkedIngredientIds: [rinse.ingredients[0].id],
      checkedStepOutputIds: [],
      updatedAt: "2026-10-18T00:00:00.000Z",
    }));
    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    let root: Root | undefined;
    try {
      container.innerHTML = renderToString(inRecipeRoute(<RouteCookView />));
      document.body.appendChild(container);
      expect(within(container).getByRole("checkbox", { name: "jasmine rice" })).toHaveAttribute("aria-checked", "false");

      const recoverableErrors: unknown[] = [];
      await act(async () => {
        root = hydrateRoot(container, inRecipeRoute(<RouteCookView />), {
          onRecoverableError: (error) => {
            recoverableErrors.push(error);
          },
        });
      });

      expect(recoverableErrors).toEqual([]);
      expect(within(container).getByRole("checkbox", { name: "jasmine rice" })).toHaveAttribute("aria-checked", "true");
    } finally {
      act(() => root?.unmount());
      container.remove();
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });
});
