// The PlanRuleStore on Prisma: D1 in the Worker, SQLite in tests. Type-only Prisma import, so this file is safe in any bundle.
import type { PrismaClient } from "@prisma/client";
import type { PlanRuleStore } from "../application/plan-rules";
import { parseMealType } from "../model/meal-type";
import type { PlanRule } from "../model/plan-rule";

type RuleDb = Pick<PrismaClient, "planRule" | "organizer" | "recipe">;

function organizerIdsOf(json: string): string[] {
  // Written by insertRule as a JSON array of strings; anything else reads as no organizers.
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function prismaPlanRuleStore(db: RuleDb): PlanRuleStore {
  return {
    async rulesFor(planId) {
      const rows = await db.planRule.findMany({ where: { mealPlanId: planId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      return rows.map((row): PlanRule => ({
        id: row.id,
        weekday: row.weekday,
        mealType: row.mealType === null ? null : parseMealType(row.mealType),
        organizerIds: organizerIdsOf(row.organizerIds),
      }));
    },
    async insertRule(planId, rule) {
      await db.planRule.create({
        data: { id: rule.id, mealPlanId: planId, weekday: rule.weekday, mealType: rule.mealType, organizerIds: JSON.stringify(rule.organizerIds) },
      });
    },
    async deleteRule(planId, ruleId) {
      const { count } = await db.planRule.deleteMany({ where: { id: ruleId, mealPlanId: planId } });
      return count > 0;
    },
    async ownedOrganizerIds(ownerId, organizerIds) {
      if (organizerIds.length === 0) return [];
      const rows = await db.organizer.findMany({ where: { ownerId, id: { in: [...organizerIds] } }, select: { id: true } });
      return rows.map((row) => row.id);
    },
    async pickCandidates(ownerId) {
      const rows = await db.recipe.findMany({
        where: { chefId: ownerId, deletedAt: null },
        select: { id: true, title: true, organizers: { select: { organizerId: true } } },
        orderBy: { id: "asc" },
        take: 2000,
      });
      return rows.map((row) => ({ id: row.id, title: row.title, organizerIds: row.organizers.map((link) => link.organizerId) }));
    },
  };
}
