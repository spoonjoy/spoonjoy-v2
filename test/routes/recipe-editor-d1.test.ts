// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { getLocalDb } from "~/lib/db.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// The recipe edit page and the step edit page with a D1 binding: each write is one D1
// batch (through the SQLite-backed fake binding) and leaves the same rows as the Prisma
// path, which still runs where there is no binding. Each case runs the same form post
// against one recipe without a binding and against an identical twin with one.

let db: PrismaClient;
let d1: SqliteD1;
let chefId: string;
let cookie: string;

const OLD = new Date("2026-01-01T00:00:00.000Z");

type Seeded = Awaited<ReturnType<typeof seedRecipe>>;

async function seedRecipe(title: string) {
  const recipe = await db.recipe.create({ data: { title, description: "Seeded", servings: "2", chefId } });
  const cup = await db.unit.upsert({ where: { name: "cup" }, update: {}, create: { name: "cup" } });
  const refs = await Promise.all(["flour", "milk", "egg"].map((name) =>
    db.ingredientRef.upsert({ where: { name }, update: {}, create: { name } })));
  const steps = [];
  for (const [stepNum, stepTitle] of [[1, "Mix"], [2, "Rest"], [3, "Bake"]] as const) {
    steps.push(await db.recipeStep.create({
      data: { recipeId: recipe.id, stepNum, stepTitle, description: `${stepTitle} it`, duration: stepNum * 5 },
    }));
  }
  const ingredients = [];
  for (const [stepNum, ref] of [[1, 0], [1, 1], [2, 2]] as const) {
    ingredients.push(await db.ingredient.create({
      data: { recipeId: recipe.id, stepNum, quantity: stepNum, unitId: cup.id, ingredientRefId: refs[ref]!.id },
    }));
  }
  await db.stepOutputUse.create({ data: { recipeId: recipe.id, outputStepNum: 1, inputStepNum: 3 } });
  const cookbook = await db.cookbook.create({ data: { title: `Book ${title}`, authorId: chefId } });
  await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: chefId } });
  await db.cookbook.update({ where: { id: cookbook.id }, data: { updatedAt: OLD } });
  await db.recipe.update({ where: { id: recipe.id }, data: { updatedAt: OLD } });
  return { recipe, steps, ingredients, cookbook };
}

async function graph(seeded: Seeded) {
  const recipe = await db.recipe.findUniqueOrThrow({
    where: { id: seeded.recipe.id },
    include: {
      steps: { orderBy: { stepNum: "asc" }, include: { ingredients: { include: { unit: true, ingredientRef: true } } } },
      covers: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  const uses = await db.stepOutputUse.findMany({ where: { recipeId: recipe.id } });
  const cookbook = await db.cookbook.findUniqueOrThrow({ where: { id: seeded.cookbook.id } });
  return {
    title: recipe.title.replace(/^Twin \S+ (Prisma|D1)/, "Twin"),
    description: recipe.description,
    servings: recipe.servings,
    coverMode: recipe.coverMode,
    activeCoverVariant: recipe.activeCoverVariant,
    activeCover: recipe.covers.findIndex((cover) => cover.id === recipe.activeCoverId),
    touched: recipe.updatedAt.getTime() > OLD.getTime(),
    cookbookTouched: cookbook.updatedAt.getTime() > OLD.getTime(),
    steps: recipe.steps.map((step) => ({
      position: seeded.steps.findIndex((seededStep) => seededStep.id === step.id),
      stepNum: step.stepNum,
      stepTitle: step.stepTitle,
      description: step.description,
      ingredients: step.ingredients.map((ingredient) => `${ingredient.quantity} ${ingredient.unit.name} ${ingredient.ingredientRef.name}`).sort(),
    })),
    uses: uses.map((use) => `${use.outputStepNum}->${use.inputStepNum}`).sort(),
    covers: recipe.covers.map((cover) => ({
      sourceType: cover.sourceType,
      status: cover.status,
      createdById: cover.createdById,
      generationStatus: cover.generationStatus,
      failureReason: cover.failureReason,
      hasImage: cover.imageUrl.length > 0,
      sourceIsImage: cover.sourceImageUrl === cover.imageUrl,
    })),
  };
}

async function withD1Routes<T>(run: () => Promise<T>) {
  vi.resetModules();
  const actual = await vi.importActual<typeof import("~/lib/route-platform.server")>("~/lib/route-platform.server");
  // Reads and the non-batched writes still run through Prisma on the unit-test database.
  vi.doMock("~/lib/route-platform.server", () => ({ ...actual, getRequestDb: vi.fn(async () => getLocalDb()) }));
  return run();
}

function form(fields: Record<string, string | File>) {
  const body = new UndiciFormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return body;
}

function responseStatus(response: unknown) {
  if (response instanceof Response) return response.status;
  const init = (response as { init?: { status?: number } } | null)?.init;
  return init?.status ?? 200;
}

type Page = "edit" | "step";

async function post(page: Page, seeded: Seeded, fields: (seeded: Seeded) => Record<string, string | File>, env: Record<string, unknown> | null, stepIndex = 0) {
  const params = page === "edit"
    ? { id: seeded.recipe.id }
    : { id: seeded.recipe.id, stepId: seeded.steps[stepIndex]!.id };
  const module = page === "edit"
    ? await import("~/routes/recipes.$id.edit")
    : await import("~/routes/recipes.$id.steps.$stepId.edit");
  const response = await module.action({
    request: new UndiciRequest(`http://localhost:3000/recipes/${seeded.recipe.id}/edit`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: form(fields(seeded)),
    }) as never,
    context: { cloudflare: { env } },
    params,
  } as never);
  return responseStatus(response);
}

const photos = () => ({ put: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) });

/** Posts the same form without and with a D1 binding to twin recipes; both must end the same. */
async function expectParity(page: Page, fields: (seeded: Seeded) => Record<string, string | File>, stepIndex = 0) {
  const viaPrisma = await seedRecipe(`Twin ${crypto.randomUUID()} Prisma`);
  const viaD1 = await seedRecipe(`Twin ${crypto.randomUUID()} D1`);
  const statuses = await withD1Routes(async () => [
    await post(page, viaPrisma, fields, { PHOTOS: photos() }, stepIndex),
    await post(page, viaD1, fields, { DB: d1.binding, PHOTOS: photos() }, stepIndex),
  ]);
  expect(statuses[1]).toBe(statuses[0]);
  // The D1 twin's write went to the binding, not through Prisma.
  expect(d1.statements.some((statement) => /^\s*(INSERT|UPDATE|DELETE)/.test(statement.sql))).toBe(true);
  expect(await graph(viaD1)).toEqual(await graph(viaPrisma));
  return { statuses, viaPrisma, viaD1 };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

describe("recipe editor routes on a D1 binding", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
    chefId = (await db.user.create({ data: createTestUser() })).id;
    cookie = (await createUserSessionCookie(chefId)).split(";")[0]!;
  });

  afterEach(async () => {
    d1.close();
    vi.doUnmock("~/lib/route-platform.server");
    vi.resetModules();
    await cleanupDatabase();
  });

  describe("recipe edit page", () => {
    it("moves a step up as the Prisma path does", async () => {
      const { statuses } = await expectParity("edit", ({ steps }) => ({ intent: "reorderStep", stepId: steps[1]!.id, direction: "up" }));
      expect(statuses).toEqual([200, 200]);
    });

    it("deletes a step as the Prisma path does", async () => {
      await expectParity("edit", ({ steps }) => ({ intent: "deleteStep", stepId: steps[1]!.id }));
    });

    it("saves fields as the Prisma path does", async () => {
      const { statuses } = await expectParity("edit", ({ recipe }) => ({ title: `${recipe.title} saved`, description: "", servings: "6" }));
      expect(statuses).toEqual([302, 302]);
    });

    it("saves fields and an uploaded cover as the Prisma path does", async () => {
      await expectParity("edit", ({ recipe }) => ({
        title: recipe.title, description: "With photo", servings: "", image: new File([PNG], "cover.png", { type: "image/png" }),
      }));
    });

    it("clears the cover as the Prisma path does", async () => {
      await expectParity("edit", ({ recipe }) => ({ title: recipe.title, clearImage: "true" }));
    });

    it("rolls back a save that lost its title, and removes the uploaded image", async () => {
      const mine = await seedRecipe("Mine");
      const bucket = photos();
      const racing = {
        prepare: (sql: string) => d1.binding.prepare(sql),
        async batch(statements: never) {
          await db.recipe.create({ data: { title: "Wanted", chefId } });
          return d1.binding.batch(statements);
        },
      };
      const status = await withD1Routes(() => post("edit", mine, () => ({
        title: "Wanted", image: new File([PNG], "cover.png", { type: "image/png" }),
      }), { DB: racing, PHOTOS: bucket }));

      expect(status).toBe(500);
      expect(bucket.delete).toHaveBeenCalledTimes(1);
      await expect(graph(mine)).resolves.toMatchObject({ title: "Mine", touched: false, covers: [] });
    });
  });

  describe("step edit page", () => {
    it("deletes a step as the Prisma path does", async () => {
      await expectParity("step", () => ({ intent: "delete" }), 1);
    });

    it("adds a batch of ingredients as the Prisma path does", async () => {
      await expectParity("step", () => ({
        intent: "addIngredients",
        ingredientsJson: JSON.stringify([{ quantity: 2, unit: "Tbsp", ingredientName: "Honey" }, { quantity: 1, unit: "cup", ingredientName: "Oats" }]),
      }), 2);
    });

    it("adds one ingredient as the Prisma path does", async () => {
      await expectParity("step", () => ({ intent: "addIngredient", quantity: "3", unitName: "Pinch", ingredientName: "Salt" }), 2);
    });

    it("deletes an ingredient as the Prisma path does, and nothing for another step's", async () => {
      await expectParity("step", ({ ingredients }) => ({ intent: "deleteIngredient", ingredientId: ingredients[0]!.id }), 0);
      await expectParity("step", ({ ingredients }) => ({ intent: "deleteIngredient", ingredientId: ingredients[2]!.id }), 0);
    });

    it.each([
      ["with a title", "Bake hot"],
      ["without a title", "  "],
    ])("saves a step %s and its output uses as the Prisma path does", async (_label, stepTitle) => {
      const { statuses } = await expectParity("step", () => ({ stepTitle, description: "Bake it hot", usesSteps: "2" }), 2);
      expect(statuses).toEqual([302, 302]);
    });
  });
});
