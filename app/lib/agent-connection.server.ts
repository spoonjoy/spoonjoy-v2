import type { AgentConnectionRequest, PrismaClient as PrismaClientType } from "@prisma/client";
import { ApiAuthError, createApiCredential, hashApiToken } from "~/lib/api-auth.server";
import { normalizeScope, OAuthError } from "~/lib/oauth-server.server";
import { sessionVersionUnchanged } from "~/lib/session-version-fence.server";
import {
  captureEvent,
  type PostHogServerConfig,
} from "~/lib/analytics-server";

type Database = PrismaClientType;

/**
 * Details of a lost device-code claim race: a poll minted a fresh credential,
 * then found the request had already been claimed concurrently, so the new
 * credential is being revoked immediately. Otherwise invisible — surfaced via
 * the optional {@link PollAgentConnectionDeps.capture} hook.
 */
export interface AgentConnectionClaimRace {
  requestId: string;
  userId: string;
  credentialId: string;
}

export interface PollAgentConnectionDeps {
  /**
   * Optional sink for the silent claim-race revoke. Wired by callers that have
   * a request context; defaults to a no-op so the core flow stays pure and
   * testable. Implementations must not throw.
   */
  capture?: (race: AgentConnectionClaimRace) => void;
}

/**
 * Build a {@link PollAgentConnectionDeps.capture} sink that emits
 * `spoonjoy.agent_connection.claim_race` to PostHog. Fire-and-forget; the
 * underlying {@link captureEvent} swallows its own errors. Wrap the returned
 * promise in `ctx.waitUntil` at the call site when one is available.
 */
export function postHogClaimRaceCapture(
  config: PostHogServerConfig,
  schedule: (task: Promise<unknown>) => void,
  fetchImpl?: typeof fetch,
): (race: AgentConnectionClaimRace) => void {
  return (race) => {
    schedule(
      captureEvent(
        config,
        {
          event: "spoonjoy.agent_connection.claim_race",
          distinctId: race.userId,
          properties: {
            feature: "agent_connection",
            requestId: race.requestId,
            credentialId: race.credentialId,
            outcome: "revoked_duplicate_credential",
          },
        },
        fetchImpl,
      ),
    );
  };
}

const DEFAULT_AGENT_NAME = "Ouroboros agent";
const DEFAULT_BASE_URL = "https://spoonjoy.app";
const DEFAULT_TTL_MINUTES = 10;
const DEFAULT_SCOPES = "shopping_list:read shopping_list:write";

export {
  AGENT_CONNECTION_SCOPES,
  AGENT_CONNECTION_TOKEN_TTL_DAYS,
  AGENT_CONNECTION_WRITE_SCOPES,
  isGrantableAgentConnectionScope,
} from "~/lib/agent-connection-scopes";
import {
  AGENT_CONNECTION_SCOPES,
  AGENT_CONNECTION_TOKEN_TTL_DAYS,
  isGrantableAgentConnectionScope,
} from "~/lib/agent-connection-scopes";

/** Network details of whoever started a request. Reported by the network; never verified. */
export interface AgentConnectionRequester {
  ip?: string | null;
  userAgent?: string | null;
  country?: string | null;
}

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
  let scopes: string;
  try {
    scopes = normalizeScope(value);
  } catch (error) {
    if (error instanceof OAuthError) {
      throw new ApiAuthError(error.message, error.status);
    }
    throw error;
  }
  const refused = scopes.split(" ").filter((scope) => !isGrantableAgentConnectionScope(scope));
  if (refused.length > 0) {
    throw new ApiAuthError(
      `Agent connections cannot grant ${refused.join(", ")}. Allowed scopes: ${AGENT_CONNECTION_SCOPES.join(" ")}.`,
      400,
    );
  }
  return scopes;
}

function trimmedOrNull(value: string | null | undefined, maxLength: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeBaseUrl(value: string | undefined): string {
  const url = new URL(value?.trim() || DEFAULT_BASE_URL);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new ApiAuthError("baseUrl must be https or localhost", 400);
  }
  return url.origin;
}

// The approval page for one request. It never carries the user code: the chef types the code their
// agent shows them, so a link alone (for example one sent by someone else) can't approve anything.
function connectionUrl(baseUrl: string, id: string): string {
  return new URL(`/agent/connect/${encodeURIComponent(id)}`, baseUrl).toString();
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
    requester?: AgentConnectionRequester | null;
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
      requesterIp: trimmedOrNull(input.requester?.ip, 64),
      requesterUserAgent: trimmedOrNull(input.requester?.userAgent, 300),
      requesterCountry: trimmedOrNull(input.requester?.country, 8),
      expiresAt,
      createdAt: now,
    },
  });

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const authorizationUrl = connectionUrl(baseUrl, request.id);
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

/**
 * Approve a pending request for the signed-in chef. `sessionVersion` is the version of the
 * session that made the request: if sign out everywhere or a password change lands while this
 * runs, the approval is undone, and a token a poll already collected for it is revoked.
 */
export async function approveAgentConnectionRequest(
  db: Database,
  id: string,
  approver: { userId: string; sessionVersion: number },
  now: Date = new Date(),
): Promise<AgentConnectionRequest> {
  const request = await getAgentConnectionRequest(db, id, now);
  if (!request) throw new ApiAuthError("Connection request not found", 404);
  if (publicStatus(request, now) !== "pending") return request;
  // A request started before account scopes were refused can't be approved with them.
  if (!isGrantableAgentConnectionScope(request.scopes)) {
    throw new ApiAuthError(
      "This request asks for account access, which agent connections can't grant. Ask your agent to start a new connection.",
      400,
    );
  }

  // Approve only a request that is still pending, so a concurrent denial or approval wins.
  await db.agentConnectionRequest.updateMany({
    where: { id, status: "pending" },
    data: {
      status: "approved",
      approvedById: approver.userId,
      approvedAt: now,
    },
  });
  // The session-version fence. A revocation that landed before this check ran its sweep while
  // the request was still pending, so undo the approval here: deny it if no poll has collected
  // it yet, or revoke the token a poll collected in between. One that lands after this check
  // finds the approval or the token and revokes it itself. (This read is consistent with the
  // revocation's write because D1 read replication is off; the fence would need a D1 session
  // if it were turned on.)
  if (!(await sessionVersionUnchanged(db, approver.userId, approver.sessionVersion))) {
    await db.agentConnectionRequest.updateMany({
      where: { id, status: "approved", approvedById: approver.userId },
      data: { status: "denied", deniedAt: now },
    });
    const settled = await db.agentConnectionRequest.findUniqueOrThrow({ where: { id } });
    if (settled.status === "claimed" && settled.approvedById === approver.userId && settled.credentialId) {
      await db.apiCredential.updateMany({
        where: { id: settled.credentialId, revokedAt: null },
        data: { revokedAt: now },
      });
    }
    return settled;
  }
  return db.agentConnectionRequest.findUniqueOrThrow({ where: { id } });
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
  deps: PollAgentConnectionDeps = {},
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
    const authorizationUrl = connectionUrl(baseUrl, current.id);
    return {
      status,
      expiresAt,
      authorizationUrl,
      verificationUri: verificationUrl(baseUrl),
      verificationUriComplete: authorizationUrl,
      userCode: current.userCode,
      message: "Waiting for the user to approve this Spoonjoy connection. Show them authorizationUrl and, separately, userCode: they type the code on that page to approve.",
    };
  }

  if (status === "approved") {
    if (!current.approvedById) throw new ApiAuthError("Approved connection is missing a user", 400);
    // Approved before account scopes were refused: never mint a token with them.
    if (!isGrantableAgentConnectionScope(current.scopes)) {
      await db.agentConnectionRequest.updateMany({
        where: { id: current.id, status: "approved", claimedAt: null },
        data: { status: "expired" },
      });
      return {
        status: "expired",
        expiresAt,
        message: "This Spoonjoy connection asked for account access, which agent connections can't grant. Start a new connection request.",
      };
    }
    const tokenExpiresAt = new Date(now.getTime() + AGENT_CONNECTION_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const created = await createApiCredential(
      db,
      current.approvedById,
      input.tokenName?.trim() || `${current.agentName} delegated token`,
      {
        scopes: current.scopes,
        expiresAt: tokenExpiresAt,
      },
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
      // A concurrent poll claimed the request first; the credential we just
      // minted is now orphaned and revoked. Surface this otherwise-silent race
      // so a misbehaving client (or a real bug) hammering poll is observable.
      deps.capture?.({
        requestId: current.id,
        userId: current.approvedById,
        credentialId: created.credential.id,
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
        expiresAt: tokenExpiresAt.toISOString(),
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
