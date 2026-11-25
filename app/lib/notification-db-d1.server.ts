/**
 * The notification reads and writes on the request's D1 binding, shaped like the slice of Prisma
 * that `enqueueNotification` and the fork and cook triggers use (`NotificationDb`).
 *
 * Those notifications run after the answer, through waitUntil. Building a Prisma client there
 * wedged the isolate's one shared Prisma WASM engine: on merge-group run 45528383350 a fork's
 * notification was canceled as hung, and every Prisma page in the same isolate hung after it
 * (/my-recipes, /chefs.data, fellow-chefs.data, /account/settings) until the isolate was
 * recycled. On D1 the background work builds no Prisma client at all.
 *
 * Errors keep Prisma's codes where the dispatcher reads them: a duplicate event id is P2002 and
 * deleting a subscription that is already gone is P2025.
 */

import type { D1ReadDatabase, D1Row } from "~/lib/d1-read.server";
import { d1Boolean, d1ReadBatch } from "~/lib/d1-read.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";

export interface NotificationPreferenceRow {
  notifySpoonOnMyRecipe: boolean;
  notifyForkOfMyRecipe: boolean;
  notifyCookbookSaveOfMine: boolean;
  notifyFellowChefOriginCook: boolean;
}

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  authSecret: string;
}

/** The slice of Prisma the notification dispatcher and its fork and cook triggers use. */
export interface NotificationDb {
  user: {
    findUnique(args: { where: { id: string }; select: { id: true; username: true } }): Promise<{ id: string; username: string } | null>;
  };
  recipe: {
    findUnique(args: { where: { id: string }; select: { id: true; title: true; chefId: true } }): Promise<{ id: string; title: string; chefId: string } | null>;
  };
  chefBlock: {
    findUnique(args: {
      where: { blockerId_blockedId: { blockerId: string; blockedId: string } };
      select: { blockerId: true };
    }): Promise<{ blockerId: string } | null>;
  };
  notificationEvent: {
    findFirst(args: { where: { id: string; recipientId: string }; select: { id: true } }): Promise<{ id: string } | null>;
    create(args: {
      data: { id: string; recipientId: string; kind: string; payload: string };
      select: { id: true };
    }): Promise<{ id: string }>;
    update(args: { where: { id: string }; data: { pushDeliveredAt: Date } }): Promise<unknown>;
  };
  notificationPreference: {
    findUnique(args: { where: { userId: string } }): Promise<NotificationPreferenceRow | null>;
  };
  pushSubscription: {
    findMany(args: { where: { userId: string } }): Promise<PushSubscriptionRow[]>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
}

class D1NotificationError extends Error {
  constructor(message: string, readonly code: "P2002" | "P2025", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "D1NotificationError";
  }
}

const EVENT_ID_CONFLICT = /UNIQUE constraint failed: NotificationEvent\.id(?![A-Za-z0-9_])/;

function text(value: unknown, column: string): string {
  if (typeof value !== "string") throw new Error(`D1 column ${column} is not text`);
  return value;
}

async function first(d1: D1ReadDatabase, sql: string, ...values: unknown[]): Promise<D1Row | null> {
  const [rows] = await d1ReadBatch(d1, [[sql, ...values]]);
  return rows[0] ?? null;
}

async function write(d1: D1ReadDatabase, sql: string, ...values: unknown[]): Promise<number> {
  const [result] = await d1WriteBatch(d1, [[sql, ...values]]);
  return result.changes;
}

/** The notification reads and writes on a D1 binding. */
export function notificationDbOnD1(d1: D1ReadDatabase): NotificationDb {
  return {
    user: {
      async findUnique({ where }) {
        const row = await first(d1, `SELECT "id", "username" FROM "User" WHERE "id" = ?`, where.id);
        return row ? { id: text(row.id, "User.id"), username: text(row.username, "User.username") } : null;
      },
    },
    recipe: {
      async findUnique({ where }) {
        const row = await first(d1, `SELECT "id", "title", "chefId" FROM "Recipe" WHERE "id" = ?`, where.id);
        return row
          ? { id: text(row.id, "Recipe.id"), title: text(row.title, "Recipe.title"), chefId: text(row.chefId, "Recipe.chefId") }
          : null;
      },
    },
    chefBlock: {
      async findUnique({ where }) {
        const { blockerId, blockedId } = where.blockerId_blockedId;
        const row = await first(d1, `SELECT "blockerId" FROM "ChefBlock" WHERE "blockerId" = ? AND "blockedId" = ?`, blockerId, blockedId);
        return row ? { blockerId: text(row.blockerId, "ChefBlock.blockerId") } : null;
      },
    },
    notificationEvent: {
      async findFirst({ where }) {
        const row = await first(d1, `SELECT "id" FROM "NotificationEvent" WHERE "id" = ? AND "recipientId" = ?`, where.id, where.recipientId);
        return row ? { id: text(row.id, "NotificationEvent.id") } : null;
      },
      async create({ data }) {
        try {
          await write(
            d1,
            `INSERT INTO "NotificationEvent" ("id", "recipientId", "kind", "payload", "createdAt") VALUES (?, ?, ?, ?, ?)`,
            data.id,
            data.recipientId,
            data.kind,
            data.payload,
            d1Timestamp(new Date()),
          );
        } catch (error) {
          if (EVENT_ID_CONFLICT.test(String(error))) {
            throw new D1NotificationError(`Notification event ${data.id} already exists`, "P2002", { cause: error });
          }
          throw error;
        }
        return { id: data.id };
      },
      async update({ where, data }) {
        await write(d1, `UPDATE "NotificationEvent" SET "pushDeliveredAt" = ? WHERE "id" = ?`, d1Timestamp(data.pushDeliveredAt), where.id);
        return { id: where.id };
      },
    },
    notificationPreference: {
      async findUnique({ where }) {
        const row = await first(
          d1,
          `SELECT "notifySpoonOnMyRecipe", "notifyForkOfMyRecipe", "notifyCookbookSaveOfMine", "notifyFellowChefOriginCook"
             FROM "NotificationPreference" WHERE "userId" = ?`,
          where.userId,
        );
        return row
          ? {
              notifySpoonOnMyRecipe: d1Boolean(row.notifySpoonOnMyRecipe, "NotificationPreference.notifySpoonOnMyRecipe"),
              notifyForkOfMyRecipe: d1Boolean(row.notifyForkOfMyRecipe, "NotificationPreference.notifyForkOfMyRecipe"),
              notifyCookbookSaveOfMine: d1Boolean(row.notifyCookbookSaveOfMine, "NotificationPreference.notifyCookbookSaveOfMine"),
              notifyFellowChefOriginCook: d1Boolean(row.notifyFellowChefOriginCook, "NotificationPreference.notifyFellowChefOriginCook"),
            }
          : null;
      },
    },
    pushSubscription: {
      async findMany({ where }) {
        const [rows] = await d1ReadBatch(d1, [[
          `SELECT "id", "endpoint", "p256dh", "authSecret" FROM "PushSubscription" WHERE "userId" = ? ORDER BY "id"`,
          where.userId,
        ]]);
        return rows.map((row) => ({
          id: text(row.id, "PushSubscription.id"),
          endpoint: text(row.endpoint, "PushSubscription.endpoint"),
          p256dh: text(row.p256dh, "PushSubscription.p256dh"),
          authSecret: text(row.authSecret, "PushSubscription.authSecret"),
        }));
      },
      async delete({ where }) {
        const changes = await write(d1, `DELETE FROM "PushSubscription" WHERE "id" = ?`, where.id);
        if (changes === 0) throw new D1NotificationError(`Push subscription ${where.id} is already gone`, "P2025");
        return { id: where.id };
      },
    },
  };
}
