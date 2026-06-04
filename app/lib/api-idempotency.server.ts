import type { ApiIdempotencyKey, PrismaClient as PrismaClientType } from "@prisma/client";
import type { ApiPrincipal } from "~/lib/api-auth.server";

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_RETRY_AFTER_SECONDS = 2;

export type IdempotencyReservation =
  | { status: "reserved"; record: ApiIdempotencyKey }
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

export async function reserveIdempotencyKey(
  db: PrismaClientType,
  input: {
    userId: string;
    credentialId?: string | null;
    clientKey: string;
    key: string;
    operation: string;
    requestHash: string;
    now?: Date;
  },
): Promise<IdempotencyReservation> {
  const now = input.now ?? new Date();

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
    return await existingReservation(db, existing, input, now);
  }

  try {
    const record = await db.apiIdempotencyKey.create({
      data: {
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
    if (existing.responseStatus === null || existing.responseBody === null) {
      return { status: "in_flight", record: existing };
    }
    return { status: "replay", record: existing };
  }
  return { status: "conflict", record: existing };
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

export async function completeIdempotencyKey(
  db: PrismaClientType,
  id: string,
  response: { status: number; body: unknown },
): Promise<ApiIdempotencyKey> {
  return db.apiIdempotencyKey.update({
    where: { id },
    data: {
      responseStatus: response.status,
      responseBody: JSON.stringify(response.body),
    },
  });
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
