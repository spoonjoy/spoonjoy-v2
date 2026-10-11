// @vitest-environment node
// Keeping the search index current when D1's connection drops. A search first checks the index
// (a batch that also makes its tables if missing), then installs it, rebuilds it, or re-indexes
// the entities queued since. After each outcome of each of those writes (it never ran, it
// committed but its answer was lost, or it committed late) the search answers, and the index
// holds one document per entity, as a single clean run leaves it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { ensureSearchIndexFresh, searchSpoonjoy, searchSpoonjoyFromD1 } from "~/lib/search.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { flakyD1, NETWORK_LOST_MESSAGE, type FlakyOutcome } from "../helpers/flaky-d1";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];

// Each write batch, told apart by a statement only it has.
const CHECK = /FROM "SearchDirtyEntity" ORDER BY "seq"/;
const INSTALL_TABLES = /^(?![\s\S]*FROM "SearchIndexMetadata" WHERE)CREATE VIRTUAL TABLE/;
const INSTALL_TRIGGERS = /DROP TRIGGER IF EXISTS/;
const REBUILD = /DELETE FROM "SearchDocumentKey"/;
const REINDEX = /DELETE FROM "SearchDirtyEntity"\s+WHERE "seq" <= \?\s+AND/;

let db: PrismaClient;
let d1: SqliteD1;
let chefId: string;

async function addRecipe(title: string) {
  return db.recipe.create({ data: { title, description: `${title} tonight`, chefId } });
}

async function documentsFor(recipeId: string) {
  const rows = await db.$queryRawUnsafe<Array<{ n: bigint | number }>>(
    `SELECT COUNT(*) AS n FROM "SearchDocument" WHERE entityType = 'recipe' AND entityId = ?`,
    recipeId,
  );
  return Number(rows[0]!.n);
}

beforeEach(async () => {
  db = await getLocalDb();
  await cleanupDatabase();
  d1 = sqliteD1();
  chefId = (await db.user.create({ data: createTestUser() })).id;
  // An index that is not installed, so the first search installs and rebuilds it.
  await db.$executeRawUnsafe(`DELETE FROM "SearchIndexMetadata"`).catch(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  d1.close();
  await cleanupDatabase();
});

describe("search index writes after a transient D1 error", () => {
  it.each(OUTCOMES)("installs and rebuilds the index once, then re-indexes a new recipe once (%s)", async (outcome) => {
    const word = `quince${faker.string.alpha(6).toLowerCase()}`;
    const first = await addRecipe(`${word} tart`);
    const flaky = flakyD1(d1.binding);
    flaky.failNext(CHECK, outcome);
    flaky.failNext(INSTALL_TABLES, outcome);
    flaky.failNext(INSTALL_TRIGGERS, outcome);
    flaky.failNext(REBUILD, outcome);

    const installed = await searchSpoonjoyFromD1(flaky.binding, { query: word, scope: "recipes" });

    expect(installed.map((result) => result.id)).toEqual([first.id]);
    expect(flaky.failures()).toBe(4);
    await expect(documentsFor(first.id)).resolves.toBe(1);

    const second = await addRecipe(`${word} jam`);
    flaky.failNext(CHECK, outcome);
    flaky.failNext(REINDEX, outcome);

    const reindexed = await searchSpoonjoyFromD1(flaky.binding, { query: word, scope: "recipes" });

    expect(reindexed.map((result) => result.id).sort()).toEqual([first.id, second.id].sort());
    expect(flaky.failures()).toBe(6);
    await expect(documentsFor(first.id)).resolves.toBe(1);
    await expect(documentsFor(second.id)).resolves.toBe(1);
  });

  it("gives up with a retryable error when the database stays unavailable", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(CHECK, "lost", "lost", "lost", "lost");

    const failure = searchSpoonjoyFromD1(flaky.binding, { query: "anything" });

    await expect(failure).rejects.toBeInstanceOf(D1WriteUnavailableError);
    await expect(failure).rejects.toMatchObject({ scope: "search.check" });
  });

  it("runs a Prisma search's index writes again after a transient error", async () => {
    const word = `medlar${faker.string.alpha(6).toLowerCase()}`;
    const recipe = await addRecipe(`${word} cake`);
    const execute = db.$executeRawUnsafe.bind(db);
    let failed = 0;
    vi.spyOn(db, "$executeRawUnsafe").mockImplementation(((sql: string, ...values: unknown[]) => {
      if (failed === 0 && sql.startsWith(`DELETE FROM "SearchDocumentKey"`)) {
        failed += 1;
        return Promise.reject(new Error(NETWORK_LOST_MESSAGE));
      }
      return execute(sql, ...values);
    }) as typeof db.$executeRawUnsafe);

    await expect(ensureSearchIndexFresh(db)).resolves.toBeGreaterThan(0);
    expect(failed).toBe(1);
    expect((await searchSpoonjoy(db, { query: word, scope: "recipes" })).map((result) => result.id)).toEqual([recipe.id]);
    await expect(documentsFor(recipe.id)).resolves.toBe(1);
  });
});
