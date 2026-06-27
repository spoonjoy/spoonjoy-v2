/**
 * PostHog config-threading tests for the recipe-detail spoon path.
 *
 * These prove the *caller* now resolves `resolvePostHogServerConfig(env)` and
 * threads it into the notification dispatch deps (`notifySpoonOnMyRecipe` and
 * `fanoutFellowChefOriginCook`). The dispatch/fanout layers already capture
 * silent failures when a config is present (covered by their own suites); what
 * was previously dormant is that the call sites supplied no config at all.
 *
 * Strategy: run the real action + real dispatch with a recipient that has a
 * push subscription. The real `sendPush` fails on the test VAPID keys, so the
 * dispatch reaches its `spoonjoy.push.send_failed` capture, which POSTs to
 * PostHog using the threaded config. We intercept `globalThis.fetch` and assert
 * the capture POST fires (config enabled) or not (config absent / no-op).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { db } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { handleRecipeDetailAction } from "~/lib/recipe-detail.server";
import { cleanupDatabase } from "../helpers/cleanup";
import {
  drainScheduled,
  makePostHogFetchSpy,
  pushSendFailedPosts,
  type PostHogFetchSpy,
} from "../helpers/posthog-capture";
import { createTestUser } from "../utils";

async function makeAuthedSpoonRequest(userId: string, recipeId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  const cookie = (await sessionStorage.commitSession(session)).split(";")[0];
  const headers = new Headers();
  headers.set("Cookie", cookie);
  const formData = new UndiciFormData();
  formData.append("intent", "createSpoon");
  // A spoon needs at least one of photo/note/nextTime; a note keeps it valid
  // without touching R2 storage.
  formData.append("note", "Threading check");
  return new UndiciRequest(`http://localhost/recipes/${recipeId}`, {
    method: "POST",
    headers,
    body: formData,
  }) as unknown as Request;
}

async function makeUser() {
  return db.user.create({ data: createTestUser() });
}

async function givePushSubscription(userId: string) {
  await db.pushSubscription.create({
    data: {
      userId,
      endpoint: `https://push.example/${userId}/${Math.random().toString(36).slice(2)}`,
      p256dh: "p256dh-key",
      authSecret: "auth-secret",
    },
  });
}

describe("recipe-detail createSpoon — PostHog config threading (notifySpoonOnMyRecipe)", () => {
  let origFetch: typeof globalThis.fetch;
  let spy: PostHogFetchSpy;

  beforeEach(async () => {
    await cleanupDatabase();
    origFetch = globalThis.fetch;
    spy = makePostHogFetchSpy();
    globalThis.fetch = spy.impl;
  });

  afterEach(async () => {
    globalThis.fetch = origFetch;
    await cleanupDatabase();
  });

  it("captures the silent push failure when POSTHOG_KEY is set (config threaded through, scheduled via waitUntil)", async () => {
    const owner = await makeUser();
    const spooner = await makeUser();
    await givePushSubscription(owner.id);
    const recipe = await db.recipe.create({ data: { title: "Threaded Stew", chefId: owner.id } });
    const scheduled: Promise<unknown>[] = [];

    await handleRecipeDetailAction({
      request: await makeAuthedSpoonRequest(spooner.id, recipe.id),
      params: { id: recipe.id },
      context: {
        cloudflare: {
          env: { POSTHOG_KEY: "ph_test", VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:t@example.com" },
          ctx: { waitUntil: (p: Promise<unknown>) => scheduled.push(p) },
        },
      } as never,
    });

    // The capture is fire-and-forget, scheduled via ctx.waitUntil.
    expect(scheduled.length).toBeGreaterThan(0);
    await drainScheduled(scheduled);

    const captures = pushSendFailedPosts(spy.postHogPosts);
    expect(captures.length).toBeGreaterThan(0);
    expect(captures[0]!.properties).toMatchObject({
      kind: "spoon_on_my_recipe",
      $lib: "spoonjoy-server",
    });
  });

  it("does NOT capture when POSTHOG_KEY is absent (config resolves disabled → no-op)", async () => {
    const owner = await makeUser();
    const spooner = await makeUser();
    await givePushSubscription(owner.id);
    const recipe = await db.recipe.create({ data: { title: "Unthreaded Stew", chefId: owner.id } });
    const scheduled: Promise<unknown>[] = [];

    await handleRecipeDetailAction({
      request: await makeAuthedSpoonRequest(spooner.id, recipe.id),
      params: { id: recipe.id },
      context: {
        cloudflare: {
          // env present so the notification still dispatches, but no POSTHOG_KEY.
          env: { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:t@example.com" },
          ctx: { waitUntil: (p: Promise<unknown>) => scheduled.push(p) },
        },
      } as never,
    });

    await drainScheduled(scheduled);
    expect(pushSendFailedPosts(spy.postHogPosts)).toHaveLength(0);
  });

  it("resolves a disabled config and emits nothing when the Cloudflare env is null", async () => {
    // env=null exercises the `env ?? {}` fallback; VAPID is then unconfigured so
    // the notify path skips gracefully, but the response must still succeed.
    const owner = await makeUser();
    const spooner = await makeUser();
    await givePushSubscription(owner.id);
    const recipe = await db.recipe.create({ data: { title: "Null Env Stew", chefId: owner.id } });
    const scheduled: Promise<unknown>[] = [];

    const result = await handleRecipeDetailAction({
      request: await makeAuthedSpoonRequest(spooner.id, recipe.id),
      params: { id: recipe.id },
      context: {
        cloudflare: {
          env: null,
          ctx: { waitUntil: (p: Promise<unknown>) => scheduled.push(p) },
        },
      } as never,
    });

    await drainScheduled(scheduled);
    expect(result).toMatchObject({ success: true, intent: "createSpoon" });
    expect(pushSendFailedPosts(spy.postHogPosts)).toHaveLength(0);
  });
});

describe("recipe-detail createSpoon — PostHog config threading (fanoutFellowChefOriginCook)", () => {
  let origFetch: typeof globalThis.fetch;
  let spy: PostHogFetchSpy;

  beforeEach(async () => {
    await cleanupDatabase();
    origFetch = globalThis.fetch;
    spy = makePostHogFetchSpy();
    globalThis.fetch = spy.impl;
  });

  afterEach(async () => {
    globalThis.fetch = origFetch;
    await cleanupDatabase();
  });

  it("captures fan-out push failures for fellow chefs when POSTHOG_KEY is set", async () => {
    // Spooner origin-cooks their OWN new recipe; a fellow chef they previously
    // engaged with (spooned) gets fanned out. That fellow chef has a push sub,
    // so the dispatch reaches send_failed with the threaded config.
    const spooner = await makeUser();
    const fellow = await makeUser();
    await givePushSubscription(fellow.id);
    const fellowRecipe = await db.recipe.create({ data: { title: "Fellow Dish", chefId: fellow.id } });
    await db.recipeSpoon.create({ data: { chefId: spooner.id, recipeId: fellowRecipe.id, note: "yum" } });
    const ownRecipe = await db.recipe.create({ data: { title: "Spooner Origin Dish", chefId: spooner.id } });
    const scheduled: Promise<unknown>[] = [];

    await handleRecipeDetailAction({
      request: await makeAuthedSpoonRequest(spooner.id, ownRecipe.id),
      params: { id: ownRecipe.id },
      context: {
        cloudflare: {
          env: { POSTHOG_KEY: "ph_test", VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:t@example.com" },
          ctx: { waitUntil: (p: Promise<unknown>) => scheduled.push(p) },
        },
      } as never,
    });

    await drainScheduled(scheduled);

    const captures = pushSendFailedPosts(spy.postHogPosts);
    expect(captures.some((c) => c.properties?.kind === "fellow_chef_origin_cook")).toBe(true);
  });

  it("does NOT capture fan-out push failures when POSTHOG_KEY is absent", async () => {
    const spooner = await makeUser();
    const fellow = await makeUser();
    await givePushSubscription(fellow.id);
    const fellowRecipe = await db.recipe.create({ data: { title: "Fellow Dish 2", chefId: fellow.id } });
    await db.recipeSpoon.create({ data: { chefId: spooner.id, recipeId: fellowRecipe.id, note: "yum" } });
    const ownRecipe = await db.recipe.create({ data: { title: "Spooner Origin Dish 2", chefId: spooner.id } });
    const scheduled: Promise<unknown>[] = [];

    await handleRecipeDetailAction({
      request: await makeAuthedSpoonRequest(spooner.id, ownRecipe.id),
      params: { id: ownRecipe.id },
      context: {
        cloudflare: {
          env: { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:t@example.com" },
          ctx: { waitUntil: (p: Promise<unknown>) => scheduled.push(p) },
        },
      } as never,
    });

    await drainScheduled(scheduled);
    expect(
      pushSendFailedPosts(spy.postHogPosts).filter((c) => c.properties?.kind === "fellow_chef_origin_cook"),
    ).toHaveLength(0);
  });
});
