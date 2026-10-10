// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { faker } from "@faker-js/faker";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import {
  authenticateUserByEmailOrUsername,
  authenticateUserByEmailOrUsernameOnD1,
  createUser,
} from "~/lib/auth.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";

let db: PrismaClient;
let d1: SqliteD1;

describe("password login on a D1 binding", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    vi.restoreAllMocks();
    vi.doUnmock("~/lib/route-platform.server");
    vi.resetModules();
    await cleanupDatabase();
  });

  it("answers every identifier the way the Prisma lookup does, in one statement", async () => {
    const username = `Chef_${faker.string.alphanumeric(8)}`;
    const created = await createUser(db, "NativeChef@Example.com", username, "testPassword123");
    await db.user.update({ where: { id: created.id }, data: { sessionVersion: 3 } });
    const passwordless = await db.user.create({ data: { email: "oauth-only@example.com", username: `oauth_${faker.string.alphanumeric(6)}` } });

    const attempts: Array<[string, string]> = [
      [username, "testPassword123"],
      [`  ${username}  `, "testPassword123"],
      ["NATIVECHEF@EXAMPLE.COM", "testPassword123"],
      [username, "wrongPassword"],
      [username.toLowerCase(), "testPassword123"],
      ["nobody@example.com", "testPassword123"],
      ["nobody", "testPassword123"],
      [passwordless.email, "anything"],
    ];
    for (const [identifier, password] of attempts) {
      const before = d1.roundTrips();
      const onD1 = await authenticateUserByEmailOrUsernameOnD1(d1.binding, identifier, password);
      expect(d1.roundTrips() - before).toBe(1);
      expect(onD1).toEqual(await authenticateUserByEmailOrUsername(db, identifier, password));
    }

    await expect(authenticateUserByEmailOrUsernameOnD1(d1.binding, username, "testPassword123")).resolves.toEqual({
      id: created.id,
      email: "nativechef@example.com",
      username,
      sessionVersion: 3,
    });
    // Usernames match exactly, as the unique index does.
    await expect(authenticateUserByEmailOrUsernameOnD1(d1.binding, username.toLowerCase(), "testPassword123")).resolves.toBeNull();
  });

  it("still pays for a bcrypt comparison when the account does not exist", async () => {
    const compare = vi.spyOn(bcrypt, "compareSync");

    await expect(authenticateUserByEmailOrUsernameOnD1(d1.binding, "ghost@example.com", "testPassword123")).resolves.toBeNull();
    await expect(authenticateUserByEmailOrUsernameOnD1(d1.binding, "ghost", "testPassword123")).resolves.toBeNull();

    expect(compare).toHaveBeenCalledTimes(2);
  });

  it("fails closed on a user row missing a login field", async () => {
    const username = `chef_${faker.string.alphanumeric(8)}`;
    await createUser(db, faker.internet.email(), username, "testPassword123");
    for (const [field, value] of [["id", null], ["email", null], ["username", 7], ["hashedPassword", 7], ["sessionVersion", "2"]] as const) {
      const corrupt = {
        prepare: d1.binding.prepare.bind(d1.binding),
        batch: async (statements: never) => (await d1.binding.batch(statements)).map((result) => ({
          ...result,
          results: (result.results as Array<Record<string, unknown>>).map((row) => ({ ...row, [field]: value })),
        })),
      };

      await expect(authenticateUserByEmailOrUsernameOnD1(corrupt as never, username, "testPassword123"))
        .rejects.toThrow("D1 user row is missing a login field");
    }
  });

  it("logs in through the route without building a Prisma client", async () => {
    const username = `chef_${faker.string.alphanumeric(8)}`;
    await createUser(db, faker.internet.email(), username, "testPassword123");
    vi.resetModules();
    const getRequestDb = vi.fn();
    vi.doMock("~/lib/route-platform.server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
      getRequestDb,
    }));
    const { action } = await import("~/routes/login");
    const login = async (password: string) => {
      const form = new UndiciFormData();
      form.append("identifier", username);
      form.append("password", password);
      return action({
        request: new UndiciRequest("http://localhost:3000/login?redirectTo=/cookbooks", { method: "POST", body: form }),
        context: { cloudflare: { env: { DB: d1.binding } } },
        params: {},
      } as never);
    };

    const response = await login("testPassword123");
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(302);
    expect((response as Response).headers.get("Location")).toBe("/cookbooks");
    expect((response as Response).headers.get("Set-Cookie")).toContain("__session=");

    const refused = await login("wrongPassword");
    expect(refused).toMatchObject({ init: { status: 401 }, data: { errors: { general: "Invalid username, email, or password" } } });
    expect(getRequestDb).not.toHaveBeenCalled();
  });
});
