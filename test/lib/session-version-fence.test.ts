import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { authenticateApiToken, createApiCredential, createApiCredentialForPrincipal } from "~/lib/api-auth.server";
import { callSpoonjoyMcpTool } from "~/lib/mcp/spoonjoy-tools.server";
import { action as apiV1Action } from "~/routes/api.v1.$";
import { Request as UndiciRequest } from "undici";
import { revokeAllAccountAccess } from "~/lib/account-revocation.server";
import { approveAgentConnectionRequest, pollAgentConnection, startAgentConnection } from "~/lib/agent-connection.server";
import { handleNativePasswordSignIn } from "~/lib/native-password-auth.server";
import {
  consumeAuthorizationCode,
  createAuthorizationCode,
  issueConnectorTokens,
  OAuthError,
  registerOAuthClient,
  requireSessionVersionFence,
  rotateConnectorTokens,
} from "~/lib/oauth-server.server";
import { readSessionVersion, sessionVersionUnchanged } from "~/lib/session-version-fence.server";
import { cleanupDatabase } from "../helpers/cleanup";

const ISSUER = "https://spoonjoy.app";
const REDIRECT = "https://agent.example/cb";
const VERIFIER = "verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
const PASSWORD = "correctHorseBatteryStaple";

async function challengeFor(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Db = Awaited<ReturnType<typeof getLocalDb>>;

/** The database with the first `model.method` call running `before` first: a write that lands just ahead of it. */
function racing(db: Db, model: string, method: string, before: () => Promise<unknown>): Db {
  let fired = false;
  return new Proxy(db, {
    get(target, prop) {
      const delegate = Reflect.get(target, prop);
      if (prop !== model) return delegate;
      return new Proxy(delegate, {
        get(inner, innerProp) {
          const fn = Reflect.get(inner, innerProp);
          return innerProp === method
            ? async (...args: unknown[]) => {
              if (!fired) {
                fired = true;
                await before();
              }
              return fn.apply(inner, args);
            }
            : fn;
        },
      });
    },
  });
}

describe("session-version fence", () => {
  let db: Db;
  let userId: string;
  let clientId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    userId = (await createUser(db, faker.internet.email(), `fence_${faker.string.alphanumeric(8)}`, PASSWORD)).id;
    clientId = (await registerOAuthClient(db, { clientName: "Some agent", redirectUris: [REDIRECT], issuer: ISSUER })).clientId;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  const signOutEverywhere = () => revokeAllAccountAccess(db, userId);

  /** Nothing the race could have handed out still works. */
  async function expectNothingLive() {
    expect(await db.oAuthGrant.count({ where: { userId, status: "active" } })).toBe(0);
    expect(await db.oAuthRefreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
    const credentials = await db.apiCredential.findMany({ where: { userId }, select: { id: true } });
    expect(credentials).toEqual([]);
  }

  async function mintCode() {
    return createAuthorizationCode(db, {
      clientId, userId, redirectUri: REDIRECT, issuer: ISSUER, scope: "kitchen:read",
      codeChallenge: await challengeFor(VERIFIER),
    });
  }

  function exchange(code: string, onBurn?: (timing: "before" | "after") => Promise<void>) {
    return consumeAuthorizationCode(
      db,
      { code, clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER, issuer: ISSUER },
      { onPersistenceMutation: async (stage, timing) => { if (stage === "code_consumption") await onBurn?.(timing); } },
    );
  }

  describe("authorization code exchange", () => {
    it("refuses the grant when sign out everywhere lands after the code is burned", async () => {
      const consumed = await exchange(await mintCode(), async (timing) => {
        if (timing === "after") await signOutEverywhere();
      });

      const error = await issueConnectorTokens(db, { userId, clientId, scope: consumed.scope, issuer: ISSUER, sessionVersion: consumed.sessionVersion })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(OAuthError);
      expect(error).toMatchObject({ code: "invalid_grant", reason: "revoked_by_user" });
      await expectNothingLive();
      // The refused grant is recorded as revoked by the account-wide security event.
      await expect(db.oAuthGrant.findFirstOrThrow({ where: { userId } }))
        .resolves.toMatchObject({ status: "revoked", statusReason: "security_event" });
    });

    it("refuses the grant when sign out everywhere lands between the grant insert and the check", async () => {
      const consumed = await exchange(await mintCode());

      await expect(issueConnectorTokens(db, { userId, clientId, scope: consumed.scope, issuer: ISSUER, sessionVersion: consumed.sessionVersion }, {
        onPersistenceMutation: async (stage, timing) => {
          if (stage === "grant_insert" && timing === "after") await signOutEverywhere();
        },
      })).rejects.toMatchObject({ code: "invalid_grant", reason: "revoked_by_user" });
      await expectNothingLive();
    });

    it("leaves nothing usable when sign out everywhere lands after the grant passed the fence", async () => {
      const consumed = await exchange(await mintCode());

      const tokens = await issueConnectorTokens(db, { userId, clientId, scope: consumed.scope, issuer: ISSUER, sessionVersion: consumed.sessionVersion }, {
        onPersistenceMutation: async (stage, timing) => {
          if (stage === "access_insert" && timing === "before") await signOutEverywhere();
        },
      });

      // The sweep found the grant, so the tokens inserted after it are dead on arrival.
      expect(await db.oAuthGrant.count({ where: { userId, status: "active" } })).toBe(0);
      await expect(authenticateApiToken(db, tokens.accessToken, ISSUER)).rejects.toMatchObject({ status: 401 });
      await expect(rotateConnectorTokens(db, { refreshToken: tokens.refreshToken, clientId, issuer: ISSUER }))
        .rejects.toMatchObject({ code: "invalid_grant" });
    });

    it("cannot burn a code that sign out everywhere already spent", async () => {
      await expect(exchange(await mintCode(), async (timing) => {
        if (timing === "before") await signOutEverywhere();
      })).rejects.toMatchObject({ code: "invalid_grant", message: "Authorization code already used" });
      await expectNothingLive();
    });
  });

  describe("iPhone password sign-in", () => {
    it("refuses a sign-in whose password was changed before its grant existed", async () => {
      // The password check passed with the old password; the change lands before the grant insert.
      const changePassword = () => revokeAllAccountAccess(db, userId, { password: { hashedPassword: "new-hash", salt: "new-salt" } });

      const error = await handleNativePasswordSignIn(
        racing(db, "oAuthGrant", "create", changePassword),
        { emailOrUsername: (await db.user.findUniqueOrThrow({ where: { id: userId } })).email, password: PASSWORD },
        { issuer: ISSUER },
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(OAuthError);
      expect(error).toMatchObject({ code: "invalid_grant", reason: "revoked_by_user" });
      await expectNothingLive();
    });

  });

  describe("refresh of a token from before grants existed", () => {
    it("refuses the new grant when sign out everywhere lands after the parent is revoked", async () => {
      const legacy = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read", issuer: ISSUER, sessionVersion: 0 });
      await db.oAuthRefreshToken.updateMany({ where: { userId }, data: { grantId: null } });
      await db.apiCredential.updateMany({ where: { userId }, data: { oauthGrantId: null } });
      await db.oAuthGrant.deleteMany({ where: { userId } });

      await expect(rotateConnectorTokens(db, { refreshToken: legacy.refreshToken, clientId, issuer: ISSUER }, {
        onPersistenceMutation: async (stage, timing) => {
          if (stage === "parent_revoke" && timing === "after") await signOutEverywhere();
        },
      })).rejects.toMatchObject({ code: "invalid_grant", reason: "revoked_by_user" });

      expect(await db.oAuthGrant.count({ where: { userId, status: "active" } })).toBe(0);
      expect(await db.oAuthRefreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
    });

    it("refuses a flow for an account that no longer exists", async () => {
      await expect(requireSessionVersionFence(db, "no-such-user"))
        .rejects.toMatchObject({ code: "invalid_grant", message: "Unknown account" });
    });
  });

  describe("agent connection approval", () => {
    it("turns an approval into a denial when sign out everywhere lands while it is written", async () => {
      const started = await startAgentConnection(db, { agentName: "Ouro agent", scopes: "kitchen:read" });

      // The approving request's session (version 0) was checked; the sign-out lands just before
      // the approval is written, when the request is still pending and so not swept.
      const result = await approveAgentConnectionRequest(
        racing(db, "agentConnectionRequest", "updateMany", signOutEverywhere),
        started.request.id,
        { userId, sessionVersion: 0 },
      );

      expect(result.status).toBe("denied");
      const polled = await pollAgentConnection(db, { deviceCode: started.deviceCode });
      expect(polled.status).toBe("denied");
      expect(polled).not.toHaveProperty("token");
      await expect(db.apiCredential.count({ where: { userId } })).resolves.toBe(0);
    });
  });

  describe("agent connection approval, with a poll in between", () => {
    it("revokes the token a poll collected between the approval and the fence check", async () => {
      const started = await startAgentConnection(db, { agentName: "Ouro agent", scopes: "kitchen:read" });
      let collected: Awaited<ReturnType<typeof pollAgentConnection>> | null = null;
      // Sign out everywhere runs while the request is still pending, so its sweep has nothing to
      // deny. The approval is then written, and the agent's poll collects a token before the
      // fence reads the version.
      let afterApproval = false;
      const raced = new Proxy(racing(db, "agentConnectionRequest", "updateMany", signOutEverywhere), {
        get(target, prop) {
          const delegate = Reflect.get(target, prop);
          if (prop !== "user") return delegate;
          return new Proxy(delegate, {
            get(inner, innerProp) {
              const fn = Reflect.get(inner, innerProp);
              return innerProp === "findUnique"
                ? async (...args: unknown[]) => {
                  if (!afterApproval) {
                    afterApproval = true;
                    collected = await pollAgentConnection(db, { deviceCode: started.deviceCode });
                  }
                  return fn.apply(inner, args);
                }
                : fn;
            },
          });
        },
      });

      const result = await approveAgentConnectionRequest(raced, started.request.id, { userId, sessionVersion: 0 });

      expect(collected).toMatchObject({ status: "approved", token: expect.stringMatching(/^sj_/) });
      expect(result.status).toBe("claimed");
      await expect(authenticateApiToken(db, collected!.token!, ISSUER)).rejects.toMatchObject({ status: 401 });
    });

    it("does not deny a request someone else already settled", async () => {
      const started = await startAgentConnection(db, { agentName: "Ouro agent", scopes: "kitchen:read" });
      // The chef denies it in another tab while this approval is in flight.
      const result = await approveAgentConnectionRequest(
        racing(db, "agentConnectionRequest", "updateMany", () => db.agentConnectionRequest.update({
          where: { id: started.request.id }, data: { status: "denied", deniedAt: new Date() },
        })),
        started.request.id,
        { userId, sessionVersion: 0 },
      );
      expect(result.status).toBe("denied");
      expect(result.approvedById).toBeNull();
    });
  });

  describe("personal API token creation", () => {
    it("revokes a token whose creation sign out everywhere interrupts, and refuses the request", async () => {
      const raced = racing(db, "apiCredential", "create", signOutEverywhere);

      await expect(createApiCredentialForPrincipal(raced, { id: userId, sessionVersion: 0 }, "Laptop script"))
        .rejects.toMatchObject({ status: 401 });
      expect(await db.apiCredential.count({ where: { userId, revokedAt: null } })).toBe(0);
    });

    it("does not fence an environment-configured owner", async () => {
      await signOutEverywhere();
      const created = await createApiCredentialForPrincipal(db, { id: userId }, "Local script");
      expect(created.credential.revokedAt).toBeNull();
    });

    it("refuses a token created through the API by a bearer token the sign-out revoked mid-request", async () => {
      const writer = await createApiCredential(db, userId, "Token writer", { scopes: ["tokens:write"] });
      const create = db.apiCredential.create.bind(db.apiCredential);
      let first = true;
      const spy = (await import("vitest")).vi.spyOn(db.apiCredential, "create").mockImplementation((async (args: any) => {
        if (first) {
          first = false;
          await signOutEverywhere();
        }
        return create(args);
      }) as any);
      try {
        const response = await apiV1Action({
          request: new UndiciRequest("http://localhost/api/v1/tokens", {
            method: "POST",
            headers: { Authorization: `Bearer ${writer.token}`, "Content-Type": "application/json", "X-Request-Id": "req_fence_token" },
            body: JSON.stringify({ name: "Survivor" }),
          }) as unknown as Request,
          params: { "*": "tokens" },
          context: { cloudflare: { env: null } },
        } as any);
        expect(response.status).toBe(401);
        expect((await response.json() as any).error).toMatchObject({ code: "authentication_required" });
      } finally {
        spy.mockRestore();
      }
      expect(await db.apiCredential.count({ where: { userId, revokedAt: null } })).toBe(0);
    });

    it("refuses a token created through MCP by a caller the sign-out revoked mid-request", async () => {
      const writer = await createApiCredential(db, userId, "Token writer", { scopes: ["tokens:write"] });
      const principal = await authenticateApiToken(db, writer.token, ISSUER);
      expect(principal.sessionVersion).toBe(0);

      await expect(callSpoonjoyMcpTool("create_api_token", { name: "Survivor" }, {
        db: racing(db, "apiCredential", "create", signOutEverywhere),
        principal,
      })).rejects.toMatchObject({ status: 401 });
      expect(await db.apiCredential.count({ where: { userId, revokedAt: null } })).toBe(0);
    });
  });

  describe("helpers", () => {
    it("reads the version, and treats a missing account as moved", async () => {
      await expect(readSessionVersion(db, userId)).resolves.toBe(0);
      await expect(sessionVersionUnchanged(db, userId, 0)).resolves.toBe(true);
      await signOutEverywhere();
      await expect(sessionVersionUnchanged(db, userId, 0)).resolves.toBe(false);
      await expect(readSessionVersion(db, "no-such-user")).resolves.toBeNull();
      await expect(sessionVersionUnchanged(db, "no-such-user", 0)).resolves.toBe(false);
    });
  });
});
