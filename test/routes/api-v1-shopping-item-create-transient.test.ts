import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { d1WriteOnceKey } from "~/lib/d1-write-once.server";
import { putShoppingListItemOnceOnD1 } from "~/lib/shopping-list-d1-actions.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { flakyD1, type FlakyOutcome } from "../helpers/flaky-d1";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser, getOrCreateIngredientRef } from "../utils";

// POST /api/v1/shopping-list/items on D1 when D1's connection drops. Quantities add up, so a
// retry, in the request or the client's resubmit of the same mutation after a 503, must add once.

const mocked = vi.hoisted(() => ({ db: null as PrismaClientType | null }));

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

const ADD_BATCH = /INSERT INTO "ShoppingListItem"/;
const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("API v1 shopping item create on D1 when its connection drops", () => {
  let db: PrismaClientType;
  let d1: SqliteD1;
  let token: string;
  let userId: string;
  let listId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    mocked.db = db;
    d1 = sqliteD1();
    const user = await db.user.create({ data: createTestUser() });
    userId = user.id;
    token = (await createApiCredential(db, user.id, "Shopping retry", { scopes: ["shopping_list:write"] })).token;
    listId = (await db.shoppingList.create({ data: { authorId: user.id } })).id;
  });

  afterEach(async () => {
    d1.close();
    mocked.db = null;
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  function add(binding: unknown, clientMutationId: string, quantity = 2) {
    return action({
      request: new UndiciRequest("http://localhost/api/v1/shopping-list/items", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ clientMutationId, name: "Lemons", quantity }),
      }) as unknown as Request,
      params: { "*": "shopping-list/items" },
      context: { cloudflare: { env: { DB: binding } } },
    } as any);
  }

  async function lemons() {
    return db.shoppingListItem.findMany({ where: { shoppingListId: listId }, include: { ingredientRef: true } });
  }

  it("creates the item with an id derived from the mutation, then adds a second mutation to it", async () => {
    const first = await add(d1.binding, "lemons-1");
    expect(first.status).toBe(201);
    const created = (await first.json()).data;
    expect(created).toMatchObject({ created: true, updated: false, item: { quantity: 2 } });
    expect(created.item.id).toMatch(UUID);

    const second = await add(d1.binding, "lemons-2", 3);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ data: { created: false, updated: true, item: { id: created.item.id, quantity: 5 } } });
    expect(await lemons()).toMatchObject([{ quantity: 5, ingredientRef: { name: "lemons" } }]);
  });

  it.each(OUTCOMES)("adds once when the add's batch is %s and the request retries it", async (outcome) => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ADD_BATCH, outcome);

    const response = await add(flaky.binding, "lemons-once");

    expect(flaky.failures()).toBe(1);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ data: { created: true, item: { quantity: 2 } } });
    expect(await lemons()).toMatchObject([{ quantity: 2 }]);
  });

  it("adds to an existing item once when the batch's answer was lost", async () => {
    await add(d1.binding, "lemons-first");
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ADD_BATCH, "lost-answer");

    const response = await add(flaky.binding, "lemons-more", 3);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { created: false, updated: true, item: { quantity: 5 } } });
    expect(await lemons()).toMatchObject([{ quantity: 5 }]);
  });

  it("adds once when the request gave up, the batch then committed late, and the client resubmitted", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ADD_BATCH, "lost", "lost", "lost", "late");
    // How API v1 answers a write that stayed unavailable belongs to its error mapping; here it only fails.
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const failed = await add(flaky.binding, "lemons-late");
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(await lemons()).toEqual([]);
    expect(logged).toHaveBeenCalled();

    // The resubmit's batch finds the late batch's claim (which lands just before it) and adds nothing.
    const retried = await add(flaky.binding, "lemons-late");

    expect(retried.status).toBe(201);
    await expect(retried.json()).resolves.toMatchObject({ data: { created: true, item: { quantity: 2 } } });
    expect(await lemons()).toMatchObject([{ quantity: 2 }]);
  });

  it("adds once when the request gave up and nothing committed, then the client resubmitted", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ADD_BATCH, "lost", "lost", "lost", "lost");
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect((await add(flaky.binding, "lemons-retry")).status).toBeGreaterThanOrEqual(500);
    const retried = await add(flaky.binding, "lemons-retry");

    expect(retried.status).toBe(201);
    expect(await lemons()).toMatchObject([{ quantity: 2 }]);
  });

  it("answers not found, adding nothing, when the list is deleted just before the add's batch", async () => {
    const binding = {
      prepare: (sql: string) => d1.binding.prepare(sql),
      async batch(statements: never) {
        await db.shoppingList.delete({ where: { id: listId } });
        return d1.binding.batch(statements);
      },
    };

    const response = await add(binding, "lemons-gone");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
    expect(await db.shoppingListItem.count()).toBe(0);
  });

  it("answers no item when the list no longer exists", async () => {
    const ref = await getOrCreateIngredientRef(db, "limes");
    const writeKey = await d1WriteOnceKey({ userId, operation: "api_v1.shopping_item_create", token: "t", request: {} });

    await expect(putShoppingListItemOnceOnD1(d1.binding as never, {
      shoppingListId: "missing-list",
      ingredientRefId: ref.id,
      unitId: null,
      quantity: 1,
      categoryKey: null,
      iconKey: null,
      itemId: "missing-item",
      writeKey,
      now: new Date(),
    })).resolves.toBeNull();
  });
});
