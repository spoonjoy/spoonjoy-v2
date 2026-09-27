// @vitest-environment node
// Node environment: happy-dom's Response drops Set-Cookie, and this test reads the cookie back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import bcrypt from "bcryptjs";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { getSessionIdentity, getUserId } from "~/lib/session.server";
import { action } from "~/routes/login";
import { cleanupDatabase } from "../helpers/cleanup";

describe("Login action session version", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("mints the session at the version read with the password hash, not one bumped during the compare", async () => {
    const db = await getLocalDb();
    const password = "testPassword123";
    const created = await createUser(
      db,
      faker.internet.email(),
      `${faker.internet.username()}_${faker.string.alphanumeric(8)}`,
      password,
    );
    const realCompare = bcrypt.compareSync;
    // A password change (or "Sign out everywhere") lands while this login is still comparing the old password.
    vi.spyOn(bcrypt, "compareSync").mockImplementation((candidate, hash) => {
      const matches = realCompare(candidate, hash);
      // Prisma queries are lazy; .then() sends this one now, ahead of anything the login queries next.
      void db.$executeRawUnsafe(`UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1 WHERE "id" = ?`, created.id)
        .then(() => undefined);
      return matches;
    });

    const response = await action({
      request: new UndiciRequest("http://localhost:3000/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ identifier: created.username, password }).toString(),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any) as Response;

    expect(response.status).toBe(302);
    const bumped = await db.user.findUniqueOrThrow({ where: { id: created.id }, select: { sessionVersion: true } });
    expect(bumped.sessionVersion).toBe(1);
    const signedIn = new UndiciRequest("http://localhost:3000/recipes", {
      headers: { Cookie: (response.headers.get("Set-Cookie") ?? "").split(";")[0] },
    }) as unknown as Request;
    await expect(getSessionIdentity(signedIn)).resolves.toEqual({ userId: created.id, sessionVersion: 0 });
    await expect(getUserId(signedIn)).resolves.toBeNull();
  });
});
