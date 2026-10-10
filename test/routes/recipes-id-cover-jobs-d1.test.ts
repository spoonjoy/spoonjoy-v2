// @vitest-environment node
// The recipe owner's cover jobs with a D1 binding: a cover from a cook's photo, an AI placeholder
// cover, and regenerating a cover. The cover row is written from D1 even when the request's Prisma
// client never answers (as in a poisoned isolate); the stylization or placeholder job waits for
// waitUntil and builds the Prisma client only when it starts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { coverRegenerationStatement, readOwnedRecipeForCoverJobOnD1 } from "~/lib/recipe-cover-jobs-d1.server";
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

type ActionResult = Record<string, unknown>;

describe("the recipe owner's cover jobs on a D1 binding", () => {
  let d1: SqliteD1;
  let ownerId: string;
  let otherId: string;
  let recipeId: string;
  let background: Promise<unknown>[];

  beforeEach(async () => {
    await cleanupDatabase();
    platform.getRequestDb.mockReset();
    // A Prisma client that never answers: the request must not wait on it.
    platform.getRequestDb.mockImplementation(() => new Promise(() => {}));
    d1 = sqliteD1();
    background = [];
    ownerId = (await makeChef("owner")).id;
    otherId = (await makeChef("other")).id;
    recipeId = (
      await db.recipe.create({ data: { title: "Bread", description: "Crusty", chefId: ownerId, coverMode: "manual" } })
    ).id;
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  async function post(
    fields: Record<string, string>,
    options: { userId?: string; id?: string; waitUntil?: boolean } = {},
  ): Promise<ActionResult> {
    const id = options.id ?? recipeId;
    const body = new UndiciFormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    const ctx = options.waitUntil === false ? undefined : { waitUntil: (task: Promise<unknown>) => background.push(task) };
    return action({
      request: new UndiciRequest(`http://localhost/recipes/${id}`, {
        method: "POST",
        headers: { cookie: await sessionCookie(options.userId ?? ownerId) },
        body,
      }) as unknown as Request,
      params: { id },
      context: { cloudflare: { env: { DB: d1.binding }, ctx } } as never,
    } as never) as Promise<ActionResult>;
  }

  async function status(promise: Promise<unknown>): Promise<number> {
    return promise.then(
      () => 200,
      (error: unknown) => (error instanceof Response ? error.status : Promise.reject(error)),
    );
  }

  async function spoonWithPhoto() {
    return db.recipeSpoon.create({ data: { chefId: otherId, recipeId, photoUrl: "/photos/spoons/dinner.jpg" } });
  }

  it("makes a cover from a cook's photo with one read and one write, and stylizes it after the answer", async () => {
    const spoon = await spoonWithPhoto();
    const before = d1.roundTrips();

    const answer = await post({ intent: "createCoverFromSpoon", spoonId: spoon.id, promptAddition: "golden light" });
    // Answered before the background job asks for a Prisma client (which never answers here).
    expect(platform.getRequestDb).not.toHaveBeenCalled();

    expect(answer).toEqual({ success: true, intent: "createCoverFromSpoon", coverId: expect.any(String) });
    // The session check, then one read batch and one write batch.
    expect(d1.roundTrips() - before).toBe(3);
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: answer.coverId as string } });
    expect(cover).toMatchObject({
      recipeId,
      imageUrl: "/photos/spoons/dinner.jpg",
      sourceImageUrl: "/photos/spoons/dinner.jpg",
      sourceType: "spoon",
      sourceSpoonId: spoon.id,
      status: "processing",
      generationStatus: "processing",
      createdById: ownerId,
      promptAddition: "golden light",
    });
    expect(background).toHaveLength(1);
  });

  it("starts an AI placeholder cover from D1", async () => {
    const answer = await post({ intent: "generateRecipeCoverPlaceholder", activateWhenReady: "true" });
    expect(platform.getRequestDb).not.toHaveBeenCalled();

    expect(answer).toEqual({ success: true, intent: "generateRecipeCoverPlaceholder", coverId: expect.any(String) });
    const cover = await db.recipeCover.findUniqueOrThrow({ where: { id: answer.coverId as string } });
    expect(cover).toMatchObject({
      imageUrl: "",
      sourceType: "ai-placeholder",
      sourceSpoonId: null,
      sourceImageUrl: null,
      status: "processing",
      generationStatus: "processing",
    });
    expect(background).toHaveLength(1);
  });

  it("regenerates a plain cover in place and a stylized one as a child, keeping its image", async () => {
    const plain = await db.recipeCover.create({
      data: { recipeId, imageUrl: "/photos/covers/plain.jpg", sourceType: "chef-upload", status: "failed", failureReason: "timeout" },
    });
    const inPlace = await post({ intent: "regenerateRecipeCover", coverId: plain.id });
    expect(platform.getRequestDb).not.toHaveBeenCalled();
    expect(inPlace).toEqual({ success: true, intent: "regenerateRecipeCover", coverId: plain.id });
    const restarted = await db.recipeCover.findUniqueOrThrow({ where: { id: plain.id } });
    expect(restarted).toMatchObject({
      status: "processing",
      generationStatus: "processing",
      failureReason: null,
      sourceImageUrl: "/photos/covers/plain.jpg",
    });
    expect(restarted.generationStartedAt).toBeInstanceOf(Date);

    const stylized = await db.recipeCover.create({
      data: {
        recipeId,
        imageUrl: "/photos/covers/source.jpg",
        stylizedImageUrl: "/photos/covers/stylized.jpg",
        sourceType: "spoon",
        status: "ready",
      },
    });
    const child = await post({ intent: "regenerateRecipeCover", coverId: stylized.id, promptAddition: "brighter" });
    expect(child.coverId).not.toBe(stylized.id);
    await expect(db.recipeCover.findUniqueOrThrow({ where: { id: child.coverId as string } })).resolves.toMatchObject({
      parentCoverId: stylized.id,
      imageUrl: "/photos/covers/source.jpg",
      stylizedImageUrl: null,
      sourceType: "spoon",
      sourceImageUrl: "/photos/covers/source.jpg",
      promptAddition: "brighter",
      status: "processing",
    });
    await expect(db.recipeCover.findUniqueOrThrow({ where: { id: stylized.id } })).resolves.toMatchObject({
      stylizedImageUrl: "/photos/covers/stylized.jpg",
      status: "ready",
    });
    expect(background).toHaveLength(2);
  });

  it("answers 404 and 403 for the recipe before the job's own checks, and writes nothing", async () => {
    const spoon = await spoonWithPhoto();
    expect(await status(post({ intent: "createCoverFromSpoon" }, { id: "missing" }))).toBe(404);
    expect(await status(post({ intent: "generateRecipeCoverPlaceholder" }, { userId: otherId }))).toBe(403);
    expect(await status(post({ intent: "createCoverFromSpoon", spoonId: spoon.id }, { userId: otherId }))).toBe(403);
    expect(await status(post({ intent: "regenerateRecipeCover" }, { userId: otherId }))).toBe(403);
    const trashed = (await db.recipe.create({ data: { title: "Gone", chefId: ownerId, deletedAt: new Date() } })).id;
    expect(await status(post({ intent: "generateRecipeCoverPlaceholder" }, { id: trashed }))).toBe(404);
    expect(await db.recipeCover.count()).toBe(0);
    expect(platform.getRequestDb).not.toHaveBeenCalled();
  });

  it("answers each job's 400 and 404 as the Prisma path does", async () => {
    const photoless = await db.recipeSpoon.create({ data: { chefId: otherId, recipeId } });
    expect(await status(post({ intent: "createCoverFromSpoon" }))).toBe(400);
    expect(await status(post({ intent: "createCoverFromSpoon", spoonId: photoless.id }))).toBe(404);
    expect(await status(post({ intent: "createCoverFromSpoon", spoonId: "missing" }))).toBe(404);

    const otherRecipe = (await db.recipe.create({ data: { title: "Other", chefId: ownerId } })).id;
    const elsewhere = await db.recipeCover.create({ data: { recipeId: otherRecipe, imageUrl: "/x.jpg", sourceType: "chef-upload" } });
    const archived = await db.recipeCover.create({
      data: { recipeId, imageUrl: "/a.jpg", sourceType: "chef-upload", status: "archived", archivedAt: new Date() },
    });
    const archivedReady = await db.recipeCover.create({
      data: { recipeId, imageUrl: "/b.jpg", sourceType: "chef-upload", status: "ready", archivedAt: new Date() },
    });
    const blank = await db.recipeCover.create({ data: { recipeId, imageUrl: "  ", sourceType: "chef-upload" } });
    expect(await status(post({ intent: "regenerateRecipeCover" }))).toBe(400);
    expect(await status(post({ intent: "regenerateRecipeCover", coverId: "missing" }))).toBe(404);
    expect(await status(post({ intent: "regenerateRecipeCover", coverId: elsewhere.id }))).toBe(404);
    expect(await status(post({ intent: "regenerateRecipeCover", coverId: archived.id }))).toBe(400);
    expect(await status(post({ intent: "regenerateRecipeCover", coverId: archivedReady.id }))).toBe(400);
    expect(await status(post({ intent: "regenerateRecipeCover", coverId: blank.id }))).toBe(400);

    expect(await db.recipeCover.count({ where: { status: "processing" } })).toBe(0);
    expect(background).toHaveLength(0);
    expect(platform.getRequestDb).not.toHaveBeenCalled();
  });

  it("builds the Prisma client only when the background job starts, or before the answer without waitUntil", async () => {
    platform.getRequestDb.mockResolvedValue(db);
    const spoon = await spoonWithPhoto();
    await post({ intent: "createCoverFromSpoon", spoonId: spoon.id });
    expect(platform.getRequestDb).not.toHaveBeenCalled();
    await Promise.all(background);
    expect(platform.getRequestDb).toHaveBeenCalledTimes(1);

    const answer = await post({ intent: "generateRecipeCoverPlaceholder" }, { waitUntil: false });
    expect(answer).toMatchObject({ success: true, intent: "generateRecipeCoverPlaceholder" });
    expect(platform.getRequestDb).toHaveBeenCalledTimes(2);

    // A regeneration's job runs too, for a cook's photo and for a chef's upload; with no image
    // provider configured it records the generation as failed.
    for (const sourceType of ["spoon", "chef-upload"]) {
      const cover = await db.recipeCover.create({ data: { recipeId, imageUrl: `/photos/${sourceType}.jpg`, sourceType } });
      await post({ intent: "regenerateRecipeCover", coverId: cover.id }, { waitUntil: false });
      await expect(db.recipeCover.findUniqueOrThrow({ where: { id: cover.id } })).resolves.toMatchObject({ generationStatus: "failed" });
    }
    expect(platform.getRequestDb).toHaveBeenCalledTimes(4);
  });
});

describe("cover job D1 helpers", () => {
  it("refuses a recipe or cover row whose text column is not text", async () => {
    const statement = { bind: () => statement };
    const fake = (rows: Record<string, unknown>[][]) =>
      ({ prepare: () => statement, batch: async () => rows.map((results) => ({ results })) }) as never;
    const recipe = { chefId: "chef", deletedAt: null, title: 7, description: null, activeCoverId: null, activeCoverVariant: null, coverMode: "auto" };
    await expect(readOwnedRecipeForCoverJobOnD1(fake([[recipe]]), { recipeId: "r", userId: "chef" })).rejects.toThrow(
      "D1 column title is not text",
    );
    await expect(
      readOwnedRecipeForCoverJobOnD1(fake([[{ ...recipe, title: "Soup" }], [{ id: "s", photoUrl: 3 }]]), {
        recipeId: "r",
        userId: "chef",
        spoonId: "s",
      }),
    ).rejects.toThrow("D1 column photoUrl is not text");
  });

  it("regenerates in place from the given photo when the cover recorded no source image", () => {
    const now = new Date("2026-10-10T12:00:00.000Z");
    const cover = {
      id: "c",
      recipeId: "r",
      imageUrl: "/display.jpg",
      stylizedImageUrl: null,
      sourceImageUrl: null,
      sourceType: "chef-upload",
      sourceSpoonId: null,
      status: "failed",
      archivedAt: null,
    };
    const { coverId, parentCoverId, statement } = coverRegenerationStatement(
      cover,
      { createdById: "chef", rawPhotoUrl: "/display.jpg", promptAddition: null },
      now,
    );
    expect({ coverId, parentCoverId }).toEqual({ coverId: "c", parentCoverId: undefined });
    expect(statement.slice(1)).toEqual([now.toISOString(), "/display.jpg", null, "c"]);
  });
});
