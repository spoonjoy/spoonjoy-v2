// @vitest-environment node
// A kitchen moved from one Spoonjoy to another and back, through each one's real account export and the real writer:
// two migrated databases, each with Prisma over it as on the Worker. Coming back brings nothing new, then changes the
// recipe when only the other Spoonjoy changed it, and keeps the cook's version when both did.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { buildAccountExport } from "~/lib/account-export.server";
import { getDb } from "~/lib/db.server";
import { HOME_JOB, writeMovedInRecipe } from "~/domains/move-in/adapters/storage/recipe-writer.server";
import { spoonjoyRecipeDraft } from "~/domains/move-in/adapters/sources/spoonjoy-api/recipe";
import type { RecipeDraft } from "~/domains/move-in/model/recipe-draft";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";

const A = "https://a.example";
const B = "https://b.example";
const now = new Date("2026-11-26T12:00:00.000Z");

interface Server {
  database: MigratedSqlite;
  prisma: PrismaClient;
  address: string;
  cook: string;
}

let a: Server;
let b: Server;

async function server(address: string, cook: string): Promise<Server> {
  const database = migratedSqliteD1();
  database.sqlite.prepare(`INSERT INTO "User" ("id", "email", "username") VALUES (?, ?, ?)`).run(cook, `${cook}@example.com`, cook);
  return { database, prisma: await getDb({ DB: database.binding as never }), address, cook };
}

/** The cook's recipes on the server, as its export lists them, after a trip through JSON as over the API. */
async function exported(from: Server): Promise<Record<string, unknown>[]> {
  const answer = JSON.parse(JSON.stringify(await buildAccountExport(from.prisma, from.cook, from.address, now)));
  return answer.recipes;
}

/** Moves `from`'s kitchen into `to`, as a move-in from another Spoonjoy at `from`'s address does. */
async function move(from: Server, to: Server, jobId: string) {
  const sourceId = `${to.cook}-from-${from.cook}`;
  to.database.sqlite
    .prepare(`INSERT OR IGNORE INTO "ImportSource" ("id", "ownerId", "kind", "instanceKey", "label", "serverUrl") VALUES (?, ?, 'spoonjoy', ?, ?, ?)`)
    .run(sourceId, to.cook, from.cook, from.cook, from.address);
  const results = [];
  for (const recipe of await exported(from)) {
    const draft: RecipeDraft = spoonjoyRecipeDraft(recipe, from.cook, `${to.address}/`);
    results.push(await writeMovedInRecipe({ db: to.database.binding, sourceId, jobId, chefId: to.cook, draft, now, there: "on your other Spoonjoy" }));
  }
  return results;
}

const recipes = (on: Server) => on.database.sqlite.prepare(`SELECT "id", "title" FROM "Recipe" WHERE "deletedAt" IS NULL ORDER BY "createdAt"`).all();
const stepText = (on: Server, recipeId: string) =>
  on.database.sqlite.prepare(`SELECT "description" FROM "RecipeStep" WHERE "recipeId" = ? ORDER BY "stepNum"`).all(recipeId).map((row) => (row as { description: string }).description);

/** The cook changes a recipe's first step on that server, as editing it there does. */
function edit(on: Server, recipeId: string, text: string, at: string) {
  on.database.sqlite.prepare(`UPDATE "RecipeStep" SET "description" = ? WHERE "recipeId" = ? AND "stepNum" = 1`).run(text, recipeId);
  on.database.sqlite.prepare(`UPDATE "Recipe" SET "updatedAt" = ? WHERE "id" = ?`).run(at, recipeId);
}

beforeEach(async () => {
  a = await server(A, "ada");
  b = await server(B, "bea");
  // Ada's own recipe on A: written by the writer for its exact shape, then with its move-in record gone, as a recipe
  // she wrote there has none.
  a.database.sqlite.prepare(`INSERT INTO "ImportSource" ("id", "ownerId", "kind", "instanceKey", "label") VALUES ('seed', 'ada', 'seed', 'seed', 'seed')`).run();
  await writeMovedInRecipe({
    db: a.database.binding,
    sourceId: "seed",
    jobId: "seed",
    chefId: "ada",
    now,
    draft: {
      sourceKey: "seed-1", ownerKey: "seed", sourceUpdatedAt: null, title: "Focaccia", description: "A tray bake.", servings: "8", sourceUrl: null, photoPath: "",
      steps: [
        { sourceKey: "s1", title: "Dough", text: "Stir the dough.", ingredientKeys: ["flour"], duration: 10 },
        { sourceKey: "s2", title: null, text: "Bake until golden.", ingredientKeys: [], duration: 25, usesOutputOf: [1] },
      ],
      ingredients: [{ sourceKey: "flour", section: null, quantity: 500, unit: "g", food: "bread flour", note: null, originalText: null, plainText: false }],
      notes: [], tags: [], categories: [], tools: [], warnings: [],
    },
  });
  a.database.sqlite.exec(`DELETE FROM "SourceRecord"; DELETE FROM "ImportSource"`);
});

afterEach(async () => {
  await a.prisma.$disconnect();
  await b.prisma.$disconnect();
  a.database.close();
  b.database.close();
});

describe("a kitchen moved to another Spoonjoy and back", () => {
  it("comes back with nothing new, and moving back again still adds nothing", async () => {
    const [focaccia] = recipes(a) as Array<{ id: string }>;
    expect(await move(a, b, "job-ab")).toEqual([expect.objectContaining({ outcome: "created" })]);
    // The step that bakes the dough still uses it on the other Spoonjoy.
    expect(b.database.sqlite.prepare(`SELECT "outputStepNum", "inputStepNum" FROM "StepOutputUse"`).all()).toEqual([{ outputStepNum: 1, inputStepNum: 2 }]);

    expect(await move(b, a, "job-ba")).toEqual([{ outcome: "unchanged", recipeId: focaccia.id, jobId: HOME_JOB }]);
    expect(await move(b, a, "job-ba-2")).toEqual([{ outcome: "unchanged", recipeId: focaccia.id, jobId: HOME_JOB }]);
    expect(recipes(a)).toEqual([{ id: focaccia.id, title: "Focaccia" }]);
    // And out again, to the Spoonjoy it came back from: B finds its own copy by A's id, as any move-in again does.
    expect(await move(a, b, "job-ab-2")).toEqual([expect.objectContaining({ outcome: "unchanged" })]);
    expect(recipes(b)).toHaveLength(1);
  });

  it("changes the recipe when only the other Spoonjoy changed it, and keeps the cook's when both did", async () => {
    const [focaccia] = recipes(a) as Array<{ id: string }>;
    await move(a, b, "job-ab");
    const [there] = recipes(b) as Array<{ id: string }>;

    edit(b, there.id, "Stir the dough well.", "2026-11-27T00:00:00.000Z");
    expect(await move(b, a, "job-ba")).toEqual([{ outcome: "updated", recipeId: focaccia.id }]);
    expect(stepText(a, focaccia.id)).toEqual(["Stir the dough well.", "Bake until golden."]);
    expect(a.database.sqlite.prepare(`SELECT "outputStepNum", "inputStepNum" FROM "StepOutputUse"`).all()).toEqual([{ outputStepNum: 1, inputStepNum: 2 }]);
    expect(a.database.sqlite.prepare(`SELECT "duration" FROM "RecipeStep" WHERE "recipeId" = ? ORDER BY "stepNum"`).all(focaccia.id)).toEqual([{ duration: 10 }, { duration: 25 }]);

    edit(b, there.id, "Stir the dough by hand.", "2026-11-28T00:00:00.000Z");
    edit(a, focaccia.id, "Stir the dough with a spoon.", "2026-11-28T00:00:00.000Z");
    expect(await move(b, a, "job-ba-2")).toEqual([expect.objectContaining({ outcome: "kept", recipeId: focaccia.id, reason: "Focaccia changed on your other Spoonjoy, but you've changed it in Spoonjoy too, so your version stays." })]);
    expect(stepText(a, focaccia.id)[0]).toBe("Stir the dough with a spoon.");
    expect(recipes(a)).toHaveLength(1);
  });

  it("brings the recipe anew when the one it started as here isn't the cook's, and leaves one the cook deleted", async () => {
    const [focaccia] = recipes(a) as Array<{ id: string }>;
    await move(a, b, "job-ab");
    // Another cook on A moves Bea's kitchen in: Ada's recipe isn't theirs, so it comes in as a new one.
    a.database.sqlite.prepare(`INSERT INTO "User" ("id", "email", "username") VALUES ('cy', 'cy@example.com', 'cy')`).run();
    const theirs = { ...a, cook: "cy" };
    expect(await move(b, theirs, "job-cy")).toEqual([expect.objectContaining({ outcome: "created" })]);

    a.database.sqlite.prepare(`UPDATE "Recipe" SET "deletedAt" = ? WHERE "id" = ?`).run(now.toISOString(), focaccia.id);
    expect(await move(b, a, "job-ba")).toEqual([
      { outcome: "skipped", recipeId: focaccia.id, reason: "You deleted this recipe here after it moved to your other Spoonjoy." },
    ]);
  });
});
