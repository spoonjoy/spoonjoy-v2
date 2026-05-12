import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocalDb } from "~/lib/db.server";
import {
  notifySpoonOnMyRecipe,
  type NotifySpoonOnMyRecipeDeps,
} from "~/lib/notification-triggers.server";
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
