import { env } from "cloudflare:test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/recipe/RecipeBuilder", () => ({
  RecipeBuilder: () => null,
}));

import { getDb } from "../../app/lib/db.server";
import { updateNativeRecipe } from "../../app/lib/api-v1-recipe-writes.server";
import { createRecipeDraft } from "../../app/lib/recipe-create.server";
import * as recipeCreateModule from "../../app/lib/recipe-create.server";
import { callSpoonjoyMcpTool } from "../../app/lib/mcp/spoonjoy-tools.server";
import { ACTIVE_RECIPE_TITLE_CONFLICT_ERROR } from "../../app/lib/recipe-title-uniqueness.server";
import { replaceRecipeTagMetadata } from "../../app/lib/recipe-tags.server";
import * as recipeTagsModule from "../../app/lib/recipe-tags.server";
import { createUserSessionCookie } from "../../app/lib/session.server";
import { action as editRecipeAction } from "../../app/routes/recipes.$id.edit";
import { action as newRecipeAction } from "../../app/routes/recipes.new";

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

interface RecordingDatabaseOptions {
  interceptBatch?: (
    records: RecordedStatement[],
    runRealBatch: () => Promise<TestD1Result[]>,
  ) => Promise<TestD1Result[]>;
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
const TITLE_RACE_CONFLICT_ID = "unit-6-2-recipe-title-race-conflict";
const COOKBOOK_ID = "unit-6-2-recipe-tags-d1-cookbook";
const MEMBERSHIP_ID = "unit-6-2-recipe-tags-d1-membership";
const ABORT_TRIGGER = "RecipeTag_unit_6_1_abort";
const CREATE_ABORT_TRIGGER = "RecipeTag_unit_6_2_create_abort";
const CREATE_COVER_ABORT_TRIGGER = "Recipe_unit_6_2_cover_abort";
const CREATE_INGREDIENT_ABORT_TRIGGER = "Ingredient_unit_6_2_create_abort";
const API_COOKBOOK_ABORT_TRIGGER = "Cookbook_unit_6_2_api_abort";
const EDIT_ABORT_TRIGGER = "RecipeTag_unit_6_2_edit_abort";
const ACTIVE_TITLE_INDEX = "Recipe_active_chefId_title_key";
const ORIGINAL_TIMESTAMP = "2026-07-23T18:00:00.000Z";
const FAILURE_TIMESTAMP = "2026-07-23T18:01:00.000Z";
const WRITER_A_TIMESTAMP = "2026-07-23T18:02:00.000Z";
const WRITER_B_TIMESTAMP = "2026-07-23T18:03:00.000Z";

const createdSchema = {
  addedCourse: false,
  addedDescription: false,
  addedServings: false,
  cookbook: false,
  ingredient: false,
  ingredientRef: false,
  recipe: false,
  recipeCover: false,
  recipeInCookbook: false,
  recipeStep: false,
  recipeTag: false,
  stepOutputUse: false,
  unit: false,
  user: false,
};

function database(): TestD1Database {
  return (env as unknown as { DB: TestD1Database }).DB;
}

function recordingDatabase(options: RecordingDatabaseOptions = {}): RecordingD1Database {
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
      const batchRecords = statements.map((statement) => {
        if (!statement.__record) throw new Error("Missing recorded D1 statement");
        return statement.__record;
      });
      batchCalls.push(batchRecords);
      const runRealBatch = () => realDatabase.batch(
        statements.map((statement) => statement.__real ?? statement),
      );
      return options.interceptBatch
        ? options.interceptBatch(batchRecords, runRealBatch)
        : runRealBatch();
    },
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function isCoreAuthoringMutation(statement: RecordedStatement): boolean {
  return /^(?:INSERT INTO|UPDATE|DELETE FROM)\s+"(?:Recipe|RecipeTag|RecipeStep|Unit|IngredientRef|Ingredient|RecipeCover|Cookbook)"/i
    .test(normalizeSql(statement.sql));
}

function rejectPrismaTransactions<T extends object>(prisma: T): T {
  return new Proxy(prisma, {
    get(target, property) {
      if (property === "$transaction") {
        return () => {
          throw new Error("native authoring must not call Prisma $transaction");
        };
      }
      return Reflect.get(target, property, target);
    },
  });
}

interface EnvelopeDefect {
  defect: string;
  mutate: (results: TestD1Result[]) => TestD1Result[];
}

function setReturnedField(
  results: TestD1Result[],
  operation: number,
  field: string,
): TestD1Result[] {
  const row = results[operation].results[0] as Record<string, unknown>;
  results[operation] = {
    ...results[operation],
    results: [{ ...row, [field]: `unexpected-${field}` }],
  };
  return results;
}

function createEnvelopeDefects(): EnvelopeDefect[] {
  const operations = ["recipe", "first tag", "second tag"];
  const defects: EnvelopeDefect[] = [{
    defect: "missing operation count",
    mutate: (results) => results.slice(0, -1),
  }, {
    defect: "extra operation count",
    mutate: (results) => [...results, { meta: { changes: 0 }, results: [], success: true }],
  }];
  operations.forEach((name, operation) => {
    defects.push({
      defect: `${name} success flag`,
      mutate(results) {
        results[operation] = { ...results[operation], success: false };
        return results;
      },
    }, {
      defect: `${name} affected count`,
      mutate(results) {
        results[operation] = { ...results[operation], meta: { changes: 0 } };
        return results;
      },
    }, {
      defect: `${name} returned row count`,
      mutate(results) {
        results[operation] = { ...results[operation], results: [] };
        return results;
      },
    });
  });
  [
    [0, ["id", "title", "description", "servings", "chefId", "course", "createdAt", "updatedAt"]],
    [1, ["recipeId", "tagId", "label", "normalizedLabel", "createdAt", "updatedAt"]],
    [2, ["recipeId", "tagId", "label", "normalizedLabel", "createdAt", "updatedAt"]],
  ].forEach(([operation, fields]) => {
    (fields as string[]).forEach((field) => {
      defects.push({
        defect: `${operations[operation as number]} returned ${field}`,
        mutate: (results) => setReturnedField(results, operation as number, field),
      });
    });
  });
  return defects;
}

function editEnvelopeDefects(): EnvelopeDefect[] {
  const operations = [
    "recipe",
    "tag deletion",
    "first tag",
    "second tag",
    "cookbook membership",
    "cookbook",
  ];
  const defects: EnvelopeDefect[] = [{
    defect: "missing operation count",
    mutate: (results) => results.slice(0, -1),
  }, {
    defect: "extra operation count",
    mutate: (results) => [...results, { meta: { changes: 0 }, results: [], success: true }],
  }];
  operations.forEach((name, operation) => {
    defects.push({
      defect: `${name} success flag`,
      mutate(results) {
        results[operation] = { ...results[operation], success: false };
        return results;
      },
    });
  });
  [0, 2, 3].forEach((operation) => {
    defects.push({
      defect: `${operations[operation]} affected count`,
      mutate(results) {
        results[operation] = { ...results[operation], meta: { changes: 0 } };
        return results;
      },
    });
  });
  defects.push({
    defect: "tag deletion affected count",
    mutate(results) {
      results[1] = { ...results[1], meta: { changes: -1 } };
      return results;
    },
  }, {
    defect: "cookbook membership affected count",
    mutate(results) {
      results[4] = { ...results[4], meta: { changes: 1 } };
      return results;
    },
  }, {
    defect: "cookbook affected count",
    mutate(results) {
      results[5] = { ...results[5], meta: { changes: 2 } };
      return results;
    },
  });
  [0, 2, 3, 4, 5].forEach((operation) => {
    defects.push({
      defect: `${operations[operation]} returned row count`,
      mutate(results) {
        results[operation] = { ...results[operation], results: [] };
        return results;
      },
    });
  });
  defects.push({
    defect: "tag deletion returned row count",
    mutate(results) {
      results[1] = { ...results[1], results: [{ unexpected: true }] };
      return results;
    },
  });
  [
    [0, ["recipeId", "title", "description", "servings", "course", "updatedAt"]],
    [2, ["recipeId", "tagId", "label", "normalizedLabel", "createdAt", "updatedAt"]],
    [3, ["recipeId", "tagId", "label", "normalizedLabel", "createdAt", "updatedAt"]],
    [4, ["cookbookId"]],
    [5, ["cookbookId", "updatedAt"]],
  ].forEach(([operation, fields]) => {
    (fields as string[]).forEach((field) => {
      defects.push({
        defect: `${operations[operation as number]} returned ${field}`,
        mutate: (results) => setReturnedField(results, operation as number, field),
      });
    });
  });
  return defects;
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
        "hashedPassword" TEXT,
        "salt" TEXT,
        "resetToken" TEXT,
        "resetTokenExpiresAt" DATETIME,
        "webAuthnChallenge" TEXT UNIQUE,
        "photoUrl" TEXT,
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

  if (!(await tableExists("RecipeStep"))) {
    await execute(`
      CREATE TABLE "RecipeStep" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "recipeId" TEXT NOT NULL,
        "stepNum" INTEGER NOT NULL,
        "stepTitle" TEXT,
        "description" TEXT NOT NULL,
        "duration" INTEGER,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE
      )
    `);
    await execute(`
      CREATE UNIQUE INDEX "RecipeStep_recipeId_stepNum_key"
      ON "RecipeStep"("recipeId", "stepNum")
    `);
    createdSchema.recipeStep = true;
  }

  if (!(await tableExists("StepOutputUse"))) {
    await execute(`
      CREATE TABLE "StepOutputUse" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "recipeId" TEXT NOT NULL,
        "outputStepNum" INTEGER NOT NULL,
        "inputStepNum" INTEGER NOT NULL,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    createdSchema.stepOutputUse = true;
  }

  if (!(await tableExists("Unit"))) {
    await execute(`
      CREATE TABLE "Unit" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL UNIQUE,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    createdSchema.unit = true;
  }

  if (!(await tableExists("IngredientRef"))) {
    await execute(`
      CREATE TABLE "IngredientRef" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL UNIQUE,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    createdSchema.ingredientRef = true;
  }

  if (!(await tableExists("Ingredient"))) {
    await execute(`
      CREATE TABLE "Ingredient" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "recipeId" TEXT NOT NULL,
        "stepNum" INTEGER NOT NULL,
        "quantity" REAL NOT NULL,
        "unitId" TEXT NOT NULL,
        "ingredientRefId" TEXT NOT NULL,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("recipeId", "stepNum")
          REFERENCES "RecipeStep"("recipeId", "stepNum") ON DELETE CASCADE,
        FOREIGN KEY ("unitId") REFERENCES "Unit"("id"),
        FOREIGN KEY ("ingredientRefId") REFERENCES "IngredientRef"("id")
      )
    `);
    createdSchema.ingredient = true;
  }

  if (!(await tableExists("RecipeCover"))) {
    await execute(`
      CREATE TABLE "RecipeCover" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "recipeId" TEXT NOT NULL,
        "imageUrl" TEXT NOT NULL,
        "stylizedImageUrl" TEXT,
        "sourceType" TEXT NOT NULL,
        "sourceSpoonId" TEXT,
        "status" TEXT NOT NULL DEFAULT 'ready',
        "createdById" TEXT,
        "sourceImageUrl" TEXT,
        "generationStatus" TEXT NOT NULL DEFAULT 'none',
        "failureReason" TEXT,
        "promptVersion" TEXT,
        "styleVersion" TEXT,
        "promptAddition" TEXT,
        "parentCoverId" TEXT,
        "archivedAt" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE
      )
    `);
    createdSchema.recipeCover = true;
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
  await database().exec(`DROP INDEX IF EXISTS "${ACTIVE_TITLE_INDEX}"`);
  await database().exec(`DROP TRIGGER IF EXISTS "${ABORT_TRIGGER}"`);
  await database().exec(`DROP TRIGGER IF EXISTS "${CREATE_ABORT_TRIGGER}"`);
  await database().exec(`DROP TRIGGER IF EXISTS "${CREATE_COVER_ABORT_TRIGGER}"`);
  await database().exec(`DROP TRIGGER IF EXISTS "${CREATE_INGREDIENT_ABORT_TRIGGER}"`);
  await database().exec(`DROP TRIGGER IF EXISTS "${API_COOKBOOK_ABORT_TRIGGER}"`);
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
  if (await tableExists("RecipeCover")) {
    await execute(`DELETE FROM "RecipeCover" WHERE "recipeId" IN (?, ?)`, RECIPE_ID, CREATE_RECIPE_ID);
  }
  if (await tableExists("Ingredient")) {
    await execute(`DELETE FROM "Ingredient" WHERE "recipeId" IN (?, ?)`, RECIPE_ID, CREATE_RECIPE_ID);
  }
  if (await tableExists("StepOutputUse")) {
    await execute(`DELETE FROM "StepOutputUse" WHERE "recipeId" IN (?, ?)`, RECIPE_ID, CREATE_RECIPE_ID);
  }
  if (await tableExists("RecipeStep")) {
    await execute(`DELETE FROM "RecipeStep" WHERE "recipeId" IN (?, ?)`, RECIPE_ID, CREATE_RECIPE_ID);
  }
  if (await tableExists("Recipe")) {
    await execute(
      `DELETE FROM "Recipe" WHERE "id" IN (?, ?, ?)`,
      RECIPE_ID,
      CREATE_RECIPE_ID,
      TITLE_RACE_CONFLICT_ID,
    );
  }
  if (await tableExists("Unit")) {
    await execute(`DELETE FROM "Unit" WHERE "name" LIKE 'unit 6.2 %'`);
  }
  if (await tableExists("IngredientRef")) {
    await execute(`DELETE FROM "IngredientRef" WHERE "name" LIKE 'unit 6.2 %'`);
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
    if (createdSchema.recipeCover) await database().exec(`DROP TABLE IF EXISTS "RecipeCover"`);
    if (createdSchema.ingredient) await database().exec(`DROP TABLE IF EXISTS "Ingredient"`);
    if (createdSchema.stepOutputUse) await database().exec(`DROP TABLE IF EXISTS "StepOutputUse"`);
    if (createdSchema.ingredientRef) await database().exec(`DROP TABLE IF EXISTS "IngredientRef"`);
    if (createdSchema.unit) await database().exec(`DROP TABLE IF EXISTS "Unit"`);
    if (createdSchema.recipeStep) await database().exec(`DROP TABLE IF EXISTS "RecipeStep"`);
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
      new Request("https://spoonjoy.app/recipes/new"),
    );
    const formData = new FormData();
    formData.set("title", "Unit 6.2 Native Create");
    formData.set("description", "One native operation set");
    formData.set("servings", "2");
    formData.set("course", "main");
    formData.set("tags", JSON.stringify(["Weeknight", "Quick"]));
    formData.set("steps", JSON.stringify([{
      stepTitle: "Build the sauce",
      description: "Combine the full graph.",
      duration: 12,
      ingredients: [
        { quantity: 2, unit: "Unit 6.2 Tablespoon", ingredientName: "Unit 6.2 Olive Oil" },
        { quantity: 3, unit: "Unit 6.2 Clove", ingredientName: "Unit 6.2 Garlic" },
      ],
    }]));
    const generatedIds = [
      CREATE_RECIPE_ID,
      "unit-6-2-create-cover",
      "unit-6-2-create-weeknight",
      "unit-6-2-create-quick",
      "unit-6-2-create-step",
      "unit-6-2-create-tablespoon-unit",
      "unit-6-2-create-clove-unit",
      "unit-6-2-create-olive-oil-ref",
      "unit-6-2-create-garlic-ref",
      "unit-6-2-create-olive-oil-ingredient",
      "unit-6-2-create-garlic-ingredient",
    ];
    const nextRandomUuid = (() => (
      generatedIds.shift() ?? "unit-6-2-unexpected-generated-id"
    )) as typeof crypto.randomUUID;
    const randomUuid = vi.spyOn(crypto, "randomUUID").mockImplementation(nextRandomUuid);
    const createSpy = vi.spyOn(recipeCreateModule, "createRecipeDraft");
    let createCallCount = 0;
    let createCallOptions: unknown;
    let result: Awaited<ReturnType<typeof newRecipeAction>>;
    try {
      result = await newRecipeAction({
        request: new Request("https://spoonjoy.app/recipes/new", {
          method: "POST",
          headers: { Cookie: cookie },
          body: formData,
        }),
        params: {},
        context: { cloudflare: { env: routeEnv } },
      } as any);
      createCallCount = createSpy.mock.calls.length;
      createCallOptions = createSpy.mock.calls[0]?.[2];
    } finally {
      randomUuid.mockRestore();
      createSpy.mockRestore();
    }

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
    expect((result as Response).headers.get("Location")).toBe(`/recipes/${CREATE_RECIPE_ID}`);
    expect(createCallCount).toBe(1);
    expect(createCallOptions).toMatchObject({ nativeDatabase });
    expect(nativeDatabase.batchCalls).toHaveLength(1);
    const [
      recipeInsert,
      firstTagInsert,
      secondTagInsert,
      stepInsert,
      firstUnitUpsert,
      secondUnitUpsert,
      firstIngredientRefUpsert,
      secondIngredientRefUpsert,
      firstIngredientInsert,
      secondIngredientInsert,
      coverInsert,
    ] = nativeDatabase.batchCalls[0];
    const tagInserts = [firstTagInsert, secondTagInsert];
    expect(nativeDatabase.batchCalls[0]).toHaveLength(11);
    const timestamp = recipeInsert.values[7];
    expect(timestamp).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/));
    expect(normalizeSql(recipeInsert.sql)).toBe(
      'INSERT INTO "Recipe" ( "id", "title", "description", "servings", "sourceUrl", "chefId", "course", "createdAt", "updatedAt" ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING "id", "title", "description", "servings", "sourceUrl", "chefId", "course", "createdAt", "updatedAt"',
    );
    expect(recipeInsert.values).toEqual([
      CREATE_RECIPE_ID,
      "Unit 6.2 Native Create",
      "One native operation set",
      "2",
      null,
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
        sql: expect.any(String),
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
        sql: expect.any(String),
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
    expect(tagInserts.map((statement) => normalizeSql(statement.sql))).toEqual([
      'INSERT INTO "RecipeTag" ("id", "recipeId", "label", "normalizedLabel", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?) RETURNING "recipeId", "id" AS "tagId", "label", "normalizedLabel", "createdAt", "updatedAt"',
      'INSERT INTO "RecipeTag" ("id", "recipeId", "label", "normalizedLabel", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?) RETURNING "recipeId", "id" AS "tagId", "label", "normalizedLabel", "createdAt", "updatedAt"',
    ]);
    expect(normalizeSql(stepInsert.sql)).toBe(
      'INSERT INTO "RecipeStep" ( "id", "recipeId", "stepNum", "stepTitle", "description", "duration", "updatedAt" ) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING "id", "recipeId", "stepNum", "stepTitle", "description", "duration", "updatedAt"',
    );
    expect(stepInsert.values).toEqual([
      "unit-6-2-create-step",
      CREATE_RECIPE_ID,
      1,
      "Build the sauce",
      "Combine the full graph.",
      12,
      timestamp,
    ]);
    expect([firstUnitUpsert, secondUnitUpsert].map((statement) => statement.values)).toEqual([
      ["unit-6-2-create-tablespoon-unit", "unit 6.2 tablespoon", timestamp],
      ["unit-6-2-create-clove-unit", "unit 6.2 clove", timestamp],
    ]);
    expect([firstIngredientRefUpsert, secondIngredientRefUpsert].map(
      (statement) => statement.values,
    )).toEqual([
      ["unit-6-2-create-olive-oil-ref", "unit 6.2 olive oil", timestamp],
      ["unit-6-2-create-garlic-ref", "unit 6.2 garlic", timestamp],
    ]);
    expect([firstIngredientInsert, secondIngredientInsert].map(
      (statement) => statement.values,
    )).toEqual([
      [
        "unit-6-2-create-olive-oil-ingredient",
        CREATE_RECIPE_ID,
        1,
        2,
        "unit 6.2 tablespoon",
        "unit 6.2 olive oil",
        timestamp,
      ],
      [
        "unit-6-2-create-garlic-ingredient",
        CREATE_RECIPE_ID,
        1,
        3,
        "unit 6.2 clove",
        "unit 6.2 garlic",
        timestamp,
      ],
    ]);
    expect(normalizeSql(coverInsert.sql)).toContain('INSERT INTO "RecipeCover"');
    expect(coverInsert.values).toEqual([
      "unit-6-2-create-cover",
      "",
      "ai-placeholder",
      "processing",
      USER_ID,
      null,
      "processing",
      timestamp,
      CREATE_RECIPE_ID,
      USER_ID,
    ]);
    const batchSet = new Set(nativeDatabase.batchCalls[0]);
    expect(nativeDatabase.records.filter(isCoreAuthoringMutation).every((statement) => (
      batchSet.has(statement)
    ))).toBe(true);
    expect(nativeDatabase.records.map((statement) => statement.sql).join("\n"))
      .not.toMatch(/SearchDocument|SearchIndexMetadata/i);
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
    await expect(database().prepare(`
      SELECT "id", "sourceType", "createdById"
      FROM "RecipeCover" WHERE "recipeId" = ?
    `).bind(CREATE_RECIPE_ID).first()).resolves.toEqual({
      id: "unit-6-2-create-cover",
      sourceType: "ai-placeholder",
      createdById: USER_ID,
    });
    await expect(database().prepare(`
      SELECT "stepNum", "stepTitle", "description", "duration", "updatedAt"
      FROM "RecipeStep" WHERE "recipeId" = ?
    `).bind(CREATE_RECIPE_ID).first()).resolves.toEqual({
      stepNum: 1,
      stepTitle: "Build the sauce",
      description: "Combine the full graph.",
      duration: 12,
      updatedAt: timestamp,
    });
    await expect(database().prepare(`
      SELECT
        ingredient."id" AS "id",
        ingredient."quantity" AS "quantity",
        unit."name" AS "unit",
        ingredientRef."name" AS "ingredientName",
        ingredient."updatedAt" AS "updatedAt"
      FROM "Ingredient" AS ingredient
      JOIN "Unit" AS unit ON unit."id" = ingredient."unitId"
      JOIN "IngredientRef" AS ingredientRef
        ON ingredientRef."id" = ingredient."ingredientRefId"
      WHERE ingredient."recipeId" = ?
      ORDER BY ingredient."id"
    `).bind(CREATE_RECIPE_ID).all()).resolves.toMatchObject({
      results: [
        {
          id: "unit-6-2-create-garlic-ingredient",
          quantity: 3,
          unit: "unit 6.2 clove",
          ingredientName: "unit 6.2 garlic",
          updatedAt: timestamp,
        },
        {
          id: "unit-6-2-create-olive-oil-ingredient",
          quantity: 2,
          unit: "unit 6.2 tablespoon",
          ingredientName: "unit 6.2 olive oil",
          updatedAt: timestamp,
        },
      ],
    });
  });

  it("passes the native D1 binding for metadata-free web creation", async () => {
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
      new Request("https://spoonjoy.app/recipes/new"),
    );
    const formData = new FormData();
    formData.set("title", "Unit 6.2 Metadata Free");
    formData.set("description", "");
    formData.set("servings", "");
    formData.set("steps", "[]");
    const randomUuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(CREATE_RECIPE_ID);
    const createSpy = vi.spyOn(recipeCreateModule, "createRecipeDraft");

    try {
      const result = await newRecipeAction({
        request: new Request("https://spoonjoy.app/recipes/new", {
          method: "POST",
          headers: { Cookie: cookie },
          body: formData,
        }),
        params: {},
        context: { cloudflare: { env: routeEnv } },
      } as any);

      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(302);
      expect(createSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: CREATE_RECIPE_ID }),
        expect.objectContaining({ nativeDatabase }),
      );
      expect(nativeDatabase.batchCalls).toHaveLength(1);
      expect(nativeDatabase.batchCalls[0]).toHaveLength(2);
    } finally {
      createSpy.mockRestore();
      randomUuid.mockRestore();
    }
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
    const prisma = await getDb({ DB: database() as unknown as D1Database });
    const prismaWithoutTransactions = rejectPrismaTransactions(prisma);

    try {
      await expect(createRecipeDraft(
        prismaWithoutTransactions,
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

  it("rolls back the complete native graph when the final ingredient fails", async () => {
    await execute(`
      CREATE TRIGGER "${CREATE_INGREDIENT_ABORT_TRIGGER}"
      BEFORE INSERT ON "Ingredient"
      WHEN NEW."id" = 'unit-6-2-rollback-second-ingredient'
      BEGIN
        SELECT RAISE(ABORT, 'unit_6_2_late_ingredient_failure');
      END
    `);
    const nativeDatabase = recordingDatabase();
    const prisma = await getDb({ DB: database() as unknown as D1Database });
    const prismaWithoutTransactions = rejectPrismaTransactions(prisma);
    const generatedIds = [
      "unit-6-2-rollback-tag",
      "unit-6-2-rollback-step",
      "unit-6-2-rollback-cup-unit",
      "unit-6-2-rollback-pinch-unit",
      "unit-6-2-rollback-flour-ref",
      "unit-6-2-rollback-salt-ref",
      "unit-6-2-rollback-first-ingredient",
      "unit-6-2-rollback-second-ingredient",
    ];

    try {
      await expect(createRecipeDraft(
        prismaWithoutTransactions,
        {
          id: CREATE_RECIPE_ID,
          title: "Unit 6.2 Full Graph Rollback",
          description: null,
          servings: "4",
          chefId: USER_ID,
          course: "side",
          tags: ["Rollback"],
          steps: [{
            stepTitle: "Mix",
            description: "Fail on the last ingredient.",
            duration: 4,
            ingredients: [
              { quantity: 1, unit: "Unit 6.2 Cup", ingredientName: "Unit 6.2 Flour" },
              { quantity: 1, unit: "Unit 6.2 Pinch", ingredientName: "Unit 6.2 Salt" },
            ],
          }],
        },
        {
          nativeDatabase,
          now: () => new Date(FAILURE_TIMESTAMP),
          randomId: () => generatedIds.shift() ?? "unexpected-full-graph-rollback-id",
        },
      )).rejects.toThrow(/unit_6_2_late_ingredient_failure/);
    } finally {
      await prisma.$disconnect();
    }

    expect(nativeDatabase.batchCalls).toHaveLength(1);
    expect(nativeDatabase.batchCalls[0]).toHaveLength(9);
    for (const table of ["Recipe", "RecipeTag", "RecipeStep", "Ingredient"]) {
      await expect(database().prepare(
        `SELECT COUNT(*) AS "count" FROM "${table}" WHERE "${table === "Recipe" ? "id" : "recipeId"}" = ?`,
      ).bind(CREATE_RECIPE_ID).first()).resolves.toEqual({ count: 0 });
    }
    await expect(database().prepare(`
      SELECT COUNT(*) AS "count" FROM "Unit" WHERE "id" LIKE 'unit-6-2-rollback-%'
    `).first()).resolves.toEqual({ count: 0 });
    await expect(database().prepare(`
      SELECT COUNT(*) AS "count" FROM "IngredientRef" WHERE "id" LIKE 'unit-6-2-rollback-%'
    `).first()).resolves.toEqual({ count: 0 });
  });

  it("routes MCP creation through one native batch and rolls back a late ingredient failure", async () => {
    const title = "Unit 6.2 MCP Native Rollback";
    await execute(`
      CREATE TRIGGER "${CREATE_INGREDIENT_ABORT_TRIGGER}"
      BEFORE INSERT ON "Ingredient"
      WHEN EXISTS (
        SELECT 1 FROM "Recipe"
        WHERE "id" = NEW."recipeId" AND "title" = '${title}'
      )
      BEGIN
        SELECT RAISE(ABORT, 'unit_6_2_mcp_ingredient_failure');
      END
    `);
    const nativeDatabase = recordingDatabase();
    const prisma = await getDb({ DB: database() as unknown as D1Database });

    try {
      await expect(callSpoonjoyMcpTool("create_recipe", {
        ownerEmail: "unit-6-1-recipe-tags-d1@example.test",
        title,
        steps: [{
          description: "Fail after all lookup writes.",
          ingredients: [{
            name: "Unit 6.2 MCP Stock",
            quantity: 1,
            unit: "Unit 6.2 MCP Cup",
          }],
        }],
      }, {
        db: prisma,
        allowOwnerEmailFallback: true,
        defaultOwnerEmail: "unit-6-1-recipe-tags-d1@example.test",
        env: { DB: nativeDatabase },
      })).rejects.toThrow(/unit_6_2_mcp_ingredient_failure/);
    } finally {
      await prisma.$disconnect();
    }

    expect(nativeDatabase.batchCalls).toHaveLength(1);
    expect(nativeDatabase.batchCalls[0].map(({ sql }) => normalizeSql(sql))).toEqual([
      expect.stringMatching(/^INSERT INTO "Recipe"/),
      expect.stringMatching(/^INSERT INTO "RecipeStep"/),
      expect.stringMatching(/^INSERT INTO "Unit"/),
      expect.stringMatching(/^INSERT INTO "IngredientRef"/),
      expect.stringMatching(/^INSERT INTO "Ingredient"/),
    ]);
    await expect(database().prepare(`
      SELECT COUNT(*) AS "count" FROM "Recipe" WHERE "title" = ?
    `).bind(title).first()).resolves.toEqual({ count: 0 });
    await expect(database().prepare(`
      SELECT COUNT(*) AS "count" FROM "Unit" WHERE "name" = 'unit 6.2 mcp cup'
    `).first()).resolves.toEqual({ count: 0 });
    await expect(database().prepare(`
      SELECT COUNT(*) AS "count" FROM "IngredientRef" WHERE "name" = 'unit 6.2 mcp stock'
    `).first()).resolves.toEqual({ count: 0 });
  });

  it("routes MCP update through one native batch and rolls back a late ingredient failure", async () => {
    await execute(`
      INSERT INTO "RecipeStep" (
        "id", "recipeId", "stepNum", "description", "updatedAt"
      ) VALUES ('unit-6-2-mcp-old-step', ?, 1, 'Keep this step.', ?)
    `, RECIPE_ID, ORIGINAL_TIMESTAMP);
    await execute(`
      CREATE TRIGGER "${CREATE_INGREDIENT_ABORT_TRIGGER}"
      BEFORE INSERT ON "Ingredient"
      WHEN NEW."recipeId" = '${RECIPE_ID}'
      BEGIN
        SELECT RAISE(ABORT, 'unit_6_2_mcp_update_ingredient_failure');
      END
    `);
    const nativeDatabase = recordingDatabase();
    const prisma = await getDb({ DB: database() as unknown as D1Database });

    try {
      await expect(callSpoonjoyMcpTool("update_recipe", {
        ownerEmail: "unit-6-1-recipe-tags-d1@example.test",
        id: RECIPE_ID,
        title: "Unit 6.2 MCP Update Must Roll Back",
        steps: [{
          description: "Fail after replacing the old graph.",
          ingredients: [{
            name: "Unit 6.2 MCP Update Stock",
            quantity: 1,
            unit: "Unit 6.2 MCP Update Cup",
          }],
        }],
      }, {
        db: prisma,
        allowOwnerEmailFallback: true,
        defaultOwnerEmail: "unit-6-1-recipe-tags-d1@example.test",
        env: { DB: nativeDatabase },
      })).rejects.toThrow(/unit_6_2_mcp_update_ingredient_failure/);
    } finally {
      await prisma.$disconnect();
    }

    expect(nativeDatabase.batchCalls).toHaveLength(1);
    expect(nativeDatabase.batchCalls[0].map(({ sql }) => normalizeSql(sql))).toEqual([
      expect.stringMatching(/^UPDATE "Recipe"/),
      expect.stringMatching(/^DELETE FROM "StepOutputUse"/),
      expect.stringMatching(/^DELETE FROM "Ingredient"/),
      expect.stringMatching(/^DELETE FROM "RecipeStep"/),
      expect.stringMatching(/^INSERT INTO "RecipeStep"/),
      expect.stringMatching(/^INSERT INTO "Unit"/),
      expect.stringMatching(/^INSERT INTO "IngredientRef"/),
      expect.stringMatching(/^INSERT INTO "Ingredient"/),
      expect.stringMatching(/^SELECT membership\."cookbookId"/),
      expect.stringMatching(/^UPDATE "Cookbook"/),
    ]);
    await expect(database().prepare(`
      SELECT "title", "updatedAt" FROM "Recipe" WHERE "id" = ?
    `).bind(RECIPE_ID).first()).resolves.toEqual({
      title: "Unit 6.1 D1 Recipe",
      updatedAt: ORIGINAL_TIMESTAMP,
    });
    await expect(database().prepare(`
      SELECT "id", "description" FROM "RecipeStep" WHERE "recipeId" = ?
    `).bind(RECIPE_ID).all()).resolves.toMatchObject({
      results: [{ id: "unit-6-2-mcp-old-step", description: "Keep this step." }],
    });
    await expect(database().prepare(`
      SELECT COUNT(*) AS "count" FROM "Unit" WHERE "name" = 'unit 6.2 mcp update cup'
    `).first()).resolves.toEqual({ count: 0 });
    await expect(database().prepare(`
      SELECT COUNT(*) AS "count" FROM "IngredientRef"
      WHERE "name" = 'unit 6.2 mcp update stock'
    `).first()).resolves.toEqual({ count: 0 });
  });

  it("maps a soft-delete race before the MCP update batch to not found without residue", async () => {
    let actualResults: TestD1Result[] = [];
    const nativeDatabase = recordingDatabase({
      async interceptBatch(records, runRealBatch) {
        if (!/^UPDATE\s+"Recipe"/i.test(normalizeSql(records[0]?.sql ?? ""))) {
          return runRealBatch();
        }
        await execute(`UPDATE "Recipe" SET "deletedAt" = ? WHERE "id" = ?`, FAILURE_TIMESTAMP, RECIPE_ID);
        actualResults = await runRealBatch();
        return actualResults;
      },
    });
    const prisma = await getDb({ DB: database() as unknown as D1Database });

    try {
      await expect(callSpoonjoyMcpTool("update_recipe", {
        ownerEmail: "unit-6-1-recipe-tags-d1@example.test",
        id: RECIPE_ID,
        title: "Never Persisted",
        steps: [{
          description: "Never inserted.",
          ingredients: [{
            name: "Unit 6.2 MCP Raced Stock",
            quantity: 1,
            unit: "Unit 6.2 MCP Raced Cup",
          }],
        }],
      }, {
        db: prisma,
        allowOwnerEmailFallback: true,
        defaultOwnerEmail: "unit-6-1-recipe-tags-d1@example.test",
        env: { DB: nativeDatabase },
      })).rejects.toThrow("Recipe not found");
    } finally {
      await prisma.$disconnect();
    }

    expect(actualResults).toHaveLength(10);
    expect(actualResults.every((result) => (
      result.success === true
      && result.meta.changes === 0
      && result.results.length === 0
    ))).toBe(true);
    await expect(database().prepare(`
      SELECT "title", "deletedAt" FROM "Recipe" WHERE "id" = ?
    `).bind(RECIPE_ID).first()).resolves.toEqual({
      title: "Unit 6.1 D1 Recipe",
      deletedAt: FAILURE_TIMESTAMP,
    });
    await expect(database().prepare(`
      SELECT COUNT(*) AS "count" FROM "Unit" WHERE "name" = 'unit 6.2 mcp raced cup'
    `).first()).resolves.toEqual({ count: 0 });
    await expect(database().prepare(`
      SELECT COUNT(*) AS "count" FROM "IngredientRef"
      WHERE "name" = 'unit 6.2 mcp raced stock'
    `).first()).resolves.toEqual({ count: 0 });
  });

  it("rolls back a native REST recipe update when cookbook invalidation fails", async () => {
    await execute(`
      CREATE TRIGGER "${API_COOKBOOK_ABORT_TRIGGER}"
      BEFORE UPDATE ON "Cookbook"
      WHEN NEW."id" = '${COOKBOOK_ID}'
      BEGIN
        SELECT RAISE(ABORT, 'unit_6_2_api_cookbook_failure');
      END
    `);
    const nativeDatabase = recordingDatabase();
    const prisma = await getDb({ DB: database() as unknown as D1Database });

    try {
      await expect(updateNativeRecipe(prisma, USER_ID, RECIPE_ID, {
        clientMutationId: "unit-6-2-api-rollback",
        fields: { title: "Unit 6.2 API Must Roll Back" },
      }, { nativeDatabase })).rejects.toThrow(/unit_6_2_api_cookbook_failure/);
    } finally {
      await prisma.$disconnect();
    }

    expect(nativeDatabase.batchCalls).toHaveLength(1);
    expect(nativeDatabase.batchCalls[0].map(({ sql }) => normalizeSql(sql))).toEqual([
      expect.stringMatching(/^UPDATE "Recipe"/),
      expect.stringMatching(/^UPDATE "Cookbook"/),
    ]);
    await expect(database().prepare(`
      SELECT "title", "updatedAt" FROM "Recipe" WHERE "id" = ?
    `).bind(RECIPE_ID).first()).resolves.toEqual({
      title: "Unit 6.1 D1 Recipe",
      updatedAt: ORIGINAL_TIMESTAMP,
    });
    await expect(database().prepare(`
      SELECT "updatedAt" FROM "Cookbook" WHERE "id" = ?
    `).bind(COOKBOOK_ID).first()).resolves.toEqual({ updatedAt: ORIGINAL_TIMESTAMP });
  });

  it("maps the exact native D1 active-title update race to the REST field error", async () => {
    const racedTitle = "Unit 6.2 Native REST Title Race";
    await execute(
      `CREATE UNIQUE INDEX "${ACTIVE_TITLE_INDEX}" ON "Recipe"("chefId", "title") WHERE "deletedAt" IS NULL`,
    );
    let nativeError: unknown;
    const nativeDatabase = recordingDatabase({
      async interceptBatch(records, runRealBatch) {
        if (!/^UPDATE\s+"Recipe"/i.test(normalizeSql(records[0]?.sql ?? ""))) {
          return runRealBatch();
        }
        await execute(`
          INSERT INTO "Recipe" (
            "id", "title", "chefId", "createdAt", "updatedAt"
          ) VALUES (?, ?, ?, ?, ?)
        `, TITLE_RACE_CONFLICT_ID, racedTitle, USER_ID, FAILURE_TIMESTAMP, FAILURE_TIMESTAMP);
        try {
          return await runRealBatch();
        } catch (error) {
          nativeError = error;
          throw error;
        }
      },
    });
    const prisma = await getDb({ DB: database() as unknown as D1Database });
    let result: Awaited<ReturnType<typeof updateNativeRecipe>>;
    try {
      result = await updateNativeRecipe(prisma, USER_ID, RECIPE_ID, {
        clientMutationId: "unit-6-2-native-title-race",
        fields: { title: racedTitle },
      }, { nativeDatabase });
    } finally {
      await prisma.$disconnect();
    }

    expect(nativeError).toMatchObject({
      message: "D1_ERROR: UNIQUE constraint failed: Recipe.chefId, Recipe.title: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)",
    });
    expect(result).toEqual({
      ok: false,
      code: "validation_error",
      message: "Invalid recipe fields",
      details: { fieldErrors: { title: ACTIVE_RECIPE_TITLE_CONFLICT_ERROR } },
    });
    await expect(database().prepare(`
      SELECT "title", "updatedAt" FROM "Recipe" WHERE "id" = ?
    `).bind(RECIPE_ID).first()).resolves.toEqual({
      title: "Unit 6.1 D1 Recipe",
      updatedAt: ORIGINAL_TIMESTAMP,
    });
    await expect(database().prepare(`
      SELECT "id" FROM "Recipe" WHERE "chefId" = ? AND "title" = ?
    `).bind(USER_ID, racedTitle).all()).resolves.toMatchObject({
      results: [{ id: TITLE_RACE_CONFLICT_ID }],
    });
  });

  it("maps the exact native D1 active-title create race to the MCP error", async () => {
    const racedTitle = "Unit 6.2 Native MCP Title Race";
    await execute(
      `CREATE UNIQUE INDEX "${ACTIVE_TITLE_INDEX}" ON "Recipe"("chefId", "title") WHERE "deletedAt" IS NULL`,
    );
    let nativeError: unknown;
    const nativeDatabase = recordingDatabase({
      async interceptBatch(records, runRealBatch) {
        if (!/^INSERT INTO\s+"Recipe"/i.test(normalizeSql(records[0]?.sql ?? ""))) {
          return runRealBatch();
        }
        await execute(`
          INSERT INTO "Recipe" (
            "id", "title", "chefId", "createdAt", "updatedAt"
          ) VALUES (?, ?, ?, ?, ?)
        `, TITLE_RACE_CONFLICT_ID, racedTitle, USER_ID, FAILURE_TIMESTAMP, FAILURE_TIMESTAMP);
        try {
          return await runRealBatch();
        } catch (error) {
          nativeError = error;
          throw error;
        }
      },
    });
    const prisma = await getDb({ DB: database() as unknown as D1Database });
    try {
      await expect(callSpoonjoyMcpTool("create_recipe", {
        ownerEmail: "unit-6-1-recipe-tags-d1@example.test",
        title: racedTitle,
      }, {
        db: prisma,
        allowOwnerEmailFallback: true,
        defaultOwnerEmail: "unit-6-1-recipe-tags-d1@example.test",
        env: { DB: nativeDatabase },
      })).rejects.toThrow(ACTIVE_RECIPE_TITLE_CONFLICT_ERROR);
    } finally {
      await prisma.$disconnect();
    }

    expect(nativeError).toMatchObject({
      message: "D1_ERROR: UNIQUE constraint failed: Recipe.chefId, Recipe.title: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)",
    });
    await expect(database().prepare(`
      SELECT "id" FROM "Recipe" WHERE "chefId" = ? AND "title" = ?
    `).bind(USER_ID, racedTitle).all()).resolves.toMatchObject({
      results: [{ id: TITLE_RACE_CONFLICT_ID }],
    });
    expect(nativeDatabase.batchCalls).toHaveLength(1);
  });

  it("maps the exact native D1 active-title update race to the MCP error", async () => {
    const racedTitle = "Unit 6.2 Native MCP Update Title Race";
    await execute(
      `CREATE UNIQUE INDEX "${ACTIVE_TITLE_INDEX}" ON "Recipe"("chefId", "title") WHERE "deletedAt" IS NULL`,
    );
    let nativeError: unknown;
    const nativeDatabase = recordingDatabase({
      async interceptBatch(records, runRealBatch) {
        if (!/^UPDATE\s+"Recipe"/i.test(normalizeSql(records[0]?.sql ?? ""))) {
          return runRealBatch();
        }
        await execute(`
          INSERT INTO "Recipe" (
            "id", "title", "chefId", "createdAt", "updatedAt"
          ) VALUES (?, ?, ?, ?, ?)
        `, TITLE_RACE_CONFLICT_ID, racedTitle, USER_ID, FAILURE_TIMESTAMP, FAILURE_TIMESTAMP);
        try {
          return await runRealBatch();
        } catch (error) {
          nativeError = error;
          throw error;
        }
      },
    });
    const prisma = await getDb({ DB: database() as unknown as D1Database });
    try {
      await expect(callSpoonjoyMcpTool("update_recipe", {
        ownerEmail: "unit-6-1-recipe-tags-d1@example.test",
        id: RECIPE_ID,
        title: racedTitle,
      }, {
        db: prisma,
        allowOwnerEmailFallback: true,
        defaultOwnerEmail: "unit-6-1-recipe-tags-d1@example.test",
        env: { DB: nativeDatabase },
      })).rejects.toThrow(ACTIVE_RECIPE_TITLE_CONFLICT_ERROR);
    } finally {
      await prisma.$disconnect();
    }

    expect(nativeError).toMatchObject({
      message: "D1_ERROR: UNIQUE constraint failed: Recipe.chefId, Recipe.title: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)",
    });
    await expect(database().prepare(`
      SELECT "title", "updatedAt" FROM "Recipe" WHERE "id" = ?
    `).bind(RECIPE_ID).first()).resolves.toEqual({
      title: "Unit 6.1 D1 Recipe",
      updatedAt: ORIGINAL_TIMESTAMP,
    });
    expect(nativeDatabase.batchCalls).toHaveLength(1);
  });

  it("creates and activates an uploaded cover inside the native graph batch", async () => {
    const nativeDatabase = recordingDatabase();
    const prisma = await getDb({ DB: database() as unknown as D1Database });
    const prismaWithoutTransactions = rejectPrismaTransactions(prisma);

    try {
      await expect(createRecipeDraft(
        prismaWithoutTransactions,
        {
          id: CREATE_RECIPE_ID,
          title: "Unit 6.2 Atomic Uploaded Cover",
          description: null,
          servings: null,
          chefId: USER_ID,
          steps: [],
        },
        {
          coverMutation: {
            kind: "uploaded",
            coverId: "unit-6-2-uploaded-cover",
            createdById: USER_ID,
            imageUrl: "/photos/unit-6-2-uploaded-cover.jpg",
          },
          nativeDatabase,
          now: () => new Date(FAILURE_TIMESTAMP),
        },
      )).resolves.toMatchObject({
        id: CREATE_RECIPE_ID,
        activeCoverId: "unit-6-2-uploaded-cover",
        activeCoverVariant: "image",
        coverMode: "manual",
      });
    } finally {
      await prisma.$disconnect();
    }

    expect(nativeDatabase.batchCalls).toHaveLength(1);
    expect(nativeDatabase.batchCalls[0]).toHaveLength(3);
    await expect(database().prepare(`
      SELECT "activeCoverId", "activeCoverVariant", "coverMode"
      FROM "Recipe" WHERE "id" = ?
    `).bind(CREATE_RECIPE_ID).first()).resolves.toEqual({
      activeCoverId: "unit-6-2-uploaded-cover",
      activeCoverVariant: "image",
      coverMode: "manual",
    });
    await expect(database().prepare(`
      SELECT "imageUrl", "sourceType", "status", "createdById", "sourceImageUrl"
      FROM "RecipeCover" WHERE "id" = ?
    `).bind("unit-6-2-uploaded-cover").first()).resolves.toEqual({
      imageUrl: "/photos/unit-6-2-uploaded-cover.jpg",
      sourceType: "chef-upload",
      status: "ready",
      createdById: USER_ID,
      sourceImageUrl: "/photos/unit-6-2-uploaded-cover.jpg",
    });
  });

  it("rolls back the native graph when uploaded-cover activation fails", async () => {
    await execute(`
      CREATE TRIGGER "${CREATE_COVER_ABORT_TRIGGER}"
      BEFORE UPDATE OF "activeCoverId" ON "Recipe"
      WHEN NEW."activeCoverId" = 'unit-6-2-failing-cover'
      BEGIN
        SELECT RAISE(ABORT, 'unit_6_2_cover_activation_failure');
      END
    `);
    const nativeDatabase = recordingDatabase();
    const prisma = await getDb({ DB: database() as unknown as D1Database });
    const prismaWithoutTransactions = rejectPrismaTransactions(prisma);

    try {
      await expect(createRecipeDraft(
        prismaWithoutTransactions,
        {
          id: CREATE_RECIPE_ID,
          title: "Unit 6.2 Cover Rollback",
          description: null,
          servings: null,
          chefId: USER_ID,
          tags: ["Rollback"],
          steps: [],
        },
        {
          coverMutation: {
            kind: "uploaded",
            coverId: "unit-6-2-failing-cover",
            createdById: USER_ID,
            imageUrl: "/photos/unit-6-2-failing-cover.jpg",
          },
          nativeDatabase,
          now: () => new Date(FAILURE_TIMESTAMP),
          randomId: () => "unit-6-2-cover-rollback-tag",
        },
      )).rejects.toThrow(/unit_6_2_cover_activation_failure/);
    } finally {
      await prisma.$disconnect();
    }

    expect(nativeDatabase.batchCalls).toHaveLength(1);
    expect(nativeDatabase.batchCalls[0]).toHaveLength(4);
    await expect(database().prepare(
      `SELECT COUNT(*) AS "count" FROM "Recipe" WHERE "id" = ?`,
    ).bind(CREATE_RECIPE_ID).first()).resolves.toEqual({ count: 0 });
    await expect(database().prepare(
      `SELECT COUNT(*) AS "count" FROM "RecipeTag" WHERE "recipeId" = ?`,
    ).bind(CREATE_RECIPE_ID).first()).resolves.toEqual({ count: 0 });
    await expect(database().prepare(
      `SELECT COUNT(*) AS "count" FROM "RecipeCover" WHERE "recipeId" = ?`,
    ).bind(CREATE_RECIPE_ID).first()).resolves.toEqual({ count: 0 });
  });

  it.each(createEnvelopeDefects())(
    "keeps a committed native create successful after $defect envelope corruption",
    async ({ mutate }) => {
    let intercepted = false;
    const nativeDatabase = recordingDatabase({
      async interceptBatch(records, runRealBatch) {
        if (records.length !== 3 || !/^INSERT INTO\s+"Recipe"/i.test(normalizeSql(records[0].sql))) {
          return runRealBatch();
        }
        intercepted = true;
        return mutate(await runRealBatch());
      },
    });
    const prisma = await getDb({ DB: database() as unknown as D1Database });
    const prismaWithoutTransactions = rejectPrismaTransactions(prisma);

    try {
      await expect(createRecipeDraft(
        prismaWithoutTransactions,
        {
          id: CREATE_RECIPE_ID,
          title: "Malformed Native Create",
          description: null,
          servings: "3",
          chefId: USER_ID,
          course: "side",
          tags: ["First", "Second"],
          steps: [],
        },
        {
          nativeDatabase,
          now: () => new Date(FAILURE_TIMESTAMP),
          randomId: (() => {
            const ids = ["malformed-create-first", "malformed-create-second"];
            return () => ids.shift() ?? "unexpected-malformed-create-id";
          })(),
        },
      )).resolves.toMatchObject({
        id: CREATE_RECIPE_ID,
        title: "Malformed Native Create",
        course: "side",
      });
    } finally {
      await prisma.$disconnect();
    }

    expect(intercepted).toBe(true);
    await expect(database().prepare(`
      SELECT "title", "servings", "course" FROM "Recipe" WHERE "id" = ?
    `).bind(CREATE_RECIPE_ID).first()).resolves.toEqual({
      title: "Malformed Native Create",
      servings: "3",
      course: "side",
    });
    await expect(database().prepare(`
      SELECT "label" FROM "RecipeTag" WHERE "recipeId" = ? ORDER BY "normalizedLabel"
    `).bind(CREATE_RECIPE_ID).all()).resolves.toMatchObject({
      results: [{ label: "First" }, { label: "Second" }],
    });
    },
  );

  it("passes the request DB binding into one guarded edit batch and rolls every edit back", async () => {
    await execute(`
      CREATE TRIGGER "${EDIT_ABORT_TRIGGER}"
      BEFORE UPDATE OF "updatedAt" ON "Cookbook"
      WHEN OLD."id" = '${COOKBOOK_ID}'
      BEGIN
        SELECT CASE WHEN
          (SELECT "title" FROM "Recipe" WHERE "id" = '${RECIPE_ID}') = 'Must Roll Back'
          AND (SELECT COUNT(*) FROM "RecipeTag"
            WHERE "recipeId" = '${RECIPE_ID}'
              AND "normalizedLabel" IN ('explode', 'first')) = 2
          AND (SELECT COUNT(*) FROM "RecipeTag"
            WHERE "recipeId" = '${RECIPE_ID}' AND "normalizedLabel" = 'original') = 0
        THEN RAISE(ABORT, 'unit_6_2_recipe_edit_late_failure')
        ELSE RAISE(IGNORE) END;
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

    const exportedUpdate = (recipeTagsModule as unknown as {
      updateRecipeAuthoringMetadata?: (...args: unknown[]) => Promise<unknown>;
    }).updateRecipeAuthoringMetadata;
    const updateSpy = exportedUpdate
      ? vi.spyOn(recipeTagsModule as never, "updateRecipeAuthoringMetadata" as never)
      : null;
    let updateCallInput: unknown;
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
      updateCallInput = updateSpy?.mock.calls[0]?.[0];
    } finally {
      updateSpy?.mockRestore();
    }

    const status = result instanceof Response
      ? result.status
      : (result as { init?: { status?: number } }).init?.status;
    expect(updateSpy).not.toBeNull();
    expect(updateCallInput).toMatchObject({ nativeDatabase });
    expect(status).toBe(500);
    expect(nativeDatabase.batchCalls).toHaveLength(1);
    const batch = nativeDatabase.batchCalls[0];
    expect(batch).toHaveLength(6);
    const timestamp = batch[0].values[4];
    expect(timestamp).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/));
    expect(batch.map((statement) => normalizeSql(statement.sql))).toEqual([
      'UPDATE "Recipe" SET "title" = ?, "description" = ?, "servings" = ?, "course" = ?, "updatedAt" = ? WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL RETURNING "id" AS "recipeId", "title", "description", "servings", "course", "updatedAt"',
      'DELETE FROM "RecipeTag" WHERE "recipeId" = ? AND EXISTS (SELECT 1 FROM "Recipe" WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL)',
      'INSERT INTO "RecipeTag" ("id", "recipeId", "label", "normalizedLabel", "createdAt", "updatedAt") SELECT ?, "id", ?, ?, ?, ? FROM "Recipe" WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL RETURNING "recipeId" AS "recipeId", "id" AS "tagId", "label" AS "label", "normalizedLabel" AS "normalizedLabel", "createdAt" AS "createdAt", "updatedAt" AS "updatedAt"',
      'INSERT INTO "RecipeTag" ("id", "recipeId", "label", "normalizedLabel", "createdAt", "updatedAt") SELECT ?, "id", ?, ?, ?, ? FROM "Recipe" WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL RETURNING "recipeId" AS "recipeId", "id" AS "tagId", "label" AS "label", "normalizedLabel" AS "normalizedLabel", "createdAt" AS "createdAt", "updatedAt" AS "updatedAt"',
      'SELECT membership."cookbookId" AS "cookbookId" FROM "RecipeInCookbook" AS membership WHERE membership."recipeId" = ? AND EXISTS (SELECT 1 FROM "Recipe" WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL) ORDER BY membership."cookbookId" COLLATE BINARY ASC',
      'UPDATE "Cookbook" SET "updatedAt" = ? WHERE "id" IN (SELECT "cookbookId" FROM "RecipeInCookbook" WHERE "recipeId" = ? AND EXISTS (SELECT 1 FROM "Recipe" WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL)) RETURNING "id" AS "cookbookId", "updatedAt" AS "updatedAt"',
    ]);
    expect(batch.map((statement) => statement.values)).toEqual([
      ["Must Roll Back", "Must also roll back", "99", "dessert", timestamp, RECIPE_ID, USER_ID],
      [RECIPE_ID, RECIPE_ID, USER_ID],
      [expect.any(String), "First", "first", timestamp, timestamp, RECIPE_ID, USER_ID],
      [expect.any(String), "Explode", "explode", timestamp, timestamp, RECIPE_ID, USER_ID],
      [RECIPE_ID, RECIPE_ID, USER_ID],
      [timestamp, RECIPE_ID, RECIPE_ID, USER_ID],
    ]);
    const batchSet = new Set(batch);
    expect(nativeDatabase.records.filter(isCoreAuthoringMutation).every((statement) => (
      batchSet.has(statement)
    ))).toBe(true);
    expect(nativeDatabase.records.map((statement) => statement.sql).join("\n"))
      .not.toMatch(/SearchDocument|SearchIndexMetadata/i);

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

  it("uses the native edit executor even when Prisma transactions are unusable", async () => {
    const exportedUpdate = (recipeTagsModule as unknown as {
      updateRecipeAuthoringMetadata?: (
        input: Record<string, unknown>,
        dependencies?: Record<string, unknown>,
      ) => Promise<unknown>;
    }).updateRecipeAuthoringMetadata;
    const updateRecipeAuthoringMetadata = exportedUpdate ?? (async () => undefined);

    const nativeDatabase = recordingDatabase();
    const prisma = await getDb({ DB: database() as unknown as D1Database });
    const prismaWithoutTransactions = rejectPrismaTransactions(prisma);
    try {
      await expect(updateRecipeAuthoringMetadata({
        database: prismaWithoutTransactions,
        nativeDatabase,
        userId: USER_ID,
        recipeId: RECIPE_ID,
        title: "Native Discriminator",
        description: "No Prisma transaction",
        servings: "5",
        course: "main",
        tags: ["Direct", "Native"],
      }, {
        now: () => new Date(WRITER_A_TIMESTAMP),
        randomId: (() => {
          const ids = ["native-discriminator-direct", "native-discriminator-native"];
          return () => ids.shift() ?? "unexpected-native-discriminator-id";
        })(),
      })).resolves.toMatchObject({
        recipeId: RECIPE_ID,
        title: "Native Discriminator",
        course: "main",
        boundTimestamp: WRITER_A_TIMESTAMP,
      });
    } finally {
      await prisma.$disconnect();
    }

    expect(nativeDatabase.batchCalls).toHaveLength(1);
    await expect(database().prepare(`
      SELECT "title", "description", "servings", "course", "updatedAt"
      FROM "Recipe" WHERE "id" = ?
    `).bind(RECIPE_ID).first()).resolves.toEqual({
      title: "Native Discriminator",
      description: "No Prisma transaction",
      servings: "5",
      course: "main",
      updatedAt: WRITER_A_TIMESTAMP,
    });
  });

  it("preserves metadata written concurrently before a legacy native edit batch", async () => {
    let intercepted = false;
    const nativeDatabase = recordingDatabase({
      async interceptBatch(records, runRealBatch) {
        if (!/^UPDATE\s+"Recipe"/i.test(normalizeSql(records[0]?.sql ?? ""))) {
          return runRealBatch();
        }
        intercepted = true;
        await execute(`UPDATE "Recipe" SET "course" = 'dessert' WHERE "id" = ?`, RECIPE_ID);
        await execute(`
          UPDATE "RecipeTag"
          SET "label" = 'Concurrent', "normalizedLabel" = 'concurrent'
          WHERE "recipeId" = ?
        `, RECIPE_ID);
        return runRealBatch();
      },
    });
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
    formData.set("title", "Legacy Concurrent Edit");

    const result = await editRecipeAction({
      request: new Request(`https://spoonjoy.app/recipes/${RECIPE_ID}/edit`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { id: RECIPE_ID },
      context: { cloudflare: { env: routeEnv } },
    } as any);

    expect(intercepted).toBe(true);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
    await expect(database().prepare(`
      SELECT "title", "course" FROM "Recipe" WHERE "id" = ?
    `).bind(RECIPE_ID).first()).resolves.toEqual({
      title: "Legacy Concurrent Edit",
      course: "dessert",
    });
    await expect(database().prepare(`
      SELECT "label", "normalizedLabel" FROM "RecipeTag" WHERE "recipeId" = ?
    `).bind(RECIPE_ID).all()).resolves.toMatchObject({
      results: [{ label: "Concurrent", normalizedLabel: "concurrent" }],
    });
    expect(nativeDatabase.batchCalls[0].map((record) => normalizeSql(record.sql)).join("\n"))
      .not.toMatch(/DELETE FROM "RecipeTag" WHERE "recipeId"|INSERT INTO "RecipeTag"/);
  });

  it.each(editEnvelopeDefects())(
    "keeps a committed native edit successful after $defect envelope corruption",
    async ({ mutate }) => {
    let intercepted = false;
    const nativeDatabase = recordingDatabase({
      async interceptBatch(records, runRealBatch) {
        if (records.length !== 6 || !/^UPDATE\s+"Recipe"/i.test(normalizeSql(records[0].sql))) {
          return runRealBatch();
        }
        intercepted = true;
        return mutate(await runRealBatch());
      },
    });
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
    formData.set("title", "Envelope Check");
    formData.set("description", "Must not persist");
    formData.set("servings", "8");
    formData.set("course", "appetizer");
    formData.set("tags", JSON.stringify(["First", "Second"]));

    const result = await editRecipeAction({
      request: new Request(`https://spoonjoy.app/recipes/${RECIPE_ID}/edit`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { id: RECIPE_ID },
      context: { cloudflare: { env: routeEnv } },
    } as any);

    const status = result instanceof Response
      ? result.status
      : (result as { init?: { status?: number } }).init?.status;
    expect(intercepted).toBe(true);
    expect(status).toBe(302);
    await expect(database().prepare(`
      SELECT "title", "description", "servings", "course", "updatedAt"
      FROM "Recipe" WHERE "id" = ?
    `).bind(RECIPE_ID).first()).resolves.toEqual({
      title: "Envelope Check",
      description: "Must not persist",
      servings: "8",
      course: "appetizer",
      updatedAt: expect.not.stringMatching(ORIGINAL_TIMESTAMP),
    });
    await expect(readMetadataState()).resolves.toMatchObject({
      course: "appetizer",
      labels: ["first", "second"],
    });
    const cookbook = await database().prepare(
      `SELECT "updatedAt" FROM "Cookbook" WHERE "id" = ?`,
    ).bind(COOKBOOK_ID).first<{ updatedAt: string }>();
    expect(cookbook?.updatedAt).not.toBe(ORIGINAL_TIMESTAMP);
    },
  );

  it("maps the real all-zero D1 envelope from a deletion race to 404", async () => {
    let intercepted = false;
    let actualResults: TestD1Result[] = [];
    const nativeDatabase = recordingDatabase({
      async interceptBatch(records, runRealBatch) {
        if (records.length !== 6 || !/^UPDATE\s+"Recipe"/i.test(normalizeSql(records[0].sql))) {
          return runRealBatch();
        }
        intercepted = true;
        await execute(`DELETE FROM "RecipeInCookbook" WHERE "recipeId" = ?`, RECIPE_ID);
        await execute(`DELETE FROM "RecipeTag" WHERE "recipeId" = ?`, RECIPE_ID);
        await execute(`DELETE FROM "Recipe" WHERE "id" = ?`, RECIPE_ID);
        actualResults = await runRealBatch();
        return actualResults;
      },
    });
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
    formData.set("title", "Raced Away");
    formData.set("course", "main");
    formData.set("tags", JSON.stringify(["Never Persisted"]));
    const result = await editRecipeAction({
      request: new Request(`https://spoonjoy.app/recipes/${RECIPE_ID}/edit`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { id: RECIPE_ID },
      context: { cloudflare: { env: routeEnv } },
    } as any);

    const status = result instanceof Response
      ? result.status
      : (result as { init?: { status?: number } }).init?.status;
    expect(intercepted).toBe(true);
    expect(status).toBe(404);
    expect(actualResults).toHaveLength(6);
    expect(actualResults.every((result) => (
      result.success === true
      && result.meta.changes === 0
      && result.results.length === 0
    ))).toBe(true);
    await expect(database().prepare(
      `SELECT COUNT(*) AS "count" FROM "Recipe" WHERE "id" = ?`,
    ).bind(RECIPE_ID).first()).resolves.toEqual({ count: 0 });
    await expect(database().prepare(
      `SELECT COUNT(*) AS "count" FROM "RecipeTag" WHERE "recipeId" = ?`,
    ).bind(RECIPE_ID).first()).resolves.toEqual({ count: 0 });
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
