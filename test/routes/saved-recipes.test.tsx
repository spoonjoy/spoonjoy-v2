import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest } from "undici";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { loader } from "~/routes/saved-recipes";
import {
  createDrawerRecipe,
  createDrawerUser,
  sessionHeaders,
} from "./kitchen-drawer-test-utils";

describe("Saved Recipes drawer route", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("redirects unauthenticated cooks to login", async () => {
    await expect(
      loader({
        request: new UndiciRequest("http://localhost:3000/saved-recipes"),
        context: { cloudflare: { env: null } },
        params: {},
      } as any),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(302);
      return true;
    });
  });

  it("dedupes recipes saved through owned cookbooks and excludes foreign cookbooks or deleted recipes", async () => {
    const viewer = await createDrawerUser("saved-viewer");
    const otherChef = await createDrawerUser("saved-other");
    const foreignOwner = await createDrawerUser("saved-foreign-owner");
    const olderOwnedCookbook = await db.cookbook.create({
      data: { title: "Weeknight Shelf", authorId: viewer.id, updatedAt: new Date("2026-01-01T00:00:00Z") },
    });
    const newerOwnedCookbook = await db.cookbook.create({
      data: { title: "Dinner Shelf", authorId: viewer.id, updatedAt: new Date("2026-01-02T00:00:00Z") },
    });
    const foreignCookbook = await db.cookbook.create({
      data: { title: "Someone Else Shelf", authorId: foreignOwner.id },
    });
    const savedRecipe = await createDrawerRecipe({
      chefId: otherChef.id,
      title: "Miso Noodles",
      description: "Saved twice",
    });
    const deletedRecipe = await createDrawerRecipe({
      chefId: otherChef.id,
      title: "Deleted Saved Soup",
      deletedAt: new Date("2026-03-01T00:00:00Z"),
    });
    const foreignOnlyRecipe = await createDrawerRecipe({
      chefId: otherChef.id,
      title: "Foreign Shelf Toast",
    });

    await db.recipeInCookbook.create({
      data: {
        cookbookId: olderOwnedCookbook.id,
        recipeId: savedRecipe.id,
        addedById: viewer.id,
        createdAt: new Date("2026-04-01T00:00:00Z"),
        updatedAt: new Date("2026-04-01T00:00:00Z"),
      },
    });
    await db.recipeInCookbook.create({
      data: {
        cookbookId: newerOwnedCookbook.id,
        recipeId: savedRecipe.id,
        addedById: viewer.id,
        createdAt: new Date("2026-04-02T00:00:00Z"),
        updatedAt: new Date("2026-04-02T00:00:00Z"),
      },
    });
    await db.recipeInCookbook.create({
      data: {
        cookbookId: newerOwnedCookbook.id,
        recipeId: deletedRecipe.id,
        addedById: viewer.id,
      },
    });
    await db.recipeInCookbook.create({
      data: {
        cookbookId: foreignCookbook.id,
        recipeId: foreignOnlyRecipe.id,
        addedById: foreignOwner.id,
      },
    });

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/saved-recipes?q=dinner", {
        headers: await sessionHeaders(viewer.id),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.query).toBe("dinner");
    expect(result.recipes.map((recipe: { id: string }) => recipe.id)).toEqual([savedRecipe.id]);
    expect(result.recipes[0]).toMatchObject({
      title: "Miso Noodles",
      chef: { id: otherChef.id, username: otherChef.username },
      savedCookbookTitles: ["Dinner Shelf", "Weeknight Shelf"],
    });
  });
});
