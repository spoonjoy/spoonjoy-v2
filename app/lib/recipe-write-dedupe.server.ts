import type { PrismaClient } from "@prisma/client";
import {
  completeIdempotencyKey,
  hashIdempotencyRequest,
  IDEMPOTENCY_TTL_MS,
  reserveIdempotencyKey,
} from "~/lib/api-idempotency.server";
import { d1EpochMsSql, d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";

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

/** Where the reservations live: Prisma, or the request's D1 binding so the write never builds a client. */
type RecipeWriteKeyDatabase = { db: PrismaClient; d1?: null } | { d1: D1ReadDatabase; db?: undefined };

export type DedupedRecipeWrite<T extends { recipeId: string | null }> = RecipeWriteKeyDatabase & DedupedRecipeWriteRequest<T>;

export interface DedupedRecipeWriteRequest<T extends { recipeId: string | null }> {
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
  const store = input.d1 ? d1KeyStore(input.d1) : prismaKeyStore(input.db!);
  const deadline = Date.now() + (input.waitForInFlightMs ?? 0);

  for (;;) {
    const reservation = await store.reserve(reservationInput);
    if (reservation.status === "conflict") throw new RecipeWriteKeyConflictError();
    if (reservation.status === "in_flight") {
      if (Date.now() >= deadline) throw new RecipeWriteInFlightError();
      await new Promise((resolve) => setTimeout(resolve, input.pollMs ?? 250));
      continue;
    }
    if (reservation.status === "replay") {
      const value = JSON.parse(reservation.responseBody!) as T;
      if (await store.recipeStillActive(input.chefId, value.recipeId)) return { value, replayed: true };
      // The recipe it made was deleted since: forget the answer and write again.
      await store.forget(reservation.id);
      continue;
    }

    let value: T;
    try {
      value = await input.write();
    } catch (error) {
      await store.forget(reservation.id);
      throw error;
    }
    await store.complete(reservation.id, value);
    return { value, replayed: false };
  }
}

interface KeyReservationInput {
  userId: string;
  clientKey: string;
  key: string;
  operation: string;
  requestHash: string;
}

interface KeyReservation {
  status: "reserved" | "in_flight" | "replay" | "conflict";
  id: string;
  responseBody: string | null;
}

interface RecipeWriteKeyStore {
  reserve(input: KeyReservationInput): Promise<KeyReservation>;
  recipeStillActive(chefId: string, recipeId: string | null): Promise<boolean>;
  forget(id: string): Promise<void>;
  complete(id: string, body: unknown): Promise<void>;
}

function prismaKeyStore(db: PrismaClient): RecipeWriteKeyStore {
  return {
    async reserve(input) {
      const { status, record } = await reserveIdempotencyKey(db, input);
      return { status, id: record.id, responseBody: record.responseBody };
    },
    async recipeStillActive(chefId, recipeId) {
      if (!recipeId) return false;
      const recipe = await db.recipe.findFirst({ where: { id: recipeId, chefId, deletedAt: null }, select: { id: true } });
      return recipe !== null;
    },
    async forget(id) {
      await db.apiIdempotencyKey.deleteMany({ where: { id } });
    },
    async complete(id, body) {
      await completeIdempotencyKey(db, id, { status: 200, body });
    },
  };
}

const KEY_WHERE = `"userId" = ? AND "clientKey" = ? AND "key" = ?`;

/**
 * The same reservations on D1. One batch drops an expired key, inserts a new one unless the key
 * exists, and reads the key back; the row that comes back is either ours (reserved) or the
 * earlier request's. The insert and the read are one transaction, so two racing requests cannot
 * both reserve.
 */
function d1KeyStore(d1: D1ReadDatabase): RecipeWriteKeyStore {
  return {
    async reserve(input) {
      const id = crypto.randomUUID();
      const now = new Date();
      const keyValues = [input.userId, input.clientKey, input.key];
      const [, , { rows: [row] }] = await d1WriteBatch(d1, [
        [`DELETE FROM "ApiIdempotencyKey" WHERE ${KEY_WHERE} AND ${d1EpochMsSql('"expiresAt"')} <= ?`, ...keyValues, now.getTime()],
        [
          `INSERT INTO "ApiIdempotencyKey"
             ("id", "userId", "credentialId", "clientKey", "key", "operation", "requestHash", "expiresAt", "createdAt", "updatedAt")
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT ("userId", "clientKey", "key") DO NOTHING`,
          id,
          ...keyValues,
          input.operation,
          input.requestHash,
          d1Timestamp(new Date(now.getTime() + IDEMPOTENCY_TTL_MS)),
          d1Timestamp(now),
          d1Timestamp(now),
        ],
        [`SELECT "id", "operation", "requestHash", "responseStatus", "responseBody" FROM "ApiIdempotencyKey" WHERE ${KEY_WHERE}`, ...keyValues],
      ]);
      const responseBody = (row.responseBody as string | null) ?? null;
      if (row.id === id) return { status: "reserved", id, responseBody };
      const status = row.operation !== input.operation || row.requestHash !== input.requestHash
        ? "conflict"
        : row.responseStatus === null || responseBody === null
          ? "in_flight"
          : "replay";
      return { status, id: row.id as string, responseBody };
    },
    async recipeStillActive(chefId, recipeId) {
      if (!recipeId) return false;
      const [[recipe]] = await d1ReadBatch(d1, [
        [`SELECT 1 AS "active" FROM "Recipe" WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL`, recipeId, chefId],
      ]);
      return recipe !== undefined;
    },
    async forget(id) {
      await d1WriteBatch(d1, [[`DELETE FROM "ApiIdempotencyKey" WHERE "id" = ?`, id]]);
    },
    async complete(id, body) {
      await d1WriteBatch(d1, [[
        `UPDATE "ApiIdempotencyKey" SET "responseStatus" = 200, "responseBody" = ?, "updatedAt" = ? WHERE "id" = ?`,
        JSON.stringify(body),
        d1Timestamp(new Date()),
        id,
      ]]);
    },
  };
}
