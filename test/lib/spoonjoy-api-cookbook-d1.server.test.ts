// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { ApiPrincipal } from "~/lib/api-auth.server";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { getLocalDb } from "~/lib/db.server";
import { callSpoonjoyApiOperation, type SpoonjoyApiContext } from "~/lib/spoonjoy-api.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// The MCP add_recipe_to_cookbook tool with a D1 binding: it now uses the cookbook membership
// write the web and REST paths use (the membership and the cookbook touch in one batch), so
// a concurrent add of the same recipe answers "already in the cookbook" rather than
// surfacing the unique-constraint error.

let db: PrismaClient;
let d1: SqliteD1;
let principal: ApiPrincipal;

const OLD = new Date("2026-01-01T00:00:00.000Z");

function context(DB?: D1ReadDatabase): SpoonjoyApiContext {
  return { db, principal, env: DB ? { DB } : null };
}

async function seed(label: string) {
  const cookbook = await db.cookbook.create({ data: { title: `Book ${label}`, authorId: principal.id, updatedAt: OLD } });
  const recipe = await db.recipe.create({ data: { title: `Recipe ${label}`, chefId: principal.id } });
  return { cookbookId: cookbook.id, recipeId: recipe.id };
}

async function membership(seeded: Awaited<ReturnType<typeof seed>>) {
  const cookbook = await db.cookbook.findUniqueOrThrow({ where: { id: seeded.cookbookId } });
  return {
    memberships: await db.recipeInCookbook.count({ where: { cookbookId: seeded.cookbookId, recipeId: seeded.recipeId } }),
    touched: cookbook.updatedAt.getTime() > OLD.getTime(),
  };
}

describe("MCP add_recipe_to_cookbook on a D1 binding", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
    const testUser = createTestUser();
    const user = await db.user.create({ data: { ...testUser, email: testUser.email.toLowerCase() } });
    principal = { id: user.id, email: user.email, username: user.username, source: "bearer", scopes: ["kitchen:read", "kitchen:write"] };
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("adds the recipe and touches the cookbook in one batch, as the Prisma path does", async () => {
    const viaPrisma = await seed("prisma");
    const viaD1 = await seed("d1");

    const prismaAnswer = await callSpoonjoyApiOperation("add_recipe_to_cookbook", viaPrisma, context());
    const before = d1.roundTrips();
    const d1Answer = await callSpoonjoyApiOperation("add_recipe_to_cookbook", viaD1, context(d1.binding));

    expect(d1.roundTrips() - before).toBe(1);
    expect(d1Answer).toMatchObject({ added: true, cookbook: { recipeCount: 1 } });
    expect(prismaAnswer).toMatchObject({ added: true, cookbook: { recipeCount: 1 } });
    expect(await membership(viaD1)).toEqual({ memberships: 1, touched: true });
    expect(await membership(viaPrisma)).toEqual({ memberships: 1, touched: true });

    // Adding again is the idempotent "already there" answer.
    await expect(callSpoonjoyApiOperation("add_recipe_to_cookbook", viaD1, context(d1.binding)))
      .resolves.toMatchObject({ added: false, cookbook: { recipeCount: 1 } });
  });

  it("answers 'already in the cookbook' when another add lands between the check and the batch", async () => {
    const seeded = await seed("race");
    let pending = true;
    const interleaved: D1ReadDatabase = {
      prepare: (sql) => d1.binding.prepare(sql),
      async batch(statements) {
        if (pending) {
          pending = false;
          await db.recipeInCookbook.create({ data: { ...seeded, addedById: principal.id } });
        }
        return d1.binding.batch(statements as never);
      },
    };

    await expect(callSpoonjoyApiOperation("add_recipe_to_cookbook", seeded, context(interleaved)))
      .resolves.toMatchObject({ added: false, cookbook: { recipeCount: 1 } });
    expect(await membership(seeded)).toEqual({ memberships: 1, touched: true });
  });
});
