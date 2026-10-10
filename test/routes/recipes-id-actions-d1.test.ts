// @vitest-environment node
// The recipe page's action with a D1 binding: saving to a cookbook, taking a recipe out, making a
// cookbook from the Save dialog, deleting a cook, the owner's cover choices and moving the recipe
// to the trash all answer from
// D1, even when the request's Prisma client never answers (as in a poisoned isolate).
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

  async function post(
    fields: Record<string, string>,
    binding: unknown = d1.binding,
    id: string = recipeId,
  ): Promise<ActionResult> {
    const body = new UndiciFormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    return action({
      request: new UndiciRequest(`http://localhost/recipes/${id}`, {
        method: "POST",
        headers: { cookie: await sessionCookie(chefId) },
        body,
      }) as unknown as Request,
      params: { id },
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

  it("sets, archives and clears the owner's cover without a Prisma client", async () => {
    const ownId = (await db.recipe.create({ data: { title: "Soup", chefId } })).id;
    const [first, second] = await Promise.all(["one", "two"].map((name) =>
      db.recipeCover.create({ data: { recipeId: ownId, imageUrl: `https://example.com/${name}.jpg`, sourceType: "chef-upload" } })));
    await db.recipe.update({ where: { id: ownId }, data: { activeCoverId: first!.id, activeCoverVariant: "image", coverMode: "manual" } });
    const recipe = () => db.recipe.findUniqueOrThrow({ where: { id: ownId } });

    expect(await post({ intent: "setRecipeCover", coverId: second!.id, variant: "image" }, d1.binding, ownId))
      .toEqual({ success: true, intent: "setRecipeCover" });
    expect(await recipe()).toMatchObject({ activeCoverId: second!.id, activeCoverVariant: "image" });

    expect(await post({
      intent: "archiveRecipeCover", coverId: second!.id, replacementCoverId: first!.id, replacementVariant: "image",
    }, d1.binding, ownId)).toEqual({ success: true, intent: "archiveRecipeCover" });
    expect((await recipe()).activeCoverId).toBe(first!.id);
    expect((await db.recipeCover.findUniqueOrThrow({ where: { id: second!.id } })).status).toBe("archived");

    expect(await post({ intent: "setRecipeNoCover", confirmNoCover: "true" }, d1.binding, ownId))
      .toEqual({ success: true, intent: "setRecipeNoCover" });
    expect(await recipe()).toMatchObject({ activeCoverId: null, activeCoverVariant: null, coverMode: "none" });
    expect(platform.getRequestDb).not.toHaveBeenCalled();
  });

  it("answers the cover choices' 400, 403 and 404 as the Prisma path does", async () => {
    const ownId = (await db.recipe.create({ data: { title: "Soup", chefId } })).id;
    const cover = await db.recipeCover.create({ data: { recipeId: ownId, imageUrl: "https://example.com/c.jpg", sourceType: "chef-upload" } });
    await db.recipe.update({ where: { id: ownId }, data: { activeCoverId: cover.id, activeCoverVariant: "image", coverMode: "manual" } });
    const answer = (fields: Record<string, string>, id = ownId) =>
      post(fields, d1.binding, id).then(() => null, (error: Response) => error.status);

    expect(await answer({ intent: "setRecipeCover", variant: "image" })).toBe(400);
    expect(await answer({ intent: "setRecipeCover", coverId: cover.id, variant: "poster" })).toBe(400);
    expect(await answer({ intent: "setRecipeNoCover" })).toBe(400);
    expect(await answer({ intent: "archiveRecipeCover" })).toBe(400);
    expect(await answer({ intent: "archiveRecipeCover", coverId: cover.id, replacementCoverId: "other" })).toBe(400);
    const refused = await post({ intent: "archiveRecipeCover", coverId: cover.id }, d1.binding, ownId).catch((error: Response) => error);
    expect(await (refused as Response).text()).toBe("Archiving the active cover requires a replacement or confirmNoCover");

    // Someone else's recipe answers 403; a missing or deleted one answers 404.
    expect(await answer({ intent: "setRecipeNoCover", confirmNoCover: "true" }, recipeId)).toBe(403);
    expect(await answer({ intent: "setRecipeNoCover", confirmNoCover: "true" }, "missing")).toBe(404);
    await db.recipe.update({ where: { id: ownId }, data: { deletedAt: new Date() } });
    expect(await answer({ intent: "setRecipeNoCover", confirmNoCover: "true" })).toBe(404);
    expect(await db.recipeCover.count({ where: { recipeId: ownId, status: "archived" } })).toBe(0);
    expect(platform.getRequestDb).not.toHaveBeenCalled();
  });

  it("moves the owner's recipe to the trash with its sync tombstone, without a Prisma client", async () => {
    const ownId = (await db.recipe.create({ data: { title: "Soup", chefId } })).id;
    const before = d1.roundTrips();

    const answer = (await post({ intent: "delete" }, d1.binding, ownId)) as unknown as Response;

    expect(answer.status).toBe(302);
    expect(answer.headers.get("Location")).toBe("/recipes");
    // The session check, the owner read, and one write batch.
    expect(d1.roundTrips() - before).toBe(3);
    const trashed = await db.recipe.findUniqueOrThrow({ where: { id: ownId } });
    expect(trashed.deletedAt).toBeInstanceOf(Date);
    const tombstone = await db.nativeSyncTombstone.findFirstOrThrow({ where: { resourceType: "recipe", resourceId: ownId } });
    expect(tombstone).toMatchObject({ accountId: chefId, title: "Soup" });
    expect(tombstone.deletedAt.getTime()).toBe(trashed.deletedAt!.getTime());
    expect(platform.getRequestDb).not.toHaveBeenCalled();
  });

  it("answers a delete of someone else's recipe 403, and of a missing or trashed one 404", async () => {
    await expect(post({ intent: "delete" })).rejects.toMatchObject({ status: 403 });
    expect((await db.recipe.findUniqueOrThrow({ where: { id: recipeId } })).deletedAt).toBeNull();
    await expect(post({ intent: "delete" }, d1.binding, "missing")).rejects.toMatchObject({ status: 404 });
    const ownId = (await db.recipe.create({ data: { title: "Gone", chefId, deletedAt: new Date() } })).id;
    await expect(post({ intent: "delete" }, d1.binding, ownId)).rejects.toMatchObject({ status: 404 });
    expect(await db.nativeSyncTombstone.count()).toBe(0);
    expect(platform.getRequestDb).not.toHaveBeenCalled();
  });

  it("answers 404 when the recipe goes to the trash between the owner check and the write, and rethrows any other write failure", async () => {
    const ownId = (await db.recipe.create({ data: { title: "Stew", chefId } })).id;
    // The session check is a single query; batch 1 is the owner read and the write batch comes second.
    function onWrite(write: () => Promise<void>) {
      let batches = 0;
      return {
        prepare: d1.binding.prepare.bind(d1.binding),
        batch: async (statements: unknown[]) => {
          if (++batches === 2) await write();
          return d1.binding.batch(statements as never);
        },
      };
    }

    const trashedMeanwhile = onWrite(async () => {
      await db.recipe.update({ where: { id: ownId }, data: { deletedAt: new Date() } });
    });
    await expect(post({ intent: "delete" }, trashedMeanwhile, ownId)).rejects.toMatchObject({ status: 404 });
    expect(await db.nativeSyncTombstone.count()).toBe(0);

    await db.recipe.update({ where: { id: ownId }, data: { deletedAt: null } });
    const failingWrite = onWrite(async () => {
      throw new Error("D1_ERROR: disk I/O error");
    });
    await expect(post({ intent: "delete" }, failingWrite, ownId)).rejects.toThrow("disk I/O error");
    expect((await db.recipe.findUniqueOrThrow({ where: { id: ownId } })).deletedAt).toBeNull();
    expect(platform.getRequestDb).not.toHaveBeenCalled();
  });

  it("leaves other intents, and a cookbook intent without a cookbook, to the Prisma path", async () => {
    platform.getRequestDb.mockImplementation(async () => db);
    // The chef does not own the recipe, so the owner check answers 403.
    await expect(post({ intent: "addToCookbook" })).rejects.toMatchObject({ status: 403 });
    await expect(post({ intent: "createCoverFromSpoon", spoonId: "any" })).rejects.toMatchObject({ status: 403 });
    expect(platform.getRequestDb).toHaveBeenCalledTimes(2);
  });
});
