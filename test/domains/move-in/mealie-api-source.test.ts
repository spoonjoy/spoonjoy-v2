import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { apiRecipeDraft } from "~/domains/move-in/adapters/sources/mealie-api/recipe";
import { mealieApiSource } from "~/domains/move-in/adapters/sources/mealie-api/source";
import { readMealieDatabase, recipeDrafts } from "~/domains/move-in/adapters/sources/mealie-backup/database";
import { SourceUnavailableError } from "~/domains/move-in/application/source";
import { MoveInError } from "~/domains/move-in/model/move-in-error";
import type { RecipeDraft } from "~/domains/move-in/model/recipe-draft";
import { normalizeGuid } from "~/domains/move-in/model/source-key";

// Recipes exactly as each version's server returned them, and the same kitchen's backup rows: see
// scripts/move-in-proof/api-test-fixtures.mjs.
const FIXTURES = path.join(__dirname, "support/mealie-api");
const VERSIONS = ["v1.12.0", "v2.8.0", "v3.31.0"] as const;

type Json = Record<string, unknown>;

function recorded(version: string) {
  const dir = path.join(FIXTURES, version);
  const recipes = readdirSync(path.join(dir, "recipes")).sort().map((file) => JSON.parse(readFileSync(path.join(dir, "recipes", file), "utf8")) as Json);
  const database = JSON.parse(readFileSync(path.join(dir, "database.json"), "utf8")) as Json;
  return { recipes, database };
}

// The photo is found a different way in each, and tags, categories and tools have no order in either: they go on a
// recipe as a set, and the content hash that tells a changed recipe leaves them out.
const sameShape = ({ photoPath: _photo, tags, categories, tools, ...draft }: RecipeDraft) =>
  ({ ...draft, tags: [...tags].sort(), categories: [...categories].sort(), tools: [...tools].sort() });

describe("a recipe from the other app's server", () => {
  it.each(VERSIONS)("makes the same draft as the same recipe from that kitchen's backup, in %s", (version) => {
    const { recipes, database } = recorded(version);
    const db = readMealieDatabase(database);
    const group = normalizeGuid(recipes[0].groupId) as string;
    const fromBackup = new Map(recipeDrafts(db, group).map((draft) => [draft.sourceKey, draft]));
    for (const recipe of recipes) {
      const draft = apiRecipeDraft(recipe);
      expect(draft.ingredients.length).toBeGreaterThan(0);
      expect(sameShape(draft)).toEqual(sameShape(fromBackup.get(draft.sourceKey) as RecipeDraft));
    }
  });

  it("reads a unit by its abbreviation, servings by number, and links a step only to the recipe's own ingredients", () => {
    const ref = "00000000-0000-4000-8000-0000000000b1";
    const draft = apiRecipeDraft({
      id: "00000000-0000-4000-8000-0000000000b0",
      name: "Toast",
      updatedAt: "2026-11-23T16:44:06.836254+00:00",
      recipeServings: 2,
      recipeIngredient: [{ referenceId: ref, food: { name: "bread" }, unit: { name: " ", abbreviation: "sl" }, quantity: 2 }],
      recipeInstructions: [{ id: "00000000-0000-4000-8000-0000000000b2", title: "Toast it", text: "", ingredientReferences: [{ referenceId: ref }, { referenceId: "00000000-0000-4000-8000-0000000000b9" }] }],
      tags: [{ name: "Quick" }, { name: " " }],
    });
    expect(draft).toMatchObject({
      sourceUpdatedAt: "2026-11-23T16:44:06.836254",
      servings: "2",
      photoPath: "",
      ingredients: [{ unit: "sl", food: "bread", quantity: 2, plainText: false }],
      steps: [{ title: "Toast it", text: "Toast it", ingredientKeys: [`00000000-0000-4000-8000-0000000000b0|${ref}`] }],
      tags: ["Quick"],
    });
  });

  it("names an untitled recipe and leaves out empty lines, as the backup does", () => {
    const draft = apiRecipeDraft({
      id: "00000000-0000-4000-8000-000000000001",
      name: "  ",
      recipeIngredient: [{ referenceId: "00000000-0000-4000-8000-000000000002", note: "", food: null }, { note: "salt", quantity: 0 }],
      recipeInstructions: [{ id: "00000000-0000-4000-8000-000000000003", title: "", text: "" }, { id: "x", text: "no key" }],
      notes: [{ title: "Tip", text: " " }],
    });
    expect(draft).toMatchObject({
      title: "Untitled recipe",
      ingredients: [{ sourceKey: "00000000-0000-4000-8000-000000000001|position:1", note: "salt", quantity: null, plainText: true }],
      steps: [],
      notes: [],
      servings: null,
      sourceUpdatedAt: null,
      tags: [],
    });
    expect(draft.warnings).toEqual([
      `This recipe had no name, so it's called "Untitled recipe".`,
      "An ingredient line had no text, so it was left out.",
    ]);
  });
});

const KITCHEN = "092b8ed0-4f72-43b4-9ba2-dffc05dc8d47";

/** A stand-in for the other app's server: answers the paths it knows, and records what was asked. */
function server(routes: Record<string, unknown>, { status = {} as Record<string, number>, down = false } = {}) {
  const asked: Array<{ url: string; authorization: string | null }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    asked.push({ url: `${url.pathname}${url.search}`, authorization: new Headers(init?.headers).get("authorization") });
    if (down) throw new TypeError("fetch failed");
    const code = status[url.pathname];
    if (code) return new Response("no", { status: code });
    const body = routes[url.pathname];
    if (body === undefined) return new Response("not found", { status: 404 });
    if (body instanceof Uint8Array) return new Response(body);
    return Response.json(body);
  };
  return { fetch, asked };
}

const photo = new Uint8Array([82, 73, 70, 70]);

function kitchenRoutes(version = "v3.31.0") {
  const { recipes } = recorded(version);
  const summary = (recipe: Json) => ({ id: recipe.id, slug: recipe.slug, name: recipe.name, image: recipe.image, createdAt: recipe.createdAt });
  return {
    recipes,
    routes: {
      "/api/app/about": { version },
      "/api/users/self": { id: "user", email: "cook@example.com", group: "Juniper Street", groupId: recipes[0].groupId },
      // The server lists them newest first; the move-in keeps its own fixed order.
      "/api/recipes": { items: [...recipes].reverse().map(summary).concat([{ ...summary(recipes[0]), id: "elsewhere", image: null, createdAt: "2026-11-23T16:44:09Z", slug: "no-photo" }]) },
      "/api/organizers/tags": { items: [{ name: "Vegan" }, { name: "Spicy" }] },
      "/api/organizers/categories": [{ name: "Dinner" }],
      "/api/organizers/tools": { items: [] },
      ...Object.fromEntries(recipes.map((recipe) => [`/api/recipes/${recipe.slug}`, recipe])),
      [`/api/media/recipes/${recipes[0].id}/images/original.webp`]: photo,
    } as Record<string, unknown>,
  };
}

describe("the other app's server as a move-in source", () => {
  it("opens the token's kitchen and lists its recipes oldest first, fetching each recipe and photo only when asked", async () => {
    const { recipes, routes } = kitchenRoutes();
    const { fetch, asked } = server(routes);
    const source = await mealieApiSource({ address: "https://recipes.example.com/", token: "secret-token", fetch });
    expect(source.version).toBe("v3.31.0");
    expect(await source.chooseKitchen(null)).toBe(KITCHEN);
    const kitchen = await source.openKitchen(KITCHEN);
    if (!kitchen) throw new Error("expected the kitchen");
    expect(kitchen).toMatchObject({ key: KITCHEN, name: "Juniper Street", size: 4 });
    const byAge = [...recipes].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    expect(kitchen.entry(0)).toEqual({ sourceKey: normalizeGuid(byAge[0].id), title: byAge[0].name });
    expect(kitchen.entry(3)).toMatchObject({ sourceKey: "elsewhere" });
    expect(await kitchen.count()).toEqual({ photos: 3, tags: 2, categories: 1, tools: 0 });
    expect(asked.some((call) => call.url.startsWith("/api/recipes/"))).toBe(false);

    const first = recipes[0];
    const index = byAge.indexOf(first);
    const draft = await kitchen.draft(index);
    expect(draft.sourceKey).toBe(normalizeGuid(first.id));
    expect(kitchen.hasPhoto(draft)).toBe(true);
    expect(await kitchen.readPhoto(draft)).toEqual(photo);
    expect(asked.every((call) => call.authorization === "Bearer secret-token")).toBe(true);
    expect(asked.map((call) => call.url)).toContain("/api/recipes?page=1&perPage=-1");
  });

  it("reads an older server's version, a kitchen with no name, and recipes with little to them", async () => {
    const recipes = [
      { id: "00000000-0000-4000-8000-0000000000c2", slug: "b", createdAt: "2026-11-23T16:00:00Z" },
      { id: "00000000-0000-4000-8000-0000000000c1", slug: "a", name: "Soup", image: "x", createdAt: "2026-11-23T16:00:00Z" },
      { id: "00000000-0000-4000-8000-0000000000c0", slug: "c" },
    ];
    const { fetch } = server({
      "/api/app/about": { version: "1.12.0" },
      "/api/users/self": { groupId: KITCHEN },
      "/api/recipes": recipes,
      "/api/organizers/tags": { items: "none" },
      "/api/organizers/categories": null,
      "/api/organizers/tools": { items: [null, { name: "Pan" }] },
    }, { status: { "/api/media/recipes/00000000-0000-4000-8000-0000000000c1/images/original.webp": 503 } });
    const source = await mealieApiSource({ address: "http://recipes.example.com/", token: "t", fetch });
    expect(source.version).toBe("v1.12.0");
    const kitchen = await source.openKitchen(KITCHEN);
    if (!kitchen) throw new Error("expected the kitchen");
    expect(kitchen.name).toBe("Kitchen");
    // A recipe with no date goes first; two with the same date go by key.
    expect([0, 1, 2].map((index) => kitchen.entry(index))).toEqual([
      { sourceKey: "00000000-0000-4000-8000-0000000000c0", title: "Untitled recipe" },
      { sourceKey: "00000000-0000-4000-8000-0000000000c1", title: "Soup" },
      { sourceKey: "00000000-0000-4000-8000-0000000000c2", title: "Untitled recipe" },
    ]);
    expect(await kitchen.count()).toEqual({ photos: 1, tags: 0, categories: 0, tools: 1 });
    const soup = apiRecipeDraft(recipes[1]);
    await expect(kitchen.readPhoto(soup)).rejects.toBeInstanceOf(SourceUnavailableError);
  });

  it("has no kitchen but the token's own", async () => {
    const { fetch } = server(kitchenRoutes().routes);
    const source = await mealieApiSource({ address: "https://recipes.example.com", token: "t", fetch });
    expect(await source.openKitchen("another-kitchen")).toBeNull();
  });

  it("says a recipe without a photo has none, and a photo the server won't give is a failed photo", async () => {
    const { routes } = kitchenRoutes();
    const { fetch } = server(routes);
    const kitchen = await (await mealieApiSource({ address: "https://recipes.example.com", token: "t", fetch })).openKitchen(KITCHEN);
    if (!kitchen) throw new Error("expected the kitchen");
    const withoutPhoto = { ...apiRecipeDraft({ id: "elsewhere", name: "Plain" }) };
    expect(kitchen.hasPhoto(withoutPhoto)).toBe(false);
    const missing = apiRecipeDraft({ id: "00000000-0000-4000-8000-00000000000a", name: "Gone", image: "abc" });
    expect(kitchen.hasPhoto(missing)).toBe(true);
    await expect(kitchen.readPhoto(missing)).rejects.toThrow("the server has no photo for this recipe");
  });

  it("fails a recipe the server no longer has, so the move-in passes it over", async () => {
    const { routes } = kitchenRoutes();
    const { fetch } = server({ ...routes, [`/api/recipes/${(routes["/api/recipes"] as { items: Json[] }).items[3].slug}`]: undefined });
    const kitchen = await (await mealieApiSource({ address: "https://recipes.example.com", token: "t", fetch })).openKitchen(KITCHEN);
    await expect(kitchen?.draft(3)).rejects.toThrow("404");
  });

  it("stops the move-in with the fix-it message when the server refuses the token", async () => {
    const { fetch } = server(kitchenRoutes().routes, { status: { "/api/users/self": 401 } });
    const opening = mealieApiSource({ address: "https://recipes.example.com", token: "t", fetch });
    await expect(opening).rejects.toBeInstanceOf(MoveInError);
    await expect(opening).rejects.toMatchObject({ code: "server-token" });
  });

  it("waits and tries again when the server can't be reached or is struggling", async () => {
    await expect(mealieApiSource({ address: "https://recipes.example.com", token: "t", fetch: server({}, { down: true }).fetch }))
      .rejects.toBeInstanceOf(SourceUnavailableError);
    for (const code of [429, 502, 503]) {
      const { fetch } = server(kitchenRoutes().routes, { status: { "/api/app/about": code } });
      await expect(mealieApiSource({ address: "https://recipes.example.com", token: "t", fetch })).rejects.toBeInstanceOf(SourceUnavailableError);
    }
  });

  it("says why when the server can't be reached", async () => {
    const fetch: typeof globalThis.fetch = () => Promise.reject("connection reset");
    await expect(mealieApiSource({ address: "https://recipes.example.com", token: "t", fetch })).rejects.toThrow("connection reset");
  });

  it("stops with the fix-it message when the address isn't one it can reach", async () => {
    await expect(mealieApiSource({ address: "not a server", token: "t", fetch: server({}).fetch })).rejects.toMatchObject({ code: "server-address" });
    await expect(mealieApiSource({ address: "ftp://recipes.example.com", token: "t", fetch: server({}).fetch })).rejects.toMatchObject({ code: "server-address" });
    // A server that answers, but isn't the recipe app.
    await expect(mealieApiSource({ address: "https://example.com", token: "t", fetch: server({ "/api/app/about": { name: "a blog" } }).fetch })).rejects.toMatchObject({ code: "server-address" });
    const page: typeof globalThis.fetch = async () => new Response("<html>a blog</html>");
    await expect(mealieApiSource({ address: "https://example.com", token: "t", fetch: page })).rejects.toMatchObject({ code: "server-address" });
    await expect(mealieApiSource({ address: "https://example.com", token: "t", fetch: server({}).fetch })).rejects.toMatchObject({ code: "server-address" });
  });
});
