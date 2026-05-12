import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/lib/db.server";
import {
  listFellowChefs,
  listKitchenVisitors,
  countFellowChefs,
  countKitchenVisitors,
} from "~/lib/fellow-chefs.server";
import { createTestUser, createTestRecipe } from "../utils";
import { cleanupDatabase } from "../helpers/cleanup";

async function makeUser() {
  return db.user.create({ data: createTestUser() });
}

async function makeRecipe(chefId: string) {
  return db.recipe.create({ data: { ...createTestRecipe(chefId), chefId } });
}

async function makeCookbook(authorId: string) {
  return db.cookbook.create({
    data: { title: `book-${Math.random().toString(36).slice(2, 10)}`, authorId },
  });
}

async function spoon(
  spoonerId: string,
  recipeId: string,
  cookedAt: Date,
  opts: { deleted?: boolean } = {},
) {
  return db.recipeSpoon.create({
    data: {
      chefId: spoonerId,
      recipeId,
      cookedAt,
      deletedAt: opts.deleted ? new Date() : null,
    },
  });
}

async function fork(forkerId: string, sourceRecipeId: string, createdAt: Date) {
  return db.recipe.create({
    data: {
      ...createTestRecipe(forkerId),
      chefId: forkerId,
      sourceRecipeId,
      createdAt,
    },
  });
}

async function saveToCookbook(
  cookbookId: string,
  recipeId: string,
  addedById: string,
  createdAt: Date,
) {
  return db.recipeInCookbook.create({
    data: { cookbookId, recipeId, addedById, createdAt },
  });
}

describe("fellow-chefs.server", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("listFellowChefs", () => {
    it("returns empty result when viewer has no interactions", async () => {
      const viewer = await makeUser();
      const result = await listFellowChefs(db, viewer.id);
      expect(result).toEqual({ rows: [], total: 0 });
    });

    it("returns one row when viewer has a single spoon on another chef's recipe", async () => {
      const viewer = await makeUser();
      const other = await makeUser();
      const recipe = await makeRecipe(other.id);
      const cookedAt = new Date("2025-06-01T10:00:00Z");
      await spoon(viewer.id, recipe.id, cookedAt);

      const result = await listFellowChefs(db, viewer.id);
      expect(result.total).toBe(1);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].chefId).toBe(other.id);
      expect(result.rows[0].username).toBe(other.username);
      expect(result.rows[0].interactionCounts).toEqual({
        spoons: 1,
        forks: 0,
        cookbookSaves: 0,
      });
      expect(result.rows[0].latestInteractionAt).toBeInstanceOf(Date);
      expect(result.rows[0].latestInteractionAt.toISOString()).toBe(
        cookedAt.toISOString(),
      );
    });

    it("returns one row when viewer has a single fork", async () => {
      const viewer = await makeUser();
      const other = await makeUser();
      const source = await makeRecipe(other.id);
      const at = new Date("2025-07-15T09:00:00Z");
      await fork(viewer.id, source.id, at);
      const result = await listFellowChefs(db, viewer.id);
      expect(result.total).toBe(1);
      expect(result.rows[0].chefId).toBe(other.id);
      expect(result.rows[0].interactionCounts).toEqual({
        spoons: 0,
        forks: 1,
        cookbookSaves: 0,
      });
      expect(result.rows[0].latestInteractionAt.toISOString()).toBe(
        at.toISOString(),
      );
    });

    it("returns one row when viewer has a single cookbook-save", async () => {
      const viewer = await makeUser();
      const other = await makeUser();
      const recipe = await makeRecipe(other.id);
      const cookbook = await makeCookbook(viewer.id);
      const at = new Date("2025-08-01T08:00:00Z");
      await saveToCookbook(cookbook.id, recipe.id, viewer.id, at);

      const result = await listFellowChefs(db, viewer.id);
      expect(result.total).toBe(1);
      expect(result.rows[0].chefId).toBe(other.id);
      expect(result.rows[0].interactionCounts).toEqual({
        spoons: 0,
        forks: 0,
        cookbookSaves: 1,
      });
      expect(result.rows[0].latestInteractionAt.toISOString()).toBe(
        at.toISOString(),
      );
    });

    it("aggregates multiple interaction types on the same other-chef into a single row", async () => {
      const viewer = await makeUser();
      const other = await makeUser();
      const r1 = await makeRecipe(other.id);
      const r2 = await makeRecipe(other.id);
      const r3 = await makeRecipe(other.id);
      const cookbook = await makeCookbook(viewer.id);

      await spoon(viewer.id, r1.id, new Date("2025-01-01T00:00:00Z"));
      await spoon(viewer.id, r1.id, new Date("2025-02-01T00:00:00Z"));
      await fork(viewer.id, r2.id, new Date("2025-03-01T00:00:00Z"));
      await saveToCookbook(
        cookbook.id,
        r3.id,
        viewer.id,
        new Date("2025-04-01T00:00:00Z"),
      );

      const result = await listFellowChefs(db, viewer.id);
      expect(result.total).toBe(1);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].chefId).toBe(other.id);
      expect(result.rows[0].interactionCounts).toEqual({
        spoons: 2,
        forks: 1,
        cookbookSaves: 1,
      });
      expect(result.rows[0].latestInteractionAt.toISOString()).toBe(
        new Date("2025-04-01T00:00:00Z").toISOString(),
      );
    });

    it("aggregates multiple other-chefs into multiple rows, sorted by latestInteractionAt DESC", async () => {
      const viewer = await makeUser();
      const chefA = await makeUser();
      const chefB = await makeUser();
      const chefC = await makeUser();
      const rA = await makeRecipe(chefA.id);
      const rB = await makeRecipe(chefB.id);
      const rC = await makeRecipe(chefC.id);

      await spoon(viewer.id, rA.id, new Date("2025-01-01T00:00:00Z"));
      await spoon(viewer.id, rB.id, new Date("2025-03-01T00:00:00Z"));
      await spoon(viewer.id, rC.id, new Date("2025-02-01T00:00:00Z"));

      const result = await listFellowChefs(db, viewer.id);
      expect(result.total).toBe(3);
      expect(result.rows.map((r) => r.chefId)).toEqual([
        chefB.id,
        chefC.id,
        chefA.id,
      ]);
    });

    it("excludes the viewer themselves from results", async () => {
      const viewer = await makeUser();
      const own = await makeRecipe(viewer.id);
      // viewer spoons their own recipe — must not produce a self row
      await spoon(viewer.id, own.id, new Date("2025-01-01T00:00:00Z"));
      const result = await listFellowChefs(db, viewer.id);
      expect(result.total).toBe(0);
      expect(result.rows).toEqual([]);
    });

    it("excludes soft-deleted spoons", async () => {
      const viewer = await makeUser();
      const other = await makeUser();
      const recipe = await makeRecipe(other.id);
      await spoon(viewer.id, recipe.id, new Date("2025-01-01T00:00:00Z"), {
        deleted: true,
      });
      const result = await listFellowChefs(db, viewer.id);
      expect(result.total).toBe(0);
      expect(result.rows).toEqual([]);
    });

    it("excludes interactions whose target recipe is soft-deleted", async () => {
      const viewer = await makeUser();
      const other = await makeUser();
      const recipe = await makeRecipe(other.id);
      await spoon(viewer.id, recipe.id, new Date("2025-01-01T00:00:00Z"));
      const source = await makeRecipe(other.id);
      await fork(viewer.id, source.id, new Date("2025-02-01T00:00:00Z"));
      const cookbook = await makeCookbook(viewer.id);
      const saved = await makeRecipe(other.id);
      await saveToCookbook(
        cookbook.id,
        saved.id,
        viewer.id,
        new Date("2025-03-01T00:00:00Z"),
      );

      // Soft-delete all three target recipes (and the fork's source)
      const now = new Date();
      await db.recipe.update({
        where: { id: recipe.id },
        data: { deletedAt: now },
      });
      await db.recipe.update({
        where: { id: source.id },
        data: { deletedAt: now },
      });
      await db.recipe.update({
        where: { id: saved.id },
        data: { deletedAt: now },
      });

      const result = await listFellowChefs(db, viewer.id);
      expect(result.total).toBe(0);
      expect(result.rows).toEqual([]);
    });

    it("paginates with limit and offset", async () => {
      const viewer = await makeUser();
      const chefs = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser()]);
      const recipes = await Promise.all(chefs.map((c) => makeRecipe(c.id)));
      for (let i = 0; i < chefs.length; i++) {
        await spoon(viewer.id, recipes[i].id, new Date(2025, 0, i + 1));
      }
      const page1 = await listFellowChefs(db, viewer.id, { limit: 2, offset: 0 });
      expect(page1.rows).toHaveLength(2);
      expect(page1.total).toBe(4);
      const page2 = await listFellowChefs(db, viewer.id, { limit: 2, offset: 2 });
      expect(page2.rows).toHaveLength(2);
      expect(page2.total).toBe(4);
      const ids1 = page1.rows.map((r) => r.chefId);
      const ids2 = page2.rows.map((r) => r.chefId);
      expect(new Set([...ids1, ...ids2]).size).toBe(4);
    });

    it("defaults limit to 50 and clamps over 100", async () => {
      const viewer = await makeUser();
      // No data needed — assertion is on observed limit indirectly via SQL would be heavy;
      // we verify by seeding more than 100 and asserting cap.
      const otherUsers = [] as { id: string }[];
      for (let i = 0; i < 105; i++) {
        const u = await makeUser();
        const r = await makeRecipe(u.id);
        await spoon(viewer.id, r.id, new Date(2025, 0, 1, 0, 0, i));
        otherUsers.push(u);
      }
      const defaulted = await listFellowChefs(db, viewer.id);
      expect(defaulted.rows).toHaveLength(50);
      expect(defaulted.total).toBe(105);
      const clamped = await listFellowChefs(db, viewer.id, { limit: 9999 });
      expect(clamped.rows).toHaveLength(100);
      expect(clamped.total).toBe(105);
    });

    it("returns empty rows when offset is past total but total stays correct", async () => {
      const viewer = await makeUser();
      const other = await makeUser();
      const recipe = await makeRecipe(other.id);
      await spoon(viewer.id, recipe.id, new Date("2025-01-01T00:00:00Z"));
      const result = await listFellowChefs(db, viewer.id, { offset: 500 });
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(1);
    });

    it("breaks ties on latestInteractionAt by chefId DESC (deterministic)", async () => {
      const viewer = await makeUser();
      const chefA = await makeUser();
      const chefB = await makeUser();
      const rA = await makeRecipe(chefA.id);
      const rB = await makeRecipe(chefB.id);
      const sameAt = new Date("2025-05-05T05:05:05Z");
      await spoon(viewer.id, rA.id, sameAt);
      await spoon(viewer.id, rB.id, sameAt);
      const result = await listFellowChefs(db, viewer.id);
      const ids = result.rows.map((r) => r.chefId);
      // descending by id
      expect(ids).toEqual([...ids].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0)));
    });
  });

  describe("listKitchenVisitors", () => {
    it("returns empty when profile owner has no incoming interactions", async () => {
      const owner = await makeUser();
      const result = await listKitchenVisitors(db, owner.id);
      expect(result).toEqual({ rows: [], total: 0 });
    });

    it("returns one row when another chef spooned profile owner's recipe", async () => {
      const owner = await makeUser();
      const visitor = await makeUser();
      const recipe = await makeRecipe(owner.id);
      const cookedAt = new Date("2025-06-01T10:00:00Z");
      await spoon(visitor.id, recipe.id, cookedAt);
      const result = await listKitchenVisitors(db, owner.id);
      expect(result.total).toBe(1);
      expect(result.rows[0].chefId).toBe(visitor.id);
      expect(result.rows[0].interactionCounts).toEqual({
        spoons: 1,
        forks: 0,
        cookbookSaves: 0,
      });
      expect(result.rows[0].latestInteractionAt.toISOString()).toBe(
        cookedAt.toISOString(),
      );
    });

    it("returns one row when another chef forked profile owner's recipe", async () => {
      const owner = await makeUser();
      const visitor = await makeUser();
      const src = await makeRecipe(owner.id);
      const at = new Date("2025-07-01T11:00:00Z");
      await fork(visitor.id, src.id, at);
      const result = await listKitchenVisitors(db, owner.id);
      expect(result.total).toBe(1);
      expect(result.rows[0].chefId).toBe(visitor.id);
      expect(result.rows[0].interactionCounts).toEqual({
        spoons: 0,
        forks: 1,
        cookbookSaves: 0,
      });
    });

    it("returns one row when another chef cookbook-saved profile owner's recipe", async () => {
      const owner = await makeUser();
      const visitor = await makeUser();
      const recipe = await makeRecipe(owner.id);
      const cookbook = await makeCookbook(visitor.id);
      const at = new Date("2025-08-15T00:00:00Z");
      await saveToCookbook(cookbook.id, recipe.id, visitor.id, at);
      const result = await listKitchenVisitors(db, owner.id);
      expect(result.total).toBe(1);
      expect(result.rows[0].chefId).toBe(visitor.id);
      expect(result.rows[0].interactionCounts).toEqual({
        spoons: 0,
        forks: 0,
        cookbookSaves: 1,
      });
    });

    it("aggregates multiple interaction types from the same other-chef", async () => {
      const owner = await makeUser();
      const visitor = await makeUser();
      const r1 = await makeRecipe(owner.id);
      const r2 = await makeRecipe(owner.id);
      const r3 = await makeRecipe(owner.id);
      const cookbook = await makeCookbook(visitor.id);

      await spoon(visitor.id, r1.id, new Date("2025-01-01T00:00:00Z"));
      await fork(visitor.id, r2.id, new Date("2025-02-01T00:00:00Z"));
      await saveToCookbook(
        cookbook.id,
        r3.id,
        visitor.id,
        new Date("2025-03-01T00:00:00Z"),
      );

      const result = await listKitchenVisitors(db, owner.id);
      expect(result.total).toBe(1);
      expect(result.rows[0].chefId).toBe(visitor.id);
      expect(result.rows[0].interactionCounts).toEqual({
        spoons: 1,
        forks: 1,
        cookbookSaves: 1,
      });
      expect(result.rows[0].latestInteractionAt.toISOString()).toBe(
        new Date("2025-03-01T00:00:00Z").toISOString(),
      );
    });

    it("multiple other-chefs sorted by latestInteractionAt DESC", async () => {
      const owner = await makeUser();
      const a = await makeUser();
      const b = await makeUser();
      const c = await makeUser();
      const r = await makeRecipe(owner.id);
      await spoon(a.id, r.id, new Date("2025-01-01T00:00:00Z"));
      await spoon(b.id, r.id, new Date("2025-03-01T00:00:00Z"));
      await spoon(c.id, r.id, new Date("2025-02-01T00:00:00Z"));
      const result = await listKitchenVisitors(db, owner.id);
      expect(result.rows.map((row) => row.chefId)).toEqual([b.id, c.id, a.id]);
    });

    it("excludes profile owner from results", async () => {
      const owner = await makeUser();
      const recipe = await makeRecipe(owner.id);
      // owner spoons their own recipe — must not appear as a visitor
      await spoon(owner.id, recipe.id, new Date("2025-01-01T00:00:00Z"));
      const result = await listKitchenVisitors(db, owner.id);
      expect(result.total).toBe(0);
      expect(result.rows).toEqual([]);
    });

    it("excludes soft-deleted spoons", async () => {
      const owner = await makeUser();
      const visitor = await makeUser();
      const recipe = await makeRecipe(owner.id);
      await spoon(visitor.id, recipe.id, new Date(), { deleted: true });
      const result = await listKitchenVisitors(db, owner.id);
      expect(result.total).toBe(0);
    });

    it("excludes interactions whose target recipe is soft-deleted", async () => {
      const owner = await makeUser();
      const visitor = await makeUser();
      const r1 = await makeRecipe(owner.id);
      await spoon(visitor.id, r1.id, new Date("2025-01-01T00:00:00Z"));
      const src = await makeRecipe(owner.id);
      await fork(visitor.id, src.id, new Date("2025-02-01T00:00:00Z"));
      const r3 = await makeRecipe(owner.id);
      const cookbook = await makeCookbook(visitor.id);
      await saveToCookbook(
        cookbook.id,
        r3.id,
        visitor.id,
        new Date("2025-03-01T00:00:00Z"),
      );
      const now = new Date();
      for (const id of [r1.id, src.id, r3.id]) {
        await db.recipe.update({ where: { id }, data: { deletedAt: now } });
      }
      const result = await listKitchenVisitors(db, owner.id);
      expect(result.total).toBe(0);
    });

    it("paginates identically to listFellowChefs", async () => {
      const owner = await makeUser();
      const recipe = await makeRecipe(owner.id);
      const visitors = await Promise.all([
        makeUser(),
        makeUser(),
        makeUser(),
        makeUser(),
      ]);
      for (let i = 0; i < visitors.length; i++) {
        await spoon(visitors[i].id, recipe.id, new Date(2025, 0, i + 1));
      }
      const page1 = await listKitchenVisitors(db, owner.id, {
        limit: 2,
        offset: 0,
      });
      const page2 = await listKitchenVisitors(db, owner.id, {
        limit: 2,
        offset: 2,
      });
      expect(page1.rows).toHaveLength(2);
      expect(page2.rows).toHaveLength(2);
      expect(page1.total).toBe(4);
      expect(page2.total).toBe(4);
    });

    it("default limit and clamping match listFellowChefs", async () => {
      const owner = await makeUser();
      const recipe = await makeRecipe(owner.id);
      for (let i = 0; i < 105; i++) {
        const v = await makeUser();
        await spoon(v.id, recipe.id, new Date(2025, 0, 1, 0, 0, i));
      }
      const defaulted = await listKitchenVisitors(db, owner.id);
      expect(defaulted.rows).toHaveLength(50);
      expect(defaulted.total).toBe(105);
      const clamped = await listKitchenVisitors(db, owner.id, { limit: 9999 });
      expect(clamped.rows).toHaveLength(100);
    });

    it("offset past total returns empty rows but correct total", async () => {
      const owner = await makeUser();
      const visitor = await makeUser();
      const recipe = await makeRecipe(owner.id);
      await spoon(visitor.id, recipe.id, new Date("2025-01-01T00:00:00Z"));
      const result = await listKitchenVisitors(db, owner.id, { offset: 500 });
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(1);
    });
  });

  describe("countFellowChefs", () => {
    it("returns 0 when viewer has no interactions", async () => {
      const viewer = await makeUser();
      expect(await countFellowChefs(db, viewer.id)).toBe(0);
    });

    it("returns 1 for a single interaction", async () => {
      const viewer = await makeUser();
      const other = await makeUser();
      const recipe = await makeRecipe(other.id);
      await spoon(viewer.id, recipe.id, new Date("2025-01-01T00:00:00Z"));
      expect(await countFellowChefs(db, viewer.id)).toBe(1);
    });

    it("returns 1 for multiple interactions on the same other-chef", async () => {
      const viewer = await makeUser();
      const other = await makeUser();
      const r1 = await makeRecipe(other.id);
      const r2 = await makeRecipe(other.id);
      await spoon(viewer.id, r1.id, new Date("2025-01-01T00:00:00Z"));
      await fork(viewer.id, r2.id, new Date("2025-02-01T00:00:00Z"));
      expect(await countFellowChefs(db, viewer.id)).toBe(1);
    });

    it("returns N for multiple distinct other-chefs", async () => {
      const viewer = await makeUser();
      const others = await Promise.all([makeUser(), makeUser(), makeUser()]);
      for (let i = 0; i < others.length; i++) {
        const r = await makeRecipe(others[i].id);
        await spoon(viewer.id, r.id, new Date(2025, 0, i + 1));
      }
      expect(await countFellowChefs(db, viewer.id)).toBe(3);
    });
  });

  describe("countKitchenVisitors", () => {
    it("returns 0 when no incoming interactions", async () => {
      const owner = await makeUser();
      expect(await countKitchenVisitors(db, owner.id)).toBe(0);
    });

    it("returns 1 for a single incoming interaction", async () => {
      const owner = await makeUser();
      const visitor = await makeUser();
      const recipe = await makeRecipe(owner.id);
      await spoon(visitor.id, recipe.id, new Date("2025-01-01T00:00:00Z"));
      expect(await countKitchenVisitors(db, owner.id)).toBe(1);
    });

    it("returns 1 when same visitor has multiple incoming interactions", async () => {
      const owner = await makeUser();
      const visitor = await makeUser();
      const r1 = await makeRecipe(owner.id);
      const r2 = await makeRecipe(owner.id);
      await spoon(visitor.id, r1.id, new Date("2025-01-01T00:00:00Z"));
      await fork(visitor.id, r2.id, new Date("2025-02-01T00:00:00Z"));
      expect(await countKitchenVisitors(db, owner.id)).toBe(1);
    });

    it("returns N for N distinct visitors", async () => {
      const owner = await makeUser();
      const recipe = await makeRecipe(owner.id);
      const visitors = await Promise.all([makeUser(), makeUser(), makeUser()]);
      for (let i = 0; i < visitors.length; i++) {
        await spoon(visitors[i].id, recipe.id, new Date(2025, 0, i + 1));
      }
      expect(await countKitchenVisitors(db, owner.id)).toBe(3);
    });
  });
});
