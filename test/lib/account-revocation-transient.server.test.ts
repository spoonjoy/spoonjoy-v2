// @vitest-environment node
// Signing out everywhere and changing a password when D1's connection drops: each moves the
// session version on exactly once, however many tries it takes, and gives up with a retryable
// error rather than a 500 when D1 stays unreachable.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { createApiCredential } from "~/lib/api-auth.server";
import { changePasswordKeepingConnections, revokeAllAccountAccess } from "~/lib/account-revocation.server";
import { D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { flakyD1, NETWORK_LOST_MESSAGE } from "../helpers/flaky-d1";

const REVOKE = /UPDATE "User" SET "sessionVersion"/;

describe("account revocation when D1's connection drops", () => {
  let db: PrismaClient;
  let d1: SqliteD1;
  let userId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    d1 = sqliteD1();
    userId = (await createUser(db, faker.internet.email(), `chef_${faker.string.alphanumeric(8)}`, "testPassword123")).id;
    await createApiCredential(db, userId, "Laptop script");
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  const state = async () => ({
    user: await db.user.findUniqueOrThrow({ where: { id: userId }, select: { sessionVersion: true, hashedPassword: true, salt: true } }),
    liveCredentials: await db.apiCredential.count({ where: { userId, revokedAt: null } }),
  });

  it("revokes and moves the session version on once when the batch committed but its answer was lost", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(REVOKE, "lost-answer");

    const result = await revokeAllAccountAccess(db, userId, { d1: flaky.binding, password: { hashedPassword: "new-hash", salt: "new-salt" } });

    expect(flaky.failures()).toBe(1);
    // The committed try is not run again, so its counts are not known.
    expect(result).toEqual({
      sessionVersion: 1,
      apiCredentials: 0,
      refreshTokens: 0,
      oauthGrants: 0,
      pendingAgentConnections: 0,
      authorizationCodes: 0,
      consentTransactions: 0,
    });
    expect(await state()).toEqual({ user: { sessionVersion: 1, hashedPassword: "new-hash", salt: "new-salt" }, liveCredentials: 0 });
  });

  it("runs the batch again when it never reached the database, ending as one run would", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(REVOKE, "lost", "lost");

    const result = await revokeAllAccountAccess(db, userId, { d1: flaky.binding });

    expect(flaky.failures()).toBe(2);
    expect(result).toMatchObject({ sessionVersion: 1, apiCredentials: 1 });
    expect(await state()).toMatchObject({ user: { sessionVersion: 1 }, liveCredentials: 0 });
  });

  it("leaves the same rows when its sweep runs twice, apart from the version each run moves on", async () => {
    await revokeAllAccountAccess(db, userId, { d1: d1.binding });
    const once = await state();
    const again = await revokeAllAccountAccess(db, userId, { d1: d1.binding });

    expect(again).toMatchObject({ sessionVersion: 2, apiCredentials: 0 });
    expect(await state()).toEqual({ ...once, user: { ...once.user, sessionVersion: 2 } });
  });

  it("gives up with a retryable error, changing nothing, when every try fails", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(REVOKE, "lost", "lost", "lost", "lost");

    await expect(revokeAllAccountAccess(db, userId, { d1: flaky.binding })).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await state()).toMatchObject({ user: { sessionVersion: 0 }, liveCredentials: 1 });
  });

  it("moves on from the version another change set between its read and its batch", async () => {
    let raced = false;
    const racing: D1ReadDatabase = {
      prepare: (sql) => d1.binding.prepare(sql),
      async batch(statements) {
        if (!raced && statements.length > 1) {
          raced = true;
          await db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
        }
        return d1.binding.batch(statements as never);
      },
    };

    await expect(revokeAllAccountAccess(db, userId, { d1: racing })).resolves.toMatchObject({ sessionVersion: 2, apiCredentials: 1 });
    expect((await state()).user.sessionVersion).toBe(2);
  });

  it("gives up after losing three races in a row", async () => {
    const alwaysRacing: D1ReadDatabase = {
      prepare: (sql) => d1.binding.prepare(sql),
      async batch(statements) {
        if (statements.length > 1) await db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
        return d1.binding.batch(statements as never);
      },
    };

    await expect(revokeAllAccountAccess(db, userId, { d1: alwaysRacing })).rejects.toThrow();
    expect(await state()).toMatchObject({ user: { sessionVersion: 3 }, liveCredentials: 1 });
  });
});

describe("changePasswordKeepingConnections", () => {
  let db: PrismaClient;
  let userId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    userId = (await createUser(db, faker.internet.email(), `chef_${faker.string.alphanumeric(8)}`, "testPassword123")).id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  const PASSWORD = { hashedPassword: "new-hash", salt: "new-salt" };
  const user = () => db.user.findUniqueOrThrow({ where: { id: userId }, select: { sessionVersion: true, hashedPassword: true, salt: true } });

  /** The client, with `updateMany` on users replaced. */
  function withUserUpdate(updateMany: (args: Parameters<PrismaClient["user"]["updateMany"]>[0]) => Promise<{ count: number }>) {
    return new Proxy(db, {
      get: (target, prop) => prop === "user"
        ? new Proxy(target.user, { get: (users, method) => method === "updateMany" ? updateMany : Reflect.get(users, method) })
        : Reflect.get(target, prop),
    }) as PrismaClient;
  }

  it("sets the password and moves the session version on, keeping the API credentials", async () => {
    await createApiCredential(db, userId, "Laptop script");
    await expect(changePasswordKeepingConnections(db, userId, PASSWORD)).resolves.toBe(1);
    expect(await user()).toEqual({ sessionVersion: 1, ...PASSWORD });
    expect(await db.apiCredential.count({ where: { userId, revokedAt: null } })).toBe(1);
  });

  it("moves the version on once when the write committed but its answer was lost", async () => {
    let tries = 0;
    const flaky = withUserUpdate(async (args) => {
      tries += 1;
      const result = await db.user.updateMany(args);
      if (tries === 1) throw new Error(NETWORK_LOST_MESSAGE);
      return result;
    });

    await expect(changePasswordKeepingConnections(flaky, userId, PASSWORD)).resolves.toBe(1);
    expect(tries).toBe(1);
    expect(await user()).toEqual({ sessionVersion: 1, ...PASSWORD });
  });

  it("answers an earlier try that committed before a retry found nothing to update", async () => {
    let tries = 0;
    const flaky = withUserUpdate(async (args) => {
      tries += 1;
      if (tries === 1) throw new Error(NETWORK_LOST_MESSAGE);
      if (tries === 2) {
        // The first try lands late, just before the retry.
        await db.user.updateMany(args);
      }
      return db.user.updateMany(args);
    });

    await expect(changePasswordKeepingConnections(flaky, userId, PASSWORD)).resolves.toBe(1);
    expect(await user()).toEqual({ sessionVersion: 1, ...PASSWORD });
  });

  it("starts again from the version another change set in between, and gives up after three such races", async () => {
    let races = 0;
    const racing = (limit: number) => withUserUpdate(async (args) => {
      if (races < limit) {
        races += 1;
        await db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
      }
      return db.user.updateMany(args);
    });

    await expect(changePasswordKeepingConnections(racing(1), userId, PASSWORD)).resolves.toBe(2);
    expect(await user()).toEqual({ sessionVersion: 2, ...PASSWORD });

    races = 0;
    await expect(changePasswordKeepingConnections(racing(3), userId, { hashedPassword: "other", salt: "other" }))
      .rejects.toThrow("Password change lost a race with another account change");
    expect(await user()).toEqual({ sessionVersion: 5, ...PASSWORD });
  });

  it("refuses a missing account", async () => {
    await expect(changePasswordKeepingConnections(db, "no-such-user", PASSWORD)).rejects.toThrow("Password change found no user to update");
  });
});
