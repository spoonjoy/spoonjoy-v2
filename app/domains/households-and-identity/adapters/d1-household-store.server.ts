// The HouseholdStore port on D1 (migrations/0042_households.sql). Joining is one batch: a guard that the invite still
// works, spending a use and adding the member, so two people racing for the last use can't both get in.

import { d1DateTime, d1NullableDateTime, d1ReadBatch, type D1ReadDatabase, type D1Row } from "~/lib/d1-read.server";
import { d1Guard, d1Timestamp, d1WriteBatch, isD1GuardFailure } from "~/lib/d1-write.server";
import type { HouseholdStore, HouseholdMemberView, StoredInvite } from "../application/household-store";
import type { HouseholdRole } from "../model/household";
import type { HouseholdInvite } from "../model/invite";

const INVITE_COLUMNS = `i."id", i."householdId", i."role", i."usesLeft", i."email", i."expiresAt", i."revokedAt", i."createdAt"`;

function invite(row: D1Row): StoredInvite {
  return {
    id: String(row.id),
    householdId: String(row.householdId),
    role: row.role as HouseholdInvite["role"],
    usesLeft: Number(row.usesLeft),
    email: row.email as string | null,
    expiresAt: d1DateTime(row.expiresAt, "expiresAt"),
    revokedAt: d1NullableDateTime(row.revokedAt, "revokedAt"),
    createdAt: d1DateTime(row.createdAt, "createdAt"),
  };
}

function member(row: D1Row): HouseholdMemberView {
  return {
    householdId: String(row.householdId),
    userId: String(row.userId),
    role: row.role as HouseholdRole,
    username: String(row.username),
    photoUrl: row.photoUrl as string | null,
    joinedAt: d1DateTime(row.joinedAt, "joinedAt"),
  };
}

export function d1HouseholdStore(db: D1ReadDatabase): HouseholdStore {
  const read = async (sql: string, ...values: unknown[]) => (await d1ReadBatch(db, [[sql, ...values]]))[0] as D1Row[];
  const write = (sql: string, ...values: unknown[]) => d1WriteBatch(db, [[sql, ...values]]);

  return {
    async insertHousehold({ id, name, ownerId, now }) {
      const at = d1Timestamp(now);
      await d1WriteBatch(db, [
        [`INSERT INTO "Household" ("id", "name", "createdById", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)`, id, name, ownerId, at, at],
        [`INSERT INTO "HouseholdMember" ("householdId", "userId", "role", "joinedAt") VALUES (?, ?, 'owner', ?)`, id, ownerId, at],
      ]);
    },

    async householdsFor(userId) {
      const rows = await read(
        `SELECT h."id", h."name", m."role",
           (SELECT COUNT(*) FROM "HouseholdMember" c WHERE c."householdId" = h."id") AS "memberCount"
         FROM "HouseholdMember" m JOIN "Household" h ON h."id" = m."householdId"
         WHERE m."userId" = ? ORDER BY h."name", h."id"`,
        userId,
      );
      return rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        role: row.role as HouseholdRole,
        memberCount: Number(row.memberCount),
      }));
    },

    async household(id) {
      const [row] = await read(`SELECT "id", "name" FROM "Household" WHERE "id" = ?`, id);
      return row ? { id: String(row.id), name: String(row.name) } : null;
    },

    async members(householdId) {
      const rows = await read(
        `SELECT m."householdId", m."userId", m."role", m."joinedAt", u."username", u."photoUrl"
         FROM "HouseholdMember" m JOIN "User" u ON u."id" = m."userId"
         WHERE m."householdId" = ? ORDER BY m."joinedAt", m."userId"`,
        householdId,
      );
      return rows.map(member);
    },

    async invites(householdId) {
      const rows = await read(
        `SELECT ${INVITE_COLUMNS} FROM "HouseholdInvite" i WHERE i."householdId" = ? ORDER BY i."createdAt" DESC, i."id"`,
        householdId,
      );
      return rows.map(invite);
    },

    async inviteByTokenHash(tokenHash) {
      const [row] = await read(
        `SELECT ${INVITE_COLUMNS}, h."name" AS "householdName"
         FROM "HouseholdInvite" i JOIN "Household" h ON h."id" = i."householdId" WHERE i."tokenHash" = ?`,
        tokenHash,
      );
      return row ? { ...invite(row), householdName: String(row.householdName) } : null;
    },

    async insertInvite(value, { createdById, tokenHash, now }) {
      await write(
        `INSERT INTO "HouseholdInvite" ("id", "householdId", "createdById", "tokenHash", "role", "usesLeft", "email", "expiresAt", "createdAt")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        value.id,
        value.householdId,
        createdById,
        tokenHash,
        value.role,
        value.usesLeft,
        value.email,
        d1Timestamp(value.expiresAt),
        d1Timestamp(now),
      );
    },

    async join({ inviteId, householdId, userId, role, now }) {
      const at = d1Timestamp(now);
      try {
        await d1WriteBatch(db, [
          d1Guard(
            `EXISTS (SELECT 1 FROM "HouseholdInvite" WHERE "id" = ? AND "usesLeft" > 0 AND "revokedAt" IS NULL AND "expiresAt" > ?)`,
            inviteId,
            at,
          ),
          [`UPDATE "HouseholdInvite" SET "usesLeft" = "usesLeft" - 1 WHERE "id" = ?`, inviteId],
          [`INSERT INTO "HouseholdMember" ("householdId", "userId", "role", "joinedAt") VALUES (?, ?, ?, ?)`, householdId, userId, role, at],
        ]);
        return true;
      } catch (error) {
        if (isD1GuardFailure(error)) return false;
        throw error;
      }
    },

    async setRole(householdId, userId, role) {
      await write(`UPDATE "HouseholdMember" SET "role" = ? WHERE "householdId" = ? AND "userId" = ?`, role, householdId, userId);
    },

    async deleteMember(householdId, userId) {
      await write(`DELETE FROM "HouseholdMember" WHERE "householdId" = ? AND "userId" = ?`, householdId, userId);
    },

    async revokeInvite(householdId, inviteId, now) {
      await write(
        `UPDATE "HouseholdInvite" SET "revokedAt" = ? WHERE "id" = ? AND "householdId" = ? AND "revokedAt" IS NULL`,
        d1Timestamp(now),
        inviteId,
        householdId,
      );
    },

    async chefIdsSharingWith(userId) {
      const rows = await read(
        `SELECT DISTINCT o."userId" FROM "HouseholdMember" m
         JOIN "HouseholdMember" o ON o."householdId" = m."householdId"
         WHERE m."userId" = ? AND o."userId" <> ? ORDER BY o."userId"`,
        userId,
        userId,
      );
      return rows.map((row) => String(row.userId));
    },
  };
}
