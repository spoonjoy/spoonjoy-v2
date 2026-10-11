// @vitest-environment node
// Deleting a recipe from its page on D1 when D1's connection drops. The soft delete and its
// native sync tombstone are one batch, guarded by "the recipe is still there". After each outcome
// (the batch never ran, it committed but its answer was lost, or it committed late) the recipe is
// deleted once, with one tombstone, and the chef goes to their recipes, not to a 404. When the
// database stays unavailable the page answers a retryable 503 and the recipe is still there.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { flakyD1, type FlakyOutcome } from "../helpers/flaky-d1";

const platform = vi.hoisted(() => ({ getRequestDb: vi.fn() }));
vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: platform.getRequestDb,
}));

import { action } from "~/routes/recipes.$id";

const DELETE_BATCH = /UPDATE "Recipe" SET "deletedAt"/;

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

let d1: SqliteD1;
let ownerId: string;
let recipeId: string;

beforeEach(async () => {
  await cleanupDatabase();
  platform.getRequestDb.mockReset();
  // A Prisma client that never answers: the delete runs on D1 alone.
  platform.getRequestDb.mockImplementation(() => new Promise(() => {}));
  d1 = sqliteD1();
  const handle = faker.string.alphanumeric(8).toLowerCase();
  ownerId = (await createUser(db, `owner-${handle}@example.com`, `owner_${handle}`, "testPassword123")).id;
  recipeId = (await db.recipe.create({ data: { title: "Bread", description: "Crusty", chefId: ownerId } })).id;
});

afterEach(async () => {
  d1.close();
  await cleanupDatabase();
});

async function deleteRecipe(binding: unknown) {
  const body = new UndiciFormData();
  body.append("intent", "delete");
  return action({
    request: new UndiciRequest(`http://localhost/recipes/${recipeId}`, {
      method: "POST",
      headers: { cookie: await sessionCookie(ownerId) },
      body,
    }) as unknown as Request,
    params: { id: recipeId },
    context: { cloudflare: { env: { DB: binding } } } as never,
  } as never) as Promise<unknown>;
}

async function deletedState() {
  const recipe = await db.recipe.findUniqueOrThrow({ where: { id: recipeId }, select: { deletedAt: true } });
  const tombstones = await db.nativeSyncTombstone.count({ where: { resourceType: "recipe", resourceId: recipeId } });
  return { deleted: recipe.deletedAt !== null, tombstones };
}

describe("deleting a recipe on D1 after a transient error", () => {
  it.each<FlakyOutcome>(["lost", "lost-answer", "late"])("deletes it once and goes to the recipes (%s)", async (outcome) => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(DELETE_BATCH, outcome);

    const result = await deleteRecipe(flaky.binding);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
    expect((result as Response).headers.get("Location")).toBe("/recipes");
    expect(flaky.failures()).toBe(1);
    await expect(deletedState()).resolves.toEqual({ deleted: true, tombstones: 1 });
  });

  it("answers a retryable 503 and keeps the recipe when the database stays unavailable", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(DELETE_BATCH, "lost", "lost", "lost", "lost");

    const result = await deleteRecipe(flaky.binding) as { init?: ResponseInit; data?: unknown };

    expect(result.init?.status).toBe(503);
    expect(new Headers(result.init?.headers).get("Retry-After")).toBe("1");
    expect(result.data).toMatchObject({ intent: "delete", errorCode: "temporarily_unavailable", retryable: true });
    await expect(deletedState()).resolves.toEqual({ deleted: false, tombstones: 0 });
  });

  it("still answers 404 for a recipe someone else deleted in between", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(DELETE_BATCH, "lost");
    // The chef's other tab deletes it while this request's first try is lost.
    let otherTabDeleted = false;
    const binding = {
      ...flaky.binding,
      batch: async (statements: never[]) => {
        if (flaky.failures() === 1 && !otherTabDeleted) {
          otherTabDeleted = true;
          await db.recipe.update({ where: { id: recipeId }, data: { deletedAt: new Date("2026-01-01T00:00:00.000Z") } });
        }
        return flaky.binding.batch(statements);
      },
    };

    await expect(deleteRecipe(binding)).rejects.toMatchObject({ status: 404 });
    expect(otherTabDeleted).toBe(true);
    await expect(db.nativeSyncTombstone.count({ where: { resourceId: recipeId } })).resolves.toBe(0);
  });
});
