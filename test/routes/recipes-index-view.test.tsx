import { afterEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { Outlet } from "react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import RecipesIndex, { loader } from "~/routes/recipes._index";
import type { RecipeView } from "~/domains/kitchen";

const recipes = [
  {
    id: "r1",
    title: "Tomato Toast",
    description: "Crisp bread under sweet tomatoes.",
    servings: "2",
    chef: { id: "c1", username: "rowan" },
    coverImageUrl: "https://example.com/tomato.jpg",
    coverProvenanceLabel: null,
  },
  {
    id: "r2",
    title: "Lemon Rice",
    description: null,
    servings: null,
    chef: { id: "c2", username: "ines" },
    coverImageUrl: null,
    coverProvenanceLabel: null,
  },
];

function renderIndex({ flags, view }: { flags: string[]; view: RecipeView }) {
  const Stub = createTestRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ flags }),
      Component: Outlet,
      children: [
        {
          path: "recipes",
          Component: RecipesIndex,
          loader: () => ({ query: "", isAuthenticated: true, recipes, after: null, nextCursor: null, view }),
        },
      ],
    },
  ]);
  return render(<Stub initialEntries={["/recipes"]} />);
}

afterEach(() => {
  cleanup();
  document.cookie = "sj_recipe_view=; Path=/; Max-Age=0";
});

describe("the recipe list view", () => {
  it("reads the cook's view from the request", async () => {
    const result = await loader({
      request: new UndiciRequest("http://localhost/recipes", { headers: { Cookie: "sj_recipe_view=list" } }) as unknown as Request,
      context: { cloudflare: { env: null } },
      params: {},
    } as never);
    expect(result.view).toBe("list");
  });

  it("shows a compact list, one line per recipe, when the cook picks List, and keeps the pick", async () => {
    const { container } = renderIndex({ flags: [], view: "pictures" });
    const views = await screen.findByRole("radiogroup", { name: "Recipe view" });
    expect(within(views).getByRole("radio", { name: "Pictures" })).toBeChecked();
    expect(screen.getByText("Crisp bread under sweet tomatoes.")).toBeInTheDocument();

    fireEvent.click(within(views).getByRole("radio", { name: "List" }));

    expect(within(views).getByRole("radio", { name: "List" })).toBeChecked();
    expect(screen.getByRole("link", { name: /Tomato Toast/ })).toHaveAttribute("href", "/recipes/r1");
    expect(screen.getByRole("link", { name: /Lemon Rice/ })).toHaveAttribute("href", "/recipes/r2");
    expect(screen.getByText("By rowan • Serves 2")).toBeInTheDocument();
    expect(screen.getByText("By ines")).toBeInTheDocument();
    // Compact: no descriptions, and photos only as small thumbnails.
    expect(screen.queryByText("Crisp bread under sweet tomatoes.")).not.toBeInTheDocument();
    expect(container.querySelector('img[src="https://example.com/tomato.jpg"]')?.parentElement).toHaveClass("size-ouro-10");
    expect(document.cookie).toContain("sj_recipe_view=list");

    fireEvent.click(within(views).getByRole("radio", { name: "Pictures" }));
    expect(screen.getByText("Crisp bread under sweet tomatoes.")).toBeInTheDocument();
    expect(document.cookie).toContain("sj_recipe_view=pictures");
  });

  it("opens in the list the cook picked last time", async () => {
    renderIndex({ flags: [], view: "list" });
    expect(await screen.findByRole("radio", { name: "List" })).toBeChecked();
    expect(screen.getByText("By ines")).toBeInTheDocument();
    expect(screen.queryByText("Crisp bread under sweet tomatoes.")).not.toBeInTheDocument();
  });
});
