import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COOKING_NOW_CHANGED_EVENT,
  COOKING_NOW_DONE_MS,
  COOKING_NOW_IDLE_MS,
  COOKING_NOW_LOCAL_STORAGE_KEY,
  COOKING_NOW_RECENT_MS,
  applyLocalCookingNowWrite,
  cookingNowBannerEntry,
  cookingNowProgress,
  cookingNowStepLabel,
  localCookingNowEntries,
  parseLocalCookingNow,
  readLocalCookingNow,
  recordLocalCookingNow,
  type CookingNowEntry,
  type LocalCookingNowWrite,
} from "~/lib/cooking-now";

const NOW = Date.UTC(2026, 9, 24, 12);

function write(overrides: Partial<LocalCookingNowWrite> = {}): LocalCookingNowWrite {
  return {
    recipe: { id: "r1", title: "Lemon Herb Rice", coverImageUrl: "/photos/rice.jpg" },
    activeStepId: "s1",
    activeStepIndex: 0,
    stepCount: 3,
    checkedIds: ["i1"],
    totalCount: 4,
    now: NOW,
    ...overrides,
  };
}

function entry(id: string, touchedAt: number): CookingNowEntry {
  return {
    recipe: { id, title: id, coverImageUrl: null, href: `/recipes/${id}` },
    activeStepId: null,
    activeStepIndex: 0,
    stepCount: 1,
    checkedCount: 1,
    totalCount: 2,
    allCheckedAt: null,
    touchedAt: new Date(touchedAt).toISOString(),
    expiresAt: new Date(touchedAt + COOKING_NOW_IDLE_MS).toISOString(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("what a Cooking now card shows", () => {
  it("counts the step from one and keeps it within the recipe", () => {
    expect(cookingNowStepLabel({ activeStepIndex: 2, stepCount: 7 })).toBe("Step 3 of 7");
    expect(cookingNowStepLabel({ activeStepIndex: 9, stepCount: 3 })).toBe("Step 3 of 3");
    expect(cookingNowStepLabel({ activeStepIndex: 0, stepCount: 0 })).toBeNull();
  });

  it("measures how much is checked", () => {
    expect(cookingNowProgress({ checkedCount: 1, totalCount: 4 })).toBe(0.25);
    expect(cookingNowProgress({ checkedCount: 5, totalCount: 4 })).toBe(1);
    expect(cookingNowProgress({ checkedCount: 0, totalCount: 0 })).toBe(0);
  });
});

describe("the Back to banner", () => {
  it("offers the one recipe touched in the last two hours", () => {
    const recent = entry("recent", NOW - 60_000);
    expect(cookingNowBannerEntry([recent, entry("old", NOW - COOKING_NOW_RECENT_MS)], NOW)).toBe(recent);
  });

  it("offers nothing when none or several were touched recently", () => {
    expect(cookingNowBannerEntry([], NOW)).toBeNull();
    expect(cookingNowBannerEntry([entry("a", NOW), entry("b", NOW - 1)], NOW)).toBeNull();
  });
});

describe("the signed-out list's rules", () => {
  it("lists a recipe once something is checked, with what its card shows", () => {
    const rows = applyLocalCookingNowWrite({}, write({ checkedIds: ["i1", "o1"] }));

    expect(localCookingNowEntries(rows, NOW)).toEqual([{
      recipe: { id: "r1", title: "Lemon Herb Rice", coverImageUrl: "/photos/rice.jpg", href: "/recipes/r1" },
      activeStepId: "s1",
      activeStepIndex: 0,
      stepCount: 3,
      checkedCount: 2,
      totalCount: 4,
      allCheckedAt: null,
      touchedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + COOKING_NOW_IDLE_MS).toISOString(),
    }]);
  });

  it("lists a recipe on a later step with nothing checked, but not one just opened", () => {
    expect(localCookingNowEntries(applyLocalCookingNowWrite({}, write({ checkedIds: [] })), NOW)).toEqual([]);
    expect(localCookingNowEntries(applyLocalCookingNowWrite({}, write({ checkedIds: [], activeStepIndex: 1 })), NOW)).toHaveLength(1);
  });

  it("never counts more checked than the recipe has", () => {
    const rows = applyLocalCookingNowWrite({}, write({ checkedIds: ["a", "b", "c"], totalCount: 2 }));
    expect(rows.r1.checkedCount).toBe(2);
  });

  it("does not touch a recipe that was opened without a change", () => {
    const first = applyLocalCookingNowWrite({}, write());
    const reopened = applyLocalCookingNowWrite(first, write({ now: NOW + 60_000, recipe: { id: "r1", title: "Renamed", coverImageUrl: null }, stepCount: 4 }));

    expect(reopened.r1.touchedAt).toBe(NOW);
    expect(reopened.r1.recipe.title).toBe("Renamed");
    expect(reopened.r1.stepCount).toBe(4);
  });

  it("drops an unchanged recipe once it has expired", () => {
    const first = applyLocalCookingNowWrite({}, write());
    expect(applyLocalCookingNowWrite(first, write({ now: NOW + COOKING_NOW_IDLE_MS }))).toEqual({});
  });

  it("unlists on Clear progress and lists again on a check or another step", () => {
    const checked = applyLocalCookingNowWrite({}, write());
    const cleared = applyLocalCookingNowWrite(checked, write({ checkedIds: [], now: NOW + 1 }));
    expect(cleared.r1.listed).toBe(false);
    expect(localCookingNowEntries(cleared, NOW + 1)).toEqual([]);

    expect(applyLocalCookingNowWrite(cleared, write({ checkedIds: [], activeStepId: "s1", activeStepIndex: 0, now: NOW + 2, totalCount: 5 })).r1.listed).toBe(false);
    expect(applyLocalCookingNowWrite(cleared, write({ checkedIds: [], activeStepId: "s2", activeStepIndex: 1, now: NOW + 2 })).r1.listed).toBe(true);
    expect(applyLocalCookingNowWrite(cleared, write({ now: NOW + 2, checkedIds: ["i2"] })).r1.listed).toBe(true);
  });

  it("does not count naming a step for the first time, or forgetting its id, as moving to it", () => {
    const opened = applyLocalCookingNowWrite({}, write({ checkedIds: ["gone"], totalCount: 0, activeStepId: null }));
    const named = applyLocalCookingNowWrite(opened, write({ checkedIds: [], totalCount: 0, activeStepId: "s1", now: NOW + 1 }));
    expect(named.r1.listed).toBe(false);
    expect(applyLocalCookingNowWrite(named, write({ checkedIds: ["x"], totalCount: 0, activeStepId: null, now: NOW + 2 })).r1.listed).toBe(false);
    expect(applyLocalCookingNowWrite(named, write({ checkedIds: [], totalCount: 0, activeStepId: "s9", now: NOW + 2 })).r1.listed).toBe(true);
  });

  it("leaves the listing as it was for a change that is neither a check nor a step", () => {
    // Checks of items the recipe no longer has count for nothing.
    const stepped = applyLocalCookingNowWrite({}, write({ checkedIds: ["gone"], totalCount: 0, activeStepIndex: 1, activeStepId: "s2" }));
    expect(applyLocalCookingNowWrite(stepped, write({ checkedIds: ["also-gone"], totalCount: 0, activeStepIndex: 1, activeStepId: "s2" })).r1.listed).toBe(true);
    const opened = applyLocalCookingNowWrite({}, write({ checkedIds: ["gone"], totalCount: 0 }));
    expect(applyLocalCookingNowWrite(opened, write({ checkedIds: ["also-gone"], totalCount: 0 })).r1.listed).toBe(false);
  });

  it("keeps the first all-checked time and clears it on an uncheck", () => {
    const done = applyLocalCookingNowWrite({}, write({ checkedIds: ["a", "b"], totalCount: 2 }));
    const stillDone = applyLocalCookingNowWrite(done, write({ checkedIds: ["b", "a", "c"], totalCount: 2, now: NOW + 5 }));
    expect(stillDone.r1.allCheckedAt).toBe(NOW);
    expect(localCookingNowEntries(stillDone, NOW + 5)[0].expiresAt).toBe(new Date(NOW + COOKING_NOW_DONE_MS).toISOString());
    expect(localCookingNowEntries(stillDone, NOW + 5)[0].allCheckedAt).toBe(new Date(NOW).toISOString());
    expect(applyLocalCookingNowWrite(stillDone, write({ checkedIds: ["a"], totalCount: 2, now: NOW + 6 })).r1.allCheckedAt).toBeNull();
    expect(localCookingNowEntries(stillDone, NOW + COOKING_NOW_DONE_MS)).toEqual([]);
  });

  it("never moves the touch backwards", () => {
    const later = applyLocalCookingNowWrite({}, write({ now: NOW + 10 }));
    expect(applyLocalCookingNowWrite(later, write({ checkedIds: ["i2"], now: NOW })).r1.touchedAt).toBe(NOW + 10);
  });

  it("orders the list newest first, then by recipe, and prunes the expired", () => {
    let rows = applyLocalCookingNowWrite({}, write({ recipe: { id: "b", title: "B", coverImageUrl: null }, now: NOW }));
    rows = applyLocalCookingNowWrite(rows, write({ recipe: { id: "a", title: "A", coverImageUrl: null }, now: NOW }));
    rows = applyLocalCookingNowWrite(rows, write({ recipe: { id: "c", title: "C", coverImageUrl: null }, now: NOW + 1 }));
    expect(localCookingNowEntries(rows, NOW + 1).map((item) => item.recipe.id)).toEqual(["c", "a", "b"]);
    expect(localCookingNowEntries({ b: rows.b, a: rows.a }, NOW).map((item) => item.recipe.id)).toEqual(["a", "b"]);
    expect(localCookingNowEntries({ a: rows.a, b: rows.b }, NOW).map((item) => item.recipe.id)).toEqual(["a", "b"]);

    const pruned = applyLocalCookingNowWrite(rows, write({ recipe: { id: "d", title: "D", coverImageUrl: null }, now: NOW + COOKING_NOW_IDLE_MS }));
    expect(Object.keys(pruned)).toEqual(["c", "d"]);
  });

  it("returns at most fifty recipes", () => {
    let rows = {};
    for (let index = 0; index < 52; index += 1) {
      rows = applyLocalCookingNowWrite(rows, write({ recipe: { id: `r${index}`, title: "R", coverImageUrl: null }, now: NOW + index }));
    }
    expect(localCookingNowEntries(rows, NOW + 60)).toHaveLength(50);
  });
});

describe("the stored signed-out list", () => {
  it("drops anything malformed", () => {
    const good = applyLocalCookingNowWrite({}, write()).r1;
    expect(parseLocalCookingNow(null)).toEqual({});
    expect(parseLocalCookingNow("not json")).toEqual({});
    expect(parseLocalCookingNow("[]")).toEqual({});
    expect(parseLocalCookingNow(JSON.stringify({
      r1: good,
      wrongKey: good,
      noRecipe: { ...good, recipe: null },
      badTitle: { ...good, recipe: { id: "badTitle", title: 3 } },
      badCount: { ...good, recipe: { id: "badCount", title: "x" }, stepCount: "3" },
      list: [],
    }))).toEqual({ r1: good });
  });

  it("reads back an all-checked time", () => {
    const done = applyLocalCookingNowWrite({}, write({ checkedIds: ["a"], totalCount: 1 }));
    expect(parseLocalCookingNow(JSON.stringify(done)).r1.allCheckedAt).toBe(NOW);
  });

  it("fills in optional fields it cannot trust", () => {
    const good = applyLocalCookingNowWrite({}, write()).r1;
    const parsed = parseLocalCookingNow(JSON.stringify({
      r1: { ...good, recipe: { id: "r1", title: "T", coverImageUrl: 5 }, listed: "yes", activeStepId: 4, allCheckedAt: "x", progressKey: 1 },
    }));
    expect(parsed.r1).toMatchObject({ recipe: { coverImageUrl: null }, listed: false, activeStepId: null, allCheckedAt: null, progressKey: "" });
  });

  it("records a write, tells this window, and reads it back", () => {
    const changed = vi.fn();
    window.addEventListener(COOKING_NOW_CHANGED_EVENT, changed);
    try {
      recordLocalCookingNow(write());
      recordLocalCookingNow(write({ now: NOW + 1 }));
      expect(changed).toHaveBeenCalledTimes(1);
      expect(JSON.parse(window.localStorage.getItem(COOKING_NOW_LOCAL_STORAGE_KEY)!).r1.touchedAt).toBe(NOW);
      expect(readLocalCookingNow(NOW).map((item) => item.recipe.id)).toEqual(["r1"]);
    } finally {
      window.removeEventListener(COOKING_NOW_CHANGED_EVENT, changed);
    }
  });

  it("writes nothing for a recipe that was only opened", () => {
    recordLocalCookingNow(write({ checkedIds: [] }));
    const stored = window.localStorage.getItem(COOKING_NOW_LOCAL_STORAGE_KEY);
    expect(JSON.parse(stored!).r1.listed).toBe(false);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    recordLocalCookingNow(write({ checkedIds: [] }));
    expect(setItem).not.toHaveBeenCalled();
  });

  it("reads the current time by default", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    recordLocalCookingNow(write());
    expect(readLocalCookingNow()).toHaveLength(1);
  });

  it("carries on when storage is unavailable", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readLocalCookingNow(NOW)).toEqual([]);
    expect(() => recordLocalCookingNow(write())).not.toThrow();
  });
});
