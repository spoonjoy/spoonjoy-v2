import { describe, expect, it } from "vitest";
import { homeOf, photoPathOf, sameAddress, spoonjoyRecipeDraft } from "~/domains/move-in/adapters/sources/spoonjoy-api/recipe";
import { SPOONJOY_SOURCE_KIND, spoonjoyApiSource } from "~/domains/move-in/adapters/sources/spoonjoy-api/source";
import { openServerSource } from "~/domains/move-in/adapters/worker/server-sources";
import { MOVE_IN_APPS, moveInAppOf, readsAServer } from "~/domains/move-in/adapters/worker/apps";
import { SourceUnavailableError } from "~/domains/move-in/application/source";

type Json = Record<string, unknown>;

const ACCOUNT = "cm_account_1";

/** A recipe as GET /api/v1/me/export lists it (app/lib/account-export.server.ts). */
function exportedRecipe(id: string, more: Json = {}): Json {
  return {
    id,
    title: `Recipe ${id}`,
    description: null,
    servings: null,
    sourceUrl: null,
    forkedFromRecipeId: null,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-02T10:00:00.000Z",
    deletedAt: null,
    url: `https://spoonjoy.app/recipes/${id}`,
    steps: [{ stepNum: 1, title: null, description: "Cook it.", durationMinutes: null, usesOutputOfSteps: [], ingredients: [] }],
    tags: [],
    categories: [],
    tools: [],
    covers: [],
    ...more,
  };
}

const bread = exportedRecipe("r_bread", {
  title: " Bread ",
  description: "Crusty",
  servings: "2",
  sourceUrl: "https://example.com/bread",
  createdAt: "2026-10-01T10:00:00.000Z",
  steps: [
    {
      stepNum: 1,
      title: "Mix",
      description: "Mix the flour and water.",
      durationMinutes: 5,
      usesOutputOfSteps: [],
      ingredients: [
        { quantity: 2, unit: "cup", name: "flour" },
        { quantity: 0, unit: "", name: "salt" },
        { quantity: 1, unit: "cup", name: " " },
      ],
    },
    { stepNum: 2, title: null, description: "Bake.", durationMinutes: 0, usesOutputOfSteps: [1], ingredients: [] },
    { stepNum: 3, title: "Empty", description: " ", ingredients: [] },
    // Uses the empty step, step 2 twice, step 1, a step that isn't there and itself: only steps 1 and 2 are ones it can use.
    { stepNum: 4, title: null, description: "Slice.", durationMinutes: null, usesOutputOfSteps: [3, 2, 2, 1, 9, 4], ingredients: [] },
  ],
  tags: ["Weeknight", "Baking", " "],
  categories: ["Breads"],
  tools: ["Dutch oven"],
  covers: [
    { id: "c_old", active: false, imageUrl: "https://spoonjoy.app/photos/recipes/old.jpg" },
    { id: "c_now", active: true, imageUrl: "https://spoonjoy.app/photos/recipes/bread.jpg?v=2", stylizedImageUrl: null },
  ],
});

const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

function exportOf(recipes: Json[], account: Json = { id: ACCOUNT, username: "ada" }): Json {
  return { ok: true, requestId: "req", data: { format: "spoonjoy.account-export.v1", account, recipes, cookbooks: [], shoppingList: [], cooks: [] } };
}

/** A stand-in for another Spoonjoy: answers the paths it knows, and records what was asked. */
function server(routes: Record<string, unknown>, { status = {} as Record<string, number> } = {}) {
  const asked: Array<{ url: string; authorization: string | null; redirect: RequestRedirect | undefined }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = `${url.pathname}${url.search}`;
    asked.push({ url: `${url.origin}${path}`, authorization: new Headers(init?.headers).get("authorization"), redirect: init?.redirect });
    const code = status[path];
    if (code) return new Response("no", { status: code });
    const body = routes[path];
    if (body === undefined) return new Response("not found", { status: 404 });
    if (body instanceof Uint8Array) return new Response(body);
    return Response.json(body);
  };
  return { fetch, asked };
}

function kitchenRoutes(recipes: Json[] = [bread, exportedRecipe("r_soup"), exportedRecipe("r_gone", { deletedAt: "2026-11-03T00:00:00.000Z" })]) {
  return {
    "/api/v1/health": { ok: true, requestId: "req", data: { ok: true, version: "v1", sourceSha: "0123456789abcdef0123" } },
    "/api/v1/me/export": exportOf(recipes),
    "/api/v1/me": { ok: true, data: { id: ACCOUNT } },
    "/photos/recipes/bread.jpg?v=2": photo,
  } as Record<string, unknown>;
}

describe("a recipe from another Spoonjoy's export", () => {
  it("keeps each step's ingredients on that step, with its time, and the recipe's tags, categories and tools", () => {
    const draft = spoonjoyRecipeDraft(bread, ACCOUNT);
    expect(draft).toEqual({
      sourceKey: "r_bread",
      ownerKey: ACCOUNT,
      sourceUpdatedAt: "2026-11-02T10:00:00.000Z",
      title: "Bread",
      description: "Crusty",
      servings: "2",
      sourceUrl: "https://example.com/bread",
      photoPath: "/photos/recipes/bread.jpg?v=2",
      steps: [
        { sourceKey: "r_bread|step:1", title: "Mix", text: "Mix the flour and water.", ingredientKeys: ["r_bread|step:1|0", "r_bread|step:1|1"], duration: 5, usesOutputOf: [] },
        { sourceKey: "r_bread|step:2", title: null, text: "Bake.", ingredientKeys: [], duration: null, usesOutputOf: [1] },
        { sourceKey: "r_bread|step:4", title: null, text: "Slice.", ingredientKeys: [], duration: null, usesOutputOf: [1, 2] },
      ],
      ingredients: [
        { sourceKey: "r_bread|step:1|0", section: null, quantity: 2, unit: "cup", food: "flour", note: null, originalText: null, plainText: false },
        { sourceKey: "r_bread|step:1|1", section: null, quantity: null, unit: null, food: "salt", note: null, originalText: null, plainText: false },
      ],
      notes: [],
      tags: ["Weeknight", "Baking"],
      categories: ["Breads"],
      tools: ["Dutch oven"],
      warnings: [],
      home: null,
    });
  });

  it("names an untitled recipe, and reads a recipe with little to it", () => {
    const draft = spoonjoyRecipeDraft({ id: "r_bare", title: " ", steps: [{ description: "Stir.", ingredients: "none" }, "not a step"], tags: "none" }, ACCOUNT);
    expect(draft).toMatchObject({
      title: "Untitled recipe",
      sourceUpdatedAt: null,
      photoPath: "",
      steps: [{ sourceKey: "r_bare|step:position:0", text: "Stir.", ingredientKeys: [] }],
      ingredients: [],
      tags: [],
    });
    expect(draft.warnings).toEqual([`This recipe had no name, so it's called "Untitled recipe".`]);
  });

  it("ties a recipe that moved out of this Spoonjoy back to the one it started as here", () => {
    const back = { ...bread, movedInFrom: [
      { kind: "mealie", serverUrl: null, sourceKey: "guid", contentHash: null },
      { kind: "spoonjoy", serverUrl: "https://elsewhere.example", sourceKey: "r_other", contentHash: "x" },
      { kind: "spoonjoy", serverUrl: "https://HOME.example/kitchen", sourceKey: " ", contentHash: "x" },
      { kind: "spoonjoy", serverUrl: "https://home.example/kitchen", sourceKey: "r_here", contentHash: "fingerprint" },
    ] };
    const draft = spoonjoyRecipeDraft(back, ACCOUNT, "https://home.example/kitchen/");
    // Its photo stays in the draft: if its home here is gone, it moves in anew, photo and all.
    expect(draft).toMatchObject({ home: { recipeId: "r_here", contentHash: "fingerprint" }, photoPath: "/photos/recipes/bread.jpg?v=2" });
    expect(homeOf({ ...back, movedInFrom: [{ kind: "spoonjoy", serverUrl: "https://home.example/kitchen", sourceKey: "r_here" }] }, "https://home.example/kitchen")).toEqual({ recipeId: "r_here", contentHash: null });
    // Without this Spoonjoy's own address, or from anywhere else, it is the other Spoonjoy's recipe.
    expect(spoonjoyRecipeDraft(back, ACCOUNT)).toMatchObject({ home: null, photoPath: "/photos/recipes/bread.jpg?v=2" });
    expect(homeOf(back, "https://other.example")).toBeNull();
    expect(homeOf({ ...bread, movedInFrom: [{ kind: "spoonjoy", serverUrl: 7, sourceKey: "r" }] }, "https://home.example")).toBeNull();
    expect([sameAddress("https://a.example/", "https://A.example"), sameAddress("not an address", "not an address"), sameAddress("https://a.example", "nope")]).toEqual([true, false, false]);
  });

  it("finds a photo only where the server keeps it, under /photos/", () => {
    const active = (cover: Json) => ({ covers: [{ active: true, ...cover }] });
    expect(photoPathOf(active({ imageUrl: "/photos/recipes/a.webp" }))).toBe("/photos/recipes/a.webp");
    // A stylized cover stands in when the original isn't kept.
    expect(photoPathOf(active({ imageUrl: null, stylizedImageUrl: "https://self.example/photos/s.webp" }))).toBe("/photos/s.webp");
    // A cover elsewhere on the internet isn't the server's to give, so the token never goes there.
    expect(photoPathOf(active({ imageUrl: "https://cdn.example.com/a.jpg" }))).toBe("");
    expect(photoPathOf(active({ imageUrl: "http://[broken" }))).toBe("");
    expect(photoPathOf(active({}))).toBe("");
    expect(photoPathOf({ covers: [{ active: false, imageUrl: "/photos/a.webp" }] })).toBe("");
    expect(photoPathOf({})).toBe("");
  });
});

describe("another Spoonjoy as a move-in source", () => {
  it("opens the token's kitchen from its export, oldest first, and leaves recipes deleted there behind", async () => {
    const { fetch, asked } = server(kitchenRoutes());
    const source = await spoonjoyApiSource({ address: "https://spoonjoy.app/", token: "sj_secret", fetch });
    expect(source).toMatchObject({ kind: SPOONJOY_SOURCE_KIND, serverUrl: "https://spoonjoy.app", version: "v1 (0123456789ab)" });
    expect(source.words.there).toBe("on your other Spoonjoy");
    expect(await source.chooseKitchen(null)).toBe(ACCOUNT);
    expect(await source.openKitchen("someone-else")).toBeNull();
    const kitchen = await source.openKitchen(ACCOUNT);
    if (!kitchen) throw new Error("expected the kitchen");
    expect(kitchen).toMatchObject({ key: ACCOUNT, name: "ada", size: 2 });
    expect([kitchen.entry(0), kitchen.entry(1)]).toEqual([
      { sourceKey: "r_bread", title: "Bread" },
      { sourceKey: "r_soup", title: "Recipe r_soup" },
    ]);
    expect(await kitchen.count()).toEqual({ photos: 1, tags: 2, categories: 1, tools: 1 });

    const draft = await kitchen.draft(0);
    expect(kitchen.hasPhoto(draft)).toBe(true);
    expect(await kitchen.readPhoto(draft)).toEqual(photo);
    expect(kitchen.hasPhoto(await kitchen.draft(1))).toBe(false);
    // The source read the export once to start, and that kitchen used it; the token went only to the address given.
    expect(asked.filter((call) => call.url.endsWith("/api/v1/me/export"))).toHaveLength(1);
    expect(asked.every((call) => call.url.startsWith("https://spoonjoy.app/") && call.authorization === "Bearer sj_secret" && call.redirect === "manual")).toBe(true);
  });

  it("reads the export again for each later kitchen, and keeps its place through recipes deleted or added meanwhile", async () => {
    const recipes = [exportedRecipe("r_b"), exportedRecipe("r_a"), exportedRecipe("r_c", { createdAt: "not a date" })];
    const routes = kitchenRoutes(recipes);
    const { fetch, asked } = server(routes);
    const source = await spoonjoyApiSource({ address: "https://cook.example", token: "t", fetch });
    const kitchen = await source.openKitchen(ACCOUNT);
    if (!kitchen) throw new Error("expected the kitchen");
    // A recipe with no date goes first; two with the same date go by key.
    expect([0, 1, 2].map((index) => kitchen.entry(index).sourceKey)).toEqual(["r_c", "r_a", "r_b"]);
    const marks = [0, 1, 2].map((index) => kitchen.mark?.(index) as string);
    expect(marks[1]).toBe(`${Date.parse("2026-11-01T10:00:00.000Z")}:r_a`);

    routes["/api/v1/me/export"] = exportOf([exportedRecipe("r_b"), exportedRecipe("r_c", { createdAt: "not a date" })]);
    const changed = await source.openKitchen(ACCOUNT);
    expect(asked.filter((call) => call.url.endsWith("/api/v1/me/export"))).toHaveLength(2);
    expect(marks.map((mark) => changed?.indexAfter?.(mark))).toEqual([1, 1, 2]);
  });

  it("names a kitchen with no username and a recipe with no name, and reads a version with no build", async () => {
    const routes = { ...kitchenRoutes(), "/api/v1/health": { ok: true, data: { version: "v1" } }, "/api/v1/me/export": exportOf([exportedRecipe("r_x", { title: " " })], { id: ACCOUNT }) };
    const source = await spoonjoyApiSource({ address: "https://cook.example", token: "t", fetch: server(routes).fetch });
    expect(source.version).toBe("v1");
    const kitchen = await source.openKitchen(ACCOUNT);
    expect(kitchen).toMatchObject({ name: "Kitchen", size: 1 });
    expect(kitchen?.entry(0)).toEqual({ sourceKey: "r_x", title: "Untitled recipe" });
  });

  it("calls an address that isn't a Spoonjoy a wrong address", async () => {
    for (const health of [undefined, null, { ok: true, data: { version: "v2" } }, { ok: false }, { ok: true, data: "v1" }, [1]]) {
      const routes = { ...kitchenRoutes(), "/api/v1/health": health };
      await expect(spoonjoyApiSource({ address: "https://recipes.example.com", token: "t", fetch: server(routes).fetch })).rejects.toMatchObject({ code: "server-address" });
    }
    await expect(spoonjoyApiSource({ address: "http://spoonjoy.app", token: "t", fetch: server(kitchenRoutes()).fetch })).rejects.toMatchObject({ code: "server-address" });
  });

  it("asks for a new token when the server refuses it, or has no account for it", async () => {
    const refused = server(kitchenRoutes(), { status: { "/api/v1/me/export": 403 } });
    await expect(spoonjoyApiSource({ address: "https://spoonjoy.app", token: "t", fetch: refused.fetch })).rejects.toMatchObject({ code: "server-token" });
    const invalid = server(kitchenRoutes(), { status: { "/api/v1/health": 401 } });
    await expect(spoonjoyApiSource({ address: "https://spoonjoy.app", token: "t", fetch: invalid.fetch })).rejects.toMatchObject({ code: "server-token" });
    for (const account of [{ username: "ada" }, undefined]) {
      const routes = { ...kitchenRoutes(), "/api/v1/me/export": { ok: true, data: { format: "spoonjoy.account-export.v1", account } } };
      await expect(spoonjoyApiSource({ address: "https://spoonjoy.app", token: "t", fetch: server(routes).fetch })).rejects.toMatchObject({ code: "server-token" });
    }
  });

  it("turns away an export in a format it doesn't read", async () => {
    for (const answer of [{ ok: true, data: { format: "spoonjoy.account-export.v2" } }, { ok: false }]) {
      const routes = { ...kitchenRoutes(), "/api/v1/me/export": answer };
      await expect(spoonjoyApiSource({ address: "https://spoonjoy.app", token: "t", fetch: server(routes).fetch })).rejects.toMatchObject({ code: "server-address" });
    }
    const routes = { ...kitchenRoutes(), "/api/v1/me/export": { ok: true, data: { format: "spoonjoy.account-export.v2" } } };
    await expect(spoonjoyApiSource({ address: "https://spoonjoy.app", token: "t", fetch: server(routes).fetch })).rejects.toMatchObject({ code: "server-address" });
  });

  it("passes on a server that can't be reached, for the queue to try again", async () => {
    const down: typeof globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(spoonjoyApiSource({ address: "https://spoonjoy.app", token: "t", fetch: down })).rejects.toBeInstanceOf(SourceUnavailableError);
  });

  it("fails a photo the server no longer has, or one it fails on while it still answers, against that recipe alone", async () => {
    const routes = kitchenRoutes();
    const { fetch } = server(routes, { status: { "/photos/recipes/broken.jpg": 500 } });
    const kitchen = await (await spoonjoyApiSource({ address: "https://spoonjoy.app", token: "t", fetch })).openKitchen(ACCOUNT);
    if (!kitchen) throw new Error("expected the kitchen");
    const draft = await kitchen.draft(0);
    await expect(kitchen.readPhoto({ ...draft, photoPath: "/photos/recipes/missing.jpg" })).rejects.toThrow("the server has no photo for this recipe");
    await expect(kitchen.readPhoto({ ...draft, photoPath: "/photos/recipes/broken.jpg" })).rejects.toThrow("couldn't give this one");
    routes["/photos/recipes/huge.jpg"] = new Uint8Array(21 * 1024 * 1024);
    await expect(kitchen.readPhoto({ ...draft, photoPath: "/photos/recipes/huge.jpg" })).rejects.toThrow("larger than 20 MB");
  });
});

describe("the apps a move-in reads from a server", () => {
  it("brings another Spoonjoy only from its server, and opens each server kind's own source", async () => {
    expect(MOVE_IN_APPS.spoonjoy).toEqual({ kind: null, serverKind: "spoonjoy-api" });
    expect(readsAServer("spoonjoy-api")).toBe(true);
    expect([moveInAppOf("spoonjoy-api"), moveInAppOf("mealie-api"), moveInAppOf("mealie-backup"), moveInAppOf("gone")]).toEqual(["spoonjoy", "mealie", "mealie", "mealie"]);
    const source = await openServerSource("spoonjoy-api", { address: "https://spoonjoy.app", token: "t", fetch: server(kitchenRoutes()).fetch });
    expect(source.kind).toBe(SPOONJOY_SOURCE_KIND);
  });

  it("ties a recipe moving back to its home here when it knows this Spoonjoy's address", async () => {
    const back = { ...bread, movedInFrom: [{ kind: "spoonjoy", serverUrl: "https://home.example", sourceKey: "r_here", contentHash: null }] };
    const source = await openServerSource("spoonjoy-api", { address: "https://spoonjoy.app", token: "t", fetch: server(kitchenRoutes([back])).fetch }, "https://home.example");
    const kitchen = (await source.openKitchen(ACCOUNT))!;
    const draft = await kitchen.draft(0);
    expect(draft.home).toEqual({ recipeId: "r_here", contentHash: null });
  });
});
