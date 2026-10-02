import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { RecipesSectionNav } from "~/components/navigation";

describe("RecipesSectionNav", () => {
  it.each([
    ["/my-recipes", "Mine"],
    ["/saved-recipes", "Saved"],
    ["/recipes", "Everyone"],
  ])("links the three recipe lists and marks %s current", (path, current) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <RecipesSectionNav />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "Recipe lists" });
    expect(nav).toHaveClass("lg:hidden");
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Mine", "/my-recipes"],
      ["Saved", "/saved-recipes"],
      ["Everyone", "/recipes"],
    ]);
    expect(links.filter((link) => link.getAttribute("aria-current") === "page").map((link) => link.textContent)).toEqual([current]);
  });
});
