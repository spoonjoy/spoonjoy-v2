// @vitest-environment node
// The cookbook pages' writes when D1's connection drops: creating, renaming, saving a recipe,
// taking one out and deleting each end with the rows of one clean submit, and answer a retryable
// 503 the page shows, instead of a 500 or a title conflict, when D1 stays unreachable.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { D1_WRITE_UNAVAILABLE_CODE, D1_WRITE_UNAVAILABLE_MESSAGE, idForWriteToken } from "~/lib/d1-write-retry.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { flakyD1, type FlakyOutcome } from "../helpers/flaky-d1";
import { flakyPrisma, type FlakyPrisma } from "../helpers/flaky-prisma";
import { createTestRecipe, createTestUser } from "../utils";

const spies = vi.hoisted(() => ({ requestDb: null as null | (() => Promise<unknown>) }));

vi.mock("~/lib/route-platform.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/route-platform.server")>();
  return {
    ...actual,
    getRequestDb: vi.fn((context: never) => (spies.requestDb ? spies.requestDb() : actual.getRequestDb(context))),
  };
});

const { action: createAction } = await import("~/routes/cookbooks.new");
const { action: cookbookAction } = await import("~/routes/cookbooks.$id");

const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];
const TOKEN = "cookbook-token-0001";

let db: PrismaClient;
let d1: SqliteD1;
let userId: string;
let cookie: string;
let cookbookId: string;
let recipeId: string;

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
  d1 = sqliteD1();
  spies.requestDb = null;
  userId = (await db.user.create({ data: createTestUser() })).id;
  cookie = (await createUserSessionCookie(userId)).split(";")[0]!;
  cookbookId = (await db.cookbook.create({ data: { title: "Weeknights", authorId: userId } })).id;
  recipeId = (await db.recipe.create({ data: createTestRecipe(userId) })).id;
});

afterEach(async () => {
  d1.close();
  await cleanupDatabase();
});

function useFlakyPrisma(): FlakyPrisma {
  const flaky = flakyPrisma(db);
  spies.requestDb = async () => flaky.db;
  return flaky;
}

function request(path: string, fields: Record<string, string>) {
  const form = new UndiciFormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new UndiciRequest(`http://localhost:3000${path}`, { method: "POST", headers: { Cookie: cookie }, body: form });
}

async function create(fields: Record<string, string>) {
  return createAction({ request: request("/cookbooks/new", fields), context: { cloudflare: { env: null } }, params: {} } as never);
}

async function act(fields: Record<string, string>, env: Record<string, unknown> | null = null) {
  return cookbookAction({
    request: request(`/cookbooks/${cookbookId}`, fields),
    context: { cloudflare: { env } },
    params: { id: cookbookId },
  } as never);
}

function answer(result: unknown) {
  const value = result as { type?: string; data?: unknown; init?: { status?: number; headers?: HeadersInit } } | Response;
  if (value instanceof Response) return { status: value.status, location: value.headers.get("Location") };
  const headers = new Headers(value.init?.headers);
  return { status: value.init?.status ?? 200, data: value.data, retryAfter: headers.get("Retry-After") };
}

const unavailable = (intent: string) => ({
  status: 503,
  retryAfter: "1",
  data: { intent, error: D1_WRITE_UNAVAILABLE_MESSAGE, errorCode: D1_WRITE_UNAVAILABLE_CODE, retryable: true },
});

describe("creating a cookbook", () => {
  it.each(OUTCOMES)("makes one cookbook, at the form token's id, when the create is %s", async (outcome) => {
    const flaky = useFlakyPrisma();
    flaky.failNext("cookbook", "create", outcome);
    const expectedId = await idForWriteToken("cookbook", userId, TOKEN);

    const result = answer(await create({ title: " Sunday ", cookbookToken: TOKEN }));

    expect(flaky.failures()).toBe(1);
    expect(result).toEqual({ status: 302, location: `/cookbooks/${expectedId}` });
    expect(await db.cookbook.findMany({ where: { title: "Sunday" }, select: { id: true } })).toEqual([{ id: expectedId }]);
  });

  it("answers a retryable 503 when every try is lost, and the resubmit makes the cookbook once", async () => {
    const flaky = useFlakyPrisma();
    flaky.failNext("cookbook", "create", "lost", "lost", "lost", "lost");
    const expectedId = await idForWriteToken("cookbook", userId, TOKEN);

    expect(answer(await create({ title: "Sunday", cookbookToken: TOKEN }))).toEqual({
      status: 503,
      retryAfter: "1",
      data: { errors: { general: D1_WRITE_UNAVAILABLE_MESSAGE }, errorCode: D1_WRITE_UNAVAILABLE_CODE, retryable: true },
    });
    expect(await db.cookbook.count({ where: { title: "Sunday" } })).toBe(0);

    // The resubmit carries the same token: it makes the cookbook, and a double tap after it goes
    // to that cookbook instead of answering a title conflict.
    expect(answer(await create({ title: "Sunday", cookbookToken: TOKEN }))).toEqual({ status: 302, location: `/cookbooks/${expectedId}` });
    expect(answer(await create({ title: "Sunday", cookbookToken: TOKEN }))).toEqual({ status: 302, location: `/cookbooks/${expectedId}` });
    expect(await db.cookbook.findMany({ where: { title: "Sunday" }, select: { id: true } })).toEqual([{ id: expectedId }]);
  });

  it("still answers a title the chef already uses as a 400, and creates without a token", async () => {
    expect(answer(await create({ title: "Weeknights", cookbookToken: TOKEN }))).toEqual({
      status: 400,
      retryAfter: null,
      data: { errors: { title: "You already have a cookbook with this title" } },
    });
    const made = answer(await create({ title: "Brunch", cookbookToken: "bad token!" }));
    const brunch = await db.cookbook.findFirstOrThrow({ where: { title: "Brunch" } });
    expect(made).toEqual({ status: 302, location: `/cookbooks/${brunch.id}` });
  });
});

describe("renaming a cookbook", () => {
  it.each(OUTCOMES)("renames it when the update is %s", async (outcome) => {
    const flaky = useFlakyPrisma();
    flaky.failNext("cookbook", "update", outcome);

    const result = answer(await act({ intent: "updateTitle", title: "Fridays" }));

    expect(flaky.failures()).toBe(1);
    expect(result).toEqual({ status: 200, retryAfter: null, data: { success: true, intent: "updateTitle" } });
    expect((await db.cookbook.findUniqueOrThrow({ where: { id: cookbookId } })).title).toBe("Fridays");
  });

  it("answers a retryable 503 for the title editor when every try is lost", async () => {
    const flaky = useFlakyPrisma();
    flaky.failNext("cookbook", "update", "lost", "lost", "lost", "lost");

    expect(answer(await act({ intent: "updateTitle", title: "Fridays" }))).toEqual(unavailable("updateTitle"));
    expect((await db.cookbook.findUniqueOrThrow({ where: { id: cookbookId } })).title).toBe("Weeknights");
  });
});

describe("saving, removing and deleting when D1 stays unreachable", () => {
  // The page's checks read through the local Prisma client; the writes go to the flaky binding.
  beforeEach(() => {
    spies.requestDb = async () => db;
  });

  it("answers a retryable 503 for saving a recipe, which is not saved", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(/INSERT INTO "RecipeInCookbook"/, "lost", "lost", "lost", "lost");

    expect(answer(await act({ intent: "addRecipe", recipeId }, { DB: flaky.binding }))).toEqual(unavailable("addRecipe"));
    expect(await db.recipeInCookbook.count()).toBe(0);
  });

  it("answers a retryable 503 for taking a recipe out, which stays in", async () => {
    const membership = await db.recipeInCookbook.create({ data: { cookbookId, recipeId, addedById: userId } });
    const flaky = flakyD1(d1.binding);
    flaky.failNext(/DELETE FROM "RecipeInCookbook"/, "lost", "lost", "lost", "lost");

    expect(answer(await act({ intent: "removeRecipe", recipeInCookbookId: membership.id }, { DB: flaky.binding })))
      .toEqual(unavailable("removeRecipe"));
    expect(await db.recipeInCookbook.count()).toBe(1);
  });

  it("answers a retryable 503 for deleting, and the cookbook stays", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(/INSERT INTO "NativeSyncTombstone"/, "lost", "lost", "lost", "lost");

    expect(answer(await act({ intent: "delete" }, { DB: flaky.binding }))).toEqual(unavailable("delete"));
    expect(await db.cookbook.count({ where: { id: cookbookId } })).toBe(1);
  });
});
