import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { loadRecipeDetail, handleRecipeDetailAction } from "~/lib/recipe-detail.server";
import { cleanupDatabase } from "../helpers/cleanup";

async function makeAuthedRequest(userId: string, recipeId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  const setCookie = await sessionStorage.commitSession(session);
  const cookie = setCookie.split(";")[0];
  const headers = new Headers();
  headers.set("Cookie", cookie);
  return new UndiciRequest(`http://localhost/recipes/${recipeId}`, { headers });
}

async function makeUser() {
  return db.user.create({
    data: {
      email: faker.internet.email(),
      username: faker.internet.username() + "_" + faker.string.alphanumeric(8),
    },
  });
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

describe("handleRecipeDetailAction addToCookbook error surfacing", () => {
  beforeEach(async () => { await cleanupDatabase(); });
  afterEach(async () => { await cleanupDatabase(); });

  it("re-throws non-P2002 errors instead of returning success (audit-fix regression)", async () => {
    // The old catch swallowed every error as { success: true }, hiding real
    // failures behind a "saved" UI. The fix narrows to P2002 only and
    // re-throws everything else. Mocking a non-P2002 reject is the only way
    // to exercise that branch from a deterministic test.
    const chef = await makeUser();
    const recipe = await db.recipe.create({ data: { title: "Greens", chefId: chef.id } });
    const cookbook = await db.cookbook.create({ data: { title: "Box", authorId: chef.id } });

    const originalCreate = db.recipeInCookbook.create;
    db.recipeInCookbook.create = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("Database error"), { code: "P2003" }));

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
      db.recipeInCookbook.create = originalCreate;
    }
  });
});
