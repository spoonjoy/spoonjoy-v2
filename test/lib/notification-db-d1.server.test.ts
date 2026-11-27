// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { enqueueNotification, type NotificationDispatchDeps } from "~/lib/notification-dispatch.server";
import { notificationDbOnD1 } from "~/lib/notification-db-d1.server";
import { sealNativePushToken } from "~/lib/native-push-token.server";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// The notification dispatcher on a D1 binding, as the fork and cook notifications run it after
// the answer: every read and write it makes must match the Prisma path, so the background work
// needs no Prisma client (merge-group run 45528383350 hung on one).

const VAPID = { publicKey: "test-pub", privateKey: "test-priv", subject: "mailto:test@example.com" };

let db: PrismaClient;
let d1: SqliteD1;

async function chef() {
  const t = createTestUser();
  return db.user.create({
    data: { email: t.email, username: t.username, hashedPassword: t.hashedPassword, salt: t.salt },
    select: { id: true, username: true },
  });
}

async function subscription(userId: string, suffix: string) {
  return db.pushSubscription.create({
    data: { userId, endpoint: `https://push.example/${suffix}-${Math.random()}`, p256dh: "p256dh", authSecret: "auth" },
  });
}

function deps(overrides: Partial<NotificationDispatchDeps> = {}): NotificationDispatchDeps & { scheduled: Promise<unknown>[] } {
  const scheduled: Promise<unknown>[] = [];
  return {
    vapid: VAPID,
    waitUntil: (task) => scheduled.push(task),
    sendPush: vi.fn(async () => ({ status: "delivered" as const, httpStatus: 201, providerEndpoint: "x" })),
    scheduled,
    ...overrides,
  };
}

beforeEach(async () => {
  db = await getLocalDb();
  await cleanupDatabase();
  d1 = sqliteD1();
});

afterEach(async () => {
  d1.close();
  await cleanupDatabase();
});

describe("notificationDbOnD1", () => {
  it("logs the event, pushes to each subscription and marks it delivered, as the Prisma path does", async () => {
    const [owner, forker] = [await chef(), await chef()];
    await subscription(owner.id, "a");
    await subscription(owner.id, "b");
    const d = deps();

    const result = await enqueueNotification(
      notificationDbOnD1(d1.binding),
      { actorId: forker.id, recipientId: owner.id, kind: "fork_of_my_recipe", triggerKey: "fork-1", payload: { recipeId: "r1", recipeTitle: "Bread", forkerUsername: forker.username } },
      d,
    );
    await Promise.all(d.scheduled);

    expect(result).toEqual({ eventId: expect.any(String), queuedSends: 2 });
    const event = await db.notificationEvent.findUniqueOrThrow({ where: { id: result.eventId! } });
    expect(event).toMatchObject({ recipientId: owner.id, kind: "fork_of_my_recipe", readAt: null });
    expect(JSON.parse(event.payload)).toEqual({ recipeId: "r1", recipeTitle: "Bread", forkerUsername: forker.username });
    expect(event.createdAt).toBeInstanceOf(Date);
    expect(event.pushDeliveredAt).toBeInstanceOf(Date);
    expect(d.sendPush).toHaveBeenCalledTimes(2);
  });

  it("writes one event for a repeated trigger: the second create's conflict reads as Prisma's P2002", async () => {
    const [owner, forker] = [await chef(), await chef()];
    const input = { actorId: forker.id, recipientId: owner.id, kind: "fork_of_my_recipe" as const, triggerKey: "fork-1", payload: {} };
    const first = await enqueueNotification(notificationDbOnD1(d1.binding), input, deps());
    const again = await enqueueNotification(notificationDbOnD1(d1.binding), input, deps());
    expect(again).toEqual({ eventId: first.eventId, queuedSends: 0 });
    expect(await db.notificationEvent.count({ where: { recipientId: owner.id } })).toBe(1);
  });

  it("hears nothing from a blocked chef, and honours a preference that turns the kind off", async () => {
    const [owner, forker, other] = [await chef(), await chef(), await chef()];
    await subscription(owner.id, "a");
    await db.chefBlock.create({ data: { blockerId: owner.id, blockedId: forker.id } });
    const store = notificationDbOnD1(d1.binding);

    expect(await enqueueNotification(store, { actorId: forker.id, recipientId: owner.id, kind: "spoon_on_my_recipe", payload: {} }, deps()))
      .toEqual({ eventId: null, queuedSends: 0 });

    await db.notificationPreference.create({ data: { userId: owner.id, notifySpoonOnMyRecipe: false } });
    const d = deps();
    const off = await enqueueNotification(store, { actorId: other.id, recipientId: owner.id, kind: "spoon_on_my_recipe", payload: {} }, d);
    expect(off).toEqual({ eventId: expect.any(String), queuedSends: 0 });
    expect(d.sendPush).not.toHaveBeenCalled();
    expect(await store.notificationPreference.findUnique({ where: { userId: owner.id } })).toEqual({
      notifySpoonOnMyRecipe: false,
      notifyForkOfMyRecipe: true,
      notifyCookbookSaveOfMine: true,
      notifyFellowChefOriginCook: true,
    });
  });

  it("prunes an expired subscription, and deleting one that is already gone reads as Prisma's P2025", async () => {
    const [owner, forker] = [await chef(), await chef()];
    const sub = await subscription(owner.id, "a");
    const d = deps({ sendPush: vi.fn(async () => ({ status: "expired" as const, httpStatus: 410, providerEndpoint: "x" })) });

    await enqueueNotification(notificationDbOnD1(d1.binding), { actorId: forker.id, recipientId: owner.id, kind: "spoon_on_my_recipe", payload: {} }, d);
    await Promise.all(d.scheduled);

    expect(await db.pushSubscription.count({ where: { id: sub.id } })).toBe(0);
    await expect(notificationDbOnD1(d1.binding).pushSubscription.delete({ where: { id: sub.id } })).rejects.toMatchObject({ code: "P2025" });
  });

  it("sends to an owner's live Apple devices and revokes a dead one, as the Prisma path does", async () => {
    const [owner, forker] = [await chef(), await chef()];
    const nativePush = { relayUrl: "https://relay.example", relayKey: "sjr1.id.sig", tokenSecret: "native-secret" };
    const sealed = (deviceId: string) =>
      sealNativePushToken(nativePush.tokenSecret, { userId: owner.id, deviceId, platform: "ios", environment: "production" }, `${deviceId}-token`);
    const base = { userId: owner.id, platform: "ios", environment: "production", tokenPrefix: "t" };
    const live = await db.nativePushDevice.create({ data: { ...base, deviceId: "b-phone", tokenHash: "h1", sealedToken: await sealed("b-phone") } });
    const dead = await db.nativePushDevice.create({ data: { ...base, deviceId: "a-pad", tokenHash: "h2", sealedToken: await sealed("a-pad") } });
    await db.nativePushDevice.create({ data: { ...base, deviceId: "c-old", tokenHash: "h3", sealedToken: await sealed("c-old"), revokedAt: "2026-01-01T00:00:00.000Z" } });
    await db.nativePushDevice.create({ data: { ...base, deviceId: "d-unsealed", tokenHash: "h4" } });
    const store = notificationDbOnD1(d1.binding);

    expect((await store.nativePushDevice.findMany({
      where: { userId: owner.id, revokedAt: null, sealedToken: { not: null } },
      select: { id: true, deviceId: true, platform: true, environment: true, sealedToken: true },
    })).map((row) => row.id)).toEqual([live.id, dead.id].sort());

    const sendNativePush = vi.fn(async (_config: unknown, target: { token: string }) =>
      target.token === "a-pad-token"
        ? { status: "expired" as const, httpStatus: 200, apnsStatus: 410, reason: "Unregistered" }
        : { status: "delivered" as const, httpStatus: 200, apnsStatus: 200 });
    const d = deps({ nativePush, sendNativePush });
    const result = await enqueueNotification(store, { actorId: forker.id, recipientId: owner.id, kind: "spoon_on_my_recipe", payload: {} }, d);
    await Promise.all(d.scheduled);

    expect(result.queuedSends).toBe(2);
    expect(sendNativePush).toHaveBeenCalledTimes(2);
    await expect(db.nativePushDevice.findUniqueOrThrow({ where: { id: dead.id } })).resolves.toMatchObject({ revokedAt: expect.any(String), sealedToken: null });
    await expect(db.nativePushDevice.findUniqueOrThrow({ where: { id: live.id } })).resolves.toMatchObject({ revokedAt: null });
    const event = await db.notificationEvent.findUniqueOrThrow({ where: { id: result.eventId! } });
    expect(event.pushDeliveredAt).toBeInstanceOf(Date);

    // A revoke for a token the device no longer holds changes nothing.
    await store.nativePushDevice.updateMany({ where: { id: live.id, revokedAt: null, sealedToken: "v1.old.token" }, data: { revokedAt: "2026-11-26T00:00:00.000Z", sealedToken: null } });
    await expect(db.nativePushDevice.findUniqueOrThrow({ where: { id: live.id } })).resolves.toMatchObject({ revokedAt: null });

    // Without revokedAt it only drops the token, and the device stays live.
    const { sealedToken } = await db.nativePushDevice.findUniqueOrThrow({ where: { id: live.id } });
    await store.nativePushDevice.updateMany({ where: { id: live.id, revokedAt: null, sealedToken }, data: { sealedToken: null } });
    await expect(db.nativePushDevice.findUniqueOrThrow({ where: { id: live.id } })).resolves.toMatchObject({ revokedAt: null, sealedToken: null });
  });

  it("reads users and recipes by id, and answers null for missing rows", async () => {
    const owner = await chef();
    const recipe = await db.recipe.create({ data: { title: "Bread", chefId: owner.id } });
    const store = notificationDbOnD1(d1.binding);

    expect(await store.user.findUnique({ where: { id: owner.id }, select: { id: true, username: true } })).toEqual(owner);
    expect(await store.user.findUnique({ where: { id: "missing" }, select: { id: true, username: true } })).toBeNull();
    expect(await store.recipe.findUnique({ where: { id: recipe.id }, select: { id: true, title: true, chefId: true } }))
      .toEqual({ id: recipe.id, title: "Bread", chefId: owner.id });
    expect(await store.recipe.findUnique({ where: { id: "missing" }, select: { id: true, title: true, chefId: true } })).toBeNull();
    expect(await store.notificationEvent.findFirst({ where: { id: "missing", recipientId: owner.id }, select: { id: true } })).toBeNull();
  });

  it("passes on other write errors, and refuses a row whose text column is not text", async () => {
    const failing: D1ReadDatabase = {
      prepare: d1.binding.prepare,
      batch: async () => { throw new Error("D1_ERROR: database is locked"); },
    };
    await expect(
      notificationDbOnD1(failing).notificationEvent.create({ data: { id: "e1", recipientId: "u1", kind: "k", payload: "{}" }, select: { id: true } }),
    ).rejects.toThrow("database is locked");

    const numeric: D1ReadDatabase = {
      prepare: d1.binding.prepare,
      batch: async () => [{ results: [{ id: 7, username: "chef" }] }],
    };
    await expect(notificationDbOnD1(numeric).user.findUnique({ where: { id: "u1" }, select: { id: true, username: true } }))
      .rejects.toThrow("D1 column User.id is not text");
  });
});
