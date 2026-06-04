import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { createApiCredential } from "~/lib/api-auth.server";
import {
  completeIdempotencyKey,
  hashIdempotencyRequest,
  idempotencyClientKey,
  IdempotencyConflictError,
  IDEMPOTENCY_TTL_MS,
  replayIdempotencyResponse,
  reserveIdempotencyKey,
} from "~/lib/api-idempotency.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

describe("API idempotency helpers", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  let userId: string;
  const now = new Date("2026-06-01T20:00:00.000Z");

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    userId = (await db.user.create({ data: createTestUser() })).id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("exports helpers for hashing, reserving, completing, and replaying idempotent mutations", async () => {
    const mod = await import("~/lib/api-idempotency.server");

    expect(mod).toMatchObject({
      hashIdempotencyRequest: expect.any(Function),
      idempotencyClientKey: expect.any(Function),
      reserveIdempotencyKey: expect.any(Function),
      completeIdempotencyKey: expect.any(Function),
      replayIdempotencyResponse: expect.any(Function),
      IdempotencyConflictError: expect.any(Function),
    });
  });

  it("canonicalizes request hashes across object key order and request fields", async () => {
    const first = await hashIdempotencyRequest({
      method: "post",
      path: "/api/v1/shopping-list/items",
      body: { name: "Eggs", clientMutationId: "m1", nested: { b: 2, a: 1 } },
    });
    const reordered = await hashIdempotencyRequest({
      method: "POST",
      path: "/api/v1/shopping-list/items",
      body: { nested: { a: 1, b: 2 }, clientMutationId: "m1", name: "Eggs" },
    });
    const differentPath = await hashIdempotencyRequest({
      method: "POST",
      path: "/api/v1/shopping-list/items/item-1",
      body: { name: "Eggs", clientMutationId: "m1", nested: { b: 2, a: 1 } },
    });
    const arrayBody = await hashIdempotencyRequest({
      method: "POST",
      path: "/api/v1/shopping-list/items",
      body: ["Eggs", null, 2],
    });
    const primitiveBody = await hashIdempotencyRequest({
      method: "POST",
      path: "/api/v1/shopping-list/items",
      body: "Eggs",
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(reordered).toBe(first);
    expect(differentPath).not.toBe(first);
    expect(arrayBody).not.toBe(first);
    expect(primitiveBody).not.toBe(arrayBody);
  });

  it("derives client keys for bearer, session, and bearer principals missing credential ids", () => {
    expect(idempotencyClientKey({
      id: userId,
      source: "bearer",
      credentialId: "cred-1",
    })).toBe(`chef:${userId}`);
    expect(idempotencyClientKey({
      id: userId,
      source: "session",
    })).toBe(`chef:${userId}`);
    expect(idempotencyClientKey({
      id: userId,
      source: "bearer",
    })).toBe(`chef:${userId}`);
  });

  it("reserves first use, completes it, and replays exact requests with the current request id", async () => {
    const credential = await createApiCredential(db, userId, `Client ${faker.string.alphanumeric(6)}`);
    const requestHash = await hashIdempotencyRequest({
      method: "POST",
      path: "/api/v1/shopping-list/items",
      body: { clientMutationId: "m1", name: "Eggs" },
    });
    const clientKey = idempotencyClientKey({
      id: userId,
      source: "bearer",
      credentialId: credential.credential.id,
    });

    const first = await reserveIdempotencyKey(db, {
      userId,
      credentialId: credential.credential.id,
      clientKey,
      key: "m1",
      operation: "shopping_list.items.create",
      requestHash,
      now,
    });

    expect(first).toMatchObject({
      status: "reserved",
      record: {
        userId,
        credentialId: credential.credential.id,
        clientKey,
        key: "m1",
        operation: "shopping_list.items.create",
        requestHash,
        responseStatus: null,
        responseBody: null,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      },
    });

    if (first.status !== "reserved") throw new Error("expected reservation");
    await completeIdempotencyKey(db, first.record.id, {
      status: 201,
      body: {
        ok: true,
        requestId: "req_old",
        data: {
          item: { id: "item-1", name: "Eggs" },
          mutation: { clientMutationId: "m1", replayed: false },
        },
      },
    });

    const replay = await reserveIdempotencyKey(db, {
      userId,
      credentialId: credential.credential.id,
      clientKey,
      key: "m1",
      operation: "shopping_list.items.create",
      requestHash,
      now: new Date(now.getTime() + 1_000),
    });

    expect(replay.status).toBe("replay");
    if (replay.status !== "replay") throw new Error("expected replay");
    expect(replayIdempotencyResponse(replay.record, "req_current")).toEqual({
      status: 201,
      body: {
        ok: true,
        requestId: "req_current",
        data: {
          item: { id: "item-1", name: "Eggs" },
          mutation: { clientMutationId: "m1", replayed: true },
        },
      },
    });
  });

  it("reports conflicts for reused keys with different operation or request hash", async () => {
    const requestHash = await hashIdempotencyRequest({
      method: "PATCH",
      path: "/api/v1/shopping-list/items/item-1",
      body: { clientMutationId: "m2", checked: true },
    });
    const changedHash = await hashIdempotencyRequest({
      method: "PATCH",
      path: "/api/v1/shopping-list/items/item-1",
      body: { clientMutationId: "m2", checked: false },
    });

    await reserveIdempotencyKey(db, {
      userId,
      clientKey: `session:${userId}`,
      key: "m2",
      operation: "shopping_list.items.check",
      requestHash,
      now,
    });

    await expect(reserveIdempotencyKey(db, {
      userId,
      clientKey: `session:${userId}`,
      key: "m2",
      operation: "shopping_list.items.delete",
      requestHash,
      now,
    })).resolves.toMatchObject({ status: "conflict" });
    await expect(reserveIdempotencyKey(db, {
      userId,
      clientKey: `session:${userId}`,
      key: "m2",
      operation: "shopping_list.items.check",
      requestHash: changedHash,
      now,
    })).resolves.toMatchObject({ status: "conflict" });

    expect(new IdempotencyConflictError()).toMatchObject({
      name: "IdempotencyConflictError",
      code: "idempotency_conflict",
      status: 409,
      message: "Idempotency key was already used for a different request",
    });
    expect(new IdempotencyConflictError("custom")).toMatchObject({ message: "custom" });
  });

  it("replays stored error responses and rejects incomplete response rows", async () => {
    const failed = replayIdempotencyResponse({
      responseStatus: 400,
      responseBody: JSON.stringify({
        ok: false,
        requestId: "req_old",
        error: { code: "validation_error", message: "Bad", status: 400 },
      }),
    }, "req_new");
    const primitive = replayIdempotencyResponse({
      responseStatus: 202,
      responseBody: JSON.stringify("accepted"),
    }, "req_primitive");

    expect(failed).toEqual({
      status: 400,
      body: {
        ok: false,
        requestId: "req_new",
        error: { code: "validation_error", message: "Bad", status: 400 },
      },
    });
    expect(() => replayIdempotencyResponse({ responseStatus: null, responseBody: null }, "req_pending"))
      .toThrow("not complete");
    expect(primitive).toEqual({ status: 202, body: "accepted" });
  });

  it("returns in-flight for incomplete rows until the idempotency key expires", async () => {
    const requestHash = await hashIdempotencyRequest({
      method: "POST",
      path: "/api/v1/shopping-list/items",
      body: { clientMutationId: "m-pending", name: "Eggs" },
    });
    const clientKey = idempotencyClientKey({ id: userId, source: "session" });
    const first = await reserveIdempotencyKey(db, {
      userId,
      clientKey,
      key: "m-pending",
      operation: "shopping_list.items.create",
      requestHash,
      now,
    });
    if (first.status !== "reserved") throw new Error("expected reservation");

    await expect(reserveIdempotencyKey(db, {
      userId,
      clientKey,
      key: "m-pending",
      operation: "shopping_list.items.create",
      requestHash,
      now: new Date(now.getTime() + 1_000),
    })).resolves.toMatchObject({ status: "in_flight" });

    await db.apiIdempotencyKey.update({
      where: { id: first.record.id },
      data: { updatedAt: new Date(now.getTime() - 60_001) },
    });

    const stillInFlight = await reserveIdempotencyKey(db, {
      userId,
      clientKey,
      key: "m-pending",
      operation: "shopping_list.items.create",
      requestHash,
      now,
    });

    expect(stillInFlight).toMatchObject({ status: "in_flight", record: { id: first.record.id } });
  });

  it("replays stored rows even if their original credential was later revoked", async () => {
    const credential = await createApiCredential(db, userId, `Replay ${faker.string.alphanumeric(6)}`);
    const requestHash = await hashIdempotencyRequest({
      method: "DELETE",
      path: "/api/v1/shopping-list/items/item-1",
      body: { clientMutationId: "m3" },
    });
    const clientKey = `credential:${credential.credential.id}`;
    const reserved = await reserveIdempotencyKey(db, {
      userId,
      credentialId: credential.credential.id,
      clientKey,
      key: "m3",
      operation: "shopping_list.items.delete",
      requestHash,
      now,
    });
    if (reserved.status !== "reserved") throw new Error("expected reservation");

    await completeIdempotencyKey(db, reserved.record.id, {
      status: 200,
      body: { ok: true, requestId: "req_old", data: { mutation: { clientMutationId: "m3", replayed: false } } },
    });
    await db.apiCredential.update({
      where: { id: credential.credential.id },
      data: { revokedAt: new Date(now.getTime() + 1_000) },
    });

    await expect(reserveIdempotencyKey(db, {
      userId,
      credentialId: credential.credential.id,
      clientKey,
      key: "m3",
      operation: "shopping_list.items.delete",
      requestHash,
      now: new Date(now.getTime() + 2_000),
    })).resolves.toMatchObject({ status: "replay" });
  });

  it("deletes expired rows for the same key before reservation so keys can be reused", async () => {
    const oldHash = await hashIdempotencyRequest({
      method: "POST",
      path: "/api/v1/shopping-list/items",
      body: { clientMutationId: "reuse", name: "Milk" },
    });
    const newHash = await hashIdempotencyRequest({
      method: "POST",
      path: "/api/v1/shopping-list/items",
      body: { clientMutationId: "reuse", name: "Oats" },
    });
    const first = await reserveIdempotencyKey(db, {
      userId,
      clientKey: `session:${userId}`,
      key: "reuse",
      operation: "shopping_list.items.create",
      requestHash: oldHash,
      now,
    });
    if (first.status !== "reserved") throw new Error("expected reservation");
    await db.apiIdempotencyKey.update({
      where: { id: first.record.id },
      data: { expiresAt: new Date(now.getTime() - 1) },
    });

    const reused = await reserveIdempotencyKey(db, {
      userId,
      clientKey: `session:${userId}`,
      key: "reuse",
      operation: "shopping_list.items.create",
      requestHash: newHash,
      now,
    });

    expect(reused).toMatchObject({
      status: "reserved",
      record: { key: "reuse", requestHash: newHash },
    });
    expect(await db.apiIdempotencyKey.count({
      where: { userId, clientKey: `session:${userId}`, key: "reuse" },
    })).toBe(1);
  });

  it("recovers only true unique-key reservation races", async () => {
    const racedRecord = {
      id: "race-id",
      userId,
      credentialId: null,
      clientKey: `session:${userId}`,
      key: "race",
      operation: "shopping_list.items.create",
      requestHash: "hash",
      responseStatus: null,
      responseBody: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
    };

    const raceDb = (target: unknown, raced: unknown = racedRecord) => ({
      apiIdempotencyKey: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(raced),
        create: vi.fn(async () => {
          throw { code: "P2002", meta: { target } };
        }),
      },
    }) as any;

    await expect(reserveIdempotencyKey(raceDb("ApiIdempotencyKey_userId_clientKey_key_key"), {
      userId,
      clientKey: `session:${userId}`,
      key: "race",
      operation: "shopping_list.items.create",
      requestHash: "hash",
      now,
    })).resolves.toMatchObject({ status: "in_flight", record: { id: "race-id" } });

    await expect(reserveIdempotencyKey(raceDb(["userId", "clientKey", "key"]), {
      userId,
      clientKey: `session:${userId}`,
      key: "race",
      operation: "shopping_list.items.create",
      requestHash: "changed",
      now,
    })).resolves.toMatchObject({ status: "conflict", record: { id: "race-id" } });

    await expect(reserveIdempotencyKey(raceDb({ userId_clientKey_key: { userId, clientKey: "client", key: "race" } }, null), {
      userId,
      clientKey: `session:${userId}`,
      key: "race",
      operation: "shopping_list.items.create",
      requestHash: "hash",
      now,
    })).rejects.toMatchObject({ code: "P2002" });

    await expect(reserveIdempotencyKey(raceDb(["userId"]), {
      userId,
      clientKey: `session:${userId}`,
      key: "race",
      operation: "shopping_list.items.create",
      requestHash: "hash",
      now,
    })).rejects.toMatchObject({ code: "P2002" });

    const nonPrismaDb = {
      apiIdempotencyKey: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => {
          throw new Error("not unique");
        }),
      },
    } as any;

    await expect(reserveIdempotencyKey(nonPrismaDb, {
      userId,
      clientKey: `session:${userId}`,
      key: "race",
      operation: "shopping_list.items.create",
      requestHash: "hash",
      now,
    })).rejects.toThrow("not unique");

    const falsyRaceDb = {
      apiIdempotencyKey: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => {
          throw null;
        }),
      },
    } as any;

    await expect(reserveIdempotencyKey(falsyRaceDb, {
      userId,
      clientKey: `session:${userId}`,
      key: "race",
      operation: "shopping_list.items.create",
      requestHash: "hash",
      now,
    })).rejects.toBeNull();

    const primitiveRaceDb = {
      apiIdempotencyKey: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => {
          throw "not an object";
        }),
      },
    } as any;

    await expect(reserveIdempotencyKey(primitiveRaceDb, {
      userId,
      clientKey: `session:${userId}`,
      key: "race",
      operation: "shopping_list.items.create",
      requestHash: "hash",
      now,
    })).rejects.toBe("not an object");
  });

  it("uses the current time when no reservation clock is provided", async () => {
    const before = Date.now();
    const requestHash = await hashIdempotencyRequest({
      method: "POST",
      path: "/api/v1/shopping-list/items",
      body: { clientMutationId: "clock", name: "Flour" },
    });

    const result = await reserveIdempotencyKey(db, {
      userId,
      clientKey: `session:${userId}`,
      key: "clock",
      operation: "shopping_list.items.create",
      requestHash,
    });

    expect(result.status).toBe("reserved");
    if (result.status !== "reserved") throw new Error("expected reservation");
    expect(result.record.expiresAt.getTime()).toBeGreaterThanOrEqual(before + IDEMPOTENCY_TTL_MS);
  });
});
