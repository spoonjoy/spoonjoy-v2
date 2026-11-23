import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { cleanup, render, screen, within } from "@testing-library/react";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import {
  INGREDIENT_LOOKUP_BATCH_SIZE,
  loadIngredientNamesByRecipeId,
  loader,
  meta,
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

  it("returns the my recipes document title", () => {
    expect(meta({} as any)).toEqual([
      { title: "My recipes - Spoonjoy" },
      { name: "description", content: "Recipes you've created on Spoonjoy." },
    ]);
  });

  afterEach(async () => {
    cleanup();
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
          filterParams: [],
          organizerChoices: null,
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
          filterParams: [],
          organizerChoices: null,
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
          filterParams: [],
          organizerChoices: null,
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

  it("renders pagination links that preserve the drawer search query", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/my-recipes-paged",
        Component: MyRecipes,
        loader: () => ({
          query: "turnip greens",
          page: 2,
          pageSize: 50,
          filterParams: [],
          organizerChoices: null,
          hasPreviousPage: true,
          hasNextPage: true,
          recipes: [{
            id: "recipe-page",
            title: "Turnip Greens",
            description: null,
            servings: null,
            chef: { id: "chef-1", username: "ari" },
            ingredientNames: [],
          }],
        }),
      },
      {
        path: "/my-recipes-paged-empty-query",
        Component: MyRecipes,
        loader: () => ({
          query: "",
          page: 2,
          pageSize: 50,
          filterParams: [],
          organizerChoices: null,
          hasPreviousPage: true,
          hasNextPage: false,
          recipes: [{
            id: "recipe-page-empty",
            title: "Plain Rice",
            description: null,
            servings: null,
            chef: { id: "chef-1", username: "ari" },
            ingredientNames: [],
          }],
        }),
      },
      {
        path: "/my-recipes-paged-first-page",
        Component: MyRecipes,
        loader: () => ({
          query: "",
          page: 1,
          pageSize: 50,
          filterParams: [],
          organizerChoices: null,
          hasPreviousPage: false,
          hasNextPage: true,
          recipes: [{
            id: "recipe-page-first",
            title: "First Page Rice",
            description: null,
            servings: null,
            chef: { id: "chef-1", username: "ari" },
            ingredientNames: [],
          }],
        }),
      },
    ]);

    const { unmount } = render(<Stub initialEntries={["/my-recipes-paged?q=turnip+greens&page=2"]} />);

    expect(await screen.findByRole("navigation", { name: "My recipes pagination" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute(
      "href",
      "/my-recipes-paged?q=turnip+greens",
    );
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
      "href",
      "/my-recipes-paged?q=turnip+greens&page=3",
    );
    // Adjacent-page semantics must survive the primitive swap, without losing the query.
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute("rel", "prev");
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute("rel", "next");

    unmount();
    const second = render(<Stub initialEntries={["/my-recipes-paged-empty-query?page=2"]} />);

    expect(await screen.findByRole("link", { name: "Previous page" })).toHaveAttribute(
      "href",
      "/my-recipes-paged-empty-query",
    );

    second.unmount();
    render(<Stub initialEntries={["/my-recipes-paged-first-page"]} />);

    // Released link pagination uses non-focusable disabled text, not a dead button.
    expect((await screen.findByText("Previous page")).closest("[aria-disabled]")).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("link", { name: "Previous page" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
      "href",
      "/my-recipes-paged-first-page?page=2",
    );
  });

  describe("organizer filters", () => {
    const ON = { cloudflare: { env: { SPOONJOY_FLAGS: "organizers" } } };

    async function organizedKitchen() {
      const viewer = await createDrawerUser("my-recipes-filters");
      const wokSoup = await createDrawerRecipe({ chefId: viewer.id, title: "Wok Soup", updatedAt: new Date("2026-02-03T10:00:00Z") });
      const quickSoup = await createDrawerRecipe({ chefId: viewer.id, title: "Quick Soup", updatedAt: new Date("2026-02-02T10:00:00Z") });
      await createDrawerRecipe({ chefId: viewer.id, title: "Slow Stew", updatedAt: new Date("2026-02-01T10:00:00Z") });
      const quick = await db.organizer.create({ data: { ownerId: viewer.id, kind: "tag", name: "Quick", slug: "quick" } });
      const wok = await db.organizer.create({ data: { ownerId: viewer.id, kind: "tool", name: "Wok", slug: "wok" } });
      await db.organizer.create({ data: { ownerId: viewer.id, kind: "tag", name: "Cozy", slug: "cozy" } });
      await db.recipeOrganizer.createMany({
        data: [
          { recipeId: wokSoup.id, organizerId: quick.id },
          { recipeId: wokSoup.id, organizerId: wok.id },
          { recipeId: quickSoup.id, organizerId: quick.id },
        ],
      });
      return viewer;
    }

    const load = async (viewerId: string, search: string, context: unknown = ON) =>
      loader({
        request: new UndiciRequest(`http://localhost:3000/my-recipes${search}`, { headers: await sessionHeaders(viewerId) }),
        context,
        params: {},
      } as unknown as Parameters<typeof loader>[0]);

    it("narrow my recipes to those with a tag and without a tool, and offer the cook's own organizers to choose from", async () => {
      const viewer = await organizedKitchen();

      const result = await load(viewer.id, "?with=tag:quick&without=tool:wok");

      expect(result.recipes.map((recipe: { title: string }) => recipe.title)).toEqual(["Quick Soup"]);
      expect(result.filterParams).toEqual([["with", "tag:quick"], ["without", "tool:wok"]]);
      expect(result.organizerChoices).toEqual({
        tag: [{ name: "Cozy", value: "tag:cozy" }, { name: "Quick", value: "tag:quick" }],
        category: [],
        tool: [{ name: "Wok", value: "tool:wok" }],
      });
    });

    it("ignore filters and offer no choices while the organizers flag is off", async () => {
      const viewer = await organizedKitchen();

      const result = await load(viewer.id, "?with=tag:quick", { cloudflare: { env: {} } });

      expect(result.recipes.map((recipe: { title: string }) => recipe.title)).toEqual(["Wok Soup", "Quick Soup", "Slow Stew"]);
      expect(result.filterParams).toEqual([]);
      expect(result.organizerChoices).toBeNull();
    });

    const page = (overrides: Record<string, unknown>) => ({
      query: "",
      page: 1,
      pageSize: 50,
      hasPreviousPage: false,
      hasNextPage: false,
      recipes: [],
      filterParams: [],
      organizerChoices: null,
      ...overrides,
    });

    it("show a filter with a Has and a Leave out choice for each of the cook's organizers, checked as the address says", async () => {
      const Stub = createTestRoutesStub([{
        path: "/my-recipes",
        Component: MyRecipes,
        loader: () => page({
          query: "soup",
          filterParams: [["with", "tag:quick"]],
          organizerChoices: { tag: [{ name: "Quick", value: "tag:quick" }], category: [], tool: [{ name: "Wok", value: "tool:wok" }] },
        }),
      }]);

      render(<Stub initialEntries={["/my-recipes?q=soup&with=tag:quick"]} />);

      const filter = await screen.findByRole("form", { name: "Filter my recipes" });
      const has = within(filter).getByRole("group", { name: "Has" });
      const leaveOut = within(filter).getByRole("group", { name: "Leave out" });
      expect(within(has).getByRole("checkbox", { name: "Quick" })).toBeChecked();
      expect(within(has).getByRole("checkbox", { name: "Wok" })).not.toBeChecked();
      expect(within(leaveOut).getByRole("checkbox", { name: "Wok" })).not.toBeChecked();
      const sent = new FormData(filter as HTMLFormElement);
      expect(sent.getAll("with")).toEqual(["tag:quick"]);
      expect(sent.getAll("without")).toEqual([]);
      expect(sent.get("q")).toBe("soup");
      expect(within(filter).getByRole("button", { name: "Apply filters" })).toBeInTheDocument();
      const search = new FormData(screen.getByRole("search") as HTMLFormElement);
      expect([...search.entries()]).toEqual([["q", "soup"], ["with", "tag:quick"]]);
      expect(within(screen.getByRole("search")).getByRole("link", { name: "Clear" })).toHaveAttribute("href", "/my-recipes?with=tag%3Aquick");
      expect(within(filter).getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/my-recipes?q=soup");
      expect(screen.getByRole("heading", { name: "No matching recipes" })).toBeInTheDocument();
    });

    it("show no filter when the cook has no organizers or the flag is off", async () => {
      const Stub = createTestRoutesStub([
        { path: "/none", Component: MyRecipes, loader: () => page({ organizerChoices: { tag: [], category: [], tool: [] } }) },
        { path: "/off", Component: MyRecipes, loader: () => page({}) },
      ]);

      render(<Stub initialEntries={["/none"]} />);
      expect(await screen.findByRole("heading", { level: 1, name: "My Recipes" })).toBeInTheDocument();
      expect(screen.queryByRole("form", { name: "Filter my recipes" })).not.toBeInTheDocument();
      cleanup();
      render(<Stub initialEntries={["/off"]} />);
      expect(await screen.findByRole("heading", { level: 1, name: "My Recipes" })).toBeInTheDocument();
      expect(screen.queryByRole("form", { name: "Filter my recipes" })).not.toBeInTheDocument();
    });

    it("offer the filter closed with nothing to clear until one is chosen, and suggest fewer filters when none match", async () => {
      const choices = { tag: [{ name: "Quick", value: "tag:quick" }], category: [], tool: [] };
      const Stub = createTestRoutesStub([
        { path: "/unfiltered", Component: MyRecipes, loader: () => page({ organizerChoices: choices }) },
        { path: "/filtered", Component: MyRecipes, loader: () => page({ organizerChoices: choices, filterParams: [["with", "tag:quick"]] }) },
      ]);

      render(<Stub initialEntries={["/unfiltered"]} />);
      const filter = await screen.findByRole("form", { name: "Filter my recipes" });
      expect(within(filter).getByRole("button", { name: "Filter", expanded: false })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Clear filters" })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "No recipes yet" })).toBeInTheDocument();
      cleanup();

      render(<Stub initialEntries={["/filtered"]} />);
      expect(await screen.findByRole("button", { name: "Filter (1)", expanded: true })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "No matching recipes" })).toBeInTheDocument();
      expect(screen.getByText("Try fewer filters.")).toBeInTheDocument();
    });

    it("keep the filters in page links", async () => {
      const Stub = createTestRoutesStub([{
        path: "/my-recipes",
        Component: MyRecipes,
        loader: () => page({
          page: 1,
          hasNextPage: true,
          recipes: [{ id: "r", title: "Wok Soup", description: null, servings: null, chef: { id: "c", username: "ari" }, ingredientNames: [] }],
          filterParams: [["without", "tool:wok"]],
          organizerChoices: { tag: [], category: [], tool: [{ name: "Wok", value: "tool:wok" }] },
        }),
      }]);

      render(<Stub initialEntries={["/my-recipes?without=tool:wok"]} />);

      expect(await screen.findByRole("link", { name: /next page/i })).toHaveAttribute("href", "/my-recipes?without=tool%3Awok&page=2");
      expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/my-recipes");
    });
  });
});
