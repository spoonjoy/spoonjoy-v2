// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { loader } from "~/root";
import { _resetLastSeenMemoForTests } from "~/lib/account-activity.server";
import { createUser } from "~/lib/auth.server";
import { getLocalDb } from "~/lib/db.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "./helpers/cleanup";

describe("root loader last seen", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    _resetLastSeenMemoForTests();
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  async function signedInRequest() {
    const user = await createUser(db, faker.internet.email().toLowerCase(), `chef_${faker.string.alphanumeric(10)}`, "testPassword123");
    const cookie = (await createUserSessionCookie(user.id)).split(";")[0];
    return { user, request: new Request("http://localhost/", { headers: { Cookie: cookie } }) };
  }

  it("marks a signed-in visitor as seen in the background", async () => {
    const { user, request } = await signedInRequest();
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: vi.fn((task: Promise<unknown>) => pending.push(task)) };

    const data = await loader({ request, params: {}, context: { cloudflare: { env: {}, ctx } } } as never);
    await Promise.all(pending);

    expect(data.userId).toBe(user.id);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { lastSeenAt: true } });
    expect(row.lastSeenAt).not.toBeNull();
  });

  it("does nothing for a signed-out visitor or without waitUntil", async () => {
    const ctx = { waitUntil: vi.fn() };
    await loader({ request: new Request("http://localhost/"), params: {}, context: { cloudflare: { env: {}, ctx } } } as never);
    expect(ctx.waitUntil).not.toHaveBeenCalled();

    const { user, request } = await signedInRequest();
    await loader({ request, params: {}, context: { cloudflare: { env: {} } } } as never);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { lastSeenAt: true } });
    expect(row.lastSeenAt).toBeNull();
  });
});
