import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_KITCHEN } from "~/lib/test-kitchen/content";
import { TEST_KITCHEN_STORAGE_KEY, readTestKitchen } from "~/lib/test-kitchen/storage";
import TestKitchen, { meta } from "~/routes/test-kitchen";

const RECIPE_ID = TEST_KITCHEN.recipe.id;
const firstStepIngredients = TEST_KITCHEN.recipe.ingredientsByStep.get(TEST_KITCHEN.recipe.steps[0]!.id)!;

function page(path = "/test-kitchen") {
  return (
    <MemoryRouter initialEntries={[path]}>
      <TestKitchen />
    </MemoryRouter>
  );
}

function saveProgress(checkedIngredientIds: string[]) {
  window.localStorage.setItem(TEST_KITCHEN_STORAGE_KEY, JSON.stringify({
    version: 1,
    recipes: { [RECIPE_ID]: { checkedIngredientIds, checkedStepOutputIds: [], activeStepIndex: 0, scaleFactor: 1 } },
  }));
}

describe("Test Kitchen", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    cleanup();
    fetchSpy.mockRestore();
    window.localStorage.clear();
  });

  it("titles the page and describes it for search and sharing", () => {
    const tags = meta({} as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ title: "Test Kitchen | Spoonjoy" });
    expect(tags.find((tag) => "name" in tag && tag.name === "description")).toBeTruthy();
  });

  it("opens to anyone: the recipe, what to try, and a way to sign up, with no request of its own", async () => {
    render(page());

    expect(screen.getByRole("heading", { level: 1, name: "Spoonjoy Test Kitchen" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: TEST_KITCHEN.recipe.title })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "What to try" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Make it yours: sign up" })).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("img", { name: TEST_KITCHEN.cover.alt })).toHaveAttribute("src", TEST_KITCHEN.cover.src);
    for (const ingredient of firstStepIngredients) {
      expect(screen.getByRole("checkbox", { name: ingredient.name })).toHaveAttribute("data-ouro-control", "checklist");
    }
    await waitFor(() => expect(readTestKitchen().recipes[RECIPE_ID]).toBeTruthy());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps a visitor's ticks in this browser", async () => {
    const user = userEvent.setup();
    render(page());

    const first = firstStepIngredients[0]!;
    await user.click(screen.getByRole("checkbox", { name: first.name }));

    await waitFor(() => expect(readTestKitchen().recipes[RECIPE_ID]?.checkedIngredientIds).toEqual([first.id]));
  });

  it("renders on the server with no progress, hydrates without a mismatch, then restores saved progress", async () => {
    const first = firstStepIngredients[0]!;
    saveProgress([first.id]);
    const container = document.createElement("div");
    container.innerHTML = renderToString(page());
    document.body.append(container);
    expect(within(container).getByRole("checkbox", { name: first.name })).toHaveAttribute("aria-checked", "false");

    const recoverable = vi.fn();
    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(container, page(), { onRecoverableError: recoverable });
    });

    await waitFor(() => expect(within(container).getByRole("checkbox", { name: first.name })).toHaveAttribute("aria-checked", "true"));
    expect(recoverable).not.toHaveBeenCalled();
    await act(async () => root!.unmount());
    container.remove();
  });

  it("scales every amount from the scale, and says what it now serves", async () => {
    const user = userEvent.setup();
    render(page());

    const scale = screen.getAllByRole("textbox", { name: "Scale" })[0]!;
    expect(scale).toHaveAccessibleDescription(TEST_KITCHEN.servings);
    await user.click(screen.getAllByRole("button", { name: "Increase scale" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Increase scale" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Increase scale" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Increase scale" })[0]!);

    expect(scale).toHaveValue("2");
    expect(scale).toHaveAccessibleDescription("Serves 4");
    expect(screen.getByRole("checkbox", { name: "cooked chickpeas" })).toHaveAccessibleDescription(/3 cups$/);
  });

  it("opens cook mode as the whole page, and comes back", async () => {
    const user = userEvent.setup();
    render(page());

    await user.click(screen.getByRole("button", { name: "Start cooking" }));
    const cookMode = await screen.findByTestId("cook-mode-panel");
    expect(within(cookMode).getByRole("heading", { level: 2, name: "Roast the chickpeas" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Spoonjoy Test Kitchen" })).not.toBeInTheDocument();

    await user.click(within(cookMode).getByRole("button", { name: "Exit cook mode" }));
    expect(await screen.findByRole("heading", { name: "Spoonjoy Test Kitchen" })).toBeInTheDocument();
  });

  it("turns X-ray on and off from its switch", async () => {
    const user = userEvent.setup();
    render(page());

    const xray = screen.getByRole("switch", { name: "X-ray" });
    expect(xray).not.toBeChecked();
    expect(screen.queryByRole("group", { name: "X-ray" })).not.toBeInTheDocument();

    await user.click(xray);
    expect(await screen.findByRole("group", { name: "X-ray" })).toBeInTheDocument();
    expect(xray).toBeChecked();

    await user.click(within(screen.getByRole("group", { name: "X-ray" })).getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "X-ray" })).not.toBeInTheDocument());
    expect(xray).not.toBeChecked();
  });

  it("opens X-ray on arrival with ?xray", async () => {
    render(page("/test-kitchen?xray"));

    expect(await screen.findByRole("group", { name: "X-ray" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "X-ray" })).toBeChecked();
  });

  it("resets the kitchen: every tick, the scale and the saved progress", async () => {
    const user = userEvent.setup();
    const first = firstStepIngredients[0]!;
    saveProgress([first.id]);
    render(page());

    await waitFor(() => expect(screen.getByRole("checkbox", { name: first.name })).toHaveAttribute("aria-checked", "true"));
    await user.click(screen.getByRole("button", { name: "Reset the kitchen" }));

    await waitFor(() => expect(screen.getByRole("checkbox", { name: first.name })).toHaveAttribute("aria-checked", "false"));
    expect(readTestKitchen().recipes[RECIPE_ID]?.checkedIngredientIds).toEqual([]);
  });
});
