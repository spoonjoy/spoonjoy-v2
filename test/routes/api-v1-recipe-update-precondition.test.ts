// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Request as UndiciRequest } from "undici";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// PATCH /api/v1/recipes/{id} with an optional expectedUpdatedAt precondition. Before, two
// editors (the web page and the app, or two devices) could each load a recipe and save, and the
// later save silently overwrote the earlier one. With the precondition, the stale save is
// answered 409 edit_conflict with the recipe as it is now, and nothing is written. Without it the
// update applies as before.

const mocked = vi.hoisted(() => ({ db: null as PrismaClient | null }));

vi.mock("~/lib/route-platform.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/route-platform.server")>();
  return {
    ...actual,
    getRequestDb: vi.fn(async () => {
      if (!mocked.db) throw new Error("test db was not configured");
      return mocked.db;
    }),
  };
});

const { action } = await import("~/routes/api.v1.$");

let db: PrismaClient;
let d1: SqliteD1;
let token: string;
let recipeId: string;

const LOADED = new Date("2026-03-01T10:00:00.123Z");
const LATER = new Date("2026-03-01T10:05:00.456Z");

type Binding = { prepare: SqliteD1["binding"]["prepare"]; batch: SqliteD1["binding"]["batch"] } | null;

async function patch(body: Record<string, unknown>, DB: Binding = null) {
  const response = await action({
    request: new UndiciRequest(`http://localhost/api/v1/recipes/${recipeId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as unknown as Request,
    params: { "*": `recipes/${recipeId}` },
    context: { cloudflare: { env: DB ? { DB } : null } },
  } as never);
  return { status: response.status, payload: await response.json() as Record<string, any> };
}

async function current() {
  return db.recipe.findUniqueOrThrow({ where: { id: recipeId }, select: { title: true, servings: true, updatedAt: true } });
}

/** Someone else's save: the title changes and updatedAt moves on. */
async function otherEditorSaves() {
  await db.recipe.update({ where: { id: recipeId }, data: { title: "Their Title", updatedAt: LATER } });
}

describe.each([
  ["Prisma", () => null],
  ["a D1 binding", () => d1.binding],
] as const)("PATCH /api/v1/recipes/{id} expectedUpdatedAt on %s", (_label, binding) => {
  beforeEach(async () => {
    db = await getLocalDb();
    mocked.db = db;
    await cleanupDatabase();
    d1 = sqliteD1();
    const chef = await db.user.create({ data: createTestUser() });
    token = (await createApiCredential(db, chef.id, "precondition writer", { scopes: ["kitchen:write"] })).token;
    recipeId = (await db.recipe.create({ data: { title: "My Title", servings: "2", chefId: chef.id } })).id;
    await db.recipe.update({ where: { id: recipeId }, data: { updatedAt: LOADED } });
  });

  afterEach(async () => {
    mocked.db = null;
    d1.close();
    await cleanupDatabase();
  });

  it("applies the update when the recipe is unchanged since expectedUpdatedAt", async () => {
    const answer = await patch({ clientMutationId: "fresh", title: "My Better Title", expectedUpdatedAt: LOADED.toISOString() }, binding());

    expect(answer.status).toBe(200);
    expect(answer.payload.data.recipe.title).toBe("My Better Title");
    expect((await current()).updatedAt.getTime()).toBeGreaterThan(LOADED.getTime());
  });

  it("answers 409 edit_conflict with the current recipe, and writes nothing, when the recipe changed since", async () => {
    await otherEditorSaves();

    const answer = await patch({ clientMutationId: "stale", servings: "8", expectedUpdatedAt: LOADED.toISOString() }, binding());

    expect(answer.status).toBe(409);
    expect(answer.payload).toMatchObject({
      ok: false,
      error: {
        code: "edit_conflict",
        status: 409,
        message: "The recipe changed after expectedUpdatedAt; nothing was updated",
        details: {
          reason: "recipe_changed",
          expectedUpdatedAt: LOADED.toISOString(),
          currentUpdatedAt: LATER.toISOString(),
          recipe: { id: recipeId, title: "Their Title", servings: "2", updatedAt: LATER.toISOString() },
        },
      },
    });
    expect(await current()).toEqual({ title: "Their Title", servings: "2", updatedAt: LATER });

    // The client merges and retries, with the same mutation id, from the recipe it was given.
    const retry = await patch({ clientMutationId: "stale", servings: "8", expectedUpdatedAt: answer.payload.error.details.currentUpdatedAt }, binding());
    expect(retry.status).toBe(200);
    expect(await current()).toMatchObject({ title: "Their Title", servings: "8" });
  });

  it("updates as before when the client sends no expectedUpdatedAt", async () => {
    await otherEditorSaves();

    const answer = await patch({ clientMutationId: "legacy", title: "Last Write Wins" }, binding());

    expect(answer.status).toBe(200);
    expect((await current()).title).toBe("Last Write Wins");
  });

  it.each([["not a date"], ["2026-13-45T99:00:00Z"], [1700000000000], [null]])("rejects expectedUpdatedAt %j", async (value) => {
    const answer = await patch({ clientMutationId: "invalid", title: "Nope", expectedUpdatedAt: value }, binding());

    expect(answer.status).toBe(400);
    expect(answer.payload.error).toMatchObject({
      code: "validation_error",
      details: { fieldErrors: { expectedUpdatedAt: "expectedUpdatedAt must be the recipe's updatedAt, an ISO 8601 date-time" } },
    });
    expect((await current()).title).toBe("My Title");
  });
});

describe("PATCH /api/v1/recipes/{id} expectedUpdatedAt when another save lands during the write", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    mocked.db = db;
    await cleanupDatabase();
    d1 = sqliteD1();
    const chef = await db.user.create({ data: createTestUser() });
    token = (await createApiCredential(db, chef.id, "precondition writer", { scopes: ["kitchen:write"] })).token;
    recipeId = (await db.recipe.create({ data: { title: "My Title", servings: "2", chefId: chef.id } })).id;
    await db.recipe.update({ where: { id: recipeId }, data: { updatedAt: LOADED } });
  });

  afterEach(async () => {
    mocked.db = null;
    d1.close();
    await cleanupDatabase();
  });

  it("stops the D1 batch and answers 409 when the other save lands between the check and the batch", async () => {
    let raced = false;
    const racing = {
      prepare: (sql: string) => d1.binding.prepare(sql),
      async batch(statements: never) {
        if (!raced) {
          raced = true;
          await otherEditorSaves();
        }
        return d1.binding.batch(statements);
      },
    };

    const answer = await patch({ clientMutationId: "raced", servings: "8", expectedUpdatedAt: LOADED.toISOString() }, racing);

    expect(raced).toBe(true);
    expect(answer.status).toBe(409);
    expect(answer.payload.error).toMatchObject({ code: "edit_conflict", details: { currentUpdatedAt: LATER.toISOString() } });
    expect(await current()).toEqual({ title: "Their Title", servings: "2", updatedAt: LATER });
  });

  it("compares updatedAt written by the D1 paths (ISO text) as the same instant", async () => {
    await d1.binding.prepare(`UPDATE "Recipe" SET "updatedAt" = ? WHERE "id" = ?`).bind("2026-03-01T10:00:00.123+00:00", recipeId).run();

    const answer = await patch({ clientMutationId: "iso", title: "ISO Title", expectedUpdatedAt: LOADED.toISOString() }, d1.binding);

    expect(answer.status).toBe(200);
    expect((await current()).title).toBe("ISO Title");
  });
});
