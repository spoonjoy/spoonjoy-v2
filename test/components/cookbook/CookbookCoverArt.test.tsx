import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CookbookCoverArt, cookbookCoverImages } from "~/components/cookbook/CookbookCoverArt";

const legacyChefPhotoLabel = ["Chef", "photo"].join(" ");
const legacySpoonjoyCookbookLabel = ["Spoonjoy", "cookbook"].join(" ");
const legacyEditorializedChefPhotoLabel = ["Editorialized", "chef", "photo"].join(" ");

const images = [
  { coverImageUrl: "/a.jpg", title: "A", coverProvenanceLabel: legacyChefPhotoLabel },
  { coverImageUrl: "/b.jpg", title: "B", coverProvenanceLabel: legacyEditorializedChefPhotoLabel },
  { coverImageUrl: "/c.jpg", title: "C", coverProvenanceLabel: "Imported photo" },
  { coverImageUrl: "/d.jpg", title: "D", coverProvenanceLabel: "AI generated" },
  { coverImageUrl: "/e.jpg", title: "E", coverProvenanceLabel: legacyChefPhotoLabel },
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
    expect(screen.queryByText(legacySpoonjoyCookbookLabel)).not.toBeInTheDocument();
  });

  it("names a photo-less cookbook once, like a printed cover, with no dark caption band", () => {
    const { container } = render(<CookbookCoverArt title="Plain Book" recipeCount={3} recipeImages={[]} />);

    expect(screen.getAllByText("Plain Book")).toHaveLength(1);
    expect(screen.getAllByText("3 recipes")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 3, name: "Plain Book" })).toBeInTheDocument();
    expect(container.querySelector("figcaption")).toBeNull();
  });

  it("keeps the fallback's top-right corner clear for an overlaid share button", () => {
    render(<CookbookCoverArt title="Corner Book" recipeCount={2} recipeImages={[]} />);

    const header = screen.getByText("Spoonjoy").parentElement as HTMLElement;
    expect(header).not.toHaveTextContent("2 recipes");
  });

  it("renders the fallback title as plain text when a caller already exposes it as a heading", () => {
    render(<CookbookCoverArt title="Detail Book" recipeCount={0} titleAsHeading={false} />);

    expect(screen.queryByRole("heading", { name: "Detail Book" })).not.toBeInTheDocument();
    expect(screen.getByText("Detail Book")).toBeInTheDocument();
  });

  it("defaults to an editorial fallback cover when images are omitted", () => {
    render(<CookbookCoverArt title="Defaulted Book" recipeCount={0} />);

    expect(screen.getAllByText("Defaulted Book").length).toBeGreaterThan(0);
  });

  it("renders a single-photo cover", () => {
    render(<CookbookCoverArt title="One Dish" recipeCount={1} recipeImages={[images[0]]} />);

    expect(screen.getByRole("img", { name: "A" })).toHaveAttribute("src", "/a.jpg");
    const badge = screen.getByTestId("cover-provenance-badge");
    expect(badge).toHaveTextContent("Original photo");
    expect(screen.queryByText(legacyChefPhotoLabel)).not.toBeInTheDocument();
    expect(badge).toHaveClass("bg-[rgba(37,34,31,0.96)]");
    expect(badge).toHaveClass("text-[var(--sj-paper)]");
    expect(badge.className).not.toContain("text-[var(--sj-ink-soft)]");
    expect(screen.queryByText(legacySpoonjoyCookbookLabel)).not.toBeInTheDocument();
    expect(screen.getAllByText("1 recipe").length).toBeGreaterThan(0);
  });

  it("normalizes stale editorial cover labels before rendering cookbook badges", () => {
    render(<CookbookCoverArt title="Editorial Dish" recipeCount={1} recipeImages={[images[1]]} />);

    const badge = screen.getByTestId("cover-provenance-badge");
    expect(badge).toHaveTextContent("Editorial photo");
    expect(screen.queryByText(legacyEditorializedChefPhotoLabel)).not.toBeInTheDocument();
    expect(screen.queryByText(legacySpoonjoyCookbookLabel)).not.toBeInTheDocument();
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

  it("renders the cover caption title as a heading by default", () => {
    render(<CookbookCoverArt title="Heading Book" recipeCount={1} recipeImages={[images[0]]} />);

    expect(screen.getByRole("heading", { level: 3, name: "Heading Book" })).toBeInTheDocument();
  });

  it("renders the cover caption title as plain text when a caller already exposes it as a heading elsewhere", () => {
    render(
      <CookbookCoverArt
        title="Already Headed Book"
        recipeCount={1}
        recipeImages={[images[0]]}
        titleAsHeading={false}
      />,
    );

    expect(screen.queryByRole("heading", { name: "Already Headed Book" })).not.toBeInTheDocument();
    expect(screen.getByText("Already Headed Book")).toBeInTheDocument();
  });
});
