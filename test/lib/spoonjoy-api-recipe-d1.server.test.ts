// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { ApiPrincipal } from "~/lib/api-auth.server";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { getLocalDb } from "~/lib/db.server";
import { ACTIVE_RECIPE_TITLE_CONFLICT_ERROR } from "~/lib/recipe-title-uniqueness.server";
import { callSpoonjoyApiOperation, type SpoonjoyApiContext } from "~/lib/spoonjoy-api.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// The MCP create_recipe and update_recipe tools with a D1 binding: the recipe, its fields
// and its replaced steps go to D1 as one batch (through the SQLite-backed fake binding),
// leaving the same rows as the Prisma path, which still runs where there is no binding.

let db: PrismaClient;
let d1: SqliteD1;
let principal: ApiPrincipal;

function context(DB?: D1ReadDatabase): SpoonjoyApiContext {
  return { db, principal, env: DB ? { DB } : null };
}

async function graph(recipeId: string) {
  const recipe = await db.recipe.findUniqueOrThrow({
    where: { id: recipeId },
    include: {
      steps: {
        orderBy: { stepNum: "asc" },
        include: { ingredients: { include: { unit: true, ingredientRef: true } } },
      },
    },
  });
  return {
    description: recipe.description,
    servings: recipe.servings,
    sourceUrl: recipe.sourceUrl,
    chefId: recipe.chefId,
    coverMode: recipe.coverMode,
    steps: recipe.steps.map((step) => ({
      stepNum: step.stepNum,
      stepTitle: step.stepTitle,
      description: step.description,
      duration: step.duration,
      ingredients: step.ingredients.map((ingredient) => `${ingredient.quantity} ${ingredient.unit.name} ${ingredient.ingredientRef.name}`).sort(),
    })),
    uses: await db.stepOutputUse.count({ where: { recipeId } }),
  };
}

async function createdId(result: unknown): Promise<string> {
  return (result as { recipe: { id: string } }).recipe.id;
}

const steps = [
  { title: "Soak", description: "Soak the beans", duration: 60, ingredients: [{ name: "Black Beans", quantity: 2, unit: "Cup" }] },
  { description: "Simmer", ingredients: [{ name: "salt", quantity: 1, unit: "tsp" }, { name: "Water", quantity: 4, unit: "cup" }] },
];

describe("MCP recipe tools on a D1 binding", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
    // MCP resolves the owner by lower-cased email.
    const testUser = createTestUser();
    const user = await db.user.create({ data: { ...testUser, email: testUser.email.toLowerCase() } });
    principal = { id: user.id, email: user.email, username: user.username, source: "bearer", scopes: ["kitchen:read", "kitchen:write"] };
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("creates a recipe with its steps in one batch, as the Prisma path does", async () => {
    const args = (title: string) => ({ title, description: "Hearty", servings: "4", sourceUrl: "https://example.com/beans", steps });
    const viaPrisma = await createdId(await callSpoonjoyApiOperation("create_recipe", args("Prisma Beans"), context()));
    const before = d1.roundTrips();
    const viaD1 = await createdId(await callSpoonjoyApiOperation("create_recipe", args("D1 Beans"), context(d1.binding)));

    expect(d1.statements.filter((statement) => statement.sql.startsWith("SELECT json(")).length).toBe(1);
    expect(d1.roundTrips() - before).toBe(1);
    expect(await graph(viaD1)).toEqual(await graph(viaPrisma));
  });

  it("reports a title taken between the check and the write, and rethrows other failures", async () => {
    const racing: D1ReadDatabase = {
      prepare: (sql) => d1.binding.prepare(sql),
      async batch(statements) {
        await db.recipe.create({ data: { title: "Race", chefId: principal.id } });
        return d1.binding.batch(statements as never);
      },
    };
    await expect(callSpoonjoyApiOperation("create_recipe", { title: "Race", steps }, context(racing)))
      .rejects.toThrow(ACTIVE_RECIPE_TITLE_CONFLICT_ERROR);
    await expect(db.recipe.count({ where: { title: "Race" } })).resolves.toBe(1);

    const failing: D1ReadDatabase = { prepare: (sql) => d1.binding.prepare(sql), batch: async () => { throw new Error("D1 is down"); } };
    await expect(callSpoonjoyApiOperation("create_recipe", { title: "Down", steps }, context(failing))).rejects.toThrow("D1 is down");
  });

  it.each([
    ["fields", { title: "Renamed", description: null, servings: "8", sourceUrl: null }],
    ["steps", { steps: [{ description: "Just one", ingredients: [{ name: "Rice", quantity: 1, unit: "cup" }] }] }],
    ["fields and steps", { description: "Both", steps: [] }],
  ])("updates %s in one batch, as the Prisma path does", async (_label, update) => {
    const seed = async (title: string) => createdId(await callSpoonjoyApiOperation("create_recipe", { title, steps }, context()));
    const viaPrisma = await seed("Update via Prisma");
    const viaD1 = await seed("Update via D1");
    const title = (id: string) => ("title" in update ? { title: `${update.title} ${id}` } : {});

    await callSpoonjoyApiOperation("update_recipe", { id: viaPrisma, ...update, ...title(viaPrisma) }, context());
    const before = d1.roundTrips();
    await callSpoonjoyApiOperation("update_recipe", { id: viaD1, ...update, ...title(viaD1) }, context(d1.binding));

    expect(d1.roundTrips() - before).toBe(1);
    expect(await graph(viaD1)).toEqual(await graph(viaPrisma));
  });

  it("leaves a recipe alone when there is nothing to update", async () => {
    const id = await createdId(await callSpoonjoyApiOperation("create_recipe", { title: "Untouched", steps }, context()));
    const before = d1.roundTrips();
    await callSpoonjoyApiOperation("update_recipe", { id }, context(d1.binding));
    expect(d1.roundTrips()).toBe(before);
  });

  it("stops an update whose title was taken, or whose recipe went away, before the write", async () => {
    const id = await createdId(await callSpoonjoyApiOperation("create_recipe", { title: "Mine", steps }, context()));
    const interleaved = (before: () => Promise<unknown>): D1ReadDatabase => ({
      prepare: (sql) => d1.binding.prepare(sql),
      async batch(statements) {
        await before();
        return d1.binding.batch(statements as never);
      },
    });

    await expect(callSpoonjoyApiOperation("update_recipe", { id, title: "Taken", steps: [] }, context(interleaved(
      () => db.recipe.create({ data: { title: "Taken", chefId: principal.id } }),
    )))).rejects.toThrow(ACTIVE_RECIPE_TITLE_CONFLICT_ERROR);
    expect((await graph(id)).steps).toHaveLength(2);

    await expect(callSpoonjoyApiOperation("update_recipe", { id, description: "Gone" }, context(interleaved(
      () => db.recipe.delete({ where: { id } }),
    )))).rejects.toThrow("Recipe not found");
  });
});
