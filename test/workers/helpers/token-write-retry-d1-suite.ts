import { env } from "cloudflare:test";
import type { PrismaClient } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";

import { authenticateApiToken, createApiCredentialForPrincipal, hashApiToken } from "../../../app/lib/api-auth.server";
import { D1WriteUnavailableError } from "../../../app/lib/d1-write-retry.server";
import { getDb } from "../../../app/lib/db.server";
import {
  hashOAuthOpaqueToken,
  issueConnectorTokens,
  rotateConnectorTokens,
  successorTokenSecrets,
} from "../../../app/lib/oauth-server.server";
import { flakyD1 } from "../../helpers/flaky-d1";
import { applyRepositoryMigrations } from "./repository-migrations";

// Token writes that meet a dropped D1 connection, against Wrangler's real D1 (workerd): the
// refresh-token rotation batch and a fenced API token insert, read back through Prisma's D1
// adapter as the token endpoint and bearer authentication do. Each ends with exactly one live
// token whose secret the caller holds, and a rotation that gave up and then committed late
// answers its pair to the client's next try.

const USER = "token-retry-chef";
const CLIENT = "token-retry-client";
const ISSUER = "https://spoonjoy.test";
const KEY = "workers-successor-key";
const OLD = "2026-01-01T00:00:00.000Z";
const ROTATION_BATCH = /INSERT INTO "OAuthRefreshToken"/;

let prisma: PrismaClient;

function database(): D1Database {
  return env.DB as D1Database;
}

async function issue() {
  const tokens = await issueConnectorTokens(prisma, {
    sessionVersion: 0,
    userId: USER,
    clientId: CLIENT,
    scope: "kitchen:read",
    issuer: ISSUER,
  });
  const parent = await prisma.oAuthRefreshToken.findUniqueOrThrow({ where: { tokenHash: await hashOAuthOpaqueToken(tokens.refreshToken) } });
  return { tokens, parent };
}

async function liveRefreshHashes(connectionKey: string | null) {
  const rows = await prisma.oAuthRefreshToken.findMany({ where: { userId: USER, connectionKey, revokedAt: null } });
  return rows.map((row) => row.tokenHash);
}

describe("token writes on Wrangler D1 when its connection drops", () => {
  beforeAll(async () => {
    await applyRepositoryMigrations(database());
    prisma = await getDb({ DB: database() });
    await database().prepare(
      `INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)`,
    ).bind(USER, `${USER}@example.com`, "token_retry_chef", OLD, OLD).run();
    await database().prepare(
      `INSERT INTO "OAuthClient" ("id", "clientName", "redirectUris", "issuer", "createdAt") VALUES (?, 'Retry harness', 'https://example.com/cb', ?, ?)`,
    ).bind(CLIENT, ISSUER, OLD).run();
  });

  it("rotates once, to a pair that authenticates, when the batch committed but its answer was lost", async () => {
    const { tokens, parent } = await issue();
    const flaky = flakyD1(database());
    flaky.failNext(ROTATION_BATCH, "lost-answer");

    const rotated = await rotateConnectorTokens(prisma, {
      refreshToken: tokens.refreshToken,
      clientId: CLIENT,
      issuer: ISSUER,
      d1: flaky.binding,
      successorKey: KEY,
    });

    expect(flaky.failures()).toBe(1);
    expect(await liveRefreshHashes(parent.connectionKey)).toEqual([await hashOAuthOpaqueToken(rotated.refreshToken)]);
    await expect(authenticateApiToken(prisma, rotated.accessToken, ISSUER)).resolves.toMatchObject({ id: USER });
  });

  it("answers the live pair to the client's next try when a rotation gave up and then committed late", async () => {
    const { tokens, parent } = await issue();
    const flaky = flakyD1(database());
    flaky.failNext(ROTATION_BATCH, "lost", "lost", "lost", "late");
    const input = { refreshToken: tokens.refreshToken, clientId: CLIENT, issuer: ISSUER, d1: flaky.binding, successorKey: KEY };

    await expect(rotateConnectorTokens(prisma, input)).rejects.toBeInstanceOf(D1WriteUnavailableError);
    const retried = await rotateConnectorTokens(prisma, input);

    expect(retried).toMatchObject(await successorTokenSecrets(tokens.refreshToken, parent.id, KEY));
    expect(await liveRefreshHashes(parent.connectionKey)).toEqual([await hashOAuthOpaqueToken(retried.refreshToken)]);
    await expect(authenticateApiToken(prisma, retried.accessToken, ISSUER)).resolves.toMatchObject({ id: USER });
  });

  it("writes one fenced API token whose secret is the one answered when the insert's answer was lost", async () => {
    const flaky = flakyD1(database());
    flaky.failNext(/INSERT INTO "ApiCredential"/, "lost-answer");

    const created = await createApiCredentialForPrincipal(prisma, { id: USER, sessionVersion: 0 }, "Workers script", { d1: flaky.binding });

    expect(flaky.failures()).toBe(1);
    const rows = await prisma.apiCredential.findMany({ where: { userId: USER, name: "Workers script" } });
    expect(rows.map((row) => row.tokenHash)).toEqual([await hashApiToken(created.token)]);
    await expect(authenticateApiToken(prisma, created.token, ISSUER)).resolves.toMatchObject({ id: USER });
  });
});
