// D1 refuses a LIKE pattern over 50 bytes, and Prisma's contains sends LIKE '%query%'. The test
// database refuses one too (test/helpers/d1-like.ts), so each search here fails as it did on D1
// unless it narrows a long query to a prefix and checks the full query in code.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { loader } from "~/routes/api.v1.$";
import { getLocalDb } from "~/lib/db.server";
import { callSpoonjoyMcpTool } from "~/lib/mcp/spoonjoy-tools.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../utils";

// 60 bytes, so contains would send a 62-byte pattern.
const LONG = "Slow Roasted Tomato and Fennel Soup with Basil Oil Croutons!";
// The same first 48 bytes, then different.
const SAME_START = "Slow Roasted Tomato and Fennel Soup with Basil Oil Dumplings";

type Db = Awaited<ReturnType<typeof getLocalDb>>;
type Listed = {
  query: string | null;
  hasMore: boolean;
  nextCursor: string | null;
  recipes: Array<{ id: string }>;
  cookbooks: Array<{ id: string }>;
};

async function listed(response: Response): Promise<Listed> {
  return ((await response.json()) as { data: Listed }).data;
}

function apiGet(path: string, splat: string) {
  return loader({
    request: new UndiciRequest(`http://localhost${path}`, { headers: { "X-Request-Id": "req_long_query" } }) as unknown as Request,
    params: { "*": splat },
    context: { cloudflare: { env: null } },
  } as never);
}

let made = 0;
// Each a minute after the last, so the API's oldest-first order is the order they were made.
async function recipe(db: Db, chefId: string, title: string, description: string | null = null) {
  made += 1;
  return db.recipe.create({ data: { ...createTestRecipe(chefId), title, description, createdAt: new Date(Date.UTC(2026, 0, 1, 0, made)) } });
}

describe("searches with a query longer than D1's LIKE allows", () => {
  let db: Db;

  beforeEach(async () => {
    expect(new TextEncoder().encode(LONG).length).toBe(60);
    expect(LONG.slice(0, 48)).toBe(SAME_START.slice(0, 48));
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("finds recipes by title or description in the API, as LIKE would, and pages them", async () => {
    const chef = await db.user.create({ data: createTestUser() });
    const byTitle = await recipe(db, chef.id, `My ${LONG.toLowerCase()}`);
    const byDescription = await recipe(db, chef.id, "Winter soup", `Our ${LONG} for cold nights`);
    const third = await recipe(db, chef.id, `${LONG} again`);
    await recipe(db, chef.id, SAME_START, SAME_START);
    await recipe(db, chef.id, "Plain rice");

    const first = await apiGet(`/api/v1/recipes?q=${encodeURIComponent(LONG)}&limit=2`, "recipes");
    expect(first.status).toBe(200);
    const page = await listed(first);
    expect(page).toMatchObject({ query: LONG, hasMore: true });
    expect(page.recipes.map((found) => found.id)).toEqual([byTitle.id, byDescription.id]);

    const next = await apiGet(`/api/v1/recipes?q=${encodeURIComponent(LONG)}&limit=2&cursor=${encodeURIComponent(page.nextCursor ?? "")}`, "recipes");
    const rest = await listed(next);
    expect(rest).toMatchObject({ hasMore: false, nextCursor: null });
    expect(rest.recipes.map((found) => found.id)).toEqual([third.id]);
  });

  it("finds cookbooks by title or author in the API", async () => {
    const chef = await db.user.create({ data: createTestUser() });
    const titled = await db.cookbook.create({ data: { title: `${LONG} collection`, authorId: chef.id } });
    await db.cookbook.create({ data: { title: SAME_START, authorId: chef.id } });

    const response = await apiGet(`/api/v1/cookbooks?q=${encodeURIComponent(LONG)}&limit=5`, "cookbooks");
    expect(response.status).toBe(200);
    const data = await listed(response);
    expect(data.cookbooks.map((found) => found.id)).toEqual([titled.id]);

    // A username is at most 30 characters in the product, but the search must not fail on one that is longer.
    const longName = `${"cook".repeat(13)}_x`;
    const author = await db.user.create({ data: { ...createTestUser(), username: longName } });
    const authored = await db.cookbook.create({ data: { title: "Sunday", authorId: author.id } });
    const byAuthor = await apiGet(`/api/v1/cookbooks?q=${longName.toUpperCase()}&limit=5`, "cookbooks");
    expect((await listed(byAuthor)).cookbooks.map((found) => found.id)).toEqual([authored.id]);
  });

  it("finds the cook's cookbooks by title through MCP, keeping the limit", async () => {
    const context = { db, defaultOwnerEmail: "long-query-cook@example.test" };
    await callSpoonjoyMcpTool("create_cookbook", { title: `${LONG} one` }, context);
    await callSpoonjoyMcpTool("create_cookbook", { title: `${LONG} two` }, context);
    await callSpoonjoyMcpTool("create_cookbook", { title: SAME_START }, context);

    const all = JSON.parse(await callSpoonjoyMcpTool("list_cookbooks", { query: LONG.toLowerCase() }, context));
    expect(all.cookbooks.map((cookbook: { title: string }) => cookbook.title).sort()).toEqual([`${LONG} one`, `${LONG} two`]);

    const one = JSON.parse(await callSpoonjoyMcpTool("list_cookbooks", { query: LONG, limit: 1 }, context));
    expect(one.cookbooks).toHaveLength(1);
  });
});
