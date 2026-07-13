import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest } from "undici";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { loader } from "~/routes/chefs";
import {
  createDrawerRecipe,
  createDrawerUser,
  sessionHeaders,
} from "./kitchen-drawer-test-utils";

describe("Chefs drawer route", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("redirects unauthenticated cooks to login", async () => {
    await expect(
      loader({
        request: new UndiciRequest("http://localhost:3000/chefs"),
        context: { cloudflare: { env: null } },
        params: {},
      } as any),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(302);
      return true;
    });
  });

  it("returns fellow chefs, chefs using my recipes, and private chronological activity without shopping-list events", async () => {
    const viewer = await createDrawerUser("chefs-viewer");
    const outboundChef = await createDrawerUser("chefs-outbound");
    const inboundChef = await createDrawerUser("chefs-inbound");
    const savedChef = await createDrawerUser("chefs-saved");
    const viewerRecipe = await createDrawerRecipe({
      chefId: viewer.id,
      title: "Viewer Tomato Soup",
    });
    const outboundRecipe = await createDrawerRecipe({
      chefId: outboundChef.id,
      title: "Outbound Rice",
    });
    const savedRecipe = await createDrawerRecipe({
      chefId: savedChef.id,
      title: "Saved Chickpeas",
    });
    const cookbook = await db.cookbook.create({
      data: { title: "Activity Shelf", authorId: viewer.id },
    });

    await db.recipeSpoon.create({
      data: {
        chefId: viewer.id,
        recipeId: outboundRecipe.id,
        cookedAt: new Date("2026-05-01T10:00:00Z"),
      },
    });
    await db.recipe.create({
      data: {
        title: "Inbound Fork",
        chefId: inboundChef.id,
        sourceRecipeId: viewerRecipe.id,
        createdAt: new Date("2026-05-03T10:00:00Z"),
      },
    });
    await db.recipeInCookbook.create({
      data: {
        cookbookId: cookbook.id,
        recipeId: savedRecipe.id,
        addedById: viewer.id,
        createdAt: new Date("2026-05-02T10:00:00Z"),
      },
    });
    const shoppingList = await db.shoppingList.create({
      data: { authorId: viewer.id, updatedAt: new Date("2026-05-04T10:00:00Z") },
    });
    const ingredientRef = await db.ingredientRef.create({ data: { name: "not chef activity" } });
    await db.shoppingListItem.create({
      data: {
        shoppingListId: shoppingList.id,
        ingredientRefId: ingredientRef.id,
        updatedAt: new Date("2026-05-04T10:00:00Z"),
      },
    });

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/chefs", {
        headers: await sessionHeaders(viewer.id),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.fellowChefs.rows.map((chef: { chefId: string }) => chef.chefId)).toEqual([
      savedChef.id,
      outboundChef.id,
    ]);
    expect(result.chefsUsingMyRecipes.rows.map((chef: { chefId: string }) => chef.chefId)).toEqual([
      inboundChef.id,
    ]);
    expect(result.activity.map((row: { kind: string; direction: string; otherChef: { id: string } }) => ({
      kind: row.kind,
      direction: row.direction,
      otherChefId: row.otherChef.id,
    }))).toEqual([
      { kind: "forked", direction: "inbound", otherChefId: inboundChef.id },
      { kind: "saved", direction: "outbound", otherChefId: savedChef.id },
      { kind: "spooned", direction: "outbound", otherChefId: outboundChef.id },
    ]);
    expect(result.activity.map((row: { kind: string }) => row.kind)).not.toContain("shopping-list");
  });
});
