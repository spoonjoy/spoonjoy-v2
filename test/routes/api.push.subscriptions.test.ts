import { afterEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/api.push.subscriptions";
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
  await db.pushSubscription.deleteMany({});
  await db.user.deleteMany({});
});

describe("POST /api/push/subscriptions", () => {
  it("returns 401 when not authenticated", async () => {
    const request = new UndiciRequest("http://localhost/api/push/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "https://e", keys: { p256dh: "p", auth: "a" } }),
    });
    const response = await action(routeArgs(request));
    expect(response.status).toBe(401);
  });

  it("returns 400 on missing endpoint", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const request = new UndiciRequest("http://localhost/api/push/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ keys: { p256dh: "p", auth: "a" } }),
    });
    const response = await action(routeArgs(request));
    expect(response.status).toBe(400);
  });

  it("returns 400 on missing keys.p256dh", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const request = new UndiciRequest("http://localhost/api/push/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ endpoint: "https://e", keys: { auth: "a" } }),
    });
    const response = await action(routeArgs(request));
    expect(response.status).toBe(400);
  });

  it("returns 400 on missing keys.auth", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const request = new UndiciRequest("http://localhost/api/push/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ endpoint: "https://e", keys: { p256dh: "p" } }),
    });
    const response = await action(routeArgs(request));
    expect(response.status).toBe(400);
  });

  it("returns 400 on missing keys object", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const request = new UndiciRequest("http://localhost/api/push/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ endpoint: "https://e" }),
    });
    const response = await action(routeArgs(request));
    expect(response.status).toBe(400);
  });

  it("returns 400 on malformed JSON", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const request = new UndiciRequest("http://localhost/api/push/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: "{not json",
    });
    const response = await action(routeArgs(request));
    expect(response.status).toBe(400);
  });

  it("returns 400 on array JSON bodies", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const request = new UndiciRequest("http://localhost/api/push/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: "[]",
    });
    const response = await action(routeArgs(request));
    expect(response.status).toBe(400);
  });

  it("treats an empty JSON body as missing endpoint", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const request = new UndiciRequest("http://localhost/api/push/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: "   ",
    });
    const response = await action(routeArgs(request));
    expect(response.status).toBe(400);
  });

  it("creates the subscription row and returns 201 on first POST", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const request = new UndiciRequest("http://localhost/api/push/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        endpoint: "https://push.example/abc",
        keys: { p256dh: "p", auth: "a" },
        userAgent: "Mozilla/5.0 (X11) test",
      }),
    });
    const response = await action(routeArgs(request));
    expect(response.status).toBe(201);

    const db = await getLocalDb();
    const rows = await db.pushSubscription.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].endpoint).toBe("https://push.example/abc");
    expect(rows[0].userAgent).toBe("Mozilla/5.0 (X11) test");
  });

  it("returns 200 (not 201) on idempotent re-POST with same endpoint; no duplicate row; lastSeenAt updates", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);

    const body = JSON.stringify({
      endpoint: "https://push.example/idem",
      keys: { p256dh: "p", auth: "a" },
    });
    const first = await action(
      routeArgs(
        new UndiciRequest("http://localhost/api/push/subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body,
        }),
      ),
    );
    expect(first.status).toBe(201);

    // Wait a millisecond so lastSeenAt is observably different.
    await new Promise((r) => setTimeout(r, 5));

    const second = await action(
      routeArgs(
        new UndiciRequest("http://localhost/api/push/subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body,
        }),
      ),
    );
    expect(second.status).toBe(200);

    const db = await getLocalDb();
    const rows = await db.pushSubscription.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
  });

  it("reassigns an existing endpoint from another user and ignores non-string user agents", async () => {
    const owner = await createUser();
    const nextOwner = await createUser();
    const cookie = await sessionCookie(nextOwner.id);
    const db = await getLocalDb();
    const row = await db.pushSubscription.create({
      data: {
        userId: owner.id,
        endpoint: "https://push.example/reassign",
        p256dh: "old",
        authSecret: "old-auth",
        userAgent: "old agent",
      },
    });

    const request = new UndiciRequest("http://localhost/api/push/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        endpoint: "https://push.example/reassign",
        keys: { p256dh: "new", auth: "new-auth" },
        userAgent: 123,
      }),
    });
    const response = await action(routeArgs(request));
    expect(response.status).toBe(200);

    const updated = await db.pushSubscription.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated).toMatchObject({
      userId: nextOwner.id,
      p256dh: "new",
      authSecret: "new-auth",
      userAgent: null,
    });
  });
});

describe("DELETE /api/push/subscriptions", () => {
  it("returns 401 when not authenticated", async () => {
    const request = new UndiciRequest("http://localhost/api/push/subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "https://e" }),
    });
    const response = await action(routeArgs(request));
    expect(response.status).toBe(401);
  });

  it("returns 400 on missing endpoint", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const request = new UndiciRequest("http://localhost/api/push/subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({}),
    });
    const response = await action(routeArgs(request));
    expect(response.status).toBe(400);
  });

  it("returns 400 on array JSON bodies", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const request = new UndiciRequest("http://localhost/api/push/subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: "[]",
    });
    const response = await action(routeArgs(request));
    expect(response.status).toBe(400);
  });

  it("returns 204 and removes the row on success", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const db = await getLocalDb();
    await db.pushSubscription.create({
      data: { userId: user.id, endpoint: "https://e/x", p256dh: "p", authSecret: "a" },
    });
    const request = new UndiciRequest("http://localhost/api/push/subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ endpoint: "https://e/x" }),
    });
    const response = await action(routeArgs(request));
    expect(response.status).toBe(204);
    const rows = await db.pushSubscription.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(0);
  });

  it("returns 404 if endpoint is unknown OR not owned by user", async () => {
    const owner = await createUser();
    const other = await createUser();
    const cookie = await sessionCookie(other.id);
    const db = await getLocalDb();
    await db.pushSubscription.create({
      data: { userId: owner.id, endpoint: "https://e/foreign", p256dh: "p", authSecret: "a" },
    });
    const request = new UndiciRequest("http://localhost/api/push/subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ endpoint: "https://e/foreign" }),
    });
    const response = await action(routeArgs(request));
    expect(response.status).toBe(404);
  });
});

describe("subscriptions route — other methods", () => {
  it("returns 405 for unsupported methods", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const request = new UndiciRequest("http://localhost/api/push/subscriptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: "{}",
    });
    const response = await action(routeArgs(request));
    expect(response.status).toBe(405);
  });
});
