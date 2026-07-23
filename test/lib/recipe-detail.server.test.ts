import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { loadRecipeDetail, handleRecipeDetailAction } from "~/lib/recipe-detail.server";
import { cleanupDatabase } from "../helpers/cleanup";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 1, 2, 3]);

async function makeAuthedRequest(userId: string, recipeId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  const setCookie = await sessionStorage.commitSession(session);
  const cookie = setCookie.split(";")[0];
  const headers = new Headers();
  headers.set("Cookie", cookie);
  return new UndiciRequest(`http://localhost/recipes/${recipeId}`, { headers });
}

async function makeAuthedPostRequest(userId: string, recipeId: string, formData: UndiciFormData) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  const setCookie = await sessionStorage.commitSession(session);
  const cookie = setCookie.split(";")[0];
  const headers = new Headers();
  headers.set("Cookie", cookie);
  return new UndiciRequest(`http://localhost/recipes/${recipeId}`, {
    method: "POST",
    headers,
    body: formData,
  });
}

async function makeUser() {
  return db.user.create({
    data: {
      email: faker.internet.email(),
      username: faker.internet.username() + "_" + faker.string.alphanumeric(8),
    },
  });
}

function photoFile(name = "recipe-photo.png", bytes: Uint8Array = PNG_BYTES, type = "image/png") {
  return new File([bytes], name, { type });
}

function mockPhotoBucket() {
  return {
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  } as unknown as R2Bucket;
}

describe("loadRecipeDetail sourceRecipe", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("returns recipe.sourceRecipe === null when the recipe is not a fork", async () => {
    const chef = await makeUser();
    const recipe = await db.recipe.create({
      data: { title: "Standalone", chefId: chef.id },
    });

    const request = await makeAuthedRequest(chef.id, recipe.id) as unknown as Request;
    const result = await loadRecipeDetail({
      request,
      params: { id: recipe.id },
      context: { cloudflare: { env: null } } as any,
    });

    expect((result.recipe as { sourceRecipe?: unknown }).sourceRecipe).toBeNull();
  });

  it("returns sourceRecipe with chef.username when forked from a live source", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await db.recipe.create({
      data: { title: "Original", chefId: chefA.id },
    });
    const fork = await db.recipe.create({
      data: { title: "Forked", chefId: chefB.id, sourceRecipeId: source.id },
    });

    const request = await makeAuthedRequest(chefB.id, fork.id) as unknown as Request;
    const result = await loadRecipeDetail({
      request,
      params: { id: fork.id },
      context: { cloudflare: { env: null } } as any,
    });

    const sourceRecipe = (result.recipe as {
      sourceRecipe: { id: string; title: string; deletedAt: Date | null; chef: { username: string } } | null;
    }).sourceRecipe;
    expect(sourceRecipe).not.toBeNull();
    expect(sourceRecipe!.id).toBe(source.id);
    expect(sourceRecipe!.title).toBe("Original");
    expect(sourceRecipe!.deletedAt).toBeNull();
    expect(sourceRecipe!.chef.username).toBe(chefA.username);
  });

  it("returns sourceRecipe with deletedAt set when the source was soft-deleted", async () => {
    const chefA = await makeUser();
    const chefB = await makeUser();
    const source = await db.recipe.create({
      data: { title: "GhostOriginal", chefId: chefA.id },
    });
    const fork = await db.recipe.create({
      data: { title: "ForkOfGhost", chefId: chefB.id, sourceRecipeId: source.id },
    });
    const deletedAt = new Date("2026-04-01T00:00:00Z");
    await db.recipe.update({
      where: { id: source.id },
      data: { deletedAt },
    });

    const request = await makeAuthedRequest(chefB.id, fork.id) as unknown as Request;
    const result = await loadRecipeDetail({
      request,
      params: { id: fork.id },
      context: { cloudflare: { env: null } } as any,
    });

    const sourceRecipe = (result.recipe as {
      sourceRecipe: { id: string; title: string; deletedAt: Date | null; chef: { username: string } } | null;
    }).sourceRecipe;
    expect(sourceRecipe).not.toBeNull();
    expect(sourceRecipe!.deletedAt).not.toBeNull();
    expect(sourceRecipe!.chef.username).toBe(chefA.username);
  });
});

describe("recipe detail saved state and actions", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("loads owner-scoped saved state without personalizing guest or another user's view", async () => {
    const chef = await makeUser();
    const viewer = await makeUser();
    const recipe = await db.recipe.create({
      data: { title: "Scoped Saved Detail", chefId: chef.id },
    });
    await db.savedRecipe.create({
      data: { userId: viewer.id, recipeId: recipe.id, savedAt: "2026-07-22T12:00:00.000Z" },
    });

    const viewerResult = await loadRecipeDetail({
      request: await makeAuthedRequest(viewer.id, recipe.id) as unknown as Request,
      params: { id: recipe.id },
      context: { cloudflare: { env: null } } as any,
    });
    const chefResult = await loadRecipeDetail({
      request: await makeAuthedRequest(chef.id, recipe.id) as unknown as Request,
      params: { id: recipe.id },
      context: { cloudflare: { env: null } } as any,
    });
    const guestResult = await loadRecipeDetail({
      request: new UndiciRequest(`http://localhost/recipes/${recipe.id}`) as unknown as Request,
      params: { id: recipe.id },
      context: { cloudflare: { env: null } } as any,
    });

    expect(viewerResult.isSaved).toBe(true);
    expect(chefResult.isSaved).toBe(false);
    expect(guestResult.isSaved).toBe(false);
  });

  it("saves and unsaves independently from cookbook membership with stable idempotent results", async () => {
    const chef = await makeUser();
    const viewer = await makeUser();
    const recipe = await db.recipe.create({
      data: { title: "Independent Saved Detail", chefId: chef.id },
    });
    const cookbook = await db.cookbook.create({
      data: { title: "Independent Cookbook", authorId: viewer.id },
    });
    await db.recipeInCookbook.create({
      data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: viewer.id },
    });
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-07-22T12:00:00.000Z"));

    const saveForm = new UndiciFormData();
    saveForm.append("intent", "saveRecipe");
    const saved = await handleRecipeDetailAction({
      request: await makeAuthedPostRequest(viewer.id, recipe.id, saveForm) as unknown as Request,
      params: { id: recipe.id },
      context: { cloudflare: { env: null } } as any,
    });
    expect(saved).toEqual({
      success: true,
      intent: "saveRecipe",
      saved: true,
      savedAt: "2026-07-22T12:00:00.000Z",
    });

    vi.mocked(Date.now).mockReturnValue(Date.parse("2026-07-23T12:00:00.000Z"));
    const repeatSaveForm = new UndiciFormData();
    repeatSaveForm.append("intent", "saveRecipe");
    await expect(handleRecipeDetailAction({
      request: await makeAuthedPostRequest(viewer.id, recipe.id, repeatSaveForm) as unknown as Request,
      params: { id: recipe.id },
      context: { cloudflare: { env: null } } as any,
    })).resolves.toEqual({
      success: true,
      intent: "saveRecipe",
      saved: true,
      savedAt: "2026-07-22T12:00:00.000Z",
    });
    await expect(db.recipeInCookbook.count({
      where: { cookbookId: cookbook.id, recipeId: recipe.id },
    })).resolves.toBe(1);

    const unsaveForm = new UndiciFormData();
    unsaveForm.append("intent", "unsaveRecipe");
    await expect(handleRecipeDetailAction({
      request: await makeAuthedPostRequest(viewer.id, recipe.id, unsaveForm) as unknown as Request,
      params: { id: recipe.id },
      context: { cloudflare: { env: null } } as any,
    })).resolves.toEqual({ success: true, intent: "unsaveRecipe", saved: false });

    const repeatUnsaveForm = new UndiciFormData();
    repeatUnsaveForm.append("intent", "unsaveRecipe");
    await expect(handleRecipeDetailAction({
      request: await makeAuthedPostRequest(viewer.id, recipe.id, repeatUnsaveForm) as unknown as Request,
      params: { id: recipe.id },
      context: { cloudflare: { env: null } } as any,
    })).resolves.toEqual({ success: true, intent: "unsaveRecipe", saved: false });
    await expect(db.savedRecipe.findUnique({
      where: { userId_recipeId: { userId: viewer.id, recipeId: recipe.id } },
    })).resolves.toBeNull();
    await expect(db.recipeInCookbook.count({
      where: { cookbookId: cookbook.id, recipeId: recipe.id },
    })).resolves.toBe(1);
  });

  it("rejects saving a soft-deleted recipe but still lets the owner remove its saved row", async () => {
    const chef = await makeUser();
    const viewer = await makeUser();
    const recipe = await db.recipe.create({
      data: { title: "Deleted Saved Detail", chefId: chef.id },
    });
    await db.savedRecipe.create({
      data: { userId: viewer.id, recipeId: recipe.id, savedAt: "2026-07-22T12:00:00.000Z" },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: { deletedAt: new Date("2026-07-22T13:00:00.000Z") },
    });

    const saveForm = new UndiciFormData();
    saveForm.append("intent", "saveRecipe");
    await expect(handleRecipeDetailAction({
      request: await makeAuthedPostRequest(viewer.id, recipe.id, saveForm) as unknown as Request,
      params: { id: recipe.id },
      context: { cloudflare: { env: null } } as any,
    })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(404);
      return true;
    });

    const unsaveForm = new UndiciFormData();
    unsaveForm.append("intent", "unsaveRecipe");
    await expect(handleRecipeDetailAction({
      request: await makeAuthedPostRequest(viewer.id, recipe.id, unsaveForm) as unknown as Request,
      params: { id: recipe.id },
      context: { cloudflare: { env: null } } as any,
    })).resolves.toEqual({ success: true, intent: "unsaveRecipe", saved: false });
    await expect(db.savedRecipe.findUnique({
      where: { userId_recipeId: { userId: viewer.id, recipeId: recipe.id } },
    })).resolves.toBeNull();
  });
});

describe("handleRecipeDetailAction cover generation actions", () => {
  beforeEach(async () => { await cleanupDatabase(); });
  afterEach(async () => { await cleanupDatabase(); });

  it("queues spoon-photo cover creation with an activation guard when requested", async () => {
    const chef = await makeUser();
    const recipe = await db.recipe.create({
      data: { title: "Guarded Spoon Cover", chefId: chef.id },
    });
    const spoon = await db.recipeSpoon.create({
      data: {
        recipeId: recipe.id,
        chefId: chef.id,
        photoUrl: "/photos/spoons/guarded.jpg",
      },
    });
    const formData = new UndiciFormData();
    formData.append("intent", "createCoverFromSpoon");
    formData.append("spoonId", spoon.id);
    formData.append("activateWhenReady", "true");
    const captured: Promise<unknown>[] = [];

    const result = await handleRecipeDetailAction({
      request: await makeAuthedPostRequest(chef.id, recipe.id, formData) as unknown as Request,
      params: { id: recipe.id },
      context: {
        cloudflare: {
          env: null,
          ctx: { waitUntil: (promise: Promise<unknown>) => captured.push(promise) },
        },
      } as any,
    });

    expect(result).toMatchObject({ success: true, intent: "createCoverFromSpoon" });
    expect(captured).toHaveLength(1);
    const cover = await db.recipeCover.findFirstOrThrow({
      where: { recipeId: recipe.id, sourceSpoonId: spoon.id },
    });
    expect(cover).toMatchObject({
      imageUrl: spoon.photoUrl,
      sourceImageUrl: spoon.photoUrl,
      sourceType: "spoon",
      generationStatus: "processing",
    });
    await Promise.all(captured);
  });

  it("preserves an existing source image while queuing guarded cover regeneration", async () => {
    const chef = await makeUser();
    const recipe = await db.recipe.create({
      data: { title: "Guarded Regeneration", chefId: chef.id },
    });
    const cover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/covers/display.jpg",
        sourceImageUrl: "/photos/covers/original-source.jpg",
        sourceType: "chef-upload",
        status: "ready",
      },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: {
        activeCoverId: cover.id,
        activeCoverVariant: "image",
        coverMode: "manual",
      },
    });
    const formData = new UndiciFormData();
    formData.append("intent", "regenerateRecipeCover");
    formData.append("coverId", cover.id);
    formData.append("activateWhenReady", "true");
    const captured: Promise<unknown>[] = [];

    const result = await handleRecipeDetailAction({
      request: await makeAuthedPostRequest(chef.id, recipe.id, formData) as unknown as Request,
      params: { id: recipe.id },
      context: {
        cloudflare: {
          env: null,
          ctx: { waitUntil: (promise: Promise<unknown>) => captured.push(promise) },
        },
      } as any,
    });

    expect(result).toEqual({ success: true, intent: "regenerateRecipeCover", coverId: cover.id });
    expect(captured).toHaveLength(1);
    await expect(db.recipeCover.findUniqueOrThrow({
      where: { id: cover.id },
      select: { sourceImageUrl: true, generationStatus: true },
    })).resolves.toEqual({
      sourceImageUrl: "/photos/covers/original-source.jpg",
      generationStatus: "processing",
    });
    await Promise.all(captured);
  });

  it("uses the display image as the regeneration source when no source image is stored", async () => {
    const chef = await makeUser();
    const recipe = await db.recipe.create({
      data: { title: "Fallback Regeneration", chefId: chef.id },
    });
    const cover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/covers/display-only.jpg",
        sourceType: "chef-upload",
        status: "ready",
      },
    });
    const formData = new UndiciFormData();
    formData.append("intent", "regenerateRecipeCover");
    formData.append("coverId", cover.id);
    const captured: Promise<unknown>[] = [];

    await handleRecipeDetailAction({
      request: await makeAuthedPostRequest(chef.id, recipe.id, formData) as unknown as Request,
      params: { id: recipe.id },
      context: {
        cloudflare: {
          env: null,
          ctx: { waitUntil: (promise: Promise<unknown>) => captured.push(promise) },
        },
      } as any,
    });

    expect(captured).toHaveLength(1);
    await expect(db.recipeCover.findUniqueOrThrow({
      where: { id: cover.id },
      select: { sourceImageUrl: true, generationStatus: true },
    })).resolves.toEqual({
      sourceImageUrl: "/photos/covers/display-only.jpg",
      generationStatus: "processing",
    });
    await Promise.all(captured);
  });

  it("creates a direct first-photo cover without posting a Spoon or generating editorial art", async () => {
    const chef = await makeUser();
    const recipe = await db.recipe.create({
      data: { title: "Direct First Photo", chefId: chef.id },
    });
    const formData = new UndiciFormData();
    formData.append("intent", "createFirstPhotoCover");
    formData.append("photo", photoFile("direct.png"));
    formData.append("postAsSpoon", "false");
    formData.append("generateEditorial", "false");
    formData.append("activateWhenReady", "false");

    const result = await handleRecipeDetailAction({
      request: await makeAuthedPostRequest(chef.id, recipe.id, formData) as unknown as Request,
      params: { id: recipe.id },
      context: { cloudflare: { env: null } } as any,
    });

    expect(result).toMatchObject({
      success: true,
      intent: "createFirstPhotoCover",
      spoon: null,
      coverId: expect.any(String),
    });
    const cover = await db.recipeCover.findUniqueOrThrow({
      where: { id: (result as { coverId: string }).coverId },
    });
    expect(cover).toMatchObject({
      recipeId: recipe.id,
      sourceType: "chef-upload",
      sourceSpoonId: null,
      status: "ready",
      generationStatus: "none",
    });
    await expect(db.recipeSpoon.count({ where: { recipeId: recipe.id } })).resolves.toBe(0);
    await expect(db.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
    })).resolves.toEqual({
      activeCoverId: null,
      activeCoverVariant: null,
      coverMode: "auto",
    });
  });

  it("rejects missing photos, invalid cookedAt values, and unsupported direct upload images", async () => {
    const chef = await makeUser();
    const recipe = await db.recipe.create({
      data: { title: "First Photo Rejections", chefId: chef.id },
    });
    const noPhoto = new UndiciFormData();
    noPhoto.append("intent", "createFirstPhotoCover");

    await expect(handleRecipeDetailAction({
      request: await makeAuthedPostRequest(chef.id, recipe.id, noPhoto) as unknown as Request,
      params: { id: recipe.id },
      context: { cloudflare: { env: null } } as any,
    })).rejects.toMatchObject({ status: 400 });

    const invalidCookedAt = new UndiciFormData();
    invalidCookedAt.append("intent", "createFirstPhotoCover");
    invalidCookedAt.append("photo", photoFile("invalid-cooked-at.png"));
    invalidCookedAt.append("cookedAt", "not-a-date");
    await expect(handleRecipeDetailAction({
      request: await makeAuthedPostRequest(chef.id, recipe.id, invalidCookedAt) as unknown as Request,
      params: { id: recipe.id },
      context: { cloudflare: { env: null } } as any,
    })).rejects.toMatchObject({ status: 400 });

    const gif = new UndiciFormData();
    gif.append("intent", "createFirstPhotoCover");
    gif.append("photo", photoFile("animated.gif", GIF_BYTES, "image/gif"));
    gif.append("postAsSpoon", "false");
    await expect(handleRecipeDetailAction({
      request: await makeAuthedPostRequest(chef.id, recipe.id, gif) as unknown as Request,
      params: { id: recipe.id },
      context: { cloudflare: { env: null } } as any,
    })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects first-photo Spoon preservation when the saved Spoon has no photo URL", async () => {
    const chef = await makeUser();
    const recipe = await db.recipe.create({
      data: { title: "Null Spoon Photo", chefId: chef.id },
    });
    const originalCreate = db.recipeSpoon.create;
    db.recipeSpoon.create = vi.fn(async ({ data }: Parameters<typeof db.recipeSpoon.create>[0]) => ({
      id: "spoon_without_photo",
      recipeId: data.recipeId as string,
      chefId: data.chefId as string,
      note: null,
      nextTime: null,
      photoUrl: null,
      cookedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as unknown as typeof db.recipeSpoon.create;
    const formData = new UndiciFormData();
    formData.append("intent", "createFirstPhotoCover");
    formData.append("photo", photoFile("null-spoon-photo.png"));
    formData.append("postAsSpoon", "true");
    formData.append("generateEditorial", "false");

    try {
      await expect(handleRecipeDetailAction({
        request: await makeAuthedPostRequest(chef.id, recipe.id, formData) as unknown as Request,
        params: { id: recipe.id },
        context: { cloudflare: { env: null } } as any,
      })).rejects.toMatchObject({ status: 400 });
    } finally {
      db.recipeSpoon.create = originalCreate;
    }
  });

  it("queues direct first-photo editorialization without activation when requested", async () => {
    const chef = await makeUser();
    const recipe = await db.recipe.create({
      data: { title: "Inactive Editorial First Photo", chefId: chef.id },
    });
    const captured: Promise<unknown>[] = [];
    const formData = new UndiciFormData();
    formData.append("intent", "createFirstPhotoCover");
    formData.append("photo", photoFile("inactive-editorial.png"));
    formData.append("postAsSpoon", "false");
    formData.append("generateEditorial", "true");
    formData.append("activateWhenReady", "false");

    const result = await handleRecipeDetailAction({
      request: await makeAuthedPostRequest(chef.id, recipe.id, formData) as unknown as Request,
      params: { id: recipe.id },
      context: {
        cloudflare: {
          env: null,
          ctx: { waitUntil: (promise: Promise<unknown>) => captured.push(promise) },
        },
      } as any,
    });

    expect(result).toMatchObject({
      success: true,
      intent: "createFirstPhotoCover",
      spoon: null,
      coverId: expect.any(String),
    });
    expect(captured).toHaveLength(1);
    await expect(db.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
    })).resolves.toEqual({
      activeCoverId: null,
      activeCoverVariant: null,
      coverMode: "auto",
    });
    await Promise.all(captured);
  });

  it("queues spoon-photo cover creation without an activation guard by default", async () => {
    const chef = await makeUser();
    const recipe = await db.recipe.create({
      data: { title: "Unguarded Spoon Cover", chefId: chef.id },
    });
    const spoon = await db.recipeSpoon.create({
      data: {
        recipeId: recipe.id,
        chefId: chef.id,
        photoUrl: "/photos/spoons/unguarded.jpg",
      },
    });
    const formData = new UndiciFormData();
    formData.append("intent", "createCoverFromSpoon");
    formData.append("spoonId", spoon.id);
    const captured: Promise<unknown>[] = [];

    const result = await handleRecipeDetailAction({
      request: await makeAuthedPostRequest(chef.id, recipe.id, formData) as unknown as Request,
      params: { id: recipe.id },
      context: {
        cloudflare: {
          env: null,
          ctx: { waitUntil: (promise: Promise<unknown>) => captured.push(promise) },
        },
      } as any,
    });

    expect(result).toMatchObject({ success: true, intent: "createCoverFromSpoon" });
    expect(captured).toHaveLength(1);
    await expect(db.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
    })).resolves.toEqual({
      activeCoverId: null,
      activeCoverVariant: null,
      coverMode: "auto",
    });
    await Promise.all(captured);
  });

  it("keeps the original first-photo failure when best-effort cleanup also fails", async () => {
    const chef = await makeUser();
    const recipe = await db.recipe.create({
      data: { title: "Cleanup Failure", chefId: chef.id },
    });
    const bucket = mockPhotoBucket();
    vi.mocked(bucket.delete).mockRejectedValue(new Error("delete failed"));
    const originalTransaction = db.$transaction;
    const originalCoverDeleteMany = db.recipeCover.deleteMany;
    const originalSpoonDeleteMany = db.recipeSpoon.deleteMany;
    db.$transaction = vi.fn().mockRejectedValue(new Error("activation failed")) as unknown as typeof db.$transaction;
    db.recipeCover.deleteMany = vi.fn().mockRejectedValue(new Error("cover cleanup failed")) as unknown as typeof db.recipeCover.deleteMany;
    db.recipeSpoon.deleteMany = vi.fn().mockRejectedValue(new Error("spoon cleanup failed")) as unknown as typeof db.recipeSpoon.deleteMany;
    const formData = new UndiciFormData();
    formData.append("intent", "createFirstPhotoCover");
    formData.append("photo", photoFile("cleanup.png"));
    formData.append("postAsSpoon", "true");
    formData.append("generateEditorial", "false");
    formData.append("activateWhenReady", "true");

    try {
      await expect(handleRecipeDetailAction({
        request: await makeAuthedPostRequest(chef.id, recipe.id, formData) as unknown as Request,
        params: { id: recipe.id },
        context: { cloudflare: { env: { PHOTOS: bucket } } } as any,
      })).rejects.toThrow("activation failed");
      expect(db.recipeCover.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ recipeId: recipe.id }),
      }));
      expect(db.recipeSpoon.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ recipeId: recipe.id }),
      }));
      expect(bucket.delete).toHaveBeenCalled();
    } finally {
      db.$transaction = originalTransaction;
      db.recipeCover.deleteMany = originalCoverDeleteMany;
      db.recipeSpoon.deleteMany = originalSpoonDeleteMany;
    }
  });

  it("touches containing cookbooks when explicitly setting a recipe to no cover", async () => {
    const chef = await makeUser();
    const recipe = await db.recipe.create({
      data: { title: "Coverless Cookbook Sync", chefId: chef.id },
    });
    const cover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/covers/coverless-sync.jpg",
        sourceType: "chef-upload",
        status: "ready",
      },
    });
    const cookbook = await db.cookbook.create({ data: { title: "Cover Sync Box", authorId: chef.id } });
    await db.recipeInCookbook.create({
      data: {
        cookbookId: cookbook.id,
        recipeId: recipe.id,
        addedById: chef.id,
      },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: {
        activeCoverId: cover.id,
        activeCoverVariant: "image",
        coverMode: "manual",
      },
    });
    const oldUpdatedAt = new Date("2000-01-01T00:00:00.000Z");
    await db.cookbook.update({
      where: { id: cookbook.id },
      data: { updatedAt: oldUpdatedAt },
    });

    const formData = new UndiciFormData();
    formData.append("intent", "setRecipeNoCover");
    formData.append("confirmNoCover", "true");

    await expect(handleRecipeDetailAction({
      request: await makeAuthedPostRequest(chef.id, recipe.id, formData) as unknown as Request,
      params: { id: recipe.id },
      context: { cloudflare: { env: null } } as any,
    })).resolves.toMatchObject({ success: true, intent: "setRecipeNoCover" });

    await expect(db.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
    })).resolves.toEqual({
      activeCoverId: null,
      activeCoverVariant: null,
      coverMode: "none",
    });
    const touchedCookbook = await db.cookbook.findUniqueOrThrow({
      where: { id: cookbook.id },
      select: { updatedAt: true },
    });
    expect(touchedCookbook.updatedAt.getTime()).toBeGreaterThan(oldUpdatedAt.getTime());
  });
});

describe("handleRecipeDetailAction addToCookbook error surfacing", () => {
  beforeEach(async () => { await cleanupDatabase(); });
  afterEach(async () => { await cleanupDatabase(); });

  it("touches cookbook freshness when removing a missing recipe relation", async () => {
    const chef = await makeUser();
    const recipe = await db.recipe.create({ data: { title: "Greens", chefId: chef.id } });
    const cookbook = await db.cookbook.create({ data: { title: "Box", authorId: chef.id } });
    const oldUpdatedAt = new Date("2000-01-01T00:00:00.000Z");
    await db.cookbook.update({
      where: { id: cookbook.id },
      data: { updatedAt: oldUpdatedAt },
    });

    const formData = new UndiciFormData();
    formData.append("intent", "removeFromCookbook");
    formData.append("cookbookId", cookbook.id);
    const request = await makeAuthedPostRequest(chef.id, recipe.id, formData) as unknown as Request;

    await expect(handleRecipeDetailAction({
      request,
      params: { id: recipe.id },
      context: { cloudflare: { env: null } } as any,
    })).resolves.toEqual({ success: true });

    const touchedCookbook = await db.cookbook.findUniqueOrThrow({
      where: { id: cookbook.id },
      select: { updatedAt: true },
    });
    expect(touchedCookbook.updatedAt.getTime()).toBeGreaterThan(oldUpdatedAt.getTime());
  });

  it("re-throws non-P2002 errors instead of returning success (audit-fix regression)", async () => {
    // The old catch swallowed every error as { success: true }, hiding real
    // failures behind a "saved" UI. The fix narrows to P2002 only and
    // re-throws everything else. Mocking the transactional write is the only
    // deterministic way to exercise that branch now that membership creation
    // and native sync invalidation commit together.
    const chef = await makeUser();
    const recipe = await db.recipe.create({ data: { title: "Greens", chefId: chef.id } });
    const cookbook = await db.cookbook.create({ data: { title: "Box", authorId: chef.id } });

    const originalTransaction = db.$transaction;
    db.$transaction = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("Database error"), { code: "P2003" })) as unknown as typeof db.$transaction;

    try {
      const formData = new UndiciFormData();
      formData.append("intent", "addToCookbook");
      formData.append("cookbookId", cookbook.id);

      const session = await sessionStorage.getSession();
      session.set("userId", chef.id);
      const cookie = (await sessionStorage.commitSession(session)).split(";")[0];
      const headers = new Headers();
      headers.set("Cookie", cookie);

      const request = new UndiciRequest(`http://localhost/recipes/${recipe.id}`, {
        method: "POST",
        headers,
        body: formData,
      }) as unknown as Request;

      await expect(
        handleRecipeDetailAction({
          request,
          params: { id: recipe.id },
          context: { cloudflare: { env: null } } as any,
        }),
      ).rejects.toMatchObject({ message: "Database error", code: "P2003" });
    } finally {
      db.$transaction = originalTransaction;
    }
  });
});
