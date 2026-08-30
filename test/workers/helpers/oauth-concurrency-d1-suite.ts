import { env } from "cloudflare:test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getRequestDb } from "../../../app/lib/route-platform.server";
import { hashApiToken } from "../../../app/lib/api-auth.server";
import {
  consumeAuthorizationCode,
  createAuthorizationCode,
  hashOAuthOpaqueToken,
  issueConnectorTokens,
  OAuthError,
  revokeConnectorRefreshToken,
  rotateConnectorTokens,
  type IssuedConnectorTokens,
  type OAuthPersistenceDependencies,
  type OAuthPersistenceStage,
  type OAuthPersistenceTiming,
} from "../../../app/lib/oauth-server.server";
import { createDeterministicStaleReadRace } from "../../helpers/deterministic-race";
import { applyRepositoryMigrations } from "./repository-migrations";

interface TestD1Statement {
  bind(...values: unknown[]): TestD1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface TestD1Database {
  prepare(sql: string): TestD1Statement;
}

const ISSUER = "https://spoonjoy.test";
const USER_ID = "oauth-concurrency-d1-user";
const CLIENT_ID = "oauth-concurrency-d1-client";
const REDIRECT_URI = "https://example.com/callback";
const VERIFIER = "verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
const NOW = new Date("2026-08-29T18:00:00.000Z");
const CONTENDERS = ["honest_client", "indistinguishable_replay"] as const;

function database() {
  return (env as unknown as { DB: TestD1Database }).DB;
}

function routeContext() {
  return { cloudflare: { env } };
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

type DatabaseClient = Awaited<ReturnType<typeof getRequestDb>>;
type ContenderResult =
  | { contender: (typeof CONTENDERS)[number]; status: "fulfilled"; value: IssuedConnectorTokens }
  | { contender: (typeof CONTENDERS)[number]; status: "rejected"; reason: unknown };

async function captureResult(
  contender: (typeof CONTENDERS)[number],
  operation: () => Promise<IssuedConnectorTokens>,
): Promise<ContenderResult> {
  try {
    return { contender, status: "fulfilled", value: await operation() };
  } catch (reason) {
    return { contender, status: "rejected", reason };
  }
}

function failAt(
  stage: OAuthPersistenceStage,
  timing: OAuthPersistenceTiming,
): OAuthPersistenceDependencies {
  return {
    onPersistenceMutation: async (observedStage, observedTiming) => {
      if (observedStage === stage && observedTiming === timing) {
        throw new Error(`oauth-d1-failpoint:${stage}:${timing}`);
      }
    },
  };
}

describe("OAuth concurrency baseline through independent PrismaD1 clients", () => {
  let clients: [DatabaseClient, DatabaseClient];

  beforeAll(async () => {
    await applyRepositoryMigrations(database());
    await database().prepare(`
      INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt")
      VALUES ('${USER_ID}', 'oauth-concurrency-d1@example.com', 'oauth_concurrency_d1', '${NOW.toISOString()}', '${NOW.toISOString()}')
    `).run();
    await database().prepare(`
      INSERT INTO "OAuthClient" ("id", "clientName", "redirectUris", "issuer", "createdAt")
      VALUES ('${CLIENT_ID}', 'D1 concurrency baseline', '${REDIRECT_URI}', '${ISSUER}', '${NOW.toISOString()}')
    `).run();
  });

  beforeEach(async () => {
    await database().prepare(`DELETE FROM "ApiCredential" WHERE "userId" = '${USER_ID}'`).run();
    await database().prepare(`DELETE FROM "OAuthRefreshToken" WHERE "userId" = '${USER_ID}'`).run();
    await database().prepare(`DELETE FROM "OAuthAuthCode" WHERE "userId" = '${USER_ID}'`).run();
    clients = [
      await getRequestDb(routeContext() as never),
      await getRequestDb(routeContext() as never),
    ];
    expect(clients[0]).not.toBe(clients[1]);
  });

  afterEach(async () => {
    await Promise.all(clients.map((client) => client.$disconnect()));
  });

  afterAll(async () => {
    await database().prepare(`DELETE FROM "ApiCredential" WHERE "userId" = '${USER_ID}'`).run();
    await database().prepare(`DELETE FROM "OAuthRefreshToken" WHERE "userId" = '${USER_ID}'`).run();
    await database().prepare(`DELETE FROM "OAuthAuthCode" WHERE "userId" = '${USER_ID}'`).run();
    await database().prepare(`DELETE FROM "OAuthClient" WHERE "id" = '${CLIENT_ID}'`).run();
    await database().prepare(`DELETE FROM "User" WHERE "id" = '${USER_ID}'`).run();
  });

  async function mintAuthorizationCode(): Promise<string> {
    return createAuthorizationCode(clients[0], {
      clientId: CLIENT_ID,
      userId: USER_ID,
      redirectUri: REDIRECT_URI,
      codeChallenge: await challengeFor(VERIFIER),
      scope: "kitchen:read",
      resource: "https://spoonjoy.test/mcp",
      issuer: ISSUER,
      now: NOW,
    });
  }

  async function issueTokens() {
    return issueConnectorTokens(clients[0], {
      userId: USER_ID,
      clientId: CLIENT_ID,
      scope: "kitchen:read",
      resource: "https://spoonjoy.test/mcp",
      persistentMcpResource: "https://spoonjoy.test/mcp",
      issuer: ISSUER,
      now: NOW,
    });
  }

  async function replaceEveryClient() {
    await Promise.all(clients.map((client) => client.$disconnect()));
    clients = [
      await getRequestDb(routeContext() as never),
      await getRequestDb(routeContext() as never),
    ];
  }

  it("persists every connector row and binding across PrismaD1 client replacement", async () => {
    const original = await issueTokens();
    const originalRefreshHash = await hashOAuthOpaqueToken(original.refreshToken);
    const originalAccessHash = await hashApiToken(original.accessToken);

    await replaceEveryClient();
    const rotated = await rotateConnectorTokens(clients[0], {
      refreshToken: original.refreshToken,
      clientId: CLIENT_ID,
      issuer: ISSUER,
      now: NOW,
    });
    const rotatedRefreshHash = await hashOAuthOpaqueToken(rotated.refreshToken);
    const rotatedAccessHash = await hashApiToken(rotated.accessToken);

    await replaceEveryClient();
    const parent = await clients[0].oAuthRefreshToken.findUniqueOrThrow({
      where: { tokenHash: originalRefreshHash },
    });
    const child = await clients[0].oAuthRefreshToken.findUniqueOrThrow({
      where: { tokenHash: rotatedRefreshHash },
    });
    const originalAccess = await clients[0].apiCredential.findUniqueOrThrow({
      where: { tokenHash: originalAccessHash },
    });
    const rotatedAccess = await clients[0].apiCredential.findUniqueOrThrow({
      where: { tokenHash: rotatedAccessHash },
    });

    expect(parent).toMatchObject({
      userId: USER_ID,
      clientId: CLIENT_ID,
      issuer: ISSUER,
      scope: "kitchen:read",
      resource: "https://spoonjoy.test/mcp",
      revokedAt: NOW,
      connectionKey: child.connectionKey,
    });
    expect(child).toMatchObject({
      userId: USER_ID,
      clientId: CLIENT_ID,
      issuer: ISSUER,
      scope: "kitchen:read",
      resource: "https://spoonjoy.test/mcp",
      revokedAt: null,
    });
    expect(originalAccess).toMatchObject({
      userId: USER_ID,
      scopes: "kitchen:read",
      oauthClientId: CLIENT_ID,
      oauthIssuer: ISSUER,
      oauthResource: "https://spoonjoy.test/mcp",
      oauthConnectionKey: child.connectionKey,
      revokedAt: null,
      expiresAt: null,
    });
    expect(rotatedAccess).toMatchObject({
      userId: USER_ID,
      scopes: "kitchen:read",
      oauthClientId: CLIENT_ID,
      oauthIssuer: ISSUER,
      oauthResource: "https://spoonjoy.test/mcp",
      oauthConnectionKey: child.connectionKey,
      revokedAt: null,
      expiresAt: new Date("2026-08-29T18:15:00.000Z"),
    });
  });

  it.each(["before", "after"] as const)(
    "reproduces the D1 state %s authorization-code consumption",
    async (timing) => {
      const code = await mintAuthorizationCode();

      await expect(consumeAuthorizationCode(clients[0], {
        code,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        codeVerifier: VERIFIER,
        issuer: ISSUER,
        now: NOW,
      }, failAt("code_consumption", timing))).rejects.toThrow(
        `oauth-d1-failpoint:code_consumption:${timing}`,
      );

      await expect(clients[0].oAuthAuthCode.findFirstOrThrow({ where: { userId: USER_ID } }))
        .resolves.toMatchObject({ consumedAt: timing === "before" ? null : NOW });
      await expect(clients[0].apiCredential.count({ where: { userId: USER_ID } })).resolves.toBe(0);
      await expect(clients[0].oAuthRefreshToken.count({ where: { userId: USER_ID } })).resolves.toBe(0);
    },
  );

  it.each(["before", "after"] as const)(
    "reproduces the D1 state %s access insertion",
    async (timing) => {
      await expect(issueConnectorTokens(clients[0], {
        userId: USER_ID,
        clientId: CLIENT_ID,
        scope: "kitchen:read",
        issuer: ISSUER,
        now: NOW,
      }, failAt("access_insert", timing))).rejects.toThrow(
        `oauth-d1-failpoint:access_insert:${timing}`,
      );

      await expect(clients[0].apiCredential.count({ where: { userId: USER_ID } }))
        .resolves.toBe(timing === "before" ? 0 : 1);
      await expect(clients[0].oAuthRefreshToken.count({ where: { userId: USER_ID } })).resolves.toBe(0);
    },
  );

  it.each(["before", "after"] as const)(
    "reproduces the D1 state %s refresh insertion",
    async (timing) => {
      await expect(issueConnectorTokens(clients[0], {
        userId: USER_ID,
        clientId: CLIENT_ID,
        scope: "kitchen:read",
        issuer: ISSUER,
        now: NOW,
      }, failAt("refresh_insert", timing))).rejects.toThrow(
        `oauth-d1-failpoint:refresh_insert:${timing}`,
      );

      await expect(clients[0].apiCredential.count({ where: { userId: USER_ID } })).resolves.toBe(1);
      await expect(clients[0].oAuthRefreshToken.count({ where: { userId: USER_ID } }))
        .resolves.toBe(timing === "before" ? 0 : 1);
    },
  );

  it.each(["before", "after"] as const)(
    "reproduces the D1 state %s parent revocation",
    async (timing) => {
      const original = await issueTokens();

      await expect(rotateConnectorTokens(clients[0], {
        refreshToken: original.refreshToken,
        clientId: CLIENT_ID,
        issuer: ISSUER,
        now: NOW,
      }, failAt("parent_revoke", timing))).rejects.toThrow(
        `oauth-d1-failpoint:parent_revoke:${timing}`,
      );

      await expect(clients[0].oAuthRefreshToken.findFirstOrThrow({ where: { userId: USER_ID } }))
        .resolves.toMatchObject({ revokedAt: timing === "before" ? null : NOW });
      await expect(clients[0].apiCredential.count({ where: { userId: USER_ID } })).resolves.toBe(1);
      await expect(clients[0].oAuthRefreshToken.count({ where: { userId: USER_ID } })).resolves.toBe(1);
    },
  );

  it.each(["before", "after"] as const)(
    "reproduces the D1 state %s replacement-pair insertion",
    async (timing) => {
      const original = await issueTokens();

      await expect(rotateConnectorTokens(clients[0], {
        refreshToken: original.refreshToken,
        clientId: CLIENT_ID,
        issuer: ISSUER,
        now: NOW,
      }, failAt("replacement_insert", timing))).rejects.toThrow(
        `oauth-d1-failpoint:replacement_insert:${timing}`,
      );

      await expect(clients[0].oAuthRefreshToken.count({ where: { userId: USER_ID } }))
        .resolves.toBe(timing === "before" ? 1 : 2);
      await expect(clients[0].apiCredential.count({ where: { userId: USER_ID } }))
        .resolves.toBe(timing === "before" ? 1 : 2);
      await expect(clients[0].oAuthRefreshToken.count({ where: { userId: USER_ID, revokedAt: null } }))
        .resolves.toBe(timing === "before" ? 0 : 1);
    },
  );

  it.each([
    ["access_insert", "before", 1, 1, 0],
    ["access_insert", "after", 2, 1, 0],
    ["refresh_insert", "before", 2, 1, 0],
    ["refresh_insert", "after", 2, 2, 1],
  ] as const)(
    "reproduces replacement %s %s through D1",
    async (stage, timing, accessCount, refreshCount, activeRefreshCount) => {
      const original = await issueTokens();
      const parent = await clients[0].oAuthRefreshToken.findFirstOrThrow({
        where: { tokenHash: await hashOAuthOpaqueToken(original.refreshToken) },
        select: { id: true },
      });

      await expect(rotateConnectorTokens(clients[0], {
        refreshToken: original.refreshToken,
        clientId: CLIENT_ID,
        issuer: ISSUER,
        now: NOW,
      }, failAt(stage, timing))).rejects.toThrow(
        `oauth-d1-failpoint:${stage}:${timing}`,
      );

      await expect(clients[0].oAuthRefreshToken.count({ where: { userId: USER_ID } })).resolves.toBe(refreshCount);
      await expect(clients[0].apiCredential.count({ where: { userId: USER_ID } })).resolves.toBe(accessCount);
      await expect(clients[0].oAuthRefreshToken.count({ where: { userId: USER_ID, revokedAt: null } }))
        .resolves.toBe(activeRefreshCount);
      await expect(clients[0].oAuthRefreshToken.findUniqueOrThrow({ where: { id: parent.id } }))
        .resolves.toMatchObject({ revokedAt: NOW });
    },
  );

  it.each(["before", "after"] as const)(
    "reproduces the D1 state %s disconnect refresh revocation",
    async (timing) => {
      const original = await issueTokens();

      await expect(revokeConnectorRefreshToken(clients[0], {
        refreshToken: original.refreshToken,
        clientId: CLIENT_ID,
        issuer: ISSUER,
        now: NOW,
      }, failAt("disconnect_refresh_revoke", timing))).rejects.toThrow(
        `oauth-d1-failpoint:disconnect_refresh_revoke:${timing}`,
      );

      await expect(clients[0].oAuthRefreshToken.findFirstOrThrow({ where: { userId: USER_ID } }))
        .resolves.toMatchObject({ revokedAt: timing === "before" ? null : NOW });
      await expect(clients[0].apiCredential.findFirstOrThrow({ where: { userId: USER_ID } }))
        .resolves.toMatchObject({ revokedAt: null });
    },
  );

  it.each(["before", "after"] as const)(
    "reproduces the D1 state %s disconnect access revocation",
    async (timing) => {
      const original = await issueTokens();

      await expect(revokeConnectorRefreshToken(clients[0], {
        refreshToken: original.refreshToken,
        clientId: CLIENT_ID,
        issuer: ISSUER,
        now: NOW,
      }, failAt("disconnect_access_revoke", timing))).rejects.toThrow(
        `oauth-d1-failpoint:disconnect_access_revoke:${timing}`,
      );

      await expect(clients[0].oAuthRefreshToken.findFirstOrThrow({ where: { userId: USER_ID } }))
        .resolves.toMatchObject({ revokedAt: NOW });
      await expect(clients[0].apiCredential.findFirstOrThrow({ where: { userId: USER_ID } }))
        .resolves.toMatchObject({ revokedAt: timing === "before" ? null : NOW });
    },
  );

  it("allows exactly one identical D1 authorization-code exchange to issue credentials", async () => {
    const code = await createAuthorizationCode(clients[0], {
      clientId: CLIENT_ID,
      userId: USER_ID,
      redirectUri: REDIRECT_URI,
      codeChallenge: await challengeFor(VERIFIER),
      scope: "kitchen:read",
      resource: "https://spoonjoy.test/mcp",
      issuer: ISSUER,
      now: NOW,
    });
    const codeHash = await hashOAuthOpaqueToken(code);
    const race = createDeterministicStaleReadRace({
      contenders: CONTENDERS,
      winner: "honest_client",
      stage: "code_consumption",
    });

    const results = await Promise.all(CONTENDERS.map((contender, index) => captureResult(
      contender,
      async () => {
        const grant = await consumeAuthorizationCode(clients[index], {
          code,
          clientId: CLIENT_ID,
          redirectUri: REDIRECT_URI,
          codeVerifier: VERIFIER,
          issuer: ISSUER,
          now: NOW,
        }, { onPersistenceMutation: race.hookFor(contender) });
        return issueConnectorTokens(clients[index], {
          ...grant,
          clientId: CLIENT_ID,
          persistentMcpResource: "https://spoonjoy.test/mcp",
          issuer: ISSUER,
          now: NOW,
        });
      },
    )));

    expect(race.arrivedContenders()).toEqual(CONTENDERS);
    const winner = results.find((result) => result.status === "fulfilled");
    expect(winner?.contender).toBe("honest_client");
    const loser = results.find((result) => result.status === "rejected");
    expect(loser?.contender).toBe("indistinguishable_replay");
    expect(loser && "reason" in loser ? loser.reason : null).toBeInstanceOf(OAuthError);
    expect(loser && "reason" in loser ? (loser.reason as OAuthError).code : null).toBe("invalid_grant");
    if (!winner || winner.status !== "fulfilled") throw new Error("expected one D1 code-exchange winner");
    const accessHash = await hashApiToken(winner.value.accessToken);
    const refreshHash = await hashOAuthOpaqueToken(winner.value.refreshToken);
    const codeRows = await clients[0].oAuthAuthCode.findMany({ where: { userId: USER_ID } });
    const accessRows = await clients[0].apiCredential.findMany({ where: { userId: USER_ID } });
    const refreshRows = await clients[0].oAuthRefreshToken.findMany({ where: { userId: USER_ID } });
    expect(codeRows.map((row) => row.codeHash)).toEqual([codeHash]);
    expect(codeRows[0]).toMatchObject({
      userId: USER_ID,
      clientId: CLIENT_ID,
      issuer: ISSUER,
      redirectUri: REDIRECT_URI,
      scope: "kitchen:read",
      resource: "https://spoonjoy.test/mcp",
      consumedAt: NOW,
      expiresAt: new Date("2026-08-29T18:01:00.000Z"),
    });
    expect(accessRows).toHaveLength(1);
    expect(accessRows[0]).toMatchObject({
      tokenHash: accessHash,
      userId: USER_ID,
      scopes: "kitchen:read",
      oauthClientId: CLIENT_ID,
      oauthIssuer: ISSUER,
      oauthResource: "https://spoonjoy.test/mcp",
      oauthConnectionKey: refreshRows[0]?.connectionKey,
      revokedAt: null,
      expiresAt: null,
    });
    expect(refreshRows).toHaveLength(1);
    expect(refreshRows[0]).toMatchObject({
      tokenHash: refreshHash,
      userId: USER_ID,
      clientId: CLIENT_ID,
      issuer: ISSUER,
      scope: "kitchen:read",
      resource: "https://spoonjoy.test/mcp",
      connectionKey: accessRows[0]?.oauthConnectionKey,
      revokedAt: null,
    });
  });

  it.each(CONTENDERS)(
    "leaves the D1 child family active when %s wins an indistinguishable public-bearer race",
    async (designatedWinner) => {
      const original = await issueConnectorTokens(clients[0], {
        userId: USER_ID,
        clientId: CLIENT_ID,
        scope: "kitchen:read",
        resource: "https://spoonjoy.test/mcp",
        persistentMcpResource: "https://spoonjoy.test/mcp",
        issuer: ISSUER,
        now: NOW,
      });
      const parent = await clients[0].oAuthRefreshToken.findFirstOrThrow({
        where: { tokenHash: await hashOAuthOpaqueToken(original.refreshToken) },
      });
      const originalAccessHash = await hashApiToken(original.accessToken);
      const race = createDeterministicStaleReadRace({
        contenders: CONTENDERS,
        winner: designatedWinner,
        stage: "parent_revoke",
      });

      const results = await Promise.all(CONTENDERS.map((contender, index) => captureResult(
        contender,
        () => rotateConnectorTokens(clients[index], {
          refreshToken: original.refreshToken,
          clientId: CLIENT_ID,
          issuer: ISSUER,
          now: NOW,
        }, { onPersistenceMutation: race.hookFor(contender) }),
      )));

      expect(race.arrivedContenders()).toEqual(CONTENDERS);
      const winner = results.find((result) => result.status === "fulfilled");
      const loser = results.find((result) => result.status === "rejected");
      expect(winner?.contender).toBe(designatedWinner);
      expect(loser?.contender).toBe(
        designatedWinner === "honest_client" ? "indistinguishable_replay" : "honest_client",
      );
      expect(loser && "reason" in loser ? loser.reason : null).toBeInstanceOf(OAuthError);
      expect(loser && "reason" in loser ? (loser.reason as OAuthError).code : null).toBe("invalid_grant");
      if (!winner || winner.status !== "fulfilled") throw new Error("expected one D1 refresh winner");
      const childRefreshHash = await hashOAuthOpaqueToken(winner.value.refreshToken);
      const childAccessHash = await hashApiToken(winner.value.accessToken);
      const refreshRows = await clients[0].oAuthRefreshToken.findMany({ where: { userId: USER_ID } });
      const accessRows = await clients[0].apiCredential.findMany({ where: { userId: USER_ID } });
      expect(refreshRows.map((row) => row.tokenHash).sort())
        .toEqual([parent.tokenHash, childRefreshHash].sort());
      expect(accessRows.map((row) => row.tokenHash).sort())
        .toEqual([originalAccessHash, childAccessHash].sort());

      const persistedParent = refreshRows.find((row) => row.tokenHash === parent.tokenHash);
      const child = refreshRows.find((row) => row.tokenHash === childRefreshHash);
      const originalAccess = accessRows.find((row) => row.tokenHash === originalAccessHash);
      const childAccess = accessRows.find((row) => row.tokenHash === childAccessHash);
      expect(persistedParent).toMatchObject({
        userId: USER_ID,
        clientId: CLIENT_ID,
        issuer: ISSUER,
        scope: "kitchen:read",
        resource: "https://spoonjoy.test/mcp",
        connectionKey: parent.connectionKey,
        revokedAt: NOW,
      });
      expect(child).toMatchObject({
        userId: USER_ID,
        clientId: CLIENT_ID,
        issuer: ISSUER,
        scope: "kitchen:read",
        resource: "https://spoonjoy.test/mcp",
        connectionKey: parent.connectionKey,
        revokedAt: null,
      });
      expect(originalAccess).toMatchObject({
        userId: USER_ID,
        scopes: "kitchen:read",
        oauthClientId: CLIENT_ID,
        oauthIssuer: ISSUER,
        oauthResource: "https://spoonjoy.test/mcp",
        oauthConnectionKey: parent.connectionKey,
        revokedAt: null,
        expiresAt: null,
      });
      expect(childAccess).toMatchObject({
        userId: USER_ID,
        scopes: "kitchen:read",
        oauthClientId: CLIENT_ID,
        oauthIssuer: ISSUER,
        oauthResource: "https://spoonjoy.test/mcp",
        oauthConnectionKey: parent.connectionKey,
        revokedAt: null,
        expiresAt: new Date("2026-08-29T18:15:00.000Z"),
      });
    },
  );
});
