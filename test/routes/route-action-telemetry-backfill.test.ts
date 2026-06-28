/**
 * Telemetry-backfill capture tests for flagged route actions/loaders.
 *
 * Each suite forces the route's *unexpected* server-failure path (a persistence
 * or config fault — not a validation/404/auth-rejected outcome) and proves the
 * route now emits a fire-and-forget PostHog `$exception` capture carrying
 * privacy-safe diagnostic context, and stays a no-op when PostHog is not
 * configured. The happy paths and 4xx outcomes live in each route's own suite;
 * these tests pin only the newly instrumented error paths.
 *
 * Failures are injected by stubbing the relevant Prisma method on the shared
 * local DB (the same instance `getRequestDb` returns in tests), mirroring the
 * existing `cookbooks-new` generic-error test. `globalThis.fetch` is replaced
 * with a spy that records PostHog capture POSTs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import {
  drainScheduled,
  exceptionPosts,
  makePostHogFetchSpy,
  type PostHogFetchSpy,
} from "../helpers/posthog-capture";

import { action as preferencesAction } from "~/routes/api.push.preferences";
import { loader as publicKeyLoader } from "~/routes/api.push.public-key";
import { action as subscriptionsAction } from "~/routes/api.push.subscriptions";
import { action as newCookbookAction } from "~/routes/cookbooks.new";
import { action as cookbookDetailAction } from "~/routes/cookbooks.$id";
import { action as newStepAction } from "~/routes/recipes.$id.steps.new";
import { action as editStepAction } from "~/routes/recipes.$id.steps.$stepId.edit";

const PH = { POSTHOG_KEY: "ph_test" } as const;

async function sessionCookie(userId: string): Promise<string> {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

async function makeUser(prefix: string) {
  const email = `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
  const username = `${prefix}_${faker.string.alphanumeric(8).toLowerCase()}`;
  return createUser(db, email, username, "testPassword123");
}

/**
 * Build action/loader args with a cloudflare env + a waitUntil collector. When
 * `scheduled` is `null` the context omits `ctx.waitUntil` entirely, exercising
 * the fire-and-forget `void capture` fallback branch.
 */
function ctxArgs(
  url: string,
  method: string,
  cookie: string | null,
  body: BodyInit | null,
  params: Record<string, string>,
  env: Record<string, unknown> | null,
  scheduled: Promise<unknown>[] | null,
) {
  const headers = new Headers();
  if (cookie) headers.set("Cookie", cookie);
  const request = new UndiciRequest(url, { method, headers, body }) as unknown as Request;
  const cloudflare: Record<string, unknown> = { env };
  if (scheduled) {
    cloudflare.ctx = { waitUntil: (p: Promise<unknown>) => scheduled.push(p) };
  }
  return { request, params, context: { cloudflare } } as never;
}

/** Let a fire-and-forget (un-awaited) capture microtask settle. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("route-action telemetry backfill — unexpected-failure captures", () => {
  let origFetch: typeof globalThis.fetch;
  let spy: PostHogFetchSpy;
  const stubbed: Array<() => void> = [];

  beforeEach(async () => {
    await cleanupDatabase();
    origFetch = globalThis.fetch;
    spy = makePostHogFetchSpy();
    globalThis.fetch = spy.impl;
  });

  afterEach(async () => {
    for (const restore of stubbed.splice(0)) restore();
    globalThis.fetch = origFetch;
    await cleanupDatabase();
  });

  /** Stub a Prisma method to reject, and register its restore. */
  function stubReject(model: any, method: string, error: unknown) {
    const original = model[method];
    model[method] = vi.fn().mockRejectedValue(error);
    stubbed.push(() => {
      model[method] = original;
    });
  }

  // --- api.push.preferences -----------------------------------------------

  describe("api.push.preferences (update preferences)", () => {
    async function run(env: Record<string, unknown> | null, scheduled: Promise<unknown>[]) {
      const user = await makeUser("pref");
      const cookie = await sessionCookie(user.id);
      stubReject(db.notificationPreference, "upsert", new Error("upsert failed"));
      const res = await preferencesAction(
        ctxArgs(
          "http://localhost/api/push/preferences",
          "PATCH",
          cookie,
          JSON.stringify({ notifySpoonOnMyRecipe: false }),
          {},
          env,
          scheduled,
        ),
      );
      return { res: res as Response, userId: user.id };
    }

    it("captures the unexpected upsert failure (and surfaces a 500) when configured", async () => {
      const scheduled: Promise<unknown>[] = [];
      const { res, userId } = await run(PH, scheduled);

      expect(res.status).toBe(500);
      await drainScheduled(scheduled);
      const captures = exceptionPosts(spy.postHogPosts);
      expect(captures).toHaveLength(1);
      expect(captures[0]!.properties).toMatchObject({
        $exception_message: "upsert failed",
        route: "/api/push/preferences",
        method: "PATCH",
        action: "update_push_preferences",
        $lib: "spoonjoy-server",
      });
      expect(captures[0]!.distinct_id).toBe(userId);
    });

    it("does NOT capture when POSTHOG_KEY is absent", async () => {
      const scheduled: Promise<unknown>[] = [];
      const { res } = await run(null, scheduled);
      expect(res.status).toBe(500);
      await drainScheduled(scheduled);
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(0);
    });
  });

  // --- api.push.public-key -------------------------------------------------

  describe("api.push.public-key (VAPID config read)", () => {
    function run(env: Record<string, unknown> | null, scheduled: Promise<unknown>[]) {
      // No VAPID_* keys in env → getVapidConfig throws "Missing required env var".
      return publicKeyLoader(
        ctxArgs(
          "http://localhost/api/push/public-key",
          "GET",
          null,
          null,
          {},
          env,
          scheduled,
        ),
      ) as Promise<Response>;
    }

    it("captures the unexpected config read failure (and surfaces a 500) when configured", async () => {
      const scheduled: Promise<unknown>[] = [];
      const res = await run(PH, scheduled);

      expect(res.status).toBe(500);
      await drainScheduled(scheduled);
      const captures = exceptionPosts(spy.postHogPosts);
      expect(captures).toHaveLength(1);
      expect(captures[0]!.properties).toMatchObject({
        route: "/api/push/public-key",
        method: "GET",
        surface: "push_public_key",
        $lib: "spoonjoy-server",
      });
      expect(captures[0]!.distinct_id).toBe("server");
    });

    it("does NOT capture when POSTHOG_KEY is absent", async () => {
      const scheduled: Promise<unknown>[] = [];
      const res = await run(null, scheduled);
      expect(res.status).toBe(500);
      await drainScheduled(scheduled);
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(0);
    });
  });

  // --- api.push.subscriptions ---------------------------------------------

  describe("api.push.subscriptions (subscribe / unsubscribe)", () => {
    async function runSubscribe(env: Record<string, unknown> | null, scheduled: Promise<unknown>[]) {
      const user = await makeUser("sub");
      const cookie = await sessionCookie(user.id);
      // findUnique is the first persistence call on the POST path.
      stubReject(db.pushSubscription, "findUnique", new Error("lookup failed"));
      const res = await subscriptionsAction(
        ctxArgs(
          "http://localhost/api/push/subscriptions",
          "POST",
          cookie,
          JSON.stringify({
            endpoint: "https://push.example/abc",
            keys: { p256dh: "p", auth: "a" },
          }),
          {},
          env,
          scheduled,
        ),
      );
      return { res: res as Response, userId: user.id };
    }

    it("captures the unexpected subscribe failure with operation=subscribe when configured", async () => {
      const scheduled: Promise<unknown>[] = [];
      const { res, userId } = await runSubscribe(PH, scheduled);

      expect(res.status).toBe(500);
      await drainScheduled(scheduled);
      const captures = exceptionPosts(spy.postHogPosts);
      expect(captures).toHaveLength(1);
      expect(captures[0]!.properties).toMatchObject({
        $exception_message: "lookup failed",
        route: "/api/push/subscriptions",
        method: "POST",
        action: "push_subscription",
        operation: "subscribe",
        $lib: "spoonjoy-server",
      });
      expect(captures[0]!.distinct_id).toBe(userId);
    });

    it("captures the unexpected unsubscribe failure with operation=unsubscribe when configured", async () => {
      const user = await makeUser("unsub");
      const cookie = await sessionCookie(user.id);
      await db.pushSubscription.create({
        data: {
          userId: user.id,
          endpoint: "https://push.example/del",
          p256dh: "p",
          authSecret: "a",
        },
      });
      // delete throws after the row is found & owned by the user.
      stubReject(db.pushSubscription, "delete", new Error("delete failed"));
      const scheduled: Promise<unknown>[] = [];

      const res = (await subscriptionsAction(
        ctxArgs(
          "http://localhost/api/push/subscriptions",
          "DELETE",
          cookie,
          JSON.stringify({ endpoint: "https://push.example/del" }),
          {},
          PH,
          scheduled,
        ),
      )) as Response;

      expect(res.status).toBe(500);
      await drainScheduled(scheduled);
      const captures = exceptionPosts(spy.postHogPosts);
      expect(captures).toHaveLength(1);
      expect(captures[0]!.properties).toMatchObject({
        $exception_message: "delete failed",
        method: "DELETE",
        action: "push_subscription",
        operation: "unsubscribe",
      });
    });

    it("does NOT capture when POSTHOG_KEY is absent", async () => {
      const scheduled: Promise<unknown>[] = [];
      const { res } = await runSubscribe(null, scheduled);
      expect(res.status).toBe(500);
      await drainScheduled(scheduled);
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(0);
    });
  });

  // --- cookbooks.new -------------------------------------------------------

  describe("cookbooks.new (create cookbook)", () => {
    async function run(env: Record<string, unknown> | null, scheduled: Promise<unknown>[]) {
      const user = await makeUser("cbnew");
      const cookie = await sessionCookie(user.id);
      stubReject(db.cookbook, "create", new Error("create failed"));
      const fd = new UndiciFormData();
      fd.append("title", "My Cookbook");
      const res = await newCookbookAction(
        ctxArgs(
          "http://localhost/cookbooks/new",
          "POST",
          cookie,
          fd as unknown as BodyInit,
          {},
          env,
          scheduled,
        ),
      );
      return { res, userId: user.id };
    }

    it("captures the unexpected (non-P2002) create failure when configured", async () => {
      const scheduled: Promise<unknown>[] = [];
      const { res, userId } = await run(PH, scheduled);

      // data() with a 500 status — not a Response instance.
      expect((res as any).init?.status).toBe(500);
      await drainScheduled(scheduled);
      const captures = exceptionPosts(spy.postHogPosts);
      expect(captures).toHaveLength(1);
      expect(captures[0]!.properties).toMatchObject({
        $exception_message: "create failed",
        route: "/cookbooks/new",
        method: "POST",
        action: "create_cookbook",
        $lib: "spoonjoy-server",
      });
      expect(captures[0]!.distinct_id).toBe(userId);
    });

    it("does NOT capture a P2002 unique-title conflict (expected 4xx)", async () => {
      const user = await makeUser("cbdup");
      const cookie = await sessionCookie(user.id);
      stubReject(db.cookbook, "create", Object.assign(new Error("unique"), { code: "P2002" }));
      const fd = new UndiciFormData();
      fd.append("title", "Dupe");
      const scheduled: Promise<unknown>[] = [];

      const res = await newCookbookAction(
        ctxArgs(
          "http://localhost/cookbooks/new",
          "POST",
          cookie,
          fd as unknown as BodyInit,
          {},
          PH,
          scheduled,
        ),
      );

      expect((res as any).init?.status).toBe(400);
      await drainScheduled(scheduled);
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(0);
    });

    it("does NOT capture when POSTHOG_KEY is absent", async () => {
      const scheduled: Promise<unknown>[] = [];
      const { res } = await run(null, scheduled);
      expect((res as any).init?.status).toBe(500);
      await drainScheduled(scheduled);
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(0);
    });
  });

  // --- cookbooks.$id -------------------------------------------------------

  describe("cookbooks.$id (updateTitle / addRecipe)", () => {
    async function setupOwnedCookbook(prefix: string) {
      const user = await makeUser(prefix);
      const cookie = await sessionCookie(user.id);
      const cookbook = await db.cookbook.create({
        data: { title: `Cookbook ${faker.string.alphanumeric(6)}`, authorId: user.id },
      });
      return { userId: user.id, cookie, cookbookId: cookbook.id };
    }

    it("captures + re-throws an unexpected updateTitle failure when configured", async () => {
      const { userId, cookie, cookbookId } = await setupOwnedCookbook("cbtitle");
      stubReject(db.cookbook, "update", new Error("update boom"));
      const fd = new UndiciFormData();
      fd.append("intent", "updateTitle");
      fd.append("title", "Renamed");
      const scheduled: Promise<unknown>[] = [];

      await expect(
        cookbookDetailAction(
          ctxArgs(
            `http://localhost/cookbooks/${cookbookId}`,
            "POST",
            cookie,
            fd as unknown as BodyInit,
            { id: cookbookId },
            PH,
            scheduled,
          ),
        ),
      ).rejects.toThrow("update boom");

      await drainScheduled(scheduled);
      const captures = exceptionPosts(spy.postHogPosts);
      expect(captures).toHaveLength(1);
      expect(captures[0]!.properties).toMatchObject({
        $exception_message: "update boom",
        route: `/cookbooks/${cookbookId}`,
        method: "POST",
        action: "cookbook_detail",
        intent: "updateTitle",
        $lib: "spoonjoy-server",
      });
      expect(captures[0]!.distinct_id).toBe(userId);
    });

    it("does NOT capture a P2002 updateTitle conflict (expected 4xx)", async () => {
      const { cookie, cookbookId } = await setupOwnedCookbook("cbtitledup");
      stubReject(db.cookbook, "update", Object.assign(new Error("unique"), { code: "P2002" }));
      const fd = new UndiciFormData();
      fd.append("intent", "updateTitle");
      fd.append("title", "Renamed");
      const scheduled: Promise<unknown>[] = [];

      const res = await cookbookDetailAction(
        ctxArgs(
          `http://localhost/cookbooks/${cookbookId}`,
          "POST",
          cookie,
          fd as unknown as BodyInit,
          { id: cookbookId },
          PH,
          scheduled,
        ),
      );

      expect((res as any).init?.status).toBe(400);
      await drainScheduled(scheduled);
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(0);
    });

    it("captures + re-throws an unexpected addRecipe failure with intent=addRecipe when configured", async () => {
      const { userId, cookie, cookbookId } = await setupOwnedCookbook("cbadd");
      const recipe = await db.recipe.create({ data: { title: "Stew", chefId: userId } });
      stubReject(db.recipeInCookbook, "create", new Error("add boom"));
      const fd = new UndiciFormData();
      fd.append("intent", "addRecipe");
      fd.append("recipeId", recipe.id);
      const scheduled: Promise<unknown>[] = [];

      await expect(
        cookbookDetailAction(
          ctxArgs(
            `http://localhost/cookbooks/${cookbookId}`,
            "POST",
            cookie,
            fd as unknown as BodyInit,
            { id: cookbookId },
            PH,
            scheduled,
          ),
        ),
      ).rejects.toThrow("add boom");

      await drainScheduled(scheduled);
      const captures = exceptionPosts(spy.postHogPosts);
      expect(captures).toHaveLength(1);
      expect(captures[0]!.properties).toMatchObject({
        $exception_message: "add boom",
        action: "cookbook_detail",
        intent: "addRecipe",
      });
    });

    it("does NOT capture a P2002 addRecipe (idempotent re-add) when configured", async () => {
      const { userId, cookie, cookbookId } = await setupOwnedCookbook("cbreadd");
      const recipe = await db.recipe.create({ data: { title: "Soup", chefId: userId } });
      stubReject(
        db.recipeInCookbook,
        "create",
        Object.assign(new Error("dupe"), { code: "P2002" }),
      );
      const fd = new UndiciFormData();
      fd.append("intent", "addRecipe");
      fd.append("recipeId", recipe.id);
      const scheduled: Promise<unknown>[] = [];

      const res = await cookbookDetailAction(
        ctxArgs(
          `http://localhost/cookbooks/${cookbookId}`,
          "POST",
          cookie,
          fd as unknown as BodyInit,
          { id: cookbookId },
          PH,
          scheduled,
        ),
      );

      // Idempotent re-add returns success, no capture.
      expect((res as any).data?.success).toBe(true);
      await drainScheduled(scheduled);
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(0);
    });
  });

  // --- recipes.$id.steps.new ----------------------------------------------

  describe("recipes.$id.steps.new (create step)", () => {
    async function setupOwnedRecipe(prefix: string) {
      const user = await makeUser(prefix);
      const cookie = await sessionCookie(user.id);
      const recipe = await db.recipe.create({ data: { title: "Bread", chefId: user.id } });
      return { userId: user.id, cookie, recipeId: recipe.id };
    }

    async function run(env: Record<string, unknown> | null, scheduled: Promise<unknown>[]) {
      const { userId, cookie, recipeId } = await setupOwnedRecipe("stepnew");
      stubReject(db.recipeStep, "create", new Error("step create failed"));
      const fd = new UndiciFormData();
      fd.append("description", "Mix the dough");
      const res = await newStepAction(
        ctxArgs(
          `http://localhost/recipes/${recipeId}/steps/new`,
          "POST",
          cookie,
          fd as unknown as BodyInit,
          { id: recipeId },
          env,
          scheduled,
        ),
      );
      return { res, userId, recipeId };
    }

    it("captures the unexpected step-create failure when configured", async () => {
      const scheduled: Promise<unknown>[] = [];
      const { res, userId, recipeId } = await run(PH, scheduled);

      expect((res as any).init?.status).toBe(500);
      await drainScheduled(scheduled);
      const captures = exceptionPosts(spy.postHogPosts);
      expect(captures).toHaveLength(1);
      expect(captures[0]!.properties).toMatchObject({
        $exception_message: "step create failed",
        route: `/recipes/${recipeId}/steps/new`,
        method: "POST",
        action: "create_step",
        recipe_id: recipeId,
        $lib: "spoonjoy-server",
      });
      expect(captures[0]!.distinct_id).toBe(userId);
    });

    it("does NOT capture when POSTHOG_KEY is absent", async () => {
      const scheduled: Promise<unknown>[] = [];
      const { res } = await run(null, scheduled);
      expect((res as any).init?.status).toBe(500);
      await drainScheduled(scheduled);
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(0);
    });
  });

  // --- recipes.$id.steps.$stepId.edit -------------------------------------

  describe("recipes.$id.steps.$stepId.edit (update step)", () => {
    async function setupStep(prefix: string) {
      const user = await makeUser(prefix);
      const cookie = await sessionCookie(user.id);
      const recipe = await db.recipe.create({ data: { title: "Cake", chefId: user.id } });
      const unit = await db.unit.create({
        data: { name: `unit-${faker.string.alphanumeric(6)}` },
      });
      const ref = await db.ingredientRef.create({
        data: { name: `ref-${faker.string.alphanumeric(6)}` },
      });
      const step = await db.recipeStep.create({
        data: { recipeId: recipe.id, stepNum: 1, description: "Original" },
      });
      // Give the step an ingredient so the content requirement (>=1) is met and
      // the action reaches the update persistence rather than a 400.
      await db.ingredient.create({
        data: {
          recipeId: recipe.id,
          stepNum: 1,
          quantity: 1,
          unitId: unit.id,
          ingredientRefId: ref.id,
        },
      });
      return { userId: user.id, cookie, recipeId: recipe.id, stepId: step.id };
    }

    async function run(env: Record<string, unknown> | null, scheduled: Promise<unknown>[]) {
      const { userId, cookie, recipeId, stepId } = await setupStep("stepedit");
      stubReject(db.recipeStep, "update", new Error("step update failed"));
      const fd = new UndiciFormData();
      fd.append("description", "Updated description");
      const res = await editStepAction(
        ctxArgs(
          `http://localhost/recipes/${recipeId}/steps/${stepId}/edit`,
          "POST",
          cookie,
          fd as unknown as BodyInit,
          { id: recipeId, stepId },
          env,
          scheduled,
        ),
      );
      return { res, userId, recipeId, stepId };
    }

    it("captures the unexpected step-update failure when configured", async () => {
      const scheduled: Promise<unknown>[] = [];
      const { res, userId, recipeId, stepId } = await run(PH, scheduled);

      expect((res as any).init?.status).toBe(500);
      await drainScheduled(scheduled);
      const captures = exceptionPosts(spy.postHogPosts);
      expect(captures).toHaveLength(1);
      expect(captures[0]!.properties).toMatchObject({
        $exception_message: "step update failed",
        route: `/recipes/${recipeId}/steps/${stepId}/edit`,
        method: "POST",
        action: "update_step",
        recipe_id: recipeId,
        step_id: stepId,
        $lib: "spoonjoy-server",
      });
      expect(captures[0]!.distinct_id).toBe(userId);
    });

    it("does NOT capture when POSTHOG_KEY is absent", async () => {
      const scheduled: Promise<unknown>[] = [];
      const { res } = await run(null, scheduled);
      expect((res as any).init?.status).toBe(500);
      await drainScheduled(scheduled);
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(0);
    });
  });

  // --- fire-and-forget fallback (no ctx.waitUntil available) ---------------
  //
  // When the Workers ctx exposes no waitUntil, each instrumented path takes its
  // `void capture` fallback: the capture still fires (POSTHOG_KEY set), just
  // un-awaited. These cover that branch for every instrumented surface; passing
  // `null` for `scheduled` omits ctx.waitUntil from the context.

  describe("captures without ctx.waitUntil (void-capture fallback branch)", () => {
    it("api.push.preferences", async () => {
      const user = await makeUser("prefnw");
      const cookie = await sessionCookie(user.id);
      stubReject(db.notificationPreference, "upsert", new Error("upsert failed"));
      const res = (await preferencesAction(
        ctxArgs(
          "http://localhost/api/push/preferences",
          "PATCH",
          cookie,
          JSON.stringify({ notifySpoonOnMyRecipe: false }),
          {},
          PH,
          null,
        ),
      )) as Response;
      expect(res.status).toBe(500);
      await flushMicrotasks();
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(1);
    });

    it("api.push.public-key", async () => {
      const res = (await publicKeyLoader(
        ctxArgs("http://localhost/api/push/public-key", "GET", null, null, {}, PH, null),
      )) as Response;
      expect(res.status).toBe(500);
      await flushMicrotasks();
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(1);
    });

    it("api.push.subscriptions", async () => {
      const user = await makeUser("subnw");
      const cookie = await sessionCookie(user.id);
      stubReject(db.pushSubscription, "findUnique", new Error("lookup failed"));
      const res = (await subscriptionsAction(
        ctxArgs(
          "http://localhost/api/push/subscriptions",
          "POST",
          cookie,
          JSON.stringify({ endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } }),
          {},
          PH,
          null,
        ),
      )) as Response;
      expect(res.status).toBe(500);
      await flushMicrotasks();
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(1);
    });

    it("cookbooks.new", async () => {
      const user = await makeUser("cbnewnw");
      const cookie = await sessionCookie(user.id);
      stubReject(db.cookbook, "create", new Error("create failed"));
      const fd = new UndiciFormData();
      fd.append("title", "My Cookbook");
      const res = await newCookbookAction(
        ctxArgs(
          "http://localhost/cookbooks/new",
          "POST",
          cookie,
          fd as unknown as BodyInit,
          {},
          PH,
          null,
        ),
      );
      expect((res as any).init?.status).toBe(500);
      await flushMicrotasks();
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(1);
    });

    it("cookbooks.$id", async () => {
      const user = await makeUser("cbidnw");
      const cookie = await sessionCookie(user.id);
      const cookbook = await db.cookbook.create({
        data: { title: `Cookbook ${faker.string.alphanumeric(6)}`, authorId: user.id },
      });
      stubReject(db.cookbook, "update", new Error("update boom"));
      const fd = new UndiciFormData();
      fd.append("intent", "updateTitle");
      fd.append("title", "Renamed");
      await expect(
        cookbookDetailAction(
          ctxArgs(
            `http://localhost/cookbooks/${cookbook.id}`,
            "POST",
            cookie,
            fd as unknown as BodyInit,
            { id: cookbook.id },
            PH,
            null,
          ),
        ),
      ).rejects.toThrow("update boom");
      await flushMicrotasks();
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(1);
    });

    it("recipes.$id.steps.new", async () => {
      const user = await makeUser("stepnewnw");
      const cookie = await sessionCookie(user.id);
      const recipe = await db.recipe.create({ data: { title: "Bread", chefId: user.id } });
      stubReject(db.recipeStep, "create", new Error("step create failed"));
      const fd = new UndiciFormData();
      fd.append("description", "Mix the dough");
      const res = await newStepAction(
        ctxArgs(
          `http://localhost/recipes/${recipe.id}/steps/new`,
          "POST",
          cookie,
          fd as unknown as BodyInit,
          { id: recipe.id },
          PH,
          null,
        ),
      );
      expect((res as any).init?.status).toBe(500);
      await flushMicrotasks();
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(1);
    });

    it("recipes.$id.steps.$stepId.edit", async () => {
      const user = await makeUser("stepeditnw");
      const cookie = await sessionCookie(user.id);
      const recipe = await db.recipe.create({ data: { title: "Cake", chefId: user.id } });
      const unit = await db.unit.create({ data: { name: `unit-${faker.string.alphanumeric(6)}` } });
      const ref = await db.ingredientRef.create({ data: { name: `ref-${faker.string.alphanumeric(6)}` } });
      const step = await db.recipeStep.create({
        data: { recipeId: recipe.id, stepNum: 1, description: "Original" },
      });
      await db.ingredient.create({
        data: { recipeId: recipe.id, stepNum: 1, quantity: 1, unitId: unit.id, ingredientRefId: ref.id },
      });
      stubReject(db.recipeStep, "update", new Error("step update failed"));
      const fd = new UndiciFormData();
      fd.append("description", "Updated description");
      const res = await editStepAction(
        ctxArgs(
          `http://localhost/recipes/${recipe.id}/steps/${step.id}/edit`,
          "POST",
          cookie,
          fd as unknown as BodyInit,
          { id: recipe.id, stepId: step.id },
          PH,
          null,
        ),
      );
      expect((res as any).init?.status).toBe(500);
      await flushMicrotasks();
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(1);
    });
  });
});
