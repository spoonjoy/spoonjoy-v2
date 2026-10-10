import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";
import { expectConsoleError } from "../warning-policy";

// A REST v1 mutation saves its response on its idempotency key after the write commits. That
// save is a separate statement, so it can fail after the write has committed. These cases use
// the shopping-list add, which has no in-flight recovery: the committed write must still be
// answered as committed, and a save that fails once must be retried so the key can replay.

function addItem(token: string, requestId: string, clientMutationId: string) {
  const request = new UndiciRequest("http://localhost/api/v1/shopping-list/items", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Request-Id": requestId },
    body: JSON.stringify({ clientMutationId, name: "Completion eggs", quantity: 6, unit: "each" }),
  }) as unknown as Request;
  return action({ request, params: { "*": "shopping-list/items" }, context: { cloudflare: { env: null } } } as never);
}

describe("API v1 idempotency key completion after a committed write", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  let token: string;
  let userId: string;
  let originalUpdate: typeof db.apiIdempotencyKey.update;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    userId = (await db.user.create({ data: createTestUser() })).id;
    token = (await createApiCredential(db, userId, "Shopping writer", { scopes: ["shopping_list:write"] })).token;
    await db.shoppingList.create({ data: { authorId: userId } });
    originalUpdate = db.apiIdempotencyKey.update;
  });

  afterEach(async () => {
    db.apiIdempotencyKey.update = originalUpdate;
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  function failCompletion(times: number) {
    const update = vi.fn(originalUpdate);
    for (let i = 0; i < times; i++) update.mockRejectedValueOnce(new Error(`completion failed ${i + 1}`));
    db.apiIdempotencyKey.update = update as unknown as typeof db.apiIdempotencyKey.update;
    return update;
  }

  const items = () => db.shoppingListItem.count({ where: { shoppingList: { authorId: userId }, deletedAt: null } });
  const key = (clientMutationId: string) => db.apiIdempotencyKey.findFirstOrThrow({ where: { userId, key: clientMutationId } });

  it("answers the committed write when saving its response fails twice, and leaves the key in flight", async () => {
    const update = failCompletion(2);
    expectConsoleError("[api-v1] idempotency_completion_failed", {
      requestId: "req_completion_fails",
      operation: "shopping-list.items.create",
      error: "completion failed 2",
    });

    const response = await addItem(token, "req_completion_fails", "completion-fails");

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_completion_fails",
      data: { created: true, item: { name: "completion eggs" }, mutation: { clientMutationId: "completion-fails", replayed: false } },
    });
    expect(update).toHaveBeenCalledTimes(2);
    await expect(items()).resolves.toBe(1);
    await expect(key("completion-fails")).resolves.toMatchObject({ responseStatus: null, responseBody: null });
  });

  it("retries a response save that fails once, so a retry of the request replays it", async () => {
    const update = failCompletion(1);

    const first = await addItem(token, "req_completion_retry_1", "completion-retry");
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { data: { item: { id: string } } };
    expect(update).toHaveBeenCalledTimes(2);
    await expect(key("completion-retry")).resolves.toMatchObject({ responseStatus: 201 });

    const replay = await addItem(token, "req_completion_retry_2", "completion-retry");
    expect(replay.status).toBe(201);
    await expect(replay.json()).resolves.toMatchObject({
      requestId: "req_completion_retry_2",
      data: { item: { id: firstBody.data.item.id }, mutation: { clientMutationId: "completion-retry", replayed: true } },
    });
    await expect(items()).resolves.toBe(1);
  });
});
