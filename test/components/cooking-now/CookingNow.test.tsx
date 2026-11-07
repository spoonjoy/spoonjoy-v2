import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactNode } from "react";
import {
  CookingNowPill,
  CookingNowStrip,
  LocalCookingNow,
} from "~/components/cooking-now/CookingNow";
import { COOKING_NOW_RECENT_MS, recordLocalCookingNow, type CookingNowEntry } from "~/lib/cooking-now";

const NOW = Date.UTC(2026, 9, 24, 12);

function entry(overrides: Partial<CookingNowEntry> & { id?: string; title?: string; coverImageUrl?: string | null } = {}): CookingNowEntry {
  const { id = "r1", title = "Lemon Herb Rice", coverImageUrl = "/photos/rice.jpg", ...rest } = overrides;
  return {
    recipe: { id, title, coverImageUrl, href: `/recipes/${id}` },
    activeStepId: "s3",
    activeStepIndex: 2,
    stepCount: 7,
    checkedCount: 3,
    totalCount: 12,
    allCheckedAt: null,
    touchedAt: new Date(NOW - 60_000).toISOString(),
    expiresAt: new Date(NOW + 1000).toISOString(),
    ...rest,
  };
}

function inRouter(children: ReactNode) {
  return render(<MemoryRouter>{children}</MemoryRouter>);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("CookingNowStrip", () => {
  it("shows a card per recipe with its photo, step, progress and two ways to open it", () => {
    inRouter(<CookingNowStrip now={NOW} entries={[entry(), entry({ id: "r2", title: "Bread", coverImageUrl: null, totalCount: 0, stepCount: 0 })]} />);

    const strip = screen.getByRole("region", { name: "Cooking now" });
    expect(strip).toHaveAttribute("id", "cooking-now");
    expect(within(strip).getByText("2 recipes")).toBeInTheDocument();

    const rice = within(strip).getByRole("article", { name: "Lemon Herb Rice" });
    expect(rice.querySelector("img")).toHaveAttribute("src", "/photos/rice.jpg");
    expect(within(rice).getByTestId("cooking-now-step")).toHaveTextContent("Step 3 of 7");
    expect(within(rice).getByTestId("cooking-now-checked")).toHaveTextContent("3 of 12 checked");
    expect(within(rice).getByRole("link", { name: "Open Lemon Herb Rice" })).toHaveAttribute("href", "/recipes/r1");
    const newWindow = within(rice).getByRole("link", { name: "Open in new window: Lemon Herb Rice" });
    expect(newWindow).toHaveAttribute("href", "/recipes/r1");
    expect(newWindow).toHaveAttribute("target", "_blank");

    expect(within(strip).queryByTestId("cooking-now-hero")).toBeNull();
    const bread = within(strip).getByRole("article", { name: "Bread" });
    expect(bread.querySelector("img")).toBeNull();
    expect(within(bread).getByTestId("cooking-now-cover-placeholder")).toHaveTextContent("B");
    expect(within(bread).queryByTestId("cooking-now-step")).toBeNull();
    expect(within(bread).queryByTestId("cooking-now-checked")).toBeNull();
  });

  it("says one recipe in the singular", () => {
    inRouter(<CookingNowStrip now={NOW} entries={[entry()]} />);
    expect(screen.getByText("1 recipe")).toBeInTheDocument();
  });

  it("is absent with nothing in progress", () => {
    inRouter(<CookingNowStrip now={NOW} entries={[]} />);
    expect(screen.queryByRole("region", { name: "Cooking now" })).toBeNull();
  });

  it("counts down the soonest running timer this browser has for the recipe", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // HX Timer keeps each step's timer under its own timerId.
    const timer = (step: number, state: object) =>
      window.localStorage.setItem(`ouro-timer:spoonjoy-cook-timer:r1:${step}`, JSON.stringify(state));
    timer(1, { status: "running", duration: 900, endsAt: NOW + 600_000 });
    timer(2, { status: "running", duration: 120, endsAt: NOW + 65_000 });
    timer(3, { status: "paused", duration: 60, remainingMs: 5_000 });
    timer(4, { status: "running", duration: 60, endsAt: NOW - 1_000 });
    inRouter(<CookingNowStrip now={NOW} entries={[entry()]} />);

    expect(screen.getByTestId("cooking-now-timer")).toHaveTextContent("Timer 1:05");
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByTestId("cooking-now-timer")).toHaveTextContent("Timer 1:00");
  });

  it("shows no timer when none runs or timers cannot be read", () => {
    inRouter(<CookingNowStrip now={NOW} entries={[entry()]} />);
    expect(screen.queryByTestId("cooking-now-timer")).toBeNull();
    cleanup();

    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    inRouter(<CookingNowStrip now={NOW} entries={[entry()]} />);
    expect(screen.queryByTestId("cooking-now-timer")).toBeNull();
  });
});

describe("the Back to card", () => {
  it("leads the strip with the one recipe touched in the last two hours, named once", () => {
    const old = entry({ id: "old", title: "Bread", touchedAt: new Date(NOW - COOKING_NOW_RECENT_MS).toISOString() });
    inRouter(<CookingNowStrip now={NOW} entries={[entry(), old]} />);

    const strip = screen.getByRole("region", { name: "Cooking now" });
    const hero = within(strip).getByTestId("cooking-now-hero");
    expect(hero).toHaveAccessibleName("Lemon Herb Rice");
    expect(within(hero).getByText("You were cooking")).toBeInTheDocument();
    expect(within(hero).getByTestId("cooking-now-step")).toHaveTextContent("Step 3 of 7");
    expect(within(hero).getByRole("link", { name: "Back to Lemon Herb Rice" })).toHaveAttribute("href", "/recipes/r1");
    expect(within(hero).getByRole("link", { name: "Open in new window: Lemon Herb Rice" })).toHaveAttribute("target", "_blank");
    expect(within(strip).getAllByRole("article").map((article) => article.getAttribute("aria-labelledby"))).toEqual([
      "cooking-now-r1-title",
      "cooking-now-old-title",
    ]);
    expect(within(strip).getAllByText("Lemon Herb Rice")).toHaveLength(1);
  });

  it("is the lone card when it is the only recipe, and leaves out the step for a recipe without steps", () => {
    inRouter(<CookingNowStrip now={NOW} entries={[entry({ stepCount: 0, coverImageUrl: null })]} />);

    const strip = screen.getByRole("region", { name: "Cooking now" });
    expect(within(strip).getAllByRole("article")).toHaveLength(1);
    expect(within(strip).getByTestId("cooking-now-hero")).toBeInTheDocument();
    expect(within(strip).queryByTestId("cooking-now-step")).toBeNull();
    expect(within(strip).getByTestId("cooking-now-cover-placeholder")).toHaveTextContent("L");
    expect(within(strip).queryByRole("list")).toBeNull();
  });
});

describe("LocalCookingNow", () => {
  it("shows this browser's list for a signed-out cook", () => {
    recordLocalCookingNow({
      recipe: { id: "r1", title: "Lemon Herb Rice", coverImageUrl: null },
      activeStepId: "s1",
      activeStepIndex: 0,
      stepCount: 3,
      checkedIds: ["i1"],
      totalCount: 4,
      now: Date.now(),
    });
    inRouter(<LocalCookingNow />);

    expect(screen.getByRole("region", { name: "Cooking now" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Lemon Herb Rice" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Pick up where you left off" })).toBeNull();
  });

  it("shows nothing when this browser has nothing in progress", () => {
    inRouter(<LocalCookingNow />);
    expect(screen.queryByTestId("local-cooking-now")).toBeNull();
  });

  // The Cooking pill links to /#cooking-now. The strip appears only after hydration, after the
  // router has looked for that id and found nothing, so it scrolls itself into view.
  for (const [hash, scrolls] of [["#cooking-now", true], ["", false]] as const) {
    it(`${scrolls ? "brings itself into view" : "leaves the scroll alone"} when the page is opened at "/${hash}"`, () => {
      recordLocalCookingNow({
        recipe: { id: "r1", title: "Lemon Herb Rice", coverImageUrl: null },
        activeStepId: "s1",
        activeStepIndex: 0,
        stepCount: 3,
        checkedIds: ["i1"],
        totalCount: 4,
        now: Date.now(),
      });
      const scrolled: Element[] = [];
      const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
      Object.defineProperty(Element.prototype, "scrollIntoView", {
        configurable: true,
        value(this: Element) {
          scrolled.push(this);
        },
      });
      window.history.replaceState(null, "", `/${hash}`);
      try {
        inRouter(<LocalCookingNow />);
        expect(scrolled).toEqual(scrolls ? [screen.getByRole("region", { name: "Cooking now" })] : []);
      } finally {
        window.history.replaceState(null, "", "/");
        if (original) Object.defineProperty(Element.prototype, "scrollIntoView", original);
        else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
      }
    });
  }
});

describe("CookingNowPill", () => {
  it("opens the Kitchen's strip and shows how many recipes are in progress", () => {
    inRouter(<CookingNowPill count={2} />);
    expect(screen.getByRole("link", { name: "Cooking · 2" })).toHaveAttribute("href", "/#cooking-now");
  });

  it("is absent with nothing in progress", () => {
    inRouter(<CookingNowPill count={0} />);
    expect(screen.queryByTestId("cooking-now-pill")).toBeNull();
  });
});
