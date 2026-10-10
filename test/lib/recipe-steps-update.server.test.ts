// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { ApiPrincipal } from "~/lib/api-auth.server";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { getLocalDb } from "~/lib/db.server";
import { callSpoonjoyApiOperation, type SpoonjoyApiContext } from "~/lib/spoonjoy-api.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// update_recipe with steps used to delete every step, ingredient and "uses the output of step N"
// link and insert them again. Each agent edit therefore changed every step and ingredient id (cook
// progress is keyed by ingredient id) and silently dropped every link, which the tool could not
// even express. The steps are now updated in place, on the D1 batch and on the Prisma fallback.

let db: PrismaClient;
let d1: SqliteD1;
let principal: ApiPrincipal;

const PATHS = [
  ["a D1 binding", () => d1.binding as D1ReadDatabase],
  ["Prisma", () => undefined],
] as const;

function context(DB?: D1ReadDatabase): SpoonjoyApiContext {
  return { db, principal, env: DB ? { DB } : null };
}

const SOUP = [
  { title: "Soak", description: "Soak the beans", duration: 60, ingredients: [{ name: "Black Beans", quantity: 2, unit: "cup" }] },
  { description: "Chop the onion", ingredients: [{ name: "Onion", quantity: 1, unit: "whole" }, { name: "Garlic", quantity: 2, unit: "clove" }] },
  { description: "Simmer everything", ingredients: [{ name: "Water", quantity: 4, unit: "cup" }] },
];

/** A three-step soup whose step 3 uses the output of steps 1 and 2. */
async function seedSoup() {
  const created = await callSpoonjoyApiOperation("create_recipe", { title: `Soup ${crypto.randomUUID()}`, steps: SOUP }, context()) as {
    recipe: { id: string };
  };
  const recipeId = created.recipe.id;
  await db.stepOutputUse.createMany({
    data: [
      { recipeId, outputStepNum: 1, inputStepNum: 3 },
      { recipeId, outputStepNum: 2, inputStepNum: 3 },
    ],
  });
  return { recipeId, before: await snapshot(recipeId) };
}

async function snapshot(recipeId: string) {
  const steps = await db.recipeStep.findMany({
    where: { recipeId },
    orderBy: { stepNum: "asc" },
    include: { ingredients: { include: { unit: true, ingredientRef: true }, orderBy: { id: "asc" } } },
  });
  const uses = await db.stepOutputUse.findMany({ where: { recipeId }, orderBy: [{ inputStepNum: "asc" }, { outputStepNum: "asc" }] });
  return {
    steps: steps.map((step) => ({
      id: step.id,
      stepNum: step.stepNum,
      description: step.description,
      ingredients: Object.fromEntries(step.ingredients.map((ingredient) => [
        ingredient.ingredientRef.name,
        { id: ingredient.id, amount: `${ingredient.quantity} ${ingredient.unit.name}` },
      ])),
    })),
    uses: uses.map((use) => `${use.outputStepNum}->${use.inputStepNum}`),
  };
}

function ingredientIds(state: Awaited<ReturnType<typeof snapshot>>) {
  return Object.fromEntries(state.steps.flatMap((step) => Object.entries(step.ingredients).map(([name, row]) => [name, row.id])));
}

describe("update_recipe updates steps in place", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
    const testUser = createTestUser();
    const user = await db.user.create({ data: { ...testUser, email: testUser.email.toLowerCase() } });
    principal = { id: user.id, email: user.email, username: user.username, source: "bearer", scopes: ["kitchen:read", "kitchen:write"] };
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  describe.each(PATHS)("on %s", (_label, binding) => {
    it("keeps step ids, ingredient ids and output links when one step's text and amounts change", async () => {
      const { recipeId, before } = await seedSoup();
      const edited = structuredClone(SOUP);
      edited[1]!.description = "Dice the onion finely";
      edited[1]!.ingredients[1] = { name: "garlic", quantity: 3, unit: "Tbsp" };

      await callSpoonjoyApiOperation("update_recipe", { id: recipeId, steps: edited }, context(binding()));

      const after = await snapshot(recipeId);
      expect(after.steps.map((step) => step.id)).toEqual(before.steps.map((step) => step.id));
      expect(ingredientIds(after)).toEqual(ingredientIds(before));
      expect(after.steps[1]).toMatchObject({
        description: "Dice the onion finely",
        ingredients: { garlic: { amount: "3 tbsp" }, onion: { amount: "1 whole" } },
      });
      expect(after.uses).toEqual(["1->3", "2->3"]);
    });

    it("moves steps by id, carrying their ingredients and links with them", async () => {
      const { recipeId, before } = await seedSoup();
      const [soak, chop, simmer] = before.steps;

      await callSpoonjoyApiOperation("update_recipe", {
        id: recipeId,
        steps: [{ ...SOUP[1], id: chop!.id }, { ...SOUP[0], id: soak!.id }, { ...SOUP[2], id: simmer!.id }],
      }, context(binding()));

      const after = await snapshot(recipeId);
      expect(after.steps.map((step) => [step.id, step.stepNum, step.description])).toEqual([
        [chop!.id, 1, "Chop the onion"],
        [soak!.id, 2, "Soak the beans"],
        [simmer!.id, 3, "Simmer everything"],
      ]);
      expect(ingredientIds(after)).toEqual(ingredientIds(before));
      expect(after.uses).toEqual(["1->3", "2->3"]);
    });

    it("removes a left-out step with its ingredients and links, and adds a new one", async () => {
      const { recipeId, before } = await seedSoup();
      const [, chop, simmer] = before.steps;

      await callSpoonjoyApiOperation("update_recipe", {
        id: recipeId,
        steps: [
          { ...SOUP[1], id: chop!.id },
          { ...SOUP[2], id: simmer!.id },
          { description: "Season to taste", ingredients: [{ name: "Salt", quantity: 1, unit: "tsp" }], outputStepNums: [2] },
        ],
      }, context(binding()));

      const after = await snapshot(recipeId);
      expect(after.steps.map((step) => step.id).slice(0, 2)).toEqual([chop!.id, simmer!.id]);
      expect(before.steps.map((step) => step.id)).not.toContain(after.steps[2]!.id);
      expect(after.steps.map((step) => Object.keys(step.ingredients).sort())).toEqual([["garlic", "onion"], ["water"], ["salt"]]);
      expect(after.uses).toEqual(["1->2", "2->3"]);
      await expect(db.ingredient.count({ where: { recipeId } })).resolves.toBe(4);
    });

    it("sets output links from outputStepNums, and clears them with an empty list", async () => {
      const { recipeId } = await seedSoup();
      const relinked = [SOUP[0], { ...SOUP[1], outputStepNums: [1] }, { ...SOUP[2], outputStepNums: [2, 2] }];

      await callSpoonjoyApiOperation("update_recipe", { id: recipeId, steps: relinked }, context(binding()));
      expect((await snapshot(recipeId)).uses).toEqual(["1->2", "2->3"]);

      await callSpoonjoyApiOperation("update_recipe", {
        id: recipeId,
        steps: SOUP.map((step) => ({ ...step, outputStepNums: [] })),
      }, context(binding()));
      expect((await snapshot(recipeId)).uses).toEqual([]);
    });

    it("moves an ingredient to another step and keeps a step's ingredient when only its unit changes", async () => {
      const { recipeId, before } = await seedSoup();
      const edited = structuredClone(SOUP);
      edited[0]!.ingredients[0]!.unit = "g";
      edited[2]!.ingredients.push(edited[1]!.ingredients.pop()!);

      await callSpoonjoyApiOperation("update_recipe", { id: recipeId, steps: edited }, context(binding()));

      const after = await snapshot(recipeId);
      expect(after.steps[0]!.ingredients["black beans"]).toEqual({ id: ingredientIds(before)["black beans"], amount: "2 g" });
      expect(Object.keys(after.steps[1]!.ingredients)).toEqual(["onion"]);
      expect(after.steps[2]!.ingredients.garlic).toMatchObject({ amount: "2 clove" });
      expect(after.uses).toEqual(["1->3", "2->3"]);
    });

    it.each([
      ["an id that is not one of the recipe's steps", () => [{ ...SOUP[0], id: "not-a-step" }], "steps[0].id is not a step of this recipe"],
      ["the same id twice", (ids: string[]) => [{ ...SOUP[0], id: ids[0] }, { ...SOUP[1], id: ids[0] }], "steps[1].id is given for more than one step"],
      ["an ingredient in two steps", () => [SOUP[0], { ...SOUP[1], ingredients: [{ name: "black beans", quantity: 1, unit: "cup" }] }],
        "black beans is in steps[0] and steps[1]; a recipe lists each ingredient once"],
      ["an ingredient twice in one step", () => [{ ...SOUP[0], ingredients: [...SOUP[0]!.ingredients, ...SOUP[0]!.ingredients] }],
        "steps[0] lists black beans more than once"],
      ["a link to a later step", () => [{ ...SOUP[0], outputStepNums: [2] }, SOUP[1]], "steps[0].outputStepNums may only name earlier steps (1 to 0)"],
      ["a move that puts a step before the output it uses", (ids: string[]) => [{ ...SOUP[2], id: ids[2] }, { ...SOUP[0], id: ids[0] }, { ...SOUP[1], id: ids[1] }],
        "steps[0] uses the output of a step that would now come after it; give its outputStepNums"],
      ["outputStepNums that are not step numbers", () => [{ ...SOUP[0], outputStepNums: ["1"] }], "steps[0].outputStepNums must be an array of step numbers"],
    ])("rejects %s and changes nothing", async (_case, steps, message) => {
      const { recipeId, before } = await seedSoup();

      await expect(callSpoonjoyApiOperation("update_recipe", {
        id: recipeId,
        steps: steps(before.steps.map((step) => step.id)),
      }, context(binding()))).rejects.toThrow(message);

      expect(await snapshot(recipeId)).toEqual(before);
    });
  });

  it("plans again when another request changes the steps between the read and the batch", async () => {
    const { recipeId, before } = await seedSoup();
    let raced = false;
    const racing: D1ReadDatabase = {
      prepare: (sql) => d1.binding.prepare(sql),
      async batch(statements) {
        if (!raced) {
          raced = true;
          // Another editor removes step 3 (and its links) just before this batch runs.
          await db.recipeStep.delete({ where: { id: before.steps[2]!.id } });
        }
        return d1.binding.batch(statements as never);
      },
    };
    const edited = structuredClone(SOUP);
    edited[0]!.description = "Soak the beans overnight";

    await callSpoonjoyApiOperation("update_recipe", { id: recipeId, steps: edited }, context(racing));

    // The first batch changed nothing; the second was planned from the recipe as it then was.
    const after = await snapshot(recipeId);
    expect(after.steps.map((step) => step.id).slice(0, 2)).toEqual(before.steps.slice(0, 2).map((step) => step.id));
    expect(after.steps[0]!.description).toBe("Soak the beans overnight");
    expect(after.steps).toHaveLength(3);
    expect(after.uses).toEqual([]);
  });

  it("writes the D1 update as one batch that starts by re-checking the steps", async () => {
    const { recipeId } = await seedSoup();
    const before = d1.roundTrips();
    const firstStatement = d1.statements.length;

    await callSpoonjoyApiOperation("update_recipe", { id: recipeId, steps: SOUP }, context(d1.binding));

    const batch = d1.statements.slice(firstStatement);
    expect(d1.roundTrips() - before).toBe(1);
    expect(batch.filter((statement) => statement.sql.startsWith("SELECT json(")).length).toBe(2);
    expect(batch.some((statement) => statement.sql.startsWith('DELETE FROM "RecipeStep"'))).toBe(false);
  });
});
