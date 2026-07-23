import { env } from "cloudflare:test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/recipe/RecipeBuilder", () => ({
  RecipeBuilder: () => null,
}));

import { getDb } from "../../app/lib/db.server";
import { createRecipeDraft } from "../../app/lib/recipe-create.server";
import { replaceRecipeTagMetadata } from "../../app/lib/recipe-tags.server";
import { createUserSessionCookie } from "../../app/lib/session.server";
import { action as editRecipeAction } from "../../app/routes/recipes.$id.edit";

interface TestD1Result<T = unknown> {
  meta: { changes: number };
  results: T[];
  success: boolean;
}

interface TestD1Statement {
  __real?: TestD1Statement;
  __record?: RecordedStatement;
  all<T>(): Promise<TestD1Result<T>>;
  bind(...values: unknown[]): TestD1Statement;
  first<T>(): Promise<T | null>;
  raw<T>(options?: { columnNames?: boolean }): Promise<T>;
  run(): Promise<TestD1Result>;
}

interface RecordedStatement {
  sql: string;
  values: unknown[];
}

interface RecordingD1Database extends TestD1Database {
  batchCalls: RecordedStatement[][];
  records: RecordedStatement[];
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
const CREATE_RECIPE_ID = "unit-6-2-recipe-tags-d1-create";
const COOKBOOK_ID = "unit-6-2-recipe-tags-d1-cookbook";
const MEMBERSHIP_ID = "unit-6-2-recipe-tags-d1-membership";
const ABORT_TRIGGER = "RecipeTag_unit_6_1_abort";
const CREATE_ABORT_TRIGGER = "RecipeTag_unit_6_2_create_abort";
const EDIT_ABORT_TRIGGER = "RecipeTag_unit_6_2_edit_abort";
const ORIGINAL_TIMESTAMP = "2026-07-23T18:00:00.000Z";
const FAILURE_TIMESTAMP = "2026-07-23T18:01:00.000Z";
const WRITER_A_TIMESTAMP = "2026-07-23T18:02:00.000Z";
const WRITER_B_TIMESTAMP = "2026-07-23T18:03:00.000Z";

const createdSchema = {
  addedCourse: false,
  addedDescription: false,
  addedServings: false,
  cookbook: false,
  recipe: false,
  recipeInCookbook: false,
  recipeTag: false,
  user: false,
};

function database(): TestD1Database {
  return (env as unknown as { DB: TestD1Database }).DB;
}

function recordingDatabase(): RecordingD1Database {
  const realDatabase = database();
  const records: RecordedStatement[] = [];
  const batchCalls: RecordedStatement[][] = [];

  const wrap = (statement: TestD1Statement, record: RecordedStatement): TestD1Statement => ({
    __real: statement,
    __record: record,
    all: <T>() => statement.all<T>(),
    bind(...values) {
      record.values = values;
      return wrap(statement.bind(...values), record);
    },
    first: <T>() => statement.first<T>(),
    raw: <T>(options?: { columnNames?: boolean }) => statement.raw<T>(options),
    run: () => statement.run(),
  });

  return {
    records,
    batchCalls,
    exec: realDatabase.exec.bind(realDatabase),
    prepare(sql) {
      const record = { sql, values: [] as unknown[] };
      records.push(record);
      return wrap(realDatabase.prepare(sql), record);
    },
    async batch(statements) {
      batchCalls.push(statements.map((statement) => {
        if (!statement.__record) throw new Error("Missing recorded D1 statement");
        return statement.__record;
      }));
      return realDatabase.batch(statements.map((statement) => statement.__real ?? statement));
    },
  };
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
        "description" TEXT,
        "servings" TEXT,
        "chefId" TEXT NOT NULL,
        "deletedAt" DATETIME,
        "course" TEXT CHECK (
          "course" IS NULL OR "course" IN ('main','side','appetizer','dessert')
        ),
        "activeCoverId" TEXT,
        "activeCoverVariant" TEXT,
        "coverMode" TEXT NOT NULL DEFAULT 'auto',
        "sourceRecipeId" TEXT,
        "sourceUrl" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("chefId") REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
    createdSchema.recipe = true;
  } else {
    if (!(await columnExists("Recipe", "description"))) {
      await execute(`ALTER TABLE "Recipe" ADD COLUMN "description" TEXT`);
      createdSchema.addedDescription = true;
    }
    if (!(await columnExists("Recipe", "servings"))) {
      await execute(`ALTER TABLE "Recipe" ADD COLUMN "servings" TEXT`);
      createdSchema.addedServings = true;
    }
    if (!(await columnExists("Recipe", "course"))) {
      await execute(`
        ALTER TABLE "Recipe" ADD COLUMN "course" TEXT
        CHECK ("course" IS NULL OR "course" IN ('main','side','appetizer','dessert'))
      `);
      createdSchema.addedCourse = true;
    }
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

  if (!(await tableExists("Cookbook"))) {
    await execute(`
      CREATE TABLE "Cookbook" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "title" TEXT NOT NULL,
        "authorId" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
    createdSchema.cookbook = true;
  }

  if (!(await tableExists("RecipeInCookbook"))) {
    await execute(`
      CREATE TABLE "RecipeInCookbook" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "cookbookId" TEXT NOT NULL,
        "recipeId" TEXT NOT NULL,
        "addedById" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("cookbookId") REFERENCES "Cookbook"("id") ON DELETE CASCADE,
        FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id"),
        FOREIGN KEY ("addedById") REFERENCES "User"("id")
      )
    `);
    createdSchema.recipeInCookbook = true;
  }
}

async function cleanupFixture() {
  await database().exec(`DROP TRIGGER IF EXISTS "${ABORT_TRIGGER}"`);
  await database().exec(`DROP TRIGGER IF EXISTS "${CREATE_ABORT_TRIGGER}"`);
  await database().exec(`DROP TRIGGER IF EXISTS "${EDIT_ABORT_TRIGGER}"`);
  if (await tableExists("RecipeInCookbook")) {
    await execute(`DELETE FROM "RecipeInCookbook" WHERE "recipeId" IN (?, ?)`, RECIPE_ID, CREATE_RECIPE_ID);
  }
  if (await tableExists("Cookbook")) {
    await execute(`DELETE FROM "Cookbook" WHERE "id" = ?`, COOKBOOK_ID);
  }
  if (await tableExists("RecipeTag")) {
    await execute(`DELETE FROM "RecipeTag" WHERE "recipeId" IN (?, ?)`, RECIPE_ID, CREATE_RECIPE_ID);
  }
  if (await tableExists("Recipe")) {
    await execute(`DELETE FROM "Recipe" WHERE "id" IN (?, ?)`, RECIPE_ID, CREATE_RECIPE_ID);
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
  await execute(`
    INSERT INTO "Cookbook" (
      "id", "title", "authorId", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?)
  `, COOKBOOK_ID, "Unit 6.2 D1 Cookbook", USER_ID, ORIGINAL_TIMESTAMP, ORIGINAL_TIMESTAMP);
  await execute(`
    INSERT INTO "RecipeInCookbook" (
      "id", "cookbookId", "recipeId", "addedById", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?)
  `, MEMBERSHIP_ID, COOKBOOK_ID, RECIPE_ID, USER_ID, ORIGINAL_TIMESTAMP, ORIGINAL_TIMESTAMP);
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
    if (createdSchema.recipeInCookbook) {
      await database().exec(`DROP TABLE IF EXISTS "RecipeInCookbook"`);
    }
    if (createdSchema.cookbook) await database().exec(`DROP TABLE IF EXISTS "Cookbook"`);
    if (createdSchema.recipeTag) await database().exec(`DROP TABLE IF EXISTS "RecipeTag"`);
    if (createdSchema.addedCourse) {
      await database().exec(`ALTER TABLE "Recipe" DROP COLUMN "course"`);
    }
    if (createdSchema.addedServings) {
      await database().exec(`ALTER TABLE "Recipe" DROP COLUMN "servings"`);
    }
    if (createdSchema.addedDescription) {
      await database().exec(`ALTER TABLE "Recipe" DROP COLUMN "description"`);
    }
    if (createdSchema.recipe) await database().exec(`DROP TABLE IF EXISTS "Recipe"`);
    if (createdSchema.user) await database().exec(`DROP TABLE IF EXISTS "User"`);
  });

  it("creates the authenticated recipe and requested tags in one inspected native D1 batch", async () => {
    const nativeDatabase = recordingDatabase();
    const prisma = await getDb({ DB: nativeDatabase as unknown as D1Database });
    const timestamp = "2026-07-23T18:04:00.000Z";

    try {
      await createRecipeDraft(
        prisma,
        {
          id: CREATE_RECIPE_ID,
          title: "Unit 6.2 Native Create",
          description: "One native operation set",
          servings: "2",
          chefId: USER_ID,
          course: "main",
          tags: ["Weeknight", "Quick"],
          steps: [],
        },
        {
          nativeDatabase,
          now: () => new Date(timestamp),
          randomId: (() => {
            const ids = ["unit-6-2-create-weeknight", "unit-6-2-create-quick"];
            return () => ids.shift() ?? "unexpected-create-tag-id";
          })(),
        },
      );
    } finally {
      await prisma.$disconnect();
    }

    expect(nativeDatabase.batchCalls).toHaveLength(1);
    const [recipeInsert, ...tagInserts] = nativeDatabase.batchCalls[0];
    expect(nativeDatabase.batchCalls[0]).toHaveLength(3);
    expect(recipeInsert.sql).toMatch(/INSERT INTO\s+"Recipe"/i);
    expect(recipeInsert.values).toEqual([
      CREATE_RECIPE_ID,
      "Unit 6.2 Native Create",
      "One native operation set",
      "2",
      USER_ID,
      "main",
      timestamp,
      timestamp,
    ]);
    expect(tagInserts.map((statement) => ({
      sql: statement.sql,
      values: statement.values,
    }))).toEqual([
      {
        sql: expect.stringMatching(/INSERT INTO\s+"RecipeTag"/i),
        values: [
          "unit-6-2-create-weeknight",
          CREATE_RECIPE_ID,
          "Weeknight",
          "weeknight",
          timestamp,
          timestamp,
        ],
      },
      {
        sql: expect.stringMatching(/INSERT INTO\s+"RecipeTag"/i),
        values: [
          "unit-6-2-create-quick",
          CREATE_RECIPE_ID,
          "Quick",
          "quick",
          timestamp,
          timestamp,
        ],
      },
    ]);
    await expect(database().prepare(`
      SELECT "title", "description", "servings", "chefId", "course", "createdAt", "updatedAt"
      FROM "Recipe" WHERE "id" = ?
    `).bind(CREATE_RECIPE_ID).first()).resolves.toEqual({
      title: "Unit 6.2 Native Create",
      description: "One native operation set",
      servings: "2",
      chefId: USER_ID,
      course: "main",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await expect(database().prepare(`
      SELECT "label", "normalizedLabel", "createdAt", "updatedAt"
      FROM "RecipeTag" WHERE "recipeId" = ? ORDER BY "normalizedLabel"
    `).bind(CREATE_RECIPE_ID).all()).resolves.toMatchObject({
      results: [
        { label: "Quick", normalizedLabel: "quick", createdAt: timestamp, updatedAt: timestamp },
        { label: "Weeknight", normalizedLabel: "weeknight", createdAt: timestamp, updatedAt: timestamp },
      ],
    });
  });

  it("rolls back the initial native recipe when its second requested tag fails", async () => {
    await execute(`
      CREATE TRIGGER "${CREATE_ABORT_TRIGGER}"
      BEFORE INSERT ON "RecipeTag"
      WHEN NEW."recipeId" = '${CREATE_RECIPE_ID}' AND NEW."normalizedLabel" = 'explode'
      BEGIN
        SELECT RAISE(ABORT, 'unit_6_2_recipe_create_failure');
      END
    `);
    const nativeDatabase = recordingDatabase();
    const prisma = await getDb({ DB: nativeDatabase as unknown as D1Database });

    try {
      await expect(createRecipeDraft(
        prisma,
        {
          id: CREATE_RECIPE_ID,
          title: "Unit 6.2 Native Create Rollback",
          description: null,
          servings: null,
          chefId: USER_ID,
          course: "side",
          tags: ["First", "Explode"],
          steps: [],
        },
        {
          nativeDatabase,
          now: () => new Date(FAILURE_TIMESTAMP),
          randomId: (() => {
            const ids = ["unit-6-2-create-first", "unit-6-2-create-explode"];
            return () => ids.shift() ?? "unexpected-create-rollback-tag-id";
          })(),
        },
      )).rejects.toThrow(/unit_6_2_recipe_create_failure/);
    } finally {
      await prisma.$disconnect();
    }

    expect(nativeDatabase.batchCalls).toHaveLength(1);
    await expect(database().prepare(
      `SELECT COUNT(*) AS "count" FROM "Recipe" WHERE "id" = ?`,
    ).bind(CREATE_RECIPE_ID).first()).resolves.toEqual({ count: 0 });
    await expect(database().prepare(
      `SELECT COUNT(*) AS "count" FROM "RecipeTag" WHERE "recipeId" = ?`,
    ).bind(CREATE_RECIPE_ID).first()).resolves.toEqual({ count: 0 });
  });

  it("passes the request DB binding into one guarded edit batch and rolls every edit back", async () => {
    await execute(`
      CREATE TRIGGER "${EDIT_ABORT_TRIGGER}"
      BEFORE INSERT ON "RecipeTag"
      WHEN NEW."recipeId" = '${RECIPE_ID}' AND NEW."normalizedLabel" = 'explode'
      BEGIN
        SELECT RAISE(ABORT, 'unit_6_2_recipe_edit_failure');
      END
    `);
    const nativeDatabase = recordingDatabase();
    const routeEnv = {
      ...(env as unknown as Record<string, unknown>),
      DB: nativeDatabase,
      NODE_ENV: "test",
      SESSION_SECRET: "unit-6-2-session-secret-at-least-32-characters",
      SPOONJOY_BASE_URL: "https://spoonjoy.app",
    };
    const cookie = await createUserSessionCookie(
      USER_ID,
      routeEnv,
      new Request(`https://spoonjoy.app/recipes/${RECIPE_ID}/edit`),
    );
    const formData = new FormData();
    formData.set("title", "Must Roll Back");
    formData.set("description", "Must also roll back");
    formData.set("servings", "99");
    formData.set("course", "dessert");
    formData.set("tags", JSON.stringify(["First", "Explode"]));

    const prismaWarnings: unknown[][] = [];
    const info = vi.spyOn(console, "info").mockImplementation((...args) => {
      prismaWarnings.push(args);
    });
    let result: Awaited<ReturnType<typeof editRecipeAction>>;
    try {
      result = await editRecipeAction({
        request: new Request(`https://spoonjoy.app/recipes/${RECIPE_ID}/edit`, {
          method: "POST",
          headers: { Cookie: cookie },
          body: formData,
        }),
        params: { id: RECIPE_ID },
        context: { cloudflare: { env: routeEnv } },
      } as any);
    } finally {
      info.mockRestore();
    }

    const status = result instanceof Response
      ? result.status
      : (result as { init?: { status?: number } }).init?.status;
    expect(status).toBe(500);
    if (nativeDatabase.batchCalls.length === 0) {
      expect(prismaWarnings).toEqual([
        [expect.stringContaining("Cloudflare D1 does not support transactions yet")],
      ]);
    } else {
      expect(prismaWarnings).toEqual([]);
    }
    expect(nativeDatabase.batchCalls).toHaveLength(1);
    const batch = nativeDatabase.batchCalls[0];
    expect(batch).toHaveLength(5);
    const outgoingSql = batch.map((statement) => statement.sql).join("\n");
    expect(outgoingSql).toMatch(/UPDATE\s+"Recipe"/i);
    expect(outgoingSql).toMatch(/DELETE FROM\s+"RecipeTag"/i);
    expect(outgoingSql.match(/INSERT INTO\s+"RecipeTag"/gi)).toHaveLength(2);
    expect(outgoingSql).toMatch(/UPDATE\s+"Cookbook"/i);
    expect(outgoingSql).not.toMatch(/SearchDocument|SearchIndexMetadata/i);
    for (const statement of batch) {
      const guardedShape = `${statement.sql}\n${JSON.stringify(statement.values)}`;
      expect(guardedShape).toContain(RECIPE_ID);
      expect(guardedShape).toContain(USER_ID);
    }

    await expect(database().prepare(`
      SELECT "title", "description", "servings", "course", "updatedAt"
      FROM "Recipe" WHERE "id" = ?
    `).bind(RECIPE_ID).first()).resolves.toEqual({
      title: "Unit 6.1 D1 Recipe",
      description: null,
      servings: null,
      course: null,
      updatedAt: ORIGINAL_TIMESTAMP,
    });
    await expect(readMetadataState()).resolves.toEqual({
      course: null,
      labels: ["original"],
      recipeUpdatedAt: ORIGINAL_TIMESTAMP,
      tagTimestamps: [{ createdAt: ORIGINAL_TIMESTAMP, updatedAt: ORIGINAL_TIMESTAMP }],
    });
    await expect(database().prepare(
      `SELECT "updatedAt" FROM "Cookbook" WHERE "id" = ?`,
    ).bind(COOKBOOK_ID).first()).resolves.toEqual({ updatedAt: ORIGINAL_TIMESTAMP });
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
