import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BrowserRouter, MemoryRouter } from "react-router";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
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

  it("renders an optional empty-state CTA", () => {
    renderWithRouter(
      <SpoonsStrip
        spoons={[]}
        emptyAction={<a href="/recipes/r1#cook">Log the first cook</a>}
      />,
    );

    expect(screen.getByRole("link", { name: "Log the first cook" })).toHaveAttribute("href", "/recipes/r1#cook");
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

  it("renders compact cook notes and next-time text when profile rows show recipes", () => {
    renderWithRouter(
      <SpoonsStrip
        showRecipe
        spoons={[
          makeSpoon({
            note: "Loved the charred edges",
            nextTime: "more lemon",
            recipe: null,
            coverImageUrl: null,
          }),
        ]}
      />,
    );

    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("Loved the charred edges")).toBeInTheDocument();
    expect(screen.getByText(/more lemon/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("uses the cook photo before the recipe cover in compact recipe rows", () => {
    renderWithRouter(
      <SpoonsStrip
        showRecipe
        spoons={[
          makeSpoon({
            photoUrl: "/photos/cook.png",
            recipe: { id: "r1", title: "Lentil Soup", chefId: "u1" },
            coverImageUrl: "/photos/cover.png",
          }),
        ]}
      />,
    );

    const photo = screen.getByRole("img", { name: /cook by alice/i });
    expect(photo).toHaveAttribute("src", "/photos/cook.png");
  });

  it("renders 'just now' for cookedAt within the last 45 seconds", () => {
    renderWithRouter(
      <SpoonsStrip
        spoons={[
          makeSpoon({ cookedAt: new Date(Date.now() - 5_000).toISOString() }),
        ]}
      />,
    );
    expect(screen.getByText(/just now/i)).toBeInTheDocument();
  });

  it("renders hr ago for cookedAt several hours back", () => {
    renderWithRouter(
      <SpoonsStrip
        spoons={[
          makeSpoon({
            cookedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          }),
        ]}
      />,
    );
    expect(screen.getByText(/3 hr ago/i)).toBeInTheDocument();
  });

  it("renders days ago for cookedAt several days back", () => {
    renderWithRouter(
      <SpoonsStrip
        spoons={[
          makeSpoon({
            cookedAt: new Date(
              Date.now() - 5 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          }),
        ]}
      />,
    );
    expect(screen.getByText(/5 days ago/i)).toBeInTheDocument();
  });

  it("renders mo ago for cookedAt within the year", () => {
    renderWithRouter(
      <SpoonsStrip
        spoons={[
          makeSpoon({
            cookedAt: new Date(
              Date.now() - 90 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          }),
        ]}
      />,
    );
    expect(screen.getByText(/3 mo ago/i)).toBeInTheDocument();
  });

  it("renders yr ago for cookedAt over a year back", () => {
    renderWithRouter(
      <SpoonsStrip
        spoons={[
          makeSpoon({
            cookedAt: new Date(
              Date.now() - 400 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          }),
        ]}
      />,
    );
    expect(screen.getByText(/yr ago/i)).toBeInTheDocument();
  });

  it("does NOT show an expand toggle for short notes", () => {
    renderWithRouter(
      <SpoonsStrip
        spoons={[makeSpoon({ note: "short note" })]}
      />,
    );
    expect(screen.queryByRole("button", { name: /show more/i })).toBeNull();
  });

  it("renders the recipe link with no cover image when coverImageUrl is null", () => {
    renderWithRouter(
      <SpoonsStrip
        showRecipe
        spoons={[
          makeSpoon({
            recipe: { id: "r1", title: "Lentil Soup", chefId: "u1" },
            coverImageUrl: null,
          }),
        ]}
      />,
    );
    const recipeLink = screen.getByRole("link", { name: /lentil soup/i });
    expect(recipeLink).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /cover/i })).toBeNull();
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

  it("renders each cook's time relative to the given now, in a <time> carrying the exact instant", () => {
    const cookedAt = "2025-05-01T12:00:00.000Z";
    const now = Date.parse("2025-05-01T15:00:30Z");
    renderWithRouter(
      <>
        <SpoonsStrip spoons={[makeSpoon({ id: "full", cookedAt, note: "full row" })]} now={now} />
        <SpoonsStrip
          spoons={[makeSpoon({ id: "compact", cookedAt, recipe: { id: "r1", title: "Lentil Soup", chefId: "u1" } })]}
          showRecipe
          now={now}
        />
      </>,
    );
    const times = document.querySelectorAll("time");
    // One in the full row; the compact row has one for phones and one for wider screens.
    expect(times).toHaveLength(3);
    for (const time of times) {
      expect(time).toHaveTextContent("3 hr ago");
      expect(time).toHaveAttribute("datetime", cookedAt);
    }
  });

  it("renders the same text on the server and when the browser hydrates it a minute later", async () => {
    // A cook's relative time used to read the clock during render, so the server and the
    // hydrating browser disagreed whenever the label changed in between ("just now" became
    // "1 min ago") and React reported a hydration mismatch.
    const renderedAt = Date.parse("2025-05-01T12:00:10Z");
    const ui = (
      <MemoryRouter>
        <SpoonsStrip spoons={[makeSpoon({ id: "s1", cookedAt: "2025-05-01T12:00:00.000Z" })]} now={renderedAt} />
      </MemoryRouter>
    );
    const clock = vi.spyOn(Date, "now").mockReturnValue(renderedAt);
    const container = document.createElement("div");
    container.innerHTML = renderToString(ui);
    document.body.appendChild(container);
    clock.mockReturnValue(renderedAt + 60_000);
    const onRecoverableError = vi.fn();
    try {
      await act(async () => {
        hydrateRoot(container, ui, { onRecoverableError });
      });
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(container.querySelector("time")).toHaveTextContent("just now");
    } finally {
      clock.mockRestore();
      container.remove();
    }
  });
});
