import type { PrismaClient as PrismaClientType } from "@prisma/client";
import type { D1Query, D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";

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
  authorizationCodes: number;
  consentTransactions: number;
}

export interface AccountRevocationResult extends AccountRevocationCounts {
  /** The user's new session version when `user.bumpSessionVersion` was set, otherwise null. */
  sessionVersion: number | null;
}

export interface AccountRevocationOptions {
  now?: Date;
  reason: AccountRevocationReason;
  /**
   * The request's D1 binding. With it, the user write and every sweep run as one D1 batch, so
   * either all of them apply or none does. Without it (unit tests, scripts) they run in a Prisma
   * transaction.
   */
  d1?: D1ReadDatabase | null;
  /**
   * The user-row write that goes with the revocation, in the same atomic step: always a session
   * version bump (which signs out every browser session), plus the new password hash for a
   * password change or reset.
   */
  user?: { bumpSessionVersion: true; password?: { hashedPassword: string; salt: string } };
}

/**
 * Revokes every bearer credential an account has handed out, for account recovery: personal API
 * tokens, delegated agent tokens, OAuth access tokens (the iPhone app, the Claude connector and
 * any other OAuth client), their refresh tokens and grants, authorization codes and consent
 * screens not yet used, and agent connection requests that were approved but not yet collected
 * (which would otherwise mint a fresh token afterwards).
 *
 * The order closes the races with flows that are mid-way when the revocation lands:
 * - Approved device requests are denied first, so a poll that already minted its credential
 *   fails its claim and revokes that credential itself, or the later credential sweep catches it.
 * - Grants are revoked before tokens. `authenticateApiToken` refuses any OAuth credential whose
 *   grant is not active, so a refresh that inserts an access token after the sweep still mints
 *   nothing usable.
 * - Codes and consent screens are spent, so nothing can be exchanged for a fresh grant.
 *
 * Everything, including the optional user write, applies atomically (one D1 batch, or one Prisma
 * transaction without a binding), so a failure leaves the account exactly as it was.
 *
 * Passkeys and linked Google, GitHub or Apple sign-ins are kept: they are how the chef signs in.
 */
export async function revokeAllAccountAccess(
  db: Database,
  userId: string,
  options: AccountRevocationOptions,
): Promise<AccountRevocationResult> {
  const now = options.now ?? new Date();
  return options.d1
    ? revokeOnD1(options.d1, userId, now, options.user)
    : revokeWithPrisma(db, userId, now, options.user);
}

function revocationStatements(userId: string, now: Date): D1Query[] {
  const at = d1Timestamp(now);
  return [
    [
      `UPDATE "AgentConnectionRequest" SET "status" = 'denied', "deniedAt" = ?, "updatedAt" = ?
       WHERE "approvedById" = ? AND "status" = 'approved' AND "claimedAt" IS NULL`,
      at, at, userId,
    ],
    [
      `UPDATE "OAuthGrant" SET "status" = 'revoked', "statusReason" = ?, "statusChangedAt" = ?, "updatedAt" = ?
       WHERE "userId" = ? AND "status" = 'active'`,
      ACCOUNT_REVOCATION_GRANT_REASON, at, at, userId,
    ],
    [`UPDATE "OAuthAuthCode" SET "consumedAt" = ? WHERE "userId" = ? AND "consumedAt" IS NULL`, at, userId],
    [`DELETE FROM "OAuthConsentTransaction" WHERE "userId" = ?`, userId],
    [`UPDATE "OAuthRefreshToken" SET "revokedAt" = ? WHERE "userId" = ? AND "revokedAt" IS NULL`, at, userId],
    [
      `UPDATE "ApiCredential" SET "revokedAt" = ?, "updatedAt" = ? WHERE "userId" = ? AND "revokedAt" IS NULL`,
      at, at, userId,
    ],
  ];
}

async function revokeOnD1(
  d1: D1ReadDatabase,
  userId: string,
  now: Date,
  user: AccountRevocationOptions["user"],
): Promise<AccountRevocationResult> {
  const statements = revocationStatements(userId, now);
  if (user) {
    const sets = [`"sessionVersion" = "sessionVersion" + 1`, `"updatedAt" = ?`];
    const values: unknown[] = [d1Timestamp(now)];
    if (user.password) {
      sets.push(`"hashedPassword" = ?`, `"salt" = ?`);
      values.push(user.password.hashedPassword, user.password.salt);
    }
    statements.unshift([`UPDATE "User" SET ${sets.join(", ")} WHERE "id" = ? RETURNING "sessionVersion"`, ...values, userId]);
  }
  const results = await d1WriteBatch(d1, statements);
  const userResult = user ? results.shift() : undefined;
  if (user && userResult?.rows.length !== 1) throw new Error("Account revocation found no user to update");
  const [agents, grants, codes, consents, refresh, credentials] = results.map((result) => result.changes);
  return {
    pendingAgentConnections: agents,
    oauthGrants: grants,
    authorizationCodes: codes,
    consentTransactions: consents,
    refreshTokens: refresh,
    apiCredentials: credentials,
    sessionVersion: userResult ? Number(userResult.rows[0].sessionVersion) : null,
  };
}

async function revokeWithPrisma(
  db: Database,
  userId: string,
  now: Date,
  user: AccountRevocationOptions["user"],
): Promise<AccountRevocationResult> {
  return db.$transaction(async (tx) => {
    const updatedUser = user
      ? await tx.user.update({
        where: { id: userId },
        data: {
          sessionVersion: { increment: 1 },
          ...user.password,
        },
        select: { sessionVersion: true },
      })
      : null;
    const pendingAgentConnections = await tx.agentConnectionRequest.updateMany({
      where: { approvedById: userId, status: "approved", claimedAt: null },
      data: { status: "denied", deniedAt: now },
    });
    const oauthGrants = await tx.oAuthGrant.updateMany({
      where: { userId, status: "active" },
      data: { status: "revoked", statusReason: ACCOUNT_REVOCATION_GRANT_REASON, statusChangedAt: now },
    });
    const authorizationCodes = await tx.oAuthAuthCode.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: now },
    });
    const consentTransactions = await tx.oAuthConsentTransaction.deleteMany({ where: { userId } });
    const refreshTokens = await tx.oAuthRefreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    const apiCredentials = await tx.apiCredential.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    return {
      pendingAgentConnections: pendingAgentConnections.count,
      oauthGrants: oauthGrants.count,
      authorizationCodes: authorizationCodes.count,
      consentTransactions: consentTransactions.count,
      refreshTokens: refreshTokens.count,
      apiCredentials: apiCredentials.count,
      sessionVersion: updatedUser?.sessionVersion ?? null,
    };
  });
}
