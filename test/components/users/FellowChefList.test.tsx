import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { FellowChefList } from "~/components/users/FellowChefList";
import type { FellowChefRow } from "~/lib/fellow-chefs.server";

type FellowChefDisplayRow = FellowChefRow & { latestInteractionLabel: string };

function row(overrides: Partial<FellowChefDisplayRow>): FellowChefDisplayRow {
  return {
    chefId: "u1",
    username: "rowan",
    photoUrl: null,
    interactionCounts: { spoons: 0, forks: 0, cookbookSaves: 0 },
    latestInteractionAt: new Date("2026-05-01T00:00:00Z"),
    latestInteractionLabel: "2 months ago",
    ...overrides,
  };
}

function renderList(rows: FellowChefDisplayRow[], emptyStateText = "no rows yet") {
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

  it("renders Chef RJ when photoUrl is null", () => {
    renderList([
      row({
        chefId: "u-d",
        username: "dakota",
        photoUrl: null,
        interactionCounts: { spoons: 1, forks: 0, cookbookSaves: 0 },
      }),
    ]);
    const img = screen.getByRole("img", { name: "dakota" });
    expect(img).toHaveAttribute("src", "/images/chef-rj.png");
  });

  it("renders the server-frozen relative-time label", () => {
    renderList([
      row({
        chefId: "u-e",
        username: "everly",
        latestInteractionAt: new Date("2026-05-01T00:00:00Z"),
        latestInteractionLabel: "frozen activity label",
        interactionCounts: { spoons: 1, forks: 0, cookbookSaves: 0 },
      }),
    ]);
    expect(screen.getByText("frozen activity label")).toBeInTheDocument();
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
