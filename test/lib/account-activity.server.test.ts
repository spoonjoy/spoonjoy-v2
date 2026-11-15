// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureException: vi.fn(() => Promise.resolve()),
}));

import { captureException } from "~/lib/analytics-server";
import { createUser } from "~/lib/auth.server";
import { getLocalDb } from "~/lib/db.server";
import {
  _resetLastSeenMemoForTests,
  LAST_SEEN_INTERVAL_MS,
  recordAccountSignIn,
  touchLastSeen,
} from "~/lib/account-activity.server";
import { cleanupDatabase } from "../helpers/cleanup";

const T0 = new Date("2026-11-15T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("account activity", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  let userId: string;

  async function activity() {
    return db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { lastSeenAt: true, lastSignInAt: true, lastSignInMethod: true, updatedAt: true },
    });
  }

  beforeEach(async () => {
    _resetLastSeenMemoForTests();
    vi.mocked(captureException).mockClear();
    await cleanupDatabase();
    db = await getLocalDb();
    userId = (await createUser(db, faker.internet.email().toLowerCase(), `chef_${faker.string.alphanumeric(10)}`, "testPassword123")).id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("starts empty, and records a sign-in's time and method without touching updatedAt", async () => {
    const before = await activity();
    expect(before).toMatchObject({ lastSeenAt: null, lastSignInAt: null, lastSignInMethod: null });

    await recordAccountSignIn(null, userId, "apple", T0);

    const after = await activity();
    expect(after.lastSignInAt?.toISOString()).toBe(T0.toISOString());
    expect(after.lastSignInMethod).toBe("apple");
    expect(after.lastSeenAt?.toISOString()).toBe(T0.toISOString());
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("moves last seen at most once an hour", async () => {
    await touchLastSeen(undefined, userId, T0);
    expect((await activity()).lastSeenAt?.toISOString()).toBe(T0.toISOString());

    expect(touchLastSeen(undefined, userId, at(LAST_SEEN_INTERVAL_MS - 1))).toBeNull();
    expect((await activity()).lastSeenAt?.toISOString()).toBe(T0.toISOString());

    // Another isolate (no memo) inside the hour: the UPDATE's own guard holds.
    _resetLastSeenMemoForTests();
    await touchLastSeen(undefined, userId, at(LAST_SEEN_INTERVAL_MS - 1));
    expect((await activity()).lastSeenAt?.toISOString()).toBe(T0.toISOString());

    await touchLastSeen(undefined, userId, at(2 * LAST_SEEN_INTERVAL_MS));
    expect((await activity()).lastSeenAt?.toISOString()).toBe(at(2 * LAST_SEEN_INTERVAL_MS).toISOString());
  });

  it("writes through the D1 binding when there is one", async () => {
    const run = vi.fn(async () => ({}));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));

    await recordAccountSignIn({ DB: { prepare } }, "user_d1", "google", T0);
    await touchLastSeen({ DB: { prepare } }, "user_d1", at(LAST_SEEN_INTERVAL_MS));

    expect(prepare.mock.calls[0][0]).toContain('"lastSignInMethod" = ?');
    expect(bind.mock.calls[0]).toEqual([T0.toISOString(), "google", T0.toISOString(), "user_d1"]);
    expect(bind.mock.calls[1]).toEqual([at(LAST_SEEN_INTERVAL_MS).toISOString(), "user_d1", T0.getTime()]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("never throws: a failed write is captured when there is an env, and dropped without one", async () => {
    const prepare = vi.fn(() => {
      throw new Error("D1 down");
    });

    await expect(touchLastSeen({ DB: { prepare }, POSTHOG_KEY: "ph_test" }, "user_x", T0)).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      distinctId: "user_x",
      route: "account-activity",
      extras: { phase: "last_seen" },
    }));

    vi.spyOn(db, "$executeRawUnsafe").mockRejectedValueOnce(new Error("sqlite down"));
    await expect(recordAccountSignIn(null, "user_y", "password", T0)).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("uses the current time by default", async () => {
    await recordAccountSignIn(null, userId, "passkey");
    _resetLastSeenMemoForTests();
    await touchLastSeen(null, userId);
    const row = await activity();
    expect(row.lastSignInMethod).toBe("passkey");
    expect(Math.abs(row.lastSeenAt!.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("keeps its memo bounded", async () => {
    const run = vi.fn(async () => ({}));
    const DB = { prepare: () => ({ bind: () => ({ run }) }) };
    for (let index = 0; index <= 10_000; index += 1) await touchLastSeen({ DB }, `user_${index}`, T0);
    await touchLastSeen({ DB }, "user_0", T0);
    expect(run).toHaveBeenCalledTimes(10_002);
  });
});
