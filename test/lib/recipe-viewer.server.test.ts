// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { recipeViewerFor } from "~/lib/recipe-viewer.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

let db: PrismaClient;
let d1: SqliteD1;
let ann: string;
let ben: string;
let cal: string;
let dee: string;

async function household(...userIds: string[]) {
  const made = await db.household.create({ data: { name: "Home" } });
  for (const userId of userIds) await db.householdMember.create({ data: { householdId: made.id, userId, role: "member" } });
}

beforeEach(async () => {
  db = await getLocalDb();
  await cleanupDatabase();
  d1 = sqliteD1();
  [ann, ben, cal, dee] = await Promise.all([1, 2, 3, 4].map(async () => (await db.user.create({ data: createTestUser() })).id));
  await household(ann, ben);
  await household(ann, cal);
  await household(dee);
});

afterEach(async () => {
  d1.close();
  await cleanupDatabase();
});

describe("recipeViewerFor", () => {
  it("is null when nobody is signed in", async () => {
    expect(await recipeViewerFor(null, { db })).toBeNull();
    expect(await recipeViewerFor(undefined, { d1: d1.binding })).toBeNull();
    expect(await recipeViewerFor("", { db })).toBeNull();
  });

  it("names every cook who shares a household with the viewer, through Prisma", async () => {
    expect(await recipeViewerFor(ann, { db })).toEqual({ id: ann, householdChefIds: new Set([ben, cal]) });
    expect(await recipeViewerFor(ben, { db })).toEqual({ id: ben, householdChefIds: new Set([ann]) });
    expect(await recipeViewerFor(dee, { db })).toEqual({ id: dee, householdChefIds: new Set() });
  });

  it("gives the same answer from D1, and reads D1 rather than Prisma when there is a binding", async () => {
    expect(await recipeViewerFor(ann, { d1: d1.binding, db })).toEqual({ id: ann, householdChefIds: new Set([ben, cal]) });
    expect(await recipeViewerFor(cal, { d1: d1.binding })).toEqual({ id: cal, householdChefIds: new Set([ann]) });
    expect(await recipeViewerFor(dee, { d1: d1.binding })).toEqual({ id: dee, householdChefIds: new Set() });
    expect(d1.statements.every((statement) => statement.sql.includes("HouseholdMember"))).toBe(true);
    expect(d1.statements).toHaveLength(3);
  });
});
