import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDb } from "~/lib/db.server";
import {
  notifySpoonOnMyRecipe,
  notifyForkOfMyRecipe,
  notifyCookbookSaveOfMine,
  type NotifySpoonOnMyRecipeDeps,
  type NotifyForkOfMyRecipeDeps,
  type NotifyCookbookSaveOfMineDeps,
} from "~/lib/notification-triggers.server";
import type { PostHogServerConfig } from "~/lib/analytics-server";
import {
  drainScheduled,
  makePostHogFetchSpy,
  type CapturedPost,
  type PostHogFetchSpy,
} from "../helpers/posthog-capture";
import { createTestUser } from "../utils";

const VAPID = {
  publicKey: "pub",
  privateKey: "priv",
  subject: "mailto:test@example.com",
};

async function createUser() {
  const local = await getLocalDb();
  const t = createTestUser();
  return local.user.create({
    data: {
      email: t.email,
      username: t.username,
      hashedPassword: t.hashedPassword,
      salt: t.salt,
    },
  });
}

async function createRecipe(chefId: string, title: string) {
  const local = await getLocalDb();
  return local.recipe.create({ data: { title, chefId } });
}

afterEach(async () => {
  const local = await getLocalDb();
  await local.notificationEvent.deleteMany({});
  await local.recipeSpoon.deleteMany({});
  await local.recipeInCookbook.deleteMany({});
  await local.cookbook.deleteMany({});
  // Clear fork attribution before deleting recipes (Recipe.sourceRecipe uses onDelete: Restrict).
  await local.recipe.updateMany({ data: { sourceRecipeId: null } });
  await local.recipe.deleteMany({});
  await local.user.deleteMany({});
});

function makeDeps(overrides?: Partial<NotifySpoonOnMyRecipeDeps>): NotifySpoonOnMyRecipeDeps {
  return {
    vapid: VAPID,
    waitUntil: vi.fn((p: Promise<unknown>) => {
      void p;
    }),
    sendPush: vi.fn(async () => ({
      status: "delivered" as const,
      httpStatus: 201,
      providerEndpoint: "x",
    })),
    ...overrides,
  };
}

describe("notifySpoonOnMyRecipe", () => {
  it("writes a NotificationEvent when the spooner is not the recipe owner", async () => {
    const owner = await createUser();
    const spooner = await createUser();
    const recipe = await createRecipe(owner.id, "Pie");
    const db = await getLocalDb();

    await notifySpoonOnMyRecipe(
      db,
      { recipeId: recipe.id, spoonerId: spooner.id },
      makeDeps(),
    );

    const events = await db.notificationEvent.findMany({
      where: { recipientId: owner.id, kind: "spoon_on_my_recipe" },
    });
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0].payload);
    expect(payload).toEqual(
      expect.objectContaining({
        recipeId: recipe.id,
        recipeTitle: "Pie",
        spoonerUsername: spooner.username,
      }),
    );
  });

  it("does NOT enqueue on self-spoon (spooner === owner)", async () => {
    const owner = await createUser();
    const recipe = await createRecipe(owner.id, "Pie");
    const db = await getLocalDb();
    await notifySpoonOnMyRecipe(
      db,
      { recipeId: recipe.id, spoonerId: owner.id },
      makeDeps(),
    );
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("returns gracefully when the recipe does not exist", async () => {
    const spooner = await createUser();
    const db = await getLocalDb();
    await expect(
      notifySpoonOnMyRecipe(
        db,
        { recipeId: "missing", spoonerId: spooner.id },
        makeDeps(),
      ),
    ).resolves.not.toThrow();
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("returns gracefully when the spooner does not exist", async () => {
    const owner = await createUser();
    const recipe = await createRecipe(owner.id, "Pie");
    const db = await getLocalDb();
    await expect(
      notifySpoonOnMyRecipe(
        db,
        { recipeId: recipe.id, spoonerId: "missing-user" },
        makeDeps(),
      ),
    ).resolves.not.toThrow();
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("does not throw when the dispatcher itself rejects (errors are isolated)", async () => {
    const owner = await createUser();
    const spooner = await createUser();
    const recipe = await createRecipe(owner.id, "Pie");
    const db = await getLocalDb();
    const orig = db.notificationEvent.create;
    db.notificationEvent.create = vi.fn(async () => {
      throw new Error("dispatcher boom");
    }) as unknown as typeof db.notificationEvent.create;

    try {
      await expect(
        notifySpoonOnMyRecipe(
          db,
          { recipeId: recipe.id, spoonerId: spooner.id },
          makeDeps(),
        ),
      ).resolves.not.toThrow();
    } finally {
      db.notificationEvent.create = orig;
    }
  });
});

function makeForkDeps(
  overrides?: Partial<NotifyForkOfMyRecipeDeps>,
): NotifyForkOfMyRecipeDeps {
  return {
    vapid: VAPID,
    waitUntil: vi.fn((p: Promise<unknown>) => {
      void p;
    }),
    sendPush: vi.fn(async () => ({
      status: "delivered" as const,
      httpStatus: 201,
      providerEndpoint: "x",
    })),
    ...overrides,
  };
}

describe("notifyForkOfMyRecipe", () => {
  it("writes a NotificationEvent for the source-chef when the forker is someone else", async () => {
    const owner = await createUser();
    const forker = await createUser();
    const source = await createRecipe(owner.id, "Curry");
    const forked = await (await getLocalDb()).recipe.create({
      data: { title: "Curry (variation 2)", chefId: forker.id, sourceRecipeId: source.id },
    });
    const db = await getLocalDb();

    await notifyForkOfMyRecipe(
      db,
      {
        forkedRecipeId: forked.id,
        sourceRecipeId: source.id,
        forkerId: forker.id,
        sourceChefId: owner.id,
        appliedTitle: forked.title,
      },
      makeForkDeps(),
    );

    const events = await db.notificationEvent.findMany({
      where: { recipientId: owner.id, kind: "fork_of_my_recipe" },
    });
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0].payload);
    expect(payload).toEqual(
      expect.objectContaining({
        forkedRecipeId: forked.id,
        sourceRecipeId: source.id,
        recipeTitle: forked.title,
        forkerUsername: forker.username,
      }),
    );
  });

  it("does NOT enqueue on self-fork (forker === source chef)", async () => {
    const owner = await createUser();
    const source = await createRecipe(owner.id, "Curry");
    const db = await getLocalDb();
    const forked = await db.recipe.create({
      data: { title: "Curry (variation 2)", chefId: owner.id, sourceRecipeId: source.id },
    });
    await notifyForkOfMyRecipe(
      db,
      {
        forkedRecipeId: forked.id,
        sourceRecipeId: source.id,
        forkerId: owner.id,
        sourceChefId: owner.id,
        appliedTitle: forked.title,
      },
      makeForkDeps(),
    );
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("returns gracefully when the forker does not exist", async () => {
    const owner = await createUser();
    const source = await createRecipe(owner.id, "Curry");
    const db = await getLocalDb();
    await expect(
      notifyForkOfMyRecipe(
        db,
        {
          forkedRecipeId: "missing",
          sourceRecipeId: source.id,
          forkerId: "missing-user",
          sourceChefId: owner.id,
          appliedTitle: "Curry",
        },
        makeForkDeps(),
      ),
    ).resolves.not.toThrow();
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("does not throw when the dispatcher itself rejects (errors are isolated)", async () => {
    const owner = await createUser();
    const forker = await createUser();
    const source = await createRecipe(owner.id, "Curry");
    const db = await getLocalDb();
    const forked = await db.recipe.create({
      data: { title: "Curry (variation 2)", chefId: forker.id, sourceRecipeId: source.id },
    });
    const orig = db.notificationEvent.create;
    db.notificationEvent.create = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof db.notificationEvent.create;

    try {
      await expect(
        notifyForkOfMyRecipe(
          db,
          {
            forkedRecipeId: forked.id,
            sourceRecipeId: source.id,
            forkerId: forker.id,
            sourceChefId: owner.id,
            appliedTitle: forked.title,
          },
          makeForkDeps(),
        ),
      ).resolves.not.toThrow();
    } finally {
      db.notificationEvent.create = orig;
    }
  });
});

function makeSaveDeps(
  overrides?: Partial<NotifyCookbookSaveOfMineDeps>,
): NotifyCookbookSaveOfMineDeps {
  return {
    vapid: VAPID,
    waitUntil: vi.fn((p: Promise<unknown>) => {
      void p;
    }),
    sendPush: vi.fn(async () => ({
      status: "delivered" as const,
      httpStatus: 201,
      providerEndpoint: "x",
    })),
    ...overrides,
  };
}

describe("notifyCookbookSaveOfMine", () => {
  it("writes a NotificationEvent for the recipe owner when another user saves to their cookbook", async () => {
    const owner = await createUser();
    const saver = await createUser();
    const recipe = await createRecipe(owner.id, "Soup");
    const db = await getLocalDb();

    await notifyCookbookSaveOfMine(
      db,
      { recipeId: recipe.id, actorId: saver.id },
      makeSaveDeps(),
    );

    const events = await db.notificationEvent.findMany({
      where: { recipientId: owner.id, kind: "cookbook_save_of_mine" },
    });
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0].payload);
    expect(payload).toEqual(
      expect.objectContaining({
        recipeId: recipe.id,
        recipeTitle: "Soup",
        actorUsername: saver.username,
      }),
    );
  });

  it("does NOT enqueue when actor is the recipe owner", async () => {
    const owner = await createUser();
    const recipe = await createRecipe(owner.id, "Soup");
    const db = await getLocalDb();
    await notifyCookbookSaveOfMine(
      db,
      { recipeId: recipe.id, actorId: owner.id },
      makeSaveDeps(),
    );
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("returns gracefully when the recipe does not exist", async () => {
    const saver = await createUser();
    const db = await getLocalDb();
    await expect(
      notifyCookbookSaveOfMine(
        db,
        { recipeId: "missing-recipe", actorId: saver.id },
        makeSaveDeps(),
      ),
    ).resolves.not.toThrow();
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("returns gracefully when the actor does not exist", async () => {
    const owner = await createUser();
    const recipe = await createRecipe(owner.id, "Soup");
    const db = await getLocalDb();
    await expect(
      notifyCookbookSaveOfMine(
        db,
        { recipeId: recipe.id, actorId: "missing-user" },
        makeSaveDeps(),
      ),
    ).resolves.not.toThrow();
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("does not throw when the dispatcher itself rejects (errors are isolated)", async () => {
    const owner = await createUser();
    const saver = await createUser();
    const recipe = await createRecipe(owner.id, "Soup");
    const db = await getLocalDb();
    const orig = db.notificationEvent.create;
    db.notificationEvent.create = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof db.notificationEvent.create;

    try {
      await expect(
        notifyCookbookSaveOfMine(
          db,
          { recipeId: recipe.id, actorId: saver.id },
          makeSaveDeps(),
        ),
      ).resolves.not.toThrow();
    } finally {
      db.notificationEvent.create = orig;
    }
  });
});

// --- trigger-evaluation telemetry --------------------------------------------
//
// The trigger's OWN pre-load (recipe/actor lookup, run before the dispatcher)
// is otherwise silent. These prove the swallowed failure is now captured via
// the injected postHogConfig — fire-and-forget, tagged with the trigger kind
// and phase=triggerEval — and that it stays a no-op without PostHog config.

const ENABLED_POSTHOG: PostHogServerConfig = {
  enabled: true,
  key: "ph_test",
  host: "https://us.i.posthog.com",
};

/** $exception capture posts (the shape captureException emits). */
function exceptionPosts(posts: CapturedPost[]): CapturedPost[] {
  return posts.filter((p) => p.event === "$exception");
}

describe("notification triggers — trigger-evaluation telemetry", () => {
  let origFetch: typeof globalThis.fetch;
  let spy: PostHogFetchSpy;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    spy = makePostHogFetchSpy();
    globalThis.fetch = spy.impl;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  /**
   * Build deps whose recipe pre-load throws, so the trigger's own catch fires
   * before the dispatcher is ever reached. The db is a minimal stub: only the
   * methods the pre-load touches are present.
   */
  function makeThrowingDb(): { recipe: { findUnique: () => Promise<never> }; user: { findUnique: () => Promise<null> } } {
    return {
      recipe: {
        findUnique: vi.fn(async () => {
          throw new Error("D1 read failed");
        }),
      },
      user: { findUnique: vi.fn(async () => null) },
    };
  }

  it("notifySpoonOnMyRecipe captures the swallowed pre-load failure with kind + phase when config is enabled", async () => {
    const scheduled: Promise<unknown>[] = [];
    await notifySpoonOnMyRecipe(
      makeThrowingDb() as never,
      { recipeId: "r1", spoonerId: "s1" },
      {
        vapid: VAPID,
        waitUntil: (p) => scheduled.push(p),
        postHogConfig: ENABLED_POSTHOG,
      },
    );

    // Capture is fire-and-forget, scheduled via waitUntil.
    expect(scheduled.length).toBeGreaterThan(0);
    await drainScheduled(scheduled);

    const captures = exceptionPosts(spy.postHogPosts);
    expect(captures).toHaveLength(1);
    expect(captures[0]!.properties).toMatchObject({
      kind: "spoon_on_my_recipe",
      phase: "triggerEval",
      $lib: "spoonjoy-server",
    });
  });

  it("notifyForkOfMyRecipe captures with the source chef as distinctId and fork kind", async () => {
    const scheduled: Promise<unknown>[] = [];
    const db = {
      user: {
        findUnique: vi.fn(async () => {
          throw new Error("D1 read failed");
        }),
      },
    };
    await notifyForkOfMyRecipe(
      db as never,
      {
        forkedRecipeId: "f1",
        sourceRecipeId: "src1",
        forkerId: "forker1",
        sourceChefId: "chef-owner",
        appliedTitle: "Dish",
      },
      {
        vapid: VAPID,
        waitUntil: (p) => scheduled.push(p),
        postHogConfig: ENABLED_POSTHOG,
      },
    );
    await drainScheduled(scheduled);

    const captures = exceptionPosts(spy.postHogPosts);
    expect(captures).toHaveLength(1);
    expect(captures[0]!.properties).toMatchObject({
      kind: "fork_of_my_recipe",
      phase: "triggerEval",
    });
    // distinct_id is the known recipient (source chef), not the server fallback.
    expect(captures[0]!).toMatchObject({ distinct_id: "chef-owner" });
  });

  it("notifyCookbookSaveOfMine captures the swallowed pre-load failure", async () => {
    const scheduled: Promise<unknown>[] = [];
    await notifyCookbookSaveOfMine(
      makeThrowingDb() as never,
      { recipeId: "r1", actorId: "a1" },
      {
        vapid: VAPID,
        waitUntil: (p) => scheduled.push(p),
        postHogConfig: ENABLED_POSTHOG,
      },
    );
    await drainScheduled(scheduled);

    const captures = exceptionPosts(spy.postHogPosts);
    expect(captures).toHaveLength(1);
    expect(captures[0]!.properties).toMatchObject({
      kind: "cookbook_save_of_mine",
      phase: "triggerEval",
    });
  });

  it("does NOT capture when no postHogConfig is supplied (no-op)", async () => {
    const scheduled: Promise<unknown>[] = [];
    await notifySpoonOnMyRecipe(
      makeThrowingDb() as never,
      { recipeId: "r1", spoonerId: "s1" },
      { vapid: VAPID, waitUntil: (p) => scheduled.push(p) },
    );
    await drainScheduled(scheduled);
    expect(exceptionPosts(spy.postHogPosts)).toHaveLength(0);
  });

  it("does NOT capture when the config is disabled (missing key)", async () => {
    const scheduled: Promise<unknown>[] = [];
    await notifySpoonOnMyRecipe(
      makeThrowingDb() as never,
      { recipeId: "r1", spoonerId: "s1" },
      {
        vapid: VAPID,
        waitUntil: (p) => scheduled.push(p),
        postHogConfig: { enabled: false, reason: "missing-key" },
      },
    );
    await drainScheduled(scheduled);
    expect(exceptionPosts(spy.postHogPosts)).toHaveLength(0);
  });

  it("still does not throw when capture is active and the pre-load fails", async () => {
    await expect(
      notifySpoonOnMyRecipe(
        makeThrowingDb() as never,
        { recipeId: "r1", spoonerId: "s1" },
        { vapid: VAPID, postHogConfig: ENABLED_POSTHOG },
      ),
    ).resolves.not.toThrow();
  });
});
