// Reports and blocks through API v1 (App Store guideline 1.2): the endpoints' error and
// notification branches, and what a block or a report hides from every read.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { expectConsoleError } from "../warning-policy";
import { createTestRecipe, createTestUser } from "../utils";

type Db = Awaited<ReturnType<typeof getLocalDb>>;

describe("API v1 moderation", () => {
  let db: Db;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  function call(token: string, method: string, path: string, body?: unknown, ctx?: unknown) {
    const request = new UndiciRequest(`http://localhost/api/v1/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Request-Id": "req_moderation",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as Request;
    const args = {
      request,
      params: { "*": path.split("?")[0] },
      context: { cloudflare: { env: { NODE_ENV: "production", SPOONJOY_BASE_URL: "https://spoonjoy.app" }, ...(ctx ? { ctx } : {}) } },
    } as never;
    return method === "GET" ? loader(args) : action(args);
  }

  async function json(response: Response) {
    return { status: response.status, body: (await response.json()) as any };
  }

  async function chefWithToken() {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Moderation", {
      scopes: ["kitchen:read", "kitchen:write", "account:read", "account:write"],
    });
    return { user, token: credential.token };
  }

  it("files a report, returns the open one again, and refuses bad ones", async () => {
    const { token } = await chefWithToken();
    const author = await db.user.create({ data: createTestUser() });
    const recipe = await db.recipe.create({ data: createTestRecipe(author.id) });
    const waitUntil = vi.fn();
    const report = { targetType: "recipe", targetId: recipe.id, reason: "offensive", details: "slurs" };

    const created = await json(await call(token, "POST", "reports", report, { waitUntil }));
    expect(created.status).toBe(201);
    expect(created.body.data.report).toEqual({ id: expect.any(String), status: "open" });
    expect(waitUntil).toHaveBeenCalled();

    const again = await json(await call(token, "POST", "reports", report));
    expect(again.status).toBe(200);
    expect(again.body.data.report.id).toBe(created.body.data.report.id);

    expect((await json(await call(token, "POST", "reports", { ...report, targetId: "missing" }))).status).toBe(404);
    expect((await json(await call(token, "POST", "reports", { ...report, reason: "meh" }))).body.error.code).toBe("validation_error");
    expect((await json(await call(token, "POST", "reports", { ...report, extra: 1 }))).status).toBe(400);
  });

  it("names the reporter by id when the account row is gone", async () => {
    const { token, user } = await chefWithToken();
    const author = await db.user.create({ data: createTestUser() });
    const findUnique = db.user.findUnique.bind(db.user);
    vi.spyOn(db.user, "findUnique").mockImplementation(((query: { where: { id?: string }; select?: Record<string, boolean> }) =>
      query.where.id === user.id && query.select?.username && Object.keys(query.select).length === 1
        ? Promise.resolve(null)
        : findUnique(query as never)) as never);
    const response = await call(token, "POST", "reports", { targetType: "chef", targetId: author.id, reason: "spam" });
    expect(response.status).toBe(201);
  });

  it("refuses an objectionable cookbook title, and rethrows unexpected report failures", async () => {
    const { token } = await chefWithToken();
    const refused = await json(await call(token, "POST", "cookbooks", { clientMutationId: "m1", title: "porn" }));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatchObject({ code: "validation_error", message: expect.stringContaining("community rules") });

    const author = await db.user.create({ data: createTestUser() });
    const down = new Error("D1 down");
    down.stack = "Error: D1 down";
    vi.spyOn(db.contentReport, "create").mockRejectedValueOnce(down);
    expectConsoleError("[api-v1] internal_error", {
      requestId: "req_moderation",
      method: "POST",
      path: "/api/v1/reports",
      error: { name: "Error", message: "D1 down", stack: "Error: D1 down" },
    });
    const failed = await call(token, "POST", "reports", { targetType: "chef", targetId: author.id, reason: "spam" });
    expect(failed.status).toBe(500);
  });

  it("blocks, lists and unblocks chefs", async () => {
    const { token, user } = await chefWithToken();
    const other = await db.user.create({ data: { ...createTestUser(), photoUrl: "/photos/profiles/o/a.jpg" } });

    const blocked = await json(await call(token, "POST", "blocks", { chefId: other.id }));
    expect(blocked.status).toBe(200);
    expect(blocked.body.data.block.chef).toEqual({ id: other.id, username: other.username, photoUrl: "https://spoonjoy.app/photos/profiles/o/a.jpg" });

    const list = await json(await call(token, "GET", "blocks"));
    expect(list.body.data.blocks.map((block: any) => block.chef.id)).toEqual([other.id]);

    expect((await json(await call(token, "POST", "blocks", { chefId: user.id }))).status).toBe(400);
    expect((await json(await call(token, "POST", "blocks", { chefId: "missing" }))).status).toBe(404);

    expect((await json(await call(token, "DELETE", `blocks/${other.id}`))).body.data).toEqual({ unblocked: true });
    expect((await json(await call(token, "GET", "blocks"))).body.data.blocks).toEqual([]);
  });

  it("hides blocked chefs and reported content from every read", async () => {
    const { token, user: viewer } = await chefWithToken();
    const blocked = await db.user.create({ data: createTestUser() });
    const reported = await db.user.create({ data: createTestUser() });
    const blockedRecipe = await db.recipe.create({ data: { ...createTestRecipe(blocked.id), title: "Blocked Stew" } });
    const badRecipe = await db.recipe.create({ data: { ...createTestRecipe(reported.id), title: "Reported Pie" } });
    const goodRecipe = await db.recipe.create({ data: { ...createTestRecipe(reported.id), title: "Fine Bread" } });
    const viewerRecipe = await db.recipe.create({ data: { ...createTestRecipe(viewer.id), title: "Viewer Soup" } });
    const blockedBook = await db.cookbook.create({ data: { title: "Blocked Book", authorId: blocked.id } });
    const badBook = await db.cookbook.create({ data: { title: "Reported Book", authorId: reported.id } });
    const goodBook = await db.cookbook.create({ data: { title: "Fine Book", authorId: reported.id } });
    const now = new Date();
    await db.recipeSpoon.create({ data: { recipeId: viewerRecipe.id, chefId: blocked.id, cookedAt: now } });
    await db.recipeSpoon.create({ data: { recipeId: blockedRecipe.id, chefId: viewer.id, cookedAt: now } });
    const badSpoon = await db.recipeSpoon.create({ data: { recipeId: viewerRecipe.id, chefId: reported.id, cookedAt: now } });
    const goodSpoon = await db.recipeSpoon.create({ data: { recipeId: goodRecipe.id, chefId: reported.id, cookedAt: now } });

    await call(token, "POST", "blocks", { chefId: blocked.id });
    for (const [targetType, targetId] of [["recipe", badRecipe.id], ["cookbook", badBook.id], ["spoon", badSpoon.id]] as const) {
      expect((await call(token, "POST", "reports", { targetType, targetId, reason: "offensive" })).status).toBe(201);
    }

    const recipes = await json(await call(token, "GET", "recipes?limit=50"));
    const titles = recipes.body.data.recipes.map((recipe: any) => recipe.title);
    expect(titles).toContain("Fine Bread");
    expect(titles).not.toContain("Blocked Stew");
    expect(titles).not.toContain("Reported Pie");

    expect((await call(token, "GET", `recipes/${blockedRecipe.id}`)).status).toBe(404);
    expect((await call(token, "GET", `recipes/${badRecipe.id}`)).status).toBe(404);
    expect((await call(token, "GET", `recipes/${goodRecipe.id}`)).status).toBe(200);

    const spoons = await json(await call(token, "GET", `recipes/${viewerRecipe.id}/spoons`));
    expect(spoons.body.data.spoons).toEqual([]);

    const cookbooks = await json(await call(token, "GET", "cookbooks?limit=50"));
    const bookTitles = cookbooks.body.data.cookbooks.map((cookbook: any) => cookbook.title);
    expect(bookTitles).toContain("Fine Book");
    expect(bookTitles).not.toContain("Blocked Book");
    expect(bookTitles).not.toContain("Reported Book");
    expect((await call(token, "GET", `cookbooks/${blockedBook.id}`)).status).toBe(404);
    expect((await call(token, "GET", `cookbooks/${goodBook.id}`)).status).toBe(200);

    expect((await call(token, "GET", `users/${blocked.username}`)).status).toBe(404);
    expect((await call(token, "GET", `users/${blocked.username}/fellow-chefs`)).status).toBe(404);
    const profile = await json(await call(token, "GET", `users/${reported.username}`));
    expect(profile.status).toBe(200);
    expect(JSON.stringify(profile.body.data)).not.toContain("Reported Pie");
    expect(JSON.stringify(profile.body.data)).not.toContain("Reported Book");
    expect(JSON.stringify(profile.body.data)).toContain(goodSpoon.id);

    const graph = await json(await call(token, "GET", `users/${viewer.username}/kitchen-visitors`));
    expect(graph.body.data.rows.map((row: any) => row.chefId)).toEqual([reported.id]);

    const native = await json(await call(token, "GET", "me/chefs"));
    const chefIds = (rows: any[]) => rows.map((row) => row.chefId);
    expect(chefIds(native.body.data.fellowChefs.rows)).not.toContain(blocked.id);
    expect(chefIds(native.body.data.chefsUsingMyRecipes.rows)).toEqual([reported.id]);
    expect(native.body.data.activity.map((row: any) => row.otherChef.id)).not.toContain(blocked.id);
  });
});
