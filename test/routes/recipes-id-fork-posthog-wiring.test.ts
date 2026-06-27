/**
 * PostHog config-threading test for the `recipes.$id.fork` action.
 *
 * Proves the fork action now resolves `resolvePostHogServerConfig(env)` (via
 * `getCloudflareCtx`) and threads it into `notifyForkOfMyRecipe`'s dispatch
 * deps. Previously the call site passed only `{ vapid, waitUntil }`.
 *
 * The source chef is given a push subscription; the real `sendPush` fails on
 * the test VAPID keys, so dispatch reaches its `spoonjoy.push.send_failed`
 * capture, which POSTs to PostHog using the threaded config.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { action } from "~/routes/recipes.$id.fork";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import {
  drainScheduled,
  makePostHogFetchSpy,
  pushSendFailedPosts,
  type PostHogFetchSpy,
} from "../helpers/posthog-capture";

function uniqueEmail(prefix = "n") {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

async function makeUser(prefix: string) {
  return createUser(
    db,
    uniqueEmail(prefix),
    `${prefix}_${faker.string.alphanumeric(8).toLowerCase()}`,
    "testPassword123",
  );
}

async function givePushSubscription(userId: string) {
  await db.pushSubscription.create({
    data: {
      userId,
      endpoint: `https://push.example/${userId}/${faker.string.alphanumeric(10)}`,
      p256dh: "p256dh-key",
      authSecret: "auth-secret",
    },
  });
}

async function postFork(
  recipeId: string,
  cookie: string,
  env: Record<string, unknown> | null,
  scheduled: Promise<unknown>[],
) {
  return action({
    request: new UndiciRequest(`http://localhost/recipes/${recipeId}/fork`, {
      method: "POST",
      headers: { cookie },
    }) as unknown as Request,
    params: { id: recipeId },
    context: {
      cloudflare: {
        env,
        ctx: { waitUntil: (p: Promise<unknown>) => scheduled.push(p) },
      },
    },
  } as never);
}

const VAPID_ONLY = {
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv",
  VAPID_SUBJECT: "mailto:t@example.com",
};

describe("recipes.$id.fork — PostHog config threading (notifyForkOfMyRecipe)", () => {
  let ownerId: string;
  let forkerId: string;
  let recipeId: string;
  let origFetch: typeof globalThis.fetch;
  let spy: PostHogFetchSpy;

  beforeEach(async () => {
    await cleanupDatabase();
    const owner = await makeUser("owner");
    const forker = await makeUser("forker");
    ownerId = owner.id;
    forkerId = forker.id;
    recipeId = (await db.recipe.create({ data: { title: "Bread", chefId: ownerId } })).id;
    await givePushSubscription(ownerId);
    origFetch = globalThis.fetch;
    spy = makePostHogFetchSpy();
    globalThis.fetch = spy.impl;
  });

  afterEach(async () => {
    globalThis.fetch = origFetch;
    await cleanupDatabase();
  });

  it("captures the silent push failure when POSTHOG_KEY is set (config threaded through)", async () => {
    const cookie = await sessionCookie(forkerId);
    const scheduled: Promise<unknown>[] = [];

    const result = (await postFork(recipeId, cookie, { POSTHOG_KEY: "ph_test", ...VAPID_ONLY }, scheduled)) as Response;
    expect(result.status).toBe(302);

    expect(scheduled.length).toBeGreaterThan(0);
    await drainScheduled(scheduled);

    const captures = pushSendFailedPosts(spy.postHogPosts);
    expect(captures.length).toBeGreaterThan(0);
    expect(captures[0]!.properties).toMatchObject({
      kind: "fork_of_my_recipe",
      $lib: "spoonjoy-server",
    });
  });

  it("does NOT capture when POSTHOG_KEY is absent (config resolves disabled → no-op)", async () => {
    const cookie = await sessionCookie(forkerId);
    const scheduled: Promise<unknown>[] = [];

    const result = (await postFork(recipeId, cookie, { ...VAPID_ONLY }, scheduled)) as Response;
    expect(result.status).toBe(302);

    await drainScheduled(scheduled);
    expect(pushSendFailedPosts(spy.postHogPosts)).toHaveLength(0);
  });
});
