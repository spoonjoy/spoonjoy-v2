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
    expect(placeholder).toHaveClass("sj-cover-placeholder", "sj-cover-placeholder-bleed");
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    expect(placeholder).toHaveTextContent(/^B$/);
    expect(placeholder.querySelector("svg")).toBeNull();
    expect(placeholder.className).not.toMatch(/photo-charcoal/);
    expect(placeholder.parentElement).toHaveClass("size-16");
    expect(placeholder.parentElement?.className).not.toMatch(/\bborder\b/);
  });
});
