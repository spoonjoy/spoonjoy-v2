// Puts a moved-in recipe's tags, categories and tools on it through Kitchen's organizers, beside any it has. Kitchen
// makes the organizers the cook doesn't have yet and matches the rest by name, whatever their case. Each one a move-in
// puts on a recipe is recorded under its source, so the move-in's page can say how many came over.
import type { PrismaClient } from "@prisma/client";
import { planOrganizerAssignment, prismaOrganizerStore, type OrganizerKind, type OrganizerStore } from "~/domains/kitchen";

export interface MovedInOrganizers {
  ownerId: string;
  recipeId: string;
  sourceId: string;
  jobId: string;
  tags: string[];
  categories: string[];
  tools: string[];
}

export type MoveInOrganizerCounts = Record<"tags" | "categories" | "tools", number>;

type OrganizerDb = Pick<PrismaClient, "organizer" | "recipeOrganizer" | "recipe" | "sourceRecord" | "$queryRaw">;

const KINDS: ReadonlyArray<readonly [OrganizerKind, keyof MoveInOrganizerCounts]> = [["tag", "tags"], ["category", "categories"], ["tool", "tools"]];

/**
 * Adds them only, so moving the same backup in again changes nothing, and none the cook gave the recipe comes off,
 * even one they put on while this runs.
 */
export async function attachMovedInOrganizers(db: OrganizerDb, moved: MovedInOrganizers, store: OrganizerStore = prismaOrganizerStore(db as PrismaClient)): Promise<void> {
  if ((await store.liveRecipeChefId(moved.recipeId)) !== moved.ownerId) throw new Error("the recipe is no longer in your kitchen");
  for (const [kind, table] of KINDS) {
    const names = moved[table];
    if (!names.length) continue;
    const existing = await store.organizersOf(moved.ownerId, kind);
    const plan = planOrganizerAssignment(existing, names);
    const created = plan.create.length ? await store.create(moved.ownerId, kind, plan.create) : [];
    const linked = [...existing.filter((organizer) => plan.reuse.includes(organizer.id)), ...created];
    const on = new Set((await store.organizersOnRecipe(moved.recipeId, kind)).map((organizer) => organizer.id));
    const add = linked.filter((organizer) => !on.has(organizer.id)).map((organizer) => ({ recipeId: moved.recipeId, organizerId: organizer.id }));
    if (add.length) await store.apply({ add, remove: [] });
    for (const organizer of linked) {
      const key = { sourceId: moved.sourceId, sourceTable: table, sourceKey: organizer.slug };
      await db.sourceRecord.upsert({
        where: { sourceId_sourceTable_sourceKey: key },
        create: { id: crypto.randomUUID(), ...key, targetType: "Organizer", targetId: organizer.id, lastJobId: moved.jobId },
        update: { targetId: organizer.id, lastJobId: moved.jobId },
      });
    }
  }
}

/** How many tags, categories and tools a move-in put on its recipes, each counted once, among those still in the kitchen. */
export async function readMoveInOrganizerCounts(db: OrganizerDb, { ownerId, sourceId, jobId }: { ownerId: string; sourceId: string; jobId: string }): Promise<MoveInOrganizerCounts> {
  const rows = await db.$queryRaw<Array<{ entity: string; count: number | bigint }>>`
    SELECT s."sourceTable" AS "entity", COUNT(*) AS "count" FROM "SourceRecord" s
    JOIN "Organizer" o ON o."id" = s."targetId" AND o."ownerId" = ${ownerId}
    WHERE s."sourceId" = ${sourceId} AND s."lastJobId" = ${jobId} AND s."targetType" = 'Organizer'
    GROUP BY s."sourceTable"`;
  const counts: MoveInOrganizerCounts = { tags: 0, categories: 0, tools: 0 };
  for (const row of rows) counts[row.entity as keyof MoveInOrganizerCounts] = Number(row.count);
  return counts;
}
