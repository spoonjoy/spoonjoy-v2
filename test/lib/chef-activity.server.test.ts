// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { chefActivity, chefRef } from "~/lib/chef-activity.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

let db: PrismaClient;

describe("chef activity", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("drops what a cook did with another cook's recipe once it is private", async () => {
    const owner = await db.user.create({ data: createTestUser() });
    const cook = await db.user.create({ data: createTestUser() });
    const shown = await db.recipe.create({ data: { title: "Open Soup", chefId: owner.id } });
    const hidden = await db.recipe.create({ data: { title: "Hidden Soup", chefId: owner.id } });
    const cookbook = await db.cookbook.create({ data: { title: "Mine", authorId: cook.id } });
    for (const recipe of [shown, hidden]) {
      await db.recipeSpoon.create({ data: { chefId: cook.id, recipeId: recipe.id, cookedAt: new Date() } });
      await db.recipe.create({ data: { title: `${recipe.title} fork`, chefId: cook.id, sourceRecipeId: recipe.id } });
      await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: cook.id } });
    }
    await db.recipe.update({ where: { id: hidden.id }, data: { visibility: "private" } });

    const rows = await chefActivity(db, cook.id, chefRef(cook));
    const outbound = rows.filter((row) => row.direction === "outbound");
    expect(outbound.map((row) => row.kind).sort()).toEqual(["forked", "saved", "spooned"]);
    expect(outbound.every((row) => row.recipe.id === shown.id)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("Hidden Soup\"");
  });
});
