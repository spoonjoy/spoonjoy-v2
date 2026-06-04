import type { AgentConnectionRequest, PrismaClient as PrismaClientType } from "@prisma/client";
import { ApiAuthError, createApiCredential, hashApiToken } from "~/lib/api-auth.server";
import { normalizeScope, OAuthError } from "~/lib/oauth-server.server";

type Database = PrismaClientType;

const DEFAULT_AGENT_NAME = "Ouroboros agent";
const DEFAULT_BASE_URL = "https://spoonjoy.app";
const DEFAULT_TTL_MINUTES = 10;
const DEFAULT_SCOPES = "shopping_list:read shopping_list:write";
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type AgentConnectionPublicStatus = "pending" | "approved" | "denied" | "expired" | "claimed";

export interface StartedAgentConnection {
  request: AgentConnectionRequest;
  deviceCode: string;
  authorizationUrl: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface PolledAgentConnection {
  status: AgentConnectionPublicStatus;
  expiresAt: string;
  authorizationUrl?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  userCode?: string;
  token?: string;
  credential?: {
    id: string;
    name: string;
    tokenPrefix: string;
    scopes: string[];
    createdAt: string;
    expiresAt: string | null;
  };
  storage?: {
    vaultItem: string;
    username: string;
    passwordField: string;
    env: string;
  };
  message: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function generateDeviceCode(): string {
  return `sjdc_${bytesToBase64Url(randomBytes(32))}`;
}

function generateUserCode(): string {
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

function normalizeAgentName(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_AGENT_NAME;
  return trimmed.slice(0, 80);
}

function normalizeDelegatedScopes(value: string | undefined): string {
  if (value === undefined || value.trim() === "") return DEFAULT_SCOPES;
  try {
    return normalizeScope(value);
  } catch (error) {
    if (error instanceof OAuthError) {
      throw new ApiAuthError(error.message, error.status);
    }
    throw error;
  }
}

function normalizeBaseUrl(value: string | undefined): string {
  const url = new URL(value?.trim() || DEFAULT_BASE_URL);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new ApiAuthError("baseUrl must be https or localhost", 400);
  }
  return url.origin;
}

function connectionUrl(baseUrl: string, id: string, userCode: string): string {
  const url = new URL(`/agent/connect/${encodeURIComponent(id)}`, baseUrl);
  url.searchParams.set("code", userCode);
  return url.toString();
}

function verificationUrl(baseUrl: string): string {
  return new URL("/agent/connect", baseUrl).toString();
}

function secondsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
}

function isExpired(request: Pick<AgentConnectionRequest, "expiresAt">, now: Date): boolean {
  return request.expiresAt.getTime() <= now.getTime();
}

async function expirePendingRequest(
  db: Database,
  request: AgentConnectionRequest,
  now: Date,
): Promise<AgentConnectionRequest> {
  if (request.status !== "pending" || !isExpired(request, now)) return request;
  return db.agentConnectionRequest.update({
    where: { id: request.id },
    data: { status: "expired" },
  });
}

function publicStatus(request: AgentConnectionRequest, now: Date): AgentConnectionPublicStatus {
  switch (request.status) {
    case "pending":
    case "approved":
    case "denied":
    case "expired":
    case "claimed":
      return request.status;
    default:
      return "expired";
  }
}

export async function startAgentConnection(
  db: Database,
  input: {
    agentName?: string;
    baseUrl?: string;
    scopes?: string;
    now?: Date;
    ttlMinutes?: number;
  } = {},
): Promise<StartedAgentConnection> {
  const now = input.now ?? new Date();
  const ttlMinutes = input.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);
  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const request = await db.agentConnectionRequest.create({
    data: {
      deviceCodeHash: await hashApiToken(deviceCode),
      userCode,
      agentName: normalizeAgentName(input.agentName),
      scopes: normalizeDelegatedScopes(input.scopes),
      expiresAt,
    },
  });

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const authorizationUrl = connectionUrl(baseUrl, request.id, userCode);
  return {
    request,
    deviceCode,
    authorizationUrl,
    verificationUri: verificationUrl(baseUrl),
    verificationUriComplete: authorizationUrl,
    expiresIn: secondsBetween(now, expiresAt),
    interval: 2,
  };
}

export async function getAgentConnectionRequest(
  db: Database,
  id: string,
  now: Date = new Date(),
): Promise<AgentConnectionRequest | null> {
  const request = await db.agentConnectionRequest.findUnique({ where: { id } });
  return request ? expirePendingRequest(db, request, now) : null;
}

export async function approveAgentConnectionRequest(
  db: Database,
  id: string,
  userId: string,
  now: Date = new Date(),
): Promise<AgentConnectionRequest> {
  const request = await getAgentConnectionRequest(db, id, now);
  if (!request) throw new ApiAuthError("Connection request not found", 404);
  if (publicStatus(request, now) !== "pending") return request;

  return db.agentConnectionRequest.update({
    where: { id },
    data: {
      status: "approved",
      approvedById: userId,
      approvedAt: now,
    },
  });
}

export async function denyAgentConnectionRequest(
  db: Database,
  id: string,
  now: Date = new Date(),
): Promise<AgentConnectionRequest> {
  const request = await getAgentConnectionRequest(db, id, now);
  if (!request) throw new ApiAuthError("Connection request not found", 404);
  if (publicStatus(request, now) !== "pending") return request;

  return db.agentConnectionRequest.update({
    where: { id },
    data: {
      status: "denied",
      deniedAt: now,
    },
  });
}

export async function pollAgentConnection(
  db: Database,
  input: {
    deviceCode: string;
    baseUrl?: string;
    tokenName?: string;
    now?: Date;
  },
): Promise<PolledAgentConnection> {
  const now = input.now ?? new Date();
  const deviceCode = input.deviceCode.trim();
  if (!deviceCode) throw new ApiAuthError("deviceCode is required", 400);

  const request = await db.agentConnectionRequest.findUnique({
    where: { deviceCodeHash: await hashApiToken(deviceCode) },
  });
  if (!request) throw new ApiAuthError("Invalid connection request", 400);

  const current = await expirePendingRequest(db, request, now);
  const status = publicStatus(current, now);
  const expiresAt = current.expiresAt.toISOString();

  if (status === "pending") {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const authorizationUrl = connectionUrl(baseUrl, current.id, current.userCode);
    return {
      status,
      expiresAt,
      authorizationUrl,
      verificationUri: verificationUrl(baseUrl),
      verificationUriComplete: authorizationUrl,
      userCode: current.userCode,
      message: "Waiting for the user to approve this Spoonjoy connection.",
    };
  }

  if (status === "approved") {
    if (!current.approvedById) throw new ApiAuthError("Approved connection is missing a user", 400);
    const created = await createApiCredential(
      db,
      current.approvedById,
      input.tokenName?.trim() || `${current.agentName} delegated token`,
      { scopes: current.scopes },
    );
    const claimed = await db.agentConnectionRequest.updateMany({
      where: { id: current.id, status: "approved", claimedAt: null },
      data: {
        status: "claimed",
        credentialId: created.credential.id,
        claimedAt: now,
      },
    });
    if (claimed.count !== 1) {
      await db.apiCredential.update({
        where: { id: created.credential.id },
        data: { revokedAt: now },
      });
      return {
        status: "claimed",
        expiresAt,
        message: "This Spoonjoy connection was already claimed.",
      };
    }

    return {
      status: "approved",
      expiresAt,
      token: created.token,
      credential: {
        id: created.credential.id,
        name: created.credential.name,
        tokenPrefix: created.credential.tokenPrefix,
        scopes: created.credential.scopes.trim().split(/\s+/).filter(Boolean),
        createdAt: created.credential.createdAt.toISOString(),
        expiresAt: created.credential.expiresAt?.toISOString() ?? null,
      },
      storage: {
        vaultItem: "spoonjoy.app",
        username: "api-token",
        passwordField: "password",
        env: "SPOONJOY_MCP_API_TOKEN=vault:spoonjoy.app/password",
      },
      message: "Connection approved. The Spoonjoy MCP bridge should cache this token locally and use it for future Spoonjoy MCP calls.",
    };
  }

  return {
    status,
    expiresAt,
    message: status === "denied"
      ? "The user denied this Spoonjoy connection."
      : status === "claimed"
        ? "This Spoonjoy connection was already claimed."
        : "This Spoonjoy connection expired. Start a new connection request.",
  };
}
