// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Request as UndiciRequest } from "undici";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// The account-settings action and the API's connection list promote legacy OAuth rows on
// every call. With a D1 binding they must do it as the atomic D1 batch, not through
// Prisma, whose D1 adapter runs the steps as separate queries.

let db: PrismaClient;
let d1: SqliteD1;

const PROMOTION_SQL = /^UPDATE "OAuthClient" SET "issuer" = \?/;

async function seedLegacyUser() {
  const user = await db.user.create({ data: createTestUser() });
  const client = await db.oAuthClient.create({ data: { clientName: "Legacy", redirectUris: "[]" } });
  await db.oAuthRefreshToken.create({
    data: { tokenHash: `legacy-${user.id}`, userId: user.id, clientId: client.id, scope: "recipes:read", issuer: null },
  });
  return { user, client };
}

async function withD1Routes<T>(run: () => Promise<T>) {
  vi.resetModules();
  const actual = await vi.importActual<typeof import("~/lib/route-platform.server")>("~/lib/route-platform.server");
  // Everything but the promotion still runs through Prisma on the unit-test database.
  vi.doMock("~/lib/route-platform.server", () => ({ ...actual, getRequestDb: vi.fn(async () => getLocalDb()) }));
  return run();
}

describe("legacy OAuth promotion on a D1 binding", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    vi.doUnmock("~/lib/route-platform.server");
    vi.resetModules();
    await cleanupDatabase();
  });

  it("promotes through the D1 batch on an account-settings action", async () => {
    const { user, client } = await seedLegacyUser();
    const cookie = (await createUserSessionCookie(user.id)).split(";")[0]!;

    await withD1Routes(async () => {
      const { action } = await import("~/routes/account.settings");
      const body = new URLSearchParams({ intent: "updateUserInfo", email: user.email, username: user.username });
      await action({
        request: new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        }) as never,
        context: { cloudflare: { env: { DB: d1.binding } } },
        params: {},
      } as never);
    });

    expect(d1.statements.some((statement) => PROMOTION_SQL.test(statement.sql))).toBe(true);
    await expect(db.oAuthClient.findUniqueOrThrow({ where: { id: client.id } })).resolves.toMatchObject({
      issuer: "http://localhost:3000",
    });
    await expect(db.oAuthRefreshToken.count({ where: { userId: user.id, issuer: null } })).resolves.toBe(0);
  });

  it("promotes through the D1 batch when the API lists OAuth connections", async () => {
    const { user, client } = await seedLegacyUser();
    const token = await createApiCredential(db, user.id, "Native token admin", { scopes: ["tokens:read", "tokens:write"] });

    const response = await withD1Routes(async () => {
      const { loader } = await import("~/routes/api.v1.$");
      return loader({
        request: new UndiciRequest("http://localhost/api/v1/me/connections", {
          headers: { Authorization: `Bearer ${token.token}`, "X-Request-Id": "req_d1_promotion" },
        }) as never,
        params: { "*": "me/connections" },
        context: { cloudflare: { env: { DB: d1.binding } } },
      } as never);
    });

    expect((response as Response).status).toBe(200);
    expect(d1.statements.some((statement) => PROMOTION_SQL.test(statement.sql))).toBe(true);
    await expect(db.oAuthClient.findUniqueOrThrow({ where: { id: client.id } })).resolves.toMatchObject({
      issuer: "http://localhost",
    });
    const payload = await (response as Response).json() as { data: { connections: Array<{ clientId: string }> } };
    expect(payload.data.connections.map((connection) => connection.clientId)).toEqual([client.id]);
  });
});
