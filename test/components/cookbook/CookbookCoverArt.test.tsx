import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CookbookCoverArt, cookbookCoverImages } from "~/components/cookbook/CookbookCoverArt";

const images = [
  { coverImageUrl: "/a.jpg", title: "A" },
  { coverImageUrl: "/b.jpg", title: "B" },
  { coverImageUrl: "/c.jpg", title: "C" },
  { coverImageUrl: "/d.jpg", title: "D" },
  { coverImageUrl: "/e.jpg", title: "E" },
];

describe("CookbookCoverArt", () => {
  it("filters missing covers and keeps the first four real images", () => {
    expect(
      cookbookCoverImages([
        { coverImageUrl: null, title: "Missing" },
        { coverImageUrl: "", title: "Empty" },
        ...images,
      ]),
    ).toEqual(images.slice(0, 4));
  });

  it("renders an editorial fallback cover for empty cookbooks", () => {
    render(<CookbookCoverArt title="Empty Book" recipeCount={0} recipeImages={[]} />);

    expect(screen.getAllByText("Empty Book").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0 recipes").length).toBeGreaterThan(0);
    expect(screen.getByText("Spoonjoy")).toBeInTheDocument();
    expect(screen.getByText("Spoonjoy cookbook")).toBeInTheDocument();
  });

  it("defaults to an editorial fallback cover when images are omitted", () => {
    render(<CookbookCoverArt title="Defaulted Book" recipeCount={0} />);

    expect(screen.getAllByText("Defaulted Book").length).toBeGreaterThan(0);
  });

  it("renders a single-photo cover", () => {
    render(<CookbookCoverArt title="One Dish" recipeCount={1} recipeImages={[images[0]]} />);

    expect(screen.getByRole("img", { name: "A" })).toHaveAttribute("src", "/a.jpg");
    expect(screen.getAllByText("1 recipe").length).toBeGreaterThan(0);
  });

  it("renders a two-photo cover", () => {
    const { container } = render(
      <CookbookCoverArt title="Two Dishes" recipeCount={2} recipeImages={images.slice(0, 2)} />,
    );

    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(screen.getByLabelText("Two Dishes cover photos")).toBeInTheDocument();
  });

  it("renders a four-photo cover and ignores extra images", () => {
    const { container } = render(<CookbookCoverArt title="Four Dishes" recipeCount={5} recipeImages={images} />);

    expect(container.querySelectorAll("img")).toHaveLength(4);
    expect(screen.getAllByText("5 recipes").length).toBeGreaterThan(0);
  });
});
