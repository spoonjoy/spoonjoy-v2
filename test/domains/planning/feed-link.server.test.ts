// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import {
  addEntry,
  feedForToken,
  feedLinkMadeAt,
  hashFeedToken,
  makeFeedLink,
  planForFeedToken,
  prismaFeedLinkStore,
  prismaPlanStore,
  revokeFeedLink,
  type FeedLinkStore,
  type PlanStore,
} from "~/domains/planning";
import { cleanupDatabase } from "../../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../../utils";

let db: PrismaClient;
let plans: PlanStore;
let links: FeedLinkStore;

async function cook() {
  return db.user.create({ data: createTestUser() });
}

describe("a calendar feed token", () => {
  it("hashes to the hex SHA-256 of the token", async () => {
    expect(await hashFeedToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("calendar feed links, stored", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    plans = prismaPlanStore(db);
    links = prismaFeedLinkStore(db);
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("makes a link whose token finds the cook's plan, and stores only the token's hash", async () => {
    const chef = await cook();
    const now = new Date("2026-11-23T12:00:00Z");
    const token = await makeFeedLink(plans, links, chef.id, now);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const plan = await plans.planFor(chef.id);
    expect(await planForFeedToken(links, token)).toEqual({ planId: plan.id, ownerId: chef.id });
    expect(await feedLinkMadeAt(plans, links, chef.id)).toEqual(now);
    const stored = await db.calendarFeed.findMany();
    expect(stored).toEqual([{ mealPlanId: plan.id, tokenHash: await hashFeedToken(token), createdAt: now }]);
  });

  it("replaces the old link when the cook makes a new one", async () => {
    const chef = await cook();
    const first = await makeFeedLink(plans, links, chef.id, new Date("2026-11-23T12:00:00Z"));
    const later = new Date("2026-11-24T12:00:00Z");
    const second = await makeFeedLink(plans, links, chef.id, later);

    expect(second).not.toBe(first);
    expect(await planForFeedToken(links, first)).toBeNull();
    expect(await planForFeedToken(links, second)).not.toBeNull();
    expect(await feedLinkMadeAt(plans, links, chef.id)).toEqual(later);
    expect(await db.calendarFeed.count()).toBe(1);
  });

  it("stops a revoked link from finding the plan, and says when there was none to revoke", async () => {
    const chef = await cook();
    const token = await makeFeedLink(plans, links, chef.id);
    expect(await revokeFeedLink(plans, links, chef.id)).toBe(true);
    expect(await planForFeedToken(links, token)).toBeNull();
    expect(await feedLinkMadeAt(plans, links, chef.id)).toBeNull();
    expect(await revokeFeedLink(plans, links, chef.id)).toBe(false);
  });

  it("keeps each cook's link to their own plan", async () => {
    const [a, b] = [await cook(), await cook()];
    const tokenA = await makeFeedLink(plans, links, a.id);
    await makeFeedLink(plans, links, b.id);
    await revokeFeedLink(plans, links, b.id);
    expect((await planForFeedToken(links, tokenA))?.ownerId).toBe(a.id);
  });

  it("finds nothing for a token of the wrong shape, without looking it up", async () => {
    const lookups: string[] = [];
    const counting: FeedLinkStore = { ...links, planForLink: async (hash) => { lookups.push(hash); return links.planForLink(hash); } };
    for (const token of ["", "short", "a".repeat(44), `${"a".repeat(42)}=`, `${"a".repeat(42)}/`]) {
      expect(await planForFeedToken(counting, token)).toBeNull();
    }
    expect(lookups).toEqual([]);
    expect(await planForFeedToken(counting, "a".repeat(43))).toBeNull();
    expect(lookups).toHaveLength(1);
  });
});

describe("the calendar feed behind a link", () => {
  const now = new Date("2026-11-23T20:00:00Z");
  const origin = "https://spoonjoy.test";

  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    plans = prismaPlanStore(db);
    links = prismaFeedLinkStore(db);
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  async function plannedCook() {
    const chef = await cook();
    const recipe = await db.recipe.create({ data: { ...createTestRecipe(chef.id), title: "Miso soup", servings: "4", description: "Warm." } });
    const plan = await plans.planFor(chef.id);
    await db.mealPlan.update({ where: { id: plan.id }, data: { timeZone: "America/Los_Angeles" } });
    const plan2 = (date: string, id: string, input: Record<string, unknown>) => addEntry(plans, chef.id, id, { date, mealType: "dinner", ...input });
    await plan2("2026-11-23", "e-soup", { kind: "recipe", recipeId: recipe.id, scaleFactor: 2 });
    await plan2("2026-11-24", "e-out", { kind: "note", title: "Eating out" });
    await plan2("2026-10-25", "e-too-old", { kind: "note", title: "Long ago" });
    await plan2("2026-10-26", "e-oldest", { kind: "note", title: "Four weeks back" });
    await plan2("2027-02-21", "e-furthest", { kind: "note", title: "Thirteen weeks on" });
    await plan2("2027-02-22", "e-too-far", { kind: "note", title: "Too far" });
    await plan2("2026-11-25", "e-gone", { kind: "note", title: "Removed" });
    await db.planEntry.update({ where: { id: "e-gone" }, data: { deletedAt: now } });
    return { chef, token: await makeFeedLink(plans, links, chef.id, now) };
  }

  it("finds nothing for a link that doesn't exist", async () => {
    expect(await feedForToken(plans, links, { token: "a".repeat(43), params: new URLSearchParams(), origin, now })).toBeNull();
  });

  it("gives the owner and the plan's live entries from four weeks back to thirteen weeks on, with each recipe's servings", async () => {
    const { chef, token } = await plannedCook();
    const feed = await feedForToken(plans, links, { token, params: new URLSearchParams({ summary: "${title} for ${servings}" }), origin, now });
    expect(feed?.ownerId).toBe(chef.id);
    const uids = [...(feed?.calendar ?? "").matchAll(/UID:plan-entry-([^@]+)@spoonjoy\.test/g)].map((match) => match[1]).sort();
    expect(uids).toEqual(["e-furthest", "e-oldest", "e-out", "e-soup"]);
    expect(feed?.calendar).toContain("SUMMARY:Miso soup for 8\r\n");
    expect(feed?.calendar).toContain("X-WR-CALNAME:Spoonjoy meal plan\r\n");
    expect(feed?.entries).toBe(4);
  });

  it("times meals in the plan's own time zone unless the link asks for another", async () => {
    const { token } = await plannedCook();
    const planZone = await feedForToken(plans, links, { token, params: new URLSearchParams({ dinner: "18:30" }), origin, now });
    expect(planZone?.calendar).toContain("DTSTART:20261124T023000Z\r\n");
    const asked = await feedForToken(plans, links, { token, params: new URLSearchParams({ dinner: "18:30", tz: "UTC" }), origin, now });
    expect(asked?.calendar).toContain("DTSTART:20261123T183000Z\r\n");
  });
});
