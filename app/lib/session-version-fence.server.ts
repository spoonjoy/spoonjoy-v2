import type { PrismaClient as PrismaClientType } from "@prisma/client";

type Database = PrismaClientType;

/**
 * The session-version fence for flows that hand out new access while sign out everywhere or a
 * password change can land part way through them.
 *
 * Every account-wide revocation bumps `User.sessionVersion` in the same atomic step that revokes
 * grants, spends codes and denies approved agent requests (see `revokeAllAccountAccess`). A flow
 * reads the version before its first write that a revocation would undo, writes its new row, and
 * then checks that the version has not moved:
 * - If the revocation landed before the check, the version moved, so the flow undoes its own row.
 * - If it lands after the check, the row already existed, so the revocation's sweep catches it.
 *
 * This relies on the check reading the revocation's write, which holds while D1 read replication
 * is off (no `withSession` anywhere). Turning replication on needs a D1 session for these reads.
 */
export async function readSessionVersion(db: Database, userId: string): Promise<number | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
  return user ? user.sessionVersion : null;
}

/** True while the account still exists and its session version is the one the flow read. */
export async function sessionVersionUnchanged(db: Database, userId: string, expected: number): Promise<boolean> {
  return (await readSessionVersion(db, userId)) === expected;
}
