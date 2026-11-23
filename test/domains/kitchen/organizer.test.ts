import { describe, expect, it } from "vitest";
import { FLAGS, isFlagOn } from "~/domains/platform";
import {
  ORGANIZER_KINDS,
  ORGANIZER_NAME_MAX_LENGTH,
  mergeOrganizerLinks,
  normalizeOrganizerName,
  organizerSlug,
  parseOrganizerKind,
  planOrganizerAssignment,
  renameOrganizer,
  type Organizer,
} from "~/domains/kitchen/model/organizer";

const tag = (id: string, name: string): Organizer => ({ id, ownerId: "chef-1", kind: "tag", name, slug: organizerSlug(name) });

describe("organizer kinds", () => {
  it("are tags, categories and tools", () => {
    expect(ORGANIZER_KINDS).toEqual(["tag", "category", "tool"]);
  });

  it("read from input in any case, and refuse anything else", () => {
    expect(parseOrganizerKind(" Tag ")).toBe("tag");
    expect(parseOrganizerKind("CATEGORY")).toBe("category");
    expect(parseOrganizerKind("tool")).toBe("tool");
    expect(parseOrganizerKind("label")).toBeNull();
    expect(parseOrganizerKind(3)).toBeNull();
    expect(parseOrganizerKind(undefined)).toBeNull();
  });
});

describe("organizer names", () => {
  it("trim and collapse spaces", () => {
    expect(normalizeOrganizerName("  Weeknight \n  dinners ")).toBe("Weeknight dinners");
  });

  it("refuse an empty name, a name of only spaces and a value that is not text", () => {
    expect(normalizeOrganizerName("")).toBeNull();
    expect(normalizeOrganizerName("   ")).toBeNull();
    expect(normalizeOrganizerName(null)).toBeNull();
    expect(normalizeOrganizerName(42)).toBeNull();
  });

  it("allow up to the longest name, and refuse one longer", () => {
    expect(normalizeOrganizerName("a".repeat(ORGANIZER_NAME_MAX_LENGTH))).toHaveLength(ORGANIZER_NAME_MAX_LENGTH);
    expect(normalizeOrganizerName("a".repeat(ORGANIZER_NAME_MAX_LENGTH + 1))).toBeNull();
  });
});

describe("organizer slugs", () => {
  it("lowercase words joined by dashes, without accents or punctuation", () => {
    expect(organizerSlug("Weeknight Dinners")).toBe("weeknight-dinners");
    expect(organizerSlug("Crème brûlée & Co.")).toBe("creme-brulee-co");
    expect(organizerSlug("--Dutch   oven--")).toBe("dutch-oven");
  });

  it("keep letters and digits from any script", () => {
    expect(organizerSlug("Ужин 2")).toBe("ужин-2");
    expect(organizerSlug("和食")).toBe("和食");
  });

  it("spell out a name with no letters or digits, so it still has a slug of its own", () => {
    expect(organizerSlug("🌶️")).toBe("u1f336-fe0f");
    expect(organizerSlug("🌶️")).not.toBe(organizerSlug("🔥"));
  });
});

describe("assigning organizers by name", () => {
  const existing = [tag("t1", "Vegetarian"), tag("t2", "Quick")];

  it("reuses an organizer the cook already has when the slug matches, whatever the case", () => {
    expect(planOrganizerAssignment(existing, ["vegetarian", " QUICK "])).toEqual({ reuse: ["t1", "t2"], create: [] });
  });

  it("creates the ones the cook does not have yet, once each", () => {
    expect(planOrganizerAssignment(existing, ["Spicy", "spicy", "Vegetarian", "Date night"])).toEqual({
      reuse: ["t1"],
      create: [
        { name: "Spicy", slug: "spicy" },
        { name: "Date night", slug: "date-night" },
      ],
    });
  });

  it("skips names that are empty or too long", () => {
    expect(planOrganizerAssignment(existing, ["", "  ", "x".repeat(ORGANIZER_NAME_MAX_LENGTH + 1)])).toEqual({ reuse: [], create: [] });
  });

  it("names an existing organizer once even when two names reach it", () => {
    expect(planOrganizerAssignment(existing, ["Quick", "quick!"])).toEqual({ reuse: ["t2"], create: [] });
  });
});

describe("renaming an organizer", () => {
  const siblings = [tag("t1", "Vegetarian"), tag("t2", "Quick")];

  it("gives it the new name and slug", () => {
    expect(renameOrganizer(siblings[1], " Fast  ", siblings)).toEqual({
      ok: true,
      organizer: { ...siblings[1], name: "Fast", slug: "fast" },
    });
  });

  it("allows changing only the case of its own name", () => {
    expect(renameOrganizer(siblings[1], "QUICK", siblings)).toEqual({
      ok: true,
      organizer: { ...siblings[1], name: "QUICK", slug: "quick" },
    });
  });

  it("refuses a name another organizer of the cook already has, and says which one to merge into", () => {
    expect(renameOrganizer(siblings[1], "vegetarian", siblings)).toEqual({ ok: false, reason: "taken", conflictId: "t1" });
  });

  it("refuses an empty or too long name", () => {
    expect(renameOrganizer(siblings[1], "  ", siblings)).toEqual({ ok: false, reason: "invalid-name" });
  });
});

describe("merging organizers", () => {
  it("moves every recipe from the merged organizers onto the one kept, once each", () => {
    const links = [
      { recipeId: "r1", organizerId: "a" },
      { recipeId: "r1", organizerId: "keep" },
      { recipeId: "r2", organizerId: "b" },
      { recipeId: "r2", organizerId: "a" },
      { recipeId: "r3", organizerId: "other" },
    ];
    expect(mergeOrganizerLinks(links, ["a", "b"], "keep")).toEqual({
      remove: [
        { recipeId: "r1", organizerId: "a" },
        { recipeId: "r2", organizerId: "b" },
        { recipeId: "r2", organizerId: "a" },
      ],
      add: [{ recipeId: "r2", organizerId: "keep" }],
    });
  });

  it("ignores the kept organizer when it is listed among the merged ones", () => {
    const links = [{ recipeId: "r1", organizerId: "keep" }];
    expect(mergeOrganizerLinks(links, ["keep"], "keep")).toEqual({ remove: [], add: [] });
  });
});

describe("organizers flag", () => {
  it("hides organizers behind organizers, off in production and on in QA", () => {
    expect(FLAGS.organizers.description).toMatch(/tags, categories and tools/i);
    expect(isFlagOn("organizers", {}, "chef-1")).toBe(false);
    expect(isFlagOn("organizers", { SPOONJOY_FLAGS: "all" }, "chef-1")).toBe(true);
  });
});
