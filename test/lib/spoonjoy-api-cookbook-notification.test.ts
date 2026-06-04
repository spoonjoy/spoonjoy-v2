import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import {
  callSpoonjoyApiOperation,
  type SpoonjoyApiContext,
} from "~/lib/spoonjoy-api.server";
import type { ApiPrincipal } from "~/lib/api-auth.server";
import { cleanupDatabase } from "../helpers/cleanup";

type Database = Awaited<ReturnType<typeof getLocalDb>>;

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
    scopes: ["cookbooks:read", "public:read", "recipes:read", "shopping_list:read", "shopping_list:write", "tokens:read", "tokens:write", "kitchen:read", "kitchen:write"],
  };
  return { user, principal };
}

async function makeRecipe(db: Database, chefId: string, title?: string) {
  return db.recipe.create({
    data: {
      title: title ?? `Cookbook Notify ${faker.string.alphanumeric(6)}`,
      description: "desc",
      chefId,
    },
  });
}

async function makeCookbook(db: Database, authorId: string) {
  return db.cookbook.create({
    data: {
      title: `Notify Cookbook ${faker.string.alphanumeric(6)}`,
      authorId,
    },
  });
}

describe("spoonjoy-api add_recipe_to_cookbook — cookbook_save_of_mine trigger wiring", () => {
  let db: Database;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("writes a NotificationEvent for the recipe owner when another user saves to their cookbook (with VAPID env)", async () => {
    const { principal: owner } = await makeUser(db);
    const { principal: saver } = await makeUser(db);
    const recipe = await makeRecipe(db, owner.id, "Pad Thai");
    const cookbook = await makeCookbook(db, saver.id);
    const captured: Promise<unknown>[] = [];
    const context: SpoonjoyApiContext = {
      db,
      principal: saver,
      waitUntil: (p) => captured.push(p),
      env: {
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        VAPID_SUBJECT: "mailto:test@example.com",
      },
    };
    await callSpoonjoyApiOperation(
      "add_recipe_to_cookbook",
      { cookbookId: cookbook.id, recipeId: recipe.id },
      context,
    );
    await Promise.all(captured);
    const events = await db.notificationEvent.findMany({
      where: { recipientId: owner.id, kind: "cookbook_save_of_mine" },
    });
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0].payload);
    expect(payload.recipeId).toBe(recipe.id);
    expect(payload.recipeTitle).toBe("Pad Thai");
    expect(payload.actorUsername).toBe(saver.username);
  });

  it("does NOT enqueue when the actor IS the recipe owner", async () => {
    const { principal: owner } = await makeUser(db);
    const recipe = await makeRecipe(db, owner.id, "Self Saved");
    const cookbook = await makeCookbook(db, owner.id);
    const captured: Promise<unknown>[] = [];
    await callSpoonjoyApiOperation(
      "add_recipe_to_cookbook",
      { cookbookId: cookbook.id, recipeId: recipe.id },
      {
        db,
        principal: owner,
        waitUntil: (p) => captured.push(p),
        env: {
          VAPID_PUBLIC_KEY: "pub",
          VAPID_PRIVATE_KEY: "priv",
          VAPID_SUBJECT: "mailto:test@example.com",
        },
      },
    );
    await Promise.all(captured);
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("does NOT enqueue a second notification on idempotent re-add (added=false path)", async () => {
    const { principal: owner } = await makeUser(db);
    const { principal: saver } = await makeUser(db);
    const recipe = await makeRecipe(db, owner.id, "Re-Added");
    const cookbook = await makeCookbook(db, saver.id);
    const captured: Promise<unknown>[] = [];
    const context: SpoonjoyApiContext = {
      db,
      principal: saver,
      waitUntil: (p) => captured.push(p),
      env: {
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        VAPID_SUBJECT: "mailto:test@example.com",
      },
    };
    await callSpoonjoyApiOperation(
      "add_recipe_to_cookbook",
      { cookbookId: cookbook.id, recipeId: recipe.id },
      context,
    );
    await callSpoonjoyApiOperation(
      "add_recipe_to_cookbook",
      { cookbookId: cookbook.id, recipeId: recipe.id },
      context,
    );
    await Promise.all(captured);
    const events = await db.notificationEvent.count({
      where: { recipientId: owner.id, kind: "cookbook_save_of_mine" },
    });
    expect(events).toBe(1);
  });

  it("does not break the operation when VAPID env is missing", async () => {
    const { principal: owner } = await makeUser(db);
    const { principal: saver } = await makeUser(db);
    const recipe = await makeRecipe(db, owner.id, "No-VAPID Save");
    const cookbook = await makeCookbook(db, saver.id);
    const captured: Promise<unknown>[] = [];
    const result = (await callSpoonjoyApiOperation(
      "add_recipe_to_cookbook",
      { cookbookId: cookbook.id, recipeId: recipe.id },
      {
        db,
        principal: saver,
        waitUntil: (p) => captured.push(p),
        env: null,
      },
    )) as { added: boolean };
    await Promise.all(captured);
    expect(result.added).toBe(true);
    expect(await db.notificationEvent.count()).toBe(0);
  });
});
