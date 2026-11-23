// The HouseholdListStore port on D1 (migrations/0046_household_lists.sql).

import type { HouseholdRole } from "~/domains/households-and-identity";
import { d1Boolean, d1Count, d1ReadBatch, type D1ReadDatabase, type D1Row } from "~/lib/d1-read.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";
import type { HouseholdListStore } from "../application/household-list-store";

export function d1HouseholdListStore(db: D1ReadDatabase): HouseholdListStore {
  const read = async (sql: string, ...values: unknown[]) => (await d1ReadBatch(db, [[sql, ...values]]))[0] as D1Row[];
  const write = (sql: string, ...values: unknown[]) => d1WriteBatch(db, [[sql, ...values]]);

  return {
    async roleIn(householdId, userId) {
      const [row] = await read(`SELECT "role" FROM "HouseholdMember" WHERE "householdId" = ? AND "userId" = ?`, householdId, userId);
      return row ? (row.role as HouseholdRole) : null;
    },

    async lists(householdId) {
      const rows = await read(
        `SELECT l."id", l."name", COUNT(i."id") AS "itemCount", COUNT(i."id") - COALESCE(SUM(i."checked"), 0) AS "openCount"
         FROM "HouseholdList" l LEFT JOIN "HouseholdListItem" i ON i."listId" = l."id"
         WHERE l."householdId" = ? GROUP BY l."id" ORDER BY l."createdAt", l.rowid`,
        householdId,
      );
      return rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        itemCount: d1Count(row.itemCount, "itemCount"),
        openCount: d1Count(row.openCount, "openCount"),
      }));
    },

    async list(householdId, listId) {
      const [row] = await read(`SELECT "id", "name", "createdById" FROM "HouseholdList" WHERE "id" = ? AND "householdId" = ?`, listId, householdId);
      return row ? { id: String(row.id), name: String(row.name), createdById: row.createdById == null ? null : String(row.createdById) } : null;
    },

    async items(listId) {
      const rows = await read(
        `SELECT i."id", i."text", i."checked", u."username" AS "addedBy"
         FROM "HouseholdListItem" i LEFT JOIN "User" u ON u."id" = i."addedById"
         WHERE i."listId" = ? ORDER BY i."sortIndex", i.rowid`,
        listId,
      );
      return rows.map((row) => ({
        id: String(row.id),
        text: String(row.text),
        checked: d1Boolean(row.checked, "checked"),
        addedBy: row.addedBy === null ? null : String(row.addedBy),
      }));
    },

    async insertList({ id, householdId, name, createdById, now }) {
      const at = d1Timestamp(now);
      await write(
        `INSERT INTO "HouseholdList" ("id", "householdId", "name", "createdById", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)`,
        id, householdId, name, createdById, at, at,
      );
    },

    async insertItem({ id, listId, text, addedById, now }) {
      const at = d1Timestamp(now);
      await write(
        `INSERT INTO "HouseholdListItem" ("id", "listId", "text", "addedById", "sortIndex", "createdAt", "updatedAt")
         SELECT ?, ?, ?, ?, COALESCE(MAX("sortIndex") + 1, 0), ?, ? FROM "HouseholdListItem" WHERE "listId" = ?`,
        id, listId, text, addedById, at, at, listId,
      );
    },

    async setChecked(listId, itemId, checked, now) {
      const at = d1Timestamp(now);
      await write(
        `UPDATE "HouseholdListItem" SET "checked" = ?, "checkedAt" = ?, "updatedAt" = ? WHERE "id" = ? AND "listId" = ?`,
        checked ? 1 : 0, checked ? at : null, at, itemId, listId,
      );
    },

    async deleteItem(listId, itemId) {
      await write(`DELETE FROM "HouseholdListItem" WHERE "id" = ? AND "listId" = ?`, itemId, listId);
    },

    async deleteList(listId) {
      await write(`DELETE FROM "HouseholdList" WHERE "id" = ?`, listId);
    },
  };
}
