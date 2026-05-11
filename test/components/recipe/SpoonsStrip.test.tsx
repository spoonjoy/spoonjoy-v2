import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BrowserRouter } from "react-router";
import {
  SpoonsStrip,
  type SpoonsStripItem,
} from "../../../app/components/recipe/SpoonsStrip";

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

function makeSpoon(overrides: Partial<SpoonsStripItem> = {}): SpoonsStripItem {
  return {
    id: `s_${Math.random().toString(36).slice(2)}`,
    cookedAt: new Date("2025-05-01T12:00:00Z").toISOString(),
    photoUrl: null,
    note: null,
    nextTime: null,
    chef: { id: "u1", username: "alice", photoUrl: null },
    recipe: null,
    coverImageUrl: null,
    ...overrides,
  };
}

describe("SpoonsStrip", () => {
  it("renders an explicit empty state when there are no spoons", () => {
    renderWithRouter(<SpoonsStrip spoons={[]} />);
    expect(screen.getByText(/no cooks yet/i)).toBeInTheDocument();
  });

  it("renders chef username, photo, note, and nextTime when present", () => {
    renderWithRouter(
      <SpoonsStrip
        spoons={[
          makeSpoon({
            note: "It was great",
            nextTime: "more salt",
            photoUrl: "/photos/a.png",
          }),
        ]}
      />,
    );
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("It was great")).toBeInTheDocument();
    expect(screen.getByText(/more salt/)).toBeInTheDocument();
    const img = screen.getByRole("img", { name: /cook by alice/i });
    expect(img).toHaveAttribute("src", "/photos/a.png");
  });

  it("formats cookedAt as a relative time", () => {
    renderWithRouter(
      <SpoonsStrip
        spoons={[
          makeSpoon({
            cookedAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        ]}
      />,
    );
    expect(screen.getByText(/minute ago|just now|1 min/i)).toBeInTheDocument();
  });

  it("links each chef to their profile by username", () => {
    renderWithRouter(<SpoonsStrip spoons={[makeSpoon()]} />);
    const link = screen.getByRole("link", { name: /alice/i });
    expect(link).toHaveAttribute("href", "/users/alice");
  });

  it("truncates long notes and exposes an expand toggle", async () => {
    const longNote = "a".repeat(220);
    renderWithRouter(<SpoonsStrip spoons={[makeSpoon({ note: longNote })]} />);
    const toggle = screen.getByRole("button", { name: /show more/i });
    expect(toggle).toBeInTheDocument();
    // truncated by default
    expect(screen.queryByText(longNote)).toBeNull();
    await userEvent.click(toggle);
    expect(screen.getByText(longNote)).toBeInTheDocument();
    const collapse = screen.getByRole("button", { name: /show less/i });
    await userEvent.click(collapse);
    expect(screen.queryByText(longNote)).toBeNull();
  });

  it("when showRecipe=true renders the recipe title and a link to /recipes/<id>", () => {
    renderWithRouter(
      <SpoonsStrip
        showRecipe
        spoons={[
          makeSpoon({
            recipe: { id: "r1", title: "Lentil Soup", chefId: "u1" },
            coverImageUrl: "/photos/cover.png",
          }),
        ]}
      />,
    );
    const recipeLink = screen.getByRole("link", { name: /lentil soup/i });
    expect(recipeLink).toHaveAttribute("href", "/recipes/r1");
    const cover = screen.getByRole("img", { name: /lentil soup cover/i });
    expect(cover).toHaveAttribute("src", "/photos/cover.png");
  });

  it("when showRecipe is omitted, no recipe link is rendered", () => {
    renderWithRouter(
      <SpoonsStrip
        spoons={[
          makeSpoon({
            recipe: { id: "r1", title: "Lentil Soup", chefId: "u1" },
            coverImageUrl: "/photos/cover.png",
          }),
        ]}
      />,
    );
    expect(screen.queryByRole("link", { name: /lentil soup/i })).toBeNull();
  });
});
