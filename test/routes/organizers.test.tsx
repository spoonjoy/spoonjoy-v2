import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { db } from "~/lib/db.server";
import { OBJECTIONABLE_CONTENT_MESSAGE, OBJECTIONABLE_TERMS } from "~/lib/objectionable-terms";
import { organizerNamesFromInput } from "~/domains/kitchen";
import TagsIndex, { loader as tagsLoader, meta as tagsMeta } from "~/routes/tags._index";
import TagPage, { loader as tagLoader, meta as tagMeta } from "~/routes/tags.$slug";
import CategoriesIndex, { loader as categoriesLoader, meta as categoriesMeta } from "~/routes/categories._index";
import CategoryPage, { loader as categoryLoader, meta as categoryMeta } from "~/routes/categories.$slug";
import ToolsIndex, { loader as toolsLoader, meta as toolsMeta } from "~/routes/tools._index";
import ToolPage, { loader as toolLoader, meta as toolMeta } from "~/routes/tools.$slug";
import RecipeOrganize, { action as organizeAction, loader as organizeLoader, meta as organizeMeta } from "~/routes/recipes.$id.organize";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRoutesStub } from "../utils";
import { createDrawerRecipe, createDrawerUser, sessionHeaders } from "./kitchen-drawer-test-utils";

const ON = { cloudflare: { env: { SPOONJOY_FLAGS: "organizers" } } };
const OFF = { cloudflare: { env: {} } };

const KINDS = [
  { kind: "tag", path: "/tags", list: tagsLoader, page: tagLoader, listMeta: tagsMeta, pageMeta: tagMeta, listTitle: "Your tags", fallback: "Tag" },
  { kind: "category", path: "/categories", list: categoriesLoader, page: categoryLoader, listMeta: categoriesMeta, pageMeta: categoryMeta, listTitle: "Your categories", fallback: "Category" },
  { kind: "tool", path: "/tools", list: toolsLoader, page: toolLoader, listMeta: toolsMeta, pageMeta: toolMeta, listTitle: "Your tools", fallback: "Tool" },
] as const;

async function signedIn(path: string, userId: string, init: RequestInit = {}) {
  const headers = await sessionHeaders(userId);
  return new UndiciRequest(`http://localhost:3000${path}`, { ...init, headers }) as unknown as Request;
}

function organizeForm(fields: { tags?: string; categories?: string; tools?: string }) {
  return { method: "POST", body: new URLSearchParams(fields) } as RequestInit;
}

async function status(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Response) return error.status;
    throw error;
  }
  return 200;
}

async function organize(recipeId: string, userId: string, fields: Parameters<typeof organizeForm>[0], context: object = ON) {
  const request = await signedIn(`/recipes/${recipeId}/organize`, userId, organizeForm(fields));
  return organizeAction({ request, context, params: { id: recipeId } } as never);
}

describe("organizers on recipes", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    cleanup();
    await cleanupDatabase();
  });

  it("read typed names split at commas, and none from a missing field", () => {
    expect(organizerNamesFromInput("a, b,,c")).toEqual(["a", " b", "", "c"]);
    expect(organizerNamesFromInput(null)).toEqual([]);
  });

  it("name their pages", () => {
    const noindex = { name: "robots", content: "noindex" };
    for (const { listMeta, pageMeta, listTitle, fallback } of KINDS) {
      expect(listMeta()).toEqual([{ title: `${listTitle} - Spoonjoy` }, noindex]);
      expect(pageMeta({ data: { organizer: { name: "Quick" } } } as never)).toEqual([{ title: "Quick - Spoonjoy" }, noindex]);
      expect(pageMeta({ data: undefined } as never)).toEqual([{ title: `${fallback} - Spoonjoy` }, noindex]);
    }
    expect(organizeMeta({ data: { recipe: { title: "Soup" } } } as never)).toEqual([{ title: "Organize Soup - Spoonjoy" }, noindex]);
    expect(organizeMeta({ data: undefined } as never)).toEqual([{ title: "Organize - Spoonjoy" }, noindex]);
  });

  it("are not found while the organizers flag is off", async () => {
    const chef = await createDrawerUser("organizers-off");
    const recipe = await createDrawerRecipe({ chefId: chef.id, title: "Flag off soup" });
    for (const { path, list, page } of KINDS) {
      expect(await status(list({ request: await signedIn(path, chef.id), context: OFF, params: {} } as never))).toBe(404);
      expect(await status(page({ request: await signedIn(`${path}/x`, chef.id), context: OFF, params: { slug: "x" } } as never))).toBe(404);
    }
    const path = `/recipes/${recipe.id}/organize`;
    expect(await status(organizeLoader({ request: await signedIn(path, chef.id), context: OFF, params: { id: recipe.id } } as never))).toBe(404);
    expect(await status(organize(recipe.id, chef.id, { tags: "a" }, OFF))).toBe(404);
  });

  it("send a signed-out visitor to sign in", async () => {
    const request = new UndiciRequest("http://localhost:3000/categories") as unknown as Request;
    expect(await status(categoriesLoader({ request, context: ON, params: {} } as never))).toBe(302);
  });

  it("save a recipe's tags, categories and tools from comma-separated lists, read them back, and leave a kind the form leaves out", async () => {
    const chef = await createDrawerUser("organizers-save");
    const recipe = await createDrawerRecipe({ chefId: chef.id, title: "Weeknight soup" });
    expect(await organize(recipe.id, chef.id, { tags: "Quick, Soup,, quick", categories: "Dinner", tools: "Dutch oven" })).toEqual({ saved: true });
    const path = `/recipes/${recipe.id}/organize`;
    const loaded = await organizeLoader({ request: await signedIn(path, chef.id), context: ON, params: { id: recipe.id } } as never);
    expect(loaded).toEqual({
      recipe: { id: recipe.id, title: "Weeknight soup" },
      tags: [{ name: "Quick", slug: "quick" }, { name: "Soup", slug: "soup" }],
      categories: [{ name: "Dinner", slug: "dinner" }],
      tools: [{ name: "Dutch oven", slug: "dutch-oven" }],
    });
    expect(await organize(recipe.id, chef.id, { categories: "" })).toEqual({ saved: true });
    const kept = await organizeLoader({ request: await signedIn(path, chef.id), context: ON, params: { id: recipe.id } } as never);
    expect([kept.tags.length, kept.categories.length, kept.tools.length]).toEqual([2, 0, 1]);
  });

  it("refuse another cook's recipe, a missing one and unkind words", async () => {
    const chef = await createDrawerUser("organizers-owner");
    const stranger = await createDrawerUser("organizers-stranger");
    const recipe = await createDrawerRecipe({ chefId: chef.id, title: "Not yours" });
    const path = `/recipes/${recipe.id}/organize`;
    expect(await status(organizeLoader({ request: await signedIn(path, stranger.id), context: ON, params: { id: recipe.id } } as never))).toBe(404);
    expect(await status(organize(recipe.id, stranger.id, { tags: "Mine" }))).toBe(404);
    expect(await status(organize(recipe.id, stranger.id, {}))).toBe(404);
    expect(await status(organizeLoader({ request: await signedIn("/recipes/none/organize", chef.id), context: ON, params: { id: "none" } } as never))).toBe(404);
    const rude = await organize(recipe.id, chef.id, { tags: "fine", tools: OBJECTIONABLE_TERMS[0] });
    expect(rude).toMatchObject({ data: { error: OBJECTIONABLE_CONTENT_MESSAGE }, init: { status: 400 } });
    expect(await db.organizer.count()).toBe(0);
  });

  it("refuse a name longer than an organizer's can be, saying which kind, instead of dropping it", async () => {
    const chef = await createDrawerUser("organizers-long");
    const recipe = await createDrawerRecipe({ chefId: chef.id, title: "Long soup" });
    const long = await organize(recipe.id, chef.id, { tags: "Fine", categories: "x".repeat(61) });
    expect(long).toMatchObject({ data: { error: "Keep each category to 60 characters or fewer." }, init: { status: 400 } });
    expect(await db.organizer.count()).toBe(0);
    // Runs of spaces count once, as the name is stored.
    expect(await organize(recipe.id, chef.id, { tools: `${"x".repeat(29)}    ${"y".repeat(29)}` })).toEqual({ saved: true });
  });

  it("list the cook's organizers of each kind with their recipe counts, and open each one's page with its recipes", async () => {
    const chef = await createDrawerUser("organizers-list");
    const soup = await createDrawerRecipe({ chefId: chef.id, title: "Lentil soup", description: "Warming" });
    const stew = await createDrawerRecipe({ chefId: chef.id, title: "Bean stew" });
    for (const recipe of [soup, stew]) await organize(recipe.id, chef.id, { tags: "Cozy", categories: "Cozy", tools: "Cozy" });
    for (const { path, list, page } of KINDS) {
      expect(await list({ request: await signedIn(path, chef.id), context: ON, params: {} } as never)).toEqual({ organizers: [{ name: "Cozy", slug: "cozy", recipeCount: 2 }] });
      const opened = await page({ request: await signedIn(`${path}/cozy`, chef.id), context: ON, params: { slug: "cozy" } } as never);
      expect(opened.organizer).toEqual({ name: "Cozy", slug: "cozy" });
      expect(opened.recipes.map((recipe) => recipe.title).sort()).toEqual(["Bean stew", "Lentil soup"]);
      expect(await status(page({ request: await signedIn(`${path}/none`, chef.id), context: ON, params: { slug: "none" } } as never))).toBe(404);
    }
  });

  it("show each kind's list, an organizer's recipes and the organize form", async () => {
    const lists = [
      { path: "/tags", Component: TagsIndex, title: "Your tags", empty: "No tags yet", href: "/tags/cozy" },
      { path: "/categories", Component: CategoriesIndex, title: "Your categories", empty: "No categories yet", href: "/categories/cozy" },
      { path: "/tools", Component: ToolsIndex, title: "Your tools", empty: "No tools yet", href: "/tools/cozy" },
    ];
    const pages = [
      { path: "/tags/:slug", Component: TagPage, list: "Recipes tagged Cozy", empty: "No recipes with this tag", all: "All tags" },
      { path: "/categories/:slug", Component: CategoryPage, list: "Recipes in Cozy", empty: "No recipes in this category", all: "All categories" },
      { path: "/tools/:slug", Component: ToolPage, list: "Recipes using Cozy", empty: "No recipes use this tool", all: "All tools" },
    ];
    const organizers = [{ name: "Cozy", slug: "cozy", recipeCount: 2 }, { name: "Solo", slug: "solo", recipeCount: 1 }];
    const recipes = [{ id: "r1", title: "Lentil soup", description: "Warming" }, { id: "r2", title: "Bean stew", description: null }];
    const Stub = createTestRoutesStub([
      ...lists.flatMap(({ path, Component }) => [
        { path, Component, loader: () => ({ organizers }) },
        { path: `/empty${path}`, Component, loader: () => ({ organizers: [] }) },
      ]),
      ...pages.flatMap(({ path, Component }) => [
        { path, Component, loader: () => ({ organizer: { name: "Cozy", slug: "cozy" }, recipes }) },
        { path: `/empty${path}`, Component, loader: () => ({ organizer: { name: "Lonely", slug: "lonely" }, recipes: [] }) },
      ]),
      {
        path: "/recipes/:id/organize",
        Component: RecipeOrganize,
        loader: () => ({ recipe: { id: "r1", title: "Lentil soup" }, tags: [{ name: "Cozy", slug: "cozy" }], categories: [{ name: "Soup", slug: "soup" }], tools: [] }),
        action: () => ({ saved: true }),
      },
      {
        path: "/recipes-rude/:id/organize",
        Component: RecipeOrganize,
        loader: () => ({ recipe: { id: "r3", title: "Rude stew" }, tags: [], categories: [], tools: [] }),
        action: () => ({ error: "Please keep it kind." }),
      },
    ]);

    for (const { path, title, empty, href } of lists) {
      const shown = render(<Stub initialEntries={[path]} />);
      expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
      expect(screen.getByRole("list", { name: title })).toBeTruthy();
      expect(screen.getByRole("link", { name: /Cozy/ }).getAttribute("href")).toBe(href);
      expect(screen.getByText("2 recipes")).toBeTruthy();
      expect(screen.getByText("1 recipe")).toBeTruthy();
      shown.unmount();
      const none = render(<Stub initialEntries={[`/empty${path}`]} />);
      expect(await screen.findByText(empty)).toBeTruthy();
      none.unmount();
    }

    for (const { path, list, empty, all } of pages) {
      const shown = render(<Stub initialEntries={[path.replace(":slug", "cozy")]} />);
      expect(await screen.findByRole("heading", { level: 1, name: "Cozy" })).toBeTruthy();
      expect(screen.getByRole("list", { name: list })).toBeTruthy();
      expect(screen.getByRole("link", { name: /Lentil soup/ }).getAttribute("href")).toBe("/recipes/r1");
      expect(screen.getByRole("link", { name: all })).toBeTruthy();
      shown.unmount();
      const none = render(<Stub initialEntries={[`/empty${path.replace(":slug", "lonely")}`]} />);
      expect(await screen.findByText(empty)).toBeTruthy();
      none.unmount();
    }

    render(<Stub initialEntries={["/recipes/r1/organize"]} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Organize" })).toBeTruthy();
    expect((screen.getByLabelText("Tags") as HTMLInputElement).value).toBe("Cozy");
    expect((screen.getByLabelText("Categories") as HTMLInputElement).value).toBe("Soup");
    expect((screen.getByLabelText("Tools") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("region", { name: "Tags on this recipe" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Cozy" }).getAttribute("href")).toBe("/tags/cozy");
    expect(screen.getByRole("link", { name: "Soup" }).getAttribute("href")).toBe("/categories/soup");
    expect(screen.getByText("No tools on this recipe yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lentil soup" }).getAttribute("href")).toBe("/recipes/r1");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    cleanup();

    render(<Stub initialEntries={["/recipes-rude/r3/organize"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText("Please keep it kind.")).toBeTruthy();
  });
});
