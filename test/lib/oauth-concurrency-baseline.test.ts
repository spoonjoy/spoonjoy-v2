import { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  consumeAuthorizationCode,
  createAuthorizationCode,
  hashOAuthOpaqueToken,
  issueConnectorTokens,
  OAuthError,
  rotateConnectorTokens,
  type IssuedConnectorTokens,
} from "~/lib/oauth-server.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createDeterministicStaleReadRace } from "../helpers/deterministic-race";
import { createTestUser } from "../utils";
import { hashApiToken } from "~/lib/api-auth.server";

const ISSUER = "https://spoonjoy.app";
const CLIENT_ID = "oauth-concurrency-client";
const REDIRECT_URI = "https://example.com/callback";
const VERIFIER = "verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
const NOW = new Date("2026-08-29T18:00:00.000Z");
const CONTENDERS = ["honest_client", "indistinguishable_replay"] as const;

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

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

describe("OAuth concurrency baseline across independent SQLite clients", () => {
  let clients: [PrismaClient, PrismaClient];
  let userId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    clients = [new PrismaClient(), new PrismaClient()];
    userId = (await clients[0].user.create({ data: createTestUser() })).id;
    await clients[0].oAuthClient.create({
      data: {
        id: CLIENT_ID,
        clientName: "Concurrency baseline",
        redirectUris: REDIRECT_URI,
        issuer: ISSUER,
      },
    });
  });

  afterEach(async () => {
    await Promise.all(clients.map((client) => client.$disconnect()));
    await cleanupDatabase();
  });

  it("allows exactly one identical authorization-code exchange to issue credentials", async () => {
    const code = await createAuthorizationCode(clients[0], {
      clientId: CLIENT_ID,
      userId,
      redirectUri: REDIRECT_URI,
      codeChallenge: await challengeFor(VERIFIER),
      scope: "kitchen:read",
      resource: "https://spoonjoy.app/mcp",
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
          persistentMcpResource: "https://spoonjoy.app/mcp",
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

    if (!winner || winner.status !== "fulfilled") throw new Error("expected one code-exchange winner");
    const accessHash = await hashApiToken(winner.value.accessToken);
    const refreshHash = await hashOAuthOpaqueToken(winner.value.refreshToken);
    const codeRows = await clients[0].oAuthAuthCode.findMany({ where: { userId } });
    const accessRows = await clients[0].apiCredential.findMany({ where: { userId } });
    const refreshRows = await clients[0].oAuthRefreshToken.findMany({ where: { userId } });

    expect(codeRows.map((row) => row.codeHash)).toEqual([codeHash]);
    expect(codeRows[0]).toMatchObject({
      userId,
      clientId: CLIENT_ID,
      issuer: ISSUER,
      redirectUri: REDIRECT_URI,
      scope: "kitchen:read",
      resource: "https://spoonjoy.app/mcp",
      consumedAt: NOW,
      expiresAt: new Date("2026-08-29T18:01:00.000Z"),
    });
    expect(accessRows).toHaveLength(1);
    expect(accessRows[0]).toMatchObject({
      tokenHash: accessHash,
      userId,
      scopes: "kitchen:read",
      oauthClientId: CLIENT_ID,
      oauthIssuer: ISSUER,
      oauthResource: "https://spoonjoy.app/mcp",
      oauthConnectionKey: refreshRows[0]?.connectionKey,
      revokedAt: null,
      expiresAt: null,
    });
    expect(refreshRows).toHaveLength(1);
    expect(refreshRows[0]).toMatchObject({
      tokenHash: refreshHash,
      userId,
      clientId: CLIENT_ID,
      issuer: ISSUER,
      scope: "kitchen:read",
      resource: "https://spoonjoy.app/mcp",
      connectionKey: accessRows[0]?.oauthConnectionKey,
      revokedAt: null,
    });
  });

  it.each(CONTENDERS)(
    "leaves the child family active when %s wins an indistinguishable public-bearer race",
    async (designatedWinner) => {
      const original = await issueConnectorTokens(clients[0], {
        userId,
        clientId: CLIENT_ID,
        scope: "kitchen:read",
        resource: "https://spoonjoy.app/mcp",
        persistentMcpResource: "https://spoonjoy.app/mcp",
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

      if (!winner || winner.status !== "fulfilled") throw new Error("expected one refresh winner");
      const childRefreshHash = await hashOAuthOpaqueToken(winner.value.refreshToken);
      const childAccessHash = await hashApiToken(winner.value.accessToken);
      const refreshRows = await clients[0].oAuthRefreshToken.findMany({ where: { userId } });
      const accessRows = await clients[0].apiCredential.findMany({ where: { userId } });
      expect(refreshRows.map((row) => row.tokenHash).sort())
        .toEqual([parent.tokenHash, childRefreshHash].sort());
      expect(accessRows.map((row) => row.tokenHash).sort())
        .toEqual([originalAccessHash, childAccessHash].sort());

      const persistedParent = refreshRows.find((row) => row.tokenHash === parent.tokenHash);
      const child = refreshRows.find((row) => row.tokenHash === childRefreshHash);
      const originalAccess = accessRows.find((row) => row.tokenHash === originalAccessHash);
      const childAccess = accessRows.find((row) => row.tokenHash === childAccessHash);
      expect(persistedParent).toMatchObject({
        userId,
        clientId: CLIENT_ID,
        issuer: ISSUER,
        scope: "kitchen:read",
        resource: "https://spoonjoy.app/mcp",
        connectionKey: parent.connectionKey,
        revokedAt: NOW,
      });
      expect(child).toMatchObject({
        userId,
        clientId: CLIENT_ID,
        issuer: ISSUER,
        scope: "kitchen:read",
        resource: "https://spoonjoy.app/mcp",
        connectionKey: parent.connectionKey,
        revokedAt: null,
      });
      expect(originalAccess).toMatchObject({
        userId,
        scopes: "kitchen:read",
        oauthClientId: CLIENT_ID,
        oauthIssuer: ISSUER,
        oauthResource: "https://spoonjoy.app/mcp",
        oauthConnectionKey: parent.connectionKey,
        revokedAt: null,
        expiresAt: null,
      });
      expect(childAccess).toMatchObject({
        userId,
        scopes: "kitchen:read",
        oauthClientId: CLIENT_ID,
        oauthIssuer: ISSUER,
        oauthResource: "https://spoonjoy.app/mcp",
        oauthConnectionKey: parent.connectionKey,
        revokedAt: null,
        expiresAt: new Date("2026-08-29T18:15:00.000Z"),
      });
    },
  );
});
