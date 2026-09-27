// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import type { PrismaClient } from "@prisma/client";
import { Request as UndiciRequest } from "undici";
import { createApiCredential } from "~/lib/api-auth.server";
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
function comparable(reads: Awaited<ReturnType<typeof readAccountSettingsWithPrisma>> | null) {
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
      const fromD1 = await readAccountSettingsFromD1(d1.binding, userId);
      expect(d1.roundTrips() - before).toBe(1);
      expect(comparable(fromD1)).toEqual(comparable(await readAccountSettingsWithPrisma(db, userId, ISSUER)));
    }

    const reads = (await readAccountSettingsFromD1(d1.binding, user.id))!;
    expect(reads.user).toMatchObject({ id: user.id, hasPassword: true, photoUrl: "https://example.com/me.jpg" });
    expect(reads.user?.OAuth).toHaveLength(2);
    expect(reads.passkeys.map((passkey) => passkey.createdAt)).toEqual([new Date("2026-05-01T00:00:00Z"), null]);
    expect(reads.pushSubscriptionCount).toBe(1);
    expect(reads.preferences).toMatchObject({ notifyForkOfMyRecipe: false, notifySpoonOnMyRecipe: true });
    expect(reads.apiCredentials.map((credential) => credential.name)).toEqual(["Kitchen CLI"]);
    expect(reads.activeRefreshTokens).toHaveLength(3);
    expect(reads.accessCredentialCounts.map((row) => row.count).sort()).toEqual([1, 2]);
  });

  it("reads a user with no password, preferences or connections, and a missing user", async () => {
    const bare = await db.user.create({ data: { ...createTestUser(), hashedPassword: null, salt: null } });
    for (const userId of [bare.id, "missing-user"]) {
      const fromD1 = await readAccountSettingsFromD1(d1.binding, userId);
      expect(fromD1).toEqual(await readAccountSettingsWithPrisma(db, userId, ISSUER));
    }
    await expect(readAccountSettingsFromD1(d1.binding, bare.id)).resolves.toMatchObject({
      user: { hasPassword: false, OAuth: [] },
      preferences: null,
      pushSubscriptionCount: 0,
    });
  });

  it("defers to the Prisma reader while legacy OAuth rows still need their issuer", async () => {
    const { user, client } = await seedAccount();
    const legacy = await db.oAuthClient.create({ data: { clientName: "Legacy", redirectUris: "[]" } });
    await refreshToken(user.id, legacy.id, { issuer: null });
    await expect(readAccountSettingsFromD1(d1.binding, user.id)).resolves.toBeNull();

    await readAccountSettingsWithPrisma(db, user.id, ISSUER);
    await expect(readAccountSettingsFromD1(d1.binding, user.id)).resolves.not.toBeNull();

    await createApiCredential(db, user.id, "Legacy access", { oauthClientId: client.id, oauthIssuer: null });
    await expect(readAccountSettingsFromD1(d1.binding, user.id)).resolves.toBeNull();
  });

  it("fails closed on a D1 error or a malformed row", async () => {
    const { user } = await seedAccount();
    const failing = { prepare: d1.binding.prepare, batch: async () => { throw new Error("D1_ERROR: lost"); } };
    await expect(readAccountSettingsFromD1(failing as never, user.id)).rejects.toThrow("D1_ERROR: lost");

    const tampered = (edit: (results: Array<{ results: Record<string, unknown>[] }>) => void) => ({
      prepare: d1.binding.prepare,
      batch: async (statements: Parameters<typeof d1.binding.batch>[0]) => {
        const results = (await d1.binding.batch(statements)) as Array<{ results: Record<string, unknown>[] }>;
        edit(results);
        return results;
      },
    });
    await expect(readAccountSettingsFromD1(tampered((r) => { r[0]!.results = []; }) as never, user.id))
      .rejects.toThrow("D1 column needsIssuerPromotion is not a Boolean");
    await expect(readAccountSettingsFromD1(tampered((r) => { r[4]!.results = []; }) as never, user.id))
      .rejects.toThrow("D1 column count is not a count");
    await expect(readAccountSettingsFromD1(tampered((r) => { r[1]!.results[0]!.hasPassword = "yes"; }) as never, user.id))
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
    // The legacy fallback reads through Prisma on the unit-test database.
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

    // A user with legacy OAuth rows is promoted through Prisma, as before.
    const legacy = await db.oAuthClient.create({ data: { clientName: "Legacy", redirectUris: "[]" } });
    await refreshToken(user.id, legacy.id, { issuer: null });
    const promoted = await loadAccountSettings({ request: request(), context: { cloudflare: { env: { DB: d1.binding } } } } as never);
    expect(getRequestDb).toHaveBeenCalledTimes(1);
    expect(promoted.user.oauthConnections?.some((connection) => connection.clientId === legacy.id)).toBe(true);
  });
});
