// @vitest-environment node
// Account, push and notification writes when D1's connection drops. After each outcome (the write
// never ran, it committed but its answer was lost, or it committed late, just before the retry)
// the rows are the ones a single successful write leaves and the answer is the one it would give;
// when every try is lost, the write gives up with a retryable error (a 503 on the web routes)
// instead of a 500.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { createApiCredential } from "~/lib/api-auth.server";
import { sessionStorage } from "~/lib/session.server";
import { saveAccountIdentity } from "~/lib/account-identity.server";
import { deleteAccount } from "~/lib/account-deletion.server";
import { enqueueNotification, notificationEventId, type EnqueueNotificationInput } from "~/lib/notification-dispatch.server";
import { notifyForkOfMyRecipe } from "~/lib/notification-triggers.server";
import { fanoutFellowChefOriginCook } from "~/lib/notification-fanout.server";
import { callSpoonjoyApiOperation } from "~/lib/spoonjoy-api.server";
import { D1_WRITE_UNAVAILABLE_MESSAGE, D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { migratedSqliteD1 } from "../helpers/migrated-sqlite";
import { flakyD1, NETWORK_LOST_MESSAGE, type FlakyOutcome } from "../helpers/flaky-d1";
import { createTestUser } from "../utils";

const platform = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("~/lib/route-platform.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/route-platform.server")>();
  return {
    ...actual,
    getRequestDb: vi.fn(async (context: never) => (platform.db as PrismaClient | null) ?? actual.getRequestDb(context)),
  };
});

import { action as accountSettingsAction } from "~/routes/account.settings";
import { action as pushPreferencesAction } from "~/routes/api.push.preferences";
import { action as pushSubscriptionsAction } from "~/routes/api.push.subscriptions";
import { action as apiV1Action } from "~/routes/api.v1.$";

const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];
const GIVE_UP: FlakyOutcome[] = ["lost", "lost", "lost", "lost"];
const VAPID = { publicKey: "test-pub", privateKey: "test-priv", subject: "mailto:test@example.com" };
const PUSH_ENDPOINT = "https://fcm.googleapis.com/fcm/send/retry-device";
const JPEG_PHOTO_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

type Match = (args: unknown) => boolean;

/**
 * A Prisma client whose next matching calls fail with a transient D1 error, like
 * test/helpers/flaky-prisma.ts, but matched on the call's arguments too (so a request's other
 * writes to the same model pass) and covering `$executeRaw`.
 */
function flakyCalls(inner: PrismaClient) {
  const plans: Array<{ model: string; method: string; match: Match; outcome: FlakyOutcome }> = [];
  let late: { model: string; method: string; run: () => Promise<unknown> } | null = null;
  let failed = 0;

  const wrap = (model: string, method: string, call: (args: unknown[]) => Promise<unknown>) =>
    async (...args: unknown[]) => {
      if (late?.model === model && late.method === method) {
        const landing = late.run;
        late = null;
        await landing();
      }
      const index = plans.findIndex((plan) => plan.model === model && plan.method === method && plan.match(args[0]));
      if (index === -1) return call(args);
      const [{ outcome }] = plans.splice(index, 1);
      failed += 1;
      if (outcome === "lost-answer") await call(args);
      if (outcome === "late") late = { model, method, run: () => call(args) };
      throw new Error(NETWORK_LOST_MESSAGE);
    };

  const db = new Proxy(inner, {
    get(client, prop) {
      const value = Reflect.get(client, prop);
      if (prop === "$executeRaw") {
        return wrap("$", "executeRaw", (args) => (value as (...a: unknown[]) => Promise<unknown>).apply(client, args));
      }
      if (typeof value === "function") return value.bind(client);
      if (typeof prop !== "string" || !value || typeof value !== "object") return value;
      return new Proxy(value as Record<string, unknown>, {
        get(target, method) {
          const original = Reflect.get(target, method);
          if (typeof original !== "function" || typeof method !== "string") return original;
          return wrap(prop, method, (args) => (original as (...a: unknown[]) => Promise<unknown>).apply(target, args));
        },
      });
    },
  });

  return {
    db,
    failNext(model: string, method: string, match: Match, ...outcomes: FlakyOutcome[]) {
      for (const outcome of outcomes) plans.push({ model, method, match, outcome });
    },
    failures: () => failed,
  };
}

const any: Match = () => true;
/** Matches a Prisma call whose `data` sets `field`. */
const setting = (field: string): Match => (args) =>
  Boolean(args && typeof args === "object" && field in ((args as { data?: object }).data ?? {}));

let db: PrismaClient;
let userId: string;
let username: string;

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
  platform.db = null;
  username = `chef_${faker.string.alphanumeric(8)}`;
  userId = (await createUser(db, faker.internet.email(), username, "testPassword123")).id;
});

afterEach(async () => {
  platform.db = null;
  await cleanupDatabase();
});

async function cookie(id = userId) {
  const session = await sessionStorage.getSession();
  session.set("userId", id);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

/** Routes `getRequestDb` to a flaky client for the next requests. */
function flakyRequests() {
  const flaky = flakyCalls(db);
  platform.db = flaky.db;
  return flaky;
}

async function settingsPost(fields: Record<string, string | File>) {
  const formData = new UndiciFormData();
  for (const [name, value] of Object.entries(fields)) formData.append(name, value);
  const request = new UndiciRequest("http://localhost:3000/account/settings", {
    method: "POST",
    headers: { Cookie: await cookie() },
    body: formData,
    duplex: "half",
  });
  return accountSettingsAction({ request, context: { cloudflare: { env: null } }, params: {} } as never) as unknown as Promise<
    Record<string, unknown> & { data?: unknown; init?: { status: number; headers: Record<string, string> } }
  >;
}

function expectWeb503(answer: { data?: unknown; init?: { status: number; headers: Record<string, string> } }) {
  expect(answer.init?.status).toBe(503);
  expect(answer.init?.headers).toEqual({ "Retry-After": "1", "Cache-Control": "private, no-store" });
  expect(answer.data).toEqual({ success: false, error: "temporarily_unavailable", message: D1_WRITE_UNAVAILABLE_MESSAGE });
}

const userRow = () => db.user.findUniqueOrThrow({ where: { id: userId } });

describe("account settings", () => {
  describe.each([
    {
      intent: "uploadPhoto",
      scope: "a new profile photo",
      before: async () => {},
      fields: () => ({ intent: "uploadPhoto", photo: new File([JPEG_PHOTO_BYTES], "me.jpg", { type: "image/jpeg" }) }),
      check: async () => expect((await userRow()).photoUrl).toMatch(/^data:image\/jpeg;base64,/),
      unchanged: async () => expect((await userRow()).photoUrl).toBeNull(),
    },
    {
      intent: "removePhoto",
      scope: "removing the profile photo",
      before: () => db.user.update({ where: { id: userId }, data: { photoUrl: "https://example.com/me.jpg" } }),
      fields: () => ({ intent: "removePhoto" }),
      check: async () => expect((await userRow()).photoUrl).toBeNull(),
      unchanged: async () => expect((await userRow()).photoUrl).toBe("https://example.com/me.jpg"),
    },
    {
      intent: "setPassword",
      scope: "setting a password",
      before: () => db.user.update({ where: { id: userId }, data: { hashedPassword: null, salt: null } }),
      fields: () => ({ intent: "setPassword", newPassword: "brand-new-pass", confirmPassword: "brand-new-pass" }),
      check: async () => expect((await userRow()).hashedPassword).not.toBeNull(),
      unchanged: async () => expect((await userRow()).hashedPassword).toBeNull(),
    },
    {
      intent: "removePassword",
      scope: "removing the password",
      before: () => db.oAuth.create({ data: { provider: "google", providerUserId: `g-${userId}`, providerUsername: "chef", userId } }),
      fields: () => ({ intent: "removePassword" }),
      check: async () => expect((await userRow()).hashedPassword).toBeNull(),
      unchanged: async () => expect((await userRow()).hashedPassword).not.toBeNull(),
    },
  ])("$scope", ({ before, fields, check, unchanged }) => {
    const field = (name: string) => name === "removePhoto" || name === "uploadPhoto" ? "photoUrl" : "hashedPassword";

    it.each(OUTCOMES)("saves once after a %s write", async (outcome) => {
      await before();
      const flaky = flakyRequests();
      const sent = fields();
      flaky.failNext("user", "update", setting(field(sent.intent as string)), outcome);

      const answer = await settingsPost(sent);

      expect(flaky.failures()).toBe(1);
      expect(answer.success).toBe(true);
      await check();
    });

    it("answers a retryable 503 when every try is lost", async () => {
      await before();
      const flaky = flakyRequests();
      const sent = fields();
      flaky.failNext("user", "update", setting(field(sent.intent as string)), ...GIVE_UP);

      expectWeb503(await settingsPost(sent));
      await unchanged();
    });
  });

  describe("revoking an API token", () => {
    it.each(OUTCOMES)("revokes it and says so after a %s write", async (outcome) => {
      const { credential } = await createApiCredential(db, userId, "Laptop script");
      const flaky = flakyRequests();
      flaky.failNext("apiCredential", "updateMany", any, outcome);

      const answer = await settingsPost({ intent: "revokeApiCredential", credentialId: credential.id });

      expect(flaky.failures()).toBe(1);
      expect(answer).toEqual({ success: true, message: "API credential revoked" });
      expect((await db.apiCredential.findUniqueOrThrow({ where: { id: credential.id } })).revokedAt).toBeInstanceOf(Date);
    });

    it("still answers that a token revoked earlier is already revoked", async () => {
      const { credential } = await createApiCredential(db, userId, "Laptop script");
      await db.apiCredential.update({ where: { id: credential.id }, data: { revokedAt: new Date("2026-01-01T00:00:00.000Z") } });

      const answer = await settingsPost({ intent: "revokeApiCredential", credentialId: credential.id });
      expect(answer).toMatchObject({ success: false, error: "credential_not_found" });
    });

    it("answers a retryable 503 when every try is lost", async () => {
      const { credential } = await createApiCredential(db, userId, "Laptop script");
      const flaky = flakyRequests();
      flaky.failNext("apiCredential", "updateMany", any, ...GIVE_UP);

      expectWeb503(await settingsPost({ intent: "revokeApiCredential", credentialId: credential.id }));
      expect((await db.apiCredential.findUniqueOrThrow({ where: { id: credential.id } })).revokedAt).toBeNull();
    });
  });

  describe("disconnecting an OAuth app", () => {
    const issuer = "http://localhost:3000";

    async function connection() {
      const client = await db.oAuthClient.create({
        data: { clientName: "Grocery helper", redirectUris: JSON.stringify(["https://example.com/callback"]), issuer },
      });
      const refresh = await db.oAuthRefreshToken.create({
        data: { tokenHash: `refresh-${faker.string.alphanumeric(12)}`, userId, clientId: client.id, issuer, scope: "shopping_list:read", resource: null },
      });
      const access = await createApiCredential(db, userId, "Grocery helper (OAuth)", {
        scopes: ["shopping_list:read"],
        oauthClientId: client.id,
        oauthIssuer: issuer,
        oauthResource: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const fields = { intent: "disconnectOAuthClient", clientId: client.id, issuer, resource: "", connectionKey: refresh.id };
      const revoked = async () => ({
        refresh: (await db.oAuthRefreshToken.findUniqueOrThrow({ where: { id: refresh.id } })).revokedAt !== null,
        access: (await db.apiCredential.findUniqueOrThrow({ where: { id: access.credential.id } })).revokedAt !== null,
      });
      return { fields, revoked };
    }

    it.each(OUTCOMES.flatMap((outcome) => [
      { outcome, model: "oAuthRefreshToken" },
      { outcome, model: "apiCredential" },
    ]))("disconnects after a $outcome $model sweep", async ({ outcome, model }) => {
      const { fields, revoked } = await connection();
      const flaky = flakyRequests();
      flaky.failNext(model, "updateMany", setting("revokedAt"), outcome);

      const answer = await settingsPost(fields);

      expect(flaky.failures()).toBe(1);
      expect(answer).toEqual({ success: true, message: "OAuth connection disconnected" });
      expect(await revoked()).toEqual({ refresh: true, access: true });
    });

    it("answers a retryable 503 when every try of a sweep is lost", async () => {
      const { fields, revoked } = await connection();
      const flaky = flakyRequests();
      flaky.failNext("oAuthRefreshToken", "updateMany", setting("revokedAt"), ...GIVE_UP);

      expectWeb503(await settingsPost(fields));
      expect(await revoked()).toEqual({ refresh: false, access: false });
    });
  });
});

describe("saving the account's email and username", () => {
  const change = (email: string) => ({ userId, email, username: "renamed_chef", emailChanged: true, usernameChanged: true });

  it.each(OUTCOMES)("saves once after a %s guarded write", async (outcome) => {
    await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    const flaky = flakyCalls(db);
    flaky.failNext("$", "executeRaw", any, outcome);

    await expect(saveAccountIdentity(flaky.db, change("new-address@example.com"))).resolves.toBe("saved");

    expect(flaky.failures()).toBe(1);
    expect(await userRow()).toMatchObject({ email: "new-address@example.com", username: "renamed_chef", emailVerifiedAt: null });
  });

  it.each(OUTCOMES)("records the change time after a %s touch", async (outcome) => {
    const flaky = flakyCalls(db);
    flaky.failNext("user", "update", any, outcome);

    await expect(saveAccountIdentity(flaky.db, change("touched@example.com"))).resolves.toBe("saved");
    expect(flaky.failures()).toBe(1);
  });

  it("gives up with a retryable error, changing nothing, when every try is lost", async () => {
    const flaky = flakyCalls(db);
    flaky.failNext("$", "executeRaw", any, ...GIVE_UP);

    await expect(saveAccountIdentity(flaky.db, change("never@example.com"))).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect((await userRow()).username).toBe(username);
  });

  it("gives up with a retryable error when every touch is lost", async () => {
    const flaky = flakyCalls(db);
    flaky.failNext("user", "update", any, ...GIVE_UP);

    await expect(saveAccountIdentity(flaky.db, change("half@example.com"))).rejects.toBeInstanceOf(D1WriteUnavailableError);
  });
});

describe("deleting an account", () => {
  const DELETE_BATCH = /DELETE FROM "User" WHERE "id" = \?/;

  function seeded() {
    const database = migratedSqliteD1();
    database.sqlite.prepare(`INSERT INTO "User" ("id", "email", "username") VALUES ('ada', 'ada@example.com', 'ada')`).run();
    database.sqlite.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId", "updatedAt") VALUES ('r1', 'Soup', 'ada', '2026-01-01T00:00:00.000Z')`).run();
    const users = () => database.sqlite.prepare(`SELECT "id" FROM "User" WHERE "id" = 'ada'`).all();
    return { database, users };
  }

  it.each([
    { outcome: "lost" as const, deletedRecipes: 1 },
    { outcome: "lost-answer" as const, deletedRecipes: 0 },
    { outcome: "late" as const, deletedRecipes: 0 },
  ])("deletes it once after a $outcome batch", async ({ outcome, deletedRecipes }) => {
    const { database, users } = seeded();
    const flaky = flakyD1(database.binding);
    flaky.failNext(DELETE_BATCH, outcome);

    // A batch whose answer was lost is not run again, so its counts are not known.
    await expect(deleteAccount(flaky.binding as never, "ada")).resolves.toEqual({ reassignedRecipes: 0, deletedRecipes });

    expect(flaky.failures()).toBe(1);
    expect(users()).toEqual([]);
    database.close();
  });

  it("gives up with a retryable error, deleting nothing, when every try is lost", async () => {
    const { database, users } = seeded();
    const flaky = flakyD1(database.binding);
    flaky.failNext(DELETE_BATCH, ...GIVE_UP);

    await expect(deleteAccount(flaky.binding as never, "ada")).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(users()).toEqual([{ id: "ada" }]);
    database.close();
  });
});

describe("notifications", () => {
  let actorId: string;

  beforeEach(async () => {
    actorId = (await db.user.create({ data: { ...createTestUser(), hashedPassword: null, salt: null } })).id;
  });

  const input = (triggerKey?: string): EnqueueNotificationInput => ({
    recipientId: userId,
    actorId,
    kind: "fork_of_my_recipe",
    payload: { recipeId: "r1", recipeTitle: "Soup", forkerUsername: "actor" },
    ...(triggerKey === undefined ? {} : { triggerKey }),
  });
  const events = () => db.notificationEvent.findMany({ where: { recipientId: userId } });
  const subscribe = () =>
    db.pushSubscription.create({ data: { userId, endpoint: PUSH_ENDPOINT, p256dh: "p", authSecret: "a" } });

  it.each(OUTCOMES)("logs the event once after a %s write", async (outcome) => {
    const flaky = flakyCalls(db);
    flaky.failNext("notificationEvent", "create", any, outcome);

    const result = await enqueueNotification(flaky.db, input("fork-1"), { vapid: VAPID });

    expect(flaky.failures()).toBe(1);
    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(result).toEqual({ eventId: rows[0]!.id, queuedSends: 0 });
  });

  it("gives up with a retryable error, logging nothing, when every try is lost", async () => {
    const flaky = flakyCalls(db);
    flaky.failNext("notificationEvent", "create", any, ...GIVE_UP);

    await expect(enqueueNotification(flaky.db, input(), { vapid: VAPID })).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await events()).toEqual([]);
  });

  it("logs and pushes one event when the same trigger runs again", async () => {
    await subscribe();
    const sendPush = vi.fn(async () => ({ status: "delivered" as const, httpStatus: 201 }));

    const first = await enqueueNotification(db, input("fork-1"), { vapid: VAPID, sendPush });
    const again = await enqueueNotification(db, input("fork-1"), { vapid: VAPID, sendPush });

    expect(again).toEqual({ eventId: first.eventId, queuedSends: 0 });
    expect(await events()).toHaveLength(1);
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("logs each call without a trigger key as its own event", async () => {
    await enqueueNotification(db, input(), { vapid: VAPID });
    await enqueueNotification(db, input(), { vapid: VAPID });
    expect(await events()).toHaveLength(2);
  });

  it("derives the event id from the trigger, as a UUID", async () => {
    const id = await notificationEventId(input("fork-1"));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await notificationEventId(input("fork-1"))).toBe(id);
    expect(await notificationEventId(input("fork-2"))).not.toBe(id);
  });

  it("passes through a clash with another recipient's event", async () => {
    const id = await notificationEventId(input("fork-1"));
    await db.notificationEvent.create({ data: { id, recipientId: actorId, kind: "fork_of_my_recipe", payload: "{}" } });

    await expect(enqueueNotification(db, input("fork-1"), { vapid: VAPID })).rejects.toMatchObject({ code: "P2002" });
  });

  it.each(OUTCOMES)("marks the event delivered after a %s write", async (outcome) => {
    await subscribe();
    const flaky = flakyCalls(db);
    flaky.failNext("notificationEvent", "update", any, outcome);

    const result = await enqueueNotification(flaky.db, input(), {
      vapid: VAPID,
      sendPush: async () => ({ status: "delivered", httpStatus: 201 }),
    });

    expect(flaky.failures()).toBe(1);
    expect((await db.notificationEvent.findUniqueOrThrow({ where: { id: result.eventId! } })).pushDeliveredAt).toBeInstanceOf(Date);
  });

  it("leaves the event unmarked, without failing the dispatch, when every mark is lost", async () => {
    await subscribe();
    const flaky = flakyCalls(db);
    flaky.failNext("notificationEvent", "update", any, ...GIVE_UP);

    const result = await enqueueNotification(flaky.db, input(), {
      vapid: VAPID,
      sendPush: async () => ({ status: "delivered", httpStatus: 201 }),
    });

    expect(result.queuedSends).toBe(1);
    expect((await db.notificationEvent.findUniqueOrThrow({ where: { id: result.eventId! } })).pushDeliveredAt).toBeNull();
  });

  it.each(OUTCOMES)("prunes an expired subscription after a %s delete", async (outcome) => {
    await subscribe();
    const flaky = flakyCalls(db);
    flaky.failNext("pushSubscription", "delete", any, outcome);

    await enqueueNotification(flaky.db, input(), { vapid: VAPID, sendPush: async () => ({ status: "expired", httpStatus: 410 }) });

    expect(flaky.failures()).toBe(1);
    expect(await db.pushSubscription.count({ where: { userId } })).toBe(0);
  });

  it("keeps the subscription, without failing the dispatch, when every prune is lost", async () => {
    await subscribe();
    const flaky = flakyCalls(db);
    flaky.failNext("pushSubscription", "delete", any, ...GIVE_UP);

    await enqueueNotification(flaky.db, input(), { vapid: VAPID, sendPush: async () => ({ status: "expired", httpStatus: 410 }) });
    expect(await db.pushSubscription.count({ where: { userId } })).toBe(1);
  });

  it("notifies a fork once however often its follow-up runs", async () => {
    const fork = { forkedRecipeId: "fork-recipe", sourceRecipeId: "source-recipe", forkerId: actorId, sourceChefId: userId, appliedTitle: "Soup" };
    await notifyForkOfMyRecipe(db, fork, { vapid: VAPID });
    await notifyForkOfMyRecipe(db, fork, { vapid: VAPID });
    expect(await events()).toHaveLength(1);
  });

  it("notifies each fellow chef of an origin cook once however often the fan-out runs", async () => {
    const deps = {
      vapid: VAPID,
      listFellowChefs: async () => ({ rows: [{ chefId: userId }] }) as never,
    };
    const cook = { spoonerId: actorId, recipeId: "origin-recipe", recipeTitle: "Soup", spoonerUsername: "actor" };
    await fanoutFellowChefOriginCook(db, cook, deps);
    await fanoutFellowChefOriginCook(db, cook, deps);
    expect(await events()).toHaveLength(1);
  });
});

describe("browser push endpoints", () => {
  async function pushRequest(path: string, method: string, body: unknown) {
    const request = new UndiciRequest(`http://localhost/api/push/${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: await cookie() },
      body: JSON.stringify(body),
    });
    const args = { request, params: {}, context: { cloudflare: { env: null } } } as never;
    return path === "preferences" ? pushPreferencesAction(args) : pushSubscriptionsAction(args);
  }

  async function expectJson503(response: Response) {
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: D1_WRITE_UNAVAILABLE_MESSAGE, errorCode: "temporarily_unavailable", retryable: true });
  }

  const subscribeBody = { endpoint: PUSH_ENDPOINT, keys: { p256dh: "p", auth: "a" }, userAgent: "Test" };

  it.each(OUTCOMES)("saves preferences after a %s upsert", async (outcome) => {
    const flaky = flakyRequests();
    flaky.failNext("notificationPreference", "upsert", any, outcome);

    const response = await pushRequest("preferences", "PATCH", { notifyForkOfMyRecipe: false });

    expect(response.status).toBe(200);
    expect(await db.notificationPreference.findUniqueOrThrow({ where: { userId } })).toMatchObject({ notifyForkOfMyRecipe: false });
  });

  it("answers a retryable 503 when every preference upsert is lost", async () => {
    const flaky = flakyRequests();
    flaky.failNext("notificationPreference", "upsert", any, ...GIVE_UP);
    await expectJson503(await pushRequest("preferences", "PATCH", { notifyForkOfMyRecipe: false }));
  });

  it.each(OUTCOMES)("adds one subscription after a %s create", async (outcome) => {
    const flaky = flakyRequests();
    flaky.failNext("pushSubscription", "create", any, outcome);

    const response = await pushRequest("subscriptions", "POST", subscribeBody);

    expect(flaky.failures()).toBe(1);
    expect(response.status).toBe(201);
    expect(await db.pushSubscription.count({ where: { userId, endpoint: PUSH_ENDPOINT } })).toBe(1);
  });

  it("answers a retryable 503 when every create is lost", async () => {
    const flaky = flakyRequests();
    flaky.failNext("pushSubscription", "create", any, ...GIVE_UP);
    await expectJson503(await pushRequest("subscriptions", "POST", subscribeBody));
    expect(await db.pushSubscription.count()).toBe(0);
  });

  it.each(OUTCOMES)("refreshes an existing subscription after a %s update", async (outcome) => {
    const other = (await db.user.create({ data: { ...createTestUser(), hashedPassword: null, salt: null } })).id;
    await db.pushSubscription.create({ data: { userId: other, endpoint: PUSH_ENDPOINT, p256dh: "old", authSecret: "old" } });
    const flaky = flakyRequests();
    flaky.failNext("pushSubscription", "update", any, outcome);

    const response = await pushRequest("subscriptions", "POST", subscribeBody);

    expect(response.status).toBe(200);
    expect(await db.pushSubscription.findUniqueOrThrow({ where: { endpoint: PUSH_ENDPOINT } })).toMatchObject({ userId, p256dh: "p" });
  });

  it.each(OUTCOMES)("removes a subscription after a %s delete", async (outcome) => {
    await db.pushSubscription.create({ data: { userId, endpoint: PUSH_ENDPOINT, p256dh: "p", authSecret: "a" } });
    const flaky = flakyRequests();
    flaky.failNext("pushSubscription", "delete", any, outcome);

    const response = await pushRequest("subscriptions", "DELETE", { endpoint: PUSH_ENDPOINT });

    expect(response.status).toBe(204);
    expect(await db.pushSubscription.count()).toBe(0);
  });

  it("answers a retryable 503 when every delete is lost", async () => {
    await db.pushSubscription.create({ data: { userId, endpoint: PUSH_ENDPOINT, p256dh: "p", authSecret: "a" } });
    const flaky = flakyRequests();
    flaky.failNext("pushSubscription", "delete", any, ...GIVE_UP);
    await expectJson503(await pushRequest("subscriptions", "DELETE", { endpoint: PUSH_ENDPOINT }));
    expect(await db.pushSubscription.count()).toBe(1);
  });
});

describe("API v1 account writes", () => {
  async function api(path: string, method: string, headers: Record<string, string>, body?: unknown) {
    const request = new UndiciRequest(`http://localhost/api/v1/${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return apiV1Action({ request, params: { "*": path }, context: { cloudflare: { env: null } } } as never) as Promise<Response>;
  }

  async function bearer(scopes: string[]) {
    const { token } = await createApiCredential(db, userId, "Native app", { scopes });
    return { Authorization: `Bearer ${token}` };
  }

  it.each(OUTCOMES)("removes the profile photo after a %s write", async (outcome) => {
    await db.user.update({ where: { id: userId }, data: { photoUrl: "https://example.com/me.jpg" } });
    const auth = { Cookie: await cookie() };
    const flaky = flakyRequests();
    flaky.failNext("user", "update", setting("photoUrl"), outcome);

    const response = await api("me/photo", "DELETE", auth, { clientMutationId: `cm_${outcome}` });

    expect(response.status).toBe(200);
    expect((await userRow()).photoUrl).toBeNull();
  });

  it.each(OUTCOMES)("sets the profile photo after a %s write", async (outcome) => {
    const auth = { Cookie: await cookie() };
    const flaky = flakyRequests();
    flaky.failNext("user", "update", setting("photoUrl"), outcome);
    const formData = new UndiciFormData();
    formData.append("clientMutationId", `cm_photo_${outcome}`);
    formData.append("photo", new File([new TextEncoder().encode("GIF89a")], "me.gif", { type: "image/gif" }));

    const response = await apiV1Action({
      request: new UndiciRequest("http://localhost/api/v1/me/photo", { method: "POST", headers: auth, body: formData, duplex: "half" }),
      params: { "*": "me/photo" },
      context: { cloudflare: { env: null } },
    } as never) as Response;

    expect(response.status).toBe(200);
    expect((await userRow()).photoUrl).toMatch(/^data:image\/gif;base64,/);
  });

  it.each(OUTCOMES)("saves notification preferences after a %s upsert", async (outcome) => {
    const auth = { Cookie: await cookie() };
    const flaky = flakyRequests();
    flaky.failNext("notificationPreference", "upsert", any, outcome);

    const response = await api("me/notification-preferences", "PATCH", auth, {
      clientMutationId: `cm_prefs_${outcome}`,
      notifySpoonOnMyRecipe: false,
      notifyForkOfMyRecipe: true,
      notifyCookbookSaveOfMine: true,
      notifyFellowChefOriginCook: true,
    });

    expect(response.status).toBe(200);
    expect(await db.notificationPreference.findUniqueOrThrow({ where: { userId } })).toMatchObject({ notifySpoonOnMyRecipe: false });
  });

  const register = (auth: Record<string, string>, id: string, token = "apns-token-secret") => api("me/apns-devices", "POST", auth, {
    clientMutationId: id,
    deviceId: "device-main",
    platform: "ios",
    environment: "production",
    token,
  });

  it.each(OUTCOMES)("registers one APNs device after a %s create", async (outcome) => {
    const auth = await bearer(["account:write"]);
    const flaky = flakyRequests();
    flaky.failNext("nativePushDevice", "create", any, outcome);

    const response = await register(auth, `cm_apns_${outcome}`);

    expect(flaky.failures()).toBe(1);
    expect(response.status).toBe(201);
    const devices = await db.nativePushDevice.findMany({ where: { userId } });
    expect(devices).toHaveLength(1);
    expect((await response.json() as { data: { device: { id: string } } }).data.device.id).toBe(devices[0]!.id);
  });

  it.each(OUTCOMES.flatMap((outcome) => [
    { outcome, method: "updateMany" },
    { outcome, method: "update" },
  ]))("re-registers an APNs device after a $outcome $method", async ({ outcome, method }) => {
    const auth = await bearer(["account:write"]);
    expect((await register(auth, "cm_apns_first")).status).toBe(201);
    const flaky = flakyRequests();
    flaky.failNext("nativePushDevice", method, any, outcome);

    const response = await register(auth, `cm_apns_again_${outcome}_${method}`, "apns-token-rotated");

    expect(response.status).toBe(200);
    expect(await db.nativePushDevice.findFirstOrThrow({ where: { userId } })).toMatchObject({ tokenPrefix: "apns-token-r", revokedAt: null });
  });

  it.each(OUTCOMES)("revokes an APNs device after a %s write", async (outcome) => {
    const auth = await bearer(["account:write"]);
    expect((await register(auth, "cm_apns_first")).status).toBe(201);
    const flaky = flakyRequests();
    flaky.failNext("nativePushDevice", "updateMany", any, outcome);

    const response = await api("me/apns-devices/device-main", "DELETE", auth, { clientMutationId: `cm_apns_revoke_${outcome}` });

    expect(response.status).toBe(200);
    expect((await db.nativePushDevice.findFirstOrThrow({ where: { userId } })).revokedAt).not.toBeNull();
  });

  it.each(OUTCOMES)("revokes an API token once, answering it revoked, after a %s write", async (outcome) => {
    const auth = await bearer(["tokens:read", "tokens:write"]);
    const { credential } = await createApiCredential(db, userId, "Old script");
    const flaky = flakyRequests();
    flaky.failNext("apiCredential", "update", setting("revokedAt"), outcome);

    const response = await api(`tokens/${credential.id}`, "DELETE", auth);

    expect(flaky.failures()).toBe(1);
    expect(response.status).toBe(200);
    expect((await response.json() as { data: { revoked: boolean } }).data.revoked).toBe(true);
    expect((await db.apiCredential.findUniqueOrThrow({ where: { id: credential.id } })).revokedAt).toBeInstanceOf(Date);
  });

  describe("disconnecting an OAuth connection", () => {
    const issuer = "http://localhost";

    async function connected() {
      const admin = await bearer(["tokens:read", "tokens:write"]);
      const client = await db.oAuthClient.create({
        data: { clientName: "Connector", redirectUris: "https://client.example/callback", issuer },
      });
      await db.oAuthRefreshToken.create({
        data: { tokenHash: `refresh-${faker.string.alphanumeric(12)}`, userId, clientId: client.id, issuer, scope: "kitchen:read", resource: null },
      });
      await createApiCredential(db, userId, "Connector (OAuth)", {
        scopes: ["kitchen:read"],
        oauthClientId: client.id,
        oauthIssuer: issuer,
        oauthResource: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const listed = await (await api("me/connections", "GET", admin)).json() as { data: { connections: Array<{ id: string }> } };
      return { admin, connectionId: listed.data.connections[0]!.id };
    }

    it.each(OUTCOMES.flatMap((outcome) => [
      { outcome, model: "oAuthRefreshToken" },
      { outcome, model: "apiCredential" },
    ]))("counts the tokens it revoked after a $outcome $model sweep", async ({ outcome, model }) => {
      const { admin, connectionId } = await connected();
      const flaky = flakyRequests();
      flaky.failNext(model, "updateMany", setting("revokedAt"), outcome);

      const response = await api(`me/connections/${connectionId}`, "DELETE", admin);

      expect(flaky.failures()).toBe(1);
      expect(response.status).toBe(200);
      expect((await response.json() as { data: unknown }).data).toMatchObject({
        disconnected: true,
        revokedRefreshTokens: 1,
        revokedAccessTokens: 1,
      });
    });
  });
});

describe("MCP revoke_api_token", () => {
  it.each(OUTCOMES)("revokes the token once after a %s write", async (outcome) => {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const { credential } = await createApiCredential(db, userId, "Old script");
    const flaky = flakyCalls(db);
    flaky.failNext("apiCredential", "update", setting("revokedAt"), outcome);

    const result = await callSpoonjoyApiOperation("revoke_api_token", { credentialId: credential.id }, {
      db: flaky.db,
      principal: { id: userId, email: user.email, username: user.username, source: "session", scopes: ["tokens:write"] } as never,
    }) as { content: Array<{ text: string }> } | { revoked: boolean };

    expect(flaky.failures()).toBe(1);
    expect(JSON.stringify(result)).toContain("revoked");
    expect((await db.apiCredential.findUniqueOrThrow({ where: { id: credential.id } })).revokedAt).toBeInstanceOf(Date);
  });
});
