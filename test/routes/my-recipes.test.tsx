import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router";
import { cleanupDatabase } from "../helpers/cleanup";
import {
  INGREDIENT_LOOKUP_BATCH_SIZE,
  loadIngredientNamesByRecipeId,
  loader,
} from "~/routes/my-recipes";
import MyRecipes from "~/routes/my-recipes";
import { db } from "~/lib/db.server";
import * as myRecipesSearch from "~/lib/my-recipes-search.server";
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

  it("treats plus and percent-encoded tag spaces equivalently and filters before loading", async () => {
    const viewer = await createDrawerUser("my-recipes-tag-space");
    const matching = await createDrawerRecipe({
      chefId: viewer.id,
      title: "Matching Tag Space",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await db.recipe.update({ where: { id: matching.id }, data: { course: "main" } });
    await db.recipeTag.create({
      data: { recipeId: matching.id, label: "Quick Dinner", normalizedLabel: "quick dinner" },
    });
    await createDrawerRecipe({
      chefId: viewer.id,
      title: "Newer Unfiltered Recipe",
      updatedAt: new Date("2026-03-01T00:00:00Z"),
    });
    const headers = await sessionHeaders(viewer.id);

    const percentEncoded = await loader({
      request: new UndiciRequest(
        "http://localhost:3000/my-recipes?q=&course=main&tag=Quick%20Dinner",
        { headers },
      ),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);
    const plusEncoded = await loader({
      request: new UndiciRequest(
        "http://localhost:3000/my-recipes?q=&course=main&tag=Quick+Dinner",
        { headers },
      ),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(percentEncoded).toMatchObject({ course: "main", tags: ["Quick Dinner"] });
    expect(plusEncoded).toMatchObject({ course: "main", tags: ["Quick Dinner"] });
    expect(percentEncoded.recipes.map((recipe: { id: string }) => recipe.id)).toEqual([matching.id]);
    expect(plusEncoded.recipes.map((recipe: { id: string }) => recipe.id)).toEqual([matching.id]);
  });

  it("uses exactly one normalization pass for composition-sensitive tag identities", async () => {
    const viewer = await createDrawerUser("my-recipes-single-normalization");
    const matching = await createDrawerRecipe({
      chefId: viewer.id,
      title: "Single Normalization Match",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await db.recipeTag.create({
      data: { recipeId: matching.id, label: "H\u0331", normalizedLabel: "h\u0331" },
    });

    const headers = await sessionHeaders(viewer.id);
    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/my-recipes?tag=H%CC%B1", {
        headers,
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.tags).toEqual(["H\u0331"]);
    expect(result.recipes.map((recipe: { id: string }) => recipe.id)).toEqual([matching.id]);

    const nextParams = new URLSearchParams();
    for (const tag of result.tags) nextParams.append("tag", tag);
    nextParams.set("q", "Single Normalization");
    const nextResult = await loader({
      request: new UndiciRequest(`http://localhost:3000/my-recipes?${nextParams.toString()}`, { headers }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);
    expect(nextResult.tags).toEqual(["H\u0331"]);
    expect(nextResult.recipes.map((recipe: { id: string }) => recipe.id)).toEqual([matching.id]);
  });

  it.each([
    ["invalid course", "course=breakfast"],
    ["empty course", "course="],
    ["invalid tag", "tag=%09"],
    ["nonnumeric page", "page=not-a-page"],
    ["zero page", "page=0"],
    ["negative page", "page=-1"],
    ["fractional page", "page=1.5"],
    ["unsafe page", `page=${Number.MAX_SAFE_INTEGER + 1}`],
    ["too many raw tags", Array.from({ length: 11 }, () => "tag=duplicate").join("&")],
  ])("returns 400 for %s", async (_label, queryString) => {
    const viewer = await createDrawerUser("my-recipes-invalid-filter");

    await expect(loader({
      request: new UndiciRequest(`http://localhost:3000/my-recipes?${queryString}`, {
        headers: await sessionHeaders(viewer.id),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(400);
      return true;
    });
  });

  it("does not convert unexpected filter-normalizer failures to 400", async () => {
    const viewer = await createDrawerUser("my-recipes-unexpected-filter-error");
    const failure = new Error("unexpected filter failure");
    const normalizeSpy = vi.spyOn(myRecipesSearch, "normalizeMyRecipesFilters")
      .mockImplementation(() => { throw failure; });

    await expect(loader({
      request: new UndiciRequest("http://localhost:3000/my-recipes", {
        headers: await sessionHeaders(viewer.id),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any)).rejects.toBe(failure);
    normalizeSpy.mockRestore();
  });

  it("normalizes a valid zero-padded page before issuing the bounded query", async () => {
    const viewer = await createDrawerUser("my-recipes-normalized-page");

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/my-recipes?page=002", {
        headers: await sessionHeaders(viewer.id),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.page).toBe(2);
    expect(result.hasPreviousPage).toBe(true);
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

  it("renders pagination links that preserve the drawer search query", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/my-recipes-paged",
        Component: MyRecipes,
        loader: () => ({
          query: "turnip greens",
          page: 2,
          pageSize: 50,
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

    unmount();
    render(<Stub initialEntries={["/my-recipes-paged-empty-query?page=2"]} />);

    expect(await screen.findByRole("link", { name: "Previous page" })).toHaveAttribute(
      "href",
      "/my-recipes-paged-empty-query",
    );

    unmount();
    render(<Stub initialEntries={["/my-recipes-paged-first-page"]} />);

    expect(await screen.findByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
      "href",
      "/my-recipes-paged-first-page?page=2",
    );
  });

  it("renders accessible filters and serializes q, course, tags, then page", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/my-recipes-filter-controls",
        Component: MyRecipes,
        loader: () => ({
          query: "tomato soup",
          course: "main",
          tags: ["quick dinner", "budget"],
          page: 2,
          pageSize: 50,
          hasPreviousPage: true,
          hasNextPage: true,
          recipes: [{
            id: "filtered-recipe",
            title: "Filtered Tomato Soup",
            description: null,
            servings: null,
            chef: { id: "chef-1", username: "ari" },
            ingredientNames: [],
          }],
        }),
      },
    ]);

    render(<Stub initialEntries={["/my-recipes-filter-controls?q=tomato+soup&course=main&tag=quick+dinner&tag=budget&page=2"]} />);

    expect(await screen.findByRole("combobox", { name: "Course" })).toHaveValue("main");
    expect(screen.getByRole("textbox", { name: "Add tag filter" })).toBeInTheDocument();
    expect(screen.getByText("quick dinner")).toBeInTheDocument();
    expect(screen.getByText("budget")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute(
      "href",
      "/my-recipes-filter-controls?q=tomato+soup",
    );
    expect(screen.getByRole("link", { name: "Clear course" })).toHaveAttribute(
      "href",
      "/my-recipes-filter-controls?q=tomato+soup&tag=quick+dinner&tag=budget",
    );
    expect(screen.getByRole("link", { name: "Remove tag quick dinner" })).toHaveAttribute(
      "href",
      "/my-recipes-filter-controls?q=tomato+soup&course=main&tag=budget",
    );
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute(
      "href",
      "/my-recipes-filter-controls?q=tomato+soup&course=main&tag=quick+dinner&tag=budget",
    );
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
      "href",
      "/my-recipes-filter-controls?q=tomato+soup&course=main&tag=quick+dinner&tag=budget&page=3",
    );
  });

  it("submits canonical filter order, synchronizes fields, and restores filter focus", async () => {
    function LocationProbe() {
      const location = useLocation();
      return <output data-testid="location">{location.pathname}{location.search}</output>;
    }
    function FilterHarness() {
      return <><MyRecipes /><LocationProbe /></>;
    }
    const Stub = createTestRoutesStub([
      {
        path: "/my-recipes-form-state",
        Component: FilterHarness,
        loader: ({ request }: { request: Request }) => {
          const url = new URL(request.url);
          const page = Number(url.searchParams.get("page") ?? "1");
          return {
            query: url.searchParams.get("q") ?? "",
            course: url.searchParams.get("course"),
            tags: url.searchParams.getAll("tag"),
            page,
            pageSize: 50,
            hasPreviousPage: page > 1,
            hasNextPage: page < 2,
            recipes: [],
          };
        },
      },
    ]);

    render(<Stub initialEntries={["/my-recipes-form-state?q=tomato+soup&course=main&tag=quick+dinner&tag=budget"]} />);

    const queryInput = await screen.findByRole("searchbox", { name: "Search my recipes" });
    fireEvent.change(queryInput, { target: { value: "  bean stew  " } });
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
      "href",
      "/my-recipes-form-state?q=bean+stew&course=main&tag=quick+dinner&tag=budget&page=2",
    );
    fireEvent.click(screen.getByRole("link", { name: "Next page" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe(
      "/my-recipes-form-state?q=bean+stew&course=main&tag=quick+dinner&tag=budget&page=2",
    ));
    await waitFor(() => {
      expect(screen.getByRole("searchbox", { name: "Search my recipes" })).toHaveValue("bean stew");
    });
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute(
      "href",
      "/my-recipes-form-state?q=bean+stew&course=main&tag=quick+dinner&tag=budget",
    );

    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe(
      "/my-recipes-form-state?q=bean+stew&course=main&tag=quick+dinner&tag=budget",
    ));
    expect(screen.getByRole("searchbox", { name: "Search my recipes" })).toHaveFocus();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search my recipes" }), {
      target: { value: "lentil pot" },
    });
    expect(screen.getByRole("link", { name: "Clear course" })).toHaveAttribute(
      "href",
      "/my-recipes-form-state?q=lentil+pot&tag=quick+dinner&tag=budget",
    );
    const courseSelect = screen.getByRole("combobox", { name: "Course" });
    fireEvent.change(courseSelect, { target: { value: "dessert" } });
    fireEvent.submit(courseSelect.closest("form")!);
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe(
      "/my-recipes-form-state?q=lentil+pot&course=dessert&tag=quick+dinner&tag=budget",
    ));

    const tagInput = screen.getByRole("textbox", { name: "Add tag filter" });
    fireEvent.change(tagInput, { target: { value: "late night" } });
    fireEvent.submit(tagInput.closest("form")!);
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe(
      "/my-recipes-form-state?q=lentil+pot&course=dessert&tag=quick+dinner&tag=budget&tag=late+night",
    ));

    fireEvent.click(screen.getByRole("link", { name: "Remove tag quick dinner" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe(
      "/my-recipes-form-state?q=lentil+pot&course=dessert&tag=budget&tag=late+night",
    ));
    expect(screen.getByRole("region", { name: "Recipe filters" })).toHaveFocus();

    fireEvent.click(screen.getByRole("link", { name: "Clear course" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe(
      "/my-recipes-form-state?q=lentil+pot&tag=budget&tag=late+night",
    ));
    expect(screen.getByRole("combobox", { name: "Course" })).toHaveValue("");

    fireEvent.click(screen.getByRole("link", { name: "Clear filters" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe(
      "/my-recipes-form-state?q=lentil+pot",
    ));
    expect(screen.getByRole("region", { name: "Recipe filters" })).toHaveFocus();

    fireEvent.click(screen.getByRole("link", { name: "Clear" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/my-recipes-form-state"));
    await waitFor(() => {
      expect(screen.getByRole("searchbox", { name: "Search my recipes" })).toHaveValue("");
      expect(screen.getByRole("searchbox", { name: "Search my recipes" })).toHaveFocus();
    });
  });

  it("clears a duplicate tag draft even when canonical filters do not change", async () => {
    const Stub = createTestRoutesStub([{
      path: "/my-recipes-duplicate-tag",
      Component: MyRecipes,
      loader: ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        return {
          query: "",
          course: null,
          tags: [...new Set(url.searchParams.getAll("tag").map((tag) => tag.toLowerCase()))],
          page: 1,
          pageSize: 50,
          hasPreviousPage: false,
          hasNextPage: false,
          recipes: [],
        };
      },
    }]);
    render(<Stub initialEntries={["/my-recipes-duplicate-tag?tag=quick"]} />);

    const input = await screen.findByRole("textbox", { name: "Add tag filter" });
    fireEvent.change(input, { target: { value: "QUICK" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(screen.getByRole("textbox", { name: "Add tag filter" })).toHaveValue(""));
    expect(screen.getAllByText("quick")).toHaveLength(1);
  });

  it("disables tag addition at the ten-filter limit", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/my-recipes-tag-limit",
        Component: MyRecipes,
        loader: () => ({
          query: "",
          course: null,
          tags: Array.from({ length: 10 }, (_, index) => `tag-${index}`),
          page: 1,
          pageSize: 50,
          hasPreviousPage: false,
          hasNextPage: false,
          recipes: [],
        }),
      },
    ]);

    render(<Stub initialEntries={["/my-recipes-tag-limit"]} />);

    expect(await screen.findByRole("textbox", { name: "Add tag filter" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("10-tag limit reached. Remove a tag to add another.");
  });

  it("announces a course-only filter without inventing tag state", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/my-recipes-course-only",
        Component: MyRecipes,
        loader: () => ({
          query: "",
          course: "main",
          tags: [],
          page: 1,
          pageSize: 50,
          hasPreviousPage: false,
          hasNextPage: false,
          recipes: [],
        }),
      },
    ]);

    render(<Stub initialEntries={["/my-recipes-course-only?course=main"]} />);

    expect(await screen.findByText("Recipe filters updated. Course main. Tags none.")).toBeInTheDocument();
  });
});
