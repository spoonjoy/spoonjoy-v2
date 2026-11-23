// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { prismaOrganizerStore } from "~/domains/kitchen/adapters/prisma-organizer-store";
import {
  deleteOrganizer,
  listOrganizers,
  mergeOrganizers,
  organizerPage,
  organizersOnRecipe,
  renameOrganizerById,
  setRecipeOrganizers,
  type OrganizerStore,
} from "~/domains/kitchen/application/organizers";
import { cleanupDatabase } from "../../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../../utils";

let db: PrismaClient;
let store: OrganizerStore;

async function cook() {
  return db.user.create({ data: createTestUser() });
}

async function recipeOf(chefId: string) {
  return db.recipe.create({ data: createTestRecipe(chefId) });
}

const names = (organizers: { name: string }[]) => organizers.map((organizer) => organizer.name);

describe("organizers, stored", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    store = prismaOrganizerStore(db);
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("tags a recipe by name, creating each new tag once and reusing the cook's own", async () => {
    const chef = await cook();
    const recipe = await recipeOf(chef.id);
    const first = await setRecipeOrganizers(store, chef.id, recipe.id, "tag", ["Quick", "Vegetarian", "quick"]);
    expect(first.ok && names(first.organizers)).toEqual(["Quick", "Vegetarian"]);
    const other = await recipeOf(chef.id);
    await setRecipeOrganizers(store, chef.id, other.id, "tag", ["vegetarian"]);
    expect(await db.organizer.count({ where: { ownerId: chef.id } })).toBe(2);
    expect(names(await organizersOnRecipe(store, other.id, "tag"))).toEqual(["Vegetarian"]);
  });

  it("lets two saves of the same new tags on one recipe both succeed, with one tag and one link each", async () => {
    const chef = await cook();
    const recipe = await recipeOf(chef.id);
    const results = await Promise.all([
      setRecipeOrganizers(store, chef.id, recipe.id, "tag", ["Cozy", "Quick"]),
      setRecipeOrganizers(store, chef.id, recipe.id, "tag", ["Cozy", "Quick"]),
    ]);
    expect(results.map((result) => result.ok && names(result.organizers))).toEqual([["Cozy", "Quick"], ["Cozy", "Quick"]]);
    expect(await db.organizer.count({ where: { ownerId: chef.id } })).toBe(2);
    expect(names(await organizersOnRecipe(store, recipe.id, "tag"))).toEqual(["Cozy", "Quick"]);
  });

  it("still fails a write that breaks something other than uniqueness", async () => {
    await expect(store.create("no-such-cook", "tag", [{ name: "Orphan", slug: "orphan" }])).rejects.toMatchObject({ code: "P2003" });
  });

  it("replaces a recipe's tags with the new set, and leaves its categories and tools alone", async () => {
    const chef = await cook();
    const recipe = await recipeOf(chef.id);
    await setRecipeOrganizers(store, chef.id, recipe.id, "tag", ["Quick", "Spicy"]);
    await setRecipeOrganizers(store, chef.id, recipe.id, "tool", ["Dutch oven"]);
    await setRecipeOrganizers(store, chef.id, recipe.id, "tag", ["Spicy", "Date night"]);
    expect(names(await organizersOnRecipe(store, recipe.id, "tag"))).toEqual(["Date night", "Spicy"]);
    expect(names(await organizersOnRecipe(store, recipe.id, "tool"))).toEqual(["Dutch oven"]);
  });

  it("refuses to organize a recipe the cook does not own, or one that is deleted", async () => {
    const chef = await cook();
    const stranger = await cook();
    const theirs = await recipeOf(stranger.id);
    expect(await setRecipeOrganizers(store, chef.id, theirs.id, "tag", ["Mine"])).toEqual({ ok: false, error: "not-found" });
    const gone = await db.recipe.create({ data: { ...createTestRecipe(chef.id), deletedAt: new Date() } });
    expect(await setRecipeOrganizers(store, chef.id, gone.id, "tag", ["Mine"])).toEqual({ ok: false, error: "not-found" });
    expect(await db.organizer.count()).toBe(0);
  });

  it("lists a cook's organizers of one kind by name with how many live recipes carry each, unused ones included", async () => {
    const chef = await cook();
    const a = await recipeOf(chef.id);
    const b = await recipeOf(chef.id);
    await setRecipeOrganizers(store, chef.id, a.id, "tag", ["vegetarian", "Quick"]);
    await setRecipeOrganizers(store, chef.id, b.id, "tag", ["Quick", "Unused for now"]);
    await setRecipeOrganizers(store, chef.id, b.id, "tag", ["Quick"]);
    await db.recipe.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
    const listed = await listOrganizers(store, chef.id, "tag");
    expect(listed.map((entry) => [entry.organizer.name, entry.recipeCount])).toEqual([
      ["Quick", 1],
      ["Unused for now", 0],
      ["vegetarian", 0],
    ]);
    expect(await listOrganizers(store, chef.id, "category")).toEqual([]);
  });

  it("renames an organizer, and refuses a name the cook already has with the one to merge into", async () => {
    const chef = await cook();
    const recipe = await recipeOf(chef.id);
    const set = await setRecipeOrganizers(store, chef.id, recipe.id, "tag", ["Quick", "Fast"]);
    if (!set.ok) throw new Error("setup");
    const [quick, fast] = set.organizers.sort((x, y) => x.name.localeCompare(y.name)).reverse();
    expect(await renameOrganizerById(store, chef.id, quick.id, "Speedy")).toMatchObject({ ok: true, organizer: { name: "Speedy", slug: "speedy" } });
    expect((await db.organizer.findUniqueOrThrow({ where: { id: quick.id } })).slug).toBe("speedy");
    expect(await renameOrganizerById(store, chef.id, quick.id, "fast")).toEqual({ ok: false, reason: "taken", conflictId: fast.id });
    expect(await renameOrganizerById(store, chef.id, "missing", "Anything")).toEqual({ ok: false, reason: "not-found" });
  });

  it("does not let one cook rename, merge or delete another cook's organizer", async () => {
    const chef = await cook();
    const stranger = await cook();
    const theirs = await recipeOf(stranger.id);
    const set = await setRecipeOrganizers(store, stranger.id, theirs.id, "tag", ["Theirs", "Also theirs"]);
    if (!set.ok) throw new Error("setup");
    const [one, two] = set.organizers;
    expect(await renameOrganizerById(store, chef.id, one.id, "Mine")).toEqual({ ok: false, reason: "not-found" });
    expect(await mergeOrganizers(store, chef.id, one.id, [two.id])).toEqual({ ok: false, error: "not-found" });
    expect(await deleteOrganizer(store, chef.id, one.id)).toBe(false);
    expect(await db.organizer.count({ where: { ownerId: stranger.id } })).toBe(2);
  });

  it("merges organizers into one, keeping every recipe on the kept one once", async () => {
    const chef = await cook();
    const a = await recipeOf(chef.id);
    const b = await recipeOf(chef.id);
    await setRecipeOrganizers(store, chef.id, a.id, "tag", ["Veggie", "Vegetarian"]);
    await setRecipeOrganizers(store, chef.id, b.id, "tag", ["Meatless"]);
    const tags = await listOrganizers(store, chef.id, "tag");
    const id = (name: string) => tags.find((entry) => entry.organizer.name === name)!.organizer.id;
    expect(await mergeOrganizers(store, chef.id, id("Vegetarian"), [id("Veggie"), id("Meatless")])).toEqual({ ok: true });
    expect((await listOrganizers(store, chef.id, "tag")).map((entry) => [entry.organizer.name, entry.recipeCount])).toEqual([["Vegetarian", 2]]);
  });

  it("refuses to merge organizers of different kinds", async () => {
    const chef = await cook();
    const recipe = await recipeOf(chef.id);
    await setRecipeOrganizers(store, chef.id, recipe.id, "tag", ["Baking"]);
    await setRecipeOrganizers(store, chef.id, recipe.id, "category", ["Baking"]);
    const tag = (await listOrganizers(store, chef.id, "tag"))[0].organizer;
    const category = (await listOrganizers(store, chef.id, "category"))[0].organizer;
    expect(await mergeOrganizers(store, chef.id, tag.id, [category.id])).toEqual({ ok: false, error: "not-found" });
    expect(await mergeOrganizers(store, chef.id, "missing", [category.id])).toEqual({ ok: false, error: "not-found" });
  });

  it("deletes an organizer and takes it off its recipes, leaving the recipes", async () => {
    const chef = await cook();
    const recipe = await recipeOf(chef.id);
    await setRecipeOrganizers(store, chef.id, recipe.id, "tag", ["Gone soon"]);
    const [entry] = await listOrganizers(store, chef.id, "tag");
    expect(await deleteOrganizer(store, chef.id, entry.organizer.id)).toBe(true);
    expect(await organizersOnRecipe(store, recipe.id, "tag")).toEqual([]);
    expect(await db.recipe.count({ where: { id: recipe.id } })).toBe(1);
  });

  it("opens an organizer's page by slug with its live recipes, newest first", async () => {
    const chef = await cook();
    const older = await db.recipe.create({ data: { ...createTestRecipe(chef.id), updatedAt: new Date("2026-01-01") } });
    const newer = await db.recipe.create({ data: { ...createTestRecipe(chef.id), updatedAt: new Date("2026-06-01") } });
    const gone = await recipeOf(chef.id);
    for (const recipe of [older, newer, gone]) await setRecipeOrganizers(store, chef.id, recipe.id, "category", ["Soups"]);
    await db.recipe.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    const page = await organizerPage(store, chef.id, "category", "soups");
    expect(page?.organizer.name).toBe("Soups");
    expect(page?.recipeIds).toEqual([newer.id, older.id]);
    expect(await organizerPage(store, chef.id, "tag", "soups")).toBeNull();
  });
});
