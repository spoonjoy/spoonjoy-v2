// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { getLocalDb } from "~/lib/db.server";
import { importRecipeFromSource, ImportRecipeError } from "~/lib/recipe-import.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// Recipe import, and the recipe page's clear-cover and delete, with a D1 binding: each write
// is one D1 batch (through the SQLite-backed fake binding) and leaves the same rows as the
// Prisma path, which still runs where there is no binding.

let db: PrismaClient;
let d1: SqliteD1;
let chefId: string;

const OLD = new Date("2026-01-01T00:00:00.000Z");

function jsonLd(name: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name,
    description: "Imported",
    recipeYield: "2",
    recipeIngredient: ["2 cups rice", "1 lemon"],
    recipeInstructions: [{ "@type": "HowToStep", text: "Rinse the rice" }, { "@type": "HowToStep", text: "Cook it" }],
  };
}

/** The import's recipe batch starts with the title guard; its quota batch does not. */
function isRecipeBatch(statements: unknown): boolean {
  return (statements as Array<{ sql: string }>)[0]!.sql.startsWith("SELECT json(");
}

async function importRecipe(name: string, sourceUrl: string, DB?: D1ReadDatabase) {
  return importRecipeFromSource(
    { chefId, source: { type: "json-ld", jsonLd: jsonLd(name), sourceUrl } },
    {
      db,
      env: DB ? { DB } : {},
      ingredientParser: async (text) => [{ quantity: 1, unit: "whole", ingredientName: text }],
    },
  );
}

async function graph(recipeId: string) {
  const recipe = await db.recipe.findUniqueOrThrow({
    where: { id: recipeId },
    include: {
      steps: { orderBy: { stepNum: "asc" }, include: { ingredients: { include: { unit: true, ingredientRef: true } } } },
    },
  });
  return {
    description: recipe.description,
    servings: recipe.servings,
    coverMode: recipe.coverMode,
    activeCoverVariant: recipe.activeCoverVariant,
    hasActiveCover: recipe.activeCoverId !== null,
    deleted: recipe.deletedAt !== null,
    touched: recipe.updatedAt.getTime() > OLD.getTime(),
    steps: recipe.steps.map((step) => ({
      stepNum: step.stepNum,
      stepTitle: step.stepTitle,
      description: step.description,
      duration: step.duration,
      ingredients: step.ingredients.map((ingredient) => `${ingredient.quantity} ${ingredient.unit.name} ${ingredient.ingredientRef.name}`).sort(),
    })),
  };
}

describe("recipe import and recipe page writes on a D1 binding", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
    chefId = (await db.user.create({ data: createTestUser() })).id;
  });

  afterEach(async () => {
    d1.close();
    vi.doUnmock("~/lib/route-platform.server");
    vi.resetModules();
    await cleanupDatabase();
  });

  describe("recipe import", () => {
    it("writes the imported recipe in one batch, as the Prisma path does", async () => {
      const viaPrisma = await importRecipe("Lemon Rice", "https://example.com/a");
      const before = d1.roundTrips();
      const viaD1 = await importRecipe("Lemon Rice D1", "https://example.com/b", d1.binding);

      // One batch for the daily import quota, one for the recipe.
      expect(d1.roundTrips() - before).toBe(2);
      expect(await graph(viaD1.recipeId!)).toEqual(await graph(viaPrisma.recipeId!));
      await expect(db.recipe.findUniqueOrThrow({ where: { id: viaD1.recipeId! } })).resolves.toMatchObject({
        title: "Lemon Rice D1", sourceUrl: "https://example.com/b", chefId,
      });
    });

    it("takes the next title when another recipe takes it before the write", async () => {
      const racing: D1ReadDatabase = {
        prepare: (sql) => d1.binding.prepare(sql),
        async batch(statements) {
          if (isRecipeBatch(statements) && !(await db.recipe.findFirst({ where: { title: "Soup" } }))) {
            await db.recipe.create({ data: { title: "Soup", chefId } });
          }
          return d1.binding.batch(statements as never);
        },
      };
      const imported = await importRecipe("Soup", "https://example.com/soup", racing);
      await expect(db.recipe.findUniqueOrThrow({ where: { id: imported.recipeId! } })).resolves.toMatchObject({ title: "Soup (imported)" });
    });

    it("leaves no new unit or ingredient name behind when the recipe batch fails or loses every title race", async () => {
      const tag = crypto.randomUUID().slice(0, 8);
      const lookupRows = async () => ({
        units: await db.unit.count({ where: { name: { startsWith: `residue ${tag}` } } }),
        names: await db.ingredientRef.count({ where: { name: { startsWith: `residue ${tag}` } } }),
      });
      const importWith = (name: string, DB: D1ReadDatabase) => importRecipeFromSource(
        { chefId, source: { type: "json-ld", jsonLd: jsonLd(name), sourceUrl: `https://example.com/${tag}/${encodeURIComponent(name)}` } },
        {
          db,
          env: { DB },
          ingredientParser: async (text) => [{ quantity: 1, unit: `Residue ${tag} unit`, ingredientName: `Residue ${tag} ${text}` }],
        },
      );
      const failing: D1ReadDatabase = {
        prepare: (sql) => d1.binding.prepare(sql),
        async batch(statements) {
          if (isRecipeBatch(statements)) throw new Error("D1 is down");
          return d1.binding.batch(statements as never);
        },
      };
      const alwaysRacing: D1ReadDatabase = {
        prepare: (sql) => d1.binding.prepare(sql),
        async batch(statements) {
          if (isRecipeBatch(statements)) {
            const taken = (statements as unknown as Array<{ params: unknown[] }>)[0]!.params[1] as string;
            await db.recipe.create({ data: { title: taken, chefId } });
          }
          return d1.binding.batch(statements as never);
        },
      };

      await expect(importWith("Residue Down", failing)).rejects.toThrow("D1 is down");
      await expect(importWith("Residue Race", alwaysRacing)).rejects.toMatchObject({ code: "title-conflict" });
      expect(await lookupRows()).toEqual({ units: 0, names: 0 });

      // A successful import creates each name once, in its recipe batch.
      await importWith("Residue Kept", d1.binding);
      expect(await lookupRows()).toEqual({ units: 1, names: 2 });
    });

    it("gives up after three lost title races, and rethrows other failures", async () => {
      let races = 0;
      const alwaysRacing: D1ReadDatabase = {
        prepare: (sql) => d1.binding.prepare(sql),
        async batch(statements) {
          if (isRecipeBatch(statements)) {
            races += 1;
            const taken = (statements as unknown as Array<{ params: unknown[] }>)[0]!.params[1] as string;
            await db.recipe.create({ data: { title: taken, chefId } });
          }
          return d1.binding.batch(statements as never);
        },
      };
      const error = await importRecipe("Stew", "https://example.com/stew", alwaysRacing).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ImportRecipeError);
      expect(error).toMatchObject({ code: "title-conflict", status: 409 });
      expect(races).toBe(3);

      // The quota batch goes through; the recipe batch fails.
      const failing: D1ReadDatabase = {
        prepare: (sql) => d1.binding.prepare(sql),
        async batch(statements) {
          if (isRecipeBatch(statements)) throw new Error("D1 is down");
          return d1.binding.batch(statements as never);
        },
      };
      await expect(importRecipe("Chili", "https://example.com/chili", failing)).rejects.toThrow("D1 is down");
    });
  });

  describe("recipe page", () => {
    async function seedRecipe(title: string) {
      const recipe = await db.recipe.create({ data: { title, chefId } });
      const cover = await db.recipeCover.create({ data: { recipeId: recipe.id, imageUrl: "https://example.com/c.jpg", sourceType: "chef-upload" } });
      await db.recipe.update({ where: { id: recipe.id }, data: { activeCoverId: cover.id, activeCoverVariant: "image", coverMode: "manual", updatedAt: OLD } });
      const cookbook = await db.cookbook.create({ data: { title: `Book ${title}`, authorId: chefId } });
      await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: chefId } });
      await db.cookbook.update({ where: { id: cookbook.id }, data: { updatedAt: OLD } });
      return { recipe, cookbook };
    }

    async function act(recipeId: string, fields: Record<string, string>, env: Record<string, unknown> | null) {
      vi.resetModules();
      const actual = await vi.importActual<typeof import("~/lib/route-platform.server")>("~/lib/route-platform.server");
      vi.doMock("~/lib/route-platform.server", () => ({ ...actual, getRequestDb: vi.fn(async () => getLocalDb()) }));
      const { handleRecipeDetailAction } = await import("~/lib/recipe-detail.server");
      const body = new UndiciFormData();
      for (const [key, value] of Object.entries(fields)) body.append(key, value);
      const cookie = (await createUserSessionCookie(chefId)).split(";")[0]!;
      return handleRecipeDetailAction({
        request: new UndiciRequest(`http://localhost:3000/recipes/${recipeId}`, { method: "POST", headers: { Cookie: cookie }, body }) as never,
        params: { id: recipeId },
        context: { cloudflare: { env } } as never,
      } as never).catch((error: unknown) => error);
    }

    async function cookbookTouched(cookbookId: string) {
      return (await db.cookbook.findUniqueOrThrow({ where: { id: cookbookId } })).updatedAt.getTime() > OLD.getTime();
    }

    it.each([
      ["clears the cover", { intent: "setRecipeNoCover", confirmNoCover: "true" }],
      ["deletes the recipe", { intent: "delete" }],
    ])("%s as the Prisma path does", async (_label, fields) => {
      const viaPrisma = await seedRecipe("Prisma");
      const viaD1 = await seedRecipe("D1");
      const prismaResult = await act(viaPrisma.recipe.id, fields, null);
      const d1Result = await act(viaD1.recipe.id, fields, { DB: d1.binding });

      expect(d1.statements.some((statement) => /^\s*UPDATE "Recipe"/.test(statement.sql))).toBe(true);
      expect(d1Result instanceof Response ? d1Result.status : d1Result).toEqual(prismaResult instanceof Response ? prismaResult.status : prismaResult);
      expect(await graph(viaD1.recipe.id)).toEqual(await graph(viaPrisma.recipe.id));
      expect(await cookbookTouched(viaD1.cookbook.id)).toBe(await cookbookTouched(viaPrisma.cookbook.id));
      if (fields.intent === "delete") {
        await expect(db.nativeSyncTombstone.findMany({ where: { resourceId: viaD1.recipe.id } })).resolves.toEqual([
          expect.objectContaining({ resourceType: "recipe", title: "D1", accountId: chefId }),
        ]);
      }
    });

    it.each([
      ["clearing the cover of", { intent: "setRecipeNoCover", confirmNoCover: "true" }],
      ["deleting", { intent: "delete" }],
    ])("answers 404 for %s a recipe removed before the write", async (_label, fields) => {
      const { recipe } = await seedRecipe("Vanishing");
      const vanishing: D1ReadDatabase = {
        prepare: (sql) => d1.binding.prepare(sql),
        async batch(statements) {
          await db.recipeInCookbook.deleteMany({ where: { recipeId: recipe.id } });
          await db.recipe.delete({ where: { id: recipe.id } });
          return d1.binding.batch(statements as never);
        },
      };
      const result = await act(recipe.id, fields, { DB: vanishing });
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(404);
    });

    it("rethrows any other D1 failure", async () => {
      const { recipe } = await seedRecipe("Down");
      const failing: D1ReadDatabase = {
        prepare: (sql) => d1.binding.prepare(sql),
        batch: async () => {
          throw new Error("D1 is down");
        },
      };
      const result = await act(recipe.id, { intent: "delete" }, { DB: failing });
      expect(result).toEqual(new Error("D1 is down"));
      await expect(graph(recipe.id)).resolves.toMatchObject({ deleted: false });
    });
  });
});
