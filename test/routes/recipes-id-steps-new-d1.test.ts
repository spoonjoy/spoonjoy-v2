// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { getLocalDb } from "~/lib/db.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// The new-step page writes the step, its step output uses and its ingredients as one D1 batch,
// after checking every ingredient. Before, it created the step first and then answered 400
// partway through the ingredients, so each rejected submit left another copy of the step (the
// QA proof: three 400s and three new steps).

let db: PrismaClient;
let d1: SqliteD1;
let chefId: string;
let cookie: string;
let recipeId: string;

const OLD = new Date("2026-01-01T00:00:00.000Z");
const CHANGED = "This recipe changed while you were editing it. Reload the page and try again.";

async function seed() {
  const recipe = await db.recipe.create({ data: { title: `Omelette ${crypto.randomUUID()}`, chefId } });
  await db.recipeStep.create({ data: { recipeId: recipe.id, stepNum: 1, description: "Whisk the eggs" } });
  const each = await db.unit.upsert({ where: { name: "each" }, update: {}, create: { name: "each" } });
  const egg = await db.ingredientRef.upsert({ where: { name: "egg" }, update: {}, create: { name: "egg" } });
  await db.ingredient.create({ data: { recipeId: recipe.id, stepNum: 1, quantity: 2, unitId: each.id, ingredientRefId: egg.id } });
  await db.recipe.update({ where: { id: recipe.id }, data: { updatedAt: OLD } });
  return recipe.id;
}

function fields(ingredients: Array<{ quantity: number; unit: string; ingredientName: string }>, usesSteps: number[] = []) {
  const body = new UndiciFormData();
  body.append("stepTitle", "Cook");
  body.append("description", "Melt the butter and add the eggs");
  body.append("ingredientsJson", JSON.stringify(ingredients));
  for (const stepNum of usesSteps) body.append("usesSteps", String(stepNum));
  return body;
}

/** The fake binding, with `before` run once just ahead of the first batch: another request. */
function racing(before: () => Promise<unknown>) {
  let pending = true;
  return {
    prepare: (sql: string) => d1.binding.prepare(sql),
    async batch(statements: never) {
      if (pending) {
        pending = false;
        await before();
      }
      return d1.binding.batch(statements);
    },
  };
}

async function submit(body: UndiciFormData, DB: unknown = d1.binding) {
  vi.resetModules();
  const actual = await vi.importActual<typeof import("~/lib/route-platform.server")>("~/lib/route-platform.server");
  // Reads run through Prisma on the unit-test database; the step write goes to the binding.
  vi.doMock("~/lib/route-platform.server", () => ({ ...actual, getRequestDb: vi.fn(async () => getLocalDb()) }));
  const { action } = await import("~/routes/recipes.$id.steps.new");
  const result = await action({
    request: new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/new`, {
      method: "POST",
      headers: { Cookie: cookie },
      body,
    }) as never,
    context: { cloudflare: { env: { DB } } },
    params: { id: recipeId },
  } as never);
  if (result instanceof Response) return { status: result.status, location: result.headers.get("Location"), errors: undefined };
  const payload = result as { data?: { errors?: Record<string, string> }; init?: { status?: number } };
  return { status: payload.init?.status ?? 200, location: null, errors: payload.data?.errors };
}

async function steps() {
  return db.recipeStep.findMany({
    where: { recipeId },
    orderBy: { stepNum: "asc" },
    include: { ingredients: { include: { ingredientRef: true, unit: true } } },
  });
}

describe("adding a step on a D1 binding", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
    chefId = (await db.user.create({ data: createTestUser() })).id;
    cookie = (await createUserSessionCookie(chefId)).split(";")[0]!;
    recipeId = await seed();
  });

  afterEach(async () => {
    vi.doUnmock("~/lib/route-platform.server");
    d1.close();
    await cleanupDatabase();
  });

  it("writes nothing when an ingredient is already in the recipe, however often it is retried", async () => {
    const body = () => fields([
      { quantity: 1, unit: "tbsp", ingredientName: "butter" },
      { quantity: 1, unit: "each", ingredientName: "Egg" },
    ], [1]);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const answer = await submit(body());
      expect(answer).toMatchObject({ status: 400, errors: { ingredientName: "egg is already in the recipe" } });
    }

    expect((await steps()).map((step) => step.stepNum)).toEqual([1]);
    expect(await db.stepOutputUse.count({ where: { recipeId } })).toBe(0);
    expect(await db.ingredient.count({ where: { recipeId } })).toBe(1);
    expect((await db.recipe.findUniqueOrThrow({ where: { id: recipeId } })).updatedAt).toEqual(OLD);
  });

  it("rejects an ingredient listed twice in the same step before writing", async () => {
    const answer = await submit(fields([
      { quantity: 1, unit: "tbsp", ingredientName: "Butter" },
      { quantity: 2, unit: "tbsp", ingredientName: "butter" },
    ]));

    expect(answer).toMatchObject({ status: 400, errors: { ingredientName: "butter is listed more than once" } });
    expect((await steps()).map((step) => step.stepNum)).toEqual([1]);
  });

  it("writes the step, its output use, its ingredients and the recipe touch in one batch", async () => {
    const before = d1.statements.length;
    const answer = await submit(fields([
      { quantity: 1, unit: "TBSP", ingredientName: "Butter" },
      { quantity: 0.5, unit: "tsp", ingredientName: "salt" },
    ], [1, 1]));

    const created = (await steps())[1]!;
    expect(answer).toEqual({ status: 302, location: `/recipes/${recipeId}/steps/${created.id}/edit?created=1`, errors: undefined });
    expect(created).toMatchObject({ stepNum: 2, stepTitle: "Cook", description: "Melt the butter and add the eggs", duration: null });
    expect(created.ingredients.map((row) => `${row.quantity} ${row.unit.name} ${row.ingredientRef.name}`).sort())
      .toEqual(["0.5 tsp salt", "1 tbsp butter"]);
    expect(await db.stepOutputUse.findMany({ where: { recipeId }, select: { outputStepNum: true, inputStepNum: true } }))
      .toEqual([{ outputStepNum: 1, inputStepNum: 2 }]);
    expect((await db.recipe.findUniqueOrThrow({ where: { id: recipeId } })).updatedAt.getTime()).toBeGreaterThan(OLD.getTime());
    const writes = d1.statements.slice(before).filter((statement) => /^\s*(INSERT|UPDATE)/.test(statement.sql));
    // The units and ingredient names are created in the same batch, so a stopped batch leaves
    // none of them behind either.
    expect(writes.map((statement) => statement.sql.trim().split(/\s+/).slice(0, 3).join(" "))).toEqual([
      'INSERT INTO "RecipeStep"',
      'INSERT INTO "StepOutputUse"',
      'INSERT INTO "Unit"',
      'INSERT INTO "Unit"',
      'INSERT INTO "IngredientRef"',
      'INSERT INTO "IngredientRef"',
      'INSERT INTO "Ingredient"',
      'INSERT INTO "Ingredient"',
      'UPDATE "Recipe" SET',
    ]);
  });

  it("answers 'already in the recipe' when another request adds the ingredient between the check and the write", async () => {
    const butter = await db.ingredientRef.upsert({ where: { name: "butter" }, update: {}, create: { name: "butter" } });
    const tbsp = await db.unit.upsert({ where: { name: "tbsp" }, update: {}, create: { name: "tbsp" } });

    const answer = await submit(
      fields([{ quantity: 1, unit: "tbsp", ingredientName: "butter" }]),
      racing(() => db.ingredient.create({ data: { recipeId, stepNum: 1, quantity: 3, unitId: tbsp.id, ingredientRefId: butter.id } })),
    );

    expect(answer).toMatchObject({ status: 400, errors: { ingredientName: "butter is already in the recipe" } });
    expect((await steps()).map((step) => step.stepNum)).toEqual([1]);
  });

  it("answers 409 when another request adds a step between the check and the write", async () => {
    const answer = await submit(
      fields([{ quantity: 1, unit: "tbsp", ingredientName: "butter" }]),
      racing(() => db.recipeStep.create({ data: { recipeId, stepNum: 2, description: "Someone else's step" } })),
    );

    expect(answer).toMatchObject({ status: 409, errors: { general: CHANGED } });
    expect((await steps()).map((step) => step.description)).toEqual(["Whisk the eggs", "Someone else's step"]);
    expect(await db.ingredient.count({ where: { recipeId } })).toBe(1);
  });

  it("answers 500 and writes nothing when the batch fails for another reason", async () => {
    const answer = await submit(
      fields([{ quantity: 1, unit: "tbsp", ingredientName: "butter" }]),
      { prepare: (sql: string) => d1.binding.prepare(sql), batch: async () => { throw new Error("D1 unavailable"); } },
    );

    expect(answer).toMatchObject({ status: 500, errors: { general: "Failed to create step. Please try again." } });
    expect((await steps()).map((step) => step.stepNum)).toEqual([1]);
  });
});
