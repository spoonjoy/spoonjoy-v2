// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { getLocalDb } from "~/lib/db.server";
import {
  activateRecipeCoverOnD1,
  archiveRecipeCover,
  archiveRecipeCoverOnD1,
  clearActiveRecipeCover,
  setActiveRecipeCover,
} from "~/lib/recipe-cover.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// Cover activation, clearing and archiving with a D1 binding: each writes in one D1 batch
// (through the SQLite-backed fake binding), after at most one D1 read, ends the same as the
// Prisma path and re-checks what it read, so a cover changed in between gives the error the
// checks would give.

let db: PrismaClient;
let d1: SqliteD1;
let chefId: string;

const OLD = new Date("2026-01-01T00:00:00.000Z");

async function seed(title: string) {
  const recipe = await db.recipe.create({ data: { title, chefId } });
  const covers = [];
  for (const [index, stylized] of [[0, null], [1, "https://example.com/s1.jpg"], [2, null]] as const) {
    covers.push(await db.recipeCover.create({
      data: { recipeId: recipe.id, imageUrl: `https://example.com/${index}.jpg`, stylizedImageUrl: stylized, sourceType: "chef-upload" },
    }));
  }
  await db.recipe.update({
    where: { id: recipe.id },
    data: { activeCoverId: covers[0]!.id, activeCoverVariant: "image", coverMode: "manual", updatedAt: OLD },
  });
  const cookbook = await db.cookbook.create({ data: { title: `Book ${title}`, authorId: chefId } });
  await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: chefId } });
  await db.cookbook.update({ where: { id: cookbook.id }, data: { updatedAt: OLD } });
  return { recipe, covers, cookbook };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

async function state({ recipe, covers, cookbook }: Seeded) {
  const current = await db.recipe.findUniqueOrThrow({ where: { id: recipe.id } });
  const rows = await db.recipeCover.findMany({ where: { recipeId: recipe.id } });
  return {
    active: covers.findIndex((cover) => cover.id === current.activeCoverId),
    activeCoverVariant: current.activeCoverVariant,
    coverMode: current.coverMode,
    touched: current.updatedAt.getTime() > OLD.getTime(),
    cookbookTouched: (await db.cookbook.findUniqueOrThrow({ where: { id: cookbook.id } })).updatedAt.getTime() > OLD.getTime(),
    covers: covers.map((cover) => {
      const row = rows.find((candidate) => candidate.id === cover.id)!;
      return { status: row.status, archived: row.archivedAt !== null };
    }),
  };
}

/**
 * Runs `write` through Prisma on one recipe and through D1 on its twin; both must match. On D1
 * it makes `roundTrips` batches: the write, and before it the read when there is one.
 */
async function expectParity(write: (seeded: Seeded, d1: D1ReadDatabase | null) => Promise<unknown>, roundTrips = 2) {
  const viaPrisma = await seed(`Prisma ${crypto.randomUUID()}`);
  const viaD1 = await seed(`D1 ${crypto.randomUUID()}`);
  const prismaResult = await write(viaPrisma, null);
  const before = d1.roundTrips();
  const d1Result = await write(viaD1, d1.binding);
  expect(d1.roundTrips() - before).toBe(roundTrips);
  expect(await state(viaD1)).toEqual(await state(viaPrisma));
  return { prismaResult, d1Result, viaD1 };
}

/**
 * The fake binding, with `before` run between the read and the first write batch (or every
 * write batch), as another request would change the rows. A write batch is one that
 * prepared anything but a SELECT.
 */
function racing(before: () => Promise<unknown>, everyBatch = false): D1ReadDatabase {
  let pending = true;
  let writing = false;
  return {
    prepare: (sql) => {
      if (!/^\s*SELECT\b/i.test(sql)) writing = true;
      return d1.binding.prepare(sql);
    },
    async batch(statements) {
      const isWrite = writing;
      writing = false;
      if (isWrite && (pending || everyBatch)) {
        pending = false;
        await before();
      }
      return d1.binding.batch(statements as never);
    },
  };
}

describe("recipe covers on a D1 binding", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
    chefId = (await db.user.create({ data: createTestUser() })).id;
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("activates a cover and touches the cookbooks in one write, as the Prisma path does", async () => {
    const { d1Result, viaD1 } = await expectParity(({ recipe, covers }, binding) =>
      setActiveRecipeCover(db, { recipeId: recipe.id, coverId: covers[1]!.id, variant: "stylized" }, binding));
    expect(d1Result).toMatchObject({ id: viaD1.recipe.id, activeCoverId: viaD1.covers[1]!.id, activeCoverVariant: "stylized" });
  });

  it("clears the cover in one batch, as the Prisma path does", async () => {
    const { d1Result } = await expectParity(({ recipe }, binding) => clearActiveRecipeCover(db, recipe.id, binding), 1);
    expect(d1Result).toMatchObject({ activeCoverId: null, coverMode: "none" });
  });

  it.each([
    ["an inactive cover", (seeded: Seeded) => ({ coverId: seeded.covers[2]!.id })],
    ["the active cover, leaving no cover", (seeded: Seeded) => ({ coverId: seeded.covers[0]!.id, confirmNoCover: true })],
    ["the active cover, with a replacement", (seeded: Seeded) => ({
      coverId: seeded.covers[0]!.id, replacementCoverId: seeded.covers[1]!.id, replacementVariant: "stylized" as const,
    })],
  ])("archives %s in one write, as the Prisma path does", async (_label, input) => {
    const { d1Result, viaD1 } = await expectParity((seeded, binding) =>
      archiveRecipeCover(db, { recipeId: seeded.recipe.id, ...input(seeded) }, binding));
    expect(d1Result).toMatchObject({
      archivedCover: { id: input(viaD1).coverId, status: "archived" },
      recipe: { id: viaD1.recipe.id },
    });
  });

  it("activates and archives with only D1, one read and one write each", async () => {
    const seeded = await seed("D1 only");
    const [, second, third] = seeded.covers;
    const recipeId = seeded.recipe.id;
    const before = d1.roundTrips();
    await activateRecipeCoverOnD1(d1.binding, { recipeId, coverId: second!.id, variant: "stylized" });
    await archiveRecipeCoverOnD1(d1.binding, { recipeId, coverId: second!.id, replacementCoverId: third!.id, replacementVariant: "image" });
    expect(d1.roundTrips() - before).toBe(4);
    await expect(state(seeded)).resolves.toMatchObject({
      active: 2,
      activeCoverVariant: "image",
      coverMode: "manual",
      cookbookTouched: true,
      covers: [{ archived: false }, { archived: true }, { archived: false }],
    });

    await expect(archiveRecipeCoverOnD1(d1.binding, { recipeId: "missing", coverId: third!.id }))
      .rejects.toThrow("Recipe was not found");
    await expect(archiveRecipeCoverOnD1(d1.binding, { recipeId, coverId: "missing" })).rejects.toThrow("Cover was not found");
    await expect(archiveRecipeCoverOnD1(d1.binding, {
      recipeId, coverId: third!.id, replacementCoverId: "missing", replacementVariant: "image",
    })).rejects.toThrow("Selected cover was not found");
    await expect(activateRecipeCoverOnD1(d1.binding, { recipeId, coverId: "missing", variant: "image" }))
      .rejects.toThrow("Selected cover was not found");
  });

  it("gives the checks' error when the cover to activate was archived in between", async () => {
    const seeded = await seed("Archived in between");
    const archive = () => db.recipeCover.update({ where: { id: seeded.covers[1]!.id }, data: { status: "archived", archivedAt: new Date() } });

    await expect(setActiveRecipeCover(db, { recipeId: seeded.recipe.id, coverId: seeded.covers[1]!.id, variant: "image" }, racing(archive)))
      .rejects.toThrow("Cannot activate an archived cover");
    await expect(state(seeded)).resolves.toMatchObject({ active: 0, touched: false, cookbookTouched: false });

    const replacementArchived = await seed("Replacement archived");
    await expect(archiveRecipeCover(db, {
      recipeId: replacementArchived.recipe.id,
      coverId: replacementArchived.covers[0]!.id,
      replacementCoverId: replacementArchived.covers[1]!.id,
      replacementVariant: "image",
    }, racing(() => db.recipeCover.update({
      where: { id: replacementArchived.covers[1]!.id },
      data: { status: "archived", archivedAt: new Date() },
    })))).rejects.toThrow("Cannot activate an archived cover");
    await expect(state(replacementArchived)).resolves.toMatchObject({ active: 0, covers: [{ archived: false }, { archived: true }, { archived: false }] });
  });

  it("gives the checks' error when the cover to archive became the active one in between", async () => {
    const seeded = await seed("Activated in between");
    const activate = () => db.recipe.update({ where: { id: seeded.recipe.id }, data: { activeCoverId: seeded.covers[2]!.id } });

    await expect(archiveRecipeCover(db, { recipeId: seeded.recipe.id, coverId: seeded.covers[2]!.id }, racing(activate)))
      .rejects.toThrow("Archiving the active cover requires a replacement or confirmNoCover");
    await expect(state(seeded)).resolves.toMatchObject({ active: 2, covers: [{ archived: false }, { archived: false }, { archived: false }] });
  });

  it("gives up after three lost races, and rethrows other D1 failures", async () => {
    const seeded = await seed("Always changing");
    let changes = 0;
    const alwaysChanging = racing(() => db.recipeCover.update({
      where: { id: seeded.covers[1]!.id },
      data: { stylizedImageUrl: `https://example.com/changed-${++changes}.jpg` },
    }), true);
    await expect(setActiveRecipeCover(db, { recipeId: seeded.recipe.id, coverId: seeded.covers[1]!.id, variant: "image" }, alwaysChanging))
      .rejects.toThrow("The recipe's covers changed while this request ran. Please try again.");
    expect(changes).toBe(3);

    const down: D1ReadDatabase = { prepare: (sql) => d1.binding.prepare(sql), batch: async () => { throw new Error("D1 is down"); } };
    await expect(setActiveRecipeCover(db, { recipeId: seeded.recipe.id, coverId: seeded.covers[1]!.id, variant: "image" }, down))
      .rejects.toThrow("D1 is down");
    await expect(archiveRecipeCover(db, { recipeId: seeded.recipe.id, coverId: seeded.covers[2]!.id }, down)).rejects.toThrow("D1 is down");
  });
});
