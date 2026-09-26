import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { Link } from "~/components/ui/link";
import {
  currentHistoryIndex,
  findBackDistance,
  HISTORY_TRAIL_KEY,
  useBackNavigation,
  useHistoryTrail,
  type HistoryTrailEntry,
} from "~/hooks/use-back-navigation";

function setHistoryIndex(idx: number | null) {
  window.history.replaceState(idx === null ? null : { idx, key: `k${idx}`, usr: null }, "");
}

function entry(url: string): HistoryTrailEntry {
  const [path, hash] = url.split("#");
  return { path, cook: hash === "cook" };
}

// Seeds the session record as the root recorder would have written it for these entries.
function seedTrail(urls: string[]) {
  const trail: Record<string, HistoryTrailEntry> = {};
  urls.forEach((url, idx) => {
    trail[String(idx)] = entry(url);
  });
  window.sessionStorage.setItem(HISTORY_TRAIL_KEY, JSON.stringify(trail));
}

function readTrail(): Record<string, HistoryTrailEntry> {
  return JSON.parse(window.sessionStorage.getItem(HISTORY_TRAIL_KEY) ?? "{}");
}

function RecipePage() {
  const handleBack = useBackNavigation();
  return (
    <>
      <h1>Recipe page</h1>
      <Link href="/recipes" onClick={handleBack}>
        Recipes
      </Link>
    </>
  );
}

const pageRoutes = [
  { path: "/", element: <h1>Home page</h1> },
  { path: "/chefs", element: <h1>Chefs page</h1> },
  { path: "/recipes", element: <h1>All recipes page</h1> },
  { path: "/recipes/new", element: <h1>Create page</h1> },
  { path: "/recipes/:id/edit", element: <h1>Edit page</h1> },
  { path: "/recipes/:id/steps/:stepId/edit", element: <h1>Step edit page</h1> },
  { path: "/recipes/:id", element: <RecipePage /> },
];

// Renders the in-memory history `urls`, standing on the last one, with the browser's history
// index and the session record matching it (as they would in the real app).
function renderHistory(urls: string[], { seed = true }: { seed?: boolean } = {}) {
  if (seed) seedTrail(urls);
  setHistoryIndex(urls.length - 1);
  const router = createMemoryRouter(pageRoutes, { initialEntries: urls, initialIndex: urls.length - 1 });
  render(<RouterProvider router={router} />);
  return router;
}

// A plain primary click, as the handler sees it, for calling the handler directly.
function plainClick(overrides: { defaultPrevented?: boolean } = {}) {
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  };
}

function clickRecipes(init?: MouseEventInit) {
  return fireEvent.click(screen.getByRole("link", { name: "Recipes" }), init);
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  setHistoryIndex(null);
});

describe("currentHistoryIndex", () => {
  it("reads React Router's history index", () => {
    setHistoryIndex(2);
    expect(currentHistoryIndex()).toBe(2);
  });

  it("is null when the history state is missing or not React Router's", () => {
    setHistoryIndex(null);
    expect(currentHistoryIndex()).toBeNull();

    window.history.replaceState("not-an-object", "");
    expect(currentHistoryIndex()).toBeNull();

    window.history.replaceState({ idx: "3" }, "");
    expect(currentHistoryIndex()).toBeNull();

    window.history.replaceState({ idx: -1 }, "");
    expect(currentHistoryIndex()).toBeNull();

    window.history.replaceState({ idx: 1.5 }, "");
    expect(currentHistoryIndex()).toBeNull();
  });
});

describe("useHistoryTrail", () => {
  function Recorder() {
    useHistoryTrail();
    return null;
  }

  function renderRecorder(url: string) {
    const router = createMemoryRouter([{ path: "*", element: <Recorder /> }], { initialEntries: [url] });
    render(<RouterProvider router={router} />);
    return router;
  }

  it("records the path and whether it is cook mode at the current history index", () => {
    setHistoryIndex(2);
    renderRecorder("/recipes/r1#cook");

    expect(readTrail()).toEqual({ "2": { path: "/recipes/r1", cook: true } });
  });

  it("keeps earlier entries and, on a push, drops the forward entries the browser discarded", async () => {
    seedTrail(["/", "/recipes/r1", "/recipes/r1/edit", "/recipes/r1"]);
    setHistoryIndex(1);
    const router = renderRecorder("/recipes/r1");
    expect(Object.keys(readTrail())).toEqual(["0", "1", "2", "3"]);

    setHistoryIndex(2);
    await act(async () => {
      await router.navigate("/chefs");
    });

    expect(readTrail()).toEqual({
      "0": { path: "/", cook: false },
      "1": { path: "/recipes/r1", cook: false },
      "2": { path: "/chefs", cook: false },
    });
  });

  it("drops entries far behind the current one", () => {
    window.sessionStorage.setItem(HISTORY_TRAIL_KEY, JSON.stringify({ "0": entry("/"), "150": entry("/chefs") }));
    setHistoryIndex(151);
    renderRecorder("/recipes/r1");

    expect(readTrail()).toEqual({ "150": entry("/chefs"), "151": entry("/recipes/r1") });
  });

  it("records nothing when the entry has no history index", () => {
    setHistoryIndex(null);
    renderRecorder("/recipes/r1");

    expect(window.sessionStorage.getItem(HISTORY_TRAIL_KEY)).toBeNull();
  });

  it("starts a fresh record when the stored one is unreadable", () => {
    setHistoryIndex(0);
    window.sessionStorage.setItem(HISTORY_TRAIL_KEY, "{not json");
    renderRecorder("/");
    expect(readTrail()).toEqual({ "0": entry("/") });

    window.sessionStorage.setItem(HISTORY_TRAIL_KEY, JSON.stringify(["/"]));
    setHistoryIndex(1);
    renderRecorder("/chefs");
    expect(readTrail()).toEqual({ "1": entry("/chefs") });
  });

  it("does not throw when storage is unavailable", () => {
    setHistoryIndex(0);
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    expect(() => renderRecorder("/")).not.toThrow();
  });
});

describe("findBackDistance", () => {
  it("gives up at an unreadable entry rather than skipping it", () => {
    window.sessionStorage.setItem(
      HISTORY_TRAIL_KEY,
      JSON.stringify({ "0": entry("/"), "1": { path: "/chefs" }, "2": entry("/recipes/r1") }),
    );
    setHistoryIndex(2);

    expect(findBackDistance("/recipes/r1")).toBeNull();
  });

  it("is null without a history index", () => {
    setHistoryIndex(null);
    expect(findBackDistance("/recipes/r1")).toBeNull();
  });
});

describe("useBackNavigation", () => {
  it("goes back to the previous in-app page", async () => {
    const router = renderHistory(["/", "/recipes/r1"]);

    const link = screen.getByRole("link", { name: "Recipes" });
    expect(link).toHaveAttribute("href", "/recipes");
    expect(clickRecipes()).toBe(false);

    expect(await screen.findByRole("heading", { name: "Home page" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });

  it("skips the edit form after an edit (recipe -> edit -> recipe)", async () => {
    const router = renderHistory(["/chefs", "/recipes/r1", "/recipes/r1/edit", "/recipes/r1"]);

    clickRecipes();

    expect(await screen.findByRole("heading", { name: "Chefs page" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/chefs");
  });

  it("skips step editors under the recipe", async () => {
    const router = renderHistory(["/", "/recipes/r1", "/recipes/r1/steps/s1/edit", "/recipes/r1"]);

    clickRecipes();

    expect(await screen.findByRole("heading", { name: "Home page" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });

  it("skips the create form after creating a recipe (new -> recipe)", async () => {
    const router = renderHistory(["/", "/recipes/new", "/recipes/r1"]);

    clickRecipes();

    expect(await screen.findByRole("heading", { name: "Home page" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });

  it("skips the cook-mode entry (home -> recipe -> #cook -> recipe)", async () => {
    const router = renderHistory(["/", "/recipes/r1", "/recipes/r1#cook", "/recipes/r1"]);

    clickRecipes();

    expect(await screen.findByRole("heading", { name: "Home page" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });

  it("does not skip a different recipe", async () => {
    const router = renderHistory(["/", "/recipes/r2", "/recipes/r1"]);

    clickRecipes();

    expect(await screen.findByRole("heading", { name: "Recipe page" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/recipes/r2");
  });

  it("follows the href when the recipe was opened directly", async () => {
    const router = renderHistory(["/recipes/r1"]);

    clickRecipes();

    expect(await screen.findByRole("heading", { name: "All recipes page" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/recipes");
  });

  it("follows the href when only this recipe and its forms are behind it", async () => {
    const router = renderHistory(["/recipes/r1", "/recipes/r1/edit", "/recipes/r1"]);

    clickRecipes();

    expect(await screen.findByRole("heading", { name: "All recipes page" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/recipes");
  });

  it("follows the href when the earlier history is unknown", async () => {
    const router = renderHistory(["/", "/recipes/r1"], { seed: false });

    clickRecipes();

    expect(await screen.findByRole("heading", { name: "All recipes page" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/recipes");
  });

  it("follows the href when storage is unavailable", async () => {
    const router = renderHistory(["/", "/recipes/r1"]);
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    clickRecipes();

    expect(await screen.findByRole("heading", { name: "All recipes page" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/recipes");
  });

  it.each([
    ["ctrl", { ctrlKey: true }],
    ["meta", { metaKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
    ["middle button", { button: 1 }],
  ])("leaves a %s click to the browser so it can open the link elsewhere", async (_name, init) => {
    const router = renderHistory(["/", "/recipes/r1"]);

    expect(clickRecipes(init)).toBe(true);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(router.state.location.pathname).toBe("/recipes/r1");
    expect(screen.getByRole("heading", { name: "Recipe page" })).toBeInTheDocument();
  });

  it("does nothing when another handler already cancelled the click", async () => {
    // Call the handler directly: the Catalyst Link's Headless UI wrapper already skips handlers
    // for a cancelled event, which would hide a missing check here.
    let handleBack: ((event: React.MouseEvent<HTMLElement>) => void) | undefined;
    function Capture() {
      handleBack = useBackNavigation();
      return <h1>Recipe page</h1>;
    }
    seedTrail(["/", "/recipes/r1"]);
    setHistoryIndex(1);
    const router = createMemoryRouter(
      [
        { path: "/", element: <h1>Home page</h1> },
        { path: "/recipes/:id", element: <Capture /> },
      ],
      { initialEntries: ["/", "/recipes/r1"], initialIndex: 1 },
    );
    render(<RouterProvider router={router} />);

    const event = plainClick({ defaultPrevented: true });
    act(() => {
      handleBack?.(event as unknown as React.MouseEvent<HTMLElement>);
    });

    // Give any navigation time to settle before asserting nothing happened.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/recipes/r1");
    expect(screen.getByRole("heading", { name: "Recipe page" })).toBeInTheDocument();
  });

  it("reads the current page at click time, not when the handler was created", async () => {
    let captured: ((event: React.MouseEvent<HTMLElement>) => void) | undefined;
    function Capture() {
      const handler = useBackNavigation();
      captured ??= handler;
      return <h1>Recipe page</h1>;
    }
    seedTrail(["/", "/recipes/r1", "/recipes/r2"]);
    setHistoryIndex(1);
    const router = createMemoryRouter(
      [
        { path: "/", element: <h1>Home page</h1> },
        { path: "/recipes/:id", element: <Capture /> },
      ],
      { initialEntries: ["/", "/recipes/r1"], initialIndex: 1 },
    );
    render(<RouterProvider router={router} />);
    const firstHandler = captured;

    await act(async () => {
      await router.navigate("/recipes/r2");
    });
    setHistoryIndex(2);

    const event = plainClick();
    act(() => {
      firstHandler?.(event as unknown as React.MouseEvent<HTMLElement>);
    });

    // Standing on r2, r1 is a different recipe, so Back lands on it (one entry back).
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", { name: "Recipe page" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/recipes/r1");
  });
});
