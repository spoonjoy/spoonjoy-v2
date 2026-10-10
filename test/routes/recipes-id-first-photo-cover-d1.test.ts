// @vitest-environment node
// The chef's first photo as the recipe's cover, with a D1 binding. The cook, the cover and its
// activation are one guarded D1 batch written even when the request's Prisma client never answers
// (as in a poisoned isolate); the editorial job waits for waitUntil and builds its own client.
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

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 1, 2, 3]);

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

async function makeChef(prefix: string) {
  const handle = faker.string.alphanumeric(8).toLowerCase();
  return createUser(db, `${prefix}-${handle}@example.com`, `${prefix}_${handle}`, "testPassword123");
}

function photo(name = "first.png", bytes: Uint8Array = PNG_BYTES, type = "image/png") {
  return new File([bytes], name, { type });
}

type ActionResult = Record<string, unknown>;

describe("the first photo as the recipe's cover on a D1 binding", () => {
  let d1: SqliteD1;
  let ownerId: string;
  let otherId: string;
  let recipeId: string;
  let background: Promise<unknown>[];
  let bucket: { put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    await cleanupDatabase();
    platform.getRequestDb.mockReset();
    // A Prisma client that never answers: the request must not wait on it.
    platform.getRequestDb.mockImplementation(() => new Promise(() => {}));
    d1 = sqliteD1();
    background = [];
    bucket = { put: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) };
    ownerId = (await makeChef("owner")).id;
    otherId = (await makeChef("other")).id;
    recipeId = (await db.recipe.create({ data: { title: "Bread", chefId: ownerId } })).id;
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  async function post(
    fields: Record<string, string | File>,
    options: { userId?: string; id?: string } = {},
  ): Promise<ActionResult> {
    const id = options.id ?? recipeId;
    const body = new UndiciFormData();
    body.append("intent", "createFirstPhotoCover");
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    return action({
      request: new UndiciRequest(`http://localhost/recipes/${id}`, {
        method: "POST",
        headers: { cookie: await sessionCookie(options.userId ?? ownerId) },
        body,
      }) as unknown as Request,
      params: { id },
      context: {
        cloudflare: {
          env: { DB: d1.binding, PHOTOS: bucket },
          ctx: { waitUntil: (task: Promise<unknown>) => background.push(task) },
        },
      } as never,
    } as never) as Promise<ActionResult>;
  }

  async function status(promise: Promise<unknown>): Promise<number> {
    return promise.then(
      () => 200,
      (error: unknown) => (error instanceof Response ? error.status : Promise.reject(error)),
    );
  }

  async function recipeCover() {
    return db.recipe.findUniqueOrThrow({
      where: { id: recipeId },
      select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
    });
  }

  it("stores a direct photo as a ready cover with one read and one write, leaving the recipe's cover alone", async () => {
    const before = d1.roundTrips();

    const answer = await post({ photo: photo(), postAsSpoon: "false", generateEditorial: "false", activateWhenReady: "false" });

    expect(answer).toEqual({ success: true, intent: "createFirstPhotoCover", spoon: null, coverId: expect.any(String) });
    // The session check, then one read batch and one write batch.
    expect(d1.roundTrips() - before).toBe(3);
    expect(platform.getRequestDb).not.toHaveBeenCalled();
    expect(background).toHaveLength(0);
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: answer.coverId as string } });
    expect(cover).toMatchObject({
      recipeId,
      sourceType: "chef-upload",
      sourceSpoonId: null,
      status: "ready",
      generationStatus: "none",
      createdById: ownerId,
    });
    expect(cover.imageUrl).toMatch(new RegExp(`^/photos/recipes/${ownerId}/${recipeId}/`));
    expect(cover.sourceImageUrl).toBe(cover.imageUrl);
    expect(bucket.put).toHaveBeenCalledTimes(1);
    await expect(db.recipeSpoon.count({ where: { recipeId } })).resolves.toBe(0);
    await expect(recipeCover()).resolves.toEqual({ activeCoverId: null, activeCoverVariant: null, coverMode: "auto" });
  });

  it("posts the photo as a cook, makes it the active cover, touches its cookbooks and stylizes it after the answer", async () => {
    const cookbook = await db.cookbook.create({
      data: { title: "Weeknights", authorId: ownerId, updatedAt: new Date("2026-01-01T00:00:00Z") },
    });
    await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId, addedById: ownerId } });
    await db.cookbook.update({ where: { id: cookbook.id }, data: { updatedAt: new Date("2026-01-01T00:00:00Z") } });
    platform.getRequestDb.mockResolvedValue(db);

    const answer = await post({
      photo: photo("cook.png"),
      postAsSpoon: "true",
      note: "  Crisp crust  ",
      nextTime: "More salt",
      cookedAt: "2026-07-14T19:30:00Z",
      promptAddition: "morning light",
    });
    // Answered before the editorial job asks for a Prisma client.
    expect(platform.getRequestDb).not.toHaveBeenCalled();

    const spoonId = (answer.spoon as { id: string }).id;
    expect(answer).toEqual({ success: true, intent: "createFirstPhotoCover", spoon: { id: spoonId }, coverId: expect.any(String) });
    const spoon = await db.recipeSpoon.findUniqueOrThrow({ where: { id: spoonId } });
    expect(spoon).toMatchObject({
      chefId: ownerId,
      recipeId,
      note: "Crisp crust",
      nextTime: "More salt",
      cookedAt: new Date("2026-07-14T19:30:00Z"),
    });
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: answer.coverId as string } });
    expect(cover).toMatchObject({
      imageUrl: spoon.photoUrl,
      sourceImageUrl: spoon.photoUrl,
      sourceType: "spoon",
      sourceSpoonId: spoonId,
      promptAddition: "morning light",
    });
    await expect(recipeCover()).resolves.toEqual({ activeCoverId: cover.id, activeCoverVariant: "image", coverMode: "manual" });
    const touched = await db.cookbook.findUniqueOrThrow({ where: { id: cookbook.id } });
    expect(touched.updatedAt.getTime()).toBeGreaterThan(new Date("2026-01-01T00:00:00Z").getTime());

    // The editorial job builds its client when it starts; with no image provider it records the
    // failure and keeps the cook's photo as a ready cover. (Under load the job can settle before
    // the reads above, so the cover's state is checked only once it has finished.)
    expect(background).toHaveLength(1);
    await Promise.all(background);
    expect(platform.getRequestDb).toHaveBeenCalledTimes(1);
    await expect(db.recipeCover.findUniqueOrThrow({ where: { id: cover.id } })).resolves.toMatchObject({
      status: "ready",
      generationStatus: "failed",
    });
  });

  it("stylizes a direct photo without making it the active cover when the chef keeps the current one", async () => {
    platform.getRequestDb.mockResolvedValue(db);

    const answer = await post({ photo: photo(), postAsSpoon: "false", activateWhenReady: "false" });

    expect(answer).toMatchObject({ success: true, spoon: null });
    await expect(recipeCover()).resolves.toEqual({ activeCoverId: null, activeCoverVariant: null, coverMode: "auto" });
    expect(background).toHaveLength(1);
    await Promise.all(background);
    // With no image provider the job records the failure; the recipe's cover stays as it was.
    await expect(db.recipeCover.findUniqueOrThrow({ where: { id: answer.coverId as string } })).resolves.toMatchObject({
      sourceType: "chef-upload",
      generationStatus: "failed",
    });
    await expect(recipeCover()).resolves.toEqual({ activeCoverId: null, activeCoverVariant: null, coverMode: "auto" });
  });

  it("answers 404 and 403 before looking at the photo, then the photo's own 400s, writing nothing", async () => {
    await expect(status(post({}, { id: "no-such-recipe" }))).resolves.toBe(404);
    await expect(status(post({}, { userId: otherId }))).resolves.toBe(403);
    await db.recipe.update({ where: { id: recipeId }, data: { deletedAt: new Date() } });
    await expect(status(post({ photo: photo() }))).resolves.toBe(404);
    await db.recipe.update({ where: { id: recipeId }, data: { deletedAt: null } });

    await expect(status(post({}))).resolves.toBe(400);
    await expect(status(post({ photo: photo(), cookedAt: "2026-07-14T19:30" }))).resolves.toBe(400);
    await expect(status(post({ photo: photo("a.gif", GIF_BYTES, "image/gif"), postAsSpoon: "false" }))).resolves.toBe(400);
    await expect(status(post({ photo: photo("a.gif", GIF_BYTES, "image/gif"), postAsSpoon: "true" }))).resolves.toBe(400);

    expect(bucket.put).not.toHaveBeenCalled();
    await expect(db.recipeCover.count({ where: { recipeId } })).resolves.toBe(0);
    await expect(db.recipeSpoon.count({ where: { recipeId } })).resolves.toBe(0);
    expect(platform.getRequestDb).not.toHaveBeenCalled();
  });

  it("removes the stored photo and writes nothing when the recipe is trashed while the photo uploads", async () => {
    bucket.put.mockImplementation(async () => {
      await db.recipe.update({ where: { id: recipeId }, data: { deletedAt: new Date() } });
    });
    // Removing the photo is best effort: its own failure does not replace the answer.
    bucket.delete.mockRejectedValue(new Error("delete failed"));

    await expect(status(post({ photo: photo(), postAsSpoon: "true" }))).resolves.toBe(404);

    expect(bucket.delete).toHaveBeenCalledWith(expect.stringMatching(/^spoons\//));
    await expect(db.recipeCover.count({ where: { recipeId } })).resolves.toBe(0);
    await expect(db.recipeSpoon.count({ where: { recipeId } })).resolves.toBe(0);
    await expect(recipeCover()).resolves.toEqual({ activeCoverId: null, activeCoverVariant: null, coverMode: "auto" });
    expect(background).toHaveLength(0);
    expect(platform.getRequestDb).not.toHaveBeenCalled();
  });
});
