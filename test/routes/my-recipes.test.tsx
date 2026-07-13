import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest } from "undici";
import { cleanupDatabase } from "../helpers/cleanup";
import { loader } from "~/routes/my-recipes";
import {
  addIngredientToRecipe,
  createDrawerRecipe,
  createDrawerUser,
  sessionHeaders,
} from "./kitchen-drawer-test-utils";

describe("My Recipes drawer route", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("redirects unauthenticated cooks to login", async () => {
    await expect(
      loader({
        request: new UndiciRequest("http://localhost:3000/my-recipes"),
        context: { cloudflare: { env: null } },
        params: {},
      } as any),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(302);
      expect((error as Response).headers.get("Location")).toContain("/login");
      return true;
    });
  });

  it("shows only the signed-in chef's non-deleted recipes and supports local ingredient search", async () => {
    const viewer = await createDrawerUser("my-recipes-viewer");
    const otherChef = await createDrawerUser("my-recipes-other");
    const matchingOwn = await createDrawerRecipe({
      chefId: viewer.id,
      title: "Weeknight Lentils",
      description: "Peppery skillet dinner",
      updatedAt: new Date("2026-02-03T10:00:00Z"),
    });
    await addIngredientToRecipe(matchingOwn.id, "codex sumac");
    await createDrawerRecipe({
      chefId: viewer.id,
      title: "Quiet Beans",
      description: "No matching ingredient",
      updatedAt: new Date("2026-02-04T10:00:00Z"),
    });
    const deletedOwn = await createDrawerRecipe({
      chefId: viewer.id,
      title: "Deleted Sumac Bowl",
      deletedAt: new Date("2026-02-05T10:00:00Z"),
    });
    await addIngredientToRecipe(deletedOwn.id, "codex sumac");
    const otherRecipe = await createDrawerRecipe({
      chefId: otherChef.id,
      title: "Other Chef Sumac",
      updatedAt: new Date("2026-02-06T10:00:00Z"),
    });
    await addIngredientToRecipe(otherRecipe.id, "codex sumac");

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/my-recipes?q=sumac", {
        headers: await sessionHeaders(viewer.id),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.query).toBe("sumac");
    expect(result.recipes.map((recipe: { id: string }) => recipe.id)).toEqual([matchingOwn.id]);
    expect(result.recipes[0]).toMatchObject({
      title: "Weeknight Lentils",
      chef: { id: viewer.id, username: viewer.username },
    });
  });
});
