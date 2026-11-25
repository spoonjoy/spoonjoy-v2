// The Chefs page's reads on D1, in one batch, so the page builds no Prisma client: on merge-group run 45528383350 a
// wedged Prisma engine failed every Prisma page in its isolate, /chefs among them. It reads what the Prisma path
// reads (the viewer, both sides of the chef graph, the activity feed and the viewer's hides) with the same rules:
// the graph runs fellow-chefs' own statements, and the feed keeps the Prisma reader's filters, with the recipe
// visibility rule as readableRecipeSqlForViewerId.
import { readableRecipeSqlForViewerId } from "~/domains/kitchen";
import { activityFromSources, chefRef, type ChefActivityRow, type ChefActivitySources, type ChefRef } from "~/lib/chef-activity.server";
import { d1DateTime, d1ReadBatch, type D1Query, type D1ReadDatabase, type D1Row } from "~/lib/d1-read.server";
import { fellowChefListFromRows, fellowChefListQueries, type FellowChefListResult } from "~/lib/fellow-chefs.server";
import { hidesFromRows, viewerHidesQuery, type ViewerHides } from "~/lib/moderation.server";

export type ChefsPageData = {
  viewer: ChefRef;
  fellowChefs: FellowChefListResult;
  chefsUsingMyRecipes: FellowChefListResult;
  activity: ChefActivityRow[];
  hides: ViewerHides;
};

const EVENT_COLUMNS = (event: string, at: string, recipe: string, chef: string) => `${event}."id" AS "id", ${event}."${at}" AS "at",
  ${recipe}."id" AS "recipeId", ${recipe}."title" AS "recipeTitle",
  ${chef}."id" AS "chefId", ${chef}."username" AS "chefUsername", ${chef}."photoUrl" AS "chefPhotoUrl"`;

const COOKBOOK_COLUMNS = `c."id" AS "cookbookId", c."title" AS "cookbookTitle"`;

function activityQueries(userId: string): D1Query[] {
  const readable = (alias: string) => readableRecipeSqlForViewerId(alias, userId);
  const r = readable("r");
  const src = readable("src");
  return [
    // outbound spoons: the viewer cooked another cook's recipe they may still read.
    [`SELECT ${EVENT_COLUMNS("s", "cookedAt", "r", "u")} FROM "RecipeSpoon" s
      JOIN "Recipe" r ON r."id" = s."recipeId" JOIN "User" u ON u."id" = r."chefId"
      WHERE s."chefId" = ? AND s."deletedAt" IS NULL AND r."deletedAt" IS NULL AND r."chefId" <> ? AND ${r.sql}`,
    userId, userId, ...r.params],
    // inbound spoons: another cook cooked the viewer's recipe.
    [`SELECT ${EVENT_COLUMNS("s", "cookedAt", "r", "u")} FROM "RecipeSpoon" s
      JOIN "Recipe" r ON r."id" = s."recipeId" JOIN "User" u ON u."id" = s."chefId"
      WHERE s."chefId" <> ? AND s."deletedAt" IS NULL AND r."chefId" = ? AND r."deletedAt" IS NULL`,
    userId, userId],
    // outbound forks: the viewer forked another cook's recipe they may still read.
    [`SELECT ${EVENT_COLUMNS("fk", "createdAt", "src", "u")} FROM "Recipe" fk
      JOIN "Recipe" src ON src."id" = fk."sourceRecipeId" JOIN "User" u ON u."id" = src."chefId"
      WHERE fk."chefId" = ? AND fk."deletedAt" IS NULL AND src."deletedAt" IS NULL AND src."chefId" <> ? AND ${src.sql}`,
    userId, userId, ...src.params],
    // inbound forks: another cook forked the viewer's recipe.
    [`SELECT ${EVENT_COLUMNS("fk", "createdAt", "src", "u")} FROM "Recipe" fk
      JOIN "Recipe" src ON src."id" = fk."sourceRecipeId" JOIN "User" u ON u."id" = fk."chefId"
      WHERE fk."chefId" <> ? AND fk."deletedAt" IS NULL AND src."chefId" = ? AND src."deletedAt" IS NULL`,
    userId, userId],
    // outbound saves: the viewer saved another cook's recipe they may still read.
    [`SELECT ${EVENT_COLUMNS("ric", "createdAt", "r", "u")}, ${COOKBOOK_COLUMNS} FROM "RecipeInCookbook" ric
      JOIN "Recipe" r ON r."id" = ric."recipeId" JOIN "User" u ON u."id" = r."chefId" JOIN "Cookbook" c ON c."id" = ric."cookbookId"
      WHERE ric."addedById" = ? AND r."deletedAt" IS NULL AND r."chefId" <> ? AND ${r.sql}`,
    userId, userId, ...r.params],
    // inbound saves: another cook saved the viewer's recipe.
    [`SELECT ${EVENT_COLUMNS("ric", "createdAt", "r", "u")}, ${COOKBOOK_COLUMNS} FROM "RecipeInCookbook" ric
      JOIN "Recipe" r ON r."id" = ric."recipeId" JOIN "User" u ON u."id" = ric."addedById" JOIN "Cookbook" c ON c."id" = ric."cookbookId"
      WHERE ric."addedById" <> ? AND r."chefId" = ? AND r."deletedAt" IS NULL`,
    userId, userId],
  ];
}

function chefOf(row: D1Row) {
  return { id: String(row.chefId), username: String(row.chefUsername), photoUrl: row.chefPhotoUrl === null ? null : String(row.chefPhotoUrl) };
}

function recipeOf(row: D1Row) {
  return { id: String(row.recipeId), title: String(row.recipeTitle) };
}

function cookbookOf(row: D1Row) {
  return { id: String(row.cookbookId), title: String(row.cookbookTitle) };
}

function sourcesFromRows([outSpoons, inSpoons, outForks, inForks, outSaves, inSaves]: D1Row[][]): ChefActivitySources {
  const at = (row: D1Row) => d1DateTime(row.at, "activity.at");
  return {
    outboundSpoons: outSpoons!.map((row) => ({ id: String(row.id), cookedAt: at(row), recipe: { ...recipeOf(row), chef: chefOf(row) } })),
    inboundSpoons: inSpoons!.map((row) => ({ id: String(row.id), cookedAt: at(row), chef: chefOf(row), recipe: recipeOf(row) })),
    outboundForks: outForks!.map((row) => ({ id: String(row.id), createdAt: at(row), sourceRecipe: { ...recipeOf(row), chef: chefOf(row) } })),
    inboundForks: inForks!.map((row) => ({ id: String(row.id), createdAt: at(row), chef: chefOf(row), sourceRecipe: recipeOf(row) })),
    outboundSaves: outSaves!.map((row) => ({ id: String(row.id), createdAt: at(row), cookbook: cookbookOf(row), recipe: { ...recipeOf(row), chef: chefOf(row) } })),
    inboundSaves: inSaves!.map((row) => ({ id: String(row.id), createdAt: at(row), addedBy: chefOf(row), cookbook: cookbookOf(row), recipe: recipeOf(row) })),
  };
}

/** Everything the Chefs page shows, before hides are applied, in one D1 batch. */
export async function loadChefsPageFromD1(d1: D1ReadDatabase, userId: string): Promise<ChefsPageData> {
  const [fellowList, fellowCount] = fellowChefListQueries("viewer", userId);
  const [visitorList, visitorCount] = fellowChefListQueries("chef", userId);
  const [viewerRows, fellowRows, fellowTotal, visitorRows, visitorTotal, hideRows, ...activityRows] = await d1ReadBatch(d1, [
    [`SELECT "id", "username", "photoUrl" FROM "User" WHERE "id" = ?`, userId],
    fellowList,
    fellowCount,
    visitorList,
    visitorCount,
    viewerHidesQuery(userId),
    ...activityQueries(userId),
  ]);
  const viewerRow = viewerRows![0];
  if (!viewerRow) throw new Error(`No user ${userId} for the Chefs page`);
  const viewer = chefRef({ id: String(viewerRow.id), username: String(viewerRow.username), photoUrl: viewerRow.photoUrl === null ? null : String(viewerRow.photoUrl) });
  return {
    viewer,
    fellowChefs: fellowChefListFromRows(fellowRows!, fellowTotal!),
    chefsUsingMyRecipes: fellowChefListFromRows(visitorRows!, visitorTotal!),
    activity: activityFromSources(viewer, sourcesFromRows(activityRows)),
    hides: hidesFromRows(hideRows!),
  };
}
