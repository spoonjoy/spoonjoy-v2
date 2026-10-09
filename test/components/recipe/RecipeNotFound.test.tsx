import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { RecipeNotFound } from "~/components/recipe/RecipeNotFound";

function renderNotFound(props: { deleted: boolean; chefUsername: string | null }) {
  const router = createMemoryRouter([{ path: "/", element: <RecipeNotFound {...props} /> }]);
  render(<RouterProvider router={router} />);
}

describe("RecipeNotFound", () => {
  it("says a deleted recipe was deleted and offers its chef's kitchen first", () => {
    renderNotFound({ deleted: true, chefUsername: "ari" });
    expect(screen.getByRole("heading", { level: 1, name: "This recipe was deleted." })).toBeInTheDocument();
    expect(screen.getByText(/ari deleted it, so the link no longer opens/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See ari's kitchen" })).toHaveAttribute("href", "/users/ari");
    expect(screen.getByRole("link", { name: "Browse recipes" })).toHaveAttribute("href", "/recipes");
  });

  it("still explains a deletion when the chef is unknown", () => {
    renderNotFound({ deleted: true, chefUsername: null });
    expect(screen.getByText("Its chef deleted it, so the link no longer opens.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /kitchen/ })).toBeNull();
  });

  it("offers a recipe search and the recipe box for a link that never worked", () => {
    renderNotFound({ deleted: false, chefUsername: null });
    expect(screen.getByRole("heading", { level: 1, name: "We can't find this recipe." })).toBeInTheDocument();
    const search = screen.getByRole("search");
    expect(search).toHaveAttribute("action", "/search");
    expect(search).toHaveAttribute("method", "get");
    expect(within(search).getByRole("searchbox", { name: "Search recipes" })).toHaveAttribute("name", "q");
    expect(search.querySelector('input[type="hidden"][name="scope"]')).toHaveValue("recipes");
    expect(within(search).getByRole("button", { name: "Search" })).toHaveAttribute("type", "submit");
    expect(screen.getByRole("link", { name: "Browse recipes" })).toHaveAttribute("href", "/recipes");
  });
});
