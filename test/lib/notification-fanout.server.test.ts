import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDb } from "~/lib/db.server";
import {
  fanoutFellowChefOriginCook,
  type FanoutFellowChefOriginCookDeps,
} from "~/lib/notification-fanout.server";
import type { PostHogServerConfig } from "~/lib/analytics-server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

const VAPID = {
  publicKey: "pub",
  privateKey: "priv",
  subject: "mailto:test@example.com",
};

const POSTHOG_ENABLED: PostHogServerConfig = {
  enabled: true,
  key: "ph_test",
  host: "https://posthog.example",
};

function postHogFetchSpy() {
  return vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
}

function postHogBodies(
  fetchImpl: typeof fetch,
): Array<{ event: string; distinct_id: string; properties: Record<string, unknown> }> {
  return (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([, init]) =>
    JSON.parse((init as RequestInit).body as string),
  );
}

function makeDeps(
  overrides?: Partial<FanoutFellowChefOriginCookDeps>,
): FanoutFellowChefOriginCookDeps {
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

async function createUser() {
  const db = await getLocalDb();
  const t = createTestUser();
  return db.user.create({
    data: {
      email: t.email,
      username: t.username,
      hashedPassword: t.hashedPassword,
      salt: t.salt,
    },
  });
}

describe("fanoutFellowChefOriginCook", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });
  afterEach(async () => {
    await cleanupDatabase();
  });

  it("returns recipientsNotified=0 when the spooner has no fellow chefs", async () => {
    const spooner = await createUser();
    const db = await getLocalDb();
    const recipe = await db.recipe.create({ data: { title: "Tacos", chefId: spooner.id } });
    const result = await fanoutFellowChefOriginCook(
      db,
      {
        spoonerId: spooner.id,
        recipeId: recipe.id,
        recipeTitle: "Tacos",
        spoonerUsername: spooner.username,
      },
      makeDeps(),
    );
    expect(result.recipientsNotified).toBe(0);
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("notifies each fellow chef the spooner has engaged with (spoons on their recipes)", async () => {
    // Build: spooner has previously spooned recipes by chefA and chefB.
    // After spooner's origin-cook on their own new recipe, chefA + chefB are notified.
    const spooner = await createUser();
    const chefA = await createUser();
    const chefB = await createUser();
    const db = await getLocalDb();
    const recipeA = await db.recipe.create({ data: { title: "A-recipe", chefId: chefA.id } });
    const recipeB = await db.recipe.create({ data: { title: "B-recipe", chefId: chefB.id } });
    await db.recipeSpoon.create({
      data: { chefId: spooner.id, recipeId: recipeA.id, note: "yum" },
    });
    await db.recipeSpoon.create({
      data: { chefId: spooner.id, recipeId: recipeB.id, note: "yum" },
    });
    const newRecipe = await db.recipe.create({
      data: { title: "Spooner's New Dish", chefId: spooner.id },
    });

    const result = await fanoutFellowChefOriginCook(
      db,
      {
        spoonerId: spooner.id,
        recipeId: newRecipe.id,
        recipeTitle: "Spooner's New Dish",
        spoonerUsername: spooner.username,
      },
      makeDeps(),
    );
    expect(result.recipientsNotified).toBe(2);

    const events = await db.notificationEvent.findMany({
      where: { kind: "fellow_chef_origin_cook" },
    });
    expect(events).toHaveLength(2);
    const recipients = new Set(events.map((e) => e.recipientId));
    expect(recipients.has(chefA.id)).toBe(true);
    expect(recipients.has(chefB.id)).toBe(true);
    for (const e of events) {
      const payload = JSON.parse(e.payload);
      expect(payload).toEqual(
        expect.objectContaining({
          recipeId: newRecipe.id,
          recipeTitle: "Spooner's New Dish",
          spoonerUsername: spooner.username,
        }),
      );
    }
  });

  it("excludes the spooner themselves from the fan-out recipients (defensive)", async () => {
    // If the spooner somehow shows up in their own fellow-chefs list (shouldn't,
    // but defensive), they must not receive a notification.
    const spooner = await createUser();
    const fellow = await createUser();
    const db = await getLocalDb();
    const recipe = await db.recipe.create({ data: { title: "Fellow's Recipe", chefId: fellow.id } });
    await db.recipeSpoon.create({
      data: { chefId: spooner.id, recipeId: recipe.id, note: "y" },
    });
    const newRecipe = await db.recipe.create({
      data: { title: "Spooner New", chefId: spooner.id },
    });

    const result = await fanoutFellowChefOriginCook(
      db,
      {
        spoonerId: spooner.id,
        recipeId: newRecipe.id,
        recipeTitle: "Spooner New",
        spoonerUsername: spooner.username,
      },
      makeDeps(),
    );
    expect(result.recipientsNotified).toBe(1);
    const events = await db.notificationEvent.findMany({
      where: { kind: "fellow_chef_origin_cook" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].recipientId).toBe(fellow.id);
  });

  it("returns recipientsNotified=0 when listFellowChefs throws (errors isolated)", async () => {
    const spooner = await createUser();
    const db = await getLocalDb();
    const recipe = await db.recipe.create({
      data: { title: "Boom", chefId: spooner.id },
    });
    const listMock = vi.fn(async () => {
      throw new Error("boom");
    });
    const result = await fanoutFellowChefOriginCook(
      db,
      {
        spoonerId: spooner.id,
        recipeId: recipe.id,
        recipeTitle: "Boom",
        spoonerUsername: "spooner",
      },
      makeDeps({ listFellowChefs: listMock }),
    );
    expect(result.recipientsNotified).toBe(0);
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("caps fan-out at 100 recipients (passes limit:100 to listFellowChefs)", async () => {
    // Verifies the limit param is wired. We assert via a stubbed listFellowChefs.
    const spooner = await createUser();
    const fellow1 = await createUser();
    const fellow2 = await createUser();
    const fellow3 = await createUser();
    const db = await getLocalDb();
    const recipe = await db.recipe.create({
      data: { title: "Limited", chefId: spooner.id },
    });
    const listMock = vi.fn(async () => ({
      rows: [
        {
          chefId: fellow1.id,
          username: fellow1.username,
          photoUrl: null,
          interactionCounts: { spoons: 1, forks: 0, cookbookSaves: 0 },
          latestInteractionAt: new Date(),
        },
        {
          chefId: fellow2.id,
          username: fellow2.username,
          photoUrl: null,
          interactionCounts: { spoons: 1, forks: 0, cookbookSaves: 0 },
          latestInteractionAt: new Date(),
        },
        {
          chefId: fellow3.id,
          username: fellow3.username,
          photoUrl: null,
          interactionCounts: { spoons: 1, forks: 0, cookbookSaves: 0 },
          latestInteractionAt: new Date(),
        },
      ],
      total: 3,
    }));
    const result = await fanoutFellowChefOriginCook(
      db,
      {
        spoonerId: spooner.id,
        recipeId: recipe.id,
        recipeTitle: "Limited",
        spoonerUsername: "spooner",
      },
      makeDeps({ listFellowChefs: listMock }),
    );
    expect(listMock).toHaveBeenCalledTimes(1);
    const call = listMock.mock.calls[0];
    expect(call[1]).toBe(spooner.id);
    expect(call[2]).toEqual({ limit: 100 });
    expect(result.recipientsNotified).toBe(3);
  });
});

describe("fanoutFellowChefOriginCook — telemetry capture (M3)", () => {
  let origFetch: typeof globalThis.fetch;
  let phFetch: ReturnType<typeof postHogFetchSpy>;

  beforeEach(async () => {
    await cleanupDatabase();
    origFetch = globalThis.fetch;
    phFetch = postHogFetchSpy();
    globalThis.fetch = phFetch;
  });
  afterEach(async () => {
    globalThis.fetch = origFetch;
    await cleanupDatabase();
  });

  it("captures the swallowed fan-out failure via waitUntil when postHogConfig is set", async () => {
    const spooner = await createUser();
    const db = await getLocalDb();
    const recipe = await db.recipe.create({ data: { title: "Boom", chefId: spooner.id } });
    const listMock = vi.fn(async () => {
      throw new Error("listFellowChefs D1 boom");
    });
    const tasks: Promise<unknown>[] = [];

    const result = await fanoutFellowChefOriginCook(
      db,
      {
        spoonerId: spooner.id,
        recipeId: recipe.id,
        recipeTitle: "Boom",
        spoonerUsername: "spooner",
      },
      {
        vapid: VAPID,
        postHogConfig: POSTHOG_ENABLED,
        waitUntil: (p) => tasks.push(p),
        listFellowChefs: listMock,
      },
    );
    expect(result.recipientsNotified).toBe(0);
    await Promise.all(tasks);

    const capture = postHogBodies(phFetch).find(
      (b) => b.event === "$exception" && b.properties.phase === "fanout",
    );
    expect(capture).toBeDefined();
    expect(capture!.distinct_id).toBe(spooner.id);
    expect(capture!.properties.recipeId).toBe(recipe.id);
    expect(capture!.properties.kind).toBe("fellow_chef_origin_cook");
  });

  it("captures inline (no waitUntil) when the fan-out fails", async () => {
    const spooner = await createUser();
    const db = await getLocalDb();
    const recipe = await db.recipe.create({ data: { title: "Boom2", chefId: spooner.id } });
    const listMock = vi.fn(async () => {
      throw new Error("boom2");
    });

    const result = await fanoutFellowChefOriginCook(
      db,
      {
        spoonerId: spooner.id,
        recipeId: recipe.id,
        recipeTitle: "Boom2",
        spoonerUsername: "spooner",
      },
      {
        vapid: VAPID,
        postHogConfig: POSTHOG_ENABLED,
        // no waitUntil — capture is voided inline.
        listFellowChefs: listMock,
      },
    );
    expect(result.recipientsNotified).toBe(0);
    await new Promise((r) => setTimeout(r, 0));

    const capture = postHogBodies(phFetch).find(
      (b) => b.event === "$exception" && b.properties.phase === "fanout",
    );
    expect(capture).toBeDefined();
  });

  it("does NOT capture when postHogConfig is absent (no-op, errors still isolated)", async () => {
    const spooner = await createUser();
    const db = await getLocalDb();
    const recipe = await db.recipe.create({ data: { title: "Boom3", chefId: spooner.id } });
    const listMock = vi.fn(async () => {
      throw new Error("boom3");
    });

    const result = await fanoutFellowChefOriginCook(
      db,
      {
        spoonerId: spooner.id,
        recipeId: recipe.id,
        recipeTitle: "Boom3",
        spoonerUsername: "spooner",
      },
      {
        vapid: VAPID,
        // no postHogConfig.
        waitUntil: vi.fn((p: Promise<unknown>) => {
          void p;
        }),
        listFellowChefs: listMock,
      },
    );
    expect(result.recipientsNotified).toBe(0);
    expect(phFetch).not.toHaveBeenCalled();
  });
});
