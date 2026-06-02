import { afterEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/api.push.preferences";
import { getLocalDb } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { createTestUser } from "../utils";

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

async function createUser() {
  const db = await getLocalDb();
  const t = createTestUser();
  return db.user.create({
    data: { email: t.email, username: t.username, hashedPassword: t.hashedPassword, salt: t.salt },
  });
}

function routeArgs(request: Request) {
  return { request, params: {}, context: { cloudflare: { env: null } } } as Parameters<
    typeof action
  >[0];
}

afterEach(async () => {
  const db = await getLocalDb();
  await db.notificationPreference.deleteMany({});
  await db.user.deleteMany({});
});

describe("PATCH /api/push/preferences", () => {
  it("returns 401 when not authenticated", async () => {
    const request = new UndiciRequest("http://localhost/api/push/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notifySpoonOnMyRecipe: false }),
    });
    const response = await action(routeArgs(request));
    expect(response.status).toBe(401);
  });

  it("creates the NotificationPreference row when missing", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);

    const response = await action(
      routeArgs(
        new UndiciRequest("http://localhost/api/push/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ notifySpoonOnMyRecipe: false }),
        }),
      ),
    );
    expect(response.status).toBe(200);

    const db = await getLocalDb();
    const pref = await db.notificationPreference.findUnique({
      where: { userId: user.id },
    });
    expect(pref).not.toBeNull();
    expect(pref?.notifySpoonOnMyRecipe).toBe(false);
    expect(pref?.notifyForkOfMyRecipe).toBe(true); // default
  });

  it("updates only the provided keys when the row already exists", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const db = await getLocalDb();
    await db.notificationPreference.create({
      data: {
        userId: user.id,
        notifySpoonOnMyRecipe: false,
        notifyForkOfMyRecipe: false,
      },
    });

    const response = await action(
      routeArgs(
        new UndiciRequest("http://localhost/api/push/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ notifySpoonOnMyRecipe: true }),
        }),
      ),
    );
    expect(response.status).toBe(200);

    const pref = await db.notificationPreference.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(pref.notifySpoonOnMyRecipe).toBe(true);
    expect(pref.notifyForkOfMyRecipe).toBe(false); // untouched
  });

  it("returns the current preference snapshot in the response", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const response = await action(
      routeArgs(
        new UndiciRequest("http://localhost/api/push/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ notifyForkOfMyRecipe: false }),
        }),
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, boolean>;
    expect(body).toMatchObject({
      notifySpoonOnMyRecipe: true,
      notifyForkOfMyRecipe: false,
      notifyCookbookSaveOfMine: true,
      notifyFellowChefOriginCook: true,
    });
  });

  it("returns 400 on malformed JSON", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const response = await action(
      routeArgs(
        new UndiciRequest("http://localhost/api/push/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: "not json",
        }),
      ),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 on array JSON bodies", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const response = await action(
      routeArgs(
        new UndiciRequest("http://localhost/api/push/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: "[]",
        }),
      ),
    );
    expect(response.status).toBe(400);
  });

  it("accepts an empty JSON body and returns defaults", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const response = await action(
      routeArgs(
        new UndiciRequest("http://localhost/api/push/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: "   ",
        }),
      ),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      notifySpoonOnMyRecipe: true,
      notifyForkOfMyRecipe: true,
      notifyCookbookSaveOfMine: true,
      notifyFellowChefOriginCook: true,
    });
  });

  it("ignores unknown keys in the body", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const response = await action(
      routeArgs(
        new UndiciRequest("http://localhost/api/push/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ notifySpoonOnMyRecipe: false, someBogus: true }),
        }),
      ),
    );
    expect(response.status).toBe(200);
  });

  it("returns 400 if a known key has a non-boolean value", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const response = await action(
      routeArgs(
        new UndiciRequest("http://localhost/api/push/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ notifySpoonOnMyRecipe: "yes please" }),
        }),
      ),
    );
    expect(response.status).toBe(400);
  });

  it("returns 405 for unsupported methods", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const response = await action(
      routeArgs(
        new UndiciRequest("http://localhost/api/push/preferences", {
          method: "DELETE",
          headers: { Cookie: cookie },
        }),
      ),
    );
    expect(response.status).toBe(405);
  });
});
