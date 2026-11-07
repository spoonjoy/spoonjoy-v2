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
});
