import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  consumeAuthorizationCode,
  createAuthorizationCode,
  issueConnectorTokens,
  revokeConnectorRefreshToken,
  rotateConnectorTokens,
  type OAuthPersistenceDependencies,
  type OAuthPersistenceStage,
  type OAuthPersistenceTiming,
} from "~/lib/oauth-server.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

const ISSUER = "https://spoonjoy.app";
const CLIENT_ID = "failpoint-client";
const REDIRECT_URI = "https://example.com/callback";
const VERIFIER = "verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
const NOW = new Date("2026-08-29T17:00:00.000Z");

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function failAt(
  stage: OAuthPersistenceStage,
  timing: OAuthPersistenceTiming,
): OAuthPersistenceDependencies {
  return {
    onPersistenceMutation: async (observedStage, observedTiming) => {
      if (observedStage === stage && observedTiming === timing) {
        throw new Error(`oauth-failpoint:${stage}:${timing}`);
      }
    },
  };
}

describe("OAuth persistence failpoints", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  let userId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    userId = (await db.user.create({ data: createTestUser() })).id;
    await db.oAuthClient.create({
      data: {
        id: CLIENT_ID,
        clientName: "Failure harness",
        redirectUris: REDIRECT_URI,
        issuer: ISSUER,
      },
    });
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  async function mintAuthorizationCode(): Promise<string> {
    return createAuthorizationCode(db, {
      clientId: CLIENT_ID,
      userId,
      redirectUri: REDIRECT_URI,
      codeChallenge: await challengeFor(VERIFIER),
      scope: "kitchen:read",
      resource: "https://spoonjoy.app/mcp",
      issuer: ISSUER,
      now: NOW,
    });
  }

  async function issueTokens() {
    return issueConnectorTokens(db, {
      userId,
      clientId: CLIENT_ID,
      scope: "kitchen:read",
      resource: "https://spoonjoy.app/mcp",
      persistentMcpResource: "https://spoonjoy.app/mcp",
      issuer: ISSUER,
      now: NOW,
    });
  }

  it.each(["before", "after"] as const)(
    "fails %s authorization-code consumption at the named boundary",
    async (timing) => {
      const code = await mintAuthorizationCode();

      await expect(consumeAuthorizationCode(db, {
        code,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        codeVerifier: VERIFIER,
        issuer: ISSUER,
        now: NOW,
      }, failAt("code_consumption", timing))).rejects.toThrow(
        `oauth-failpoint:code_consumption:${timing}`,
      );

      await expect(db.oAuthAuthCode.findFirstOrThrow({ where: { userId } }))
        .resolves.toMatchObject({ consumedAt: timing === "before" ? null : NOW });
      await expect(db.apiCredential.count({ where: { userId } })).resolves.toBe(0);
      await expect(db.oAuthRefreshToken.count({ where: { userId } })).resolves.toBe(0);
    },
  );

  it.each(["before", "after"] as const)(
    "fails %s access insertion and exposes any orphaned credential",
    async (timing) => {
      await expect(issueConnectorTokens(db, {
        userId,
        clientId: CLIENT_ID,
        scope: "kitchen:read",
        issuer: ISSUER,
        now: NOW,
      }, failAt("access_insert", timing))).rejects.toThrow(
        `oauth-failpoint:access_insert:${timing}`,
      );

      await expect(db.apiCredential.count({ where: { userId } }))
        .resolves.toBe(timing === "before" ? 0 : 1);
      await expect(db.oAuthRefreshToken.count({ where: { userId } })).resolves.toBe(0);
    },
  );

  it.each(["before", "after"] as const)(
    "fails %s refresh insertion after the access write",
    async (timing) => {
      await expect(issueConnectorTokens(db, {
        userId,
        clientId: CLIENT_ID,
        scope: "kitchen:read",
        issuer: ISSUER,
        now: NOW,
      }, failAt("refresh_insert", timing))).rejects.toThrow(
        `oauth-failpoint:refresh_insert:${timing}`,
      );

      await expect(db.apiCredential.count({ where: { userId } })).resolves.toBe(1);
      await expect(db.oAuthRefreshToken.count({ where: { userId } }))
        .resolves.toBe(timing === "before" ? 0 : 1);
    },
  );

  it.each(["before", "after"] as const)(
    "fails %s rotation parent revocation",
    async (timing) => {
      const original = await issueTokens();

      await expect(rotateConnectorTokens(db, {
        refreshToken: original.refreshToken,
        clientId: CLIENT_ID,
        issuer: ISSUER,
        now: NOW,
      }, failAt("parent_revoke", timing))).rejects.toThrow(
        `oauth-failpoint:parent_revoke:${timing}`,
      );

      await expect(db.oAuthRefreshToken.findFirstOrThrow({ where: { userId } }))
        .resolves.toMatchObject({ revokedAt: timing === "before" ? null : NOW });
      await expect(db.apiCredential.count({ where: { userId } })).resolves.toBe(1);
      await expect(db.oAuthRefreshToken.count({ where: { userId } })).resolves.toBe(1);
    },
  );

  it.each(["before", "after"] as const)(
    "fails %s replacement-pair insertion after revoking the parent",
    async (timing) => {
      const original = await issueTokens();

      await expect(rotateConnectorTokens(db, {
        refreshToken: original.refreshToken,
        clientId: CLIENT_ID,
        issuer: ISSUER,
        now: NOW,
      }, failAt("replacement_insert", timing))).rejects.toThrow(
        `oauth-failpoint:replacement_insert:${timing}`,
      );

      await expect(db.oAuthRefreshToken.count({ where: { userId } }))
        .resolves.toBe(timing === "before" ? 1 : 2);
      await expect(db.apiCredential.count({ where: { userId } }))
        .resolves.toBe(timing === "before" ? 1 : 2);
      await expect(db.oAuthRefreshToken.count({ where: { userId, revokedAt: null } }))
        .resolves.toBe(timing === "before" ? 0 : 1);
    },
  );

  it.each([
    ["access_insert", "before", 1, 1, 0],
    ["access_insert", "after", 2, 1, 0],
    ["refresh_insert", "before", 2, 1, 0],
    ["refresh_insert", "after", 2, 2, 1],
  ] as const)(
    "fails replacement %s %s and records the exact residual generation",
    async (stage, timing, accessCount, refreshCount, activeRefreshCount) => {
      const original = await issueTokens();
      const parent = await db.oAuthRefreshToken.findFirstOrThrow({
        where: { userId, revokedAt: null },
        select: { id: true },
      });

      await expect(rotateConnectorTokens(db, {
        refreshToken: original.refreshToken,
        clientId: CLIENT_ID,
        issuer: ISSUER,
        now: NOW,
      }, failAt(stage, timing))).rejects.toThrow(
        `oauth-failpoint:${stage}:${timing}`,
      );

      await expect(db.oAuthRefreshToken.count({ where: { userId } })).resolves.toBe(refreshCount);
      await expect(db.apiCredential.count({ where: { userId } })).resolves.toBe(accessCount);
      await expect(db.oAuthRefreshToken.count({ where: { userId, revokedAt: null } }))
        .resolves.toBe(activeRefreshCount);
      await expect(db.oAuthRefreshToken.findUniqueOrThrow({ where: { id: parent.id } }))
        .resolves.toMatchObject({ revokedAt: NOW });
    },
  );

  it.each([
    "legacy_resource_refresh",
    "legacy_resource_access",
    "legacy_resource_grant",
  ] as const)("retries and converges after %s commits before process loss", async (stage) => {
    await db.oAuthClient.update({
      where: { id: CLIENT_ID },
      data: { clientName: "Claude", redirectUris: "https://claude.ai/api/mcp/auth_callback" },
    });
    const original = await issueConnectorTokens(db, {
      userId,
      clientId: CLIENT_ID,
      scope: "kitchen:read",
      resource: null,
      issuer: ISSUER,
      now: NOW,
    });

    await expect(rotateConnectorTokens(db, {
      refreshToken: original.refreshToken,
      clientId: CLIENT_ID,
      issuer: ISSUER,
      legacyMcpResource: `${ISSUER}/mcp`,
      now: NOW,
    }, failAt(stage, "after"))).rejects.toThrow(`oauth-failpoint:${stage}:after`);

    await expect(rotateConnectorTokens(db, {
      refreshToken: original.refreshToken,
      clientId: CLIENT_ID,
      issuer: ISSUER,
      legacyMcpResource: `${ISSUER}/mcp`,
      now: NOW,
    })).resolves.toMatchObject({ resource: `${ISSUER}/mcp` });
    expect(await db.oAuthRefreshToken.findMany({ where: { userId }, select: { resource: true } }))
      .toSatisfy((rows: Array<{ resource: string | null }>) => rows.every((row) => row.resource === `${ISSUER}/mcp`));
    expect(await db.apiCredential.findMany({ where: { userId }, select: { oauthResource: true } }))
      .toSatisfy((rows: Array<{ oauthResource: string | null }>) => rows.every((row) => row.oauthResource === `${ISSUER}/mcp`));
    await expect(db.oAuthGrant.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({ resource: `${ISSUER}/mcp`, status: "active" });
  });

  it.each(["before", "after"] as const)(
    "fails %s disconnect refresh revocation",
    async (timing) => {
      const original = await issueTokens();

      await expect(revokeConnectorRefreshToken(db, {
        refreshToken: original.refreshToken,
        clientId: CLIENT_ID,
        issuer: ISSUER,
        now: NOW,
      }, failAt("disconnect_refresh_revoke", timing))).rejects.toThrow(
        `oauth-failpoint:disconnect_refresh_revoke:${timing}`,
      );

      await expect(db.oAuthRefreshToken.findFirstOrThrow({ where: { userId } }))
        .resolves.toMatchObject({ revokedAt: timing === "before" ? null : NOW });
      await expect(db.apiCredential.findFirstOrThrow({ where: { userId } }))
        .resolves.toMatchObject({ revokedAt: null });
    },
  );

  it.each(["before", "after"] as const)(
    "fails %s disconnect access revocation after revoking refresh",
    async (timing) => {
      const original = await issueTokens();

      await expect(revokeConnectorRefreshToken(db, {
        refreshToken: original.refreshToken,
        clientId: CLIENT_ID,
        issuer: ISSUER,
        now: NOW,
      }, failAt("disconnect_access_revoke", timing))).rejects.toThrow(
        `oauth-failpoint:disconnect_access_revoke:${timing}`,
      );

      await expect(db.oAuthRefreshToken.findFirstOrThrow({ where: { userId } }))
        .resolves.toMatchObject({ revokedAt: NOW });
      await expect(db.apiCredential.findFirstOrThrow({ where: { userId } }))
        .resolves.toMatchObject({ revokedAt: timing === "before" ? null : NOW });
    },
  );
});
