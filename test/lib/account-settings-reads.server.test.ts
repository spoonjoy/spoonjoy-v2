// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import type { PrismaClient } from "@prisma/client";
import { Request as UndiciRequest } from "undici";
import { createApiCredential } from "~/lib/api-auth.server";
import { promoteLegacyOAuthIssuerForUser, promoteLegacyOAuthIssuerForUserOnD1 } from "~/lib/oauth-server.server";
import { getLocalDb } from "~/lib/db.server";
import { readAccountSettingsFromD1, readAccountSettingsWithPrisma } from "~/lib/account-settings-reads.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

let db: PrismaClient;
let d1: SqliteD1;

const ISSUER = "http://localhost:3000";

async function refreshToken(userId: string, clientId: string, data: Record<string, unknown> = {}) {
  return db.oAuthRefreshToken.create({
    data: {
      tokenHash: `refresh-${faker.string.alphanumeric(16)}`,
      userId,
      clientId,
      scope: "recipes:read",
      issuer: ISSUER,
      ...data,
    },
  });
}

async function seedAccount() {
  const user = await db.user.create({ data: { ...createTestUser(), photoUrl: "https://example.com/me.jpg" } });
  const other = await db.user.create({ data: createTestUser() });
  await db.oAuth.create({ data: { provider: "google", providerUserId: `g-${user.id}`, providerUsername: "me@gmail.com", userId: user.id } });
  await db.oAuth.create({ data: { provider: "github", providerUserId: `h-${user.id}`, providerUsername: "me", userId: user.id } });
  await db.userCredential.create({
    data: { id: `pk-a-${user.id}`, userId: user.id, publicKey: Buffer.from("a"), counter: 0, name: "Phone", transports: "internal", createdAt: new Date("2026-05-01T00:00:00Z") },
  });
  await db.userCredential.create({
    data: { id: `pk-b-${user.id}`, userId: user.id, publicKey: Buffer.from("b"), counter: 0, name: null, transports: null, createdAt: null },
  });
  await db.pushSubscription.create({ data: { userId: user.id, endpoint: `https://push.example/${user.id}`, p256dh: "k", authSecret: "s" } });
  await db.notificationPreference.create({ data: { userId: user.id, notifyForkOfMyRecipe: false } });

  const personal = await createApiCredential(db, user.id, "Kitchen CLI", { scopes: ["recipes:read"] });
  await db.apiCredential.update({
    where: { id: personal.credential.id },
    data: { lastUsedAt: new Date("2026-06-01T00:00:00Z"), expiresAt: new Date("2026-07-01T00:00:00Z") },
  });
  const revoked = await createApiCredential(db, user.id, "Old script");
  await db.apiCredential.update({ where: { id: revoked.credential.id }, data: { revokedAt: new Date() } });
  await createApiCredential(db, other.id, "Someone else's");

  const client = await db.oAuthClient.create({ data: { clientName: "Grocery helper", redirectUris: "[]", issuer: ISSUER } });
  const unnamed = await db.oAuthClient.create({ data: { clientName: null, redirectUris: "[]", issuer: ISSUER } });
  await refreshToken(user.id, client.id, { connectionKey: "conn-1", createdAt: new Date("2026-06-02T00:00:00Z") });
  await refreshToken(user.id, client.id, { connectionKey: "conn-2", scope: "cookbooks:read", createdAt: new Date("2026-06-01T00:00:00Z") });
  await refreshToken(user.id, unnamed.id, { resource: "https://example.com/mcp" });
  await refreshToken(user.id, client.id, { revokedAt: new Date() });
  await refreshToken(other.id, client.id);
  await createApiCredential(db, user.id, "Access 1", { oauthClientId: client.id, oauthIssuer: ISSUER, oauthConnectionKey: "conn-1" });
  await createApiCredential(db, user.id, "Access 2", { oauthClientId: client.id, oauthIssuer: ISSUER, oauthConnectionKey: "conn-1" });
  await createApiCredential(db, user.id, "Access 3", { oauthClientId: unnamed.id, oauthIssuer: ISSUER, oauthResource: "https://example.com/mcp" });

  return { user, other, client };
}

// Access counts come back in no particular order; the page keys them by connection.
function comparable(reads: Awaited<ReturnType<typeof readAccountSettingsWithPrisma>>) {
  return reads && {
    ...reads,
    oauthClients: [...reads.oauthClients].sort((a, b) => a.id.localeCompare(b.id)),
    accessCredentialCounts: [...reads.accessCredentialCounts].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

describe("account settings reads", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("returns what the Prisma reads return, in one D1 batch, scoped to the user", async () => {
    const { user, other } = await seedAccount();

    for (const userId of [user.id, other.id]) {
      const before = d1.roundTrips();
      const fromD1 = await readAccountSettingsFromD1(d1.binding, userId, ISSUER);
      expect(d1.roundTrips() - before).toBe(1);
      expect(comparable(fromD1)).toEqual(comparable(await readAccountSettingsWithPrisma(db, userId)));
    }

    const reads = (await readAccountSettingsFromD1(d1.binding, user.id, ISSUER))!;
    expect(reads.user).toMatchObject({ id: user.id, hasPassword: true, photoUrl: "https://example.com/me.jpg" });
    expect(reads.user?.OAuth).toHaveLength(2);
    expect(reads.passkeys.map((passkey) => passkey.createdAt)).toEqual([new Date("2026-05-01T00:00:00Z"), null]);
    expect(reads.pushSubscriptionCount).toBe(1);
    expect(reads.preferences).toMatchObject({ notifyForkOfMyRecipe: false, notifySpoonOnMyRecipe: true });
    expect(reads.apiCredentials.map((credential) => credential.name)).toEqual(["Kitchen CLI"]);
    expect(reads.activeRefreshTokens).toHaveLength(3);
    expect(reads.accessCredentialCounts.map((row) => row.count).sort()).toEqual([1, 2]);
  });

  it("leaves connections whose refresh token has expired off the list, on D1 and Prisma alike", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const lapsed = await db.oAuthClient.create({ data: { clientName: "Lapsed", redirectUris: "[]", issuer: ISSUER } });
    const live = await db.oAuthClient.create({ data: { clientName: "Live", redirectUris: "[]", issuer: ISSUER } });
    const legacy = await db.oAuthClient.create({ data: { clientName: "Pre-expiry", redirectUris: "[]", issuer: ISSUER } });
    await refreshToken(user.id, lapsed.id, { connectionKey: "lapsed", expiresAt: new Date("2026-10-01T00:00:00Z") });
    await refreshToken(user.id, live.id, { connectionKey: "live", expiresAt: new Date("2027-06-01T00:00:00Z") });
    await refreshToken(user.id, legacy.id, { connectionKey: "legacy", expiresAt: null });
    await createApiCredential(db, user.id, "Lapsed access", { oauthClientId: lapsed.id, oauthIssuer: ISSUER, oauthConnectionKey: "lapsed" });
    await createApiCredential(db, user.id, "Live access", { oauthClientId: live.id, oauthIssuer: ISSUER, oauthConnectionKey: "live" });

    const clientNames = (reads: Awaited<ReturnType<typeof readAccountSettingsWithPrisma>>) =>
      reads.oauthClients.map((client) => client.clientName).sort();
    for (const [now, expected] of [
      [new Date("2026-10-09T00:00:00Z"), ["Live", "Pre-expiry"]],
      // After the legacy cutover a token without an expiry has lapsed too.
      [new Date("2027-04-08T00:00:00Z"), ["Live"]],
    ] as const) {
      const fromD1 = await readAccountSettingsFromD1(d1.binding, user.id, ISSUER, now);
      const fromPrisma = await readAccountSettingsWithPrisma(db, user.id, now);
      expect(clientNames(fromD1)).toEqual(expected);
      expect(comparable(fromD1)).toEqual(comparable(fromPrisma));
      expect(fromD1.activeRefreshTokens).toHaveLength(expected.length);
      expect(fromD1.accessCredentialCounts.map((row) => row.oauthConnectionKey)).toEqual(["live"]);
    }
  });

  it("reads a user with no password, preferences or connections, and a missing user", async () => {
    const bare = await db.user.create({ data: { ...createTestUser(), hashedPassword: null, salt: null } });
    for (const userId of [bare.id, "missing-user"]) {
      const fromD1 = await readAccountSettingsFromD1(d1.binding, userId, ISSUER);
      expect(fromD1).toEqual(await readAccountSettingsWithPrisma(db, userId));
    }
    await expect(readAccountSettingsFromD1(d1.binding, bare.id, ISSUER)).resolves.toMatchObject({
      user: { hasPassword: false, OAuth: [] },
      preferences: null,
      pushSubscriptionCount: 0,
    });
  });

  it("promotes the user's legacy OAuth rows in the same batch, then reads them, as Prisma does", async () => {
    const { user, client } = await seedAccount();
    const legacy = await db.oAuthClient.create({ data: { clientName: "Legacy", redirectUris: "[]" } });
    await refreshToken(user.id, legacy.id, { issuer: null });
    await createApiCredential(db, user.id, "Legacy access", { oauthClientId: client.id, oauthIssuer: null });

    const before = d1.roundTrips();
    const fromD1 = await readAccountSettingsFromD1(d1.binding, user.id, ISSUER);
    expect(d1.roundTrips() - before).toBe(1);
    expect(fromD1.activeRefreshTokens.find((token) => token.clientId === legacy.id)?.issuer).toBe(ISSUER);
    await expect(db.oAuthClient.findUniqueOrThrow({ where: { id: legacy.id } })).resolves.toMatchObject({ issuer: ISSUER });
    await expect(db.apiCredential.count({ where: { userId: user.id, oauthIssuer: null, oauthClientId: { not: null } } }))
      .resolves.toBe(0);
    // Nothing is left to promote, so the Prisma reads see the same rows.
    expect(comparable(fromD1)).toEqual(comparable(await readAccountSettingsWithPrisma(db, user.id)));
  });

  it("leaves legacy rows the promotion cannot change as they are, as Prisma does", async () => {
    const { user } = await seedAccount();
    // A client already bound to another issuer, and a token whose client no longer exists.
    const foreign = await db.oAuthClient.create({ data: { clientName: "Elsewhere", redirectUris: "[]", issuer: "https://other.example" } });
    await refreshToken(user.id, foreign.id, { issuer: null });
    await createApiCredential(db, user.id, "Foreign access", { oauthClientId: foreign.id, oauthIssuer: null });
    await refreshToken(user.id, "missing-client", { issuer: null });

    const fromD1 = await readAccountSettingsFromD1(d1.binding, user.id, ISSUER);
    expect(fromD1.activeRefreshTokens.filter((token) => token.issuer === null)).toHaveLength(2);
    await expect(db.oAuthClient.findUniqueOrThrow({ where: { id: foreign.id } })).resolves.toMatchObject({ issuer: "https://other.example" });
    await promoteLegacyOAuthIssuerForUser(db, user.id, ISSUER);
    expect(comparable(fromD1)).toEqual(comparable(await readAccountSettingsWithPrisma(db, user.id)));
  });

  it("fails closed on a D1 error or a malformed row", async () => {
    const { user } = await seedAccount();
    const failing = { prepare: d1.binding.prepare, batch: async () => { throw new Error("D1_ERROR: lost"); } };
    await expect(readAccountSettingsFromD1(failing as never, user.id, ISSUER)).rejects.toThrow("D1_ERROR: lost");

    const tampered = (edit: (results: Array<{ results: Record<string, unknown>[] }>) => void) => ({
      prepare: d1.binding.prepare,
      batch: async (statements: Parameters<typeof d1.binding.batch>[0]) => {
        const results = (await d1.binding.batch(statements)) as Array<{ results: Record<string, unknown>[] }>;
        edit(results);
        return results;
      },
    });
    await expect(readAccountSettingsFromD1(tampered((r) => { r[6]!.results = []; }) as never, user.id, ISSUER))
      .rejects.toThrow("D1 column count is not a count");
    await expect(readAccountSettingsFromD1(tampered((r) => { r[3]!.results[0]!.hasPassword = "yes"; }) as never, user.id, ISSUER))
      .rejects.toThrow("D1 column hasPassword is not a Boolean");
  });
});

describe("account settings loader on a D1 binding", () => {
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

  it("builds the page from D1 in two round trips and matches the Prisma page", async () => {
    const { user } = await seedAccount();
    const { loadAccountSettings: loadWithPrisma } = await import("~/lib/account-settings.server");
    const cookie = (await createUserSessionCookie(user.id)).split(";")[0]!;
    const request = () => new UndiciRequest("http://localhost:3000/account/settings?oauthError=denied", { headers: { Cookie: cookie } });

    vi.resetModules();
    const actual = await vi.importActual<typeof import("~/lib/route-platform.server")>("~/lib/route-platform.server");
    const getRequestDb = vi.fn(async () => getLocalDb());
    vi.doMock("~/lib/route-platform.server", () => ({ ...actual, getRequestDb }));
    const { loadAccountSettings } = await import("~/lib/account-settings.server");

    const before = d1.roundTrips();
    const fromD1 = await loadAccountSettings({ request: request(), context: { cloudflare: { env: { DB: d1.binding } } } } as never);
    expect(d1.roundTrips() - before).toBe(2);
    expect(getRequestDb).not.toHaveBeenCalled();
    const fromPrisma = await loadWithPrisma({ request: request(), context: { cloudflare: { env: null } } } as never);
    expect(fromD1).toEqual(fromPrisma);
    expect(fromD1.user.oauthConnections).toHaveLength(2);

    // A user with legacy OAuth rows is promoted in the same D1 batch, never through Prisma.
    const legacy = await db.oAuthClient.create({ data: { clientName: "Legacy", redirectUris: "[]" } });
    await refreshToken(user.id, legacy.id, { issuer: null });
    const beforePromotion = d1.roundTrips();
    const promoted = await loadAccountSettings({ request: request(), context: { cloudflare: { env: { DB: d1.binding } } } } as never);
    expect(d1.roundTrips() - beforePromotion).toBe(2);
    expect(getRequestDb).not.toHaveBeenCalled();
    expect(promoted.user.oauthConnections?.some((connection) => connection.clientId === legacy.id)).toBe(true);
  });
});

describe("legacy OAuth issuer promotion on D1", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  // Fixed ids, so the D1 and Prisma promotions can run on identical data.
  async function seedLegacy() {
    const user = await db.user.create({ data: { ...createTestUser(), id: "promo-user" } });
    const other = await db.user.create({ data: { ...createTestUser(), id: "promo-other" } });
    await db.oAuthClient.create({ data: { id: "promo-unbound", clientName: "Unbound", redirectUris: "[]" } });
    await db.oAuthClient.create({ data: { id: "promo-bound", clientName: "Bound", redirectUris: "[]", issuer: ISSUER } });
    await db.oAuthClient.create({ data: { id: "promo-foreign", clientName: "Foreign", redirectUris: "[]", issuer: "https://other.example" } });
    for (const [id, userId, clientId, issuer] of [
      ["t1", user.id, "promo-unbound", null],
      ["t2", user.id, "promo-bound", null],
      ["t3", user.id, "promo-foreign", null],
      ["t4", user.id, "promo-missing", null],
      ["t5", other.id, "promo-unbound", null],
      ["t6", user.id, "promo-bound", ISSUER],
    ] as const) {
      await db.oAuthRefreshToken.create({ data: { id, tokenHash: `hash-${id}`, userId, clientId, issuer, scope: "recipes:read" } });
    }
    for (const [id, userId, oauthClientId] of [
      ["c1", user.id, "promo-unbound"],
      ["c2", user.id, "promo-foreign"],
      ["c3", user.id, null],
      ["c4", other.id, "promo-bound"],
    ] as const) {
      await db.apiCredential.create({
        data: { id, userId, name: id, tokenHash: `hash-${id}`, tokenPrefix: id, oauthClientId, updatedAt: new Date("2026-01-01T00:00:00Z") },
      });
    }
    return user;
  }

  async function snapshot() {
    return {
      clients: await db.oAuthClient.findMany({ orderBy: { id: "asc" }, select: { id: true, issuer: true } }),
      tokens: await db.oAuthRefreshToken.findMany({ orderBy: { id: "asc" }, select: { id: true, issuer: true } }),
      credentials: await db.apiCredential.findMany({ orderBy: { id: "asc" }, select: { id: true, oauthIssuer: true, updatedAt: true } }),
    };
  }

  it("changes exactly the rows the Prisma promotion changes, in one atomic batch", async () => {
    const user = await seedLegacy();
    const now = new Date("2026-09-27T12:00:00.000Z");
    const before = d1.roundTrips();
    await promoteLegacyOAuthIssuerForUserOnD1(d1.binding, user.id, ISSUER, now);
    expect(d1.roundTrips() - before).toBe(1);
    const viaD1 = await snapshot();

    await cleanupDatabase();
    await seedLegacy();
    await promoteLegacyOAuthIssuerForUser(db, user.id, ISSUER);
    const viaPrisma = await snapshot();

    const withoutUpdatedAt = (state: typeof viaD1) => ({
      ...state,
      credentials: state.credentials.map(({ updatedAt: _updatedAt, ...credential }) => credential),
    });
    expect(withoutUpdatedAt(viaD1)).toEqual(withoutUpdatedAt(viaPrisma));
    expect(viaD1.clients).toEqual([
      { id: "promo-bound", issuer: ISSUER },
      { id: "promo-foreign", issuer: "https://other.example" },
      { id: "promo-unbound", issuer: ISSUER },
    ]);
    expect(viaD1.tokens.map((token) => [token.id, token.issuer])).toEqual([
      ["t1", ISSUER], ["t2", ISSUER], ["t3", null], ["t4", null], ["t5", null], ["t6", ISSUER],
    ]);
    // Only the promoted access credential gets a new updatedAt, as updateMany sets it.
    expect(viaD1.credentials.map((credential) => [credential.id, credential.oauthIssuer, credential.updatedAt.toISOString()])).toEqual([
      ["c1", ISSUER, now.toISOString()],
      ["c2", null, "2026-01-01T00:00:00.000Z"],
      ["c3", null, "2026-01-01T00:00:00.000Z"],
      ["c4", null, "2026-01-01T00:00:00.000Z"],
    ]);
  });

  it("fails closed when D1 rejects the batch", async () => {
    const failing = { prepare: d1.binding.prepare, batch: async () => { throw new Error("D1_ERROR: lost"); } };
    await expect(promoteLegacyOAuthIssuerForUserOnD1(failing as never, "u", ISSUER)).rejects.toThrow("D1_ERROR: lost");
  });
});
