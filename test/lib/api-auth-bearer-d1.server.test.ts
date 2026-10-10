// @vitest-environment node
// Bearer tokens on a D1 binding: authenticateApiRequest reads the credential, its user, its
// OAuth grant and its client in one D1 statement and records usage with one D1 write, so a
// bearer request builds no Prisma client. Only binding a legacy OAuth issuer still uses Prisma.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { getLocalDb } from "~/lib/db.server";
import {
  authenticateApiRequest,
  authenticateApiToken,
  createApiCredential,
  LAST_USED_AT_WRITE_INTERVAL_MS,
} from "~/lib/api-auth.server";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { expectConsoleWarning } from "../warning-policy";

const ISSUER = "https://spoonjoy.app";

describe("bearer tokens on a D1 binding", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  let d1: SqliteD1;
  let getPrisma: ReturnType<typeof vi.fn<() => Promise<typeof db>>>;
  let userId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    d1 = sqliteD1();
    getPrisma = vi.fn(async () => db);
    userId = (await db.user.create({
      data: { email: `bearer-${faker.string.alphanumeric(8).toLowerCase()}@example.com`, username: faker.internet.username() },
    })).id;
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  function bearer(
    token: string,
    options: { issuer?: string; binding?: D1ReadDatabase; waitUntil?: (promise: Promise<unknown>) => void } = {},
  ) {
    return authenticateApiRequest(
      getPrisma,
      new UndiciRequest(`${ISSUER}/api`, { headers: { Authorization: `Bearer ${token}` } }) as unknown as Request,
      options.issuer ? { SPOONJOY_BASE_URL: options.issuer } : null,
      { d1: options.binding ?? d1.binding, waitUntil: options.waitUntil },
    );
  }

  const credential = (id: string) => db.apiCredential.findUniqueOrThrow({ where: { id } });

  async function oauthToken(clientIssuer: string | null, credentialIssuer: string | null, link: object = {}) {
    const client = await db.oAuthClient.create({
      data: { clientName: "Example App", redirectUris: "https://example.com/cb", issuer: clientIssuer },
    });
    const created = await createApiCredential(db, userId, "OAuth token", {
      oauthClientId: client.id,
      oauthIssuer: credentialIssuer,
      scopes: ["kitchen:read"],
    });
    await db.apiCredential.update({ where: { id: created.credential.id }, data: link });
    return { client, ...created };
  }

  it("answers as the Prisma path does, in one read and one usage write, without Prisma", async () => {
    const created = await createApiCredential(db, userId, "Script", { scopes: ["kitchen:read"] });
    const before = d1.roundTrips();
    const principal = await bearer(created.token);
    expect(d1.roundTrips() - before).toBe(2);
    const touched = await credential(created.credential.id);
    expect(touched.lastUsedAt).toBeInstanceOf(Date);
    expect(touched.updatedAt.getTime()).toBe(touched.lastUsedAt!.getTime());

    // Within five minutes the usage is not written again.
    const again = d1.roundTrips();
    await expect(bearer(created.token)).resolves.toEqual(principal);
    expect(d1.roundTrips() - again).toBe(1);
    expect(getPrisma).not.toHaveBeenCalled();

    expect(principal).toEqual(await authenticateApiToken(db, created.token, ISSUER));
    expect(principal).toMatchObject({ source: "bearer", id: userId, credentialId: created.credential.id, scopes: expect.arrayContaining(["kitchen:read"]) });

    // Once the interval has passed, the usage is written again.
    await db.apiCredential.update({
      where: { id: created.credential.id },
      data: { lastUsedAt: new Date(Date.now() - LAST_USED_AT_WRITE_INTERVAL_MS) },
    });
    await bearer(created.token);
    expect((await credential(created.credential.id)).lastUsedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("refuses an unknown, revoked or expired token, and issuer metadata without a client", async () => {
    const revoked = await createApiCredential(db, userId, "Revoked");
    await db.apiCredential.update({ where: { id: revoked.credential.id }, data: { revokedAt: new Date() } });
    const expired = await createApiCredential(db, userId, "Expired");
    await db.apiCredential.update({ where: { id: expired.credential.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const stray = await createApiCredential(db, userId, "Stray issuer");
    await db.apiCredential.update({ where: { id: stray.credential.id }, data: { oauthIssuer: ISSUER } });

    for (const token of ["sj_unknown", revoked.token, expired.token, stray.token]) {
      await expect(bearer(token)).rejects.toMatchObject({ status: 401 });
    }
    expect((await credential(revoked.credential.id)).lastUsedAt).toBeNull();
    expect(getPrisma).not.toHaveBeenCalled();
  });

  it("checks an OAuth token's client, issuer and grant", async () => {
    const bound = await oauthToken(ISSUER, ISSUER);
    await expect(bearer(bound.token)).resolves.toMatchObject({ oauthClientId: bound.client.id, oauthIssuer: ISSUER });
    await expect(bearer(bound.token, { issuer: "https://other.example" })).rejects.toMatchObject({ status: 401 });

    const clientElsewhere = await oauthToken("https://other.example", ISSUER);
    await expect(bearer(clientElsewhere.token)).rejects.toMatchObject({ status: 401 });

    await db.oAuthClient.update({ where: { id: bound.client.id }, data: { revokedAt: new Date() } });
    await expect(bearer(bound.token)).rejects.toMatchObject({ status: 401 });
    const orphan = await oauthToken(ISSUER, ISSUER);
    await db.oAuthClient.delete({ where: { id: orphan.client.id } });
    await expect(bearer(orphan.token)).rejects.toMatchObject({ status: 401 });

    const grantClient = await db.oAuthClient.create({ data: { clientName: "Granted", redirectUris: "https://example.com/cb", issuer: ISSUER } });
    const grant = await db.oAuthGrant.create({
      data: {
        userId,
        clientId: grantClient.id,
        issuer: ISSUER,
        scope: "kitchen:read",
        connectionKey: `key-${faker.string.alphanumeric(12)}`,
        status: "active",
        statusChangedAt: new Date(),
      },
    });
    const mint = async (link: object) => {
      const created = await createApiCredential(db, userId, "Granted token", { oauthClientId: grantClient.id, oauthIssuer: ISSUER });
      await db.apiCredential.update({ where: { id: created.credential.id }, data: link });
      return created.token;
    };
    const byId = await mint({ oauthGrantId: grant.id });
    const byKey = await mint({ oauthConnectionKey: grant.connectionKey });
    await expect(bearer(byId)).resolves.toMatchObject({ id: userId });
    await expect(bearer(byKey)).resolves.toMatchObject({ id: userId });
    await db.oAuthGrant.update({ where: { id: grant.id }, data: { status: "revoked", statusChangedAt: new Date() } });
    await expect(bearer(byId)).rejects.toMatchObject({ status: 401 });
    await expect(bearer(byKey)).rejects.toMatchObject({ status: 401 });
    expect(getPrisma).not.toHaveBeenCalled();
  });

  it("leaves binding a legacy issuer to Prisma, once, and then stays on D1", async () => {
    const legacy = await oauthToken(null, null);
    await expect(bearer(legacy.token)).resolves.toMatchObject({ oauthIssuer: ISSUER });
    expect(getPrisma).toHaveBeenCalledTimes(1);
    await expect(db.oAuthClient.findUniqueOrThrow({ where: { id: legacy.client.id } })).resolves.toMatchObject({ issuer: ISSUER });

    // A credential of an already-bound client still binds its own issuer through Prisma.
    const unboundCredential = await oauthToken(ISSUER, null);
    await expect(bearer(unboundCredential.token)).resolves.toMatchObject({ oauthIssuer: ISSUER });
    expect(getPrisma).toHaveBeenCalledTimes(2);

    await expect(bearer(legacy.token)).resolves.toMatchObject({ oauthIssuer: ISSUER });
    await expect(bearer(unboundCredential.token)).resolves.toMatchObject({ oauthIssuer: ISSUER });
    expect(getPrisma).toHaveBeenCalledTimes(2);
  });

  it("stops an OAuth token issued without an expiry at the 2027-01-07 cutover, but not a personal one", async () => {
    const oauth = await oauthToken(ISSUER, ISSUER);
    await db.apiCredential.update({ where: { id: oauth.credential.id }, data: { expiresAt: null } });
    const personal = await createApiCredential(db, userId, "Script", { expiresAt: null });
    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2027-01-06T23:59:00.000Z"));
      await expect(bearer(oauth.token)).resolves.toMatchObject({ id: userId });
      vi.setSystemTime(new Date("2027-01-07T00:00:00.000Z"));
      await expect(bearer(oauth.token)).rejects.toMatchObject({ status: 401 });
      await expect(bearer(personal.token)).resolves.toMatchObject({ id: userId });
    } finally {
      vi.useRealTimers();
    }
    expect(getPrisma).not.toHaveBeenCalled();
  });

  it("returns the same OAuth principal as the Prisma path, resource included", async () => {
    const oauth = await oauthToken(ISSUER, ISSUER, { oauthResource: `${ISSUER}/mcp` });
    const principal = await bearer(oauth.token);
    expect(principal).toMatchObject({ oauthClientId: oauth.client.id, oauthIssuer: ISSUER, oauthResource: `${ISSUER}/mcp` });
    expect(principal).toEqual(await authenticateApiToken(db, oauth.token, ISSUER));
  });

  it("refuses, through the Prisma fallback, an unbound credential of a client bound elsewhere", async () => {
    const elsewhere = await oauthToken("https://other.example", null);
    await expect(bearer(elsewhere.token)).rejects.toMatchObject({ status: 401 });
    expect(getPrisma).toHaveBeenCalledTimes(1);
    expect(await credential(elsewhere.credential.id)).toMatchObject({ oauthIssuer: null, lastUsedAt: null });
  });

  it("refuses a token when either grant it names is inactive, on D1 and through Prisma", async () => {
    const client = await db.oAuthClient.create({ data: { clientName: "Two grants", redirectUris: "https://example.com/cb", issuer: ISSUER } });
    const grant = (status: string) => db.oAuthGrant.create({
      data: {
        userId,
        clientId: client.id,
        issuer: ISSUER,
        scope: "kitchen:read",
        connectionKey: `key-${faker.string.alphanumeric(12)}`,
        status,
        statusChangedAt: new Date(),
      },
    });
    const [active, revoked] = [await grant("active"), await grant("revoked")];
    const mixed = await createApiCredential(db, userId, "Mixed", { oauthClientId: client.id, oauthIssuer: ISSUER });
    await db.apiCredential.update({
      where: { id: mixed.credential.id },
      data: { oauthGrantId: active.id, oauthConnectionKey: revoked.connectionKey },
    });
    await expect(bearer(mixed.token)).rejects.toMatchObject({ status: 401 });
    await expect(authenticateApiToken(db, mixed.token, ISSUER)).rejects.toMatchObject({ status: 401 });

    await db.apiCredential.update({ where: { id: mixed.credential.id }, data: { oauthConnectionKey: active.connectionKey } });
    await expect(bearer(mixed.token)).resolves.toMatchObject({ id: userId });
    await expect(authenticateApiToken(db, mixed.token, ISSUER)).resolves.toMatchObject({ id: userId });
  });

  it("hands the usage write to waitUntil, and logs instead of failing when it fails", async () => {
    const created = await createApiCredential(db, userId, "Background");
    const deferred: Promise<unknown>[] = [];
    await expect(bearer(created.token, { waitUntil: (promise) => deferred.push(promise) })).resolves.toMatchObject({ source: "bearer" });
    expect(deferred).toHaveLength(1);
    await Promise.all(deferred);
    expect((await credential(created.credential.id)).lastUsedAt).toBeInstanceOf(Date);

    await db.apiCredential.update({ where: { id: created.credential.id }, data: { lastUsedAt: null } });
    const failure = new Error("D1 write failed");
    expectConsoleWarning("[api-auth] lastUsedAt update failed", failure);
    let batches = 0;
    const failingWrite: D1ReadDatabase = {
      prepare: (sql) => d1.binding.prepare(sql),
      batch: async (statements) => {
        if (++batches === 2) throw failure;
        return d1.binding.batch(statements as never);
      },
    };
    const background: Promise<unknown>[] = [];
    await expect(bearer(created.token, { binding: failingWrite, waitUntil: (promise) => background.push(promise) }))
      .resolves.toMatchObject({ credentialId: created.credential.id });
    await Promise.all(background);

    // Awaited, the same failure fails the request.
    batches = 0;
    await expect(bearer(created.token, { binding: failingWrite })).rejects.toBe(failure);
  });

  it("fails closed on a D1 credential row missing a field or with a non-text column", async () => {
    const created = await createApiCredential(db, userId, "Corrupt");
    const corrupt = (change: Record<string, unknown>): D1ReadDatabase => ({
      prepare: (sql) => d1.binding.prepare(sql),
      batch: async (statements) => {
        const results = await d1.binding.batch(statements as never);
        return results.map((result) => ({ ...result, results: result.results.map((row) => ({ ...row, ...change })) }));
      },
    });
    for (const field of ["id", "userId", "email", "username", "sessionVersion"]) {
      await expect(bearer(created.token, { binding: corrupt({ [field]: null }) }))
        .rejects.toThrow("D1 credential row is missing its id, user, email, username or session version");
    }
    await expect(bearer(created.token, { binding: corrupt({ scopes: 7 }) })).rejects.toThrow("D1 credential row has a non-text scopes");
    const oauth = await oauthToken(ISSUER, ISSUER);
    await expect(bearer(oauth.token, { binding: corrupt({ grantInactive: "no" }) })).rejects.toThrow("D1 column grantInactive is not a Boolean");
    await expect(bearer(oauth.token, { binding: corrupt({ clientCount: null }) })).rejects.toThrow("D1 column clientCount is not a count");
    expect(getPrisma).not.toHaveBeenCalled();
  });
});
