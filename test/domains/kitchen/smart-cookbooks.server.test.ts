// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { prismaOrganizerStore } from "~/domains/kitchen/adapters/prisma-organizer-store";
import { prismaSmartCookbookStore } from "~/domains/kitchen/adapters/prisma-smart-cookbook-store";
import { deleteOrganizer, mergeOrganizers, renameOrganizerById, setRecipeOrganizers, type OrganizerStore } from "~/domains/kitchen/application/organizers";
import {
  changeSmartCookbookRules,
  createSmartCookbook,
  deleteSmartCookbook,
  listSmartCookbooks,
  renameSmartCookbook,
  repointSmartCookbooks,
  smartCookbookFill,
  type SmartCookbookStore,
} from "~/domains/kitchen/application/smart-cookbooks";
import { cleanupDatabase } from "../../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../../utils";

let db: PrismaClient;
let organizers: OrganizerStore;
let store: SmartCookbookStore;

async function cook() {
  return db.user.create({ data: createTestUser() });
}

/** A cook with a recipe tagged Quick, in the Soup category, made with a Stand mixer; returns their organizers' ids. */
async function organizedCook() {
  const chef = await cook();
  const recipe = await db.recipe.create({ data: createTestRecipe(chef.id) });
  const tag = await setRecipeOrganizers(organizers, chef.id, recipe.id, "tag", ["Quick"]);
  const category = await setRecipeOrganizers(organizers, chef.id, recipe.id, "category", ["Soup"]);
  const tool = await setRecipeOrganizers(organizers, chef.id, recipe.id, "tool", ["Stand mixer"]);
  if (!tag.ok || !category.ok || !tool.ok) throw new Error("organizers not set");
  return { chef, quick: tag.organizers[0]!.id, soup: category.organizers[0]!.id, mixer: tool.organizers[0]!.id };
}

describe("smart cookbooks, stored", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    organizers = prismaOrganizerStore(db);
    store = prismaSmartCookbookStore(db);
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("makes a cookbook from the cook's own organizers, keeps its rules in order and fills it by their slugs", async () => {
    const { chef, quick, soup, mixer } = await organizedCook();
    const made = await createSmartCookbook(store, organizers, chef.id, {
      title: " Quick  soups ",
      rules: [{ side: "with", organizerId: soup }, { side: "with", organizerId: quick }, { side: "without", organizerId: mixer }],
    });
    expect(made.ok && made.cookbook.title).toBe("Quick soups");
    if (!made.ok) return;
    const fill = await smartCookbookFill(store, organizers, chef.id, made.cookbook.id);
    expect(fill?.cookbook.rules).toEqual([
      { side: "with", organizerId: soup },
      { side: "with", organizerId: quick },
      { side: "without", organizerId: mixer },
    ]);
    expect(fill?.filters).toEqual({
      with: [{ kind: "category", slug: "soup" }, { kind: "tag", slug: "quick" }],
      without: [{ kind: "tool", slug: "stand-mixer" }],
    });
    expect((await listSmartCookbooks(store, chef.id)).map((cookbook) => cookbook.title)).toEqual(["Quick soups"]);
  });

  it("lists a cook's smart cookbooks by title, ignoring case", async () => {
    const { chef, quick } = await organizedCook();
    const rules = [{ side: "with", organizerId: quick }];
    for (const title of ["soups", "Breads", "apples"]) await createSmartCookbook(store, organizers, chef.id, { title, rules });
    expect((await listSmartCookbooks(store, chef.id)).map((cookbook) => cookbook.title)).toEqual(["apples", "Breads", "soups"]);
  });

  it("passes on a failure that is not a taken title, and takes back a cookbook whose rules could not all be stored", async () => {
    const { chef, quick } = await organizedCook();
    const boom = new Error("database is gone");
    const failingCookbook = prismaSmartCookbookStore({
      smartCookbook: { ...db.smartCookbook, create: () => Promise.reject(boom) },
      smartCookbookRule: db.smartCookbookRule,
    } as unknown as PrismaClient);
    await expect(failingCookbook.create(chef.id, "Quick", [{ side: "with", organizerId: quick }])).rejects.toBe(boom);

    const failingRule = prismaSmartCookbookStore({
      smartCookbook: db.smartCookbook,
      smartCookbookRule: { create: () => Promise.reject(boom) },
    } as unknown as PrismaClient);
    await expect(failingRule.create(chef.id, "Quick", [{ side: "with", organizerId: quick }])).rejects.toBe(boom);
    expect(await db.smartCookbook.count()).toBe(0);

    const failingRename = prismaSmartCookbookStore({
      smartCookbook: { ...db.smartCookbook, update: () => Promise.reject(boom) },
      smartCookbookRule: db.smartCookbookRule,
    } as unknown as PrismaClient);
    await expect(failingRename.rename("any", "Quick")).rejects.toBe(boom);
  });

  it("refuses a title the cook already uses, an empty title, and rules that are not the cook's", async () => {
    const { chef, quick } = await organizedCook();
    const other = await organizedCook();
    const rules = [{ side: "with", organizerId: quick }];
    expect((await createSmartCookbook(store, organizers, chef.id, { title: "Quick", rules })).ok).toBe(true);
    expect(await createSmartCookbook(store, organizers, chef.id, { title: "Quick", rules })).toEqual({ ok: false, reason: "taken" });
    expect(await createSmartCookbook(store, organizers, chef.id, { title: " ", rules })).toEqual({ ok: false, reason: "invalid-title" });
    expect(await createSmartCookbook(store, organizers, chef.id, { title: "Theirs", rules: [{ side: "with", organizerId: other.quick }] }))
      .toEqual({ ok: false, reason: "unknown-organizer" });
    // Another cook may use the same title.
    expect((await createSmartCookbook(store, organizers, other.chef.id, { title: "Quick", rules: [{ side: "with", organizerId: other.quick }] })).ok).toBe(true);
    expect(await db.smartCookbookRule.count()).toBe(2);
  });

  it("is only its cook's to fill", async () => {
    const { chef, quick } = await organizedCook();
    const other = await cook();
    const made = await createSmartCookbook(store, organizers, chef.id, { title: "Quick", rules: [{ side: "with", organizerId: quick }] });
    if (!made.ok) throw new Error("not made");
    expect(await smartCookbookFill(store, organizers, other.id, made.cookbook.id)).toBeNull();
    expect(await smartCookbookFill(store, organizers, chef.id, "no-such-cookbook")).toBeNull();
  });

  it("renames a cook's cookbook, refusing a title they already use, an empty one, and another cook's cookbook", async () => {
    const { chef, quick } = await organizedCook();
    const other = await cook();
    const rules = [{ side: "with", organizerId: quick }];
    const soups = await createSmartCookbook(store, organizers, chef.id, { title: "Soups", rules });
    await createSmartCookbook(store, organizers, chef.id, { title: "Salads", rules });
    if (!soups.ok) throw new Error("not made");
    const id = soups.cookbook.id;
    expect(await renameSmartCookbook(store, chef.id, id, " Hot  soups ")).toEqual({ ok: true, title: "Hot soups" });
    expect(await renameSmartCookbook(store, chef.id, id, "Salads")).toEqual({ ok: false, reason: "taken" });
    expect(await renameSmartCookbook(store, chef.id, id, "")).toEqual({ ok: false, reason: "invalid-title" });
    expect(await renameSmartCookbook(store, other.id, id, "Mine")).toEqual({ ok: false, reason: "not-found" });
    expect((await store.find(id))?.title).toBe("Hot soups");
  });

  it("changes a cook's cookbook's rules in the order asked, refusing none, ones not theirs, and another cook's cookbook", async () => {
    const { chef, quick, soup, mixer } = await organizedCook();
    const other = await organizedCook();
    const made = await createSmartCookbook(store, organizers, chef.id, { title: "Quick", rules: [{ side: "with", organizerId: quick }] });
    if (!made.ok) throw new Error("not made");
    const id = made.cookbook.id;
    const rules = [{ side: "with", organizerId: soup }, { side: "without", organizerId: mixer }, { side: "with", organizerId: soup }];

    expect(await changeSmartCookbookRules(store, organizers, chef.id, id, rules)).toEqual({ ok: true });
    expect((await store.find(id))?.rules).toEqual([{ side: "with", organizerId: soup }, { side: "without", organizerId: mixer }]);

    expect(await changeSmartCookbookRules(store, organizers, chef.id, id, [])).toEqual({ ok: false, reason: "no-rules" });
    expect(await changeSmartCookbookRules(store, organizers, chef.id, id, [{ side: "with", organizerId: other.quick }]))
      .toEqual({ ok: false, reason: "unknown-organizer" });
    expect(await changeSmartCookbookRules(store, organizers, other.chef.id, id, [{ side: "with", organizerId: other.quick }]))
      .toEqual({ ok: false, reason: "not-found" });
    expect((await store.find(id))?.rules).toHaveLength(2);
  });

  it("puts a cookbook's old rules back when its new ones can't all be stored", async () => {
    const { chef, quick, soup } = await organizedCook();
    const made = await createSmartCookbook(store, organizers, chef.id, { title: "Quick", rules: [{ side: "with", organizerId: quick }] });
    if (!made.ok) throw new Error("not made");
    const boom = new Error("database is gone");
    // The first new rule fails; putting the old ones back goes through.
    let calls = 0;
    const failing = prismaSmartCookbookStore({
      smartCookbook: db.smartCookbook,
      smartCookbookRule: {
        ...db.smartCookbookRule,
        create: (args: Parameters<typeof db.smartCookbookRule.create>[0]) => (calls++ === 0 ? Promise.reject(boom) : db.smartCookbookRule.create(args)),
      },
    } as unknown as PrismaClient);
    await expect(failing.replaceRules(made.cookbook.id, [{ side: "with", organizerId: soup }])).rejects.toBe(boom);
    expect((await store.find(made.cookbook.id))?.rules).toEqual([{ side: "with", organizerId: quick }]);
  });

  it("deletes a cook's cookbook and its rules, and only theirs", async () => {
    const { chef, quick } = await organizedCook();
    const other = await cook();
    const made = await createSmartCookbook(store, organizers, chef.id, { title: "Quick", rules: [{ side: "with", organizerId: quick }] });
    if (!made.ok) throw new Error("not made");
    expect(await deleteSmartCookbook(store, other.id, made.cookbook.id)).toBe(false);
    expect(await deleteSmartCookbook(store, chef.id, made.cookbook.id)).toBe(true);
    expect(await deleteSmartCookbook(store, chef.id, made.cookbook.id)).toBe(false);
    expect([await db.smartCookbook.count(), await db.smartCookbookRule.count()]).toEqual([0, 0]);
  });

  it("moves its rules to the tag another merged into, keeping their place, and drops one it already has", async () => {
    const { chef, quick, soup, mixer } = await organizedCook();
    const recipe = await db.recipe.create({ data: createTestRecipe(chef.id) });
    const fast = await setRecipeOrganizers(organizers, chef.id, recipe.id, "tag", ["Fast", "Speedy"]);
    if (!fast.ok) throw new Error("organizers not set");
    const [fastId, speedyId] = fast.organizers.map((organizer) => organizer.id);
    const moved = await createSmartCookbook(store, organizers, chef.id, {
      title: "Fast soups",
      rules: [{ side: "with", organizerId: fastId }, { side: "with", organizerId: soup }, { side: "without", organizerId: mixer }],
    });
    const dropped = await createSmartCookbook(store, organizers, chef.id, {
      title: "Quick but not speedy",
      rules: [{ side: "with", organizerId: quick }, { side: "without", organizerId: speedyId }],
    });
    if (!moved.ok || !dropped.ok) throw new Error("not made");

    await mergeOrganizers(organizers, chef.id, quick, [fastId!, speedyId!]);
    await repointSmartCookbooks(store, chef.id, [fastId!, speedyId!], quick);

    expect((await store.find(moved.cookbook.id))?.rules).toEqual([
      { side: "with", organizerId: quick },
      { side: "with", organizerId: soup },
      { side: "without", organizerId: mixer },
    ]);
    expect((await store.find(dropped.cookbook.id))?.rules).toEqual([{ side: "with", organizerId: quick }]);
  });

  it("keeps filling after a tag is renamed, and fills with nothing once a tag it needs is deleted", async () => {
    const { chef, quick } = await organizedCook();
    const made = await createSmartCookbook(store, organizers, chef.id, { title: "Quick", rules: [{ side: "with", organizerId: quick }] });
    if (!made.ok) throw new Error("not made");
    await renameOrganizerById(organizers, chef.id, quick, "Speedy");
    expect((await smartCookbookFill(store, organizers, chef.id, made.cookbook.id))?.filters).toEqual({ with: [{ kind: "tag", slug: "speedy" }], without: [] });
    await deleteOrganizer(organizers, chef.id, quick);
    expect((await smartCookbookFill(store, organizers, chef.id, made.cookbook.id))?.filters).toBeNull();
  });
});
