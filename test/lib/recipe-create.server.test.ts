import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { faker } from "@faker-js/faker";
import {
  createRecipeDraft,
  parseRecipeStepsJson,
  readCommittedRecipeGraph,
  RecipeDraftNotFoundError,
  RecipeGraphTooLargeError,
  type CreateRecipeDraftInput,
  updateRecipeDraft,
} from "~/lib/recipe-create.server";
import { createUser } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { ensureSearchIndexFresh, rebuildSearchIndex, searchSpoonjoy } from "~/lib/search.server";
import type {
  CompatibleRecipeTagD1Database,
  CompatibleRecipeTagD1PreparedStatement,
} from "~/lib/recipe-tags.server";

function compactSql(sql: unknown): string {
  return String(sql).replace(/\s+/g, " ").trim();
}

function expectInvalidSteps(payload: unknown, expectedError: string) {
  const result = parseRecipeStepsJson(typeof payload === "string" ? payload : JSON.stringify(payload));
  expect(result).toEqual({ valid: false, error: expectedError });
}

type RecipeCreationDatabase = Parameters<typeof createRecipeDraft>[0];

interface CapturedCreationStatement extends CompatibleRecipeTagD1PreparedStatement {
  sql: string;
  values: unknown[];
}

interface CreationResultCase {
  label: string;
  expectedError: string;
  mutate(results: unknown[]): unknown;
}

const CREATION_TIMESTAMP = new Date("2026-07-23T12:34:56.000Z");
const CREATION_TIMESTAMP_TEXT = CREATION_TIMESTAMP.toISOString();

function recipeCreationInput(
  chefId: string,
  overrides: Partial<CreateRecipeDraftInput> = {},
): CreateRecipeDraftInput {
  return {
    id: "recipe-result-validation",
    title: "Result Validation Supper",
    description: null,
    servings: "2",
    chefId,
    course: "main",
    tags: ["Quick"],
    steps: [],
    ...overrides,
  };
}

function recipeGraphCreationInput(
  chefId: string,
  overrides: Partial<CreateRecipeDraftInput> = {},
): CreateRecipeDraftInput {
  return recipeCreationInput(chefId, {
    id: "recipe-graph-contract",
    tags: ["Quick"],
    steps: [
      {
        stepTitle: "Mix",
        description: "Mix flour and milk",
        duration: 5,
        ingredients: [
          { quantity: 2, unit: "Cup", ingredientName: "Flour" },
          { quantity: 1, unit: "cup", ingredientName: "Milk" },
        ],
      },
      {
        stepTitle: null,
        description: "Cook in butter",
        duration: null,
        ingredients: [{ quantity: 1, unit: "Tbsp", ingredientName: "Butter" }],
      },
    ],
    ...overrides,
  });
}

function sequentialIds(ids: string[]) {
  return () => ids.shift() ?? "unexpected-creation-id";
}

function recipeCreationRow(
  input: CreateRecipeDraftInput,
  course: CreateRecipeDraftInput["course"] = input.course,
) {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    servings: input.servings,
    sourceUrl: input.sourceUrl ?? null,
    chefId: input.chefId,
    course: course ?? null,
    createdAt: CREATION_TIMESTAMP_TEXT,
    updatedAt: CREATION_TIMESTAMP_TEXT,
  };
}

function tagCreationRow(input: CreateRecipeDraftInput) {
  return {
    recipeId: input.id,
    tagId: "tag-result-validation",
    label: "Quick",
    normalizedLabel: "quick",
    createdAt: CREATION_TIMESTAMP_TEXT,
    updatedAt: CREATION_TIMESTAMP_TEXT,
  };
}

function nativeCreationResult(
  results: unknown,
  options: { success?: boolean; changes?: number; meta?: unknown } = {},
) {
  return {
    success: options.success ?? true,
    results,
    meta: options.meta ?? { changes: options.changes ?? 1 },
  };
}

function successfulCreationRows(statements: CapturedCreationStatement[]) {
  const unitIds = new Map<string, unknown>();
  const ingredientRefIds = new Map<string, unknown>();
  for (const statement of statements) {
    const sql = compactSql(statement.sql);
    if (sql.startsWith('INSERT INTO "Unit"')) {
      unitIds.set(String(statement.values[1]), statement.values[0]);
    } else if (sql.startsWith('INSERT INTO "IngredientRef"')) {
      ingredientRefIds.set(String(statement.values[1]), statement.values[0]);
    }
  }

  return statements.map((statement) => {
    const sql = compactSql(statement.sql);
    if (sql.startsWith('INSERT INTO "RecipeTag"')) {
      return [{
        recipeId: statement.values[1],
        tagId: statement.values[0],
        label: statement.values[2],
        normalizedLabel: statement.values[3],
        createdAt: statement.values[4],
        updatedAt: statement.values[5],
      }];
    }
    if (sql.startsWith('INSERT INTO "RecipeStep"')) {
      return [{
        id: statement.values[0],
        recipeId: statement.values[1],
        stepNum: statement.values[2],
        stepTitle: statement.values[3],
        description: statement.values[4],
        duration: statement.values[5],
        updatedAt: statement.values[6],
      }];
    }
    if (sql.startsWith('INSERT INTO "Unit"') || sql.startsWith('INSERT INTO "IngredientRef"')) {
      return [{
        id: statement.values[0],
        name: statement.values[1],
        updatedAt: statement.values[2],
      }];
    }
    if (sql.startsWith('INSERT INTO "Ingredient"')) {
      return [{
        id: statement.values[0],
        recipeId: statement.values[1],
        stepNum: statement.values[2],
        quantity: statement.values[3],
        unitId: unitIds.get(String(statement.values[4])),
        ingredientRefId: ingredientRefIds.get(String(statement.values[5])),
        updatedAt: statement.values[6],
      }];
    }
    if (sql.startsWith('INSERT INTO "RecipeCover"')) {
      return [{
        id: statement.values[0],
        recipeId: statement.values[8],
        imageUrl: statement.values[1],
        sourceType: statement.values[2],
        status: statement.values[3],
        createdById: statement.values[4],
        sourceImageUrl: statement.values[5],
        generationStatus: statement.values[6],
        createdAt: statement.values[7],
      }];
    }
    if (sql.startsWith('UPDATE "Recipe"')) {
      const clearing = sql.includes('"activeCoverId" = NULL');
      return [{
        recipeId: statement.values[clearing ? 1 : 2],
        activeCoverId: clearing ? null : statement.values[0],
        activeCoverVariant: clearing ? null : "image",
        coverMode: clearing ? "none" : "manual",
        updatedAt: statement.values[clearing ? 0 : 1],
      }];
    }
    if (sql.startsWith('INSERT INTO "Recipe"')) {
      return [{
        id: statement.values[0],
        title: statement.values[1],
        description: statement.values[2],
        servings: statement.values[3],
        sourceUrl: statement.values[4],
        chefId: statement.values[5],
        course: statement.values[6],
        createdAt: statement.values[7],
        updatedAt: statement.values[8],
      }];
    }
    throw new Error(`Unexpected creation SQL: ${sql}`);
  });
}

function successfulNativeCreationResults(statements: CapturedCreationStatement[]) {
  return successfulCreationRows(statements).map((rows) => nativeCreationResult(rows));
}

function captureNativeCreationDatabase(
  results: (statements: CapturedCreationStatement[]) => unknown,
) {
  const statements: CapturedCreationStatement[] = [];
  const batch = vi.fn(async () => results(statements));
  const database: CompatibleRecipeTagD1Database = {
    prepare(sql: string) {
      const statement: CapturedCreationStatement = {
        sql,
        values: [],
        bind(...values: unknown[]) {
          statement.values = values;
          return statement;
        },
      };
      statements.push(statement);
      return statement;
    },
    batch,
  };
  return { database, statements, batch };
}

function localCreationDatabase(
  results: unknown | ((statements: CapturedCreationStatement[]) => unknown),
) {
  const queryRaw = vi.fn(async () => []);
  const transaction = vi.fn(async () => {
    if (typeof results !== "function") return results;
    const statements = queryRaw.mock.calls.map(([sql, ...values]) => ({
      sql: String(sql),
      values,
      bind: vi.fn(),
    }));
    return results(statements);
  });
  const database = {
    $queryRawUnsafe: queryRaw,
    $transaction: transaction,
  } as unknown as RecipeCreationDatabase;
  return { database, queryRaw, transaction };
}

function nativeFallbackDatabase() {
  const queryRaw = vi.fn();
  const transaction = vi.fn();
  const database = {
    $queryRawUnsafe: queryRaw,
    $transaction: transaction,
  } as unknown as RecipeCreationDatabase;
  return { database, queryRaw, transaction };
}

describe("recipe create helpers", () => {
  let testUserId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    const user = await createUser(
      db,
      faker.internet.email(),
      `${faker.internet.username()}_${faker.string.alphanumeric(8)}`,
      "testPassword123"
    );
    testUserId = user.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("parseRecipeStepsJson", () => {
    it("returns an empty step list for an empty submitted array", () => {
      expect(parseRecipeStepsJson("[]")).toEqual({ valid: true, steps: [] });
    });

    it("normalizes valid steps, optional fields, durations, and ingredients", () => {
      const result = parseRecipeStepsJson(JSON.stringify([
        {
          stepTitle: " Prep ",
          description: " Mix batter ",
          duration: "12",
          ingredients: [{ quantity: "2.5", unit: " Cup ", ingredientName: " Flour " }],
        },
        {
          stepTitle: "",
          description: "Bake",
          duration: "",
          ingredients: [],
        },
        {
          description: "Rest",
        },
        {
          stepTitle: "   ",
          description: "Whisk",
        },
        {
          stepTitle: null,
          description: "Cool",
          duration: null,
          ingredients: null,
        },
        {
          description: "Serve",
          duration: 3,
          ingredients: [{ quantity: 1, unit: "plate", ingredientName: "cake" }],
        },
      ]));

      expect(result).toEqual({
        valid: true,
        steps: [
          {
            stepTitle: "Prep",
            description: "Mix batter",
            duration: 12,
            ingredients: [{ quantity: 2.5, unit: "Cup", ingredientName: "Flour" }],
          },
          {
            stepTitle: null,
            description: "Bake",
            duration: null,
            ingredients: [],
          },
          {
            stepTitle: null,
            description: "Rest",
            duration: null,
            ingredients: [],
          },
          {
            stepTitle: null,
            description: "Whisk",
            duration: null,
            ingredients: [],
          },
          {
            stepTitle: null,
            description: "Cool",
            duration: null,
            ingredients: [],
          },
          {
            stepTitle: null,
            description: "Serve",
            duration: 3,
            ingredients: [{ quantity: 1, unit: "plate", ingredientName: "cake" }],
          },
        ],
      });
    });

    it("rejects invalid step payload containers", () => {
      expectInvalidSteps("not-json", "Recipe steps must be valid JSON");
      expectInvalidSteps({ description: "Mix" }, "Recipe steps must be an array");
      expectInvalidSteps([null], "Step 1: Step must be an object");
    });

    it("rejects invalid step title fields", () => {
      expectInvalidSteps([{ stepTitle: 42, description: "Mix" }], "Step 1: Step title must be text");
      expectInvalidSteps(
        [{ stepTitle: "a".repeat(201), description: "Mix" }],
        "Step 1: Step title must be 200 characters or less"
      );
    });

    it("rejects invalid step descriptions", () => {
      expectInvalidSteps([{ description: "" }], "Step 1: Step description is required");
      expectInvalidSteps([{}], "Step 1: Step description is required");
      expectInvalidSteps(
        [{ description: "a".repeat(5001) }],
        "Step 1: Description must be 5,000 characters or less"
      );
    });

    it("rejects invalid durations", () => {
      expectInvalidSteps([{ description: "Mix", duration: 0 }], "Step 1: Duration must be a positive whole number");
      expectInvalidSteps([{ description: "Mix", duration: 1.5 }], "Step 1: Duration must be a positive whole number");
      expectInvalidSteps([{ description: "Mix", duration: {} }], "Step 1: Duration must be a positive whole number");
    });

    it("rejects invalid ingredient containers", () => {
      expectInvalidSteps([{ description: "Mix", ingredients: {} }], "Step 1: Ingredients must be an array");
      expectInvalidSteps(
        [{ description: "Mix", ingredients: [null] }],
        "Step 1, ingredient 1: Ingredient must be an object"
      );
    });

    it("rejects invalid ingredient quantities", () => {
      expectInvalidSteps(
        [{ description: "Mix", ingredients: [{ quantity: {}, unit: "cup", ingredientName: "flour" }] }],
        "Step 1, ingredient 1: Quantity must be a valid number"
      );
      expectInvalidSteps(
        [{ description: "Mix", ingredients: [{ quantity: 0, unit: "cup", ingredientName: "flour" }] }],
        "Step 1, ingredient 1: Quantity must be between 0.001 and 99,999"
      );
    });

    it("rejects invalid ingredient units", () => {
      expectInvalidSteps(
        [{ description: "Mix", ingredients: [{ quantity: 1, ingredientName: "flour" }] }],
        "Step 1, ingredient 1: Unit name is required"
      );
      expectInvalidSteps(
        [{ description: "Mix", ingredients: [{ quantity: 1, unit: "a".repeat(51), ingredientName: "flour" }] }],
        "Step 1, ingredient 1: Unit name must be 50 characters or less"
      );
    });

    it("rejects invalid ingredient names", () => {
      expectInvalidSteps(
        [{ description: "Mix", ingredients: [{ quantity: 1, unit: "cup" }] }],
        "Step 1, ingredient 1: Ingredient name is required"
      );
      expectInvalidSteps(
        [{ description: "Mix", ingredients: [{ quantity: 1, unit: "cup", ingredientName: "a".repeat(101) }] }],
        "Step 1, ingredient 1: Ingredient name must be 100 characters or less"
      );
    });
  });

  describe("createRecipeDraft", () => {
    it("commits an authoring graph at the exact 900-operation limit", async () => {
      const ingredients = Array.from({ length: 299 }, (_, index) => ({
        quantity: 1,
        unit: `Boundary Unit ${index}`,
        ingredientName: `Boundary Ingredient ${index}`,
      }));

      await expect(createRecipeDraft(db, {
        id: "maximum-create-graph",
        title: "Maximum Create Graph",
        description: null,
        servings: null,
        chefId: testUserId,
        tags: ["Boundary"],
        steps: [{ stepTitle: null, description: "Exactly enough", duration: null, ingredients }],
      }, { nativeDatabase: null })).resolves.toMatchObject({ id: "maximum-create-graph" });
      await expect(db.ingredient.count({ where: { recipeId: "maximum-create-graph" } }))
        .resolves.toBe(299);
      await expect(db.recipeTag.count({ where: { recipeId: "maximum-create-graph" } }))
        .resolves.toBe(1);
    });

    it("rejects oversized authoring graphs before preparing any database work", async () => {
      const fallback = nativeFallbackDatabase();
      const ingredients = Array.from({ length: 299 }, (_, index) => ({
        quantity: 1,
        unit: `Unit ${index}`,
        ingredientName: `Ingredient ${index}`,
      }));

      await expect(createRecipeDraft(fallback.database, {
        id: "oversized-create-graph",
        title: "Oversized Create Graph",
        description: null,
        servings: null,
        chefId: testUserId,
        tags: ["First", "Second"],
        steps: [{ stepTitle: null, description: "Too much", duration: null, ingredients }],
      }, { nativeDatabase: null })).rejects.toMatchObject({
        name: "RecipeGraphTooLargeError",
        message: "Recipe contains too many steps or ingredients",
        operationCount: 901,
      } satisfies Partial<RecipeGraphTooLargeError>);
      expect(fallback.queryRaw).not.toHaveBeenCalled();
      expect(fallback.transaction).not.toHaveBeenCalled();
    });
    it("creates recipes, steps, units, ingredient refs, and ingredients in one durable graph", async () => {
      await db.unit.create({ data: { name: "cup" } });
      await db.ingredientRef.create({ data: { name: "flour" } });

      const recipe = await createRecipeDraft(db, {
        id: "recipe-transaction-pancakes",
        title: "Transaction Pancakes",
        description: "Breakfast for agents",
        servings: "4",
        chefId: testUserId,
        steps: [
          {
            stepTitle: "Mix",
            description: "Mix dry ingredients",
            duration: 5,
            ingredients: [
              { quantity: 2, unit: "Cup", ingredientName: "Flour" },
              { quantity: 1, unit: "cup", ingredientName: "Milk" },
            ],
          },
          {
            stepTitle: null,
            description: "Cook until golden",
            duration: null,
            ingredients: [{ quantity: 1, unit: "Tbsp", ingredientName: "Butter" }],
          },
        ],
      }, { nativeDatabase: null });

      const persisted = await db.recipe.findUniqueOrThrow({
        where: { id: recipe.id },
        include: {
          steps: {
            orderBy: { stepNum: "asc" },
            include: {
              ingredients: {
                include: { unit: true, ingredientRef: true },
                orderBy: { ingredientRef: { name: "asc" } },
              },
            },
          },
        },
      });

      expect(persisted).toMatchObject({
        id: "recipe-transaction-pancakes",
        title: "Transaction Pancakes",
        description: "Breakfast for agents",
        servings: "4",
        chefId: testUserId,
      });
      expect("imageUrl" in persisted).toBe(false);
      const covers = await db.recipeCover.findMany({ where: { recipeId: recipe.id } });
      expect(covers).toEqual([]);
      expect(persisted.steps).toHaveLength(2);
      expect(persisted.steps[0]).toMatchObject({
        stepNum: 1,
        stepTitle: "Mix",
        description: "Mix dry ingredients",
        duration: 5,
      });
      expect(persisted.steps[1]).toMatchObject({
        stepNum: 2,
        stepTitle: null,
        description: "Cook until golden",
        duration: null,
      });
      expect(persisted.steps[0].ingredients.map((ingredient) => ({
        quantity: ingredient.quantity,
        unit: ingredient.unit.name,
        name: ingredient.ingredientRef.name,
      }))).toEqual([
        { quantity: 2, unit: "cup", name: "flour" },
        { quantity: 1, unit: "cup", name: "milk" },
      ]);
      expect(persisted.steps[1].ingredients.map((ingredient) => ({
        quantity: ingredient.quantity,
        unit: ingredient.unit.name,
        name: ingredient.ingredientRef.name,
      }))).toEqual([{ quantity: 1, unit: "tbsp", name: "butter" }]);
      await expect(db.unit.count({ where: { name: "cup" } })).resolves.toBe(1);
      await expect(db.ingredientRef.count({ where: { name: "flour" } })).resolves.toBe(1);
    });

    it("atomically creates the authenticated chef's recipe, course, and normalized tags with one timestamp", async () => {
      const timestamp = new Date("2026-07-23T12:34:56.000Z");
      const tagIds = ["tag-weeknight", "tag-quick"];
      const now = vi.fn()
        .mockReturnValueOnce(timestamp)
        .mockImplementation(() => {
          throw new Error("creation timestamp requested more than once");
        });
      await rebuildSearchIndex(db);
      const searchDocumentsBefore = await db.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM "SearchDocument" ORDER BY "entityType", "entityId"`,
      );
      const searchMetadataBefore = await db.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM "SearchIndexMetadata" ORDER BY "id"`,
      );

      const transactionSpy = vi.spyOn(db, "$transaction");
      const rawSpy = vi.spyOn(db, "$queryRawUnsafe");
      let recipe!: Awaited<ReturnType<typeof createRecipeDraft>>;
      let transactionCalls = 0;
      let transactionInput: unknown;
      let rawCalls: unknown[][] = [];
      let rawPromises: unknown[] = [];
      try {
        recipe = await createRecipeDraft(
          db,
          {
            id: "recipe-atomic-metadata",
            title: "Atomic Metadata Supper",
            description: null,
            servings: "2",
            chefId: testUserId,
            course: "main",
            tags: ["  Weeknight  ", "Quick"],
            steps: [],
          },
          {
            nativeDatabase: null,
            now,
            randomId: () => tagIds.shift() ?? "unexpected-tag-id",
          },
        );
        transactionCalls = transactionSpy.mock.calls.length;
        transactionInput = transactionSpy.mock.calls[0]?.[0];
        rawCalls = rawSpy.mock.calls.map((call) => [...call]);
        rawPromises = rawSpy.mock.results.map((result) => result.value);
      } finally {
        transactionSpy.mockRestore();
        rawSpy.mockRestore();
      }

      expect(transactionCalls).toBe(1);
      expect(Array.isArray(transactionInput)).toBe(true);
      expect(transactionInput).toHaveLength(3);
      expect((transactionInput as unknown[]).every((operation, index) => (
        operation === rawPromises[index]
      ))).toBe(true);
      expect(rawCalls.map(([sql, ...values]) => [compactSql(sql), ...values])).toEqual([
        [
          'INSERT INTO "Recipe" ( "id", "title", "description", "servings", "sourceUrl", "chefId", "course", "createdAt", "updatedAt" ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING "id", "title", "description", "servings", "sourceUrl", "chefId", "course", "createdAt", "updatedAt"',
          "recipe-atomic-metadata", "Atomic Metadata Supper", null, "2", null, testUserId, "main",
          timestamp.toISOString(), timestamp.toISOString(),
        ],
        [
          'INSERT INTO "RecipeTag" ("id", "recipeId", "label", "normalizedLabel", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?) RETURNING "recipeId", "id" AS "tagId", "label", "normalizedLabel", "createdAt", "updatedAt"',
          "tag-weeknight", "recipe-atomic-metadata", "Weeknight", "weeknight",
          timestamp.toISOString(), timestamp.toISOString(),
        ],
        [
          'INSERT INTO "RecipeTag" ("id", "recipeId", "label", "normalizedLabel", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?) RETURNING "recipeId", "id" AS "tagId", "label", "normalizedLabel", "createdAt", "updatedAt"',
          "tag-quick", "recipe-atomic-metadata", "Quick", "quick",
          timestamp.toISOString(), timestamp.toISOString(),
        ],
      ]);
      expect(now).toHaveBeenCalledTimes(1);
      expect(recipe).toMatchObject({
        id: "recipe-atomic-metadata",
        chefId: testUserId,
        course: "main",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await expect(db.recipeTag.findMany({
        where: { recipeId: recipe.id },
        orderBy: { normalizedLabel: "asc" },
      })).resolves.toEqual([
        expect.objectContaining({
          id: "tag-quick",
          recipeId: recipe.id,
          label: "Quick",
          normalizedLabel: "quick",
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
        expect.objectContaining({
          id: "tag-weeknight",
          recipeId: recipe.id,
          label: "Weeknight",
          normalizedLabel: "weeknight",
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      ]);
      await expect(db.$queryRawUnsafe(
        `SELECT * FROM "SearchDocument" ORDER BY "entityType", "entityId"`,
      )).resolves.toEqual(searchDocumentsBefore);
      await expect(db.$queryRawUnsafe(
        `SELECT * FROM "SearchIndexMetadata" ORDER BY "id"`,
      )).resolves.toEqual(searchMetadataBefore);
      await expect(ensureSearchIndexFresh(db)).resolves.toBeGreaterThan(searchDocumentsBefore.length);
      await expect(searchSpoonjoy(db, {
        query: "weeknight",
        scope: "recipes",
        viewerId: testUserId,
      })).resolves.toMatchObject([{ id: recipe.id, title: recipe.title }]);
    });

    it("applies empty metadata defaults and validates the native recipe envelope", async () => {
      const input = recipeCreationInput(testUserId, {
        id: "recipe-native-defaults",
        course: undefined,
        tags: undefined,
      });
      const native = captureNativeCreationDatabase(successfulNativeCreationResults);
      const fallback = nativeFallbackDatabase();

      await expect(createRecipeDraft(fallback.database, input, {
        nativeDatabase: native.database,
        now: () => CREATION_TIMESTAMP,
      })).resolves.toMatchObject({
        id: input.id,
        course: null,
        createdAt: CREATION_TIMESTAMP,
        updatedAt: CREATION_TIMESTAMP,
      });

      expect(native.batch).toHaveBeenCalledOnce();
      expect(native.statements).toHaveLength(1);
      expect(native.statements[0].values).toEqual([
        input.id,
        input.title,
        input.description,
        input.servings,
        null,
        input.chefId,
        null,
        CREATION_TIMESTAMP_TEXT,
        CREATION_TIMESTAMP_TEXT,
      ]);
      expect(fallback.queryRaw).not.toHaveBeenCalled();
      expect(fallback.transaction).not.toHaveBeenCalled();
    });

    it("prepares and validates every tagged native creation statement", async () => {
      const input = recipeCreationInput(testUserId, { id: "recipe-native-tagged" });
      const native = captureNativeCreationDatabase(successfulNativeCreationResults);
      const fallback = nativeFallbackDatabase();

      await expect(createRecipeDraft(fallback.database, input, {
        nativeDatabase: native.database,
        now: () => CREATION_TIMESTAMP,
        randomId: () => "tag-result-validation",
      })).resolves.toMatchObject({ id: input.id, course: "main" });

      expect(native.batch).toHaveBeenCalledOnce();
      expect(native.statements).toHaveLength(2);
      expect(compactSql(native.statements[1].sql)).toContain('INSERT INTO "RecipeTag"');
      expect(native.statements[1].values).toEqual([
        "tag-result-validation",
        input.id,
        "Quick",
        "quick",
        CREATION_TIMESTAMP_TEXT,
        CREATION_TIMESTAMP_TEXT,
      ]);
      expect(fallback.queryRaw).not.toHaveBeenCalled();
      expect(fallback.transaction).not.toHaveBeenCalled();
    });

    it("uses one exact recipe-graph operation contract for native D1 and local Prisma", async () => {
      const input = recipeGraphCreationInput(testUserId);
      const ids = [
        "tag-quick",
        "step-mix",
        "step-cook",
        "unit-cup",
        "unit-tbsp",
        "ref-flour",
        "ref-milk",
        "ref-butter",
        "ingredient-flour",
        "ingredient-milk",
        "ingredient-butter",
      ];
      const native = captureNativeCreationDatabase(successfulNativeCreationResults);
      const fallback = nativeFallbackDatabase();
      const local = localCreationDatabase(successfulCreationRows);

      const nativeRecipe = await createRecipeDraft(fallback.database, input, {
        nativeDatabase: native.database,
        now: () => CREATION_TIMESTAMP,
        randomId: sequentialIds([...ids]),
      });
      const localRecipe = await createRecipeDraft(local.database, input, {
        nativeDatabase: null,
        now: () => CREATION_TIMESTAMP,
        randomId: sequentialIds([...ids]),
      });

      const expectedSql = [
        'INSERT INTO "Recipe" ( "id", "title", "description", "servings", "sourceUrl", "chefId", "course", "createdAt", "updatedAt" ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING "id", "title", "description", "servings", "sourceUrl", "chefId", "course", "createdAt", "updatedAt"',
        'INSERT INTO "RecipeTag" ("id", "recipeId", "label", "normalizedLabel", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?) RETURNING "recipeId", "id" AS "tagId", "label", "normalizedLabel", "createdAt", "updatedAt"',
        ...Array(2).fill('INSERT INTO "RecipeStep" ( "id", "recipeId", "stepNum", "stepTitle", "description", "duration", "updatedAt" ) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING "id", "recipeId", "stepNum", "stepTitle", "description", "duration", "updatedAt"'),
        ...Array(2).fill('INSERT INTO "Unit" ("id", "name", "updatedAt") VALUES (?, ?, ?) ON CONFLICT("name") DO UPDATE SET "name" = excluded."name" RETURNING "id", "name", "updatedAt"'),
        ...Array(3).fill('INSERT INTO "IngredientRef" ("id", "name", "updatedAt") VALUES (?, ?, ?) ON CONFLICT("name") DO UPDATE SET "name" = excluded."name" RETURNING "id", "name", "updatedAt"'),
        ...Array(3).fill('INSERT INTO "Ingredient" ( "id", "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId", "updatedAt" ) VALUES ( ?, ?, ?, ?, (SELECT "id" FROM "Unit" WHERE "name" = ?), (SELECT "id" FROM "IngredientRef" WHERE "name" = ?), ? ) RETURNING "id", "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId", "updatedAt"'),
      ];
      const expectedBinds = [
        [input.id, input.title, input.description, input.servings, null, input.chefId, "main", CREATION_TIMESTAMP_TEXT, CREATION_TIMESTAMP_TEXT],
        ["tag-quick", input.id, "Quick", "quick", CREATION_TIMESTAMP_TEXT, CREATION_TIMESTAMP_TEXT],
        ["step-mix", input.id, 1, "Mix", "Mix flour and milk", 5, CREATION_TIMESTAMP_TEXT],
        ["step-cook", input.id, 2, null, "Cook in butter", null, CREATION_TIMESTAMP_TEXT],
        ["unit-cup", "cup", CREATION_TIMESTAMP_TEXT],
        ["unit-tbsp", "tbsp", CREATION_TIMESTAMP_TEXT],
        ["ref-flour", "flour", CREATION_TIMESTAMP_TEXT],
        ["ref-milk", "milk", CREATION_TIMESTAMP_TEXT],
        ["ref-butter", "butter", CREATION_TIMESTAMP_TEXT],
        ["ingredient-flour", input.id, 1, 2, "cup", "flour", CREATION_TIMESTAMP_TEXT],
        ["ingredient-milk", input.id, 1, 1, "cup", "milk", CREATION_TIMESTAMP_TEXT],
        ["ingredient-butter", input.id, 2, 1, "tbsp", "butter", CREATION_TIMESTAMP_TEXT],
      ];

      expect(native.statements.map(({ sql }) => compactSql(sql))).toEqual(expectedSql);
      expect(native.statements.map(({ values }) => values)).toEqual(expectedBinds);
      expect(local.queryRaw.mock.calls.map(([sql]) => compactSql(sql))).toEqual(expectedSql);
      expect(local.queryRaw.mock.calls.map(([, ...values]) => values)).toEqual(expectedBinds);
      expect(local.transaction.mock.calls[0]?.[0]).toEqual(
        local.queryRaw.mock.results.map(({ value }) => value),
      );
      expect(native.batch.mock.calls[0]?.[0]).toEqual(native.statements);
      expect(nativeRecipe).toEqual(localRecipe);
      expect(nativeRecipe).toMatchObject({
        id: input.id,
        course: "main",
        createdAt: CREATION_TIMESTAMP,
        updatedAt: CREATION_TIMESTAMP,
      });
      expect(fallback.queryRaw).not.toHaveBeenCalled();
      expect(fallback.transaction).not.toHaveBeenCalled();
    });

    it("uses the production clock and UUID generator for local metadata creation", async () => {
      const input = recipeCreationInput(testUserId, {
        id: "recipe-local-default-dependencies",
      });

      const recipe = await createRecipeDraft(db, input, { nativeDatabase: null });

      expect(recipe).toMatchObject({
        id: input.id,
        course: "main",
      });
      expect(recipe.createdAt).toBeInstanceOf(Date);
      const tags = await db.recipeTag.findMany({ where: { recipeId: input.id } });
      expect(tags).toHaveLength(1);
      expect(tags[0]).toMatchObject({
        label: "Quick",
        normalizedLabel: "quick",
      });
      expect(tags[0].id).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it.each<CreationResultCase>([
      {
        label: "non-array result list",
        expectedError: "Invalid recipe creation result",
        mutate: () => null,
      },
      {
        label: "wrong result count",
        expectedError: "Invalid recipe creation result",
        mutate: () => [],
      },
      {
        label: "non-array recipe rows",
        expectedError: "Invalid recipe creation result",
        mutate: (results: unknown[]) => [null, results[1]],
      },
      {
        label: "wrong recipe row count",
        expectedError: "Invalid recipe creation result",
        mutate: (results: unknown[]) => [[], results[1]],
      },
      {
        label: "malformed recipe row",
        expectedError: "Invalid recipe creation row",
        mutate: (results: unknown[]) => [[{
          ...((results[0] as unknown[])[0] as Record<string, unknown>),
          title: "Wrong title",
        }], results[1]],
      },
      {
        label: "non-array tag rows",
        expectedError: "Invalid recipe creation result",
        mutate: (results: unknown[]) => [results[0], null],
      },
      {
        label: "wrong tag row count",
        expectedError: "Invalid recipe tag creation result",
        mutate: (results: unknown[]) => [results[0], []],
      },
      {
        label: "malformed tag row",
        expectedError: "Invalid recipe tag creation row",
        mutate: (results: unknown[]) => [results[0], [{
          ...((results[1] as unknown[])[0] as Record<string, unknown>),
          normalizedLabel: "wrong",
        }]],
      },
    ])("does not report a false failure for committed local $label", async ({ mutate }) => {
      const input = recipeCreationInput(testUserId);
      const successfulResults = [
        [recipeCreationRow(input)],
        [tagCreationRow(input)],
      ];
      const local = localCreationDatabase(mutate(successfulResults));

      await expect(createRecipeDraft(local.database, input, {
        nativeDatabase: null,
        now: () => CREATION_TIMESTAMP,
        randomId: () => "tag-result-validation",
      })).resolves.toMatchObject({ id: input.id, course: "main" });

      expect(local.queryRaw).toHaveBeenCalledTimes(2);
      expect(local.transaction).toHaveBeenCalledOnce();
    });

    it.each<CreationResultCase>([
      {
        label: "non-array result list",
        expectedError: "Invalid recipe creation result",
        mutate: () => null,
      },
      {
        label: "wrong result count",
        expectedError: "Invalid recipe creation result",
        mutate: () => [],
      },
      {
        label: "non-object recipe statement",
        expectedError: "Invalid recipe creation result",
        mutate: (results: unknown[]) => [null, results[1]],
      },
      {
        label: "unsuccessful recipe statement",
        expectedError: "Recipe creation batch statement failed",
        mutate: (results: unknown[]) => [{
          ...(results[0] as Record<string, unknown>),
          success: false,
        }, results[1]],
      },
      {
        label: "non-object recipe metadata",
        expectedError: "Invalid recipe creation result",
        mutate: (results: unknown[]) => [{
          ...(results[0] as Record<string, unknown>),
          meta: null,
        }, results[1]],
      },
      {
        label: "wrong recipe change count",
        expectedError: "Invalid recipe creation result",
        mutate: (results: unknown[]) => [{
          ...(results[0] as Record<string, unknown>),
          meta: { changes: 0 },
        }, results[1]],
      },
      {
        label: "non-array recipe rows",
        expectedError: "Invalid recipe creation result",
        mutate: (results: unknown[]) => [{
          ...(results[0] as Record<string, unknown>),
          results: null,
        }, results[1]],
      },
      {
        label: "wrong recipe row count",
        expectedError: "Invalid recipe creation result",
        mutate: (results: unknown[]) => [{
          ...(results[0] as Record<string, unknown>),
          results: [],
        }, results[1]],
      },
      {
        label: "malformed recipe row",
        expectedError: "Invalid recipe creation row",
        mutate: (results: unknown[]) => [{
          ...(results[0] as Record<string, unknown>),
          results: [{
            ...(((results[0] as Record<string, unknown>).results as unknown[])[0] as Record<string, unknown>),
            chefId: "wrong-chef",
          }],
        }, results[1]],
      },
      {
        label: "unsuccessful tag statement",
        expectedError: "Recipe creation batch statement failed",
        mutate: (results: unknown[]) => [results[0], {
          ...(results[1] as Record<string, unknown>),
          success: false,
        }],
      },
      {
        label: "non-array tag rows",
        expectedError: "Invalid recipe creation result",
        mutate: (results: unknown[]) => [results[0], {
          ...(results[1] as Record<string, unknown>),
          results: null,
        }],
      },
      {
        label: "wrong tag row count",
        expectedError: "Invalid recipe tag creation result",
        mutate: (results: unknown[]) => [results[0], {
          ...(results[1] as Record<string, unknown>),
          results: [],
        }],
      },
      {
        label: "malformed tag row",
        expectedError: "Invalid recipe tag creation row",
        mutate: (results: unknown[]) => [results[0], {
          ...(results[1] as Record<string, unknown>),
          results: [{
            ...(((results[1] as Record<string, unknown>).results as unknown[])[0] as Record<string, unknown>),
            tagId: "wrong-tag",
          }],
        }],
      },
    ])("does not report a false failure for committed native $label", async ({ mutate }) => {
      const input = recipeCreationInput(testUserId);
      const native = captureNativeCreationDatabase((statements) =>
        mutate(successfulNativeCreationResults(statements))
      );
      const fallback = nativeFallbackDatabase();

      await expect(createRecipeDraft(fallback.database, input, {
        nativeDatabase: native.database,
        now: () => CREATION_TIMESTAMP,
        randomId: () => "tag-result-validation",
      })).resolves.toMatchObject({ id: input.id, course: "main" });

      expect(native.batch).toHaveBeenCalledOnce();
      expect(fallback.queryRaw).not.toHaveBeenCalled();
      expect(fallback.transaction).not.toHaveBeenCalled();
    });

    it.each([
      {
        label: "step row",
        index: 2,
        field: "stepNum",
        value: 99,
        expectedError: "Invalid recipe step creation row",
      },
      {
        label: "unit row",
        index: 3,
        field: "name",
        value: "wrong-unit",
        expectedError: "Invalid recipe unit creation row",
      },
      {
        label: "ingredient reference row",
        index: 4,
        field: "id",
        value: "",
        expectedError: "Invalid recipe ingredient reference creation row",
      },
      {
        label: "ingredient row",
        index: 5,
        field: "unitId",
        value: "wrong-unit-id",
        expectedError: "Invalid ingredient creation row",
      },
    ])("accepts a committed native graph with a malformed diagnostic $label", async ({
      index,
      field,
      value,
    }) => {
      const input = recipeGraphCreationInput(testUserId, {
        steps: [{
          stepTitle: null,
          description: "Mix",
          duration: null,
          ingredients: [{ quantity: 1, unit: "Cup", ingredientName: "Flour" }],
        }],
      });
      const native = captureNativeCreationDatabase((statements) => {
        const results = successfulNativeCreationResults(statements);
        const envelope = results[index] as Record<string, unknown>;
        const rows = envelope.results as Record<string, unknown>[];
        return results.map((result, resultIndex) => resultIndex === index ? {
          ...envelope,
          results: [{ ...rows[0], [field]: value }],
        } : result);
      });
      const fallback = nativeFallbackDatabase();

      await expect(createRecipeDraft(fallback.database, input, {
        nativeDatabase: native.database,
        now: () => CREATION_TIMESTAMP,
        randomId: sequentialIds(["tag", "step", "unit", "ref", "ingredient"]),
      })).resolves.toMatchObject({ id: input.id, course: "main" });

      expect(native.batch).toHaveBeenCalledOnce();
      expect(fallback.queryRaw).not.toHaveBeenCalled();
      expect(fallback.transaction).not.toHaveBeenCalled();
    });

    it.each([
      { index: 2, expectedError: "Invalid recipe step creation result" },
      { index: 3, expectedError: "Invalid recipe unit creation result" },
      { index: 4, expectedError: "Invalid recipe ingredient reference creation result" },
      { index: 5, expectedError: "Invalid ingredient creation result" },
    ])("accepts a committed local graph with an empty diagnostic at operation $index", async ({
      index,
    }) => {
      const input = recipeGraphCreationInput(testUserId, {
        steps: [{
          stepTitle: null,
          description: "Mix",
          duration: null,
          ingredients: [{ quantity: 1, unit: "Cup", ingredientName: "Flour" }],
        }],
      });
      const local = localCreationDatabase((statements) => (
        successfulCreationRows(statements).map((rows, resultIndex) => (
          resultIndex === index ? [] : rows
        ))
      ));

      await expect(createRecipeDraft(local.database, input, {
        nativeDatabase: null,
        now: () => CREATION_TIMESTAMP,
        randomId: sequentialIds(["tag", "step", "unit", "ref", "ingredient"]),
      })).resolves.toMatchObject({ id: input.id, course: "main" });

      expect(local.queryRaw).toHaveBeenCalledTimes(6);
      expect(local.transaction).toHaveBeenCalledOnce();
    });

    it.each([
      {
        label: "uploaded cover",
        mutation: {
          kind: "uploaded" as const,
          coverId: "diagnostic-uploaded-cover",
          createdById: "owner",
          imageUrl: "/photos/diagnostic-uploaded.jpg",
        },
        operationCount: 4,
      },
      {
        label: "placeholder cover",
        mutation: {
          kind: "placeholder" as const,
          coverId: "diagnostic-placeholder-cover",
          createdById: "owner",
        },
        operationCount: 3,
      },
      {
        label: "clear cover",
        mutation: { kind: "clear" as const },
        operationCount: 3,
      },
    ])("validates a committed native $label diagnostic", async ({ mutation, operationCount }) => {
      const input = recipeCreationInput(testUserId, { id: `recipe-${mutation.kind}-diagnostic` });
      const native = captureNativeCreationDatabase(successfulNativeCreationResults);
      const fallback = nativeFallbackDatabase();

      await expect(createRecipeDraft(fallback.database, input, {
        coverMutation: {
          ...mutation,
          ...(mutation.kind === "clear" ? {} : { createdById: testUserId }),
        },
        nativeDatabase: native.database,
        now: () => CREATION_TIMESTAMP,
      })).resolves.toMatchObject({ id: input.id });

      expect(native.statements).toHaveLength(operationCount);
    });

    it.each([
      { label: "cover insertion row", operationIndex: 2, field: "id", value: "wrong-cover" },
      { label: "cover activation row", operationIndex: 3, field: "coverMode", value: "auto" },
    ])("does not report a false failure for a malformed committed native $label", async ({
      operationIndex,
      field,
      value,
    }) => {
      const input = recipeCreationInput(testUserId, { id: `recipe-cover-${operationIndex}` });
      const native = captureNativeCreationDatabase((statements) => {
        const results = successfulNativeCreationResults(statements);
        const envelope = results[operationIndex] as Record<string, unknown>;
        const rows = envelope.results as Record<string, unknown>[];
        return results.map((result, index) => index === operationIndex ? {
          ...envelope,
          results: [{ ...rows[0], [field]: value }],
        } : result);
      });

      await expect(createRecipeDraft(nativeFallbackDatabase().database, input, {
        coverMutation: {
          kind: "uploaded",
          coverId: "malformed-diagnostic-cover",
          createdById: testUserId,
          imageUrl: "/photos/malformed-diagnostic.jpg",
        },
        nativeDatabase: native.database,
        now: () => CREATION_TIMESTAMP,
      })).resolves.toMatchObject({ id: input.id });
    });

    it.each([
      { label: "cover insertion", operationIndex: 2 },
      { label: "cover activation", operationIndex: 3 },
    ])("does not report a false failure for an empty committed native $label diagnostic", async ({
      operationIndex,
    }) => {
      const input = recipeCreationInput(testUserId, { id: `recipe-empty-cover-${operationIndex}` });
      const native = captureNativeCreationDatabase((statements) => (
        successfulNativeCreationResults(statements).map((result, index) => index === operationIndex
          ? { ...(result as Record<string, unknown>), results: [] }
          : result)
      ));

      await expect(createRecipeDraft(nativeFallbackDatabase().database, input, {
        coverMutation: {
          kind: "uploaded",
          coverId: "empty-diagnostic-cover",
          createdById: testUserId,
          imageUrl: "/photos/empty-diagnostic.jpg",
        },
        nativeDatabase: native.database,
        now: () => CREATION_TIMESTAMP,
      })).resolves.toMatchObject({ id: input.id });
    });

    it("rolls back the initial recipe when a later tag insertion fails", async () => {
      const recipeId = "recipe-create-rollback";
      await db.$executeRawUnsafe(`
        CREATE TRIGGER "RecipeTag_create_abort"
        BEFORE INSERT ON "RecipeTag"
        WHEN NEW."normalizedLabel" = 'quick'
        BEGIN
          SELECT RAISE(ABORT, 'recipe create tag failure');
        END
      `);

      try {
        await expect(createRecipeDraft(
          db,
          {
            id: recipeId,
            title: "Rollback Supper",
            description: null,
            servings: null,
            chefId: testUserId,
            course: "side",
            tags: ["Weeknight", "Quick"],
            steps: [],
          },
          {
            nativeDatabase: null,
            now: () => new Date("2026-07-23T12:34:56.000Z"),
            randomId: (() => {
              let index = 0;
              return () => `rollback-tag-${index++}`;
            })(),
          },
        )).rejects.toThrow("recipe create tag failure");

        await expect(db.recipe.findUnique({ where: { id: recipeId } })).resolves.toBeNull();
        await expect(db.recipeTag.count({ where: { recipeId } })).resolves.toBe(0);
      } finally {
        await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "RecipeTag_create_abort"');
      }
    });

    it("rolls back the recipe, tags, and first step when the second step fails", async () => {
      const recipeId = "recipe-create-step-rollback";
      await db.$executeRawUnsafe(`
        CREATE TRIGGER "RecipeStep_create_abort"
        BEFORE INSERT ON "RecipeStep"
        WHEN NEW."recipeId" = '${recipeId}' AND NEW."stepNum" = 2
        BEGIN
          SELECT RAISE(ABORT, 'recipe create step failure');
        END
      `);

      try {
        await expect(createRecipeDraft(
          db,
          recipeGraphCreationInput(testUserId, {
            id: recipeId,
            steps: [
              { stepTitle: null, description: "First", duration: null, ingredients: [] },
              { stepTitle: null, description: "Second", duration: null, ingredients: [] },
            ],
          }),
          {
            nativeDatabase: null,
            now: () => CREATION_TIMESTAMP,
            randomId: sequentialIds(["step-rollback-tag", "step-rollback-1", "step-rollback-2"]),
          },
        )).rejects.toThrow("recipe create step failure");

        await expect(db.recipe.findUnique({ where: { id: recipeId } })).resolves.toBeNull();
        await expect(db.recipeTag.count({ where: { recipeId } })).resolves.toBe(0);
        await expect(db.recipeStep.count({ where: { recipeId } })).resolves.toBe(0);
      } finally {
        await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "RecipeStep_create_abort"');
      }
    });

    it("rolls back the full graph and new lookup rows when a later ingredient fails", async () => {
      const recipeId = "recipe-create-ingredient-rollback";
      const existingUnit = await db.unit.create({ data: { name: "cup" } });
      const existingIngredientRef = await db.ingredientRef.create({ data: { name: "flour" } });
      await db.$executeRawUnsafe(`
        CREATE TRIGGER "Ingredient_create_abort"
        BEFORE INSERT ON "Ingredient"
        WHEN NEW."id" = 'ingredient-rollback-salt'
        BEGIN
          SELECT RAISE(ABORT, 'recipe create ingredient failure');
        END
      `);

      try {
        await expect(createRecipeDraft(
          db,
          recipeGraphCreationInput(testUserId, {
            id: recipeId,
            steps: [{
              stepTitle: "Mix",
              description: "Mix before the late failure",
              duration: 4,
              ingredients: [
                { quantity: 1, unit: "Cup", ingredientName: "Flour" },
                { quantity: 2, unit: "Tsp", ingredientName: "Salt" },
              ],
            }],
          }),
          {
            nativeDatabase: null,
            now: () => CREATION_TIMESTAMP,
            randomId: sequentialIds([
              "ingredient-rollback-tag",
              "ingredient-rollback-step",
              "ingredient-rollback-unit-cup",
              "ingredient-rollback-unit-tsp",
              "ingredient-rollback-ref-flour",
              "ingredient-rollback-ref-salt",
              "ingredient-rollback-flour",
              "ingredient-rollback-salt",
            ]),
          },
        )).rejects.toThrow("recipe create ingredient failure");

        await expect(db.recipe.findUnique({ where: { id: recipeId } })).resolves.toBeNull();
        await expect(db.recipeTag.count({ where: { recipeId } })).resolves.toBe(0);
        await expect(db.recipeStep.count({ where: { recipeId } })).resolves.toBe(0);
        await expect(db.ingredient.count({ where: { recipeId } })).resolves.toBe(0);
        await expect(db.unit.findMany({
          where: { name: { in: ["cup", "tsp"] } },
          orderBy: { name: "asc" },
        })).resolves.toEqual([existingUnit]);
        await expect(db.ingredientRef.findMany({
          where: { name: { in: ["flour", "salt"] } },
          orderBy: { name: "asc" },
        })).resolves.toEqual([existingIngredientRef]);
      } finally {
        await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "Ingredient_create_abort"');
      }
    });
  });

  describe("updateRecipeDraft", () => {
    it("commits a replacement graph at the exact 900-operation limit", async () => {
      const recipe = await db.recipe.create({
        data: { id: "maximum-update-graph", title: "Maximum Update Graph", chefId: testUserId },
      });
      const ingredients = Array.from({ length: 297 }, (_, index) => ({
        quantity: 1,
        unit: `Update Boundary Unit ${index}`,
        ingredientName: `Update Boundary Ingredient ${index}`,
      }));

      await expect(updateRecipeDraft(db, {
        id: recipe.id,
        chefId: testUserId,
        steps: [{ stepTitle: null, description: "Exactly enough", duration: null, ingredients }],
      }, {
        nativeDatabase: null,
        coverMutation: {
          kind: "uploaded",
          coverId: "maximum-update-cover",
          createdById: testUserId,
          imageUrl: "https://example.test/maximum-update.png",
        },
      })).resolves.toBeUndefined();
      await expect(db.ingredient.count({ where: { recipeId: recipe.id } })).resolves.toBe(297);
      await expect(db.recipe.findUniqueOrThrow({ where: { id: recipe.id } })).resolves.toMatchObject({
        activeCoverId: "maximum-update-cover",
        activeCoverVariant: "image",
        coverMode: "manual",
      });
    });

    it("rejects oversized replacement graphs before preparing any database work", async () => {
      const fallback = nativeFallbackDatabase();
      const ingredients = Array.from({ length: 298 }, (_, index) => ({
        quantity: 1,
        unit: `Update Unit ${index}`,
        ingredientName: `Update Ingredient ${index}`,
      }));

      await expect(updateRecipeDraft(fallback.database, {
        id: "oversized-update-graph",
        chefId: testUserId,
        steps: [{ stepTitle: null, description: "Too much", duration: null, ingredients }],
      }, { nativeDatabase: null })).rejects.toMatchObject({
        name: "RecipeGraphTooLargeError",
        operationCount: 901,
      } satisfies Partial<RecipeGraphTooLargeError>);
      expect(fallback.queryRaw).not.toHaveBeenCalled();
      expect(fallback.transaction).not.toHaveBeenCalled();
    });
    function capturedNativeUpdate(results: unknown) {
      const statements: CapturedCreationStatement[] = [];
      const database: CompatibleRecipeTagD1Database = {
        prepare(sql) {
          const statement: CapturedCreationStatement = {
            sql,
            values: [],
            bind(...values) {
              statement.values = values;
              return statement;
            },
          };
          statements.push(statement);
          return statement;
        },
        batch: vi.fn(async () => results),
      };
      return { database, statements };
    }

    function canonicalZero() {
      return { success: true, meta: { changes: 0 }, results: [] };
    }

    it("recognizes exact all-zero local and native update graphs as not found", async () => {
      const fallback = nativeFallbackDatabase();
      fallback.transaction.mockResolvedValueOnce([[], [], []]);
      await expect(updateRecipeDraft(fallback.database, {
        id: "missing-local-update",
        chefId: testUserId,
      }, { nativeDatabase: null })).rejects.toEqual(
        new RecipeDraftNotFoundError("missing-local-update"),
      );

      const native = capturedNativeUpdate([canonicalZero(), canonicalZero(), canonicalZero()]);
      await expect(updateRecipeDraft(fallback.database, {
        id: "missing-native-update",
        chefId: testUserId,
      }, { nativeDatabase: native.database })).rejects.toEqual(
        new RecipeDraftNotFoundError("missing-native-update"),
      );
      expect(native.statements).toHaveLength(3);
      expect(compactSql(native.statements[0].sql)).toMatch(
        /WHERE "id" = \? AND "chefId" = \? AND "deletedAt" IS NULL/,
      );
    });

    it.each([
      ["non-array envelope", null],
      ["wrong operation count", [canonicalZero(), canonicalZero()]],
      ["non-object result", [null, canonicalZero(), canonicalZero()]],
      ["array result", [[], canonicalZero(), canonicalZero()]],
      ["failed result", [{ ...canonicalZero(), success: false }, canonicalZero(), canonicalZero()]],
      ["missing rows", [{ success: true, meta: { changes: 0 } }, canonicalZero(), canonicalZero()]],
      ["returned row", [{ ...canonicalZero(), results: [{}] }, canonicalZero(), canonicalZero()]],
      ["missing metadata", [{ success: true, results: [] }, canonicalZero(), canonicalZero()]],
      ["scalar metadata", [{ success: true, meta: 0, results: [] }, canonicalZero(), canonicalZero()]],
      ["array metadata", [{ success: true, meta: [], results: [] }, canonicalZero(), canonicalZero()]],
      ["nonzero changes", [{ success: true, meta: { changes: 1 }, results: [] }, canonicalZero(), canonicalZero()]],
    ])("does not turn a malformed committed native %s into not found", async (_label, results) => {
      const native = capturedNativeUpdate(results);
      await expect(updateRecipeDraft(nativeFallbackDatabase().database, {
        id: "committed-native-update",
        chefId: testUserId,
      }, { nativeDatabase: native.database })).resolves.toBeUndefined();
    });

    it("rolls back a real local update graph after a late ingredient failure", async () => {
      const recipe = await db.recipe.create({
        data: { title: "Local Update Rollback", chefId: testUserId },
      });
      await db.recipeStep.create({
        data: { id: "local-update-old-step", recipeId: recipe.id, stepNum: 1, description: "Keep me" },
      });
      await db.$executeRawUnsafe(`
        CREATE TRIGGER "Ingredient_local_update_abort"
        BEFORE INSERT ON "Ingredient"
        WHEN NEW."id" = 'local-update-new-ingredient'
        BEGIN
          SELECT RAISE(ABORT, 'local update ingredient failure');
        END
      `);

      try {
        await expect(updateRecipeDraft(db, {
          id: recipe.id,
          chefId: testUserId,
          title: "Must Roll Back",
          steps: [{
            stepTitle: null,
            description: "Replacement",
            duration: null,
            ingredients: [{ quantity: 1, unit: "Rollback Cup", ingredientName: "Rollback Flour" }],
          }],
        }, {
          nativeDatabase: null,
          randomId: sequentialIds([
            "local-update-new-step",
            "local-update-new-unit",
            "local-update-new-ref",
            "local-update-new-ingredient",
          ]),
        })).rejects.toThrow("local update ingredient failure");
      } finally {
        await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "Ingredient_local_update_abort"');
      }

      await expect(db.recipe.findUniqueOrThrow({ where: { id: recipe.id } }))
        .resolves.toMatchObject({ title: "Local Update Rollback" });
      await expect(db.recipeStep.findMany({ where: { recipeId: recipe.id } }))
        .resolves.toMatchObject([{ id: "local-update-old-step", description: "Keep me" }]);
      await expect(db.unit.count({ where: { name: "rollback cup" } })).resolves.toBe(0);
      await expect(db.ingredientRef.count({ where: { name: "rollback flour" } })).resolves.toBe(0);
    });
  });

  describe("readCommittedRecipeGraph", () => {
    function committedGraphDatabase(results: unknown[]) {
      return {
        $queryRawUnsafe: vi.fn(),
        $transaction: vi.fn().mockResolvedValue(results),
      } as unknown as RecipeCreationDatabase;
    }

    it("returns null for a missing committed recipe", async () => {
      await expect(readCommittedRecipeGraph(
        committedGraphDatabase([[], [], [], []]),
        "missing-recipe",
        { chefId: "missing-chef" },
      )).resolves.toBeNull();
    });

    it.each([
      ["non-array result", [null, [], [], []]],
      ["non-object row", [[null], [], [], []]],
      ["multiple recipe rows", [[{ id: "one" }, { id: "two" }], [], [], []]],
      ["invalid ingredient step", [[{ id: "recipe" }], [], [], [{ stepNum: "1" }]]],
    ])("rejects an invalid committed graph %s", async (_label, results) => {
      await expect(readCommittedRecipeGraph(
        committedGraphDatabase(results),
        "recipe",
        { chefId: "chef" },
      )).rejects.toThrow(/Invalid committed recipe graph|Invalid committed recipe ingredient/);
    });

    it("reads a committed graph through one native D1 batch without Prisma transactions", async () => {
      const statements: CapturedCreationStatement[] = [];
      const batch = vi.fn().mockResolvedValue([
        { success: true, meta: { changes: 0 }, results: [{
          id: "native-recipe",
          chefId: "native-chef",
          chefEmail: "native@example.test",
          chefUsername: "native",
        }] },
        { success: true, meta: { changes: 0 }, results: [] },
        { success: true, meta: { changes: 0 }, results: [{
          id: "native-step",
          stepNum: 1,
          description: "Native snapshot",
        }] },
        { success: true, meta: { changes: 0 }, results: [] },
      ]);
      const nativeDatabase: CompatibleRecipeTagD1Database = {
        prepare(sql) {
          const statement: CapturedCreationStatement = {
            sql,
            values: [],
            bind(...values) {
              statement.values = values;
              return statement;
            },
          };
          statements.push(statement);
          return statement;
        },
        batch,
      };
      const fallback = nativeFallbackDatabase();

      const ownerScopedOptions = {
        nativeDatabase,
        chefId: "native-chef",
      };
      await expect(readCommittedRecipeGraph(
        fallback.database,
        "native-recipe",
        ownerScopedOptions,
      )).resolves.toMatchObject({
        id: "native-recipe",
        chef: { id: "native-chef", email: "native@example.test", username: "native" },
        steps: [{ id: "native-step", ingredients: [] }],
      });
      expect(batch).toHaveBeenCalledWith(statements);
      expect(statements).toHaveLength(4);
      expect(statements[0]).toMatchObject({
        sql: expect.stringMatching(/recipe\."chefId" = \?.*recipe\."deletedAt" IS NULL/s),
        values: ["native-recipe", "native-chef"],
      });
      expect(statements.slice(1).map((statement) => statement.values)).toEqual([
        ["native-recipe"],
        ["native-recipe"],
        ["native-recipe"],
      ]);
      expect(fallback.transaction).not.toHaveBeenCalled();
    });

    it.each([
      ["wrong native count", []],
      ["non-object native entry", [null, null, null, null]],
      ["failed native entry", [
        { success: false, results: [] },
        { success: true, results: [] },
        { success: true, results: [] },
        { success: true, results: [] },
      ]],
      ["missing native rows", [
        { success: true },
        { success: true, results: [] },
        { success: true, results: [] },
        { success: true, results: [] },
      ]],
    ])("rejects an invalid %s recovery envelope", async (_label, results) => {
      const native = captureNativeCreationDatabase(() => results);
      await expect(readCommittedRecipeGraph(nativeFallbackDatabase().database, "recipe", {
        chefId: "chef",
        nativeDatabase: native.database,
      })).rejects.toThrow("Invalid committed recipe graph result");
    });
  });
});
