/**
 * PostHog config-threading tests for the API/MCP surface notification call
 * sites in `spoonjoy-api.server.ts`:
 *   - add_recipe_to_cookbook → notifyCookbookSaveOfMine
 *   - create_spoon           → notifySpoonOnMyRecipe
 *   - create_spoon (origin)  → fanoutFellowChefOriginCook
 *   - fork_recipe            → notifyForkOfMyRecipe
 *
 * Each call site now resolves `resolvePostHogServerConfig(context.env)` and
 * threads it into the dispatch deps; previously it passed only
 * `{ vapid, waitUntil }`, leaving capture dormant on this surface.
 *
 * The notification recipient is given a push subscription; the real `sendPush`
 * fails on the test VAPID keys, so dispatch reaches its
 * `spoonjoy.push.send_failed` capture, which POSTs to PostHog using the
 * threaded config.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import {
  callSpoonjoyApiOperation,
  type SpoonjoyApiContext,
} from "~/lib/spoonjoy-api.server";
import type { ApiPrincipal } from "~/lib/api-auth.server";
import { cleanupDatabase } from "../helpers/cleanup";
import {
  drainScheduled,
  makePostHogFetchSpy,
  pushSendFailedPosts,
  type PostHogFetchSpy,
} from "../helpers/posthog-capture";

type Database = Awaited<ReturnType<typeof getLocalDb>>;

const VAPID_ONLY = {
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv",
  VAPID_SUBJECT: "mailto:t@example.com",
};

function uniqueEmail(prefix = "chef") {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

function uniqueUsername(prefix = "user") {
  return `${prefix}_${faker.string.alphanumeric(8).toLowerCase()}`;
}

async function makeUser(db: Database) {
  const user = await db.user.create({
    data: { email: uniqueEmail(), username: uniqueUsername() },
  });
  const principal: ApiPrincipal = {
    id: user.id,
    email: user.email,
    username: user.username,
    source: "bearer",
    scopes: ["kitchen:read", "kitchen:write", "recipes:read", "public:read"],
  };
  return { user, principal };
}

async function makeRecipe(db: Database, chefId: string, title?: string) {
  return db.recipe.create({
    data: { title: title ?? `Wiring ${faker.string.alphanumeric(6)}`, chefId },
  });
}

async function givePushSubscription(db: Database, userId: string) {
  await db.pushSubscription.create({
    data: {
      userId,
      endpoint: `https://push.example/${userId}/${faker.string.alphanumeric(10)}`,
      p256dh: "p256dh-key",
      authSecret: "auth-secret",
    },
  });
}

function ctxWith(
  db: Database,
  principal: ApiPrincipal,
  posthog: boolean,
  scheduled: Promise<unknown>[],
): SpoonjoyApiContext {
  return {
    db,
    principal,
    waitUntil: (p) => scheduled.push(p),
    env: posthog ? { POSTHOG_KEY: "ph_test", ...VAPID_ONLY } : { ...VAPID_ONLY },
  };
}

describe("spoonjoy-api PostHog config threading", () => {
  let db: Database;
  let origFetch: typeof globalThis.fetch;
  let spy: PostHogFetchSpy;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    origFetch = globalThis.fetch;
    spy = makePostHogFetchSpy();
    globalThis.fetch = spy.impl;
  });

  afterEach(async () => {
    globalThis.fetch = origFetch;
    await cleanupDatabase();
  });

  describe("add_recipe_to_cookbook → notifyCookbookSaveOfMine", () => {
    async function run(posthog: boolean, scheduled: Promise<unknown>[]) {
      const { principal: owner } = await makeUser(db);
      const { principal: saver } = await makeUser(db);
      const recipe = await makeRecipe(db, owner.id);
      const cookbook = await db.cookbook.create({
        data: { title: `Box ${faker.string.alphanumeric(6)}`, authorId: saver.id },
      });
      await givePushSubscription(db, owner.id);
      await callSpoonjoyApiOperation(
        "add_recipe_to_cookbook",
        { cookbookId: cookbook.id, recipeId: recipe.id },
        ctxWith(db, saver, posthog, scheduled),
      );
    }

    it("captures the silent push failure when POSTHOG_KEY is set", async () => {
      const scheduled: Promise<unknown>[] = [];
      await run(true, scheduled);
      await drainScheduled(scheduled);
      const captures = pushSendFailedPosts(spy.postHogPosts);
      expect(captures.length).toBeGreaterThan(0);
      expect(captures[0]!.properties).toMatchObject({ kind: "cookbook_save_of_mine" });
    });

    it("does NOT capture when POSTHOG_KEY is absent", async () => {
      const scheduled: Promise<unknown>[] = [];
      await run(false, scheduled);
      await drainScheduled(scheduled);
      expect(pushSendFailedPosts(spy.postHogPosts)).toHaveLength(0);
    });
  });

  describe("create_spoon → notifySpoonOnMyRecipe", () => {
    async function run(posthog: boolean, scheduled: Promise<unknown>[]) {
      const { principal: owner } = await makeUser(db);
      const { principal: spooner } = await makeUser(db);
      const recipe = await makeRecipe(db, owner.id);
      await givePushSubscription(db, owner.id);
      await callSpoonjoyApiOperation(
        "create_spoon",
        { recipeId: recipe.id, note: "cooked it" },
        ctxWith(db, spooner, posthog, scheduled),
      );
    }

    it("captures the silent push failure when POSTHOG_KEY is set", async () => {
      const scheduled: Promise<unknown>[] = [];
      await run(true, scheduled);
      await drainScheduled(scheduled);
      const captures = pushSendFailedPosts(spy.postHogPosts);
      expect(captures.length).toBeGreaterThan(0);
      expect(captures[0]!.properties).toMatchObject({ kind: "spoon_on_my_recipe" });
    });

    it("does NOT capture when POSTHOG_KEY is absent", async () => {
      const scheduled: Promise<unknown>[] = [];
      await run(false, scheduled);
      await drainScheduled(scheduled);
      expect(pushSendFailedPosts(spy.postHogPosts)).toHaveLength(0);
    });
  });

  describe("create_spoon (origin cook) → fanoutFellowChefOriginCook", () => {
    async function run(posthog: boolean, scheduled: Promise<unknown>[]) {
      const { principal: spooner } = await makeUser(db);
      const { principal: fellow } = await makeUser(db);
      const fellowRecipe = await makeRecipe(db, fellow.id);
      // Spooner previously engaged with the fellow chef (spooned their recipe).
      await db.recipeSpoon.create({ data: { chefId: spooner.id, recipeId: fellowRecipe.id, note: "yum" } });
      await givePushSubscription(db, fellow.id);
      // Spooner origin-cooks their OWN new recipe → fan-out to the fellow chef.
      const ownRecipe = await makeRecipe(db, spooner.id);
      await callSpoonjoyApiOperation(
        "create_spoon",
        { recipeId: ownRecipe.id, note: "first cook" },
        ctxWith(db, spooner, posthog, scheduled),
      );
    }

    it("captures fan-out push failures for fellow chefs when POSTHOG_KEY is set", async () => {
      const scheduled: Promise<unknown>[] = [];
      await run(true, scheduled);
      await drainScheduled(scheduled);
      const captures = pushSendFailedPosts(spy.postHogPosts);
      expect(captures.some((c) => c.properties?.kind === "fellow_chef_origin_cook")).toBe(true);
    });

    it("does NOT capture fan-out push failures when POSTHOG_KEY is absent", async () => {
      const scheduled: Promise<unknown>[] = [];
      await run(false, scheduled);
      await drainScheduled(scheduled);
      expect(
        pushSendFailedPosts(spy.postHogPosts).filter((c) => c.properties?.kind === "fellow_chef_origin_cook"),
      ).toHaveLength(0);
    });
  });

  describe("fork_recipe → notifyForkOfMyRecipe", () => {
    async function run(posthog: boolean, scheduled: Promise<unknown>[]) {
      const { principal: owner } = await makeUser(db);
      const { principal: forker } = await makeUser(db);
      const recipe = await makeRecipe(db, owner.id, "Forkable");
      await givePushSubscription(db, owner.id);
      await callSpoonjoyApiOperation(
        "fork_recipe",
        { sourceRecipeId: recipe.id },
        ctxWith(db, forker, posthog, scheduled),
      );
    }

    it("captures the silent push failure when POSTHOG_KEY is set", async () => {
      const scheduled: Promise<unknown>[] = [];
      await run(true, scheduled);
      await drainScheduled(scheduled);
      const captures = pushSendFailedPosts(spy.postHogPosts);
      expect(captures.length).toBeGreaterThan(0);
      expect(captures[0]!.properties).toMatchObject({ kind: "fork_of_my_recipe" });
    });

    it("does NOT capture when POSTHOG_KEY is absent", async () => {
      const scheduled: Promise<unknown>[] = [];
      await run(false, scheduled);
      await drainScheduled(scheduled);
      expect(pushSendFailedPosts(spy.postHogPosts)).toHaveLength(0);
    });
  });
});
