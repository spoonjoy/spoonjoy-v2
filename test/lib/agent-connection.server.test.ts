import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import {
  approveAgentConnectionRequest,
  denyAgentConnectionRequest,
  getAgentConnectionRequest,
  pollAgentConnection,
  postHogClaimRaceCapture,
  startAgentConnection,
} from "~/lib/agent-connection.server";
import { authenticateApiToken, hashApiToken } from "~/lib/api-auth.server";
import type { PostHogServerConfig } from "~/lib/analytics-server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";

const ENABLED_POSTHOG: PostHogServerConfig = {
  enabled: true,
  key: "phc_test",
  host: "https://ph.example.com",
};

const DISABLED_POSTHOG: PostHogServerConfig = {
  enabled: false,
  reason: "missing-key",
};

function uniqueEmail(prefix = "agent-connect") {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

describe("agent connection requests", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  const now = new Date("2026-05-26T12:00:00.000Z");

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("starts a short-lived browser approval request without storing the raw device code", async () => {
    const started = await startAgentConnection(db, {
      agentName: "  slugger  ",
      baseUrl: "http://localhost:5173/some/path",
      now,
      ttlMinutes: 5,
    });

    expect(started.deviceCode).toMatch(/^sjdc_/);
    expect(started.request.agentName).toBe("slugger");
    expect(started.request.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(started.request.deviceCodeHash).toBe(await hashApiToken(started.deviceCode));
    expect(started.request.deviceCodeHash).not.toBe(started.deviceCode);
    expect(started.authorizationUrl).toBe(
      `http://localhost:5173/agent/connect/${started.request.id}?code=${started.request.userCode}`,
    );
    expect(started.verificationUri).toBe("http://localhost:5173/agent/connect");
    expect(started.verificationUriComplete).toBe(started.authorizationUrl);
    expect(started.expiresIn).toBe(300);
    expect(started.interval).toBe(2);

    const leastPrivilege = await startAgentConnection(db, {
      agentName: "tiny sync",
      scopes: "shopping_list:read shopping_list:write",
      now,
    });
    expect(leastPrivilege.request.scopes).toBe("shopping_list:read shopping_list:write");
    await expect(startAgentConnection(db, {
      scopes: "tokens:write",
      now,
    })).rejects.toThrow("Unsupported scope");
  });

  it("rethrows unexpected delegated scope normalization failures", async () => {
    let trimCalls = 0;
    const scopeValue = {
      trim() {
        trimCalls += 1;
        if (trimCalls === 2) {
          throw new TypeError("scope parser exploded");
        }
        return "shopping_list:read";
      },
    };

    try {
      await startAgentConnection({
        agentConnectionRequest: {
          create: vi.fn(),
        },
      } as any, {
        scopes: scopeValue as unknown as string,
        now,
      });
      expect.fail("expected scope normalization failure");
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toBe("scope parser exploded");
    }
  });

  it("defaults agent name and base URL, and rejects unsafe non-local base URLs", async () => {
    const implicitStarted = await startAgentConnection(db);
    expect(implicitStarted.authorizationUrl).toContain("https://spoonjoy.app/agent/connect/");

    const started = await startAgentConnection(db, { agentName: "   ", now });
    expect(started.request.agentName).toBe("Ouroboros agent");
    expect(started.authorizationUrl).toContain("https://spoonjoy.app/agent/connect/");

    await expect(startAgentConnection(db, {
      baseUrl: "http://evil.example",
      now,
    })).rejects.toThrow("baseUrl must be https or localhost");
  });

  it("polls pending, expired, denied, claimed, and invalid requests", async () => {
    const started = await startAgentConnection(db, { baseUrl: "https://spoonjoy.app", now });

    await expect(pollAgentConnection(db, { deviceCode: "   ", now }))
      .rejects.toThrow("deviceCode is required");
    await expect(pollAgentConnection(db, { deviceCode: "sjdc_missing", now }))
      .rejects.toThrow("Invalid connection request");

    const pending = await pollAgentConnection(db, {
      deviceCode: started.deviceCode,
      baseUrl: "https://spoonjoy.app",
      now,
    });
    expect(pending).toMatchObject({
      status: "pending",
      authorizationUrl: started.authorizationUrl,
      userCode: started.request.userCode,
      message: expect.stringContaining("Waiting"),
    });

    const deniedRequest = await startAgentConnection(db, { now });
    await denyAgentConnectionRequest(db, deniedRequest.request.id, now);
    await expect(denyAgentConnectionRequest(db, "missing", now)).rejects.toThrow("not found");
    await expect(pollAgentConnection(db, { deviceCode: deniedRequest.deviceCode, now }))
      .resolves.toMatchObject({ status: "denied", message: expect.stringContaining("denied") });

    const expiredRequest = await startAgentConnection(db, { now, ttlMinutes: 1 });
    await expect(pollAgentConnection(db, {
      deviceCode: expiredRequest.deviceCode,
      now: new Date(now.getTime() + 60_001),
    })).resolves.toMatchObject({ status: "expired", message: expect.stringContaining("expired") });

    const claimedRequest = await startAgentConnection(db, { now });
    await db.agentConnectionRequest.update({
      where: { id: claimedRequest.request.id },
      data: { status: "claimed", claimedAt: now },
    });
    await expect(pollAgentConnection(db, { deviceCode: claimedRequest.deviceCode, now }))
      .resolves.toMatchObject({ status: "claimed", message: expect.stringContaining("already claimed") });
  });

  it("approves once, returns a token once, and authenticates the approved user", async () => {
    const user = await db.user.create({
      data: { email: uniqueEmail(), username: faker.internet.username() },
    });
    const started = await startAgentConnection(db, { agentName: "slugger", now });

    expect(await getAgentConnectionRequest(db, "missing", now)).toBeNull();
    const approved = await approveAgentConnectionRequest(db, started.request.id, user.id, now);
    expect(approved.status).toBe("approved");
    await expect(approveAgentConnectionRequest(db, "missing", user.id, now)).rejects.toThrow("not found");

    const tokenResult = await pollAgentConnection(db, {
      deviceCode: started.deviceCode,
      tokenName: "Slugger Spoonjoy",
      now,
    });
    expect(tokenResult).toMatchObject({
      status: "approved",
      token: expect.stringMatching(/^sj_/),
      credential: { name: "Slugger Spoonjoy" },
      storage: {
        vaultItem: "spoonjoy.app",
        env: "SPOONJOY_MCP_API_TOKEN=vault:spoonjoy.app/password",
      },
    });
    const principal = await authenticateApiToken(db, tokenResult.token as string);
    expect(principal.email).toBe(user.email);
    expect(principal.scopes).toEqual([
      "shopping_list:read",
      "shopping_list:write",
    ]);
    await expect(db.apiCredential.findUniqueOrThrow({
      where: { id: (tokenResult.credential as { id: string }).id },
    })).resolves.toMatchObject({ scopes: "shopping_list:read shopping_list:write" });

    await expect(pollAgentConnection(db, {
      deviceCode: started.deviceCode,
      now,
    })).resolves.toMatchObject({ status: "claimed" });
  });

  it("revokes a token created during a lost claim race", async () => {
    const user = await db.user.create({
      data: { email: uniqueEmail("race"), username: faker.internet.username() },
    });
    const started = await startAgentConnection(db, { now });
    await db.agentConnectionRequest.update({
      where: { id: started.request.id },
      data: {
        status: "approved",
        approvedById: user.id,
        approvedAt: now,
        claimedAt: now,
      },
    });

    const result = await pollAgentConnection(db, { deviceCode: started.deviceCode, now });
    expect(result).toMatchObject({ status: "claimed" });
    const credentials = await db.apiCredential.findMany({ where: { userId: user.id } });
    expect(credentials).toHaveLength(1);
    expect(credentials[0].revokedAt).toEqual(now);
  });

  it("emits the claim-race capture hook with the orphaned credential id (L9)", async () => {
    const user = await db.user.create({
      data: { email: uniqueEmail("race-cap"), username: faker.internet.username() },
    });
    const started = await startAgentConnection(db, { now });
    await db.agentConnectionRequest.update({
      where: { id: started.request.id },
      data: {
        status: "approved",
        approvedById: user.id,
        approvedAt: now,
        claimedAt: now,
      },
    });

    const races: Array<{ requestId: string; userId: string; credentialId: string }> = [];
    const result = await pollAgentConnection(
      db,
      { deviceCode: started.deviceCode, now },
      { capture: (race) => races.push(race) },
    );

    expect(result).toMatchObject({ status: "claimed" });
    expect(races).toHaveLength(1);
    expect(races[0]).toMatchObject({
      requestId: started.request.id,
      userId: user.id,
    });
    const credentials = await db.apiCredential.findMany({ where: { userId: user.id } });
    expect(credentials).toHaveLength(1);
    // The reported credential is the orphaned, now-revoked one.
    expect(races[0].credentialId).toBe(credentials[0].id);
    expect(credentials[0].revokedAt).toEqual(now);
  });

  it("does not call the capture hook on a clean (un-raced) claim (L9)", async () => {
    const user = await db.user.create({
      data: { email: uniqueEmail("clean"), username: faker.internet.username() },
    });
    const started = await startAgentConnection(db, { now });
    await approveAgentConnectionRequest(db, started.request.id, user.id, now);

    const capture = vi.fn();
    const result = await pollAgentConnection(
      db,
      { deviceCode: started.deviceCode, now },
      { capture },
    );

    expect(result).toMatchObject({ status: "approved", token: expect.stringMatching(/^sj_/) });
    expect(capture).not.toHaveBeenCalled();
  });

  it("does not approve unusable or already-finished requests", async () => {
    const user = await db.user.create({
      data: { email: uniqueEmail("done"), username: faker.internet.username() },
    });
    const denied = await startAgentConnection(db, { now });
    await denyAgentConnectionRequest(db, denied.request.id, now);
    await expect(approveAgentConnectionRequest(db, denied.request.id, user.id, now))
      .resolves.toMatchObject({ status: "denied" });
    await expect(denyAgentConnectionRequest(db, denied.request.id, now))
      .resolves.toMatchObject({ status: "denied" });

    const approvedWithoutUser = await startAgentConnection(db, { now });
    await db.agentConnectionRequest.update({
      where: { id: approvedWithoutUser.request.id },
      data: { status: "approved" },
    });
    await expect(pollAgentConnection(db, { deviceCode: approvedWithoutUser.deviceCode, now }))
      .rejects.toThrow("missing a user");

    const unknown = await startAgentConnection(db, { now });
    await db.agentConnectionRequest.update({
      where: { id: unknown.request.id },
      data: { status: "surprise" },
    });
    await expect(pollAgentConnection(db, { deviceCode: unknown.deviceCode, now }))
      .resolves.toMatchObject({ status: "expired" });
  });
});

describe("postHogClaimRaceCapture (L9)", () => {
  const race = {
    requestId: "req_1",
    userId: "user_1",
    credentialId: "cred_1",
  };

  it("emits spoonjoy.agent_connection.claim_race with safe properties", async () => {
    const bodies: unknown[] = [];
    const scheduled: Array<Promise<unknown>> = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("ok");
    }) as unknown as typeof fetch;

    const capture = postHogClaimRaceCapture(
      ENABLED_POSTHOG,
      (task) => scheduled.push(task),
      fetchImpl,
    );
    capture(race);

    expect(scheduled).toHaveLength(1);
    await Promise.all(scheduled);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(bodies[0]).toMatchObject({
      event: "spoonjoy.agent_connection.claim_race",
      distinct_id: "user_1",
      properties: {
        feature: "agent_connection",
        requestId: "req_1",
        credentialId: "cred_1",
        outcome: "revoked_duplicate_credential",
      },
    });
  });

  it("schedules a no-op (no fetch) when PostHog is disabled", async () => {
    const scheduled: Array<Promise<unknown>> = [];
    const fetchImpl = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;

    const capture = postHogClaimRaceCapture(
      DISABLED_POSTHOG,
      (task) => scheduled.push(task),
      fetchImpl,
    );
    capture(race);

    await Promise.all(scheduled);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
