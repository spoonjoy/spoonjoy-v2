import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen } from "@testing-library/react";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { loader } from "~/routes/saved-recipes";
import SavedRecipes from "~/routes/saved-recipes";
import { createTestRoutesStub } from "../utils";
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

    const unfilteredResult = await loader({
      request: new UndiciRequest("http://localhost:3000/saved-recipes", {
        headers: await sessionHeaders(viewer.id),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);
    expect(unfilteredResult.recipes.map((recipe: { id: string }) => recipe.id)).toEqual([savedRecipe.id]);
  });

  it("returns an empty drawer when the signed-in chef has no owned cookbook saves", async () => {
    const viewer = await createDrawerUser("saved-empty");
    const otherChef = await createDrawerUser("saved-empty-other");
    const foreignRecipe = await createDrawerRecipe({
      chefId: otherChef.id,
      title: "Not Saved Here",
    });
    const foreignCookbook = await db.cookbook.create({
      data: { title: "Not My Shelf", authorId: otherChef.id },
    });
    await db.recipeInCookbook.create({
      data: {
        cookbookId: foreignCookbook.id,
        recipeId: foreignRecipe.id,
        addedById: otherChef.id,
      },
    });

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/saved-recipes", {
        headers: await sessionHeaders(viewer.id),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.query).toBe("");
    expect(result.recipes).toEqual([]);
  });

  it("renders empty saved-recipes actions for exploring recipes and creating a cookbook", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/saved-recipes",
        Component: SavedRecipes,
        loader: () => ({
          query: "",
          recipes: [],
        }),
      },
    ]);

    render(<Stub initialEntries={["/saved-recipes"]} />);

    expect(await screen.findByRole("heading", { level: 1, name: "Saved Recipes" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /explore recipes/i })).toHaveAttribute("href", "/recipes");
    expect(screen.getByRole("link", { name: /new cookbook/i })).toHaveAttribute("href", "/cookbooks/new");
  });

  it("renders saved recipe rows with cookbook context", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/saved-recipes",
        Component: SavedRecipes,
        loader: () => ({
          query: "",
          recipes: [
            {
              id: "recipe-1",
              title: "Saved Lentils",
              description: null,
              servings: "Serves 2",
              chef: { id: "chef-1", username: "maria" },
              savedCookbookTitles: ["Dinner Shelf", "Weeknight Shelf"],
            },
            {
              id: "recipe-2",
              title: "Saved Toast",
              description: null,
              servings: null,
              chef: { id: "chef-2", username: "lin" },
              savedCookbookTitles: ["Breakfast Shelf"],
            },
          ],
        }),
      },
    ]);

    render(<Stub initialEntries={["/saved-recipes"]} />);

    expect(await screen.findByRole("link", { name: /saved lentils/i })).toHaveAttribute("href", "/recipes/recipe-1");
    expect(screen.getByRole("link", { name: /saved toast/i })).toHaveAttribute("href", "/recipes/recipe-2");
    expect(screen.getByText("By maria - Dinner Shelf, Weeknight Shelf")).toBeInTheDocument();
    expect(screen.getByText("By lin - Breakfast Shelf")).toBeInTheDocument();
    expect(screen.getByText("Serves 2")).toBeInTheDocument();
  });

  it("renders the query-specific saved-recipes empty state", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/saved-recipes",
        Component: SavedRecipes,
        loader: () => ({
          query: "turnip",
          recipes: [],
        }),
      },
    ]);

    render(<Stub initialEntries={["/saved-recipes?q=turnip"]} />);

    expect(await screen.findByRole("heading", { name: "No matching saved recipes" })).toBeInTheDocument();
    expect(screen.getByText("Try a different cookbook, chef, or recipe term.")).toBeInTheDocument();
  });
});
