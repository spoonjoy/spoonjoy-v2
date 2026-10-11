// @vitest-environment node
// API v1 writes when D1's connection drops: cookbook create and rename, the shopping list, unit and
// ingredient a first item needs, checking and removing an item, releasing a failed mutation's
// idempotency key, and the tombstone a recovered recipe delete records. After each outcome (the
// write never ran, it committed but its answer was lost, or it committed late) the rows are the
// ones a single clean run leaves.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import type { PrismaClient } from "@prisma/client";
import { action } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { hashIdempotencyRequest, reserveIdempotencyKey } from "~/lib/api-idempotency.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { NETWORK_LOST_MESSAGE, type FlakyOutcome } from "../helpers/flaky-d1";
import { createTestRecipe, createTestUser, getOrCreateIngredientRef } from "../utils";

const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];
const GIVE_UP: FlakyOutcome[] = ["lost", "lost", "lost", "lost"];

type Delegate = Record<string, (...args: unknown[]) => Promise<unknown>>;
const restores: Array<() => void> = [];

/**
 * Fails the next calls of `model.method` whose argument `matches`, one outcome each: before the
 * call ran ("lost"), after it committed ("lost-answer"), or committing just before the next call
 * of the method ("late"). The argument check tells the write under test apart from other calls of
 * the same method, such as the idempotency runner's.
 */
function failNext(db: PrismaClient, model: string, method: string, matches: (args: any) => boolean, ...outcomes: FlakyOutcome[]) {
  const delegate = (db as unknown as Record<string, Delegate>)[model]!;
  const original = delegate[method]!;
  const call = (args: unknown[]) => original.apply(delegate, args);
  let late: (() => Promise<unknown>) | null = null;
  let failed = 0;
  delegate[method] = async (...args: unknown[]) => {
    if (late) {
      const landing = late;
      late = null;
      await landing();
    }
    if (outcomes.length === 0 || !matches(args[0])) return call(args);
    const outcome = outcomes.shift()!;
    failed += 1;
    if (outcome === "lost-answer") await call(args);
    if (outcome === "late") late = () => call(args);
    throw new Error(NETWORK_LOST_MESSAGE);
  };
  restores.push(() => {
    delegate[method] = original;
  });
  return { failures: () => failed };
}

const any = () => true;

let db: PrismaClient;
let userId: string;
let token: string;

function send(method: string, path: string, requestId: string, body: unknown) {
  const request = new UndiciRequest(`http://localhost/api/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Request-Id": requestId },
    body: JSON.stringify(body),
  }) as unknown as Request;
  return action({ request, params: { "*": path }, context: { cloudflare: { env: null } } } as any);
}

async function expectRetryable(response: Response) {
  expect(response.status).toBe(503);
  expect(response.headers.get("Retry-After")).toBe("1");
  await expect(response.json()).resolves.toMatchObject({ error: { code: "temporarily_unavailable" } });
}

async function listWithItem(name = `retry milk ${faker.string.alphanumeric(8)}`.toLowerCase()) {
  const list = await db.shoppingList.create({ data: { authorId: userId } });
  const ref = await getOrCreateIngredientRef(db, name);
  const item = await db.shoppingListItem.create({
    data: { shoppingListId: list.id, ingredientRefId: ref.id, quantity: 1, sortIndex: 0 },
  });
  return { list, item };
}

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
  userId = (await db.user.create({ data: createTestUser() })).id;
  token = (await createApiCredential(db, userId, "Retry writer", { scopes: ["kitchen:write", "shopping_list:write"] })).token;
});

afterEach(async () => {
  while (restores.length > 0) restores.pop()!();
  vi.restoreAllMocks();
  await cleanupDatabase();
});

describe("API v1 cookbook writes after a transient D1 error", () => {
  it.each(OUTCOMES)("creates the cookbook once (%s)", async (outcome) => {
    const flaky = failNext(db, "cookbook", "create", any, outcome);
    const title = `Retry book ${outcome}`;

    const response = await send("POST", "cookbooks", `req_book_${outcome}`, { clientMutationId: `book-${outcome}`, title });

    expect(response.status).toBe(201);
    expect(flaky.failures()).toBe(1);
    const body = await response.json() as { data: { cookbook: { id: string } } };
    const cookbooks = await db.cookbook.findMany({ where: { authorId: userId }, select: { id: true, title: true } });
    expect(cookbooks).toEqual([{ id: body.data.cookbook.id, title }]);
  });

  it("still refuses a title another cookbook took while a try was lost", async () => {
    const title = "Taken while lost";
    const original = (db as unknown as Record<string, Delegate>).cookbook!.create!;
    let first = true;
    (db as unknown as Record<string, Delegate>).cookbook!.create = async (...args: unknown[]) => {
      if (!first) return original.apply((db as unknown as Record<string, Delegate>).cookbook, args);
      first = false;
      // Another request takes the title just as this try is lost.
      await original.apply((db as unknown as Record<string, Delegate>).cookbook, [{ data: { title, authorId: userId } }]);
      throw new Error(NETWORK_LOST_MESSAGE);
    };
    restores.push(() => {
      (db as unknown as Record<string, Delegate>).cookbook!.create = original;
    });

    const response = await send("POST", "cookbooks", "req_book_taken", { clientMutationId: "book-taken", title });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "validation_error", message: "You already have a cookbook with this title" } });
    await expect(db.cookbook.count({ where: { authorId: userId } })).resolves.toBe(1);
  });

  it("answers a cookbook create the database never takes as retryable", async () => {
    failNext(db, "cookbook", "create", any, ...GIVE_UP);

    const response = await send("POST", "cookbooks", "req_book_give_up", { clientMutationId: "book-give-up", title: "Never saved" });

    await expectRetryable(response);
    await expect(db.cookbook.count({ where: { authorId: userId } })).resolves.toBe(0);
  });

  it.each(OUTCOMES)("renames the cookbook once (%s)", async (outcome) => {
    const cookbook = await db.cookbook.create({ data: { title: "Before", authorId: userId } });
    const flaky = failNext(db, "cookbook", "update", any, outcome);

    const response = await send("PATCH", `cookbooks/${cookbook.id}`, `req_rename_${outcome}`, { clientMutationId: `rename-${outcome}`, title: "After" });

    expect(response.status).toBe(200);
    expect(flaky.failures()).toBe(1);
    await expect(db.cookbook.findMany({ where: { authorId: userId }, select: { id: true, title: true } }))
      .resolves.toEqual([{ id: cookbook.id, title: "After" }]);
  });
});

describe("API v1 shopping writes after a transient D1 error", () => {
  const firstItem = (outcome: string) => ({
    clientMutationId: `first-${outcome}`,
    name: `retry flour ${outcome} ${faker.string.alphanumeric(6)}`,
    quantity: 2,
    unit: `retry cup ${outcome} ${faker.string.alphanumeric(6)}`,
  });

  async function firstItemRows(body: ReturnType<typeof firstItem>) {
    return {
      lists: await db.shoppingList.count({ where: { authorId: userId } }),
      units: await db.unit.count({ where: { name: body.unit.toLowerCase() } }),
      refs: await db.ingredientRef.count({ where: { name: body.name.toLowerCase() } }),
      items: await db.shoppingListItem.count({ where: { shoppingList: { authorId: userId } } }),
    };
  }

  it.each(OUTCOMES)("makes the chef's shopping list once for a first item (%s)", async (outcome) => {
    const flaky = failNext(db, "shoppingList", "create", any, outcome);
    const body = firstItem(outcome);

    const response = await send("POST", "shopping-list/items", `req_list_${outcome}`, body);

    expect(response.status).toBe(201);
    expect(flaky.failures()).toBe(1);
    await expect(firstItemRows(body)).resolves.toEqual({ lists: 1, units: 1, refs: 1, items: 1 });
  });

  it("answers a shopping list the database never makes as retryable", async () => {
    failNext(db, "shoppingList", "create", any, ...GIVE_UP);

    await expectRetryable(await send("POST", "shopping-list/items", "req_list_give_up", firstItem("give-up")));
    await expect(db.shoppingList.count({ where: { authorId: userId } })).resolves.toBe(0);
  });

  it.each(OUTCOMES)("makes a first item's unit and ingredient once (%s)", async (outcome) => {
    const units = failNext(db, "unit", "create", any, outcome);
    const refs = failNext(db, "ingredientRef", "create", any, outcome);
    const body = firstItem(`names-${outcome}`);

    const response = await send("POST", "shopping-list/items", `req_names_${outcome}`, body);

    expect(response.status).toBe(201);
    expect(units.failures() + refs.failures()).toBe(2);
    await expect(firstItemRows(body)).resolves.toEqual({ lists: 1, units: 1, refs: 1, items: 1 });
  });

  it.each(OUTCOMES)("checks an item once (%s)", async (outcome) => {
    const { item } = await listWithItem();
    const flaky = failNext(db, "shoppingListItem", "update", (args) => args?.data?.checked !== undefined, outcome);

    const response = await send("PATCH", `shopping-list/items/${item.id}`, `req_check_${outcome}`, { clientMutationId: `check-${outcome}`, checked: true });

    expect(response.status).toBe(200);
    expect(flaky.failures()).toBe(1);
    const body = await response.json() as { data: { item: { checked: boolean; checkedAt: string; sortIndex: number } } };
    const stored = await db.shoppingListItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(stored).toMatchObject({ checked: true, deletedAt: null, sortIndex: body.data.item.sortIndex });
    expect(stored.checkedAt?.toISOString()).toBe(body.data.item.checkedAt);
  });

  it("answers a check the database never takes as retryable, and leaves the item as it was", async () => {
    const { item } = await listWithItem();
    failNext(db, "shoppingListItem", "update", (args) => args?.data?.checked !== undefined, ...GIVE_UP);

    await expectRetryable(await send("PATCH", `shopping-list/items/${item.id}`, "req_check_give_up", { clientMutationId: "check-give-up", checked: true }));
    await expect(db.shoppingListItem.findUniqueOrThrow({ where: { id: item.id } })).resolves.toMatchObject({ checked: false, checkedAt: null });
  });

  it.each(OUTCOMES)("removes an item once (%s)", async (outcome) => {
    const { item } = await listWithItem();
    const flaky = failNext(db, "shoppingListItem", "update", (args) => args?.data?.deletedAt !== undefined, outcome);

    const response = await send("DELETE", `shopping-list/items/${item.id}`, `req_remove_${outcome}`, { clientMutationId: `remove-${outcome}` });

    expect(response.status).toBe(200);
    expect(flaky.failures()).toBe(1);
    const body = await response.json() as { data: { item: { deletedAt: string } } };
    const stored = await db.shoppingListItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(stored.deletedAt?.toISOString()).toBe(body.data.item.deletedAt);
  });

  it.each(OUTCOMES)("releases a failed mutation's idempotency key once (%s)", async (outcome) => {
    await listWithItem();
    // The release after a write error, not the runner's in-flight cleanup (which names responseStatus).
    const flaky = failNext(db, "apiIdempotencyKey", "deleteMany", (args) => args?.where && !("responseStatus" in args.where), outcome);

    const response = await send("PATCH", "shopping-list/items/missing-item", `req_release_${outcome}`, { clientMutationId: `release-${outcome}`, checked: true });

    expect(response.status).toBe(404);
    expect(flaky.failures()).toBe(1);
    await expect(db.apiIdempotencyKey.count({ where: { key: `release-${outcome}` } })).resolves.toBe(0);
  });
});

describe("API v1 recovered recipe delete after a transient D1 error", () => {
  it.each(OUTCOMES)("records the recipe's tombstone once (%s)", async (outcome) => {
    const recipe = await db.recipe.create({ data: { ...createTestRecipe(userId), title: `Deleted ${outcome}` } });
    const credential = await db.apiCredential.findFirstOrThrow({ where: { userId } });
    const body = { clientMutationId: `delete-${outcome}` };
    const reservation = await reserveIdempotencyKey(db, {
      userId,
      credentialId: credential.id,
      clientKey: `chef:${userId}`,
      key: body.clientMutationId,
      operation: "recipes.delete",
      requestHash: await hashIdempotencyRequest({ method: "DELETE", path: `/api/v1/recipes/${recipe.id}`, body }),
    });
    expect(reservation.status).toBe("reserved");
    // The earlier request's delete committed, then its Worker stopped before it answered.
    await db.recipe.update({ where: { id: recipe.id }, data: { deletedAt: new Date() } });
    const flaky = failNext(db, "nativeSyncTombstone", "upsert", any, outcome);

    const response = await send("DELETE", `recipes/${recipe.id}`, `req_tombstone_${outcome}`, body);

    expect(response.status).toBe(200);
    expect(flaky.failures()).toBe(1);
    await expect(db.nativeSyncTombstone.findMany({ where: { accountId: userId }, select: { resourceType: true, resourceId: true } }))
      .resolves.toEqual([{ resourceType: "recipe", resourceId: recipe.id }]);
  });
});
