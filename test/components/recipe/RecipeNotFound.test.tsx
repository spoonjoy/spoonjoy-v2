import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { RecipeNotFound } from "~/components/recipe/RecipeNotFound";

function renderNotFound(props: { deleted: boolean }) {
  const router = createMemoryRouter([{ path: "/", element: <RecipeNotFound {...props} /> }]);
  render(<RouterProvider router={router} />);
}

describe("RecipeNotFound", () => {
  it("says a deleted recipe was deleted, without naming its chef, and offers search and the recipe box", () => {
    renderNotFound({ deleted: true });
    expect(screen.getByRole("heading", { level: 1, name: "This recipe was deleted." })).toBeInTheDocument();
    expect(screen.getByText("Its chef deleted it, so the link no longer opens. Search for something like it, or browse every public recipe.")).toBeInTheDocument();
    expect(screen.getByRole("search")).toHaveAttribute("action", "/search");
    expect(screen.queryByRole("link", { name: /kitchen/ })).toBeNull();
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/recipes"]);
  });

  it("offers a recipe search and the recipe box for a link that never worked", () => {
    renderNotFound({ deleted: false });
    expect(screen.getByRole("heading", { level: 1, name: "We can't find this recipe." })).toBeInTheDocument();
    const search = screen.getByRole("search");
    expect(search).toHaveAttribute("action", "/search");
    expect(search).toHaveAttribute("method", "get");
    expect(within(search).getByRole("searchbox", { name: "Search recipes" })).toHaveAttribute("name", "q");
    expect(search.querySelector('input[type="hidden"][name="scope"]')).toHaveValue("recipes");
    expect(within(search).getByRole("button", { name: "Search" })).toHaveAttribute("type", "submit");
    expect(screen.getByRole("link", { name: "Browse recipes" })).toHaveAttribute("href", "/recipes");
  });

  it("stretches the Search button to the field's height when they share a row", () => {
    // Centered, the button kept its own 44px height beside the 56px field.
    renderNotFound({ deleted: false });
    const search = screen.getByRole("search");
    expect(search).toHaveClass("sm:items-stretch");
    expect(search).not.toHaveClass("sm:items-center");
  });
});
