// The OrganizerStore on Prisma: D1 in the Worker, SQLite in tests. Type-only Prisma import, so this file is safe in any
// bundle. D1 has no interactive transactions, so apply writes in the order that is safe to stop halfway: links are
// added before any are removed, and organizers are deleted last, so a failed merge never takes a recipe off every tag.
import type { PrismaClient } from "@prisma/client";
import type { OrganizerStore } from "../application/organizers";
import { parseOrganizerKind, type Organizer, type OrganizerKind } from "../model/organizer";

type OrganizerDb = Pick<PrismaClient, "organizer" | "recipeOrganizer" | "recipe">;

const ORGANIZER_SELECT = { id: true, ownerId: true, kind: true, name: true, slug: true } as const;

type OrganizerRow = { id: string; ownerId: string; kind: string; name: string; slug: string };

function toOrganizer(row: OrganizerRow): Organizer {
  // Rows are written through the Kitchen rules, so the stored kind is one of ORGANIZER_KINDS.
  return { ...row, kind: parseOrganizerKind(row.kind) as OrganizerKind };
}

const LIVE_RECIPE = { recipe: { deletedAt: null } } as const;

export function prismaOrganizerStore(db: OrganizerDb): OrganizerStore {
  return {
    async organizersOf(ownerId, kind) {
      return (await db.organizer.findMany({ where: { ownerId, kind }, select: ORGANIZER_SELECT })).map(toOrganizer);
    },
    async find(organizerId) {
      const row = await db.organizer.findUnique({ where: { id: organizerId }, select: ORGANIZER_SELECT });
      return row ? toOrganizer(row) : null;
    },
    async liveRecipeChefId(recipeId) {
      const recipe = await db.recipe.findFirst({ where: { id: recipeId, deletedAt: null }, select: { chefId: true } });
      return recipe?.chefId ?? null;
    },
    async create(ownerId, kind, organizers) {
      await db.organizer.createMany({ data: organizers.map(({ name, slug }) => ({ ownerId, kind, name, slug })) });
      const slugs = organizers.map((organizer) => organizer.slug);
      const rows = await db.organizer.findMany({ where: { ownerId, kind, slug: { in: slugs } }, select: ORGANIZER_SELECT });
      return slugs.map((slug) => toOrganizer(rows.find((row) => row.slug === slug)!));
    },
    async organizersOnRecipe(recipeId, kind) {
      const rows = await db.recipeOrganizer.findMany({
        where: { recipeId, organizer: { kind } },
        select: { organizer: { select: ORGANIZER_SELECT } },
      });
      return rows.map((row) => toOrganizer(row.organizer));
    },
    async linksTo(organizerIds) {
      return db.recipeOrganizer.findMany({ where: { organizerId: { in: [...organizerIds] } }, select: { recipeId: true, organizerId: true } });
    },
    async apply({ add, remove, deleteIds = [] }) {
      if (add.length) await db.recipeOrganizer.createMany({ data: add });
      for (const link of remove) await db.recipeOrganizer.deleteMany({ where: link });
      if (deleteIds.length) await db.organizer.deleteMany({ where: { id: { in: deleteIds } } });
    },
    async rename({ id, name, slug }) {
      await db.organizer.update({ where: { id }, data: { name, slug } });
    },
    async liveRecipeCounts(organizerIds) {
      const rows = await db.recipeOrganizer.groupBy({
        by: ["organizerId"],
        where: { organizerId: { in: [...organizerIds] }, ...LIVE_RECIPE },
        _count: { _all: true },
      });
      return new Map(rows.map((row) => [row.organizerId, row._count._all]));
    },
    async liveRecipeIds(organizerId) {
      const rows = await db.recipeOrganizer.findMany({
        where: { organizerId, ...LIVE_RECIPE },
        orderBy: { recipe: { updatedAt: "desc" } },
        select: { recipeId: true },
      });
      return rows.map((row) => row.recipeId);
    },
  };
}
