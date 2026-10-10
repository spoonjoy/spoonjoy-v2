// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";

// The request's Prisma client, counted: with a D1 binding the fork must not build one until the
// background notification runs.
const platform = vi.hoisted(() => ({ getRequestDb: vi.fn() }));
vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: platform.getRequestDb,
}));

import { action } from "~/routes/recipes.$id.fork";

const VAPID_ENV = {
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv",
  VAPID_SUBJECT: "mailto:test@example.com",
};

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

async function makeChef(prefix: string) {
  return createUser(db, `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`, `${prefix}_${faker.string.alphanumeric(8).toLowerCase()}`, "testPassword123");
}

describe("recipes.$id.fork action on a D1 binding", () => {
  let d1: SqliteD1;
  let ownerId: string;
  let forkerId: string;
  let recipeId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    platform.getRequestDb.mockReset();
    platform.getRequestDb.mockImplementation(async () => db);
    d1 = sqliteD1();
    ownerId = (await makeChef("owner")).id;
    forkerId = (await makeChef("forker")).id;
    recipeId = (await db.recipe.create({ data: { title: "Bread", chefId: ownerId } })).id;
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  async function fork(userId: string, options: { token?: string; id?: string; scheduled?: Promise<unknown>[] } = {}) {
    const body = new UndiciFormData();
    if (options.token) body.append("forkToken", options.token);
    const id = options.id ?? recipeId;
    return action({
      request: new UndiciRequest(`http://localhost/recipes/${id}/fork`, {
        method: "POST",
        headers: { cookie: await sessionCookie(userId) },
        body,
      }) as unknown as Request,
      params: { id },
      context: {
        cloudflare: {
          env: { ...VAPID_ENV, DB: d1.binding },
          ...(options.scheduled ? { ctx: { waitUntil: (p: Promise<unknown>) => options.scheduled!.push(p) } } : {}),
        },
      } as never,
    } as never) as Promise<Response>;
  }

  it("forks once per form token even when Prisma never answers", async () => {
    // A Prisma client stuck as in a hung isolate: the fork must not wait on it.
    platform.getRequestDb.mockImplementation(() => new Promise(() => {}));
    const scheduled: Promise<unknown>[] = [];

    const first = await fork(forkerId, { token: "fork-token-1", scheduled });
    expect(first.status).toBe(302);
    const location = first.headers.get("Location")!;
    expect(location).toMatch(/^\/recipes\/[\w-]+$/);

    const repeat = await fork(forkerId, { token: "fork-token-1", scheduled });
    expect(repeat.headers.get("Location")).toBe(location);
    expect(await db.recipe.count({ where: { chefId: forkerId, sourceRecipeId: recipeId } })).toBe(1);

    // Without a token, each post forks, at the next free title.
    await fork(forkerId, { scheduled });
    const titles = (await db.recipe.findMany({ where: { chefId: forkerId }, select: { title: true } })).map((r) => r.title).sort();
    expect(titles).toEqual(["Bread", "Bread (variation 2)"]);
    // Only the background notifications asked for a client.
    expect(platform.getRequestDb).toHaveBeenCalledTimes(2);
  });

  it("notifies the source chef from the background task", async () => {
    const scheduled: Promise<unknown>[] = [];
    await fork(forkerId, { token: "fork-token-3", scheduled });

    await Promise.all(scheduled);
    const events = await db.notificationEvent.findMany({ where: { recipientId: ownerId, kind: "fork_of_my_recipe" } });
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].payload)).toMatchObject({ sourceRecipeId: recipeId, recipeTitle: "Bread" });
  });

  it("awaits the notification inline without waitUntil, and skips it on a self-fork", async () => {
    await fork(forkerId);
    expect(await db.notificationEvent.count({ where: { recipientId: ownerId } })).toBe(1);

    await fork(ownerId);
    expect(await db.notificationEvent.count()).toBe(1);
  });

  it("answers 404 for a missing or deleted source", async () => {
    await expect(fork(forkerId, { id: "missing-recipe", token: "fork-token-2" })).rejects.toMatchObject({ status: 404 });
    await db.recipe.update({ where: { id: recipeId }, data: { deletedAt: new Date() } });
    await expect(fork(forkerId)).rejects.toMatchObject({ status: 404 });
    expect(platform.getRequestDb).not.toHaveBeenCalled();
    // The failed fork forgot its key, so nothing is left reserved.
    expect(await db.apiIdempotencyKey.count()).toBe(0);
  });
});
