import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { getLocalDb } from "~/lib/db.server";
import {
  enqueueNotification,
  type NotificationDispatchDeps,
} from "~/lib/notification-dispatch.server";
import type { PostHogServerConfig } from "~/lib/analytics-server";
import { createTestUser } from "../utils";

const VAPID = {
  publicKey: "test-pub",
  privateKey: "test-priv",
  subject: "mailto:test@example.com",
};

const POSTHOG_ENABLED: PostHogServerConfig = {
  enabled: true,
  key: "ph_test",
  host: "https://posthog.example",
};

/** A fetch spy that stands in for the PostHog ingestion endpoint. */
function postHogFetchSpy() {
  return vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
}

/** Decode the JSON bodies the capture helpers POSTed to PostHog. */
function postHogBodies(
  fetchImpl: typeof fetch,
): Array<{ event: string; distinct_id: string; properties: Record<string, unknown> }> {
  return (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([, init]) =>
    JSON.parse((init as RequestInit).body as string),
  );
}

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

describe("enqueueNotification — telemetry capture", () => {
  let origFetch: typeof globalThis.fetch;
  let phFetch: ReturnType<typeof postHogFetchSpy>;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    phFetch = postHogFetchSpy();
    globalThis.fetch = phFetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("captures a push 'failed' result with httpStatus 0 as failureMode=no_response (VAPID/network)", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "fail0");

    const tasks: Promise<unknown>[] = [];
    await enqueueNotification(
      db,
      { actorId: actor.id, recipientId: recipient.id, kind: "spoon_on_my_recipe", payload: {} },
      {
        vapid: VAPID,
        postHogConfig: POSTHOG_ENABLED,
        waitUntil: (p) => tasks.push(p),
        sendPush: vi.fn(async (sub: { endpoint: string }) => ({
          status: "failed" as const,
          httpStatus: 0,
          providerEndpoint: sub.endpoint,
          error: "vapid sign failed",
        })),
      },
    );
    await Promise.all(tasks);

    const bodies = postHogBodies(phFetch);
    const sendFailed = bodies.find((b) => b.event === "spoonjoy.push.send_failed");
    expect(sendFailed).toBeDefined();
    expect(sendFailed!.distinct_id).toBe(recipient.id);
    expect(sendFailed!.properties.httpStatus).toBe(0);
    expect(sendFailed!.properties.failureMode).toBe("no_response");
    expect(sendFailed!.properties.pushError).toBe("vapid sign failed");
    expect(sendFailed!.properties.kind).toBe("spoon_on_my_recipe");
  });

  it("captures a push 'failed' result with a real status as failureMode=http_error (no error string omitted)", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "fail500");

    const tasks: Promise<unknown>[] = [];
    await enqueueNotification(
      db,
      { actorId: actor.id, recipientId: recipient.id, kind: "fork_of_my_recipe", payload: {} },
      {
        vapid: VAPID,
        postHogConfig: POSTHOG_ENABLED,
        waitUntil: (p) => tasks.push(p),
        sendPush: vi.fn(async (sub: { endpoint: string }) => ({
          status: "failed" as const,
          httpStatus: 503,
          providerEndpoint: sub.endpoint,
        })),
      },
    );
    await Promise.all(tasks);

    const sendFailed = postHogBodies(phFetch).find(
      (b) => b.event === "spoonjoy.push.send_failed",
    );
    expect(sendFailed).toBeDefined();
    expect(sendFailed!.properties.httpStatus).toBe(503);
    expect(sendFailed!.properties.failureMode).toBe("http_error");
    expect(sendFailed!.properties.pushError).toBeUndefined();
  });

  it("does NOT capture a push 'failed' result when postHogConfig is absent (no-op)", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "fail-noconfig");

    const tasks: Promise<unknown>[] = [];
    await enqueueNotification(
      db,
      { actorId: actor.id, recipientId: recipient.id, kind: "spoon_on_my_recipe", payload: {} },
      {
        vapid: VAPID,
        // no postHogConfig — scheduleCapture short-circuits.
        waitUntil: (p) => tasks.push(p),
        sendPush: vi.fn(async (sub: { endpoint: string }) => ({
          status: "failed" as const,
          httpStatus: 500,
          providerEndpoint: sub.endpoint,
        })),
      },
    );
    await Promise.all(tasks);
    expect(phFetch).not.toHaveBeenCalled();
  });

  it("captures a non-P2025 prune failure (dead endpoints accumulate) — L4", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "prune-boom");

    const origDelete = db.pushSubscription.delete;
    db.pushSubscription.delete = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw { code: "P2999", message: "delete failed" };
    }) as unknown as typeof db.pushSubscription.delete;

    const tasks: Promise<unknown>[] = [];
    try {
      await enqueueNotification(
        db,
        { actorId: actor.id, recipientId: recipient.id, kind: "spoon_on_my_recipe", payload: {} },
        {
          vapid: VAPID,
          postHogConfig: POSTHOG_ENABLED,
          waitUntil: (p) => tasks.push(p),
          sendPush: vi.fn(async (sub: { endpoint: string }) => ({
            status: "expired" as const,
            httpStatus: 410,
            providerEndpoint: sub.endpoint,
          })),
        },
      );
      await Promise.all(tasks);
    } finally {
      db.pushSubscription.delete = origDelete;
    }

    const pruneCapture = postHogBodies(phFetch).find(
      (b) => b.event === "$exception" && b.properties.phase === "prune",
    );
    expect(pruneCapture).toBeDefined();
    expect(pruneCapture!.properties.kind).toBe("spoon_on_my_recipe");
  });

  it("swallows a P2025 prune failure WITHOUT capturing (concurrent delete is expected)", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "prune-p2025");

    const origDelete = db.pushSubscription.delete;
    db.pushSubscription.delete = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw { code: "P2025", message: "record not found" };
    }) as unknown as typeof db.pushSubscription.delete;

    const tasks: Promise<unknown>[] = [];
    try {
      await enqueueNotification(
        db,
        { actorId: actor.id, recipientId: recipient.id, kind: "spoon_on_my_recipe", payload: {} },
        {
          vapid: VAPID,
          postHogConfig: POSTHOG_ENABLED,
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

    const pruneCapture = postHogBodies(phFetch).find(
      (b) => b.event === "$exception" && b.properties.phase === "prune",
    );
    expect(pruneCapture).toBeUndefined();
  });

  it("captures the swallowed send-task throw (H8) — sendPush throwing is isolated but observed", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "throwing");

    const tasks: Promise<unknown>[] = [];
    await enqueueNotification(
      db,
      { actorId: actor.id, recipientId: recipient.id, kind: "cookbook_save_of_mine", payload: {} },
      {
        vapid: VAPID,
        postHogConfig: POSTHOG_ENABLED,
        waitUntil: (p) => tasks.push(p),
        sendPush: vi.fn(async () => {
          throw new Error("send boom");
        }),
      },
    );
    await expect(Promise.all(tasks)).resolves.toBeDefined();

    const sendTaskCapture = postHogBodies(phFetch).find(
      (b) => b.event === "$exception" && b.properties.phase === "sendTask",
    );
    expect(sendTaskCapture).toBeDefined();
    expect(sendTaskCapture!.distinct_id).toBe(recipient.id);
    expect(sendTaskCapture!.properties.kind).toBe("cookbook_save_of_mine");
  });

  it("captures when the markDelivered UPDATE itself throws (L5) and does not suppress retry", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "mark-fail");

    const origUpdate = db.notificationEvent.update;
    db.notificationEvent.update = vi.fn(async () => {
      throw new Error("update boom");
    }) as unknown as typeof db.notificationEvent.update;

    const tasks: Promise<unknown>[] = [];
    try {
      await enqueueNotification(
        db,
        { actorId: actor.id, recipientId: recipient.id, kind: "spoon_on_my_recipe", payload: {} },
        {
          vapid: VAPID,
          postHogConfig: POSTHOG_ENABLED,
          waitUntil: (p) => tasks.push(p),
          sendPush: vi.fn(async (sub: { endpoint: string }) => ({
            status: "delivered" as const,
            httpStatus: 201,
            providerEndpoint: sub.endpoint,
          })),
        },
      );
      await expect(Promise.all(tasks)).resolves.toBeDefined();
    } finally {
      db.notificationEvent.update = origUpdate;
    }

    const captured = postHogBodies(phFetch).find(
      (b) => b.event === "$exception" && b.properties.phase === "sendTask",
    );
    expect(captured).toBeDefined();
  });

  it("captures a real D1 failure on the durable log (M4) then rethrows for caller isolation", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();

    const origCreate = db.notificationEvent.create;
    db.notificationEvent.create = vi.fn(async () => {
      throw new Error("D1 down");
    }) as unknown as typeof db.notificationEvent.create;

    const tasks: Promise<unknown>[] = [];
    try {
      await expect(
        enqueueNotification(
          db,
          { actorId: actor.id, recipientId: recipient.id, kind: "spoon_on_my_recipe", payload: {} },
          {
            vapid: VAPID,
            postHogConfig: POSTHOG_ENABLED,
            waitUntil: (p) => tasks.push(p),
          },
        ),
      ).rejects.toThrow("D1 down");
      await Promise.all(tasks);
    } finally {
      db.notificationEvent.create = origCreate;
    }

    const durableCapture = postHogBodies(phFetch).find(
      (b) => b.event === "$exception" && b.properties.phase === "durableWrite",
    );
    expect(durableCapture).toBeDefined();
    expect(durableCapture!.distinct_id).toBe(recipient.id);
    expect(durableCapture!.properties.kind).toBe("spoon_on_my_recipe");
  });

  it("captures a non-object prune throw (prismaErrorCode returns undefined ≠ P2025)", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "prune-string");

    const origDelete = db.pushSubscription.delete;
    db.pushSubscription.delete = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "plain string delete failure";
    }) as unknown as typeof db.pushSubscription.delete;

    const tasks: Promise<unknown>[] = [];
    try {
      await enqueueNotification(
        db,
        { actorId: actor.id, recipientId: recipient.id, kind: "spoon_on_my_recipe", payload: {} },
        {
          vapid: VAPID,
          postHogConfig: POSTHOG_ENABLED,
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

    const pruneCapture = postHogBodies(phFetch).find(
      (b) => b.event === "$exception" && b.properties.phase === "prune",
    );
    expect(pruneCapture).toBeDefined();
  });

  it("converges two inline delivered sends to a single UPDATE (markDelivered early-return)", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "conv-a");
    await createSubscription(recipient.id, "conv-b");

    const origUpdate = db.notificationEvent.update;
    const updateSpy = vi.fn((args: unknown) =>
      (origUpdate as (a: unknown) => unknown).call(db.notificationEvent, args),
    );
    db.notificationEvent.update = updateSpy as unknown as typeof db.notificationEvent.update;
    try {
      const result = await enqueueNotification(
        db,
        { actorId: actor.id, recipientId: recipient.id, kind: "spoon_on_my_recipe", payload: {} },
        {
          vapid: VAPID,
          postHogConfig: POSTHOG_ENABLED,
          // No waitUntil: sends run inline + sequentially, so the first send's
          // UPDATE resolves (setting the flag) before the second send checks it.
          sendPush: vi.fn(async (sub: { endpoint: string }) => ({
            status: "delivered" as const,
            httpStatus: 201,
            providerEndpoint: sub.endpoint,
          })),
        },
      );
      expect(result.queuedSends).toBe(2);
      // Exactly one UPDATE despite two delivered sends.
      expect(updateSpy).toHaveBeenCalledTimes(1);
      const event = await db.notificationEvent.findUniqueOrThrow({
        where: { id: result.eventId! },
      });
      expect(event.pushDeliveredAt).not.toBeNull();
    } finally {
      db.notificationEvent.update = origUpdate;
    }
  });

  it("awaits capture inline (no waitUntil) so it still fires without a scheduler", async () => {
    const db = await getLocalDb();
    const actor = await createUser();
    const recipient = await createUser();
    await createSubscription(recipient.id, "inline-cap");

    await enqueueNotification(
      db,
      { actorId: actor.id, recipientId: recipient.id, kind: "spoon_on_my_recipe", payload: {} },
      {
        vapid: VAPID,
        postHogConfig: POSTHOG_ENABLED,
        // no waitUntil — sends run inline, capture is voided inline.
        sendPush: vi.fn(async (sub: { endpoint: string }) => ({
          status: "failed" as const,
          httpStatus: 429,
          providerEndpoint: sub.endpoint,
        })),
      },
    );
    // Allow the voided capture microtask to settle.
    await new Promise((r) => setTimeout(r, 0));

    const sendFailed = postHogBodies(phFetch).find(
      (b) => b.event === "spoonjoy.push.send_failed",
    );
    expect(sendFailed).toBeDefined();
  });
});
