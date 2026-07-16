import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen } from "@testing-library/react";
import { cleanupDatabase } from "../helpers/cleanup";
import {
  INGREDIENT_LOOKUP_BATCH_SIZE,
  loadIngredientNamesByRecipeId,
  loader,
} from "~/routes/my-recipes";
import MyRecipes from "~/routes/my-recipes";
import { createTestRoutesStub } from "../utils";
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

  it("returns an empty drawer for a signed-in chef without recipes", async () => {
    const viewer = await createDrawerUser("my-recipes-empty");

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/my-recipes", {
        headers: await sessionHeaders(viewer.id),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.query).toBe("");
    expect(result.recipes).toEqual([]);
  });

  it("keeps owned recipes in updated order when no drawer query is present", async () => {
    const viewer = await createDrawerUser("my-recipes-order");
    const older = await createDrawerRecipe({
      chefId: viewer.id,
      title: "Older Pantry Pasta",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const newer = await createDrawerRecipe({
      chefId: viewer.id,
      title: "Newer Pantry Pasta",
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    });

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/my-recipes", {
        headers: await sessionHeaders(viewer.id),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.recipes.map((recipe: { id: string }) => recipe.id)).toEqual([
      newer.id,
      older.id,
    ]);
  });

  it("returns one bounded page of owned recipes while preserving updated order", async () => {
    const viewer = await createDrawerUser("my-recipes-page");

    for (let index = 0; index < 51; index += 1) {
      await createDrawerRecipe({
        chefId: viewer.id,
        title: `Paged Pantry Pasta ${index.toString().padStart(2, "0")}`,
        updatedAt: new Date(Date.UTC(2026, 0, index + 1, 0, 0, 0)),
      });
    }

    const firstPage = await loader({
      request: new UndiciRequest("http://localhost:3000/my-recipes?page=1", {
        headers: await sessionHeaders(viewer.id),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);
    const secondPage = await loader({
      request: new UndiciRequest("http://localhost:3000/my-recipes?page=2", {
        headers: await sessionHeaders(viewer.id),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(firstPage.recipes).toHaveLength(50);
    expect(firstPage.recipes[0].title).toBe("Paged Pantry Pasta 50");
    expect(firstPage.recipes.at(-1)?.title).toBe("Paged Pantry Pasta 01");
    expect(firstPage).toMatchObject({
      page: 1,
      pageSize: 50,
      hasPreviousPage: false,
      hasNextPage: true,
    });
    expect(secondPage.recipes.map((recipe: { title: string }) => recipe.title)).toEqual([
      "Paged Pantry Pasta 00",
    ]);
    expect(secondPage).toMatchObject({
      page: 2,
      pageSize: 50,
      hasPreviousPage: true,
      hasNextPage: false,
    });
  });

  it("batches ingredient lookup so large kitchens stay under D1 variable limits", async () => {
    const recipeIds = Array.from(
      { length: INGREDIENT_LOOKUP_BATCH_SIZE * 2 + 3 },
      (_, index) => `recipe-${index}`,
    );
    const batchSizes: number[] = [];
    const database = {
      ingredient: {
        findMany: vi.fn(async (args: {
          where: { recipeId: { in: string[] } };
          select: { recipeId: true; ingredientRef: { select: { name: true } } };
        }) => {
          const batch = args.where.recipeId.in;
          if (batch.length > INGREDIENT_LOOKUP_BATCH_SIZE) {
            throw new Error("would exceed D1 variable limit");
          }
          batchSizes.push(batch.length);
          return batch.slice(0, 1).map((recipeId) => ({
            recipeId,
            ingredientRef: { name: `ingredient-${recipeId}` },
          }));
        }),
      },
    };

    const result = await loadIngredientNamesByRecipeId(database, recipeIds);

    expect(database.ingredient.findMany).toHaveBeenCalledTimes(3);
    expect(batchSizes).toEqual([
      INGREDIENT_LOOKUP_BATCH_SIZE,
      INGREDIENT_LOOKUP_BATCH_SIZE,
      3,
    ]);
    expect(result.get("recipe-0")).toEqual(["ingredient-recipe-0"]);
    expect(result.get(`recipe-${INGREDIENT_LOOKUP_BATCH_SIZE}`)).toEqual([
      `ingredient-recipe-${INGREDIENT_LOOKUP_BATCH_SIZE}`,
    ]);
  });

  it("renders owned recipe rows and the create action", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/my-recipes",
        Component: MyRecipes,
        loader: () => ({
          query: "",
          page: 1,
          pageSize: 50,
          hasPreviousPage: false,
          hasNextPage: false,
          recipes: [
            {
              id: "recipe-1",
              title: "Counter Beans",
              description: "Weeknight favorite",
              servings: "Serves 4",
              chef: { id: "chef-1", username: "ari" },
              ingredientNames: [],
            },
            {
              id: "recipe-2",
              title: "Plain Rice",
              description: null,
              servings: null,
              chef: { id: "chef-1", username: "ari" },
              ingredientNames: [],
            },
          ],
        }),
      },
    ]);

    render(<Stub initialEntries={["/my-recipes"]} />);

    expect(await screen.findByRole("heading", { level: 1, name: "My Recipes" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create recipe/i })).toHaveAttribute("href", "/recipes/new");
    expect(screen.getByRole("link", { name: /counter beans/i })).toHaveAttribute("href", "/recipes/recipe-1");
    expect(screen.getByRole("link", { name: /plain rice/i })).toHaveAttribute("href", "/recipes/recipe-2");
    expect(screen.getByText("By ari")).toBeInTheDocument();
    expect(screen.getByText("Serves 4")).toBeInTheDocument();
  });

  it("renders empty states for new and filtered personal drawers", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/my-recipes-empty",
        Component: MyRecipes,
        loader: () => ({
          query: "",
          page: 1,
          pageSize: 50,
          hasPreviousPage: false,
          hasNextPage: false,
          recipes: [],
        }),
      },
      {
        path: "/my-recipes-filtered",
        Component: MyRecipes,
        loader: () => ({
          query: "turnip",
          page: 1,
          pageSize: 50,
          hasPreviousPage: false,
          hasNextPage: false,
          recipes: [],
        }),
      },
    ]);

    const { unmount } = render(<Stub initialEntries={["/my-recipes-empty"]} />);

    expect(await screen.findByRole("heading", { name: "No recipes yet" })).toBeInTheDocument();
    expect(screen.getByText("Start with the dish you make most often.")).toBeInTheDocument();

    unmount();
    render(<Stub initialEntries={["/my-recipes-filtered?q=turnip"]} />);

    expect(await screen.findByRole("heading", { name: "No matching recipes" })).toBeInTheDocument();
    expect(screen.getByText("Try another title, ingredient, serving size, or note.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear" })).toHaveAttribute("href", "/my-recipes-filtered");
  });
});
