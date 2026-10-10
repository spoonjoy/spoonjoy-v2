import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RecipeBuilder, type RecipeBuilderData } from "~/components/recipe/RecipeBuilder";
import { createTestRoutesStub } from "../../utils";

// The recipe title, description and servings are server-rendered on /recipes/new and
// /recipes/:id/edit. On a slow phone people type before the client bundle hydrates the page.
// These tests render the server markup, type into it, hydrate, move focus (which re-renders the
// Headless UI fields) and then save, checking the typed text survives and is what gets saved.

const onSave = vi.fn<(data: RecipeBuilderData) => void>();

const EXISTING_RECIPE: RecipeBuilderData = {
  id: "recipe-1",
  title: "Old title",
  description: "Old description",
  servings: "2",
  coverImageUrl: "",
  steps: [],
};

function builderTree(recipe?: RecipeBuilderData) {
  const Stub = createTestRoutesStub([
    {
      id: "builder",
      path: "/builder",
      Component: () => <RecipeBuilder recipe={recipe} onSave={onSave} showSteps={false} />,
    },
  ]);
  return <Stub initialEntries={["/builder"]} hydrationData={{ loaderData: {} }} />;
}

describe("RecipeBuilder hydration", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    // hydrateRoot is driven with React's act() directly, outside Testing Library.
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    // Browsers reflect the `autofocus` attribute on <button>; happy-dom does not, which makes
    // React report a false hydration mismatch on a button's autoFocus={false}. Mirror the
    // browser behaviour.
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

  beforeEach(() => {
    onSave.mockReset();
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  function fields(host: HTMLElement) {
    return {
      title: host.querySelector<HTMLInputElement>('input[placeholder="e.g., Chocolate Chip Cookies"]')!,
      description: host.querySelector<HTMLTextAreaElement>('textarea[placeholder="Recipe description"]')!,
      servings: host.querySelector<HTMLInputElement>('input[placeholder="e.g., 4 servings"]')!,
    };
  }

  function saveButton(host: HTMLElement, name: string) {
    return Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === name)!;
  }

  async function hydrateAfterTyping(recipe: RecipeBuilderData | undefined, typed: { title: string; description: string; servings: string }) {
    // Server-rendered markup, as the browser shows it before the JS loads.
    container = document.createElement("div");
    container.innerHTML = renderToString(builderTree(recipe));
    document.body.appendChild(container);

    const serverFields = fields(container);
    // The person types while the client bundle is still loading.
    serverFields.title.value = typed.title;
    serverFields.description.value = typed.description;
    serverFields.servings.value = typed.servings;

    await act(async () => {
      root = hydrateRoot(container!, builderTree(recipe));
    });

    // React adopted the server fields rather than replacing them.
    expect(fields(container).title).toBe(serverFields.title);

    // Moving focus re-renders each Headless UI field. A controlled field would have its DOM
    // value written back to React state here.
    await act(async () => serverFields.title.focus());
    await act(async () => serverFields.description.focus());
    await act(async () => serverFields.servings.focus());
    await act(async () => serverFields.title.focus());

    return serverFields;
  }

  it("keeps a new recipe's title, description and servings typed before hydration and saves them", async () => {
    const typed = { title: "Typed before hydration", description: "Typed story", servings: "6" };
    const serverFields = await hydrateAfterTyping(undefined, typed);

    expect(serverFields.title.value).toBe(typed.title);
    expect(serverFields.description.value).toBe(typed.description);
    expect(serverFields.servings.value).toBe(typed.servings);

    const create = saveButton(container!, "Create recipe");
    // The title counts as filled in, so Create is not dimmed.
    expect(create).not.toHaveAttribute("aria-disabled");
    await act(async () => create.click());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining(typed));
  });

  it("keeps an edited title and servings typed before hydration and saves them", async () => {
    // Only the <input> fields: React's hydrateTextarea itself resets a textarea whose server
    // default is non-empty to that default, before any app code runs, so a description edited
    // before hydration on /edit is outside what the component can keep.
    const typed = { title: "New title", description: "Old description", servings: "8" };
    const serverFields = await hydrateAfterTyping(EXISTING_RECIPE, typed);

    expect(serverFields.title.value).toBe(typed.title);
    expect(serverFields.servings.value).toBe(typed.servings);

    await act(async () => saveButton(container!, "Save recipe").click());

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "recipe-1", ...typed }));
  });
});
