import type { PrismaClient } from "@prisma/client";
import { completeIdempotencyKey, hashIdempotencyRequest, reserveIdempotencyKey } from "~/lib/api-idempotency.server";

// Imports and forks that a retry must not repeat. An agent whose import timed out, or a browser
// whose fork form was submitted twice, sent the same request again and got a second recipe. These
// writes now run behind the same idempotency reservations API v1 uses (ApiIdempotencyKey, kept 24
// hours): the first request writes and records its answer, and a repeat of it gets that answer.
// A recorded answer is only reused while the recipe it made is still the chef's and not deleted,
// so a chef who deleted a fork and forks again gets a new one.

/** The same key was used for a different request. */
export class RecipeWriteKeyConflictError extends Error {
  constructor() {
    super("idempotencyKey was already used for a different request");
    this.name = "RecipeWriteKeyConflictError";
  }
}

/** The first request with this key is still running. */
export class RecipeWriteInFlightError extends Error {
  constructor() {
    super("The same request is already in progress; retry shortly");
    this.name = "RecipeWriteInFlightError";
  }
}

export interface DedupedRecipeWrite<T extends { recipeId: string | null }> {
  db: PrismaClient;
  chefId: string;
  /** Names the write, such as "mcp.fork_recipe". */
  operation: string;
  /** The caller's key; without one, a key is derived from the request, so an identical request repeats. */
  key?: string | null;
  /** What identifies the request: a repeat must match it exactly. */
  request: unknown;
  write: () => Promise<T>;
  /**
   * How long to wait for a first request that is still running before giving up with
   * RecipeWriteInFlightError. A browser follows only the last of its submits, so the web waits.
   */
  waitForInFlightMs?: number;
  /** For tests: how long to sleep between checks while waiting. */
  pollMs?: number;
}

const CLIENT_KEY_PREFIX = "chef:";

/**
 * Runs `write` once per request: a repeat (same key and request, or an identical request without
 * a key) within 24 hours answers what the first one answered, with `replayed: true`.
 */
export async function runDedupedRecipeWrite<T extends { recipeId: string | null }>(
  input: DedupedRecipeWrite<T>,
): Promise<{ value: T; replayed: boolean }> {
  const requestHash = await hashIdempotencyRequest({ method: "WRITE", path: input.operation, body: input.request });
  const key = input.key ? `${input.operation}:key:${input.key}` : `${input.operation}:request:${requestHash}`;
  const reservationInput = {
    userId: input.chefId,
    clientKey: `${CLIENT_KEY_PREFIX}${input.chefId}`,
    key,
    operation: input.operation,
    requestHash,
  };
  const deadline = Date.now() + (input.waitForInFlightMs ?? 0);

  for (;;) {
    const reservation = await reserveIdempotencyKey(input.db, reservationInput);
    if (reservation.status === "conflict") throw new RecipeWriteKeyConflictError();
    if (reservation.status === "in_flight") {
      if (Date.now() >= deadline) throw new RecipeWriteInFlightError();
      await new Promise((resolve) => setTimeout(resolve, input.pollMs ?? 250));
      continue;
    }
    if (reservation.status === "replay") {
      const value = JSON.parse(reservation.record.responseBody!) as T;
      if (await recipeStillActive(input.db, input.chefId, value.recipeId)) return { value, replayed: true };
      // The recipe it made was deleted since: forget the answer and write again.
      await input.db.apiIdempotencyKey.deleteMany({ where: { id: reservation.record.id } });
      continue;
    }

    let value: T;
    try {
      value = await input.write();
    } catch (error) {
      await input.db.apiIdempotencyKey.deleteMany({ where: { id: reservation.record.id } });
      throw error;
    }
    await completeIdempotencyKey(input.db, reservation.record.id, { status: 200, body: value });
    return { value, replayed: false };
  }
}

async function recipeStillActive(db: PrismaClient, chefId: string, recipeId: string | null): Promise<boolean> {
  if (!recipeId) return false;
  const recipe = await db.recipe.findFirst({ where: { id: recipeId, chefId, deletedAt: null }, select: { id: true } });
  return recipe !== null;
}
