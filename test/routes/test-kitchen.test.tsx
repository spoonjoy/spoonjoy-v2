import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_KITCHEN } from "~/lib/test-kitchen/content";
import { TEST_KITCHEN_STORAGE_KEY, readTestKitchen } from "~/lib/test-kitchen/storage";
import { SiteFooter } from "~/components/navigation/site-footer";
import { XrayProvider } from "~/components/xray/xray-provider";
import TestKitchen, { meta } from "~/routes/test-kitchen";

const RECIPE_ID = TEST_KITCHEN.recipe.id;
const firstStepIngredients = TEST_KITCHEN.recipe.ingredientsByStep.get(TEST_KITCHEN.recipe.steps[0]!.id)!;

const SHA = "0123456789abcdef0123456789abcdef01234567";

/** The page inside the site's X-ray and footer, as app/root.tsx renders it. */
function page(path = "/test-kitchen") {
  return (
    <MemoryRouter initialEntries={[path]}>
      <XrayProvider sourceSha={SHA}>
        <TestKitchen />
        <SiteFooter />
      </XrayProvider>
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
    // X-ray reads /ouro-provenance.json when it opens; there is no server here.
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 404 }));
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
    // It promises what this test shows: no account, and progress kept in this browser, saved by no
    // request of the page's own. Analytics may still record the visit, so it doesn't promise that
    // nothing leaves the browser.
    expect(screen.getByText(/^A real Spoonjoy recipe page, open to everyone\. Nothing here needs an account, and your progress stays in this browser\.$/)).toBeInTheDocument();
    expect(screen.queryByText(/nothing you do leaves this browser/i)).not.toBeInTheDocument();
    // HX's PageHeader heads the page: its title, eyebrow, description and the sign-up action.
    const header = screen.getByRole("heading", { level: 1, name: "Spoonjoy Test Kitchen" }).closest('[data-ouro="page-header"]');
    expect(header).not.toBeNull();
    expect(header).toHaveTextContent("Try Spoonjoy");
    expect(within(header as HTMLElement).getByRole("link", { name: "Make it yours: sign up" })).toBeInTheDocument();
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

  it("keeps the scale when the field is cleared", async () => {
    const user = userEvent.setup();
    render(page());

    const scale = screen.getAllByRole("textbox", { name: "Scale" })[0]!;
    await user.clear(scale);
    await user.tab();

    expect(scale).toHaveAccessibleDescription(TEST_KITCHEN.servings);
    expect(screen.getByRole("checkbox", { name: "cooked chickpeas" })).toHaveAccessibleDescription(/1 ½ cups$/);
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

  it("keeps a started timer running and sounding after leaving cook mode", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    try {
      render(page());
      fireEvent.click(screen.getByRole("button", { name: "Start cooking" }));
      fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
      fireEvent.click(screen.getByRole("button", { name: "Exit cook mode" }));
      expect(screen.getByRole("heading", { name: "Spoonjoy Test Kitchen" })).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(720_000);
      });
      expect(vibrate).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("region", { name: "Running timers" })).toHaveTextContent("Time's up");
    } finally {
      cleanup();
      vi.useRealTimers();
      Reflect.deleteProperty(navigator, "vibrate");
    }
  });

  it("resets a paused timer with the rest of the kitchen", () => {
    render(page());
    fireEvent.click(screen.getByRole("button", { name: "Start cooking" }));
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause timer" }));
    fireEvent.click(screen.getByRole("button", { name: "Exit cook mode" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset the kitchen" }));
    fireEvent.click(screen.getByRole("button", { name: "Start cooking" }));

    const timer = screen.getByTestId("cook-mode-timer");
    expect(within(timer).queryByRole("button", { name: "Resume timer" })).not.toBeInTheDocument();
    expect(within(timer).getByRole("button", { name: "Start timer" })).toBeInTheDocument();
  });

  it("warns when the browser cannot persist a timer reset", () => {
    render(page());
    fireEvent.click(screen.getByRole("button", { name: "Start cooking" }));
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause timer" }));
    fireEvent.click(screen.getByRole("button", { name: "Exit cook mode" }));
    const remove = window.localStorage.removeItem;
    const blocked = vi.spyOn(window.localStorage, "removeItem").mockImplementation(function (this: Storage, key) {
      if (key.startsWith("ouro-timer:")) throw new DOMException("Blocked", "SecurityError");
      remove.call(this, key);
    });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Reset the kitchen" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Some timer resets could not be saved. They may return after a reload.");
      fireEvent.click(screen.getByRole("button", { name: "Start cooking" }));
      expect(within(screen.getByTestId("cook-mode-timer")).getByRole("button", { name: "Start timer" })).toBeInTheDocument();
    } finally {
      blocked.mockRestore();
    }
  });

  it("turns X-ray on and off from its switch", async () => {
    const user = userEvent.setup();
    render(page());

    const xray = screen.getByRole("switch", { name: "X-ray" });
    expect(xray).not.toBeChecked();
    expect(screen.queryByRole("region", { name: "X-ray" })).not.toBeInTheDocument();

    await user.click(xray);
    expect(await screen.findByRole("region", { name: "X-ray" })).toBeInTheDocument();
    expect(xray).toBeChecked();

    await user.click(within(screen.getByRole("region", { name: "X-ray" })).getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "X-ray" })).not.toBeInTheDocument());
    expect(xray).not.toBeChecked();
  });

  it("shares the site's one X-ray: the footer's \"See all the components\" turns its switch on", async () => {
    const user = userEvent.setup();
    render(page());

    await user.click(screen.getByRole("button", { name: "See all the components" }));
    expect(await screen.findByRole("region", { name: "X-ray" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "X-ray" })).toBeChecked();
    expect(screen.getAllByRole("region", { name: "X-ray" })).toHaveLength(1);
  });

  it("opens X-ray on arrival with ?xray", async () => {
    render(page("/test-kitchen?xray"));

    expect(await screen.findByRole("region", { name: "X-ray" })).toBeInTheDocument();
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
