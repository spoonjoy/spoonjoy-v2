import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
type DatabaseSyncType = InstanceType<typeof DatabaseSync>;


const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "..",
  "migrations",
  "0009_d006_push_notifications.sql",
);

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface IndexListRow {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface ForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

function freshDb(): DatabaseSyncType {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  // Minimal prerequisite schema so FK constraints can resolve.
  db.exec(`
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL,
      "username" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("migration 0009 — push notifications create", () => {
  let db: DatabaseSyncType;

  beforeAll(() => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    db = freshDb();
    db.exec(sql);
  });

  describe("PushSubscription", () => {
    it("has the expected columns", () => {
      const rows = db
        .prepare(`PRAGMA table_info("PushSubscription")`)
        .all() as unknown as TableInfoRow[];
      const cols = Object.fromEntries(rows.map((r) => [r.name, r]));
      expect(cols.id).toMatchObject({ type: "TEXT", notnull: 1, pk: 1 });
      expect(cols.userId).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(cols.endpoint).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(cols.p256dh).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(cols.authSecret).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(cols.userAgent).toMatchObject({ type: "TEXT", notnull: 0 });
      expect(cols.createdAt).toMatchObject({ type: "DATETIME", notnull: 1 });
      expect(cols.lastSeenAt).toMatchObject({ type: "DATETIME", notnull: 1 });
    });

    it("declares the userId index", () => {
      const rows = db
        .prepare(`PRAGMA index_list("PushSubscription")`)
        .all() as unknown as IndexListRow[];
      const names = rows.map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining(["PushSubscription_userId_idx"]),
      );
    });

    it("enforces unique endpoint", () => {
      db.exec(
        `INSERT INTO "User" ("id","email","username") VALUES ('u1','a@b.com','u1');`,
      );
      db.exec(
        `INSERT INTO "PushSubscription" ("id","userId","endpoint","p256dh","authSecret") VALUES ('s1','u1','https://push.example/x','pk','as');`,
      );
      expect(() =>
        db.exec(
          `INSERT INTO "PushSubscription" ("id","userId","endpoint","p256dh","authSecret") VALUES ('s2','u1','https://push.example/x','pk2','as2');`,
        ),
      ).toThrow();
    });

    it("cascades on User delete", () => {
      db.exec(
        `INSERT INTO "User" ("id","email","username") VALUES ('u_del','del@x.com','u_del');`,
      );
      db.exec(
        `INSERT INTO "PushSubscription" ("id","userId","endpoint","p256dh","authSecret") VALUES ('sdel','u_del','https://push.example/del','pk','as');`,
      );
      db.exec(`DELETE FROM "User" WHERE id = 'u_del';`);
      const remaining = db
        .prepare(`SELECT COUNT(*) as n FROM "PushSubscription" WHERE userId = 'u_del'`)
        .get() as { n: number };
      expect(remaining.n).toBe(0);
    });

    it("declares the User FK with ON DELETE CASCADE", () => {
      const rows = db
        .prepare(`PRAGMA foreign_key_list("PushSubscription")`)
        .all() as unknown as ForeignKeyRow[];
      const byTable = Object.fromEntries(rows.map((r) => [r.table, r]));
      expect(byTable.User?.on_delete).toBe("CASCADE");
    });
  });

  describe("NotificationEvent", () => {
    it("has the expected columns", () => {
      const rows = db
        .prepare(`PRAGMA table_info("NotificationEvent")`)
        .all() as unknown as TableInfoRow[];
      const cols = Object.fromEntries(rows.map((r) => [r.name, r]));
      expect(cols.id).toMatchObject({ type: "TEXT", notnull: 1, pk: 1 });
      expect(cols.recipientId).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(cols.kind).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(cols.payload).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(cols.createdAt).toMatchObject({ type: "DATETIME", notnull: 1 });
      expect(cols.readAt).toMatchObject({ type: "DATETIME", notnull: 0 });
      expect(cols.pushDeliveredAt).toMatchObject({ type: "DATETIME", notnull: 0 });
    });

    it("declares recipient+createdAt index", () => {
      const rows = db
        .prepare(`PRAGMA index_list("NotificationEvent")`)
        .all() as unknown as IndexListRow[];
      const names = rows.map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining(["NotificationEvent_recipientId_createdAt_idx"]),
      );
    });

    it("cascades on User delete", () => {
      db.exec(
        `INSERT INTO "User" ("id","email","username") VALUES ('u_ne','ne@x.com','u_ne');`,
      );
      db.exec(
        `INSERT INTO "NotificationEvent" ("id","recipientId","kind","payload") VALUES ('ev1','u_ne','spoon_on_my_recipe','{}');`,
      );
      db.exec(`DELETE FROM "User" WHERE id = 'u_ne';`);
      const remaining = db
        .prepare(`SELECT COUNT(*) as n FROM "NotificationEvent" WHERE recipientId = 'u_ne'`)
        .get() as { n: number };
      expect(remaining.n).toBe(0);
    });

    it("declares the User FK with ON DELETE CASCADE", () => {
      const rows = db
        .prepare(`PRAGMA foreign_key_list("NotificationEvent")`)
        .all() as unknown as ForeignKeyRow[];
      const byTable = Object.fromEntries(rows.map((r) => [r.table, r]));
      expect(byTable.User?.on_delete).toBe("CASCADE");
    });
  });

  describe("NotificationPreference", () => {
    it("has the expected columns", () => {
      const rows = db
        .prepare(`PRAGMA table_info("NotificationPreference")`)
        .all() as unknown as TableInfoRow[];
      const cols = Object.fromEntries(rows.map((r) => [r.name, r]));
      expect(cols.userId).toMatchObject({ type: "TEXT", notnull: 1, pk: 1 });
      expect(cols.notifySpoonOnMyRecipe).toMatchObject({
        type: "INTEGER",
        notnull: 1,
      });
      expect(cols.notifyForkOfMyRecipe).toMatchObject({
        type: "INTEGER",
        notnull: 1,
      });
      expect(cols.notifyCookbookSaveOfMine).toMatchObject({
        type: "INTEGER",
        notnull: 1,
      });
      expect(cols.notifyFellowChefOriginCook).toMatchObject({
        type: "INTEGER",
        notnull: 1,
      });
      expect(cols.updatedAt).toMatchObject({ type: "DATETIME", notnull: 1 });
    });

    it("defaults all notify flags to 1 (true) on insert", () => {
      db.exec(
        `INSERT INTO "User" ("id","email","username") VALUES ('u_pref','pref@x.com','u_pref');`,
      );
      db.exec(
        `INSERT INTO "NotificationPreference" ("userId") VALUES ('u_pref');`,
      );
      const row = db
        .prepare(`SELECT * FROM "NotificationPreference" WHERE userId='u_pref'`)
        .get() as Record<string, number>;
      expect(row.notifySpoonOnMyRecipe).toBe(1);
      expect(row.notifyForkOfMyRecipe).toBe(1);
      expect(row.notifyCookbookSaveOfMine).toBe(1);
      expect(row.notifyFellowChefOriginCook).toBe(1);
    });

    it("cascades on User delete", () => {
      db.exec(
        `INSERT INTO "User" ("id","email","username") VALUES ('u_pref2','pref2@x.com','u_pref2');`,
      );
      db.exec(
        `INSERT INTO "NotificationPreference" ("userId") VALUES ('u_pref2');`,
      );
      db.exec(`DELETE FROM "User" WHERE id = 'u_pref2';`);
      const remaining = db
        .prepare(`SELECT COUNT(*) as n FROM "NotificationPreference" WHERE userId = 'u_pref2'`)
        .get() as { n: number };
      expect(remaining.n).toBe(0);
    });

    it("declares the User FK with ON DELETE CASCADE", () => {
      const rows = db
        .prepare(`PRAGMA foreign_key_list("NotificationPreference")`)
        .all() as unknown as ForeignKeyRow[];
      const byTable = Object.fromEntries(rows.map((r) => [r.table, r]));
      expect(byTable.User?.on_delete).toBe("CASCADE");
    });
  });
});
