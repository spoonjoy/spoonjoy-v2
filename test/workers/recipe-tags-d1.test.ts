import { env } from "cloudflare:test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "../../app/lib/db.server";
import { replaceRecipeTagMetadata } from "../../app/lib/recipe-tags.server";

interface TestD1Result<T = unknown> {
  meta: { changes: number };
  results: T[];
  success: boolean;
}

interface TestD1Statement {
  all<T>(): Promise<TestD1Result<T>>;
  bind(...values: unknown[]): TestD1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<TestD1Result>;
}

interface TestD1Database {
  batch(statements: TestD1Statement[]): Promise<TestD1Result[]>;
  exec(sql: string): Promise<unknown>;
  prepare(sql: string): TestD1Statement;
}

interface RawMetadataRow {
  course: "main" | "side" | "appetizer" | "dessert" | null;
  label: string | null;
  normalizedLabel: string | null;
  recipeUpdatedAt: string;
  tagCreatedAt: string | null;
  tagId: string | null;
  tagUpdatedAt: string | null;
}

interface MetadataState {
  course: RawMetadataRow["course"];
  labels: string[];
  recipeUpdatedAt: string;
  tagTimestamps: Array<{ createdAt: string; updatedAt: string }>;
}

const USER_ID = "unit-6-1-recipe-tags-d1-user";
const RECIPE_ID = "unit-6-1-recipe-tags-d1-recipe";
const ORIGINAL_TAG_ID = "unit-6-1-recipe-tags-d1-original";
const ABORT_TRIGGER = "RecipeTag_unit_6_1_abort";
const ORIGINAL_TIMESTAMP = "2026-07-23T18:00:00.000Z";
const FAILURE_TIMESTAMP = "2026-07-23T18:01:00.000Z";
const WRITER_A_TIMESTAMP = "2026-07-23T18:02:00.000Z";
const WRITER_B_TIMESTAMP = "2026-07-23T18:03:00.000Z";

const createdSchema = {
  addedCourse: false,
  recipe: false,
  recipeTag: false,
  user: false,
};

function database(): TestD1Database {
  return (env as unknown as { DB: TestD1Database }).DB;
}

async function execute(sql: string, ...values: unknown[]) {
  await database().prepare(sql).bind(...values).run();
}

async function tableExists(name: string): Promise<boolean> {
  const row = await database().prepare(`
    SELECT 1 AS "present"
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).bind(name).first<{ present: number }>();
  return row?.present === 1;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await database().prepare(`PRAGMA table_info("${table}")`)
    .all<{ name: string }>();
  return rows.results.some((row) => row.name === column);
}

async function ensureSchema() {
  await database().exec("PRAGMA foreign_keys = ON");
  if (!(await tableExists("User"))) {
    await execute(`
      CREATE TABLE "User" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "email" TEXT NOT NULL UNIQUE,
        "username" TEXT NOT NULL UNIQUE,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    createdSchema.user = true;
  }

  if (!(await tableExists("Recipe"))) {
    await execute(`
      CREATE TABLE "Recipe" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "title" TEXT NOT NULL,
        "chefId" TEXT NOT NULL,
        "deletedAt" DATETIME,
        "course" TEXT CHECK (
          "course" IS NULL OR "course" IN ('main','side','appetizer','dessert')
        ),
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("chefId") REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
    createdSchema.recipe = true;
  } else if (!(await columnExists("Recipe", "course"))) {
    await execute(`
      ALTER TABLE "Recipe" ADD COLUMN "course" TEXT
      CHECK ("course" IS NULL OR "course" IN ('main','side','appetizer','dessert'))
    `);
    createdSchema.addedCourse = true;
  }

  if (!(await tableExists("RecipeTag"))) {
    await execute(`
      CREATE TABLE "RecipeTag" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "recipeId" TEXT NOT NULL,
        "label" TEXT NOT NULL,
        "normalizedLabel" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE
      )
    `);
    await execute(`
      CREATE UNIQUE INDEX "RecipeTag_recipeId_normalizedLabel_key"
      ON "RecipeTag"("recipeId", "normalizedLabel")
    `);
    await execute(`
      CREATE INDEX "RecipeTag_normalizedLabel_recipeId_idx"
      ON "RecipeTag"("normalizedLabel", "recipeId")
    `);
    createdSchema.recipeTag = true;
  }
}

async function cleanupFixture() {
  await database().exec(`DROP TRIGGER IF EXISTS "${ABORT_TRIGGER}"`);
  if (await tableExists("RecipeTag")) {
    await execute(`DELETE FROM "RecipeTag" WHERE "recipeId" = ?`, RECIPE_ID);
  }
  if (await tableExists("Recipe")) {
    await execute(`DELETE FROM "Recipe" WHERE "id" = ?`, RECIPE_ID);
  }
  if (await tableExists("User")) {
    await execute(`DELETE FROM "User" WHERE "id" = ?`, USER_ID);
  }
}

async function seedFixture() {
  await cleanupFixture();
  await execute(
    `INSERT INTO "User" ("id", "email", "username") VALUES (?, ?, ?)`,
    USER_ID,
    "unit-6-1-recipe-tags-d1@example.test",
    "unit_6_1_recipe_tags_d1",
  );
  await execute(`
    INSERT INTO "Recipe" (
      "id", "title", "chefId", "course", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?)
  `, RECIPE_ID, "Unit 6.1 D1 Recipe", USER_ID, null, ORIGINAL_TIMESTAMP, ORIGINAL_TIMESTAMP);
  await execute(`
    INSERT INTO "RecipeTag" (
      "id", "recipeId", "label", "normalizedLabel", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?)
  `, ORIGINAL_TAG_ID, RECIPE_ID, "Original", "original", ORIGINAL_TIMESTAMP, ORIGINAL_TIMESTAMP);
}

async function readMetadataState(): Promise<MetadataState> {
  const response = await database().prepare(`
    SELECT
      recipe."course" AS "course",
      recipe."updatedAt" AS "recipeUpdatedAt",
      tag."id" AS "tagId",
      tag."label" AS "label",
      tag."normalizedLabel" AS "normalizedLabel",
      tag."createdAt" AS "tagCreatedAt",
      tag."updatedAt" AS "tagUpdatedAt"
    FROM "Recipe" AS recipe
    LEFT JOIN "RecipeTag" AS tag ON tag."recipeId" = recipe."id"
    WHERE recipe."id" = ?
    ORDER BY tag."normalizedLabel", tag."id"
  `).bind(RECIPE_ID).all<RawMetadataRow>();
  const first = response.results[0];
  if (!first) throw new Error("Dedicated recipe fixture is missing");
  return {
    course: first.course,
    labels: response.results.flatMap((row) => row.normalizedLabel ? [row.normalizedLabel] : []),
    recipeUpdatedAt: first.recipeUpdatedAt,
    tagTimestamps: response.results.flatMap((row) => (
      row.tagId && row.tagCreatedAt && row.tagUpdatedAt
        ? [{ createdAt: row.tagCreatedAt, updatedAt: row.tagUpdatedAt }]
        : []
    )),
  };
}

function barrier(parties: number) {
  let arrivals = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === parties) release();
    await ready;
  };
}

describe("recipe tag native D1 atomicity", () => {
  beforeAll(ensureSchema);
  beforeEach(seedFixture);
  afterEach(cleanupFixture);

  afterAll(async () => {
    await cleanupFixture();
    if (createdSchema.recipeTag) await database().exec(`DROP TABLE IF EXISTS "RecipeTag"`);
    if (createdSchema.addedCourse) {
      await database().exec(`ALTER TABLE "Recipe" DROP COLUMN "course"`);
    }
    if (createdSchema.recipe) await database().exec(`DROP TABLE IF EXISTS "Recipe"`);
    if (createdSchema.user) await database().exec(`DROP TABLE IF EXISTS "User"`);
  });

  it("rolls back course, tags, and timestamps when a later native batch statement fails", async () => {
    await execute(`
      CREATE TRIGGER "${ABORT_TRIGGER}"
      BEFORE INSERT ON "RecipeTag"
      WHEN NEW."recipeId" = '${RECIPE_ID}' AND NEW."normalizedLabel" = 'explode'
      BEGIN
        SELECT RAISE(ABORT, 'unit_6_1_recipe_tag_batch_failure');
      END
    `);
    const prisma = await getDb({ DB: database() as unknown as D1Database });

    try {
      await expect(replaceRecipeTagMetadata({
        database: prisma,
        nativeDatabase: database(),
        userId: USER_ID,
        recipeId: RECIPE_ID,
        course: "side",
        tags: ["First", "Explode"],
      }, {
        now: () => new Date(FAILURE_TIMESTAMP),
        randomId: (() => {
          const ids = ["unit-6-1-first", "unit-6-1-explode"];
          return () => ids.shift() ?? "unexpected-extra-id";
        })(),
      })).rejects.toThrow(/unit_6_1_recipe_tag_batch_failure/);
    } finally {
      await prisma.$disconnect();
    }

    expect(await readMetadataState()).toEqual({
      course: null,
      labels: ["original"],
      recipeUpdatedAt: ORIGINAL_TIMESTAMP,
      tagTimestamps: [{ createdAt: ORIGINAL_TIMESTAMP, updatedAt: ORIGINAL_TIMESTAMP }],
    });
  });

  it("never exposes mixed metadata during concurrent native replacements", async () => {
    const arrive = barrier(2);
    const realDatabase = database();
    const gatedDatabase: TestD1Database = {
      exec: realDatabase.exec.bind(realDatabase),
      prepare: realDatabase.prepare.bind(realDatabase),
      async batch(statements) {
        await arrive();
        return realDatabase.batch(statements);
      },
    };
    const prismaA = await getDb({ DB: realDatabase as unknown as D1Database });
    const prismaB = await getDb({ DB: realDatabase as unknown as D1Database });
    const observed: MetadataState[] = [await readMetadataState()];
    let writersDone = false;
    const observer = (async () => {
      while (!writersDone) {
        observed.push(await readMetadataState());
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    })();
    const replace = (
      prisma: Awaited<ReturnType<typeof getDb>>,
      course: "main" | "dessert",
      tags: string[],
      timestamp: string,
      idPrefix: string,
    ) => {
      let id = 0;
      return replaceRecipeTagMetadata({
        database: prisma,
        nativeDatabase: gatedDatabase,
        userId: USER_ID,
        recipeId: RECIPE_ID,
        course,
        tags,
      }, {
        now: () => new Date(timestamp),
        randomId: () => `${idPrefix}-${id += 1}`,
      });
    };

    let outcomes: PromiseSettledResult<unknown>[];
    try {
      outcomes = await Promise.allSettled([
        replace(prismaA, "main", ["Alpha", "Shared A"], WRITER_A_TIMESTAMP, "writer-a"),
        replace(prismaB, "dessert", ["Beta", "Shared B", "Sweet"], WRITER_B_TIMESTAMP, "writer-b"),
      ]);
    } finally {
      writersDone = true;
      await observer;
      await Promise.all([prismaA.$disconnect(), prismaB.$disconnect()]);
    }

    const finalState = await readMetadataState();
    observed.push(finalState);
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")
      .every((outcome) => outcome.reason instanceof Error)).toBe(true);

    const completeStates: MetadataState[] = [
      {
        course: null,
        labels: ["original"],
        recipeUpdatedAt: ORIGINAL_TIMESTAMP,
        tagTimestamps: [{ createdAt: ORIGINAL_TIMESTAMP, updatedAt: ORIGINAL_TIMESTAMP }],
      },
      {
        course: "main",
        labels: ["alpha", "shared a"],
        recipeUpdatedAt: WRITER_A_TIMESTAMP,
        tagTimestamps: Array.from({ length: 2 }, () => ({
          createdAt: WRITER_A_TIMESTAMP,
          updatedAt: WRITER_A_TIMESTAMP,
        })),
      },
      {
        course: "dessert",
        labels: ["beta", "shared b", "sweet"],
        recipeUpdatedAt: WRITER_B_TIMESTAMP,
        tagTimestamps: Array.from({ length: 3 }, () => ({
          createdAt: WRITER_B_TIMESTAMP,
          updatedAt: WRITER_B_TIMESTAMP,
        })),
      },
    ];
    for (const state of observed) expect(completeStates).toContainEqual(state);
    expect(completeStates.slice(1)).toContainEqual(finalState);
  });
});
