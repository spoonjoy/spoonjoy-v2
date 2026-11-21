import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { KitchenHome } from "~/components/cookbook/KitchenHome";

describe("KitchenHome recipe descriptions", () => {
  it("keeps servings visible when a recipe has no written description", () => {
    render(
      <MemoryRouter>
        <KitchenHome
          kitchenUser={{ id: "chef-1", username: "alice", photoUrl: null }}
          isOwner={false}
          recipes={[{
            id: "broth",
            title: "Broth",
            description: null,
            servings: "3",
            coverImageUrl: null,
            coverProvenanceLabel: null,
          }]}
          cookbooks={[]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Broth", exact: true })).toHaveAttribute("href", "/recipes/broth");
    expect(screen.getByText("Serves 3")).toBeInTheDocument();
  });

  it("shows native's initial tile, not a chef-hat icon, for a recipe with no cover", () => {
    render(
      <MemoryRouter>
        <KitchenHome
          kitchenUser={{ id: "chef-1", username: "alice", photoUrl: null }}
          isOwner={false}
          recipes={[{ id: "broth", title: "broth", description: null, servings: null, coverImageUrl: null, coverProvenanceLabel: null }]}
          cookbooks={[]}
        />
      </MemoryRouter>,
    );
    const placeholder = screen.getByTestId("kitchen-recipe-cover-placeholder-broth");
    // Ouro UI's Cover, square so the row's media slot rounds it, and decoration beside the title.
    expect(placeholder).toHaveAttribute("data-ouro", "cover");
    expect(placeholder).toHaveAttribute("data-shape", "square");
    expect(placeholder).not.toHaveAttribute("role");
    expect(placeholder).toHaveTextContent(/^B$/);
    expect(placeholder.querySelector("svg")).toBeNull();
    expect(placeholder.className).not.toMatch(/photo-charcoal/);
    // The tile is the media of broth's row; test/ouro/ouro-parts-in-spoonjoy-theme.test.tsx measures it at 64px.
    expect(placeholder.closest('[data-ouro="item"]')?.querySelector('a[href="/recipes/broth"]')).not.toBeNull();
    expect(placeholder.parentElement?.className).not.toMatch(/\bborder\b/);
  });
});
