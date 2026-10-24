import { act, render, renderHook, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOK_TAB_STORAGE_KEY, readCookTab, writeCookTab } from "~/lib/cook-tab";
import { COOKING_NOW_LOCAL_STORAGE_KEY, readLocalCookingNow } from "~/lib/cooking-now";
import { useLocation } from "react-router";
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
  // Each test is a new tab: it keeps no tab state from the last.
  window.sessionStorage.clear();
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

describe("each tab's own cooking state", () => {
  const [rinse, simmer, fluff] = LOADER_DATA.recipe.steps;

  function wrapper({ children }: { children: ReactNode }) {
    return inRecipeRoute(<>{children}</>);
  }

  function saveSharedStep(index: number) {
    window.localStorage.setItem(getCookProgressStorageKey(LOADER_DATA.recipe.id), JSON.stringify({
      version: 1,
      activeStepIndex: index,
      activeStepId: LOADER_DATA.recipe.steps[index].id,
      scaleFactor: 1,
      checkedIngredientIds: [],
      checkedStepOutputIds: [],
      updatedAt: "2026-10-18T00:00:00.000Z",
    }));
  }

  it("comes back to this tab's step, not the one another tab saved last", async () => {
    saveSharedStep(2);
    writeCookTab({ recipeId: LOADER_DATA.recipe.id, mode: "read", activeStepIndex: 0, activeStepId: simmer.id });
    const { result } = renderHook(() => useRouteCookController(LOADER_DATA), { wrapper });

    await act(async () => undefined);
    expect(result.current.activeStepIndex).toBe(1);
    expect(result.current.resumeStepNum).toBe(2);
  });

  it("follows the shared step in a tab that has none, and offers no scroll on the first step", async () => {
    saveSharedStep(2);
    writeCookTab({ recipeId: "another-recipe", mode: "read", activeStepIndex: 1, activeStepId: null });
    const { result } = renderHook(() => useRouteCookController(LOADER_DATA), { wrapper });
    await act(async () => undefined);
    expect(result.current.activeStepIndex).toBe(2);
    expect(result.current.resumeStepNum).toBe(3);

    window.localStorage.clear();
    window.sessionStorage.clear();
    const fresh = renderHook(() => useRouteCookController(LOADER_DATA), { wrapper });
    await act(async () => undefined);
    expect(fresh.result.current.resumeStepNum).toBeNull();
  });

  it("records this tab's recipe, mode and step as they change", async () => {
    const { result } = renderHook(() => useRouteCookController(LOADER_DATA), { wrapper });
    await act(async () => undefined);
    expect(readCookTab(LOADER_DATA.recipe.id)).toEqual({ recipeId: LOADER_DATA.recipe.id, mode: "read", activeStepIndex: 0, activeStepId: rinse.id });

    await act(async () => result.current.goToStep(2));
    await act(async () => result.current.enterCookMode());
    expect(readCookTab(LOADER_DATA.recipe.id)).toEqual({ recipeId: LOADER_DATA.recipe.id, mode: "cook", activeStepIndex: 2, activeStepId: fluff.id });
  });

  it("reopens cook mode when this tab left the recipe with it open", async () => {
    writeCookTab({ recipeId: LOADER_DATA.recipe.id, mode: "cook", activeStepIndex: 1, activeStepId: simmer.id });
    let hash = "";
    function Probe() {
      hash = useLocation().hash;
      return null;
    }
    const { result } = renderHook(() => useRouteCookController(LOADER_DATA), {
      wrapper: ({ children }) => inRecipeRoute(<>{children}<Probe /></>),
    });

    await act(async () => undefined);
    expect(hash).toBe("#cook");
    expect(result.current.cookMode).toBe(true);
    expect(result.current.activeStepIndex).toBe(1);
  });

  it("leaves a #cook page as it is when this tab was cooking", async () => {
    writeCookTab({ recipeId: LOADER_DATA.recipe.id, mode: "cook", activeStepIndex: 0, activeStepId: null });
    const { result } = renderHook(() => useRouteCookController(LOADER_DATA), {
      wrapper: ({ children }) => inRecipeRoute(<>{children}</>, `${RECIPE_PATH}#cook`),
    });
    await act(async () => undefined);
    expect(result.current.cookMode).toBe(true);
    expect(window.sessionStorage.getItem(COOK_TAB_STORAGE_KEY)).toContain('"mode":"cook"');
  });

  it("does not reopen cook mode for a recipe without steps", async () => {
    const empty = { ...LOADER_DATA, recipe: { ...LOADER_DATA.recipe, steps: [] } };
    writeCookTab({ recipeId: LOADER_DATA.recipe.id, mode: "cook", activeStepIndex: 0, activeStepId: null });
    const { result } = renderHook(() => useRouteCookController(empty), { wrapper });
    await act(async () => undefined);
    expect(result.current.cookMode).toBe(false);
  });

  it("keeps a signed-out cook's Cooking now list in this browser", async () => {
    const { result } = renderHook(
      () => useRouteCookController(LOADER_DATA, { coverImageUrl: "/photos/rice.jpg" }),
      { wrapper },
    );
    await act(async () => undefined);
    expect(window.localStorage.getItem(COOKING_NOW_LOCAL_STORAGE_KEY)).not.toBeNull();
    expect(readLocalCookingNow()).toEqual([]);

    await act(async () => result.current.toggleIngredient(rinse.ingredients[0].id));
    expect(readLocalCookingNow()).toEqual([expect.objectContaining({
      recipe: { id: LOADER_DATA.recipe.id, title: "Lemon Herb Rice", coverImageUrl: "/photos/rice.jpg", href: RECIPE_PATH },
      checkedCount: 1,
      stepCount: 3,
    })]);
  });

  it("leaves a signed-in cook's list to the account, and never lets another device move this tab's step", async () => {
    const userId = "user-1";
    writeCookTab({ recipeId: LOADER_DATA.recipe.id, mode: "read", activeStepIndex: 0, activeStepId: rinse.id });
    const progress = { activeStepIndex: 2, activeStepId: fluff.id, scaleFactor: 2, checkedIngredientIds: [rinse.ingredients[0].id], checkedStepOutputIds: [] };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      state: { attemptId: "11111111-1111-4111-8111-111111111111", revision: 3, progress },
    })));
    try {
      const { result, unmount } = renderHook(() => useRouteCookController({ ...LOADER_DATA, cookSessionUserId: userId }), { wrapper });
      await vi.waitFor(() => expect(result.current.scaleFactor).toBe(2));

      expect(result.current.checkedIngredientIds.has(rinse.ingredients[0].id)).toBe(true);
      expect(result.current.activeStepIndex).toBe(0);
      expect(window.localStorage.getItem(COOKING_NOW_LOCAL_STORAGE_KEY)).toBeNull();
      unmount();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("takes another device's step in a tab with no step of its own", async () => {
    const progress = { activeStepIndex: 2, activeStepId: fluff.id, scaleFactor: 2, checkedIngredientIds: [], checkedStepOutputIds: [] };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      state: { attemptId: "11111111-1111-4111-8111-111111111111", revision: 3, progress },
    })));
    try {
      const { result, unmount } = renderHook(() => useRouteCookController({ ...LOADER_DATA, cookSessionUserId: "user-1" }), { wrapper });
      await vi.waitFor(() => expect(result.current.activeStepIndex).toBe(2));
      unmount();
    } finally {
      fetchMock.mockRestore();
    }
  });
});
