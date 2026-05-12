import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { handleRecipeDetailAction } from "~/lib/recipe-detail.server";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";

function uniqueEmail(prefix = "n") {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  const setCookie = await sessionStorage.commitSession(session);
  return setCookie.split(";")[0];
}

const VAPID_ENV = {
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv",
  VAPID_SUBJECT: "mailto:test@example.com",
};

describe("recipes.$id action — spoon_on_my_recipe trigger wiring", () => {
  let chefId: string;
  let cookId: string;
  let recipeId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    const chef = await createUser(
      db,
      uniqueEmail("chef"),
      `chef_${faker.string.alphanumeric(8).toLowerCase()}`,
      "testPassword123",
    );
    const cook = await createUser(
      db,
      uniqueEmail("cook"),
      `cook_${faker.string.alphanumeric(8).toLowerCase()}`,
      "testPassword123",
    );
    chefId = chef.id;
    cookId = cook.id;
    const recipe = await db.recipe.create({
      data: { title: "Test Pie", chefId },
    });
    recipeId = recipe.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("writes a NotificationEvent for the owner when another user spoons their recipe (VAPID configured)", async () => {
    const cookie = await sessionCookie(cookId);
    const fd = new UndiciFormData();
    fd.append("intent", "createSpoon");
    fd.append("note", "yum");

    const captured: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<unknown>) => {
      captured.push(p);
    };

    await handleRecipeDetailAction({
      request: new UndiciRequest(`http://localhost/recipes/${recipeId}`, {
        method: "POST",
        headers: { cookie },
        body: fd,
      }) as unknown as Request,
      params: { id: recipeId },
      context: {
        cloudflare: { env: VAPID_ENV, ctx: { waitUntil } as any },
      } as any,
    });

    await Promise.all(captured);

    const events = await db.notificationEvent.findMany({
      where: { recipientId: chefId, kind: "spoon_on_my_recipe" },
    });
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0].payload);
    expect(payload.recipeId).toBe(recipeId);
    expect(payload.recipeTitle).toBe("Test Pie");
  });

  it("does NOT write a NotificationEvent on self-spoon by the owner", async () => {
    // Seed a prior spoon so this owner's spoon isn't an "origin cook" (which requires a photo).
    await db.recipeSpoon.create({
      data: { chefId, recipeId, note: "seed", cookedAt: new Date() },
    });

    const cookie = await sessionCookie(chefId); // owner spoons their own recipe
    const fd = new UndiciFormData();
    fd.append("intent", "createSpoon");
    fd.append("note", "self-cook");

    const captured: Promise<unknown>[] = [];
    await handleRecipeDetailAction({
      request: new UndiciRequest(`http://localhost/recipes/${recipeId}`, {
        method: "POST",
        headers: { cookie },
        body: fd,
      }) as unknown as Request,
      params: { id: recipeId },
      context: {
        cloudflare: {
          env: VAPID_ENV,
          ctx: { waitUntil: (p: Promise<unknown>) => captured.push(p) } as any,
        },
      } as any,
    });
    await Promise.all(captured);

    const events = await db.notificationEvent.count();
    expect(events).toBe(0);
  });

  it("awaits the notification task inline when no waitUntil is provided", async () => {
    const cookie = await sessionCookie(cookId);
    const fd = new UndiciFormData();
    fd.append("intent", "createSpoon");
    fd.append("note", "inline");

    await handleRecipeDetailAction({
      request: new UndiciRequest(`http://localhost/recipes/${recipeId}`, {
        method: "POST",
        headers: { cookie },
        body: fd,
      }) as unknown as Request,
      params: { id: recipeId },
      context: {
        cloudflare: { env: VAPID_ENV },
      } as any,
    });

    const events = await db.notificationEvent.findMany({
      where: { recipientId: chefId },
    });
    expect(events).toHaveLength(1);
  });

  it("does not break the spoon response when VAPID env is missing", async () => {
    const cookie = await sessionCookie(cookId);
    const fd = new UndiciFormData();
    fd.append("intent", "createSpoon");
    fd.append("note", "novapid");

    const captured: Promise<unknown>[] = [];
    const response = await handleRecipeDetailAction({
      request: new UndiciRequest(`http://localhost/recipes/${recipeId}`, {
        method: "POST",
        headers: { cookie },
        body: fd,
      }) as unknown as Request,
      params: { id: recipeId },
      context: {
        cloudflare: {
          env: null,
          ctx: { waitUntil: (p: Promise<unknown>) => captured.push(p) } as any,
        },
      } as any,
    });
    await Promise.all(captured);
    // The action's data response shape: { success: true, spoon, isOriginCook }
    const data = (response as { data?: unknown })?.data ?? response;
    expect(data).toMatchObject({ success: true });
    // No notification event written when VAPID is missing.
    const events = await db.notificationEvent.count();
    expect(events).toBe(0);
  });
});
