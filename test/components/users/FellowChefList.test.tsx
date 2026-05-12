import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { FellowChefList } from "~/components/users/FellowChefList";
import type { FellowChefRow } from "~/lib/fellow-chefs.server";

function row(overrides: Partial<FellowChefRow>): FellowChefRow {
  return {
    chefId: "u1",
    username: "rowan",
    photoUrl: null,
    interactionCounts: { spoons: 0, forks: 0, cookbookSaves: 0 },
    latestInteractionAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  };
}

function renderList(rows: FellowChefRow[], emptyStateText = "no rows yet") {
  return render(
    <MemoryRouter>
      <FellowChefList rows={rows} emptyStateText={emptyStateText} />
    </MemoryRouter>,
  );
}

describe("FellowChefList", () => {
  it("renders empty state when rows is empty", () => {
    renderList([], "no chefs yet");
    expect(screen.getByText("no chefs yet")).toBeInTheDocument();
  });

  it("renders a row with avatar image, username link, and summary", () => {
    renderList([
      row({
        chefId: "user-1",
        username: "rowan",
        photoUrl: "https://example.com/rowan.png",
        interactionCounts: { spoons: 3, forks: 1, cookbookSaves: 2 },
        latestInteractionAt: new Date(Date.now() - 60 * 1000), // ~1 minute ago
      }),
    ]);
    const link = screen.getByRole("link", { name: /rowan/i });
    expect(link).toHaveAttribute("href", "/users/rowan");
    const img = screen.getByRole("img", { name: "rowan" });
    expect(img).toHaveAttribute("src", "https://example.com/rowan.png");
    expect(screen.getByText("3 spoons · 1 fork · 2 saves")).toBeInTheDocument();
  });

  it("collapses zero counts and uses singular forms when count is 1", () => {
    renderList([
      row({
        chefId: "u-a",
        username: "ada",
        interactionCounts: { spoons: 1, forks: 0, cookbookSaves: 0 },
      }),
    ]);
    expect(screen.getByText("1 spoon")).toBeInTheDocument();
  });

  it("uses singular fork / save when count is 1", () => {
    renderList([
      row({
        chefId: "u-b",
        username: "blake",
        interactionCounts: { spoons: 0, forks: 1, cookbookSaves: 1 },
      }),
    ]);
    expect(screen.getByText("1 fork · 1 save")).toBeInTheDocument();
  });

  it("uses plural forms for all three counts when > 1", () => {
    renderList([
      row({
        chefId: "u-c",
        username: "cleo",
        interactionCounts: { spoons: 2, forks: 4, cookbookSaves: 3 },
      }),
    ]);
    expect(screen.getByText("2 spoons · 4 forks · 3 saves")).toBeInTheDocument();
  });

  it("renders Avatar initials fallback when photoUrl is null", () => {
    renderList([
      row({
        chefId: "u-d",
        username: "dakota",
        photoUrl: null,
        interactionCounts: { spoons: 1, forks: 0, cookbookSaves: 0 },
      }),
    ]);
    // Initials fallback rendered inside Avatar's SVG <title> uses the alt text
    // and <text> uses the initials.
    expect(screen.getByText("D")).toBeInTheDocument();
  });

  it("renders a relative-time suffix for latestInteractionAt", () => {
    const now = new Date();
    renderList([
      row({
        chefId: "u-e",
        username: "everly",
        latestInteractionAt: new Date(now.getTime() - 5 * 1000),
        interactionCounts: { spoons: 1, forks: 0, cookbookSaves: 0 },
      }),
    ]);
    expect(screen.getByText(/just now|seconds ago|ago/i)).toBeInTheDocument();
  });

  it("accepts ISO string for latestInteractionAt", () => {
    renderList([
      row({
        chefId: "u-f",
        username: "frankie",
        latestInteractionAt: new Date(
          Date.now() - 2 * 60 * 60 * 1000,
        ).toISOString() as unknown as Date,
        interactionCounts: { spoons: 2, forks: 0, cookbookSaves: 0 },
      }),
    ]);
    expect(screen.getByText(/hours? ago/i)).toBeInTheDocument();
  });

  it("renders multiple rows in order", () => {
    renderList([
      row({ chefId: "u-1", username: "alpha", interactionCounts: { spoons: 1, forks: 0, cookbookSaves: 0 } }),
      row({ chefId: "u-2", username: "beta", interactionCounts: { spoons: 2, forks: 0, cookbookSaves: 0 } }),
    ]);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/users/alpha",
      "/users/beta",
    ]);
  });

  it("renders all-zero counts as an empty summary string", () => {
    renderList([
      row({
        chefId: "u-zero",
        username: "zara",
        interactionCounts: { spoons: 0, forks: 0, cookbookSaves: 0 },
      }),
    ]);
    // No summary line means the timestamp is the only text after the link
    expect(screen.queryByText(/spoon|fork|save/i)).toBeNull();
  });
});
