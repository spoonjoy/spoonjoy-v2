import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import {
  approveAgentConnectionRequest,
  denyAgentConnectionRequest,
  getAgentConnectionRequest,
  pollAgentConnection,
  startAgentConnection,
} from "~/lib/agent-connection.server";
import { authenticateApiToken, hashApiToken } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";

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
    expect(started.expiresIn).toBe(300);
    expect(started.interval).toBe(2);
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
      "cookbooks:read",
      "public:read",
      "recipes:read",
      "shopping_list:read",
      "shopping_list:write",
      "tokens:read",
      "tokens:write",
    ]);
    await expect(db.apiCredential.findUniqueOrThrow({
      where: { id: (tokenResult.credential as { id: string }).id },
    })).resolves.toMatchObject({ scopes: "kitchen:read kitchen:write" });

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
