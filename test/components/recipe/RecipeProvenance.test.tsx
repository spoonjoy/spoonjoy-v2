import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrowserRouter } from "react-router";
import { RecipeProvenance } from "../../../app/components/recipe/RecipeProvenance";

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

describe("RecipeProvenance", () => {
  it("renders 'originally from <hostname>' linking to the full URL when sourceUrl is set", () => {
    renderWithRouter(
      <RecipeProvenance sourceUrl="https://example.com/path/to/recipe" />,
    );
    expect(screen.getByText(/originally from/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /example\.com/i });
    expect(link).toHaveAttribute("href", "https://example.com/path/to/recipe");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("uses only the hostname (no path) inside the link text", () => {
    renderWithRouter(
      <RecipeProvenance sourceUrl="https://example.com/very/long/path/to/recipe" />,
    );
    const link = screen.getByRole("link", { name: /example\.com/i });
    expect(link.textContent).toBe("example.com");
  });

  it("renders 'forked from <chef>/<title>' linking to the forked recipe when sourceRecipe is set", () => {
    renderWithRouter(
      <RecipeProvenance
        sourceRecipe={{
          id: "recipe-1",
          title: "Pancakes",
          chefId: "chef-1",
          chef: { username: "alice" },
        }}
      />,
    );
    expect(screen.getByText(/forked from/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /alice/i });
    expect(link).toHaveAttribute("href", "/recipes/recipe-1");
    expect(screen.getByText("Pancakes")).toBeInTheDocument();
  });

  it("renders both branches simultaneously", () => {
    renderWithRouter(
      <RecipeProvenance
        sourceUrl="https://nyt.com/recipes/123"
        sourceRecipe={{
          id: "recipe-2",
          title: "Sourdough",
          chefId: "chef-2",
          chef: { username: "bob" },
        }}
      />,
    );
    expect(screen.getByText(/originally from/i)).toBeInTheDocument();
    expect(screen.getByText(/forked from/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /nyt\.com/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /bob/i })).toBeInTheDocument();
  });

  it("renders nothing when neither prop is set", () => {
    const { container } = renderWithRouter(<RecipeProvenance />);
    expect(container.firstChild).toBeNull();
  });

  it("falls back to the raw string when sourceUrl is malformed (no protocol)", () => {
    renderWithRouter(<RecipeProvenance sourceUrl="not a real url" />);
    expect(screen.getByText(/originally from/i)).toBeInTheDocument();
    expect(screen.getByText("not a real url")).toBeInTheDocument();
  });

  it("truncates a very long forked title with a title attribute holding the full text", () => {
    const longTitle = "A".repeat(120);
    renderWithRouter(
      <RecipeProvenance
        sourceRecipe={{
          id: "r",
          title: longTitle,
          chefId: "c",
          chef: { username: "alice" },
        }}
      />,
    );
    const titleEl = screen.getByText((_content, element) => {
      return Boolean(
        element?.tagName === "SPAN" &&
          element.getAttribute("title") === longTitle,
      );
    });
    expect(titleEl).toBeInTheDocument();
    expect(titleEl.getAttribute("title")).toBe(longTitle);
  });
});
