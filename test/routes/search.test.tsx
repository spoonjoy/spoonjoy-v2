import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import * as searchServer from "~/lib/search.server";
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

    it("renders persisted neutral metadata only on global recipe cards", async () => {
      const user = await createSearchUser("global_card_metadata");
      const recipe = await db.recipe.create({
        data: {
          title: "Card Metadata Noodles",
          description: "A uniquely searchable metadata card",
          chefId: user.id,
          course: "main",
        },
      });
      await db.recipeTag.createMany({
        data: [
          { recipeId: recipe.id, label: "Weeknight", normalizedLabel: "weeknight" },
          { recipeId: recipe.id, label: "Budget", normalizedLabel: "budget" },
        ],
      });
      await db.savedRecipe.create({
        data: {
          userId: user.id,
          recipeId: recipe.id,
          savedAt: "2026-07-24T00:00:00.000Z",
        },
      });
      const cookbook = await db.cookbook.create({
        data: { title: "Card Metadata Collection", authorId: user.id },
      });
      const decoy = await db.recipe.create({
        data: {
          title: "Card Metadata Decoy",
          chefId: user.id,
          course: "side",
        },
      });
      await db.recipeTag.create({
        data: {
          recipeId: decoy.id,
          label: "Decoy Tag",
          normalizedLabel: "decoy tag",
        },
      });

      const request = new UndiciRequest("http://localhost:3000/search?q=card+metadata&scope=all", {
        headers: new Headers({ Cookie: await createSessionCookie(user.id) }),
      });
      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);
      const recipeResult = result.results.find((item) => item.id === recipe.id)!;
      const decoyResult = result.results.find((item) => item.id === decoy.id)!;
      const cookbookResult = result.results.find((item) => item.id === cookbook.id)!;

      expect(recipeResult.metadata).toMatchObject({
        course: "main",
        tags: ["Budget", "Weeknight"],
      });
      expect(recipeResult.metadata).not.toHaveProperty("isSaved");
      expect(recipeResult.metadata).not.toHaveProperty("categorySource");
      expect(recipeResult.metadata).not.toHaveProperty("categorizedBy");
      expect(decoyResult.metadata).toMatchObject({
        course: "side",
        tags: ["Decoy Tag"],
      });
      expect(cookbookResult.metadata).not.toHaveProperty("course");
      expect(cookbookResult.metadata).not.toHaveProperty("tags");

      const Stub = createTestRoutesStub([{
        path: "/search",
        Component: Search,
        loader: () => result,
      }]);
      render(<Stub initialEntries={["/search?q=card+metadata&scope=all"]} />);

      const recipeCard = await screen.findByRole("link", { name: /Recipe Card Metadata Noodles/i });
      const metadata = within(recipeCard).getByRole("group", { name: "Recipe metadata" });
      expect(within(metadata).getByText("Main")).toBeInTheDocument();
      const tagList = within(metadata).getByRole("list", { name: "Recipe tags" });
      expect(within(tagList).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
        "Budget",
        "Weeknight",
      ]);
      expect(within(recipeCard).queryByText("Decoy Tag")).not.toBeInTheDocument();

      const decoyCard = screen.getByRole("link", { name: /Recipe Card Metadata Decoy/i });
      const decoyMetadata = within(decoyCard).getByRole("group", { name: "Recipe metadata" });
      expect(within(decoyMetadata).getByText("Side")).toBeInTheDocument();
      expect(within(decoyMetadata).getByRole("list", { name: "Recipe tags" })).toHaveTextContent("Decoy Tag");
      expect(within(decoyMetadata).queryByText("Budget")).not.toBeInTheDocument();

      const cookbookCard = screen.getByRole("link", { name: /Cookbook Card Metadata Collection/i });
      expect(within(cookbookCard).queryByRole("group", { name: "Recipe metadata" })).not.toBeInTheDocument();
    });

    it("normalizes unauthenticated shopping-list searches to an empty private result set", async () => {
      const user = await createSearchUser("private_searcher");
      const list = await db.shoppingList.create({ data: { authorId: user.id } });
      const ingredientRef = await getOrCreateIngredientRef(db, "milk");
      await db.shoppingListItem.create({ data: { shoppingListId: list.id, ingredientRefId: ingredientRef.id } });

      const request = new UndiciRequest("http://localhost:3000/search?q=milk&scope=shopping-list");
      const result = await loader({ request, context: { cloudflare: { env: null } }, params: {} } as any);

      expect(result).toEqual({
        query: "milk",
        scope: "shopping-list",
        isAuthenticated: false,
        results: [],
      });

      const legacyResult = await loader({
        request: new UndiciRequest("http://localhost:3000/search?q=milk&scope=shopping"),
        context: { cloudflare: { env: null } },
        params: {},
      } as any);
      expect(legacyResult).toEqual(result);
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

    it("treats plus and percent-encoded tag spaces equivalently", async () => {
      const user = await createSearchUser("global_tag_space");
      const matching = await db.recipe.create({
        data: { title: "Global Matching Recipe", chefId: user.id, course: "main" },
      });
      await db.recipeTag.create({
        data: { recipeId: matching.id, label: "Quick Dinner", normalizedLabel: "quick dinner" },
      });
      await db.recipe.create({
        data: { title: "Global Unfiltered Recipe", chefId: user.id, course: "side" },
      });

      const percentEncoded = await loader({
        request: new UndiciRequest(
          "http://localhost:3000/search?scope=recipes&q=&course=main&tag=Quick%20Dinner",
        ),
        context: { cloudflare: { env: null } },
        params: {},
      } as any);
      const plusEncoded = await loader({
        request: new UndiciRequest(
          "http://localhost:3000/search?scope=recipes&q=&course=main&tag=Quick+Dinner",
        ),
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(percentEncoded).toMatchObject({ scope: "recipes", course: "main", tags: ["Quick Dinner"] });
      expect(plusEncoded).toMatchObject({ scope: "recipes", course: "main", tags: ["Quick Dinner"] });
      expect(percentEncoded.results.map((result) => result.id)).toEqual([matching.id]);
      expect(plusEncoded.results.map((result) => result.id)).toEqual([matching.id]);
    });

    it("uses exactly one normalization pass for composition-sensitive tag identities", async () => {
      const user = await createSearchUser("global_single_normalization");
      const matching = await db.recipe.create({
        data: { title: "Global Single Normalization Match", chefId: user.id },
      });
      await db.recipeTag.create({
        data: { recipeId: matching.id, label: "H\u0331", normalizedLabel: "h\u0331" },
      });

      const result = await loader({
        request: new UndiciRequest("http://localhost:3000/search?scope=recipes&tag=H%CC%B1"),
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.tags).toEqual(["H\u0331"]);
      expect(result.results.map((searchResult) => searchResult.id)).toEqual([matching.id]);

      const nextParams = new URLSearchParams({ scope: "recipes" });
      for (const tag of result.tags) nextParams.append("tag", tag);
      const nextResult = await loader({
        request: new UndiciRequest(`http://localhost:3000/search?${nextParams.toString()}`),
        context: { cloudflare: { env: null } },
        params: {},
      } as any);
      expect(nextResult.tags).toEqual(["H\u0331"]);
      expect(nextResult.results.map((searchResult) => searchResult.id)).toEqual([matching.id]);
    });

    it.each([
      ["invalid scope", "scope=unknown"],
      ["invalid course", "scope=recipes&course=breakfast"],
      ["empty course", "scope=recipes&course="],
      ["invalid tag", "scope=recipes&tag=%09"],
      ["recipe filters on cookbook scope", "scope=cookbooks&tag=quick"],
      ["recipe filters on chef scope", "scope=chefs&course=main"],
      ["recipe filters on shopping scope", "scope=shopping-list&tag=quick"],
      ["recipe filters on legacy shopping scope", "scope=shopping&tag=quick"],
      ["too many raw tags", `scope=recipes&${Array.from({ length: 11 }, () => "tag=duplicate").join("&")}`],
    ])("returns 400 for %s", async (_label, queryString) => {
      await expect(loader({
        request: new UndiciRequest(`http://localhost:3000/search?${queryString}`),
        context: { cloudflare: { env: null } },
        params: {},
      } as any)).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(Response);
        expect((error as Response).status).toBe(400);
        return true;
      });
    });

    it("does not convert unexpected filter-normalizer failures to 400", async () => {
      const failure = new Error("unexpected filter failure");
      const normalizeSpy = vi.spyOn(searchServer, "normalizeSearchRecipeFilters")
        .mockImplementation(() => { throw failure; });

      await expect(loader({
        request: new UndiciRequest("http://localhost:3000/search?scope=recipes"),
        context: { cloudflare: { env: null } },
        params: {},
      } as any)).rejects.toBe(failure);
      normalizeSpy.mockRestore();
    });
  });

  describe("meta", () => {
    it("returns search metadata", () => {
      expect(meta({} as any)).toEqual([
        { title: "Search Spoonjoy" },
        { name: "description", content: "Search Spoonjoy recipes, cookbooks, chefs, and private shopping list items." },
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
      expect(screen.getByText(/Shopping List results are private/i)).toBeInTheDocument();
      expect(screen.getByText(/Try searching by ingredient/i)).toBeInTheDocument();
      expect(screen.getByText("No matches yet")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Recipes" })).toHaveAttribute("href", "/search?scope=recipes");
    });

    it("submits the search form when Enter is pressed in the search field", async () => {
      const requestSubmit = vi
        .spyOn(HTMLFormElement.prototype, "requestSubmit")
        .mockImplementation(() => {});
      const Stub = createTestRoutesStub([
        {
          path: "/search",
          Component: Search,
          loader: () => ({ query: "", scope: "all", isAuthenticated: false, results: [] }),
        },
      ]);

      try {
        render(<Stub initialEntries={["/search"]} />);
        fireEvent.keyDown(await screen.findByRole("searchbox"), { key: "Enter" });
        expect(requestSubmit).toHaveBeenCalledTimes(1);
      } finally {
        requestSubmit.mockRestore();
      }
    });

    it("does not submit the search form for ordinary typing keys", async () => {
      const requestSubmit = vi
        .spyOn(HTMLFormElement.prototype, "requestSubmit")
        .mockImplementation(() => {});
      const Stub = createTestRoutesStub([
        {
          path: "/search",
          Component: Search,
          loader: () => ({ query: "", scope: "all", isAuthenticated: false, results: [] }),
        },
      ]);

      try {
        render(<Stub initialEntries={["/search"]} />);
        fireEvent.keyDown(await screen.findByRole("searchbox"), { key: "t" });
        expect(requestSubmit).not.toHaveBeenCalled();
      } finally {
        requestSubmit.mockRestore();
      }
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
                metadata: { coverProvenanceLabel: "Editorial photo" },
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
      expect(screen.getByText("Editorial photo")).toBeInTheDocument();
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

    it("preserves recipe filters between all and recipes while clearing them for other scopes", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/search",
          Component: Search,
          loader: () => ({
            query: "tomato soup",
            scope: "all",
            course: "main",
            tags: ["quick dinner", "budget"],
            isAuthenticated: false,
            results: [],
          }),
        },
      ]);

      render(<Stub initialEntries={["/search?scope=all&q=tomato+soup&course=main&tag=quick+dinner&tag=budget"]} />);

      expect(await screen.findByRole("combobox", { name: "Course" })).toHaveValue("main");
      expect(screen.getByRole("textbox", { name: "Add tag filter" })).toBeInTheDocument();
      expect(screen.getByText("quick dinner")).toBeInTheDocument();
      expect(screen.getByText("budget")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Everything" })).toHaveAttribute(
        "href",
        "/search?scope=all&q=tomato+soup&course=main&tag=quick+dinner&tag=budget",
      );
      expect(screen.getByRole("link", { name: "Everything" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: "Recipes" })).toHaveAttribute(
        "href",
        "/search?scope=recipes&q=tomato+soup&course=main&tag=quick+dinner&tag=budget",
      );
      expect(screen.getByRole("link", { name: "Cookbooks" })).toHaveAttribute(
        "href",
        "/search?scope=cookbooks&q=tomato+soup",
      );
      expect(screen.getByRole("link", { name: "Chefs" })).toHaveAttribute(
        "href",
        "/search?scope=chefs&q=tomato+soup",
      );
      expect(screen.getByRole("link", { name: "Shopping List" })).toHaveAttribute(
        "href",
        "/search?scope=shopping-list&q=tomato+soup",
      );
      expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute(
        "href",
        "/search?scope=all&q=tomato+soup",
      );
      expect(screen.getByRole("link", { name: "Clear course" })).toHaveAttribute(
        "href",
        "/search?scope=all&q=tomato+soup&tag=quick+dinner&tag=budget",
      );
      expect(screen.getByRole("link", { name: "Remove tag quick dinner" })).toHaveAttribute(
        "href",
        "/search?scope=all&q=tomato+soup&course=main&tag=budget",
      );
    });

    it("does not render recipe filter controls for non-recipe scopes", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/search",
          Component: Search,
          loader: () => ({
            query: "tomato soup",
            scope: "cookbooks",
            course: null,
            tags: [],
            isAuthenticated: false,
            results: [],
          }),
        },
      ]);

      render(<Stub initialEntries={["/search?scope=cookbooks&q=tomato+soup"]} />);

      expect(await screen.findByRole("heading", { name: "Cookbooks" })).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Course" })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Add tag filter" })).not.toBeInTheDocument();
    });

    it("submits canonical filter order, synchronizes fields, and restores filter focus", async () => {
      function LocationProbe() {
        const location = useLocation();
        return <output data-testid="location">{location.pathname}{location.search}</output>;
      }
      function FilterHarness() {
        return <><Search /><LocationProbe /></>;
      }
      const Stub = createTestRoutesStub([
        {
          path: "/search",
          Component: FilterHarness,
          loader: ({ request }: { request: Request }) => {
            const url = new URL(request.url);
            return {
              query: url.searchParams.get("q") ?? "",
              scope: url.searchParams.get("scope") ?? "all",
              course: url.searchParams.get("course"),
              tags: url.searchParams.getAll("tag"),
              isAuthenticated: false,
              results: [],
            };
          },
        },
      ]);

      render(<Stub initialEntries={["/search?scope=all&q=tomato+soup&course=main&tag=quick+dinner&tag=budget"]} />);

      const queryInput = await screen.findByRole("searchbox", { name: "Search terms" });
      fireEvent.change(queryInput, { target: { value: "bean stew" } });
      expect(screen.getByRole("link", { name: "Recipes" })).toHaveAttribute(
        "href",
        "/search?scope=recipes&q=bean+stew&course=main&tag=quick+dinner&tag=budget",
      );
      fireEvent.submit(screen.getByRole("search"));
      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(
        "/search?scope=all&q=bean+stew&course=main&tag=quick+dinner&tag=budget",
      ));
      expect(screen.getByRole("searchbox", { name: "Search terms" })).toHaveFocus();

      fireEvent.change(screen.getByRole("searchbox", { name: "Search terms" }), {
        target: { value: "lentil pot" },
      });
      expect(screen.getByRole("link", { name: "Clear course" })).toHaveAttribute(
        "href",
        "/search?scope=all&q=lentil+pot&tag=quick+dinner&tag=budget",
      );
      const courseSelect = screen.getByRole("combobox", { name: "Course" });
      fireEvent.change(courseSelect, { target: { value: "dessert" } });
      fireEvent.submit(courseSelect.closest("form")!);
      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(
        "/search?scope=all&q=lentil+pot&course=dessert&tag=quick+dinner&tag=budget",
      ));

      const tagInput = screen.getByRole("textbox", { name: "Add tag filter" });
      fireEvent.change(tagInput, { target: { value: "late night" } });
      fireEvent.submit(tagInput.closest("form")!);
      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(
        "/search?scope=all&q=lentil+pot&course=dessert&tag=quick+dinner&tag=budget&tag=late+night",
      ));

      fireEvent.click(screen.getByRole("link", { name: "Remove tag quick dinner" }));
      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(
        "/search?scope=all&q=lentil+pot&course=dessert&tag=budget&tag=late+night",
      ));
      expect(screen.getByRole("region", { name: "Search filters" })).toHaveFocus();

      fireEvent.click(screen.getByRole("link", { name: "Clear course" }));
      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(
        "/search?scope=all&q=lentil+pot&tag=budget&tag=late+night",
      ));
      expect(screen.getByRole("combobox", { name: "Course" })).toHaveValue("");

      fireEvent.click(screen.getByRole("link", { name: "Clear filters" }));
      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(
        "/search?scope=all&q=lentil+pot",
      ));
      expect(screen.getByRole("region", { name: "Search filters" })).toHaveFocus();
    });

    it("clears a duplicate global tag draft when the canonical filters stay the same", async () => {
      const Stub = createTestRoutesStub([{
        path: "/search",
        Component: Search,
        loader: ({ request }: { request: Request }) => {
          const url = new URL(request.url);
          return {
            query: "",
            scope: "all",
            course: null,
            tags: [...new Set(url.searchParams.getAll("tag").map((tag) => tag.toLowerCase()))],
            isAuthenticated: false,
            results: [],
          };
        },
      }]);
      render(<Stub initialEntries={["/search?scope=all&tag=quick"]} />);

      const input = await screen.findByRole("textbox", { name: "Add tag filter" });
      fireEvent.change(input, { target: { value: "QUICK" } });
      fireEvent.submit(input.closest("form")!);

      await waitFor(() => expect(screen.getByRole("textbox", { name: "Add tag filter" })).toHaveValue(""));
      expect(screen.getAllByText("quick")).toHaveLength(1);
    });

    it("disables global tag addition at the ten-filter limit", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/search",
          Component: Search,
          loader: () => ({
            query: "",
            scope: "all",
            course: null,
            tags: Array.from({ length: 10 }, (_, index) => `tag-${index}`),
            isAuthenticated: false,
            results: [],
          }),
        },
      ]);

      render(<Stub initialEntries={["/search"]} />);

      expect(await screen.findByRole("textbox", { name: "Add tag filter" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
      expect(screen.getByRole("status")).toHaveTextContent("10-tag limit reached. Remove a tag to add another.");
    });

    it("tolerates older recipe loader data with undefined filter arrays", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/search",
          Component: Search,
          loader: () => ({
            query: "",
            scope: "all",
            course: "main",
            tags: undefined,
            isAuthenticated: false,
            results: [],
          }),
        },
      ]);

      render(<Stub initialEntries={["/search"]} />);

      expect(await screen.findByRole("combobox", { name: "Course" })).toHaveValue("main");
      expect(screen.getByRole("textbox", { name: "Add tag filter" })).toBeInTheDocument();
      expect(screen.getByText("Search filters updated. Course main. Tags none.")).toBeInTheDocument();
    });
  });
});
