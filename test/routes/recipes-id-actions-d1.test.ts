// @vitest-environment node
// The recipe page's action with a D1 binding: saving to a cookbook, taking a recipe out, making a
// cookbook from the Save dialog and deleting a cook all answer from D1, even when the request's
// Prisma client never answers (as in a poisoned isolate).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";

const platform = vi.hoisted(() => ({ getRequestDb: vi.fn() }));
vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: platform.getRequestDb,
}));

import { action } from "~/routes/recipes.$id";

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

async function makeChef(prefix: string) {
  const handle = faker.string.alphanumeric(8).toLowerCase();
  return createUser(db, `${prefix}-${handle}@example.com`, `${prefix}_${handle}`, "testPassword123");
}

type ActionResult = { init?: { status?: number }; data?: unknown } & Record<string, unknown>;

describe("recipes.$id action on a D1 binding", () => {
  let d1: SqliteD1;
  let chefId: string;
  let recipeId: string;
  let cookbookId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    platform.getRequestDb.mockReset();
    // A Prisma client that never answers: the D1 intents must not wait on it.
    platform.getRequestDb.mockImplementation(() => new Promise(() => {}));
    d1 = sqliteD1();
    chefId = (await makeChef("chef")).id;
    const owner = await makeChef("owner");
    recipeId = (await db.recipe.create({ data: { title: "Bread", chefId: owner.id } })).id;
    cookbookId = (await db.cookbook.create({ data: { title: "Weeknights", authorId: chefId } })).id;
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  async function post(fields: Record<string, string>, binding: unknown = d1.binding): Promise<ActionResult> {
    const body = new UndiciFormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    return action({
      request: new UndiciRequest(`http://localhost/recipes/${recipeId}`, {
        method: "POST",
        headers: { cookie: await sessionCookie(chefId) },
        body,
      }) as unknown as Request,
      params: { id: recipeId },
      context: { cloudflare: { env: { DB: binding } } } as never,
    } as never) as Promise<ActionResult>;
  }

  it("saves to and takes out of a cookbook without a Prisma client", async () => {
    expect(await post({ intent: "addToCookbook", cookbookId })).toEqual({ success: true });
    expect(await db.recipeInCookbook.count({ where: { cookbookId, recipeId } })).toBe(1);

    expect(await post({ intent: "removeFromCookbook", cookbookId })).toEqual({ success: true });
    expect(await db.recipeInCookbook.count({ where: { cookbookId, recipeId } })).toBe(0);
    expect(platform.getRequestDb).not.toHaveBeenCalled();
  });

  it("makes a cookbook from the Save dialog, and answers its errors in the dialog", async () => {
    const created = await post({ intent: "createCookbookAndSave", title: "  Breads  " });
    expect(created).toEqual({ success: true, newCookbook: { id: expect.any(String), title: "Breads" } });
    expect(await db.recipeInCookbook.count({ where: { recipeId } })).toBe(1);

    const duplicate = await post({ intent: "createCookbookAndSave", title: "Weeknights" });
    expect(duplicate.init?.status).toBe(400);
    expect(duplicate.data).toEqual({ error: "You already have a cookbook with this title", intent: "createCookbookAndSave" });

    const untitled = await post({ intent: "createCookbookAndSave", title: "   " });
    expect(untitled.init?.status).toBe(400);
    expect(untitled.data).toEqual({ error: "Title is required", intent: "createCookbookAndSave" });

    // The recipe is checked before the title, as on the Prisma path.
    await db.recipe.update({ where: { id: recipeId }, data: { deletedAt: new Date() } });
    await expect(post({ intent: "createCookbookAndSave", title: "" })).rejects.toMatchObject({ status: 404 });
    expect(platform.getRequestDb).not.toHaveBeenCalled();
  });

  it("deletes the chef's own cook, and answers 400, 403 and 404 as before", async () => {
    const spoon = await db.recipeSpoon.create({ data: { chefId, recipeId } });
    const someoneElses = await db.recipeSpoon.create({ data: { chefId: (await makeChef("cook")).id, recipeId } });

    await expect(post({ intent: "deleteSpoon" })).rejects.toMatchObject({ status: 400 });
    await expect(post({ intent: "deleteSpoon", spoonId: someoneElses.id })).rejects.toMatchObject({ status: 403 });
    await expect(post({ intent: "deleteSpoon", spoonId: "missing" })).rejects.toMatchObject({ status: 404 });

    expect(await post({ intent: "deleteSpoon", spoonId: spoon.id })).toEqual({ success: true });
    expect((await db.recipeSpoon.findUniqueOrThrow({ where: { id: spoon.id } })).deletedAt).toBeInstanceOf(Date);
    expect(platform.getRequestDb).not.toHaveBeenCalled();
  });

  it("answers product activation pending when the cutover trigger stops a batch", async () => {
    const stopped = {
      prepare: d1.binding.prepare,
      batch: async () => {
        throw new Error("D1_ERROR: saved_recipe_cutover_pending");
      },
    };
    const result = await post({ intent: "addToCookbook", cookbookId }, stopped);
    expect(result.init?.status).toBe(503);
    expect(result.data).toMatchObject({ error: { code: "product_activation_pending", retryable: true } });

    const created = await post({ intent: "createCookbookAndSave", title: "Breads" }, stopped);
    expect(created.init?.status).toBe(503);
  });

  it("rethrows any other batch failure", async () => {
    const broken = {
      prepare: d1.binding.prepare,
      batch: async () => {
        throw new Error("D1_ERROR: disk I/O error");
      },
    };
    await expect(post({ intent: "removeFromCookbook", cookbookId }, broken)).rejects.toThrow("disk I/O error");
    await expect(post({ intent: "createCookbookAndSave", title: "Breads" }, broken)).rejects.toThrow("disk I/O error");
  });

  it("leaves other intents, and a cookbook intent without a cookbook, to the Prisma path", async () => {
    platform.getRequestDb.mockImplementation(async () => db);
    // The chef does not own the recipe, so the owner check answers 403.
    await expect(post({ intent: "addToCookbook" })).rejects.toMatchObject({ status: 403 });
    await expect(post({ intent: "setRecipeNoCover" })).rejects.toMatchObject({ status: 403 });
    expect(platform.getRequestDb).toHaveBeenCalledTimes(2);
  });
});
