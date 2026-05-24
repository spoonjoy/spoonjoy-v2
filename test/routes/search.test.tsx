import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen } from "@testing-library/react";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import Search, { loader, meta } from "~/routes/search";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRoutesStub, createTestUser, getOrCreateIngredientRef } from "../utils";

async function createSessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

async function createSearchUser(usernamePrefix: string) {
  return db.user.create({
    data: {
      ...createTestUser(),
      username: `${usernamePrefix}_${faker.string.alphanumeric(8).toLowerCase()}`,
    },
  });
}

describe("Search Route", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("loader", () => {
    it("returns full-text results with private shopping-list items for the signed-in owner", async () => {
      const user = await createSearchUser("tomato_searcher");
      const recipe = await db.recipe.create({
        data: {
          title: "Tomato Table Sauce",
          description: "A searchable sauce",
          chefId: user.id,
        },
      });
      const cookbook = await db.cookbook.create({ data: { title: "Tomato Nights", authorId: user.id } });
      await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: user.id } });
      const list = await db.shoppingList.create({ data: { authorId: user.id } });
      const ingredientRef = await getOrCreateIngredientRef(db, "tomato paste");
      const item = await db.shoppingListItem.create({
        data: {
          shoppingListId: list.id,
          ingredientRefId: ingredientRef.id,
          categoryKey: "pantry",
        },
      });

      const headers = new Headers({ Cookie: await createSessionCookie(user.id) });
      const request = new UndiciRequest("http://localhost:3000/search?q=tomato&scope=all", { headers });
      const result = await loader({ request, context: { cloudflare: { env: null } }, params: {} } as any);

      expect(result).toMatchObject({ query: "tomato", scope: "all", isAuthenticated: true });
      expect(result.results.map((searchResult) => searchResult.id)).toEqual(
        expect.arrayContaining([recipe.id, cookbook.id, user.id, item.id])
      );
      expect(result.results.find((searchResult) => searchResult.id === item.id)).toMatchObject({
        type: "shopping-list-item",
        title: "tomato paste",
      });
    });

    it("normalizes unauthenticated shopping-list searches to an empty private result set", async () => {
      const user = await createSearchUser("private_searcher");
      const list = await db.shoppingList.create({ data: { authorId: user.id } });
      const ingredientRef = await getOrCreateIngredientRef(db, "milk");
      await db.shoppingListItem.create({ data: { shoppingListId: list.id, ingredientRefId: ingredientRef.id } });

      const request = new UndiciRequest("http://localhost:3000/search?q=milk&scope=shopping");
      const result = await loader({ request, context: { cloudflare: { env: null } }, params: {} } as any);

      expect(result).toEqual({
        query: "milk",
        scope: "shopping-list",
        isAuthenticated: false,
        results: [],
      });
    });

    it("defaults empty query and scope parameters", async () => {
      const request = new UndiciRequest("http://localhost:3000/search");
      const result = await loader({ request, context: { cloudflare: { env: null } }, params: {} } as any);

      expect(result).toMatchObject({
        query: "",
        scope: "all",
        isAuthenticated: false,
      });
    });
  });

  describe("meta", () => {
    it("returns search metadata", () => {
      expect(meta({} as any)).toEqual([
        { title: "Search Spoonjoy" },
        { name: "description", content: "Search Spoonjoy recipes, cookbooks, chefs, and private shopping-list items." },
      ]);
    });
  });

  describe("component", () => {
    it("renders search chrome, scope navigation, and the empty starting state", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/search",
          Component: Search,
          loader: () => ({ query: "", scope: "all", isAuthenticated: false, results: [] }),
        },
      ]);

      render(<Stub initialEntries={["/search"]} />);

      expect(await screen.findByRole("heading", { name: /find the thing you meant to cook/i })).toBeInTheDocument();
      expect(screen.getByRole("searchbox")).toHaveAttribute("name", "q");
      expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
      expect(screen.getByText("Recently searchable")).toBeInTheDocument();
      expect(screen.getByText("0 results")).toBeInTheDocument();
      expect(screen.getByText(/Shopping-list results are always private/i)).toBeInTheDocument();
      expect(screen.getByText(/Try searching by ingredient/i)).toBeInTheDocument();
      expect(screen.getByText("No matches yet")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Recipes" })).toHaveAttribute("href", "/search?scope=recipes");
    });

    it("renders recipe, cookbook, chef, and private shopping-list result cards", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/search",
          Component: Search,
          loader: () => ({
            query: "tomato",
            scope: "all",
            isAuthenticated: true,
            results: [
              {
                type: "recipe",
                id: "recipe-1",
                ownerId: "user-1",
                ownerUsername: "chef-ari",
                title: "Tomato Sauce",
                subtitle: "Recipe by chef-ari",
                snippet: "tomato basil simmer",
                href: "/recipes/recipe-1",
                imageUrl: "https://example.com/tomato.jpg",
                score: -1,
                metadata: {},
              },
              {
                type: "cookbook",
                id: "cookbook-1",
                ownerId: "user-1",
                ownerUsername: "chef-ari",
                title: "Sunday Sauces",
                subtitle: "Cookbook by chef-ari",
                snippet: "Tomato Sauce",
                href: "/cookbooks/cookbook-1",
                imageUrl: "",
                score: -0.5,
                metadata: {},
              },
              {
                type: "chef",
                id: "user-1",
                ownerId: "user-1",
                ownerUsername: "chef-ari",
                title: "chef-ari",
                subtitle: "Chef kitchen",
                snippet: "recipes 1 cookbooks 1",
                href: "/users/chef-ari",
                imageUrl: "https://example.com/avatar.jpg",
                score: -0.3,
                metadata: {},
              },
              {
                type: "shopping-list-item",
                id: "item-1",
                ownerId: "user-1",
                ownerUsername: "chef-ari",
                title: "tomato paste",
                subtitle: "Shopping list item for chef-ari",
                snippet: "tomato paste pantry unchecked",
                href: "/shopping-list",
                imageUrl: null,
                score: -0.1,
                metadata: { checked: false },
              },
            ],
          }),
        },
      ]);

      const { container } = render(<Stub initialEntries={["/search?q=tomato"]} />);

      expect(await screen.findByText('Results for "tomato"')).toBeInTheDocument();
      expect(screen.getByText("4 results")).toBeInTheDocument();
      expect(container.querySelector('img[src="https://example.com/tomato.jpg"]')).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Recipe Tomato Sauce/i })).toHaveAttribute("href", "/recipes/recipe-1");
      expect(screen.getByRole("link", { name: /Cookbook Sunday Sauces/i })).toHaveAttribute("href", "/cookbooks/cookbook-1");
      expect(screen.getByRole("link", { name: /Chef chef-ari/i })).toHaveAttribute("href", "/users/chef-ari");
      expect(screen.getByRole("link", { name: /Shopping List Private tomato paste/i })).toHaveAttribute("href", "/shopping-list");
    });

    it("renders the unauthenticated private-shopping prompt", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/search",
          Component: Search,
          loader: () => ({ query: "milk", scope: "shopping-list", isAuthenticated: false, results: [] }),
        },
      ]);

      render(<Stub initialEntries={["/search?q=milk&scope=shopping-list"]} />);

      expect(await screen.findByText('Results for "milk"')).toBeInTheDocument();
      expect(screen.getByText("Log in to search your private shopping list.")).toBeInTheDocument();
      expect(screen.getByText("No matches yet")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Everything" })).toHaveAttribute("href", "/search?scope=all&q=milk");
    });

    it("uses the singular result label for one search result", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/search",
          Component: Search,
          loader: () => ({
            query: "chef",
            scope: "chefs",
            isAuthenticated: true,
            results: [
              {
                type: "chef",
                id: "user-1",
                ownerId: "user-1",
                ownerUsername: "chef-one",
                title: "chef-one",
                subtitle: "Chef kitchen",
                snippet: "recipes 0 cookbooks 0",
                href: "/users/chef-one",
                imageUrl: null,
                score: 0,
                metadata: {},
              },
            ],
          }),
        },
      ]);

      render(<Stub initialEntries={["/search?q=chef&scope=chefs"]} />);

      expect(await screen.findByText("1 result")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Chef chef-one/i })).toHaveAttribute("href", "/users/chef-one");
    });
  });
});
