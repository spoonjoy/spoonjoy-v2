// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { D1_WRITE_UNAVAILABLE_MESSAGE } from "~/lib/d1-write-retry.server";
import { getLocalDb } from "~/lib/db.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { flakyD1, type FlakyOutcome } from "../helpers/flaky-d1";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// The new-recipe page, the recipe edit page and the step edit page when D1's connection drops.
// A new recipe is keyed on the form's token, so a lost answer, a late commit or a resubmit after
// a 503 writes it once and goes to it. Every editor write whose tries all fail answers a
// retryable 503 (Retry-After: 1) that shows the message where the cook acted and keeps the page.

let db: PrismaClient;
let d1: SqliteD1;
let chefId: string;
let cookie: string;

const LOST_FOUR: FlakyOutcome[] = ["lost", "lost", "lost", "lost"];
const UNAVAILABLE = { errorCode: "temporarily_unavailable", retryable: true };

type RouteModule = { action: (args: never) => Promise<unknown> };

async function post(
  load: () => Promise<RouteModule>,
  path: string,
  params: Record<string, string>,
  body: UndiciFormData,
  DB: unknown = d1.binding,
) {
  vi.resetModules();
  const actual = await vi.importActual<typeof import("~/lib/route-platform.server")>("~/lib/route-platform.server");
  // Reads run through Prisma on the unit-test database; the writes go to the binding.
  vi.doMock("~/lib/route-platform.server", () => ({ ...actual, getRequestDb: vi.fn(async () => getLocalDb()) }));
  const { action } = await load();
  const result = await action({
    request: new UndiciRequest(`http://localhost:3000${path}`, { method: "POST", headers: { Cookie: cookie }, body }) as never,
    context: { cloudflare: { env: { DB } } },
    params,
  } as never);
  if (result instanceof Response) return { status: result.status, location: result.headers.get("Location"), data: undefined, retryAfter: null };
  const payload = result as { data?: Record<string, unknown>; init?: { status?: number; headers?: HeadersInit } };
  return {
    status: payload.init?.status ?? 200,
    location: null,
    data: payload.data,
    retryAfter: new Headers(payload.init?.headers).get("Retry-After"),
  };
}

function form(fields: Record<string, string>) {
  const body = new UndiciFormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return body;
}

async function seedRecipe() {
  const recipe = await db.recipe.create({ data: { title: `Risotto ${crypto.randomUUID()}`, chefId } });
  const cup = await db.unit.upsert({ where: { name: "cup" }, update: {}, create: { name: "cup" } });
  const rice = await db.ingredientRef.upsert({ where: { name: "rice" }, update: {}, create: { name: "rice" } });
  const steps = [];
  for (const [stepNum, stepTitle] of [[1, "Toast"], [2, "Stir"]] as const) {
    steps.push(await db.recipeStep.create({ data: { recipeId: recipe.id, stepNum, stepTitle, description: `${stepTitle} it` } }));
  }
  const ingredient = await db.ingredient.create({ data: { recipeId: recipe.id, stepNum: 1, quantity: 1, unitId: cup.id, ingredientRefId: rice.id } });
  return { recipe, steps, ingredient };
}

describe("recipe editor pages when D1's connection drops", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
    chefId = (await db.user.create({ data: createTestUser() })).id;
    cookie = (await createUserSessionCookie(chefId)).split(";")[0]!;
  });

  afterEach(async () => {
    vi.doUnmock("~/lib/route-platform.server");
    d1.close();
    await cleanupDatabase();
  });

  describe("new recipe", () => {
    const load = () => import("~/routes/recipes.new") as Promise<RouteModule>;
    const RECIPE_WRITE = /INSERT INTO "Recipe" \(/;
    const newRecipe = (token: string | null) => form({
      title: "Weeknight dal",
      description: "",
      servings: "",
      steps: JSON.stringify([{ description: "Simmer the lentils", ingredients: [] }]),
      ...(token ? { recipeToken: token } : {}),
    });

    it.each<FlakyOutcome>(["lost", "lost-answer", "late"])("writes the recipe once and goes to it when its batch is %s", async (outcome) => {
      const flaky = flakyD1(d1.binding);
      flaky.failNext(RECIPE_WRITE, outcome);

      const answer = await post(load, "/recipes/new", {}, newRecipe("new-recipe-token"), flaky.binding);

      const recipes = await db.recipe.findMany({ where: { chefId } });
      expect(recipes).toHaveLength(1);
      expect(answer).toMatchObject({ status: 302, location: `/recipes/${recipes[0]!.id}` });
      expect(flaky.failures()).toBe(1);

      // A resubmit of the same form goes to the recipe the first submit wrote.
      expect(await post(load, "/recipes/new", {}, newRecipe("new-recipe-token"))).toMatchObject({ status: 302, location: `/recipes/${recipes[0]!.id}` });
      expect(await db.recipe.count({ where: { chefId } })).toBe(1);
    });

    it("still answers a title another recipe took between the check and the write", async () => {
      let pending = true;
      const racing = {
        prepare: (sql: string) => d1.binding.prepare(sql),
        async batch(statements: never) {
          if (pending) {
            pending = false;
            await db.recipe.create({ data: { title: "Weeknight dal", chefId } });
          }
          return d1.binding.batch(statements);
        },
      };

      const answer = await post(load, "/recipes/new", {}, newRecipe("new-recipe-race"), racing);

      expect(answer).toMatchObject({ status: 400, data: { errors: { title: expect.any(String) } } });
      expect(await db.recipe.count({ where: { chefId } })).toBe(1);
    });

    it("writes the recipe once without a token", async () => {
      const flaky = flakyD1(d1.binding);
      flaky.failNext(RECIPE_WRITE, "lost-answer");

      expect(await post(load, "/recipes/new", {}, newRecipe(null), flaky.binding)).toMatchObject({ status: 302 });
      expect(await db.recipe.count({ where: { chefId } })).toBe(1);
    });

    it("answers a retryable 503 the form shows when every try fails, and the resubmit writes the recipe once", async () => {
      const flaky = flakyD1(d1.binding);
      flaky.failNext(RECIPE_WRITE, "lost", "lost", "lost", "late");

      const answer = await post(load, "/recipes/new", {}, newRecipe("new-recipe-503"), flaky.binding);

      expect(answer).toEqual({
        status: 503,
        location: null,
        data: { errors: { general: D1_WRITE_UNAVAILABLE_MESSAGE }, ...UNAVAILABLE },
        retryAfter: "1",
      });
      expect(await db.recipe.count({ where: { chefId } })).toBe(0);

      // The last try lands just as the cook saves again: one recipe, and the save goes to it.
      const resubmitted = await post(load, "/recipes/new", {}, newRecipe("new-recipe-503"), flaky.binding);
      const recipes = await db.recipe.findMany({ where: { chefId } });
      expect(recipes).toHaveLength(1);
      expect(resubmitted).toMatchObject({ status: 302, location: `/recipes/${recipes[0]!.id}` });
    });
  });

  describe("recipe edit page", () => {
    const load = () => import("~/routes/recipes.$id.edit") as Promise<RouteModule>;

    it("answers a step move the database could not take with a 503 where the move was", async () => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(/SET "stepNum" = \?/, ...LOST_FOUR);

      const answer = await post(load, `/recipes/${recipe.id}/edit`, { id: recipe.id }, form({ intent: "reorderStep", stepId: steps[1]!.id, direction: "up" }), flaky.binding);

      expect(answer).toMatchObject({ status: 503, data: { errors: { reorder: D1_WRITE_UNAVAILABLE_MESSAGE }, ...UNAVAILABLE }, retryAfter: "1" });
      expect((await db.recipeStep.findUniqueOrThrow({ where: { id: steps[1]!.id } })).stepNum).toBe(2);
    });

    it("answers a step delete the database could not take with a 503 where the delete was", async () => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(/DELETE FROM "RecipeStep"/, ...LOST_FOUR);

      const answer = await post(load, `/recipes/${recipe.id}/edit`, { id: recipe.id }, form({ intent: "deleteStep", stepId: steps[1]!.id }), flaky.binding);

      expect(answer).toMatchObject({ status: 503, data: { errors: { stepDeletion: D1_WRITE_UNAVAILABLE_MESSAGE }, ...UNAVAILABLE } });
      expect(await db.recipeStep.count({ where: { recipeId: recipe.id } })).toBe(2);
    });

    it("answers a save the database could not take with a 503 the form shows", async () => {
      const { recipe } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(/UPDATE "Cookbook"/, ...LOST_FOUR);

      const answer = await post(load, `/recipes/${recipe.id}/edit`, { id: recipe.id }, form({ title: "Mushroom risotto", description: "", servings: "" }), flaky.binding);

      expect(answer).toMatchObject({ status: 503, data: { errors: { general: D1_WRITE_UNAVAILABLE_MESSAGE }, ...UNAVAILABLE }, retryAfter: "1" });
      expect((await db.recipe.findUniqueOrThrow({ where: { id: recipe.id } })).title).toBe(recipe.title);
    });

    it.each<FlakyOutcome>(["lost-answer", "late"])("saves once and goes to the recipe when the save's batch is %s", async (outcome) => {
      const { recipe } = await seedRecipe();
      const loaded = await db.recipe.findUniqueOrThrow({ where: { id: recipe.id } });
      const flaky = flakyD1(d1.binding);
      flaky.failNext(/UPDATE "Cookbook"/, outcome);

      const answer = await post(load, `/recipes/${recipe.id}/edit`, { id: recipe.id }, form({
        title: "Mushroom risotto", description: "", servings: "", expectedUpdatedAt: loaded.updatedAt.toISOString(),
      }), flaky.binding);

      expect(answer).toMatchObject({ status: 302, location: `/recipes/${recipe.id}` });
      expect((await db.recipe.findUniqueOrThrow({ where: { id: recipe.id } })).title).toBe("Mushroom risotto");
    });
  });

  describe("step edit page", () => {
    const load = () => import("~/routes/recipes.$id.steps.$stepId.edit") as Promise<RouteModule>;
    const path = (recipeId: string, stepId: string) => `/recipes/${recipeId}/steps/${stepId}/edit`;

    it("answers a step delete the database could not take with a 503 where the delete was", async () => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(/DELETE FROM "RecipeStep"/, ...LOST_FOUR);

      const answer = await post(load, path(recipe.id, steps[1]!.id), { id: recipe.id, stepId: steps[1]!.id }, form({ intent: "delete" }), flaky.binding);

      expect(answer).toMatchObject({ status: 503, data: { errors: { stepDeletion: D1_WRITE_UNAVAILABLE_MESSAGE }, ...UNAVAILABLE }, retryAfter: "1" });
      expect(await db.recipeStep.count({ where: { recipeId: recipe.id } })).toBe(2);
    });

    it("answers an Add All the database could not take with a 503 the ingredient list shows", async () => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(/INSERT INTO "Ingredient"/, ...LOST_FOUR);

      const answer = await post(load, path(recipe.id, steps[1]!.id), { id: recipe.id, stepId: steps[1]!.id }, form({
        intent: "addIngredients", ingredientsJson: JSON.stringify([{ quantity: 1, unit: "cup", ingredientName: "stock" }]),
      }), flaky.binding);

      expect(answer).toMatchObject({ status: 503, data: { errors: { general: D1_WRITE_UNAVAILABLE_MESSAGE }, ...UNAVAILABLE } });
      expect(await db.ingredient.count({ where: { recipeId: recipe.id } })).toBe(1);
    });

    it("answers one ingredient's add the database could not take with a 503 next to the ingredient", async () => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(/INSERT INTO "Ingredient"/, ...LOST_FOUR);

      const answer = await post(load, path(recipe.id, steps[1]!.id), { id: recipe.id, stepId: steps[1]!.id }, form({
        intent: "addIngredient", quantity: "1", unitName: "cup", ingredientName: "stock",
      }), flaky.binding);

      expect(answer).toMatchObject({ status: 503, data: { errors: { ingredientName: D1_WRITE_UNAVAILABLE_MESSAGE }, ...UNAVAILABLE } });
      expect(await db.ingredient.count({ where: { recipeId: recipe.id } })).toBe(1);
    });

    it("answers an ingredient's removal the database could not take with a 503 next to the ingredient", async () => {
      const { recipe, steps, ingredient } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(/DELETE FROM "Ingredient"/, ...LOST_FOUR);

      const answer = await post(load, path(recipe.id, steps[0]!.id), { id: recipe.id, stepId: steps[0]!.id }, form({
        intent: "deleteIngredient", ingredientId: ingredient.id,
      }), flaky.binding);

      expect(answer).toMatchObject({ status: 503, data: { errors: { ingredientName: D1_WRITE_UNAVAILABLE_MESSAGE }, ...UNAVAILABLE } });
      expect(await db.ingredient.count({ where: { recipeId: recipe.id } })).toBe(1);
    });

    it("still fails an ingredient's removal that fails for another reason", async () => {
      const { recipe, steps, ingredient } = await seedRecipe();
      const broken = {
        prepare: (sql: string) => d1.binding.prepare(sql),
        batch: async () => {
          throw new Error("D1_ERROR: no such table: Ingredient");
        },
      };

      await expect(post(load, path(recipe.id, steps[0]!.id), { id: recipe.id, stepId: steps[0]!.id }, form({
        intent: "deleteIngredient", ingredientId: ingredient.id,
      }), broken)).rejects.toThrow("no such table");
    });

    it("answers a step save the database could not take with a 503 the form shows", async () => {
      const { recipe, steps } = await seedRecipe();
      const flaky = flakyD1(d1.binding);
      flaky.failNext(/UPDATE "RecipeStep" SET "stepTitle"/, ...LOST_FOUR);

      const answer = await post(load, path(recipe.id, steps[1]!.id), { id: recipe.id, stepId: steps[1]!.id }, form({
        stepTitle: "Stir slowly", description: "Stir it slowly", usesSteps: "1",
      }), flaky.binding);

      expect(answer).toMatchObject({ status: 503, data: { errors: { general: D1_WRITE_UNAVAILABLE_MESSAGE }, ...UNAVAILABLE }, retryAfter: "1" });
      expect((await db.recipeStep.findUniqueOrThrow({ where: { id: steps[1]!.id } })).stepTitle).toBe("Stir");
    });
  });
});
