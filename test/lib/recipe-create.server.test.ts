import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { faker } from "@faker-js/faker";
import {
  createRecipeDraft,
  parseRecipeStepsJson,
  type CreateRecipeDraftInput,
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

function recipeCreationRow(
  input: CreateRecipeDraftInput,
  course: CreateRecipeDraftInput["course"] = input.course,
) {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    servings: input.servings,
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

function successfulNativeCreationResults(statements: CapturedCreationStatement[]) {
  return statements.map((statement) => {
    if (compactSql(statement.sql).startsWith('INSERT INTO "RecipeTag"')) {
      return nativeCreationResult([{
        recipeId: statement.values[1],
        tagId: statement.values[0],
        label: statement.values[2],
        normalizedLabel: statement.values[3],
        createdAt: statement.values[4],
        updatedAt: statement.values[5],
      }]);
    }
    return nativeCreationResult([{
      id: statement.values[0],
      title: statement.values[1],
      description: statement.values[2],
      servings: statement.values[3],
      chefId: statement.values[4],
      course: statement.values[5],
      createdAt: statement.values[6],
      updatedAt: statement.values[7],
    }]);
  });
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

function localCreationDatabase(results: unknown) {
  const queryRaw = vi.fn(async () => []);
  const transaction = vi.fn(async () => results);
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
      });

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
          'INSERT INTO "Recipe" ("id", "title", "description", "servings", "chefId", "course", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING "id", "title", "description", "servings", "chefId", "course", "createdAt", "updatedAt"',
          "recipe-atomic-metadata", "Atomic Metadata Supper", null, "2", testUserId, "main",
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

    it("uses the production clock and UUID generator for local metadata creation", async () => {
      const input = recipeCreationInput(testUserId, {
        id: "recipe-local-default-dependencies",
      });

      const recipe = await createRecipeDraft(db, input);

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
    ])("rejects local $label", async ({ mutate, expectedError }) => {
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
      })).rejects.toThrow(expectedError);

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
    ])("rejects native $label without Prisma fallback", async ({ mutate, expectedError }) => {
      const input = recipeCreationInput(testUserId);
      const native = captureNativeCreationDatabase((statements) =>
        mutate(successfulNativeCreationResults(statements))
      );
      const fallback = nativeFallbackDatabase();

      await expect(createRecipeDraft(fallback.database, input, {
        nativeDatabase: native.database,
        now: () => CREATION_TIMESTAMP,
        randomId: () => "tag-result-validation",
      })).rejects.toThrow(expectedError);

      expect(native.batch).toHaveBeenCalledOnce();
      expect(fallback.queryRaw).not.toHaveBeenCalled();
      expect(fallback.transaction).not.toHaveBeenCalled();
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
  });
});
