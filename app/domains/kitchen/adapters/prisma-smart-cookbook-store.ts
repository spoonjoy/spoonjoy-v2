// The SmartCookbookStore on Prisma: D1 in the Worker, SQLite in tests. Type-only Prisma import, so this file is safe in
// any bundle. D1 has no interactive transactions, so a new cookbook goes in before its rules; rules go in one at a
// time, which keeps each statement inside D1's bound-parameter limit. If a rule fails to go in, the half-made cookbook
// is deleted, so a cook never sees a cookbook with fewer rules than they asked for.
import type { PrismaClient } from "@prisma/client";
import type { SmartCookbookStore } from "../application/smart-cookbooks";
import type { SmartCookbook, SmartCookbookRule, SmartCookbookSide } from "../model/smart-cookbook";

type SmartCookbookDb = Pick<PrismaClient, "smartCookbook" | "smartCookbookRule">;

const COOKBOOK_SELECT = {
  id: true,
  ownerId: true,
  title: true,
  rules: { select: { side: true, organizerId: true }, orderBy: { position: "asc" } },
} as const;

type CookbookRow = { id: string; ownerId: string; title: string; rules: { side: string; organizerId: string }[] };

function toCookbook(row: CookbookRow): SmartCookbook {
  // Rules are written through the Kitchen rules, so every stored side is "with" or "without".
  return { ...row, rules: row.rules.map((rule) => ({ side: rule.side as SmartCookbookSide, organizerId: rule.organizerId })) };
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown }).code === "P2002";
}

export function prismaSmartCookbookStore(db: SmartCookbookDb): SmartCookbookStore {
  return {
    async listOf(ownerId) {
      return (await db.smartCookbook.findMany({ where: { ownerId }, select: COOKBOOK_SELECT })).map(toCookbook);
    },
    async find(cookbookId) {
      const row = await db.smartCookbook.findUnique({ where: { id: cookbookId }, select: COOKBOOK_SELECT });
      return row ? toCookbook(row) : null;
    },
    async create(ownerId, title, rules: SmartCookbookRule[]) {
      let id: string;
      try {
        ({ id } = await db.smartCookbook.create({ data: { ownerId, title }, select: { id: true } }));
      } catch (error) {
        if (isUniqueViolation(error)) return { ok: false, reason: "taken" };
        throw error;
      }
      try {
        for (const [position, rule] of rules.entries()) {
          await db.smartCookbookRule.create({ data: { cookbookId: id, side: rule.side, organizerId: rule.organizerId, position }, select: { cookbookId: true } });
        }
      } catch (error) {
        await db.smartCookbook.deleteMany({ where: { id } });
        throw error;
      }
      return { ok: true, cookbook: { id, ownerId, title, rules } };
    },
    async rename(cookbookId, title) {
      try {
        await db.smartCookbook.update({ where: { id: cookbookId }, data: { title }, select: { id: true } });
      } catch (error) {
        if (isUniqueViolation(error)) return { ok: false, reason: "taken" };
        throw error;
      }
      return { ok: true };
    },
    async replaceRules(cookbookId, rules) {
      const before = await db.smartCookbookRule.findMany({ where: { cookbookId }, select: { side: true, organizerId: true }, orderBy: { position: "asc" } });
      const write = async (list: readonly { side: string; organizerId: string }[]) => {
        await db.smartCookbookRule.deleteMany({ where: { cookbookId } });
        for (const [position, rule] of list.entries()) {
          await db.smartCookbookRule.create({ data: { cookbookId, side: rule.side, organizerId: rule.organizerId, position }, select: { cookbookId: true } });
        }
      };
      try {
        await write(rules);
      } catch (error) {
        // As with a new cookbook: no cook sees half of what they asked for. The rules it had go back.
        await write(before);
        throw error;
      }
    },
    async delete(cookbookId) {
      // Its rules go with it (ON DELETE CASCADE).
      await db.smartCookbook.deleteMany({ where: { id: cookbookId } });
    },
    async repoint(cookbookId, { side, from, to }) {
      const key = { cookbookId, side, organizerId: from };
      // One statement either way: the rule keeps its place and takes the other organizer, or goes.
      if (to) await db.smartCookbookRule.updateMany({ where: key, data: { organizerId: to } });
      else await db.smartCookbookRule.deleteMany({ where: key });
    },
  };
}
