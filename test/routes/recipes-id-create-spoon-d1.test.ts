// @vitest-environment node
// Logging a cook from the recipe page with a D1 binding: the spoon, and a cover made from its
// photo, are written from D1 even when the request's Prisma client never answers (as in a
// poisoned isolate). Notifications and the cover's stylization wait for waitUntil.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { createSpoonOnD1 } from "~/lib/recipe-spoon-d1.server";
import { activateSpoonCoverForDecision } from "~/lib/spoon-cover-activation.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";

const platform = vi.hoisted(() => ({ getRequestDb: vi.fn() }));
vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: platform.getRequestDb,
}));

import { action } from "~/routes/recipes.$id";

const VAPID = { VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "private", VAPID_SUBJECT: "mailto:test@example.com" };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

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

describe("logging a cook on a D1 binding", () => {
  let d1: SqliteD1;
  let ownerId: string;
  let cookId: string;
  let recipeId: string;
  let background: Promise<unknown>[];
  let bucket: { put: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    await cleanupDatabase();
    platform.getRequestDb.mockReset();
    // A Prisma client that never answers: the request must not wait on it.
    platform.getRequestDb.mockImplementation(() => new Promise(() => {}));
    d1 = sqliteD1();
    background = [];
    bucket = { put: vi.fn().mockResolvedValue(undefined) };
    ownerId = (await makeChef("owner")).id;
    cookId = (await makeChef("cook")).id;
    recipeId = (await db.recipe.create({ data: { title: "Bread", chefId: ownerId } })).id;
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  async function post(
    userId: string,
    fields: Record<string, string | Blob>,
    options: { id?: string; waitUntil?: boolean; env?: Record<string, string> } = {},
  ): Promise<ActionResult> {
    const id = options.id ?? recipeId;
    const body = new UndiciFormData();
    body.append("intent", "createSpoon");
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === "string") body.append(key, value);
      else body.append(key, value, "dinner.png");
    }
    const ctx = options.waitUntil === false ? undefined : { waitUntil: (task: Promise<unknown>) => background.push(task) };
    return action({
      request: new UndiciRequest(`http://localhost/recipes/${id}`, {
        method: "POST",
        headers: { cookie: await sessionCookie(userId) },
        body,
      }) as unknown as Request,
      params: { id },
      context: { cloudflare: { env: { DB: d1.binding, PHOTOS: bucket, ...options.env }, ctx } } as never,
    } as never) as Promise<ActionResult>;
  }

  const photo = () => new Blob([PNG], { type: "image/png" });

  it("logs another chef's cook with one read and one write, without Prisma", async () => {
    const answer = await post(cookId, { note: "  Crusty  ", nextTime: "More salt", cookedAt: "2026-10-01T18:00:00.000Z" });

    expect(answer).toEqual({ success: true, intent: "createSpoon", spoon: { id: expect.any(String) }, isOriginCook: false });
    const spoon = await db.recipeSpoon.findUniqueOrThrow({ where: { id: (answer.spoon as { id: string }).id } });
    expect(spoon).toMatchObject({ chefId: cookId, recipeId, note: "Crusty", nextTime: "More salt", photoUrl: null, deletedAt: null });
    expect(spoon.cookedAt.toISOString()).toBe("2026-10-01T18:00:00.000Z");
    // The session check, then one read batch and one write batch.
    expect(d1.roundTrips()).toBe(3);
    expect(platform.getRequestDb).not.toHaveBeenCalled();
  });

  it("seeds an automatic cover from the owner's first photo, and queues its stylization and fan-out", async () => {
    // The queued work waits on this client, released once the checks below have read the rows.
    let release: (client: typeof db) => void = () => {};
    platform.getRequestDb.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const answer = await post(ownerId, { photo: photo() }, { env: VAPID });
    // Prisma is built only once the queued work starts, after the answer.
    expect(platform.getRequestDb).not.toHaveBeenCalled();
    const roundTrips = d1.roundTrips();

    expect(answer).toMatchObject({ success: true, isOriginCook: true });
    const spoonId = (answer.spoon as { id: string }).id;
    const spoon = await db.recipeSpoon.findUniqueOrThrow({ where: { id: spoonId } });
    expect(spoon.photoUrl).toMatch(new RegExp(`^/photos/spoons/${ownerId}/${recipeId}/`));
    expect(bucket.put).toHaveBeenCalledTimes(1);
    const cover = await db.recipeCover.findFirstOrThrow({ where: { sourceSpoonId: spoonId } });
    expect(cover).toMatchObject({
      recipeId,
      imageUrl: spoon.photoUrl,
      sourceImageUrl: spoon.photoUrl,
      sourceType: "spoon",
      status: "processing",
      generationStatus: "processing",
      createdById: ownerId,
    });
    expect(await db.recipe.findUniqueOrThrow({ where: { id: recipeId } })).toMatchObject({
      activeCoverId: cover.id,
      activeCoverVariant: "image",
      coverMode: "auto",
    });
    // The session check, then one read batch and one write batch.
    expect(roundTrips).toBe(3);
    // The owner's notification, the cover's stylization and the first-cook fan-out wait for
    // waitUntil, and share one Prisma client once they run.
    expect(background).toHaveLength(3);
    release(db);
    await Promise.all(background);
    expect(platform.getRequestDb).toHaveBeenCalledTimes(1);
  });

  it("makes the photo the cover when the owner asks, replacing a real one, and otherwise leaves the cover", async () => {
    const real = await db.recipeCover.create({
      data: { recipeId, imageUrl: "/photos/real.png", sourceType: "upload", status: "ready" },
    });
    await db.recipe.update({ where: { id: recipeId }, data: { activeCoverId: real.id, activeCoverVariant: "image" } });

    const kept = await post(ownerId, { photo: photo() });
    expect(await db.recipeCover.count({ where: { sourceSpoonId: (kept.spoon as { id: string }).id } })).toBe(0);
    expect(await db.recipe.findUniqueOrThrow({ where: { id: recipeId } })).toMatchObject({ activeCoverId: real.id, coverMode: "auto" });

    const chosen = await post(ownerId, { photo: photo(), useAsRecipeCover: "true" });
    expect(chosen.isOriginCook).toBe(false);
    const cover = await db.recipeCover.findFirstOrThrow({ where: { sourceSpoonId: (chosen.spoon as { id: string }).id } });
    expect(await db.recipe.findUniqueOrThrow({ where: { id: recipeId } })).toMatchObject({
      activeCoverId: cover.id,
      activeCoverVariant: "image",
      coverMode: "manual",
    });
  });

  it("never makes a cover from another chef's photo, even when asked", async () => {
    const answer = await post(cookId, { photo: photo(), useAsRecipeCover: "true" });
    expect(await db.recipeCover.count({ where: { sourceSpoonId: (answer.spoon as { id: string }).id } })).toBe(0);
    expect((await db.recipe.findUniqueOrThrow({ where: { id: recipeId } })).activeCoverId).toBeNull();
  });

  it("refuses a photo that is not an image before storing it", async () => {
    const text = new Blob([new TextEncoder().encode("not an image")], { type: "text/plain" });
    await expect(post(ownerId, { photo: text })).rejects.toMatchObject({ status: 400 });
    expect(bucket.put).not.toHaveBeenCalled();
    expect(await db.recipeSpoon.count()).toBe(0);
  });

  it("answers 400 for an empty cook, 404 for a missing recipe, and writes nothing", async () => {
    await expect(post(cookId, { note: "   " })).rejects.toMatchObject({ status: 400 });
    await expect(post(cookId, { note: "Good" }, { id: "missing-recipe" })).rejects.toMatchObject({ status: 404 });
    expect(await db.recipeSpoon.count()).toBe(0);
    expect(platform.getRequestDb).not.toHaveBeenCalled();
  });

  it("runs the background work with the Prisma client before answering when there is no waitUntil", async () => {
    platform.getRequestDb.mockResolvedValue(db);
    const answer = await post(ownerId, { photo: photo() }, { waitUntil: false });
    expect(answer).toMatchObject({ success: true, isOriginCook: true });
    // The cover's stylization ran with the Prisma client before the answer.
    expect(platform.getRequestDb).toHaveBeenCalled();
    expect(await db.recipeCover.count({ where: { recipeId, sourceType: "spoon" } })).toBe(1);
  });

  it("notifies the owner of another chef's cook, and fans out the owner's first cook, through Prisma", async () => {
    platform.getRequestDb.mockResolvedValue(db);
    expect(await post(cookId, { note: "Lovely" }, { waitUntil: false, env: VAPID })).toMatchObject({ isOriginCook: false });
    expect(platform.getRequestDb).toHaveBeenCalledTimes(1);
    // The owner's first cook runs its notification and its fan-out on one client.
    expect(await post(ownerId, { note: "Mine" }, { waitUntil: false, env: VAPID })).toMatchObject({ isOriginCook: true });
    expect(platform.getRequestDb).toHaveBeenCalledTimes(2);
  });

  it("counts an owner's cook as the first only while they have no other live cook of the recipe", async () => {
    expect((await post(ownerId, { note: "One" })).isOriginCook).toBe(true);
    expect((await post(ownerId, { note: "Two" })).isOriginCook).toBe(false);
    await db.recipeSpoon.updateMany({ where: { recipeId }, data: { deletedAt: new Date() } });
    expect((await post(ownerId, { note: "Three" })).isOriginCook).toBe(true);
  });
});

describe("createSpoonOnD1's rows", () => {
  let d1: SqliteD1;
  let ownerId: string;
  let recipeId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    d1 = sqliteD1();
    ownerId = (await makeChef("rows")).id;
    recipeId = (await db.recipe.create({ data: { title: "Stew", chefId: ownerId } })).id;
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  // Rewrites the read batch's results, as a corrupt or unexpected row would arrive.
  function rewriting(rewrite: (results: Array<{ results: unknown[] }>) => void): D1ReadDatabase {
    let first = true;
    return {
      prepare: (sql) => d1.binding.prepare(sql),
      async batch(statements) {
        const results = await d1.binding.batch(statements as never);
        if (first) {
          first = false;
          rewrite(results);
        }
        return results;
      },
    };
  }

  const input = () => ({ chefId: ownerId, recipeId, note: "Good", useAsRecipeCover: false });

  it("refuses a recipe row whose text column is not text, before writing", async () => {
    const binding = rewriting((results) => {
      (results[0].results[0] as Record<string, unknown>).title = 7;
    });
    await expect(createSpoonOnD1(binding, input(), {})).rejects.toThrow("D1 column title is not text");
    expect(await db.recipeSpoon.count()).toBe(0);
  });

  it("writes nothing when a statement in the write batch fails", async () => {
    // The cover insert fails (a cover id that is already taken), so the spoon must not stay.
    const taken = await db.recipeCover.create({ data: { recipeId, imageUrl: "/photos/x.png", sourceType: "upload", status: "processing" } });
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValueOnce("spoon-id" as never).mockReturnValueOnce(taken.id as never);
    try {
      await expect(createSpoonOnD1(d1.binding, { ...input(), note: null, photoUrl: "/photos/p.png" }, {})).rejects.toThrow();
    } finally {
      uuid.mockRestore();
    }
    expect(await db.recipeSpoon.count()).toBe(0);
    expect((await db.recipe.findUniqueOrThrow({ where: { id: recipeId } })).activeCoverId).toBeNull();
  });

  it("answers without a username when the cook's user row is missing", async () => {
    const binding = rewriting((results) => {
      results[3].results.length = 0;
    });
    expect(await createSpoonOnD1(binding, input(), {})).toMatchObject({ isOriginCook: true, spoonerUsername: null });
  });
});

describe("the automatic cover's race check on D1", () => {
  let d1: SqliteD1;
  let ownerId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    d1 = sqliteD1();
    ownerId = (await makeChef("racer")).id;
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  // Runs `change` just before the write batch, as another request committing in between would.
  function racing(change: () => Promise<unknown>): D1ReadDatabase {
    let writing = false;
    let pending = true;
    return {
      prepare: (sql) => {
        if (!/^\s*SELECT\b/i.test(sql)) writing = true;
        return d1.binding.prepare(sql);
      },
      async batch(statements) {
        if (writing && pending) {
          pending = false;
          await change();
        }
        writing = false;
        return d1.binding.batch(statements as never);
      },
    };
  }

  type CoverState = {
    status?: string;
    sourceType?: string;
    imageUrl?: string;
    stylizedImageUrl?: string | null;
    archivedAt?: Date | null;
    otherRecipe?: boolean;
  };
  type RecipeState = { activeCoverVariant?: string | null; coverMode?: string; dropActiveCover?: boolean };

  // Each case starts from a recipe whose active cover is still processing (not a real cover), so
  // the request decides to seed one; then the case's change lands before the write.
  const CASES: Array<[string, CoverState, RecipeState]> = [
    ["nothing changed", {}, {}],
    ["the cover became ready with an image", { status: "ready" }, { activeCoverVariant: "image" }],
    ["the cover became ready with an empty image", { status: "ready", imageUrl: "" }, { activeCoverVariant: "image" }],
    ["ready, stylized variant without a stylized image", { status: "ready" }, { activeCoverVariant: "stylized" }],
    ["ready, stylized variant with a stylized image", { status: "ready", stylizedImageUrl: "/s.png" }, { activeCoverVariant: "stylized" }],
    ["ready, no variant, no images", { status: "ready", imageUrl: "" }, { activeCoverVariant: null }],
    ["ready, no variant, a stylized image", { status: "ready", imageUrl: "", stylizedImageUrl: "/s.png" }, { activeCoverVariant: null }],
    ["ready, an unknown variant", { status: "ready", imageUrl: "" }, { activeCoverVariant: "other" }],
    ["ready but a placeholder", { status: "ready", sourceType: "ai-placeholder" }, { activeCoverVariant: "image" }],
    ["ready but archived", { status: "ready", archivedAt: new Date() }, { activeCoverVariant: "image" }],
    ["the chef switched to manual covers", {}, { coverMode: "manual" }],
    ["the active cover was cleared", {}, { dropActiveCover: true }],
    ["the ready cover belongs to another recipe", { status: "ready", otherRecipe: true }, { activeCoverVariant: "image" }],
  ];

  async function setUp() {
    const recipe = await db.recipe.create({ data: { title: "Soup", chefId: ownerId } });
    const cover = await db.recipeCover.create({
      data: { recipeId: recipe.id, imageUrl: "/photos/old.png", sourceType: "upload", status: "processing" },
    });
    await db.recipe.update({ where: { id: recipe.id }, data: { activeCoverId: cover.id, activeCoverVariant: "image" } });
    return { recipeId: recipe.id, coverId: cover.id };
  }

  async function apply(recipeId: string, coverId: string, coverState: CoverState, recipeState: RecipeState) {
    const { otherRecipe, ...coverFields } = coverState;
    const elsewhere = otherRecipe ? { recipeId: (await db.recipe.create({ data: { title: "Elsewhere", chefId: ownerId } })).id } : {};
    if (Object.keys(coverState).length > 0) await db.recipeCover.update({ where: { id: coverId }, data: { ...coverFields, ...elsewhere } });
    const { dropActiveCover, ...rest } = recipeState;
    await db.recipe.update({ where: { id: recipeId }, data: { ...rest, ...(dropActiveCover ? { activeCoverId: null } : {}) } });
  }

  it.each(CASES)("decides as the Prisma path does when %s", async (_label, coverState, recipeState) => {
    // The Prisma path's answer for the same state.
    const prisma = await setUp();
    await apply(prisma.recipeId, prisma.coverId, coverState, recipeState);
    const seed = await db.recipeCover.create({
      data: { recipeId: prisma.recipeId, imageUrl: "/photos/new.png", sourceType: "spoon", status: "processing" },
    });
    const prismaActivated = await activateSpoonCoverForDecision(db, {
      recipeId: prisma.recipeId,
      coverId: seed.id,
      decision: { shouldCreateCover: true, reason: "auto-seed", coverMode: "auto", activeCoverVariant: "image" },
      previousActiveCoverId: prisma.coverId,
    });

    const onD1 = await setUp();
    const result = await createSpoonOnD1(
      racing(() => apply(onD1.recipeId, onD1.coverId, coverState, recipeState)),
      { chefId: ownerId, recipeId: onD1.recipeId, photoUrl: "/photos/new.png", useAsRecipeCover: false },
    );
    expect(result.cover).not.toBeNull();
    const after = await db.recipe.findUniqueOrThrow({ where: { id: onD1.recipeId } });
    expect(after.activeCoverId === result.cover?.id).toBe(prismaActivated);
    // The cover row is written either way, as on the Prisma path.
    expect(await db.recipeCover.count({ where: { id: result.cover?.id } })).toBe(1);
  });
});
