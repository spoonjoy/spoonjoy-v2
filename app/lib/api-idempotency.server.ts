import type { ApiIdempotencyKey, PrismaClient as PrismaClientType } from "@prisma/client";
import type { ApiPrincipal } from "~/lib/api-auth.server";
import { retryD1Write } from "~/lib/d1-write-retry.server";

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_RETRY_AFTER_SECONDS = 2;

export type IdempotencyReservation =
  /**
   * The request holds the key. `resumed` when it took over a key whose earlier write failed
   * because D1 was briefly unavailable: that write may have committed after all, so the caller
   * checks for it before writing again, under the same key id.
   */
  | { status: "reserved"; record: ApiIdempotencyKey; resumed?: boolean }
  | { status: "replay"; record: ApiIdempotencyKey }
  | { status: "in_flight"; record: ApiIdempotencyKey }
  | { status: "conflict"; record: ApiIdempotencyKey };

type ApiIdempotencyConflictTarget = {
  userId_clientKey_key?: {
    userId: string;
    clientKey: string;
    key: string;
  };
};

export class IdempotencyConflictError extends Error {
  status = 409;
  code = "idempotency_conflict";

  constructor(message = "Idempotency key was already used for a different request") {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

export async function hashIdempotencyRequest(input: {
  method: string;
  path: string;
  body: unknown;
}): Promise<string> {
  const canonical = stableJson({
    method: input.method.toUpperCase(),
    path: input.path,
    body: input.body,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return bytesToHex(new Uint8Array(digest));
}

export function idempotencyClientKey(principal: Pick<ApiPrincipal, "id" | "source" | "credentialId">): string {
  return `chef:${principal.id}`;
}

type ReservationInput = {
  userId: string;
  credentialId?: string | null;
  clientKey: string;
  key: string;
  operation: string;
  requestHash: string;
  now?: Date;
};

/**
 * Reserves the key for this request, or answers what an earlier request with it left: its saved
 * response (replay), that it is still running (in flight), or that it was a different request
 * (conflict). The new reservation's id is chosen before the first try, so after a transient D1
 * error the whole reservation runs again and recognises its own row if the failed try wrote it.
 */
export async function reserveIdempotencyKey(
  db: PrismaClientType,
  input: ReservationInput,
): Promise<IdempotencyReservation> {
  const now = input.now ?? new Date();
  const id = newReservationId(now);
  return retryD1Write({ scope: "idempotency.reserve" }, () => reserveOnce(db, input, id, now));
}

let reservationCounter = 0;

/**
 * A new reservation id in the shape of the cuid Prisma would make ("c" and 24 lowercase letters
 * or digits, time first), because a recipe created through the API takes its reservation's id.
 * Chosen here, before the first try, rather than by Prisma on each try.
 */
export function newReservationId(now: Date): string {
  reservationCounter = (reservationCounter + 1) % 36 ** 4;
  const random = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => (byte % 36).toString(36)).join("");
  return `c${now.getTime().toString(36).padStart(8, "0").slice(-8)}${reservationCounter.toString(36).padStart(4, "0")}${random}`;
}

async function reserveOnce(
  db: PrismaClientType,
  input: ReservationInput,
  id: string,
  now: Date,
): Promise<IdempotencyReservation> {
  await db.apiIdempotencyKey.deleteMany({
    where: {
      userId: input.userId,
      clientKey: input.clientKey,
      key: input.key,
      expiresAt: { lte: now },
    },
  });

  const uniqueWhere = {
    userId_clientKey_key: {
      userId: input.userId,
      clientKey: input.clientKey,
      key: input.key,
    },
  } as const;

  const existing = await db.apiIdempotencyKey.findUnique({
    where: uniqueWhere,
  });

  if (existing) {
    return existing.id === id ? { status: "reserved", record: existing } : await existingReservation(db, existing, input, now);
  }

  try {
    const record = await db.apiIdempotencyKey.create({
      data: {
        id,
        userId: input.userId,
        credentialId: input.credentialId ?? null,
        clientKey: input.clientKey,
        key: input.key,
        operation: input.operation,
        requestHash: input.requestHash,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      },
    });

    return { status: "reserved", record };
  } catch (error) {
    if (!isUniqueIdempotencyRace(error)) throw error;
    const raced = await db.apiIdempotencyKey.findUnique({
      where: uniqueWhere,
    });
    if (!raced) throw error;
    return await existingReservation(db, raced, input, now);
  }
}

async function existingReservation(
  db: PrismaClientType,
  existing: ApiIdempotencyKey,
  input: {
    credentialId?: string | null;
    operation: string;
    requestHash: string;
  },
  now: Date,
): Promise<IdempotencyReservation> {
  if (existing.operation === input.operation && existing.requestHash === input.requestHash) {
    if (existing.responseBody === null && existing.responseStatus === RELEASED_FOR_RETRY_STATUS) {
      return await resumeReleasedReservation(db, existing, now);
    }
    if (existing.responseStatus === null || existing.responseBody === null) {
      return { status: "in_flight", record: existing };
    }
    return { status: "replay", record: existing };
  }
  return { status: "conflict", record: existing };
}

/**
 * The mark on a key whose write failed because D1 was briefly unavailable: a response status with
 * no response body, which no completed key has.
 */
const RELEASED_FOR_RETRY_STATUS = 503;

/**
 * Releases a key whose write failed because D1 was briefly unavailable, for the client's retry
 * of the same request to take over. The key is kept, not deleted: the write may still commit,
 * and the retry must run under the same key id, which writes that take their ids from it would
 * then collide on rather than write twice. Setting a fixed value, it runs again after a
 * transient D1 error.
 */
export async function releaseIdempotencyKeyForRetry(db: PrismaClientType, id: string): Promise<void> {
  await retryD1Write({ scope: "idempotency.release" }, () => db.apiIdempotencyKey.updateMany({
    where: { id, responseBody: null },
    data: { responseStatus: RELEASED_FOR_RETRY_STATUS },
  }));
}

/**
 * Takes over a released key, unless another retry took it first. The claim stamps the key with
 * this request's time, so after an ambiguous failure a read tells whether this request's claim
 * is the one that committed.
 */
async function resumeReleasedReservation(
  db: PrismaClientType,
  existing: ApiIdempotencyKey,
  now: Date,
): Promise<IdempotencyReservation> {
  const claimedAt = new Date(Math.max(now.getTime(), existing.updatedAt.getTime() + 1));
  const ours = (record: ApiIdempotencyKey | null) =>
    record !== null && record.responseStatus === null && record.updatedAt.getTime() === claimedAt.getTime();
  const claimed = await retryD1Write({
    scope: "idempotency.resume",
    applied: async () => (ours(await db.apiIdempotencyKey.findUnique({ where: { id: existing.id } })) ? true : null),
  }, async () => (await db.apiIdempotencyKey.updateMany({
    where: { id: existing.id, responseStatus: RELEASED_FOR_RETRY_STATUS, responseBody: null },
    data: { responseStatus: null, updatedAt: claimedAt },
  })).count === 1);
  return claimed
    ? { status: "reserved", record: { ...existing, responseStatus: null, updatedAt: claimedAt }, resumed: true }
    : { status: "in_flight", record: existing };
}

function isUniqueIdempotencyRace(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") return false;
  const target = candidate.meta?.target as ApiIdempotencyConflictTarget | string[] | string | undefined;
  if (typeof target === "string") return target.includes("userId_clientKey_key");
  if (Array.isArray(target)) return target.includes("userId") && target.includes("clientKey") && target.includes("key");
  return Boolean(target?.userId_clientKey_key);
}

/** Saves the response on the key. Saving the same response again changes nothing, so a transient D1 error retries it. */
export async function completeIdempotencyKey(
  db: PrismaClientType,
  id: string,
  response: { status: number; body: unknown },
): Promise<ApiIdempotencyKey> {
  const responseBody = JSON.stringify(response.body);
  return retryD1Write({ scope: "idempotency.complete" }, () => db.apiIdempotencyKey.update({
    where: { id },
    data: {
      responseStatus: response.status,
      responseBody,
    },
  }));
}

/**
 * A short, stable description of a failed key save for logs: the Prisma error code, or the
 * first line of the message. Only the first line, because a Prisma validation message goes on
 * to print the call, including the response body being saved.
 */
export function idempotencyCompletionFailureSummary(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  return (error instanceof Error ? error.message : String(error)).split("\n")[0]!;
}

/**
 * Saves a committed write's response on its key, trying twice. The write has already
 * committed, so a failure here must not turn it into an error answer: the caller answers the
 * write as committed and reports the failure. The key then stays in flight, and a retry with
 * it gets "in progress" until it expires, unless the operation can recover the write.
 * Answers null once saved, or the last failure.
 */
export async function completeCommittedIdempotencyKey(
  db: PrismaClientType,
  id: string,
  response: { status: number; body: unknown },
): Promise<unknown> {
  let failure: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await completeIdempotencyKey(db, id, response);
      return null;
    } catch (error) {
      failure = error;
    }
  }
  return failure;
}

export function replayIdempotencyResponse(
  record: Pick<ApiIdempotencyKey, "responseStatus" | "responseBody">,
  requestId: string,
): { status: number; body: unknown } {
  if (record.responseStatus === null || record.responseBody === null) {
    throw new Error("Idempotency response is not complete");
  }
  const status = record.responseStatus;
  const body = JSON.parse(record.responseBody) as unknown;

  if (body && typeof body === "object" && !Array.isArray(body)) {
    const replayedBody = body as { requestId?: string; data?: { mutation?: { replayed?: boolean } } };
    replayedBody.requestId = requestId;
    if (replayedBody.data?.mutation) {
      replayedBody.data.mutation.replayed = true;
    }
    return { status, body: replayedBody };
  }

  return { status, body };
}
