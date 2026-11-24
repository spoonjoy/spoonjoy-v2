// Puts a moved-in recipe's tags, categories and tools on it through Kitchen's organizers, beside any it has. Kitchen
// makes the organizers the cook doesn't have yet and matches the rest by name, whatever their case. Each one a move-in
// puts on a recipe is recorded under its source, so the move-in's page can say how many came over.
import type { PrismaClient } from "@prisma/client";
import { planOrganizerAssignment, prismaOrganizerStore, type OrganizerKind, type OrganizerStore } from "~/domains/kitchen";
import { d1ReadBatch, type D1Query, type D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";

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
    // Kept per move-in, so a later move-in of the same backup counts its own and leaves this one's as it was.
    for (const organizer of linked) {
      const key = { sourceId: moved.sourceId, sourceTable: table, sourceKey: `${moved.jobId}/${organizer.slug}` };
      await db.sourceRecord.upsert({
        where: { sourceId_sourceTable_sourceKey: key },
        create: { id: crypto.randomUUID(), ...key, targetType: "Organizer", targetId: organizer.id, lastJobId: moved.jobId },
        update: { targetId: organizer.id },
      });
    }
  }
}

/** Recipe ids per read, inside D1's limit on bound values. */
const IDS_PER_READ = 90;

/**
 * attachMovedInOrganizers for a chunk of recipes, in two round trips: one read for which recipes are still the cook's,
 * and one write for every organizer, link and record. Each statement finds its organizer by its slug, so an
 * organizer the cook or another save made in between is used rather than made twice. Answers null for each recipe
 * whose organizers are on it now, or the error that kept them off; a failed write is thrown, for each to go alone.
 */
export async function attachMovedInOrganizersTogether(db: D1ReadDatabase, moved: MovedInOrganizers[], now: Date): Promise<Array<Error | null>> {
  const ids = [...new Set(moved.map((recipe) => recipe.recipeId))];
  const reads: D1Query[] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_READ) {
    const some = ids.slice(i, i + IDS_PER_READ);
    reads.push([`SELECT "id", "chefId" FROM "Recipe" WHERE "deletedAt" IS NULL AND "id" IN (${some.map(() => "?").join(", ")})`, ...some]);
  }
  const chefs = new Map((ids.length ? await d1ReadBatch(db, reads) : []).flat().map((row) => [String(row.id), String(row.chefId)]));
  const at = d1Timestamp(now);
  const organizers = new Map<string, D1Query>();
  const links: D1Query[] = [];
  const records: D1Query[] = [];
  const answers = moved.map((recipe) => {
    if (chefs.get(recipe.recipeId) !== recipe.ownerId) return new Error("the recipe is no longer in your kitchen");
    for (const [kind, table] of KINDS) {
      for (const { name, slug } of planOrganizerAssignment([], recipe[table]).create) {
        const which = [recipe.ownerId, kind, slug] as const;
        // Still the cook's when the write runs, not only when it was read.
        const organizer = `"Organizer" WHERE "ownerId" = ? AND "kind" = ? AND "slug" = ?
          AND EXISTS (SELECT 1 FROM "Recipe" WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL)`;
        const live = [recipe.recipeId, recipe.ownerId] as const;
        // The first recipe in the chunk to name a new one gives it its spelling, as one at a time would.
        if (!organizers.has(which.join("\n"))) organizers.set(which.join("\n"), [
          `INSERT INTO "Organizer" ("id", "ownerId", "kind", "name", "slug", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT ("ownerId", "kind", "slug") DO NOTHING`,
          crypto.randomUUID(), recipe.ownerId, kind, name, slug, at, at,
        ]);
        // Adding only: a link the recipe has stays as it is.
        links.push([`INSERT INTO "RecipeOrganizer" ("recipeId", "organizerId", "createdAt") SELECT ?, "id", ? FROM ${organizer} ON CONFLICT DO NOTHING`, recipe.recipeId, at, ...which, ...live]);
        const key = [recipe.sourceId, table, `${recipe.jobId}/${slug}`] as const;
        records.push([
          `INSERT INTO "SourceRecord" ("id", "sourceId", "sourceTable", "sourceKey", "targetType", "targetId", "lastJobId")
           SELECT ?, ?, ?, ?, 'Organizer', "id", ? FROM ${organizer}
           ON CONFLICT ("sourceId", "sourceTable", "sourceKey") DO UPDATE SET "targetId" = excluded."targetId"`,
          crypto.randomUUID(), ...key, recipe.jobId, ...which, ...live,
        ]);
      }
    }
    return null;
  });
  const statements = [...organizers.values(), ...links, ...records];
  if (statements.length) await d1WriteBatch(db, statements);
  return answers;
}

/** How many tags, categories and tools a move-in put on its recipes, each counted once, among those still on a recipe in the kitchen. */
export async function readMoveInOrganizerCounts(db: OrganizerDb, { ownerId, sourceId, jobId }: { ownerId: string; sourceId: string; jobId: string }): Promise<MoveInOrganizerCounts> {
  const rows = await db.$queryRaw<Array<{ entity: string; count: number | bigint }>>`
    SELECT s."sourceTable" AS "entity", COUNT(DISTINCT s."targetId") AS "count" FROM "SourceRecord" s
    JOIN "Organizer" o ON o."id" = s."targetId" AND o."ownerId" = ${ownerId}
    WHERE s."sourceId" = ${sourceId} AND s."lastJobId" = ${jobId} AND s."targetType" = 'Organizer'
      AND EXISTS (SELECT 1 FROM "RecipeOrganizer" ro JOIN "Recipe" r ON r."id" = ro."recipeId" AND r."deletedAt" IS NULL WHERE ro."organizerId" = o."id")
    GROUP BY s."sourceTable"`;
  const counts: MoveInOrganizerCounts = { tags: 0, categories: 0, tools: 0 };
  for (const row of rows) counts[row.entity as keyof MoveInOrganizerCounts] = Number(row.count);
  return counts;
}
