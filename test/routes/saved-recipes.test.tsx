import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

function routeArgs(request: Request) {
  return {
    request,
    context: { cloudflare: { env: null } },
    params: {},
  } as any;
}

describe("Saved Recipes drawer route", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("redirects unauthenticated cooks to login", async () => {
    await expect(
      loader(routeArgs(new UndiciRequest("http://localhost:3000/saved-recipes") as unknown as Request)),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(302);
      return true;
    });
  });

  it("lists only the owner's active SavedRecipe rows and keeps cookbook membership independent", async () => {
    const viewer = await createDrawerUser("saved-viewer");
    const otherChef = await createDrawerUser("saved-other");
    const foreignOwner = await createDrawerUser("saved-foreign-owner");
    const directNewer = await createDrawerRecipe({
      chefId: otherChef.id,
      title: "Miso Noodles",
      description: "Direct save",
    });
    const directOlder = await createDrawerRecipe({
      chefId: otherChef.id,
      title: "Miso Soup",
      description: "Older direct save",
    });
    const cookbookOnly = await createDrawerRecipe({
      chefId: otherChef.id,
      title: "Miso Cookbook Toast",
    });
    const deleted = await createDrawerRecipe({
      chefId: otherChef.id,
      title: "Miso Deleted Save",
      deletedAt: new Date("2026-07-22T11:00:00.000Z"),
    });
    const cookbook = await db.cookbook.create({
      data: { title: "Miso Cookbook", authorId: viewer.id },
    });
    await db.recipeInCookbook.create({
      data: {
        cookbookId: cookbook.id,
        recipeId: cookbookOnly.id,
        addedById: viewer.id,
      },
    });
    await db.savedRecipe.createMany({
      data: [
        { userId: viewer.id, recipeId: directNewer.id, savedAt: "2026-07-22T12:00:00.000Z" },
        { userId: viewer.id, recipeId: directOlder.id, savedAt: "2026-07-22T10:00:00.000Z" },
        { userId: viewer.id, recipeId: deleted.id, savedAt: "2026-07-22T13:00:00.000Z" },
        { userId: foreignOwner.id, recipeId: cookbookOnly.id, savedAt: "2026-07-22T14:00:00.000Z" },
      ],
    });

    const result = await loader(routeArgs(new UndiciRequest(
      "http://localhost:3000/saved-recipes?q=miso",
      { headers: await sessionHeaders(viewer.id) },
    ) as unknown as Request));

    expect(result.query).toBe("miso");
    expect(result.recipes.map((recipe: { id: string }) => recipe.id)).toEqual([
      directNewer.id,
      directOlder.id,
    ]);
    expect(result.recipes[0]).toMatchObject({
      title: "Miso Noodles",
      chef: { id: otherChef.id, username: otherChef.username },
      savedAt: "2026-07-22T12:00:00.000Z",
    });
    expect(result.recipes.every((recipe: Record<string, unknown>) => !("savedCookbookTitles" in recipe))).toBe(true);
    expect(result.nextCursor).toBeNull();
  });

  it("paginates SavedRecipe rows with the opaque service cursor and no duplicates", async () => {
    const viewer = await createDrawerUser("saved-pages");
    const chef = await createDrawerUser("saved-pages-chef");
    const recipeIds: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      const recipe = await createDrawerRecipe({
        chefId: chef.id,
        title: `Page Recipe ${String(index).padStart(2, "0")}`,
      });
      recipeIds.push(recipe.id);
      await db.savedRecipe.create({
        data: {
          userId: viewer.id,
          recipeId: recipe.id,
          savedAt: new Date(Date.UTC(2026, 6, 22, 12, 0, index)).toISOString(),
        },
      });
    }

    const first = await loader(routeArgs(new UndiciRequest(
      "http://localhost:3000/saved-recipes?q=page%20recipe",
      { headers: await sessionHeaders(viewer.id) },
    ) as unknown as Request));
    expect(first.recipes).toHaveLength(24);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await loader(routeArgs(new UndiciRequest(
      `http://localhost:3000/saved-recipes?q=page%20recipe&cursor=${encodeURIComponent(first.nextCursor!)}`,
      { headers: await sessionHeaders(viewer.id) },
    ) as unknown as Request));
    expect(second.query).toBe("page recipe");
    expect(second.recipes).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const allIds = [...first.recipes, ...second.recipes].map((recipe: { id: string }) => recipe.id);
    expect(new Set(allIds).size).toBe(25);
    expect(new Set(allIds)).toEqual(new Set(recipeIds));
  });

  it("returns an empty drawer for cookbook-only and another owner's saved rows", async () => {
    const viewer = await createDrawerUser("saved-empty");
    const otherChef = await createDrawerUser("saved-empty-other");
    const recipe = await createDrawerRecipe({ chefId: otherChef.id, title: "Not Saved Here" });
    const cookbook = await db.cookbook.create({
      data: { title: "Viewer Cookbook", authorId: viewer.id },
    });
    await db.recipeInCookbook.create({
      data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: viewer.id },
    });
    await db.savedRecipe.create({
      data: { userId: otherChef.id, recipeId: recipe.id, savedAt: "2026-07-22T12:00:00.000Z" },
    });

    const result = await loader(routeArgs(new UndiciRequest(
      "http://localhost:3000/saved-recipes",
      { headers: await sessionHeaders(viewer.id) },
    ) as unknown as Request));

    expect(result).toMatchObject({ query: "", recipes: [], nextCursor: null });
  });

  it("maps malformed saved-recipe cursors to a web 400 response", async () => {
    const viewer = await createDrawerUser("saved-invalid-cursor");

    await expect(loader(routeArgs(new UndiciRequest(
      "http://localhost:3000/saved-recipes?cursor=not%2Bbase64url",
      { headers: await sessionHeaders(viewer.id) },
    ) as unknown as Request))).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(400);
      return true;
    });
  });

  it("renders an independent empty state without cookbook creation copy", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/saved-recipes",
        Component: SavedRecipes,
        loader: () => ({ query: "", recipes: [], nextCursor: null }),
      },
    ]);

    render(<Stub initialEntries={["/saved-recipes"]} />);

    expect(await screen.findByRole("heading", { level: 1, name: "Saved Recipes" })).toBeInTheDocument();
    expect(screen.getByText("Recipes you saved for later.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /explore recipes/i })).toHaveAttribute("href", "/recipes");
    expect(screen.queryByRole("link", { name: /new cookbook/i })).not.toBeInTheDocument();
    expect(screen.getByText("Save a recipe to keep it close at hand.")).toBeInTheDocument();
  });

  it("renders saved rows without presenting cookbook membership as save context", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/saved-recipes",
        Component: SavedRecipes,
        loader: () => ({
          query: "",
          nextCursor: null,
          recipes: [
            {
              id: "recipe-1",
              title: "Saved Lentils",
              description: null,
              servings: "Serves 2",
              chef: { id: "chef-1", username: "maria" },
              savedAt: "2026-07-22T12:00:00.000Z",
              savedCookbookTitles: [],
            },
            {
              id: "recipe-2",
              title: "Saved Toast",
              description: "Crisp and quick",
              servings: null,
              chef: { id: "chef-2", username: "lin" },
              savedAt: "2026-07-22T11:00:00.000Z",
              savedCookbookTitles: [],
            },
          ],
        }),
      },
    ]);

    render(<Stub initialEntries={["/saved-recipes"]} />);

    expect(await screen.findByRole("link", { name: /saved lentils/i })).toHaveAttribute("href", "/recipes/recipe-1");
    expect(screen.getByRole("link", { name: /saved toast/i })).toHaveAttribute("href", "/recipes/recipe-2");
    expect(screen.getByText("By maria")).toBeInTheDocument();
    expect(screen.getByText("Crisp and quick")).toBeInTheDocument();
    expect(screen.getByText("Serves 2")).toBeInTheDocument();
    expect(screen.queryByText(/cookbook/i)).not.toBeInTheDocument();
  });

  it("renders query-specific copy and a cursor link that preserves the query", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/saved-recipes",
        Component: SavedRecipes,
        loader: () => ({
          query: "red lentils",
          recipes: [{
            id: "recipe-1",
            title: "Red Lentils",
            description: null,
            servings: null,
            chef: { id: "chef-1", username: "maria" },
            savedAt: "2026-07-22T12:00:00.000Z",
            savedCookbookTitles: [],
          }],
          nextCursor: "opaque_cursor",
        }),
      },
    ]);

    render(<Stub initialEntries={["/saved-recipes?q=red%20lentils"]} />);

    expect(await screen.findByRole("navigation", { name: "Saved recipes pagination" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
      "href",
      "/saved-recipes?q=red+lentils&cursor=opaque_cursor",
    );
  });

  it("renders the query-specific saved-recipes empty state", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/saved-recipes",
        Component: SavedRecipes,
        loader: () => ({ query: "turnip", recipes: [], nextCursor: null }),
      },
    ]);

    render(<Stub initialEntries={["/saved-recipes?q=turnip"]} />);

    expect(await screen.findByRole("heading", { name: "No matching saved recipes" })).toBeInTheDocument();
    expect(screen.getByText("Try a different title, chef, course, or tag.")).toBeInTheDocument();
  });
});
