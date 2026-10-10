import type { PrismaClient as PrismaClientType } from "@prisma/client";

type Database = PrismaClientType;

// Why every credential on an account was revoked. Callers name the event; OAuth grants all record
// it as `security_event`, because migration 0027's CHECK constraint on "OAuthGrant" allows only a
// fixed set of revocation reasons and an account-wide revocation is a security event.
export type AccountRevocationReason = "sign_out_everywhere" | "password_change" | "password_reset";

export const ACCOUNT_REVOCATION_GRANT_REASON = "security_event";

export interface AccountRevocationCounts {
  apiCredentials: number;
  refreshTokens: number;
  oauthGrants: number;
  pendingAgentConnections: number;
}

/**
 * Revokes every bearer credential an account has handed out, for account recovery: personal API
 * tokens, delegated agent tokens, OAuth access tokens (the iPhone app, the Claude connector and
 * any other OAuth client), their refresh tokens and grants, and agent connection requests that
 * were approved but not yet collected (which would otherwise mint a fresh token afterwards).
 *
 * Browser sessions are separate: callers bump the user's session version for those.
 *
 * Order matches a single disconnect (refresh tokens, then access credentials, then grants), so a
 * failure part way leaves nothing usable that the connector audit would call orphaned.
 */
export async function revokeAllAccountAccess(
  db: Database,
  userId: string,
  options: { now?: Date; reason: AccountRevocationReason },
): Promise<AccountRevocationCounts> {
  const now = options.now ?? new Date();

  const refreshTokens = await db.oAuthRefreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  const apiCredentials = await db.apiCredential.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  const oauthGrants = await db.oAuthGrant.updateMany({
    where: { userId, status: "active" },
    data: { status: "revoked", statusReason: ACCOUNT_REVOCATION_GRANT_REASON, statusChangedAt: now },
  });
  const pendingAgentConnections = await db.agentConnectionRequest.updateMany({
    where: { approvedById: userId, status: "approved", claimedAt: null },
    data: { status: "denied", deniedAt: now },
  });

  return {
    apiCredentials: apiCredentials.count,
    refreshTokens: refreshTokens.count,
    oauthGrants: oauthGrants.count,
    pendingAgentConnections: pendingAgentConnections.count,
  };
}
