import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { CookController } from "~/components/cook/cook-controller";
import { RecipeCookView } from "~/components/cook/RecipeCookView";

/**
 * How one controller is driven through the shared cook-view contract. `useController` is called
 * inside a component on every render; `wrap` supplies whatever the controller needs around the
 * view (the route controller needs a router).
 */
export interface CookViewHarness {
  useController(): CookController;
  wrap?(view: ReactElement): ReactElement;
}

// The contract cooks the recipe recorded in test/fixtures/cook/recipe-detail-loader.json:
// Lemon Herb Rice, three steps, three ingredients and two step-output uses.
const STEP_TITLES = ["Rinse the rice", "Simmer", "Fluff"];
const CHECKLIST_TOTAL = 5;

/**
 * The cook-view contract. Every `CookController` must pass it unchanged, so the recipe page and
 * any page with a local controller behave the same in front of a cook.
 */
export function describeCookView(name: string, makeController: () => CookViewHarness) {
  describe(`RecipeCookView contract: ${name}`, () => {
    let latest: CookController | undefined;

    function controller(): CookController {
      if (!latest) throw new Error("The cook view has not rendered yet");
      return latest;
    }

    function tree(): ReactElement {
      const harness = makeController();
      function Harness() {
        const value = harness.useController();
        latest = value;
        return <RecipeCookView controller={value} />;
      }
      const view = <Harness />;
      return harness.wrap ? harness.wrap(view) : view;
    }

    async function renderView() {
      render(tree());
      await screen.findByRole("heading", { level: 2, name: "Steps" });
    }

    async function openCookMode() {
      await act(async () => controller().enterCookMode());
      return screen.findByTestId("cook-mode-panel");
    }

    function ingredientId(stepIndex: number): string {
      const recipe = controller().recipe;
      return recipe.ingredientsByStep.get(recipe.steps[stepIndex].id)![0].id;
    }

    afterEach(() => {
      cleanup();
      latest = undefined;
    });

    it("checks an ingredient off and counts it", async () => {
      const user = userEvent.setup();
      await renderView();
      const panel = await openCookMode();

      expect(within(panel).getByText(`0 of ${CHECKLIST_TOTAL} checked`)).toBeInTheDocument();
      await user.click(within(panel).getByRole("checkbox", { name: "jasmine rice" }));
      expect(within(panel).getByRole("checkbox", { name: "jasmine rice" })).toHaveAttribute("aria-checked", "true");
      expect(within(panel).getByText(`1 of ${CHECKLIST_TOTAL} checked`)).toBeInTheDocument();
      expect(controller().checkedIngredientIds.has(ingredientId(0))).toBe(true);

      await user.click(within(panel).getByRole("button", { name: "Next step" }));
      await user.click(within(panel).getByRole("checkbox", { name: "Step 1: Rinse the rice" }));
      expect(within(panel).getByText(`2 of ${CHECKLIST_TOTAL} checked`)).toBeInTheDocument();

      await user.click(within(panel).getByRole("checkbox", { name: "Step 1: Rinse the rice" }));
      expect(within(panel).getByRole("checkbox", { name: "Step 1: Rinse the rice" })).toHaveAttribute("aria-checked", "false");
      expect(within(panel).getByText(`1 of ${CHECKLIST_TOTAL} checked`)).toBeInTheDocument();
    });

    it("opens cook mode on step 1", async () => {
      await renderView();
      expect(screen.queryByTestId("cook-mode-panel")).not.toBeInTheDocument();

      const panel = await openCookMode();
      expect(within(panel).getByText("Step 1 of 3")).toBeInTheDocument();
      expect(within(panel).getByRole("heading", { level: 2, name: STEP_TITLES[0] })).toBeInTheDocument();
      expect(within(panel).getByRole("heading", { level: 1, name: "Lemon Herb Rice" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 2, name: "Steps" })).not.toBeInTheDocument();
    });

    it("moves between steps with next, previous and the step dots", async () => {
      const user = userEvent.setup();
      await renderView();
      const panel = await openCookMode();

      expect(within(panel).getByRole("button", { name: "Previous step" })).toBeDisabled();
      await user.click(within(panel).getByRole("button", { name: "Next step" }));
      expect(within(panel).getByText("Step 2 of 3")).toBeInTheDocument();
      expect(within(panel).getByRole("heading", { level: 2, name: STEP_TITLES[1] })).toBeInTheDocument();

      await user.click(within(panel).getByRole("button", { name: "Next step" }));
      expect(within(panel).getByText("Step 3 of 3")).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: "Next step" })).toBeDisabled();

      await user.click(within(panel).getByRole("button", { name: "Previous step" }));
      expect(within(panel).getByRole("heading", { level: 2, name: STEP_TITLES[1] })).toBeInTheDocument();

      await user.click(within(panel).getByRole("button", { name: "Step 1" }));
      expect(within(panel).getByText("Step 1 of 3")).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: "Step 1 current" })).toHaveAttribute("aria-current", "step");
      expect(controller().activeStepIndex).toBe(0);
    });

    it("scales quantities", async () => {
      const user = userEvent.setup();
      await renderView();
      const panel = await openCookMode();
      const quantity = () => within(panel).getByTestId(`ingredient-quantity-${ingredientId(0)}`);

      expect(quantity()).toHaveTextContent("2 cups");
      await user.click(within(panel).getByRole("button", { name: "Increase scale" }));
      await user.click(within(panel).getByRole("button", { name: "Increase scale" }));
      expect(within(panel).getByTestId("scale-display")).toHaveTextContent("1.5×");
      expect(quantity()).toHaveTextContent("3 cups");
      expect(controller().scaleFactor).toBe(1.5);
    });

    it("clears progress", async () => {
      const user = userEvent.setup();
      await renderView();

      expect(screen.getByTestId("clear-progress-button")).toBeDisabled();
      await user.click(screen.getByRole("checkbox", { name: "jasmine rice" }));
      await user.click(screen.getByRole("checkbox", { name: "water" }));
      await user.click(screen.getByRole("checkbox", { name: "Step 2: Simmer" }));
      expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(3);

      await user.click(screen.getByTestId("clear-progress-button"));
      expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0);
      expect(screen.getAllByRole("checkbox", { checked: false })).toHaveLength(CHECKLIST_TOTAL);
      expect(screen.getByTestId("clear-progress-button")).toBeDisabled();
      expect(controller().checkedIngredientIds.size).toBe(0);
      expect(controller().checkedStepOutputIds.size).toBe(0);
    });

    it("leaves cook mode for the steps, keeping progress", async () => {
      const user = userEvent.setup();
      await renderView();
      const panel = await openCookMode();
      await user.click(within(panel).getByRole("checkbox", { name: "jasmine rice" }));

      await user.click(within(panel).getByRole("button", { name: "Exit cook mode" }));
      expect(await screen.findByRole("heading", { level: 2, name: "Steps" })).toBeInTheDocument();
      expect(screen.queryByTestId("cook-mode-panel")).not.toBeInTheDocument();
      expect(controller().cookMode).toBe(false);
      expect(screen.getByRole("checkbox", { name: "jasmine rice" })).toHaveAttribute("aria-checked", "true");
    });

    describe("server render and hydration", () => {
      let root: Root | undefined;
      let container: HTMLDivElement | undefined;
      const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
      const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

      beforeAll(() => {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
      });

      afterAll(() => {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      });

      afterEach(() => {
        act(() => root?.unmount());
        container?.remove();
        root = undefined;
        container = undefined;
      });

      it("renders on the server with no progress and hydrates without a mismatch", async () => {
        const html = renderToString(tree());
        container = document.createElement("div");
        container.innerHTML = html;
        document.body.appendChild(container);

        const serverChecks = Array.from(container.querySelectorAll('[role="checkbox"]'));
        expect(serverChecks).toHaveLength(CHECKLIST_TOTAL);
        expect(serverChecks.map((check) => check.getAttribute("aria-checked"))).toEqual(
          Array(CHECKLIST_TOTAL).fill("false"),
        );
        expect(container.querySelector('[data-testid="cook-mode-panel"]')).toBeNull();

        const recoverableErrors: unknown[] = [];
        await act(async () => {
          root = hydrateRoot(container!, tree(), {
            onRecoverableError: (error) => {
              recoverableErrors.push(error);
            },
          });
        });

        expect(recoverableErrors).toEqual([]);
        expect(within(container).getByRole("heading", { level: 2, name: "Steps" })).toBeInTheDocument();
        await act(async () => controller().enterCookMode());
        expect(within(container).getByTestId("cook-mode-panel")).toBeInTheDocument();
        expect(recoverableErrors).toEqual([]);
      });
    });
  });
}
