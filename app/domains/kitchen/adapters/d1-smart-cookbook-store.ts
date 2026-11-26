// The SmartCookbookStore, and the organizer reads smart cookbooks need, on the Worker's D1 binding, so the smart
// cookbook pages build no Prisma client: on Journeys runs 45741582394 and 45743957382 their page was canceled as hung
// after a rename and a delete, as every Prisma page in an isolate is once its Prisma engine wedges (merge-group run
// 45528383350). A write that is several statements is one D1 batch, which is one SQLite transaction, so a cook never
// sees a cookbook with only some of its rules.
import { d1ReadBatch, type D1ReadDatabase, type D1Row } from "~/lib/d1-read.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";
import type { OrganizerReader, SmartCookbookStore } from "../application/smart-cookbooks";
import { parseOrganizerKind, type Organizer, type OrganizerKind } from "../model/organizer";
import type { SmartCookbook, SmartCookbookRule, SmartCookbookSide } from "../model/smart-cookbook";

const UNIQUE_TITLE = /UNIQUE constraint failed: SmartCookbook\.ownerId, SmartCookbook\.title(?![A-Za-z0-9_.]|\s*,)/;

function isTitleTaken(error: unknown): boolean {
  return error instanceof Error && UNIQUE_TITLE.test(error.message);
}

const COOKBOOK_COLUMNS = `"id", "ownerId", "title"`;
const RULE_COLUMNS = `rule."cookbookId", rule."side", rule."organizerId"`;

/** Cookbook rows with their rule rows (any order), as cookbooks with their rules in position order. */
function toCookbooks(cookbooks: D1Row[], rules: D1Row[]): SmartCookbook[] {
  const byCookbook = new Map<string, SmartCookbookRule[]>();
  for (const rule of rules) {
    const list = byCookbook.get(String(rule.cookbookId)) ?? [];
    // Rules are written through the Kitchen rules, so every stored side is "with" or "without".
    list.push({ side: String(rule.side) as SmartCookbookSide, organizerId: String(rule.organizerId) });
    byCookbook.set(String(rule.cookbookId), list);
  }
  return cookbooks.map((row) => ({
    id: String(row.id),
    ownerId: String(row.ownerId),
    title: String(row.title),
    rules: byCookbook.get(String(row.id)) ?? [],
  }));
}

function ruleInserts(cookbookId: string, rules: readonly SmartCookbookRule[]) {
  return rules.map((rule, position) => [
    `INSERT INTO "SmartCookbookRule" ("cookbookId", "side", "organizerId", "position") VALUES (?, ?, ?, ?)`,
    cookbookId,
    rule.side,
    rule.organizerId,
    position,
  ] as const);
}

export function d1SmartCookbookStore(d1: D1ReadDatabase, now: () => Date = () => new Date()): SmartCookbookStore {
  return {
    async listOf(ownerId) {
      const [cookbooks, rules] = await d1ReadBatch(d1, [
        [`SELECT ${COOKBOOK_COLUMNS} FROM "SmartCookbook" WHERE "ownerId" = ?`, ownerId],
        [`SELECT ${RULE_COLUMNS} FROM "SmartCookbookRule" AS rule JOIN "SmartCookbook" AS cookbook ON cookbook."id" = rule."cookbookId"
      WHERE cookbook."ownerId" = ? ORDER BY rule."position" ASC`, ownerId],
      ]);
      return toCookbooks(cookbooks!, rules!);
    },
    async find(cookbookId) {
      const [cookbooks, rules] = await d1ReadBatch(d1, [
        [`SELECT ${COOKBOOK_COLUMNS} FROM "SmartCookbook" WHERE "id" = ?`, cookbookId],
        [`SELECT ${RULE_COLUMNS} FROM "SmartCookbookRule" AS rule WHERE rule."cookbookId" = ? ORDER BY rule."position" ASC`, cookbookId],
      ]);
      return toCookbooks(cookbooks!, rules!)[0] ?? null;
    },
    async create(ownerId, title, rules) {
      const id = crypto.randomUUID();
      const at = d1Timestamp(now());
      try {
        await d1WriteBatch(d1, [
          [`INSERT INTO "SmartCookbook" ("id", "ownerId", "title", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)`, id, ownerId, title, at, at],
          ...ruleInserts(id, rules),
        ]);
      } catch (error) {
        if (isTitleTaken(error)) return { ok: false, reason: "taken" };
        throw error;
      }
      return { ok: true, cookbook: { id, ownerId, title, rules } };
    },
    async rename(cookbookId, title) {
      try {
        await d1WriteBatch(d1, [[`UPDATE "SmartCookbook" SET "title" = ?, "updatedAt" = ? WHERE "id" = ?`, title, d1Timestamp(now()), cookbookId]]);
      } catch (error) {
        if (isTitleTaken(error)) return { ok: false, reason: "taken" };
        throw error;
      }
      return { ok: true };
    },
    async replaceRules(cookbookId, rules) {
      // One batch: the old rules go and the new ones go in together, or nothing changes.
      await d1WriteBatch(d1, [
        [`DELETE FROM "SmartCookbookRule" WHERE "cookbookId" = ?`, cookbookId],
        ...ruleInserts(cookbookId, rules),
        [`UPDATE "SmartCookbook" SET "updatedAt" = ? WHERE "id" = ?`, d1Timestamp(now()), cookbookId],
      ]);
    },
    async delete(cookbookId) {
      // The rules go with it, in the same batch rather than relying on the cascade.
      await d1WriteBatch(d1, [
        [`DELETE FROM "SmartCookbookRule" WHERE "cookbookId" = ?`, cookbookId],
        [`DELETE FROM "SmartCookbook" WHERE "id" = ?`, cookbookId],
      ]);
    },
    async repoint(cookbookId, { side, from, to }) {
      // One statement either way: the rule keeps its place and takes the other organizer, or goes.
      await d1WriteBatch(d1, [to
        ? [`UPDATE "SmartCookbookRule" SET "organizerId" = ? WHERE "cookbookId" = ? AND "side" = ? AND "organizerId" = ?`, to, cookbookId, side, from]
        : [`DELETE FROM "SmartCookbookRule" WHERE "cookbookId" = ? AND "side" = ? AND "organizerId" = ?`, cookbookId, side, from]]);
    },
  };
}

/**
 * A cook's organizers from D1. Each kind the smart cookbook pages ask for comes from one query of every organizer the
 * cook has, made once per reader, which is made once per request.
 */
export function d1OrganizerReader(d1: D1ReadDatabase): OrganizerReader {
  const byOwner = new Map<string, Promise<Organizer[]>>();
  const all = (ownerId: string) => {
    let organizers = byOwner.get(ownerId);
    if (!organizers) {
      organizers = d1ReadBatch(d1, [[`SELECT "id", "ownerId", "kind", "name", "slug" FROM "Organizer" WHERE "ownerId" = ?`, ownerId]])
        .then(([rows]) => rows!.map((row) => ({
          id: String(row.id),
          ownerId: String(row.ownerId),
          // Rows are written through the Kitchen rules, so the stored kind is one of ORGANIZER_KINDS.
          kind: parseOrganizerKind(row.kind) as OrganizerKind,
          name: String(row.name),
          slug: String(row.slug),
        })));
      // A failed read is not kept, so the next ask tries again.
      organizers.catch(() => byOwner.delete(ownerId));
      byOwner.set(ownerId, organizers);
    }
    return organizers;
  };
  return {
    async organizersOf(ownerId, kind) {
      return (await all(ownerId)).filter((organizer) => organizer.kind === kind);
    },
  };
}
