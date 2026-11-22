import { describe, expect, it } from "vitest";
import {
  ROADMAP,
  ROADMAP_STATUSES,
  roadmapByStatus,
  type RoadmapItem,
} from "~/content/roadmap";

const text = (item: RoadmapItem) => [item.id, item.title, item.benefit, item.area, item.link?.href ?? "", item.link?.label ?? ""].join(" ");

describe("the public roadmap", () => {
  it("lists its four groups in reading order", () => {
    expect(ROADMAP_STATUSES.map((status) => status.id)).toEqual(["shipped", "building", "next", "later"]);
    expect(ROADMAP_STATUSES.map((status) => status.title)).toEqual(["Shipped", "Building now", "Next", "Later"]);
  });

  it("gives every item a unique id, a title and a one-line benefit", () => {
    const ids = ROADMAP.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of ROADMAP) {
      expect(item.id, item.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(item.title.trim(), item.id).not.toBe("");
      expect(item.benefit, item.id).toMatch(/^[A-Z].*\.$/);
      expect(item.benefit, item.id).not.toMatch(/\n/);
      expect(item.benefit.length, item.id).toBeLessThanOrEqual(160);
    }
  });

  it("puts something in every group", () => {
    for (const status of ROADMAP_STATUSES) {
      expect(roadmapByStatus(status.id).length, status.id).toBeGreaterThan(0);
    }
  });

  it("dates only shipped items, with a real calendar date", () => {
    for (const item of ROADMAP) {
      if (item.shipped === undefined) continue;
      expect(item.status, item.id).toBe("shipped");
      expect(item.shipped, item.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${item.shipped}T00:00:00Z`).toISOString().slice(0, 10), item.id).toBe(item.shipped);
    }
  });

  it("links only to Spoonjoy pages or the App Store", () => {
    for (const item of ROADMAP) {
      if (!item.link) continue;
      expect(item.link.href, item.id).toMatch(/^(\/[a-z0-9/-]*|https:\/\/apps\.apple\.com\/.+)$/);
      expect(item.link.label.trim(), item.id).not.toBe("");
    }
  });

  it("covers every outcome on the roadmap, in plain words", () => {
    const ids = ROADMAP.map((item) => item.id);
    for (const id of [
      "move-in",
      "meal-planner",
      "households",
      "organizers",
      "smart-cookbooks",
      "unit-conversion",
      "nutrition",
      "swaps",
      "pantry",
      "import-anything",
      "webhooks",
      "home-assistant",
      "languages",
      "self-hosting",
      "recipes-travel",
      "federation",
    ]) {
      expect(ids, id).toContain(id);
    }
  });

  it("names no other recipe app", () => {
    for (const item of ROADMAP) {
      expect(text(item), item.id).not.toMatch(/mealie|paprika|tandoor|nextcloud|plan to eat|recipe keeper|copy me that/i);
    }
  });

  it("says moving in works from other recipe apps", () => {
    const moveIn = ROADMAP.find((item) => item.id === "move-in");
    expect(moveIn?.title).toMatch(/other recipe apps/);
  });

  it("groups items by status, keeping the file's order", () => {
    const shipped = roadmapByStatus("shipped");
    expect(shipped.every((item) => item.status === "shipped")).toBe(true);
    expect(shipped).toEqual(ROADMAP.filter((item) => item.status === "shipped"));
  });
});
