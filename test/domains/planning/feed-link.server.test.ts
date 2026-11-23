// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import {
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
import { createTestUser } from "../../utils";

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
