import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { getLocalDb } from "~/lib/db.server";
import {
  enqueueNotification,
  type NotificationDispatchDeps,
} from "~/lib/notification-dispatch.server";
import { createTestUser } from "../utils";

const VAPID = {
  publicKey: "test-pub",
  privateKey: "test-priv",
  subject: "mailto:test@example.com",
};

const VALID_KEYS = {
  p256dh:
    "BHpzJ01VsKtS08clJYyuN-WasvuNNaWOtg_nkE60YRoy0Ez9X2F-ITgDKWbh8EzAMLpx9rskKADfMbadO3yo5rQ",
  auth: "AAECAwQFBgcICQoLDA0ODw",
};

interface CreatedUser {
  id: string;
  username: string;
  email: string;
}

async function createUser(): Promise<CreatedUser> {
  const db = await getLocalDb();
  const t = createTestUser();
  return db.user.create({
    data: { email: t.email, username: t.username, hashedPassword: t.hashedPassword, salt: t.salt },
    select: { id: true, username: true, email: true },
  });
}

async function createSubscription(userId: string, suffix: string) {
  const db = await getLocalDb();
  return db.pushSubscription.create({
    data: {
      userId,
      endpoint: `https://push.example/${suffix}-${Date.now()}-${Math.random()}`,
      p256dh: VALID_KEYS.p256dh,
      authSecret: VALID_KEYS.auth,
    },
  });
}

afterEach(async () => {
  const db = await getLocalDb();
  await db.notificationPreference.deleteMany({});
  await db.notificationEvent.deleteMany({});
  await db.pushSubscription.deleteMany({});
  await db.user.deleteMany({});
});

function deps(overrides?: Partial<NotificationDispatchDeps>): NotificationDispatchDeps {
  const waitUntil = vi.fn((p: Promise<unknown>) => {
    void p;
  });
  return {
    vapid: VAPID,
    waitUntil,
    sendPush: vi.fn(async () => ({
      status: "delivered" as const,
      httpStatus: 201,
      providerEndpoint: "x",
    })),
    ...overrides,
  };
}

describe("enqueueNotification", () => {
  it("returns no-op result and writes nothing for self-events", async () => {
    const db = await getLocalDb();
    const user = await createUser();
    const d = deps();

    const result = await enqueueNotification(
      db,
      {
        actorId: user.id,
        recipientId: user.id,
        kind: "spoon_on_my_recipe",
        payload: { recipeId: "r1" },
      },
      d,
    );

    expect(result).toEqual({ eventId: null, queuedSends: 0 });
    const events = await db.notificationEvent.count();
    expect(events).toBe(0);
    expect(d.sendPush).not.toHaveBeenCalled();
    expect(d.waitUntil).not.toHaveBeenCalled();
  });

  it("writes a NotificationEvent row and queues one send per active subscription", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "a");
    await createSubscription(recipient.id, "b");

    const d = deps();
    const result = await enqueueNotification(
      db,
      {
        actorId: actor.id,
        recipientId: recipient.id,
        kind: "spoon_on_my_recipe",
        payload: { recipeId: "r1", recipeTitle: "Pie", spoonerUsername: actor.username },
      },
      d,
    );

    expect(result.eventId).not.toBeNull();
    expect(result.queuedSends).toBe(2);
    expect(d.waitUntil).toHaveBeenCalledTimes(2);

    const event = await db.notificationEvent.findUniqueOrThrow({
      where: { id: result.eventId! },
    });
    expect(event.recipientId).toBe(recipient.id);
    expect(event.kind).toBe("spoon_on_my_recipe");
    expect(event.payload).toMatch(/"recipeId":"r1"/);
  });

  it("treats default-true preference when no NotificationPreference row exists", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "x");
    const d = deps();

    const result = await enqueueNotification(
      db,
      {
        actorId: actor.id,
        recipientId: recipient.id,
        kind: "fork_of_my_recipe",
        payload: {},
      },
      d,
    );

    expect(result.queuedSends).toBe(1);
  });

  it("skips push send (but still logs the event) when the kind preference is false", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "z");
    await db.notificationPreference.create({
      data: {
        userId: recipient.id,
        notifySpoonOnMyRecipe: false,
      },
    });
    const d = deps();

    const result = await enqueueNotification(
      db,
      {
        actorId: actor.id,
        recipientId: recipient.id,
        kind: "spoon_on_my_recipe",
        payload: {},
      },
      d,
    );

    expect(result.queuedSends).toBe(0);
    expect(result.eventId).not.toBeNull();
    expect(d.sendPush).not.toHaveBeenCalled();
  });

  it("returns queuedSends=0 when recipient has no active subscriptions", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    const d = deps();
    const result = await enqueueNotification(
      db,
      {
        actorId: actor.id,
        recipientId: recipient.id,
        kind: "cookbook_save_of_mine",
        payload: {},
      },
      d,
    );
    expect(result.queuedSends).toBe(0);
    expect(result.eventId).not.toBeNull();
  });

  it("prunes (deletes) the subscription row when sendPush returns 'expired'", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    const goodSub = await createSubscription(recipient.id, "good");
    const expiredSub = await createSubscription(recipient.id, "exp");

    const sendPushMock = vi.fn(async (sub: { endpoint: string }) => {
      if (sub.endpoint === expiredSub.endpoint) {
        return { status: "expired" as const, httpStatus: 410, providerEndpoint: sub.endpoint };
      }
      return { status: "delivered" as const, httpStatus: 201, providerEndpoint: sub.endpoint };
    });

    const tasks: Promise<unknown>[] = [];
    const d = {
      vapid: VAPID,
      waitUntil: (p: Promise<unknown>) => {
        tasks.push(p);
      },
      sendPush: sendPushMock,
    };

    await enqueueNotification(
      db,
      {
        actorId: actor.id,
        recipientId: recipient.id,
        kind: "spoon_on_my_recipe",
        payload: {},
      },
      d,
    );

    await Promise.all(tasks);

    const remaining = await db.pushSubscription.findMany({
      where: { userId: recipient.id },
      select: { id: true },
    });
    const remainingIds = remaining.map((r) => r.id);
    expect(remainingIds).toContain(goodSub.id);
    expect(remainingIds).not.toContain(expiredSub.id);
  });

  it("isolates failures: one failing send does not prevent the other from being attempted", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "good");
    await createSubscription(recipient.id, "bad");

    const sendPushMock = vi.fn(async (sub: { endpoint: string }) => {
      if (sub.endpoint.includes("bad")) {
        throw new Error("boom");
      }
      return { status: "delivered" as const, httpStatus: 201, providerEndpoint: sub.endpoint };
    });

    const tasks: Promise<unknown>[] = [];
    const d = {
      vapid: VAPID,
      waitUntil: (p: Promise<unknown>) => {
        tasks.push(p);
      },
      sendPush: sendPushMock,
    };

    await enqueueNotification(
      db,
      {
        actorId: actor.id,
        recipientId: recipient.id,
        kind: "spoon_on_my_recipe",
        payload: {},
      },
      d,
    );

    // Awaiting tasks should not throw — failures are swallowed inside the per-sub promise.
    await expect(Promise.all(tasks)).resolves.toBeDefined();
    expect(sendPushMock).toHaveBeenCalledTimes(2);
  });

  it("updates NotificationEvent.pushDeliveredAt on the first 2xx send", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "p");

    const tasks: Promise<unknown>[] = [];
    const d = {
      vapid: VAPID,
      waitUntil: (p: Promise<unknown>) => {
        tasks.push(p);
      },
      sendPush: vi.fn(async (sub: { endpoint: string }) => ({
        status: "delivered" as const,
        httpStatus: 201,
        providerEndpoint: sub.endpoint,
      })),
    };

    const result = await enqueueNotification(
      db,
      {
        actorId: actor.id,
        recipientId: recipient.id,
        kind: "fork_of_my_recipe",
        payload: {},
      },
      d,
    );

    await Promise.all(tasks);

    const event = await db.notificationEvent.findUniqueOrThrow({
      where: { id: result.eventId! },
    });
    expect(event.pushDeliveredAt).not.toBeNull();
  });

  it("does NOT mark pushDeliveredAt when no send succeeds", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "p");

    const tasks: Promise<unknown>[] = [];
    const d = {
      vapid: VAPID,
      waitUntil: (p: Promise<unknown>) => {
        tasks.push(p);
      },
      sendPush: vi.fn(async (sub: { endpoint: string }) => ({
        status: "failed" as const,
        httpStatus: 500,
        providerEndpoint: sub.endpoint,
      })),
    };

    const result = await enqueueNotification(
      db,
      {
        actorId: actor.id,
        recipientId: recipient.id,
        kind: "fork_of_my_recipe",
        payload: {},
      },
      d,
    );

    await Promise.all(tasks);

    const event = await db.notificationEvent.findUniqueOrThrow({
      where: { id: result.eventId! },
    });
    expect(event.pushDeliveredAt).toBeNull();
  });

  it("awaits inline when no waitUntil dep is provided", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "inline");

    const sendPushMock = vi.fn(async (sub: { endpoint: string }) => ({
      status: "delivered" as const,
      httpStatus: 201,
      providerEndpoint: sub.endpoint,
    }));

    const result = await enqueueNotification(
      db,
      {
        actorId: actor.id,
        recipientId: recipient.id,
        kind: "spoon_on_my_recipe",
        payload: { recipeId: "r" },
      },
      { vapid: VAPID, sendPush: sendPushMock },
    );

    expect(result.queuedSends).toBe(1);
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    const event = await db.notificationEvent.findUniqueOrThrow({
      where: { id: result.eventId! },
    });
    expect(event.pushDeliveredAt).not.toBeNull();
  });

  it("builds correct body strings for every NotificationKind (cookbook + fellow chef)", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "k");

    const captured: Array<{ title: string; body: string; url: string }> = [];
    const sendPushMock = vi.fn(
      async (_sub: unknown, payload: { title: string; body: string; url: string }) => {
        captured.push(payload);
        return {
          status: "delivered" as const,
          httpStatus: 201,
          providerEndpoint: "x",
        };
      },
    );
    const tasks: Promise<unknown>[] = [];
    const d = {
      vapid: VAPID,
      waitUntil: (p: Promise<unknown>) => {
        tasks.push(p);
      },
      sendPush: sendPushMock as unknown as NotificationDispatchDeps["sendPush"],
    };

    await enqueueNotification(
      db,
      {
        actorId: actor.id,
        recipientId: recipient.id,
        kind: "cookbook_save_of_mine",
        payload: { recipeId: "r1", recipeTitle: "Pie", actorUsername: "alice" },
      },
      d,
    );

    await enqueueNotification(
      db,
      {
        actorId: actor.id,
        recipientId: recipient.id,
        kind: "fellow_chef_origin_cook",
        payload: { recipeId: "r2", recipeTitle: "Tart", spoonerUsername: "bob" },
      },
      d,
    );

    await Promise.all(tasks);

    expect(captured.find((c) => c.body.includes("saved"))).toBeDefined();
    expect(captured.find((c) => c.body.includes("just cooked their new recipe"))).toBeDefined();
  });

  it("falls back to '/' URL when payload contains no recipeId or forkedRecipeId", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "u");

    const captured: Array<{ url: string }> = [];
    const sendPushMock = vi.fn(
      async (_sub: unknown, payload: { url: string }) => {
        captured.push(payload);
        return {
          status: "delivered" as const,
          httpStatus: 201,
          providerEndpoint: "x",
        };
      },
    );
    const tasks: Promise<unknown>[] = [];
    await enqueueNotification(
      db,
      {
        actorId: actor.id,
        recipientId: recipient.id,
        kind: "spoon_on_my_recipe",
        payload: {},
      },
      {
        vapid: VAPID,
        waitUntil: (p: Promise<unknown>) => tasks.push(p),
        sendPush: sendPushMock as unknown as NotificationDispatchDeps["sendPush"],
      },
    );
    await Promise.all(tasks);
    expect(captured[0]?.url).toBe("/");
  });

  it("uses forkedRecipeId for the URL when only forkedRecipeId is provided", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "f");

    const captured: Array<{ url: string }> = [];
    const tasks: Promise<unknown>[] = [];
    await enqueueNotification(
      db,
      {
        actorId: actor.id,
        recipientId: recipient.id,
        kind: "fork_of_my_recipe",
        payload: { forkedRecipeId: "fr1" },
      },
      {
        vapid: VAPID,
        waitUntil: (p: Promise<unknown>) => tasks.push(p),
        sendPush: vi.fn(async (_sub, payload) => {
          captured.push(payload);
          return {
            status: "delivered" as const,
            httpStatus: 201,
            providerEndpoint: "x",
          };
        }) as unknown as NotificationDispatchDeps["sendPush"],
      },
    );
    await Promise.all(tasks);
    expect(captured[0]?.url).toBe("/recipes/fr1");
  });

  it("swallows the error if pruning an expired subscription throws (concurrent delete)", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "race");

    // Force the delete to throw.
    const origDelete = db.pushSubscription.delete;
    db.pushSubscription.delete = vi.fn(async () => {
      throw new Error("already gone");
    }) as unknown as typeof db.pushSubscription.delete;

    const tasks: Promise<unknown>[] = [];
    try {
      await enqueueNotification(
        db,
        {
          actorId: actor.id,
          recipientId: recipient.id,
          kind: "spoon_on_my_recipe",
          payload: {},
        },
        {
          vapid: VAPID,
          waitUntil: (p) => tasks.push(p),
          sendPush: vi.fn(async (sub: { endpoint: string }) => ({
            status: "expired" as const,
            httpStatus: 410,
            providerEndpoint: sub.endpoint,
          })),
        },
      );
      await expect(Promise.all(tasks)).resolves.toBeDefined();
    } finally {
      db.pushSubscription.delete = origDelete;
    }
  });

  it("uses the real sendPush import when no deps.sendPush is supplied (default branch)", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "real-fallback");
    const tasks: Promise<unknown>[] = [];

    const result = await enqueueNotification(
      db,
      {
        actorId: actor.id,
        recipientId: recipient.id,
        kind: "spoon_on_my_recipe",
        payload: { recipeId: "r1" },
      },
      {
        vapid: VAPID,
        waitUntil: (p) => tasks.push(p),
        // no sendPush — exercises realSendPush fallback.
      },
    );

    expect(result.queuedSends).toBe(1);
    // Per-subscription failure is isolated (we pass fake VAPID keys so the
    // real adapter will fail, but enqueueNotification itself returns cleanly).
    await Promise.all(tasks);
  });

  it("respects each kind's specific preference flag", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "k");
    await db.notificationPreference.create({
      data: {
        userId: recipient.id,
        notifySpoonOnMyRecipe: false,
        notifyForkOfMyRecipe: true,
        notifyCookbookSaveOfMine: false,
        notifyFellowChefOriginCook: true,
      },
    });

    const d = deps();

    const spoon = await enqueueNotification(
      db,
      { actorId: actor.id, recipientId: recipient.id, kind: "spoon_on_my_recipe", payload: {} },
      d,
    );
    expect(spoon.queuedSends).toBe(0);

    const fork = await enqueueNotification(
      db,
      { actorId: actor.id, recipientId: recipient.id, kind: "fork_of_my_recipe", payload: {} },
      d,
    );
    expect(fork.queuedSends).toBe(1);

    const cookbook = await enqueueNotification(
      db,
      {
        actorId: actor.id,
        recipientId: recipient.id,
        kind: "cookbook_save_of_mine",
        payload: {},
      },
      d,
    );
    expect(cookbook.queuedSends).toBe(0);

    const fellow = await enqueueNotification(
      db,
      {
        actorId: actor.id,
        recipientId: recipient.id,
        kind: "fellow_chef_origin_cook",
        payload: {},
      },
      d,
    );
    expect(fellow.queuedSends).toBe(1);
  });
});
