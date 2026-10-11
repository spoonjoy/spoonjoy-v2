import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { d1ReadBatch, type D1Query, type D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Guard, d1Timestamp, d1WriteBatch, isD1GuardFailure } from "~/lib/d1-write.server";
import { retryD1Write } from "~/lib/d1-write-retry.server";

type Database = PrismaClientType;

// OAuth grants revoked account-wide record `security_event`: migration 0027's CHECK constraint on
// "OAuthGrant" allows only a fixed set of revocation reasons, and sign out everywhere and a
// password change are both security events.
export const ACCOUNT_REVOCATION_GRANT_REASON = "security_event";

/**
 * How many rows the revocation changed. A try whose answer a transient D1 error lost, but which
 * committed, is not run again, so its rows are counted as zero.
 */
export interface AccountRevocationCounts {
  apiCredentials: number;
  refreshTokens: number;
  oauthGrants: number;
  pendingAgentConnections: number;
  authorizationCodes: number;
  consentTransactions: number;
}

export interface AccountRevocationResult extends AccountRevocationCounts {
  /** The user's new session version. */
  sessionVersion: number;
}

export interface AccountRevocationOptions {
  now?: Date;
  /**
   * The request's D1 binding. With it, the user write and every sweep run as one D1 batch, so
   * either all of them apply or none does. Without it (unit tests, scripts) they run in a Prisma
   * transaction.
   */
  d1?: D1ReadDatabase | null;
  /** The new password hash for a password change, written in the same atomic step. */
  password?: { hashedPassword: string; salt: string };
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
 * - The session-version bump signs out every browser session, and is the fence for flows that
 *   create a grant, an authorization code or an approval after this sweep would have run (see
 *   `session-version-fence.server.ts`).
 *
 * Everything, including the user write, applies atomically (one D1 batch, or one Prisma
 * transaction without a binding), so a failure leaves the account exactly as it was.
 *
 * On D1 the session version moves from the value just read to the next one, and the batch stops if
 * it changed in between, so the revocation never bumps it twice: after a transient D1 error it
 * runs again only once a read shows the failed try did not commit. Every sweep sets fixed values,
 * so running one again changes nothing.
 *
 * Passkeys and linked Google, GitHub or Apple sign-ins are kept: they are how the chef signs in.
 */
export async function revokeAllAccountAccess(
  db: Database,
  userId: string,
  options: AccountRevocationOptions = {},
): Promise<AccountRevocationResult> {
  const now = options.now ?? new Date();
  return options.d1
    ? revokeOnD1(options.d1, userId, now, options.password)
    : revokeWithPrisma(db, userId, now, options.password);
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

// Another sign-out or password change moved the session version between the read and the batch
// this many times at most before the revocation gives up.
const SESSION_VERSION_RACE_ATTEMPTS = 3;

async function revokeOnD1(
  d1: D1ReadDatabase,
  userId: string,
  now: Date,
  password: AccountRevocationOptions["password"],
): Promise<AccountRevocationResult> {
  for (let race = 1; ; race += 1) {
    const from = await readSessionVersion(d1, userId);
    if (from === null) throw new Error("Account revocation found no user to update");
    const to = from + 1;
    const sets = [`"sessionVersion" = ?`, `"updatedAt" = ?`];
    const values: unknown[] = [to, d1Timestamp(now)];
    if (password) {
      sets.push(`"hashedPassword" = ?`, `"salt" = ?`);
      values.push(password.hashedPassword, password.salt);
    }
    try {
      return await retryD1Write(
        {
          scope: "account.revoke_all",
          applied: async () => (await revocationCommitted(d1, userId, to, password) ? committedResult(to) : null),
        },
        async () => {
          const results = await d1WriteBatch(d1, [
            d1Guard(`(SELECT "sessionVersion" FROM "User" WHERE "id" = ?) = ?`, userId, from),
            [`UPDATE "User" SET ${sets.join(", ")} WHERE "id" = ?`, ...values, userId],
            ...revocationStatements(userId, now),
          ]);
          const [agents, grants, codes, consents, refresh, credentials] = results.slice(2).map((result) => result.changes);
          return {
            pendingAgentConnections: agents,
            oauthGrants: grants,
            authorizationCodes: codes,
            consentTransactions: consents,
            refreshTokens: refresh,
            apiCredentials: credentials,
            sessionVersion: to,
          };
        },
      );
    } catch (error) {
      if (!isD1GuardFailure(error) || race === SESSION_VERSION_RACE_ATTEMPTS) throw error;
    }
  }
}

async function readSessionVersion(d1: D1ReadDatabase, userId: string): Promise<number | null> {
  const [[user]] = await d1ReadBatch(d1, [[`SELECT "sessionVersion" FROM "User" WHERE "id" = ?`, userId]]);
  return user ? Number(user.sessionVersion) : null;
}

/** Whether the revocation that moves the session version to `to` (and sets this password) is in. */
async function revocationCommitted(
  d1: D1ReadDatabase,
  userId: string,
  to: number,
  password: AccountRevocationOptions["password"],
): Promise<boolean> {
  const [[user]] = await d1ReadBatch(d1, [[`SELECT "sessionVersion", "hashedPassword" FROM "User" WHERE "id" = ?`, userId]]);
  return Boolean(user) && Number(user.sessionVersion) === to && (!password || user.hashedPassword === password.hashedPassword);
}

function committedResult(sessionVersion: number): AccountRevocationResult {
  return {
    pendingAgentConnections: 0,
    oauthGrants: 0,
    authorizationCodes: 0,
    consentTransactions: 0,
    refreshTokens: 0,
    apiCredentials: 0,
    sessionVersion,
  };
}

/**
 * A password change that keeps the account's connections: the new password and the session
 * version bump (which signs out every other browser) in one write, moving the version from the
 * value just read so that a retry after a transient D1 error never bumps it twice. Answers the new
 * session version.
 */
export async function changePasswordKeepingConnections(
  db: Database,
  userId: string,
  password: { hashedPassword: string; salt: string },
): Promise<number> {
  for (let race = 1; ; race += 1) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
    if (!user) throw new Error("Password change found no user to update");
    const to = user.sessionVersion + 1;
    const committed = async () => {
      const now = await db.user.findUnique({ where: { id: userId }, select: { sessionVersion: true, hashedPassword: true } });
      return now?.sessionVersion === to && now.hashedPassword === password.hashedPassword ? to : null;
    };
    const changed = await retryD1Write({ scope: "account.change_password", applied: committed }, async () => {
      const { count } = await db.user.updateMany({
        where: { id: userId, sessionVersion: user.sessionVersion },
        data: { ...password, sessionVersion: to },
      });
      // Nothing matched: an earlier try of this change committed, or another change moved the version.
      return count === 1 ? to : await committed();
    });
    if (changed !== null) return changed;
    if (race === SESSION_VERSION_RACE_ATTEMPTS) throw new Error("Password change lost a race with another account change");
  }
}

async function revokeWithPrisma(
  db: Database,
  userId: string,
  now: Date,
  password: AccountRevocationOptions["password"],
): Promise<AccountRevocationResult> {
  return db.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: { sessionVersion: { increment: 1 }, ...password },
      select: { sessionVersion: true },
    });
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
      sessionVersion: updatedUser.sessionVersion,
    };
  });
}
