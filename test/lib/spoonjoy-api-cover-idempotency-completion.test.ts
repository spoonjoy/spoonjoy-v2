import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import { callSpoonjoyApiOperation, type SpoonjoyApiContext } from "~/lib/spoonjoy-api.server";
import type { ApiPrincipal } from "~/lib/api-auth.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { expectConsoleError } from "../warning-policy";

// The MCP cover tools save their response on the idempotency key after the write commits, as
// a separate statement. A failed save used to throw after the write had committed, leaving
// the key in flight: every retry with that key then answered "already in progress" for a day.

type Database = Awaited<ReturnType<typeof getLocalDb>>;

describe("MCP cover tools: idempotency key completion after a committed write", () => {
  let db: Database;
  let context: SpoonjoyApiContext;
  let recipeId: string;
  let userId: string;
  let originalUpdate: Database["apiIdempotencyKey"]["update"];

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    const user = await db.user.create({
      data: { email: `cover-${faker.string.alphanumeric(8).toLowerCase()}@example.com`, username: `cover_${faker.string.alphanumeric(8).toLowerCase()}` },
    });
    userId = user.id;
    const principal: ApiPrincipal = {
      id: user.id,
      email: user.email,
      username: user.username,
      source: "bearer",
      scopes: ["kitchen:read", "kitchen:write"],
    };
    context = { db, principal };
    recipeId = (await db.recipe.create({ data: { title: `Cover completion ${faker.string.alphanumeric(6)}`, chefId: user.id } })).id;
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

  const setNoCover = (idempotencyKey: string) =>
    callSpoonjoyApiOperation("set_recipe_no_cover", { recipeId, confirmNoCover: true, idempotencyKey }, context);

  it("answers the committed write when saving its response fails twice", async () => {
    const update = failCompletion(2);
    expectConsoleError("[spoonjoy-api] idempotency_completion_failed", {
      operation: "set_recipe_no_cover",
      error: "completion failed 2",
    });

    await expect(setNoCover("no-cover-completion-fails")).resolves.toMatchObject({
      mutation: { idempotencyKey: "no-cover-completion-fails", replayed: false },
    });
    expect(update).toHaveBeenCalledTimes(2);
    await expect(db.recipe.findUniqueOrThrow({ where: { id: recipeId } })).resolves.toMatchObject({ coverMode: "none" });
    await expect(db.apiIdempotencyKey.findFirstOrThrow({ where: { userId, key: "no-cover-completion-fails" } }))
      .resolves.toMatchObject({ responseStatus: null, responseBody: null });
  });

  it("retries a response save that fails once, so a retry with the key replays it", async () => {
    const update = failCompletion(1);

    await expect(setNoCover("no-cover-completion-retry")).resolves.toMatchObject({
      mutation: { idempotencyKey: "no-cover-completion-retry", replayed: false },
    });
    expect(update).toHaveBeenCalledTimes(2);

    await expect(setNoCover("no-cover-completion-retry")).resolves.toMatchObject({
      mutation: { idempotencyKey: "no-cover-completion-retry", replayed: true },
    });
  });
});
