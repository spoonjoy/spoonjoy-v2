// Whether a username is free, and saving an account's email and username without racing another
// account for them.
//
// Usernames are unique regardless of letter case ("Alice" and "alice" would be two profiles that
// look the same), and a username may not equal another account's ID, because /users/<identifier>
// looks up a username first and falls back to an ID, so such a username would take over that
// account's ID-based profile URL.
//
// The database's own unique index on User.username is case-sensitive. A case-insensitive unique
// index would need a migration that the production release refuses to apply automatically (a new
// UNIQUE index on an existing table is not additive: it fails if production already holds
// case-duplicates, which nobody has audited), so the rule is enforced here instead: a lookup for
// signup and OAuth sign-up, and a single guarded UPDATE for renames, which checks and writes in
// one statement so two renames can't both win.
import type { PrismaClient } from "@prisma/client";

type IdentityDb = Pick<PrismaClient, "$queryRaw" | "$executeRaw" | "user">;

// True when another account (not exceptUserId) holds this username in any letter case, or has it
// as its ID.
export async function findUsernameConflict(
  db: Pick<PrismaClient, "$queryRaw">,
  username: string,
  exceptUserId = "",
): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "User"
    WHERE (lower("username") = lower(${username}) OR "id" = ${username}) AND "id" != ${exceptUserId}
    LIMIT 1
  `;
  return rows.length > 0;
}

export interface AccountIdentityChange {
  userId: string;
  // Already normalised (trimmed, lowercased email; trimmed username).
  email: string;
  username: string;
  // Only a changed value is checked against other accounts, so legacy duplicates (for example two
  // accounts whose usernames differ only in case) can still save their other field.
  emailChanged: boolean;
  usernameChanged: boolean;
}

export type AccountIdentityResult = "saved" | "email_taken" | "username_taken";

export async function saveAccountIdentity(db: IdentityDb, change: AccountIdentityChange): Promise<AccountIdentityResult> {
  const { userId, email, username, emailChanged, usernameChanged } = change;
  // The guards are switched by SQL parameters rather than composed with `Prisma.sql`, so this module
  // needs only types from "@prisma/client" and never imports its runtime (which db.server.ts loads
  // dynamically for the Worker bundle).
  const checkEmail = emailChanged ? 1 : 0;
  const checkUsername = usernameChanged ? 1 : 0;
  const updated = await db.$executeRaw`
    UPDATE "User" SET "email" = ${email}, "username" = ${username}
    WHERE "id" = ${userId}
      AND (${checkEmail} = 0 OR NOT EXISTS (
        SELECT 1 FROM "User" AS "other" WHERE "other"."id" != ${userId} AND lower("other"."email") = lower(${email})
      ))
      AND (${checkUsername} = 0 OR NOT EXISTS (
        SELECT 1 FROM "User" AS "other"
        WHERE "other"."id" != ${userId}
          AND (lower("other"."username") = lower(${username}) OR "other"."id" = ${username})
      ))
  `;

  if (updated === 0) {
    if (emailChanged) {
      const emailHolder = await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "User" WHERE "id" != ${userId} AND lower("email") = lower(${email}) LIMIT 1
      `;
      if (emailHolder.length > 0) return "email_taken";
    }
    return "username_taken";
  }

  // The guarded write is raw SQL, which leaves updatedAt alone; native sync reads it.
  await db.user.update({ where: { id: userId }, data: { updatedAt: new Date() } });
  return "saved";
}
