// @vitest-environment node
// The Cooking now list: what each cook-session write records, when a recipe leaves the list, the
// order it is read in, and that a dropped D1 connection never leaves a second or stale row.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import {
  COOKING_NOW_DONE_MS,
  COOKING_NOW_IDLE_MS,
  listCookingNow,
  recordCookingNow,
  type CookingNowWrite,
} from "~/lib/cooking-now.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { flakyD1, type FlakyOutcome } from "../helpers/flaky-d1";
import { createTestRecipe, createTestUser, getOrCreateIngredientRef, getOrCreateUnit } from "../utils";

const UPSERT = /DELETE FROM "CookingNow"/;
const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);

let db: PrismaClient;
let d1: SqliteD1;
let userId: string;
let otherUserId: string;
let recipeId: string;
let stepIds: string[];

/** A recipe with three steps, three ingredients and one step output: four items to check. */
async function recipeWithSteps(chefId: string, title?: string) {
  const recipe = await db.recipe.create({ data: { ...createTestRecipe(chefId), ...(title ? { title } : {}) } });
  const unit = await getOrCreateUnit(db, "cup");
  const ref = await getOrCreateIngredientRef(db, "rice");
  const ids: string[] = [];
  for (const stepNum of [1, 2, 3]) {
    ids.push((await db.recipeStep.create({ data: { recipeId: recipe.id, stepNum, description: `Step ${stepNum}` } })).id);
  }
  for (const stepNum of [1, 1, 2]) {
    await db.ingredient.create({ data: { recipeId: recipe.id, stepNum, quantity: 1, unitId: unit.id, ingredientRefId: ref.id } });
  }
  await db.stepOutputUse.create({ data: { recipeId: recipe.id, outputStepNum: 1, inputStepNum: 3 } });
  return { id: recipe.id, stepIds: ids };
}

function write(overrides: Partial<CookingNowWrite> = {}): CookingNowWrite {
  return {
    userId,
    recipeId,
    attemptId: ATTEMPT,
    revision: 1,
    activeStepId: stepIds[0],
    activeStepIndex: 0,
    checkedCount: 1,
    touchedAt: T0,
    ...overrides,
  };
}

const row = () => db.cookingNow.findUnique({ where: { userId_recipeId: { userId, recipeId } } });
const listed = async (now = T0) => (await listCookingNow(db, userId, now)).map((entry) => entry.recipe.id);

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
  d1 = sqliteD1();
  userId = (await db.user.create({ data: createTestUser() })).id;
  otherUserId = (await db.user.create({ data: createTestUser() })).id;
  ({ id: recipeId, stepIds } = await recipeWithSteps(userId));
});

afterEach(async () => {
  d1.close();
  await cleanupDatabase();
});

describe("recording a cook-session write", () => {
  it("stores the step, the counts from the recipe as it is now, and the touch time", async () => {
    await recordCookingNow(d1.binding, write({ activeStepId: stepIds[1], activeStepIndex: 1, checkedCount: 2 }));

    expect(await row()).toMatchObject({
      attemptId: ATTEMPT,
      revision: 1,
      listed: true,
      activeStepId: stepIds[1],
      activeStepIndex: 1,
      stepCount: 3,
      checkedCount: 2,
      totalCount: 4,
      allCheckedAt: null,
      touchedAt: BigInt(T0),
    });
  });

  it("never counts more checked items than the recipe has", async () => {
    await recordCookingNow(d1.binding, write({ checkedCount: 9 }));

    expect(await row()).toMatchObject({ checkedCount: 4, totalCount: 4, allCheckedAt: BigInt(T0) });
  });

  it("does not list a new session with no progress (a start before the first check)", async () => {
    await recordCookingNow(d1.binding, write({ revision: 0, checkedCount: 0 }));

    expect(await row()).toMatchObject({ listed: false });
    expect(await listed()).toEqual([]);
  });

  it("lists a session whose only progress is a step past the first", async () => {
    await recordCookingNow(d1.binding, write({ checkedCount: 0, activeStepId: stepIds[2], activeStepIndex: 2 }));

    expect(await listed()).toEqual([recipeId]);
  });

  it("updates one row per user and recipe", async () => {
    await recordCookingNow(d1.binding, write());
    await recordCookingNow(d1.binding, write({ revision: 2, checkedCount: 3, touchedAt: T0 + 1000 }));

    expect(await db.cookingNow.count()).toBe(1);
    expect(await row()).toMatchObject({ revision: 2, checkedCount: 3, touchedAt: BigInt(T0 + 1000) });
  });

  it("ignores a write older than the row, which can reach D1 after a newer one", async () => {
    await recordCookingNow(d1.binding, write({ revision: 5, checkedCount: 3, touchedAt: T0 + 5000 }));
    await recordCookingNow(d1.binding, write({ revision: 4, checkedCount: 1, touchedAt: T0 + 4000 }));

    expect(await row()).toMatchObject({ revision: 5, checkedCount: 3, touchedAt: BigInt(T0 + 5000) });
  });

  it("takes a write from a new attempt whatever its revision", async () => {
    await recordCookingNow(d1.binding, write({ revision: 5, checkedCount: 3 }));
    await recordCookingNow(d1.binding, write({
      attemptId: "22222222-2222-4222-8222-222222222222",
      revision: 1,
      checkedCount: 1,
      touchedAt: T0 + 1000,
    }));

    expect(await row()).toMatchObject({ revision: 1, checkedCount: 1 });
  });

  it("keeps the touch time from going backwards when the same revision comes again", async () => {
    await recordCookingNow(d1.binding, write({ touchedAt: T0 + 1000 }));
    await recordCookingNow(d1.binding, write({ touchedAt: T0 }));

    expect(await row()).toMatchObject({ touchedAt: BigInt(T0 + 1000) });
  });

  it("keeps the first time everything was checked while it stays all checked, and forgets it after an uncheck", async () => {
    await recordCookingNow(d1.binding, write({ revision: 1, checkedCount: 4, touchedAt: T0 }));
    await recordCookingNow(d1.binding, write({ revision: 2, checkedCount: 4, touchedAt: T0 + 1000, activeStepIndex: 2, activeStepId: stepIds[2] }));
    expect(await row()).toMatchObject({ allCheckedAt: BigInt(T0) });

    await recordCookingNow(d1.binding, write({ revision: 3, checkedCount: 3, touchedAt: T0 + 2000 }));
    expect(await row()).toMatchObject({ allCheckedAt: null });
  });

  it("keeps each cook's rows apart", async () => {
    await recordCookingNow(d1.binding, write());
    await recordCookingNow(d1.binding, write({ userId: otherUserId, checkedCount: 0, activeStepIndex: 0 }));

    expect(await listed()).toEqual([recipeId]);
    expect(await listCookingNow(db, otherUserId, T0)).toEqual([]);
  });

  it("prunes the cook's rows no reader would return, and leaves other cooks' rows", async () => {
    const stale = await recipeWithSteps(userId);
    const done = await recipeWithSteps(userId);
    await recordCookingNow(d1.binding, write({ recipeId: stale.id, touchedAt: T0 - COOKING_NOW_IDLE_MS }));
    await recordCookingNow(d1.binding, write({ recipeId: done.id, checkedCount: 4, touchedAt: T0 - COOKING_NOW_DONE_MS }));
    await recordCookingNow(d1.binding, write({ userId: otherUserId, recipeId: stale.id, touchedAt: T0 - COOKING_NOW_IDLE_MS }));

    await recordCookingNow(d1.binding, write());

    expect((await db.cookingNow.findMany({ select: { userId: true, recipeId: true } })).sort((a, b) => a.userId.localeCompare(b.userId)))
      .toEqual([
        { userId, recipeId },
        { userId: otherUserId, recipeId: stale.id },
      ].sort((a, b) => a.userId.localeCompare(b.userId)));
  });
});

describe("Clear progress", () => {
  it("takes the recipe off the list when the checks go from some to none", async () => {
    await recordCookingNow(d1.binding, write({ revision: 1, checkedCount: 2, activeStepIndex: 1, activeStepId: stepIds[1] }));
    await recordCookingNow(d1.binding, write({ revision: 2, checkedCount: 0, activeStepIndex: 1, activeStepId: stepIds[1], touchedAt: T0 + 1000 }));

    expect(await row()).toMatchObject({ listed: false });
    expect(await listed(T0 + 1000)).toEqual([]);
  });

  it("stays off the list for writes that only change the scale", async () => {
    await recordCookingNow(d1.binding, write({ revision: 1, checkedCount: 2, activeStepIndex: 1, activeStepId: stepIds[1] }));
    await recordCookingNow(d1.binding, write({ revision: 2, checkedCount: 0, activeStepIndex: 1, activeStepId: stepIds[1] }));
    await recordCookingNow(d1.binding, write({ revision: 3, checkedCount: 0, activeStepIndex: 1, activeStepId: stepIds[1] }));

    expect(await listed()).toEqual([]);
  });

  it("comes back on the list when the cook checks something or moves to another step", async () => {
    await recordCookingNow(d1.binding, write({ revision: 1, checkedCount: 2 }));
    await recordCookingNow(d1.binding, write({ revision: 2, checkedCount: 0 }));
    await recordCookingNow(d1.binding, write({ revision: 3, checkedCount: 0, activeStepIndex: 1, activeStepId: stepIds[1] }));
    expect(await listed()).toEqual([recipeId]);

    await recordCookingNow(d1.binding, write({ revision: 4, checkedCount: 1, activeStepIndex: 1, activeStepId: stepIds[1] }));
    await recordCookingNow(d1.binding, write({ revision: 5, checkedCount: 0, activeStepIndex: 1, activeStepId: stepIds[1] }));
    expect(await listed()).toEqual([]);
    await recordCookingNow(d1.binding, write({ revision: 6, checkedCount: 1, activeStepIndex: 1, activeStepId: stepIds[1] }));
    expect(await listed()).toEqual([recipeId]);
  });

  it("treats a step kept by id that moved as a step change", async () => {
    await recordCookingNow(d1.binding, write({ revision: 1, checkedCount: 1, activeStepIndex: 1, activeStepId: stepIds[1] }));
    await recordCookingNow(d1.binding, write({ revision: 2, checkedCount: 0, activeStepIndex: 1, activeStepId: stepIds[1] }));
    await recordCookingNow(d1.binding, write({ revision: 3, checkedCount: 0, activeStepIndex: 1, activeStepId: null }));

    expect(await listed()).toEqual([recipeId]);
  });
});

describe("reading the list", () => {
  it("returns the cook's recipes newest first, with what a card shows", async () => {
    const second = await recipeWithSteps(userId, "Second recipe");
    await recordCookingNow(d1.binding, write({ touchedAt: T0 - 2000, activeStepIndex: 2, activeStepId: stepIds[2], checkedCount: 4 }));
    await recordCookingNow(d1.binding, write({ recipeId: second.id, touchedAt: T0 - 1000, activeStepId: second.stepIds[1], activeStepIndex: 1 }));

    const rows = await listCookingNow(db, userId, T0);

    expect(rows.map((entry) => entry.recipe.title)).toEqual(["Second recipe", expect.any(String)]);
    expect(rows[1]).toEqual({
      recipe: expect.objectContaining({ id: recipeId, activeCover: null }),
      activeStepId: stepIds[2],
      activeStepIndex: 2,
      stepCount: 3,
      checkedCount: 4,
      totalCount: 4,
      allCheckedAt: new Date(T0 - 2000),
      touchedAt: new Date(T0 - 2000),
      expiresAt: new Date(T0 - 2000 + COOKING_NOW_DONE_MS),
    });
    expect(rows[0]).toMatchObject({ allCheckedAt: null, expiresAt: new Date(T0 - 1000 + COOKING_NOW_IDLE_MS) });
  });

  it("orders recipes touched at the same moment by recipe id", async () => {
    const second = await recipeWithSteps(userId);
    await recordCookingNow(d1.binding, write());
    await recordCookingNow(d1.binding, write({ recipeId: second.id }));

    expect(await listed()).toEqual([recipeId, second.id].sort());
  });

  it("drops a recipe three days after its last touch", async () => {
    await recordCookingNow(d1.binding, write());

    expect(await listed(T0 + COOKING_NOW_IDLE_MS - 1)).toEqual([recipeId]);
    expect(await listed(T0 + COOKING_NOW_IDLE_MS)).toEqual([]);
  });

  it("drops a recipe thirty minutes after everything was checked", async () => {
    await recordCookingNow(d1.binding, write({ checkedCount: 4 }));

    expect(await listed(T0 + COOKING_NOW_DONE_MS - 1)).toEqual([recipeId]);
    expect(await listed(T0 + COOKING_NOW_DONE_MS)).toEqual([]);
  });

  it("drops a recipe the cook logged a cook of at or after the last touch, until the next write", async () => {
    await recordCookingNow(d1.binding, write());
    await db.recipeSpoon.create({ data: { chefId: userId, recipeId, createdAt: new Date(T0 - 1) } });
    expect(await listed()).toEqual([recipeId]);

    await db.recipeSpoon.create({ data: { chefId: userId, recipeId, createdAt: new Date(T0) } });
    expect(await listed()).toEqual([]);

    await recordCookingNow(d1.binding, write({ revision: 2, touchedAt: T0 + 1000 }));
    expect(await listed(T0 + 1000)).toEqual([recipeId]);
  });

  it("ignores deleted cooks and other cooks' cooks", async () => {
    const second = await recipeWithSteps(userId);
    await recordCookingNow(d1.binding, write());
    await recordCookingNow(d1.binding, write({ recipeId: second.id }));
    await db.recipeSpoon.create({ data: { chefId: userId, recipeId, createdAt: new Date(T0 + 1), deletedAt: new Date(T0 + 2) } });
    await db.recipeSpoon.create({ data: { chefId: otherUserId, recipeId, createdAt: new Date(T0 + 1) } });
    await db.recipeSpoon.create({ data: { chefId: userId, recipeId: second.id, createdAt: new Date(T0 + 1) } });

    expect(await listed()).toEqual([recipeId]);
  });

  it("reads at the current time by default", async () => {
    await recordCookingNow(d1.binding, write({ touchedAt: Date.now() }));

    expect((await listCookingNow(db, userId)).map((entry) => entry.recipe.id)).toEqual([recipeId]);
  });

  it("drops a deleted recipe", async () => {
    await recordCookingNow(d1.binding, write());
    await db.recipe.update({ where: { id: recipeId }, data: { deletedAt: new Date(T0) } });

    expect(await listed()).toEqual([]);
  });

  it("returns at most fifty recipes", async () => {
    for (let index = 0; index < 51; index += 1) {
      const recipe = await db.recipe.create({ data: createTestRecipe(userId) });
      await recordCookingNow(d1.binding, write({ recipeId: recipe.id, activeStepId: null, activeStepIndex: 1, touchedAt: T0 - index }));
    }

    expect(await listCookingNow(db, userId, T0)).toHaveLength(50);
  });
});

describe("when D1's connection drops", () => {
  it.each(OUTCOMES)("leaves the row of one clean write when a try is %s", async (outcome) => {
    await recordCookingNow(d1.binding, write({ revision: 1, checkedCount: 2 }));
    const flaky = flakyD1(d1.binding);
    flaky.failNext(UPSERT, outcome);

    await recordCookingNow(flaky.binding, write({ revision: 2, checkedCount: 0, touchedAt: T0 + 1000 }));

    expect(flaky.failures()).toBe(1);
    expect(await db.cookingNow.count()).toBe(1);
    expect(await row()).toMatchObject({ revision: 2, checkedCount: 0, listed: false, touchedAt: BigInt(T0 + 1000) });
  });

  it("gives up with a retryable error, writing nothing, when every try is lost", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(UPSERT, "lost", "lost", "lost", "lost");

    await expect(recordCookingNow(flaky.binding, write())).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await row()).toBeNull();
  });
});
