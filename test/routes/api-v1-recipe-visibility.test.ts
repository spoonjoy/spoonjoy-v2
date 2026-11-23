import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";

// A private recipe reads, over the REST API, only for its cook: to anyone else it is not there.

let db: Awaited<ReturnType<typeof getLocalDb>>;

type RecipeSummary = { title: string; attribution: { sourceRecipe: { title: string } | null } };
type Envelope = {
  data: {
    recipe: RecipeSummary;
    recipes: RecipeSummary[];
    cookbook: { recipeCount: number; recipes: RecipeSummary[] };
    results: Array<{ type: string; id: string }>;
  };
};

function routeArgs(request: Request, splat: string) {
  return { request, params: { "*": splat }, context: { cloudflare: { env: null } } } as unknown as Parameters<typeof loader>[0];
}

async function get(path: string, token?: string) {
  const response = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }) as unknown as Request, path.split("?")[0]!));
  return { status: response.status, body: await response.json() as Envelope };
}

describe("private recipes over the REST API", () => {
  let cookToken: string;
  let strangerToken: string;
  let privateId: string;
  let forkId: string;
  let bookId: string;

  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    const cook = await db.user.create({ data: { email: "rest_cook@example.com", username: "rest_cook" } });
    const stranger = await db.user.create({ data: { email: "rest_stranger@example.com", username: "rest_stranger" } });
    const scopes = ["recipes:read", "cookbooks:read"];
    cookToken = (await createApiCredential(db, cook.id, "Cook reader", { scopes })).token;
    strangerToken = (await createApiCredential(db, stranger.id, "Stranger reader", { scopes })).token;
    const recipe = await db.recipe.create({ data: { title: "Hidden Fig Jam", chefId: cook.id, visibility: "private" } });
    privateId = recipe.id;
    const fork = await db.recipe.create({ data: { title: "Open Fig Jam", chefId: stranger.id, sourceRecipeId: recipe.id } });
    forkId = fork.id;
    const book = await db.cookbook.create({ data: { title: "Stranger Jams", authorId: stranger.id } });
    bookId = book.id;
    await db.recipeInCookbook.create({ data: { recipeId: recipe.id, cookbookId: book.id, addedById: stranger.id } });
    await db.recipeInCookbook.create({ data: { recipeId: fork.id, cookbookId: book.id, addedById: stranger.id } });
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("answers its page as not found for anyone but its cook", async () => {
    expect((await get(`recipes/${privateId}`, cookToken)).body.data.recipe.title).toBe("Hidden Fig Jam");
    for (const token of [strangerToken, undefined]) {
      const answer = await get(`recipes/${privateId}`, token);
      expect(answer.status).toBe(404);
      expect(JSON.stringify(answer.body)).not.toContain("Hidden Fig Jam");
    }
  });

  it("finds it in search for its cook, whose token reads recipes but not the shopping list, and for no one else", async () => {
    const found = async (token?: string) => (await get("search?q=fig&scope=recipes", token)).body.data.results.map((result) => result.id);
    expect(await found(cookToken)).toContain(privateId);
    expect(await found(strangerToken)).not.toContain(privateId);
    expect(await found()).not.toContain(privateId);
  });

  it("leaves it out of the recipe list for anyone but its cook", async () => {
    const titles = async (token?: string) => (await get("recipes", token)).body.data.recipes.map((recipe) => recipe.title).sort();
    expect(await titles(cookToken)).toEqual(["Hidden Fig Jam", "Open Fig Jam"]);
    expect(await titles(strangerToken)).toEqual(["Open Fig Jam"]);
    expect(await titles()).toEqual(["Open Fig Jam"]);
  });

  it("shows a fork of it without its source to anyone but its cook", async () => {
    expect((await get(`recipes/${forkId}`, cookToken)).body.data.recipe.attribution.sourceRecipe?.title).toBe("Hidden Fig Jam");
    const answer = await get(`recipes/${forkId}`, strangerToken);
    expect(answer.body.data.recipe.attribution.sourceRecipe).toBeNull();
    expect(JSON.stringify(answer.body)).not.toContain("Hidden Fig Jam");
  });

  it("leaves it out of a cookbook and answers its cooks as not found", async () => {
    const book = await get(`cookbooks/${bookId}`, strangerToken);
    expect(book.body.data.cookbook.recipeCount).toBe(1);
    expect(book.body.data.cookbook.recipes.map((recipe) => recipe.title)).toEqual(["Open Fig Jam"]);
    expect(JSON.stringify(book.body)).not.toContain("Hidden Fig Jam");
    expect((await get(`cookbooks/${bookId}`, cookToken)).body.data.cookbook.recipeCount).toBe(2);
    expect((await get(`recipes/${privateId}/spoons`, strangerToken)).status).toBe(404);
    expect((await get(`recipes/${privateId}/spoons`, cookToken)).status).toBe(200);
  });
});
