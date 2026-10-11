// @vitest-environment node
// Editing and deleting a cook's log entry (the API's spoon update and delete) when D1's
// connection drops. After each outcome (the write never ran, it committed but its answer was
// lost, or it committed late) the entry has the patch's values, or is deleted at one time, and a
// write the database never takes fails as retryable.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { deleteSpoon, updateSpoon } from "~/lib/recipe-spoon.server";
import { cleanupDatabase } from "../helpers/cleanup";
import type { FlakyOutcome } from "../helpers/flaky-d1";
import { flakyPrisma } from "../helpers/flaky-prisma";
import { createTestRecipe, createTestUser } from "../utils";

const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];

let db: PrismaClient;
let chefId: string;
let spoonId: string;

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
  chefId = (await db.user.create({ data: createTestUser() })).id;
  const recipe = await db.recipe.create({ data: { ...createTestRecipe(chefId), chefId } });
  spoonId = (await db.recipeSpoon.create({ data: { chefId, recipeId: recipe.id, note: "First cook" } })).id;
});

afterEach(async () => {
  await cleanupDatabase();
});

describe("spoon writes after a transient D1 error", () => {
  it.each(OUTCOMES)("updates the entry to the patch's values (%s)", async (outcome) => {
    const flaky = flakyPrisma(db);
    flaky.failNext("recipeSpoon", "update", outcome);

    const updated = await updateSpoon(flaky.db, spoonId, chefId, { note: "  Less salt  ", nextTime: "Bake longer" });

    expect(flaky.failures()).toBe(1);
    expect(updated).toMatchObject({ id: spoonId, note: "Less salt", nextTime: "Bake longer" });
    await expect(db.recipeSpoon.findUniqueOrThrow({ where: { id: spoonId } })).resolves.toMatchObject({ note: "Less salt", nextTime: "Bake longer" });
  });

  it.each(OUTCOMES)("deletes the entry at one time (%s)", async (outcome) => {
    const flaky = flakyPrisma(db);
    flaky.failNext("recipeSpoon", "update", outcome);

    const deleted = await deleteSpoon(flaky.db, spoonId, chefId);

    expect(flaky.failures()).toBe(1);
    expect(deleted.deletedAt).toBeInstanceOf(Date);
    await expect(db.recipeSpoon.findUniqueOrThrow({ where: { id: spoonId } })).resolves.toMatchObject({ deletedAt: deleted.deletedAt });
  });

  it.each([
    ["an update", "spoon.update", (client: PrismaClient) => updateSpoon(client, spoonId, chefId, { note: "Never saved" })],
    ["a delete", "spoon.delete.prisma", (client: PrismaClient) => deleteSpoon(client, spoonId, chefId)],
  ] as const)("gives up on %s with a retryable error, leaving the entry as it was", async (_label, scope, write) => {
    const flaky = flakyPrisma(db);
    flaky.failNext("recipeSpoon", "update", "lost", "lost", "lost", "lost");

    const failure = write(flaky.db);

    await expect(failure).rejects.toBeInstanceOf(D1WriteUnavailableError);
    await expect(failure).rejects.toMatchObject({ scope });
    await expect(db.recipeSpoon.findUniqueOrThrow({ where: { id: spoonId } })).resolves.toMatchObject({ note: "First cook", deletedAt: null });
  });
});
