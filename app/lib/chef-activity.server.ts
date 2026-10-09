import type { PrismaClient } from "@prisma/client";

/** Chef graph activity feed shared by the web Chefs route and the native API (`GET /api/v1/me/chefs`). */

export type ChefRef = {
  id: string;
  username: string;
  photoUrl: string | null;
};

export type ActivityKind = "spooned" | "forked" | "saved";
export type ActivityDirection = "outbound" | "inbound";
export type ActivitySourceKind = "fork" | "save" | "spoon";

export type ChefActivityRow = {
  id: string;
  sourceId: string;
  sourceKind: ActivitySourceKind;
  kind: ActivityKind;
  direction: ActivityDirection;
  eventAt: Date;
  actor: ChefRef;
  otherChef: ChefRef;
  recipe: { id: string; title: string } | null;
  cookbook: { id: string; title: string } | null;
  label: string;
};

export function chefRef(chef: { id: string; username: string; photoUrl: string | null }): ChefRef {
  return {
    id: chef.id,
    username: chef.username,
    photoUrl: chef.photoUrl,
  };
}

function activityId(direction: ActivityDirection, sourceKind: ActivitySourceKind, sourceId: string) {
  return `${direction}:${sourceKind}:${sourceId}`;
}

function compareActivity(a: ChefActivityRow, b: ChefActivityRow) {
  const timeDiff = b.eventAt.getTime() - a.eventAt.getTime();
  if (timeDiff !== 0) return timeDiff;
  const sourceDiff = a.sourceKind.localeCompare(b.sourceKind);
  if (sourceDiff !== 0) return sourceDiff;
  return b.sourceId.localeCompare(a.sourceId);
}

export async function chefActivity(database: PrismaClient, userId: string, viewer: ChefRef) {
  const [outboundSpoons, inboundSpoons, outboundForks, inboundForks, outboundSaves, inboundSaves] =
    await Promise.all([
      database.recipeSpoon.findMany({
        where: {
          chefId: userId,
          deletedAt: null,
          recipe: {
            deletedAt: null,
            chefId: { not: userId },
          },
        },
        include: {
          recipe: {
            include: {
              chef: { select: { id: true, username: true, photoUrl: true } },
            },
          },
        },
      }),
      database.recipeSpoon.findMany({
        where: {
          chefId: { not: userId },
          deletedAt: null,
          recipe: {
            chefId: userId,
            deletedAt: null,
          },
        },
        include: {
          chef: { select: { id: true, username: true, photoUrl: true } },
          recipe: { select: { id: true, title: true } },
        },
      }),
      database.recipe.findMany({
        where: {
          chefId: userId,
          deletedAt: null,
          sourceRecipeId: { not: null },
          sourceRecipe: {
            deletedAt: null,
            chefId: { not: userId },
          },
        },
        include: {
          sourceRecipe: {
            include: {
              chef: { select: { id: true, username: true, photoUrl: true } },
            },
          },
        },
      }),
      database.recipe.findMany({
        where: {
          chefId: { not: userId },
          deletedAt: null,
          sourceRecipe: {
            chefId: userId,
            deletedAt: null,
          },
        },
        include: {
          chef: { select: { id: true, username: true, photoUrl: true } },
          sourceRecipe: { select: { id: true, title: true } },
        },
      }),
      database.recipeInCookbook.findMany({
        where: {
          addedById: userId,
          recipe: {
            deletedAt: null,
            chefId: { not: userId },
          },
        },
        include: {
          cookbook: { select: { id: true, title: true } },
          recipe: {
            include: {
              chef: { select: { id: true, username: true, photoUrl: true } },
            },
          },
        },
      }),
      database.recipeInCookbook.findMany({
        where: {
          addedById: { not: userId },
          recipe: {
            chefId: userId,
            deletedAt: null,
          },
        },
        include: {
          addedBy: { select: { id: true, username: true, photoUrl: true } },
          cookbook: { select: { id: true, title: true } },
          recipe: { select: { id: true, title: true } },
        },
      }),
    ]);

  const rows: ChefActivityRow[] = [
    ...outboundSpoons.map((spoon) => {
      const otherChef = chefRef(spoon.recipe.chef);
      return {
        id: activityId("outbound", "spoon", spoon.id),
        sourceId: spoon.id,
        sourceKind: "spoon" as const,
        kind: "spooned" as const,
        direction: "outbound" as const,
        eventAt: spoon.cookedAt,
        actor: viewer,
        otherChef,
        recipe: { id: spoon.recipe.id, title: spoon.recipe.title },
        cookbook: null,
        label: `You cooked ${spoon.recipe.title} from ${otherChef.username}.`,
      };
    }),
    ...inboundSpoons.map((spoon) => {
      const actor = chefRef(spoon.chef);
      return {
        id: activityId("inbound", "spoon", spoon.id),
        sourceId: spoon.id,
        sourceKind: "spoon" as const,
        kind: "spooned" as const,
        direction: "inbound" as const,
        eventAt: spoon.cookedAt,
        actor,
        otherChef: actor,
        recipe: { id: spoon.recipe.id, title: spoon.recipe.title },
        cookbook: null,
        label: `${actor.username} cooked your ${spoon.recipe.title}.`,
      };
    }),
    ...outboundForks.map((fork) => {
      const sourceRecipe = fork.sourceRecipe!;
      const otherChef = chefRef(sourceRecipe.chef);
      return {
        id: activityId("outbound", "fork", fork.id),
        sourceId: fork.id,
        sourceKind: "fork" as const,
        kind: "forked" as const,
        direction: "outbound" as const,
        eventAt: fork.createdAt,
        actor: viewer,
        otherChef,
        recipe: { id: sourceRecipe.id, title: sourceRecipe.title },
        cookbook: null,
        label: `You forked ${sourceRecipe.title} from ${otherChef.username}.`,
      };
    }),
    ...inboundForks.map((fork) => {
      const actor = chefRef(fork.chef);
      return {
        id: activityId("inbound", "fork", fork.id),
        sourceId: fork.id,
        sourceKind: "fork" as const,
        kind: "forked" as const,
        direction: "inbound" as const,
        eventAt: fork.createdAt,
        actor,
        otherChef: actor,
        recipe: { id: fork.sourceRecipe!.id, title: fork.sourceRecipe!.title },
        cookbook: null,
        label: `${actor.username} forked your ${fork.sourceRecipe!.title}.`,
      };
    }),
    ...outboundSaves.map((save) => {
      const otherChef = chefRef(save.recipe.chef);
      return {
        id: activityId("outbound", "save", save.id),
        sourceId: save.id,
        sourceKind: "save" as const,
        kind: "saved" as const,
        direction: "outbound" as const,
        eventAt: save.createdAt,
        actor: viewer,
        otherChef,
        recipe: { id: save.recipe.id, title: save.recipe.title },
        cookbook: save.cookbook,
        label: `You saved ${save.recipe.title} from ${otherChef.username}.`,
      };
    }),
    ...inboundSaves.map((save) => {
      const actor = chefRef(save.addedBy);
      return {
        id: activityId("inbound", "save", save.id),
        sourceId: save.id,
        sourceKind: "save" as const,
        kind: "saved" as const,
        direction: "inbound" as const,
        eventAt: save.createdAt,
        actor,
        otherChef: actor,
        recipe: save.recipe,
        cookbook: save.cookbook,
        label: `${actor.username} saved your ${save.recipe.title}.`,
      };
    }),
  ];

  return rows.sort(compareActivity).slice(0, 50);
}
