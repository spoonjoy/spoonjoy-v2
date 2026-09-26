import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { Link } from "~/components/ui/link";
import { hasInAppHistory, useBackNavigation } from "~/hooks/use-back-navigation";

function RecipePage() {
  const handleBack = useBackNavigation();
  return (
    <Link href="/recipes" onClick={handleBack}>
      Recipes
    </Link>
  );
}

function renderFromHome() {
  const router = createMemoryRouter(
    [
      { path: "/", element: <h1>Home page</h1> },
      { path: "/recipes", element: <h1>All recipes page</h1> },
      { path: "/recipes/:id", element: <RecipePage /> },
    ],
    { initialEntries: ["/", "/recipes/recipe-1"], initialIndex: 1 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("hasInAppHistory", () => {
  afterEach(() => {
    window.history.replaceState(null, "");
  });

  it("is true when React Router's history index is past the first in-app entry", () => {
    window.history.replaceState({ idx: 2, key: "abc", usr: null }, "");
    expect(hasInAppHistory()).toBe(true);
  });

  it("is false on the first in-app entry (the page was opened directly)", () => {
    window.history.replaceState({ idx: 0, key: "default", usr: null }, "");
    expect(hasInAppHistory()).toBe(false);
  });

  it("is false when the history state is missing or not React Router's", () => {
    window.history.replaceState(null, "");
    expect(hasInAppHistory()).toBe(false);

    window.history.replaceState("not-an-object", "");
    expect(hasInAppHistory()).toBe(false);

    window.history.replaceState({ idx: "3" }, "");
    expect(hasInAppHistory()).toBe(false);
  });
});

describe("useBackNavigation", () => {
  afterEach(() => {
    window.history.replaceState(null, "");
  });

  it("goes back to the previous in-app page on a plain click when there is in-app history", async () => {
    window.history.replaceState({ idx: 1, key: "abc", usr: null }, "");
    const router = renderFromHome();

    const link = screen.getByRole("link", { name: "Recipes" });
    expect(link).toHaveAttribute("href", "/recipes");

    const notCancelled = fireEvent.click(link);

    expect(notCancelled).toBe(false);
    expect(await screen.findByRole("heading", { name: "Home page" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });

  it("follows the link to /recipes when the recipe was opened directly", async () => {
    window.history.replaceState({ idx: 0, key: "default", usr: null }, "");
    const router = renderFromHome();

    fireEvent.click(screen.getByRole("link", { name: "Recipes" }));

    expect(await screen.findByRole("heading", { name: "All recipes page" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/recipes");
  });

  it.each([
    ["ctrl", { ctrlKey: true }],
    ["meta", { metaKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
    ["middle button", { button: 1 }],
  ])("leaves a %s click to the browser so it can open the link elsewhere", (_name, init) => {
    window.history.replaceState({ idx: 1, key: "abc", usr: null }, "");
    const router = renderFromHome();

    const notCancelled = fireEvent.click(screen.getByRole("link", { name: "Recipes" }), init);

    expect(notCancelled).toBe(true);
    expect(router.state.location.pathname).toBe("/recipes/recipe-1");
  });

  it("does nothing when another handler already cancelled the click", () => {
    window.history.replaceState({ idx: 1, key: "abc", usr: null }, "");
    const router = renderFromHome();
    const link = screen.getByRole("link", { name: "Recipes" });

    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    event.preventDefault();
    link.dispatchEvent(event);

    expect(router.state.location.pathname).toBe("/recipes/recipe-1");
  });
});
