import { describe, expect, it } from "vitest";
import type { Organizer } from "~/domains/kitchen/model/organizer";
import {
  normalizeSmartCookbookTitle,
  planSmartCookbookRules,
  smartCookbookFilters,
  smartCookbookRepoints,
  SMART_COOKBOOK_TITLE_MAX_LENGTH,
} from "~/domains/kitchen/model/smart-cookbook";
import { ORGANIZER_FILTER_MAX } from "~/domains/kitchen/model/organizer-filter";

const organizer = (id: string, kind: Organizer["kind"], slug: string, ownerId = "cook"): Organizer => ({ id, ownerId, kind, name: slug, slug });

const quick = organizer("o-quick", "tag", "quick");
const soup = organizer("o-soup", "category", "soup");
const mixer = organizer("o-mixer", "tool", "stand-mixer");
const owned = [quick, soup, mixer];

describe("smart cookbook titles", () => {
  it("trims a title and makes runs of spaces one", () => {
    expect(normalizeSmartCookbookTitle("  Quick   soups ")).toBe("Quick soups");
  });

  it("refuses an empty title, one that is too long, and anything that is not text", () => {
    expect(normalizeSmartCookbookTitle("   ")).toBeNull();
    expect(normalizeSmartCookbookTitle("a".repeat(SMART_COOKBOOK_TITLE_MAX_LENGTH + 1))).toBeNull();
    expect(normalizeSmartCookbookTitle("a".repeat(SMART_COOKBOOK_TITLE_MAX_LENGTH))).toHaveLength(SMART_COOKBOOK_TITLE_MAX_LENGTH);
    expect(normalizeSmartCookbookTitle(null)).toBeNull();
  });
});

describe("smart cookbook rules", () => {
  it("keeps each of the cook's own organizers once, on the side it was asked for", () => {
    const plan = planSmartCookbookRules([
      { side: "with", organizerId: "o-quick" },
      { side: "with", organizerId: "o-soup" },
      { side: "with", organizerId: "o-quick" },
      { side: "without", organizerId: "o-mixer" },
    ], owned);
    expect(plan).toEqual({
      ok: true,
      rules: [
        { side: "with", organizerId: "o-quick" },
        { side: "with", organizerId: "o-soup" },
        { side: "without", organizerId: "o-mixer" },
      ],
    });
  });

  it("allows a cookbook of only exclusions: everything but what it leaves out", () => {
    expect(planSmartCookbookRules([{ side: "without", organizerId: "o-mixer" }], owned)).toEqual({
      ok: true,
      rules: [{ side: "without", organizerId: "o-mixer" }],
    });
  });

  it("needs at least one rule", () => {
    expect(planSmartCookbookRules([], owned)).toEqual({ ok: false, reason: "no-rules" });
  });

  it("refuses an organizer that is not the cook's, and a side that is neither with nor without", () => {
    expect(planSmartCookbookRules([{ side: "with", organizerId: "someone-elses" }], owned)).toEqual({ ok: false, reason: "unknown-organizer" });
    expect(planSmartCookbookRules([{ side: "maybe", organizerId: "o-quick" }], owned)).toEqual({ ok: false, reason: "unknown-organizer" });
  });

  it("refuses one organizer on both sides, since no recipe could both have it and not", () => {
    expect(planSmartCookbookRules([
      { side: "with", organizerId: "o-quick" },
      { side: "without", organizerId: "o-quick" },
    ], owned)).toEqual({ ok: false, reason: "both-sides" });
  });

  it("refuses more rules on one side than a search reads", () => {
    const many = Array.from({ length: ORGANIZER_FILTER_MAX + 1 }, (_, index) => organizer(`o-${index}`, "tag", `t-${index}`));
    expect(planSmartCookbookRules(many.map((each) => ({ side: "with", organizerId: each.id })), many)).toEqual({ ok: false, reason: "too-many" });
    expect(planSmartCookbookRules(many.slice(1).map((each) => ({ side: "with", organizerId: each.id })), many).ok).toBe(true);
  });
});

describe("what a smart cookbook fills with", () => {
  it("narrows by each organizer's current slug, so a renamed tag still fills the cookbook", () => {
    const renamed = { ...quick, name: "Speedy", slug: "speedy" };
    expect(smartCookbookFilters(
      [{ side: "with", organizerId: "o-quick" }, { side: "without", organizerId: "o-mixer" }],
      [renamed, soup, mixer],
    )).toEqual({ with: [{ kind: "tag", slug: "speedy" }], without: [{ kind: "tool", slug: "stand-mixer" }] });
  });

  it("fills with nothing when an organizer it needs is gone, rather than with every recipe", () => {
    expect(smartCookbookFilters([{ side: "with", organizerId: "o-quick" }], [soup, mixer])).toBeNull();
  });

  it("drops an exclusion whose organizer is gone, since no recipe carries it any more", () => {
    expect(smartCookbookFilters(
      [{ side: "with", organizerId: "o-soup" }, { side: "without", organizerId: "o-mixer" }],
      [quick, soup],
    )).toEqual({ with: [{ kind: "category", slug: "soup" }], without: [] });
  });
});

describe("smart cookbook rules when organizers merge", () => {
  it("moves a rule on a merged organizer to the one it merged into, on the same side", () => {
    expect(smartCookbookRepoints([{ side: "with", organizerId: "o-fast" }, { side: "without", organizerId: "o-mixer" }], ["o-fast"], "o-quick"))
      .toEqual([{ side: "with", from: "o-fast", to: "o-quick" }]);
  });

  it("drops a merged rule the cookbook already has on either side, and moves only the first of several on one side", () => {
    expect(smartCookbookRepoints(
      [{ side: "with", organizerId: "o-quick" }, { side: "with", organizerId: "o-fast" }, { side: "without", organizerId: "o-speedy" }],
      ["o-fast", "o-speedy"],
      "o-quick",
    )).toEqual([{ side: "with", from: "o-fast", to: null }, { side: "without", from: "o-speedy", to: null }]);
    expect(smartCookbookRepoints(
      [{ side: "without", organizerId: "o-fast" }, { side: "without", organizerId: "o-speedy" }],
      ["o-fast", "o-speedy"],
      "o-quick",
    )).toEqual([{ side: "without", from: "o-fast", to: "o-quick" }, { side: "without", from: "o-speedy", to: null }]);
  });

  it("leaves a cookbook with no merged rules as it is", () => {
    expect(smartCookbookRepoints([{ side: "with", organizerId: "o-soup" }], ["o-fast"], "o-quick")).toEqual([]);
  });
});
