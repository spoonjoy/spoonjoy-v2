import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import NewStep from "~/routes/recipes.$id.steps.new";
import { createTestRoutesStub } from "../utils";

// The AI ingredient box on "Add Step" is server-rendered. On a slow phone people type into it
// before the client bundle hydrates the page; the text has to survive hydration and still be
// parsed.

const LOADER_DATA = {
  recipe: { id: "recipe-1", title: "Test Recipe" },
  nextStepNum: 1,
  availableSteps: [],
};
const TYPED = "2 cups flour";

let parseRequests: string[] = [];

function newStepTree() {
  const Stub = createTestRoutesStub([
    {
      id: "new-step",
      path: "/recipes/:id/steps/new",
      Component: NewStep,
      loader: () => LOADER_DATA,
      action: async ({ request }) => {
        const formData = await request.formData();
        parseRequests.push(String(formData.get("ingredientText")));
        return { parsedIngredients: [{ quantity: 2, unit: "cup", ingredientName: "flour" }] };
      },
    },
  ]);
  return (
    <Stub
      initialEntries={["/recipes/recipe-1/steps/new"]}
      hydrationData={{ loaderData: { "new-step": LOADER_DATA } }}
    />
  );
}

describe("Add Step hydration", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    // hydrateRoot is driven with React's act() directly, outside Testing Library.
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    // Browsers reflect the `autofocus` attribute on <button>; happy-dom does not, which makes
    // React report a false hydration mismatch on a button's autoFocus={false}.
    Object.defineProperty(HTMLButtonElement.prototype, "autofocus", {
      configurable: true,
      get(this: HTMLButtonElement) {
        return this.hasAttribute("autofocus");
      },
    });
  });

  afterAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    Reflect.deleteProperty(HTMLButtonElement.prototype, "autofocus");
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    parseRequests = [];
  });

  it("keeps ingredient text typed before hydration and parses it", async () => {
    // Server-rendered markup, as the browser shows it before the JS loads.
    container = document.createElement("div");
    container.innerHTML = renderToString(newStepTree());
    document.body.appendChild(container);

    const ingredientBox = container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="Enter ingredients"]')!;
    const description = container.querySelector<HTMLTextAreaElement>('textarea[name="description"]')!;
    expect(ingredientBox.value).toBe("");

    // The person types while the client bundle is still loading.
    ingredientBox.value = TYPED;

    await act(async () => {
      root = hydrateRoot(container!, newStepTree());
    });

    // React adopted the server field rather than replacing it.
    expect(container.querySelector('textarea[placeholder^="Enter ingredients"]')).toBe(ingredientBox);

    // Moving focus re-renders the Headless UI field. A controlled field would have its DOM
    // value written back to React state ("") here.
    await act(async () => ingredientBox.focus());
    await act(async () => description.focus());
    expect(ingredientBox.value).toBe(TYPED);

    // The typed text is parsed once the debounce passes.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1300));
    });
    expect(parseRequests).toEqual([TYPED]);
    expect(container.textContent).toContain("Ingredients (1)");
    expect(ingredientBox.value).toBe(TYPED);
  });
});
