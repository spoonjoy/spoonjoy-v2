import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { db } from "~/lib/db.server";
import { OBJECTIONABLE_CONTENT_MESSAGE, OBJECTIONABLE_TERMS } from "~/lib/objectionable-terms";
import { tagNamesFromInput } from "~/domains/kitchen";
import TagsIndex, { loader as tagsLoader, meta as tagsMeta } from "~/routes/tags._index";
import TagPage, { loader as tagLoader, meta as tagMeta } from "~/routes/tags.$slug";
import RecipeTags, { action as recipeTagsAction, loader as recipeTagsLoader, meta as recipeTagsMeta } from "~/routes/recipes.$id.tags";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRoutesStub } from "../utils";
import { createDrawerRecipe, createDrawerUser, sessionHeaders } from "./kitchen-drawer-test-utils";

const ON = { cloudflare: { env: { SPOONJOY_FLAGS: "organizers" } } };
const OFF = { cloudflare: { env: {} } };

async function signedIn(path: string, userId: string, init: RequestInit = {}) {
  const headers = await sessionHeaders(userId);
  return new UndiciRequest(`http://localhost:3000${path}`, { ...init, headers }) as unknown as Request;
}

function tagForm(tags: string) {
  const body = new URLSearchParams({ tags });
  return { method: "POST", body } as RequestInit;
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

describe("tags on recipes", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    cleanup();
    await cleanupDatabase();
  });

  it("read typed tags split at commas, and none from a missing field", () => {
    expect(tagNamesFromInput("a, b,,c")).toEqual(["a", " b", "", "c"]);
    expect(tagNamesFromInput(null)).toEqual([]);
  });

  it("names its pages", () => {
    expect(tagsMeta()).toEqual([{ title: "Your tags - Spoonjoy" }, { name: "robots", content: "noindex" }]);
    expect(tagMeta({ data: { tag: { name: "Quick" } } } as never)).toEqual([{ title: "Quick - Spoonjoy" }, { name: "robots", content: "noindex" }]);
    expect(tagMeta({ data: undefined } as never)).toEqual([{ title: "Tag - Spoonjoy" }, { name: "robots", content: "noindex" }]);
    expect(recipeTagsMeta({ data: { recipe: { title: "Soup" } } } as never)).toEqual([{ title: "Tags for Soup - Spoonjoy" }, { name: "robots", content: "noindex" }]);
    expect(recipeTagsMeta({ data: undefined } as never)).toEqual([{ title: "Tags - Spoonjoy" }, { name: "robots", content: "noindex" }]);
  });

  it("are not found while the organizers flag is off", async () => {
    const chef = await createDrawerUser("tags-off");
    const recipe = await createDrawerRecipe({ chefId: chef.id, title: "Flag off soup" });
    expect(await status(tagsLoader({ request: await signedIn("/tags", chef.id), context: OFF, params: {} } as never))).toBe(404);
    expect(await status(tagLoader({ request: await signedIn("/tags/x", chef.id), context: OFF, params: { slug: "x" } } as never))).toBe(404);
    const path = `/recipes/${recipe.id}/tags`;
    expect(await status(recipeTagsLoader({ request: await signedIn(path, chef.id), context: OFF, params: { id: recipe.id } } as never))).toBe(404);
    expect(await status(recipeTagsAction({ request: await signedIn(path, chef.id, tagForm("a")), context: OFF, params: { id: recipe.id } } as never))).toBe(404);
  });

  it("send a signed-out visitor to sign in", async () => {
    const request = new UndiciRequest("http://localhost:3000/tags") as unknown as Request;
    expect(await status(tagsLoader({ request, context: ON, params: {} } as never))).toBe(302);
  });

  it("save a recipe's tags from a comma-separated list and read them back", async () => {
    const chef = await createDrawerUser("tags-save");
    const recipe = await createDrawerRecipe({ chefId: chef.id, title: "Weeknight soup" });
    const path = `/recipes/${recipe.id}/tags`;
    const saved = await recipeTagsAction({ request: await signedIn(path, chef.id, tagForm("Quick, Soup,, quick")), context: ON, params: { id: recipe.id } } as never);
    expect(saved).toEqual({ saved: true });
    const loaded = await recipeTagsLoader({ request: await signedIn(path, chef.id), context: ON, params: { id: recipe.id } } as never);
    expect(loaded).toEqual({ recipe: { id: recipe.id, title: "Weeknight soup" }, tags: [{ name: "Quick", slug: "quick" }, { name: "Soup", slug: "soup" }] });
  });

  it("refuse another cook's recipe and a missing one", async () => {
    const chef = await createDrawerUser("tags-owner");
    const stranger = await createDrawerUser("tags-stranger");
    const recipe = await createDrawerRecipe({ chefId: chef.id, title: "Not yours" });
    const path = `/recipes/${recipe.id}/tags`;
    expect(await status(recipeTagsLoader({ request: await signedIn(path, stranger.id), context: ON, params: { id: recipe.id } } as never))).toBe(404);
    expect(await status(recipeTagsAction({ request: await signedIn(path, stranger.id, tagForm("Mine")), context: ON, params: { id: recipe.id } } as never))).toBe(404);
    expect(await status(recipeTagsLoader({ request: await signedIn("/recipes/none/tags", chef.id), context: ON, params: { id: "none" } } as never))).toBe(404);
    const rude = await recipeTagsAction({ request: await signedIn(path, chef.id, tagForm(`fine, ${OBJECTIONABLE_TERMS[0]}`)), context: ON, params: { id: recipe.id } } as never);
    expect(rude).toMatchObject({ data: { error: OBJECTIONABLE_CONTENT_MESSAGE }, init: { status: 400 } });
    expect(await db.organizer.count()).toBe(0);
  });

  it("list the cook's tags with their recipe counts, and open a tag's page with its recipes", async () => {
    const chef = await createDrawerUser("tags-list");
    const soup = await createDrawerRecipe({ chefId: chef.id, title: "Lentil soup", description: "Warming" });
    const stew = await createDrawerRecipe({ chefId: chef.id, title: "Bean stew" });
    for (const recipe of [soup, stew]) {
      await recipeTagsAction({ request: await signedIn(`/recipes/${recipe.id}/tags`, chef.id, tagForm("Cozy")), context: ON, params: { id: recipe.id } } as never);
    }
    const listed = await tagsLoader({ request: await signedIn("/tags", chef.id), context: ON, params: {} } as never);
    expect(listed).toEqual({ tags: [{ name: "Cozy", slug: "cozy", recipeCount: 2 }] });
    const page = await tagLoader({ request: await signedIn("/tags/cozy", chef.id), context: ON, params: { slug: "cozy" } } as never);
    expect(page.tag).toEqual({ name: "Cozy", slug: "cozy" });
    expect(page.recipes.map((recipe) => recipe.title).sort()).toEqual(["Bean stew", "Lentil soup"]);
    expect(await status(tagLoader({ request: await signedIn("/tags/none", chef.id), context: ON, params: { slug: "none" } } as never))).toBe(404);
  });

  it("show the tag list, a tag's recipes and the tag form", async () => {
    const Stub = createTestRoutesStub([
      { path: "/tags", Component: TagsIndex, loader: () => ({ tags: [{ name: "Cozy", slug: "cozy", recipeCount: 2 }, { name: "Solo", slug: "solo", recipeCount: 1 }] }) },
      { path: "/empty", Component: TagsIndex, loader: () => ({ tags: [] }) },
      {
        path: "/tags/:slug",
        Component: TagPage,
        loader: () => ({ tag: { name: "Cozy", slug: "cozy" }, recipes: [{ id: "r1", title: "Lentil soup", description: "Warming" }, { id: "r2", title: "Bean stew", description: null }] }),
      },
      { path: "/tags-empty/:slug", Component: TagPage, loader: () => ({ tag: { name: "Lonely", slug: "lonely" }, recipes: [] }) },
      {
        path: "/recipes/:id/tags",
        Component: RecipeTags,
        loader: () => ({ recipe: { id: "r1", title: "Lentil soup" }, tags: [{ name: "Cozy", slug: "cozy" }] }),
        action: () => ({ saved: true }),
      },
      {
        path: "/recipes-rude/:id/tags",
        Component: RecipeTags,
        loader: () => ({ recipe: { id: "r3", title: "Rude stew" }, tags: [] }),
        action: () => ({ error: "Please keep it kind." }),
      },
      { path: "/recipes-none/:id/tags", Component: RecipeTags, loader: () => ({ recipe: { id: "r2", title: "Bean stew" }, tags: [] }) },
    ]);

    const tags = render(<Stub initialEntries={["/tags"]} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Your tags" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Cozy/ }).getAttribute("href")).toBe("/tags/cozy");
    expect(screen.getByText("2 recipes")).toBeTruthy();
    expect(screen.getByText("1 recipe")).toBeTruthy();
    tags.unmount();

    const empty = render(<Stub initialEntries={["/empty"]} />);
    expect(await screen.findByText("No tags yet")).toBeTruthy();
    empty.unmount();

    const tag = render(<Stub initialEntries={["/tags/cozy"]} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Cozy" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Lentil soup/ }).getAttribute("href")).toBe("/recipes/r1");
    expect(screen.getByRole("link", { name: /Bean stew/ })).toBeTruthy();
    tag.unmount();

    const lonely = render(<Stub initialEntries={["/tags-empty/lonely"]} />);
    expect(await screen.findByText("No recipes with this tag")).toBeTruthy();
    lonely.unmount();

    render(<Stub initialEntries={["/recipes/r1/tags"]} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Tags" })).toBeTruthy();
    expect((screen.getByLabelText("Tags") as HTMLInputElement).value).toBe("Cozy");
    expect(screen.getByRole("link", { name: "Cozy" }).getAttribute("href")).toBe("/tags/cozy");
    expect(screen.getByRole("link", { name: "Lentil soup" }).getAttribute("href")).toBe("/recipes/r1");
    fireEvent.click(screen.getByRole("button", { name: "Save tags" }));
    expect(await screen.findByText("Tags saved.")).toBeTruthy();
    cleanup();

    render(<Stub initialEntries={["/recipes-rude/r3/tags"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save tags" }));
    expect(await screen.findByText("Please keep it kind.")).toBeTruthy();
    cleanup();

    render(<Stub initialEntries={["/recipes-none/r2/tags"]} />);
    expect(await screen.findByText("No tags on this recipe yet.")).toBeTruthy();
  });
});
