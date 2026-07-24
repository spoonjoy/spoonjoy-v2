import type { PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/lib/db.server";
import {
  RECIPE_COURSES,
  RecipeTagNotFoundError,
  RecipeTagValidationError,
  asCompatibleRecipeTagD1Database,
  getRecipeTagMetadata,
  normalizeRecipeCourse,
  normalizeRecipeTags,
  parseRecipeAuthoringMetadataForm,
  prepareRecipeTagMetadataReplacement,
  replaceRecipeTagMetadata,
  updateRecipeAuthoringMetadata,
} from "~/lib/recipe-tags.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../utils";

async function createUser(label: string) {
  return db.user.create({
    data: {
      ...createTestUser(),
      username: `${label}_${faker.string.alphanumeric(8).toLowerCase()}`,
    },
  });
}

async function createRecipe(input: {
  chefId: string;
  title?: string;
  course?: "main" | "side" | "appetizer" | "dessert" | null;
  deletedAt?: Date | null;
}) {
  return db.recipe.create({
    data: {
      ...createTestRecipe(input.chefId),
      title: input.title ?? `tag_recipe_${faker.string.alphanumeric(8)}`,
      course: input.course,
      deletedAt: input.deletedAt,
    },
  });
}

async function createTag(input: {
  id?: string;
  recipeId: string;
  label: string;
  normalizedLabel: string;
}) {
  return db.recipeTag.create({ data: input });
}

function expectValidation(error: unknown, field: string) {
  expect(error).toBeInstanceOf(RecipeTagValidationError);
  expect(error).toMatchObject({ field });
}

function twoPartyBarrier() {
  let arrivals = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return vi.fn(async () => {
    arrivals += 1;
    if (arrivals === 2) release();
    await ready;
  });
}

function normalizedSql(value: unknown) {
  return String(value).replace(/\s+/g, " ").trim();
}

interface RecipeTagReplacementInput {
  userId: string;
  recipeId: string;
  course: "main" | "side" | "appetizer" | "dessert" | null;
  tags: string[];
}

interface CapturedD1Statement {
  sql: string;
  values: unknown[];
  bind(...values: unknown[]): CapturedD1Statement;
}

interface MetadataSnapshot {
  course: "main" | "side" | "appetizer" | "dessert" | null;
  labels: string[];
}

const BOUND_NOW = new Date("2026-07-23T18:19:20.123Z");
const BOUND_NOW_TEXT = BOUND_NOW.toISOString();

interface ReplacementDependencies {
  now?: () => Date;
  randomId?: () => string;
}

function replaceLocally(
  database: PrismaClient,
  input: RecipeTagReplacementInput,
  dependencies?: ReplacementDependencies,
) {
  return replaceRecipeTagMetadata({
    database,
    nativeDatabase: null,
    ...input,
  }, dependencies);
}

function snapshot(value: {
  course: MetadataSnapshot["course"];
  tags: Array<{ normalizedLabel: string }>;
}): MetadataSnapshot {
  return {
    course: value.course,
    labels: value.tags.map((tag) => tag.normalizedLabel),
  };
}

function isDefinedConcurrentWriteConflict(value: unknown): boolean {
  if (!(value instanceof Error)) return false;
  const code = (value as Error & { code?: unknown }).code;
  return code === "P1008"
    || code === "P2034"
    || /SQLITE_BUSY|database is locked/i.test(value.message);
}

function nativeResult(
  results: unknown[] = [],
  changes = 1,
): { success: true; results: unknown[]; meta: { changes: number } } {
  return { success: true, results, meta: { changes } };
}

function successfulNativeResults(statements: CapturedD1Statement[]) {
  const update = statements.find((statement) =>
    normalizedSql(statement.sql).startsWith(`UPDATE "Recipe"`)
  );
  const course = update?.values[0];
  return statements.map((statement) => {
    const sql = normalizedSql(statement.sql);
    if (sql.startsWith(`UPDATE "Recipe"`)) {
      return nativeResult([{
        recipeId: statement.values[2],
        course,
        updatedAt: statement.values[1],
      }]);
    }
    if (sql.startsWith(`INSERT INTO "RecipeTag"`)) {
      return nativeResult([{
        recipeId: statement.values[5],
        tagId: statement.values[0],
        label: statement.values[1],
        normalizedLabel: statement.values[2],
        createdAt: statement.values[3],
        updatedAt: statement.values[4],
      }]);
    }
    return nativeResult([]);
  });
}

function successfulLocalResults(statements: CapturedD1Statement[]) {
  return successfulNativeResults(statements).map((result, index) => (
    index === 1 ? result.meta.changes : result.results
  ));
}

function captureNativeDatabase(results: unknown[] = []) {
  const statements: CapturedD1Statement[] = [];
  const batch = vi.fn().mockResolvedValue(results);
  const database = {
    prepare: vi.fn((sql: string) => {
      const statement: CapturedD1Statement = {
        sql,
        values: [],
        bind(...values: unknown[]) {
          statement.values = values;
          return statement;
        },
      };
      statements.push(statement);
      return statement;
    }),
    batch,
  };
  return { database, statements, batch };
}

function statementIndex(statements: CapturedD1Statement[], prefix: string): number {
  const index = statements.findIndex((statement) =>
    normalizedSql(statement.sql).startsWith(prefix)
  );
  if (index < 0) throw new Error(`Missing test statement: ${prefix}`);
  return index;
}

function replaceResultAt(results: unknown[], index: number, value: unknown): unknown[] {
  const replacement = [...results];
  replacement[index] = value;
  return replacement;
}

function mutateBatchResult(
  results: unknown[],
  index: number,
  mutate: (result: Record<string, unknown>) => unknown,
): unknown[] {
  return replaceResultAt(
    results,
    index,
    mutate({ ...(results[index] as Record<string, unknown>) }),
  );
}

function mutateReturnedRows(
  results: unknown[],
  index: number,
  mutate: (rows: unknown[]) => unknown,
): unknown[] {
  return mutateBatchResult(results, index, (result) => ({
    ...result,
    results: mutate([...(result.results as unknown[])]),
  }));
}

function assertMutationOnlySql(statements: CapturedD1Statement[]) {
  const sql = statements.map((statement) => normalizedSql(statement.sql)).join("\n");
  expect(sql).not.toMatch(/SearchDocument|SearchIndexMetadata/i);
}

type NativeResultMutation = (
  results: unknown[],
  statements: CapturedD1Statement[],
) => unknown;

interface NativeResultCase {
  label: string;
  mutate: NativeResultMutation;
}

const RESULT_TARGETS = [
  { label: "update", prefix: `UPDATE "Recipe"` },
  { label: "delete", prefix: `DELETE FROM "RecipeTag"` },
  { label: "insert", prefix: `INSERT INTO "RecipeTag"` },
] as const;

function targetCase(
  target: (typeof RESULT_TARGETS)[number],
  label: string,
  mutate: (result: Record<string, unknown>) => unknown,
): NativeResultCase {
  return {
    label: `${target.label} ${label}`,
    mutate(results, statements) {
      return mutateBatchResult(
        results,
        statementIndex(statements, target.prefix),
        mutate,
      );
    },
  };
}

function rowCase(
  target: (typeof RESULT_TARGETS)[number],
  label: string,
  mutate: (rows: unknown[]) => unknown,
): NativeResultCase {
  return {
    label: `${target.label} ${label}`,
    mutate(results, statements) {
      return mutateReturnedRows(
        results,
        statementIndex(statements, target.prefix),
        mutate,
      );
    },
  };
}

function patchFirstRow(rows: unknown[], patch: Record<string, unknown>): unknown[] {
  return [{ ...(rows[0] as Record<string, unknown>), ...patch }, ...rows.slice(1)];
}

const NATIVE_RESULT_CASES: NativeResultCase[] = [
  {
    label: "missing batch entry",
    mutate: (results) => results.slice(0, -1),
  },
  {
    label: "extra batch entry",
    mutate: (results) => [...results, nativeResult([])],
  },
  ...RESULT_TARGETS.flatMap((target) => [
    ...[null, [], "invalid"].map((value) => ({
      label: `${target.label} nonobject ${String(value)}`,
      mutate(results: unknown[], statements: CapturedD1Statement[]) {
        return replaceResultAt(results, statementIndex(statements, target.prefix), value);
      },
    })),
    targetCase(target, "missing success", (result) => {
      delete result.success;
      return result;
    }),
    ...[undefined, false, 1, "true", null].map((success) =>
      targetCase(target, `success ${String(success)}`, (result) => ({
        ...result,
        success,
      }))
    ),
    targetCase(target, "missing meta", (result) => {
      delete result.meta;
      return result;
    }),
    targetCase(target, "missing changes", (result) => ({ ...result, meta: {} })),
    ...[Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].map((changes) =>
      targetCase(target, `nonfinite changes ${String(changes)}`, (result) => ({
        ...result,
        meta: { changes },
      }))
    ),
    ...(
      target.label === "delete" ? [-1, 1.5, "1"] : [0, 2, -1, 1.5, "1"]
    ).map((changes) =>
      targetCase(target, `incorrect changes ${String(changes)}`, (result) => ({
        ...result,
        meta: { changes },
      }))
    ),
  ]),
  rowCase(RESULT_TARGETS[0], "nonarray rows", () => null),
  rowCase(RESULT_TARGETS[0], "empty rows", () => []),
  rowCase(RESULT_TARGETS[0], "extra rows", (rows) => [...rows, rows[0]]),
  rowCase(RESULT_TARGETS[0], "nonobject row", () => [null]),
  rowCase(RESULT_TARGETS[0], "malformed row", () => [{}]),
  rowCase(RESULT_TARGETS[0], "mismatched recipe ID", (rows) =>
    patchFirstRow(rows, { recipeId: "other_recipe" })),
  rowCase(RESULT_TARGETS[0], "mismatched course", (rows) =>
    patchFirstRow(rows, { course: "dessert" })),
  rowCase(RESULT_TARGETS[0], "mismatched timestamp", (rows) =>
    patchFirstRow(rows, { updatedAt: "2026-07-23T18:19:20.124Z" })),
  rowCase(RESULT_TARGETS[1], "unexpected returned row", () => [{ recipeId: "recipe_1" }]),
  rowCase(RESULT_TARGETS[2], "nonarray rows", () => null),
  rowCase(RESULT_TARGETS[2], "empty rows", () => []),
  rowCase(RESULT_TARGETS[2], "extra rows", (rows) => [...rows, rows[0]]),
  rowCase(RESULT_TARGETS[2], "nonobject row", () => [null]),
  rowCase(RESULT_TARGETS[2], "malformed row", () => [{}]),
  rowCase(RESULT_TARGETS[2], "mismatched recipe ID", (rows) =>
    patchFirstRow(rows, { recipeId: "other_recipe" })),
  rowCase(RESULT_TARGETS[2], "mismatched tag ID", (rows) =>
    patchFirstRow(rows, { tagId: "other_tag" })),
  rowCase(RESULT_TARGETS[2], "mismatched label", (rows) =>
    patchFirstRow(rows, { label: "Slow" })),
  rowCase(RESULT_TARGETS[2], "mismatched normalized label", (rows) =>
    patchFirstRow(rows, { normalizedLabel: "slow" })),
  rowCase(RESULT_TARGETS[2], "mismatched created timestamp", (rows) =>
    patchFirstRow(rows, { createdAt: "2026-07-23T18:19:20.124Z" })),
  rowCase(RESULT_TARGETS[2], "mismatched updated timestamp", (rows) =>
    patchFirstRow(rows, { updatedAt: "2026-07-23T18:19:20.124Z" })),
];

interface AuthoringRunOptions {
  tags?: string[];
  tagIds?: string[];
  cookbookReads?: Array<string[] | Error>;
  returnedCookbookIds?: string[];
  executorFailure?: Error;
  mutateResults?: (
    results: unknown[],
    statements: CapturedD1Statement[],
  ) => unknown;
}

function cookbookFindMany(reads: Array<string[] | Error> = [[]]) {
  const findMany = vi.fn();
  for (const read of reads) {
    if (read instanceof Error) {
      findMany.mockRejectedValueOnce(read);
    } else {
      findMany.mockResolvedValueOnce(read.map((cookbookId) => ({ cookbookId })));
    }
  }
  return findMany;
}

function authoringInput(
  database: PrismaClient,
  nativeDatabase: ReturnType<typeof captureNativeDatabase>["database"] | null,
  tags: string[],
) {
  return {
    database,
    nativeDatabase,
    userId: "owner_1",
    recipeId: "recipe_1",
    title: "Updated recipe",
    description: "Updated description",
    servings: "4",
    course: "side" as const,
    tags,
  };
}

function authoringUpdateRow(statement: CapturedD1Statement) {
  return {
    recipeId: statement.values[5],
    title: statement.values[0],
    description: statement.values[1],
    servings: statement.values[2],
    course: statement.values[3],
    updatedAt: statement.values[4],
  };
}

function authoringInsertRow(statement: CapturedD1Statement) {
  return {
    recipeId: statement.values[5],
    tagId: statement.values[0],
    label: statement.values[1],
    normalizedLabel: statement.values[2],
    createdAt: statement.values[3],
    updatedAt: statement.values[4],
  };
}

function authoringCookbookRows(
  statement: CapturedD1Statement,
  cookbookIds: string[],
) {
  return cookbookIds.map((cookbookId) => ({
    cookbookId,
    updatedAt: statement.values[0],
  }));
}

function successfulAuthoringNativeResults(
  statements: CapturedD1Statement[],
  cookbookIds: string[] = [],
) {
  return statements.map((statement) => {
    const sql = normalizedSql(statement.sql);
    if (sql.startsWith(`UPDATE "Recipe"`)) {
      return nativeResult([authoringUpdateRow(statement)], 1);
    }
    if (sql.startsWith(`DELETE FROM "RecipeTag"`)) return nativeResult([], 0);
    if (sql.startsWith(`INSERT INTO "RecipeTag"`)) {
      return nativeResult([authoringInsertRow(statement)], 1);
    }
    if (sql.startsWith(`SELECT "id" AS "recipeId" FROM "Recipe" WHERE 0`)) {
      return nativeResult([], 0);
    }
    if (sql.startsWith(`UPDATE "Cookbook"`)) {
      const rows = authoringCookbookRows(statement, cookbookIds);
      return nativeResult(rows, rows.length);
    }
    throw new Error(`Unexpected authoring statement: ${sql}`);
  });
}

function successfulAuthoringLocalResults(
  statements: CapturedD1Statement[],
  cookbookIds: string[] = [],
) {
  return statements.map((statement) => {
    const sql = normalizedSql(statement.sql);
    if (sql.startsWith(`UPDATE "Recipe"`)) return [authoringUpdateRow(statement)];
    if (sql.startsWith(`DELETE FROM "RecipeTag"`)) return 0;
    if (sql.startsWith(`INSERT INTO "RecipeTag"`)) return [authoringInsertRow(statement)];
    if (sql.startsWith(`SELECT "id" AS "recipeId" FROM "Recipe" WHERE 0`)) return [];
    if (sql.startsWith(`UPDATE "Cookbook"`)) {
      return authoringCookbookRows(statement, cookbookIds);
    }
    throw new Error(`Unexpected authoring statement: ${sql}`);
  });
}

function runNativeAuthoring(options: AuthoringRunOptions = {}) {
  const native = captureNativeDatabase();
  const findMany = cookbookFindMany(options.cookbookReads);
  const database = {
    recipeInCookbook: { findMany },
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  } as unknown as PrismaClient;
  native.batch.mockImplementation(async (statements: CapturedD1Statement[]) => {
    if (options.executorFailure) throw options.executorFailure;
    const results = successfulAuthoringNativeResults(
      statements,
      options.returnedCookbookIds,
    );
    return options.mutateResults
      ? options.mutateResults(results, statements)
      : results;
  });
  const ids = [...(options.tagIds ?? ["authoring_tag_1", "authoring_tag_2"])];
  const result = updateRecipeAuthoringMetadata(
    authoringInput(database, native.database, options.tags ?? ["Quick"]),
    {
      now: () => BOUND_NOW,
      randomId: () => ids.shift() ?? "unexpected_authoring_tag",
    },
  );
  return { ...native, database, findMany, result };
}

function runLocalAuthoring(options: AuthoringRunOptions = {}) {
  const statements: CapturedD1Statement[] = [];
  const capture = (sql: unknown, values: unknown[]) => {
    const statement: CapturedD1Statement = {
      sql: String(sql),
      values,
      bind: vi.fn() as never,
    };
    statements.push(statement);
    return statement;
  };
  const query = vi.fn((sql: unknown, ...values: unknown[]) => capture(sql, values));
  const execute = vi.fn((sql: unknown, ...values: unknown[]) => capture(sql, values));
  const findMany = cookbookFindMany(options.cookbookReads);
  const transaction = vi.fn(async () => {
    if (options.executorFailure) throw options.executorFailure;
    const results = successfulAuthoringLocalResults(
      statements,
      options.returnedCookbookIds,
    );
    return options.mutateResults
      ? options.mutateResults(results, statements)
      : results;
  });
  const database = {
    recipeInCookbook: { findMany },
    $queryRawUnsafe: query,
    $executeRawUnsafe: execute,
    $transaction: transaction,
  } as unknown as PrismaClient;
  const ids = [...(options.tagIds ?? ["authoring_tag_1", "authoring_tag_2"])];
  const result = updateRecipeAuthoringMetadata(
    authoringInput(database, null, options.tags ?? ["Quick"]),
    {
      now: () => BOUND_NOW,
      randomId: () => ids.shift() ?? "unexpected_authoring_tag",
    },
  );
  return { database, execute, findMany, query, result, statements, transaction };
}

describe("recipe-tags.server", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "RecipeTag_test_abort"');
    await cleanupDatabase();
  });

  describe("course validation", () => {
    it("accepts only the exact nullable course contract", () => {
      expect(RECIPE_COURSES).toEqual(["main", "side", "appetizer", "dessert"]);
      expect(normalizeRecipeCourse(null)).toBeNull();
      for (const course of RECIPE_COURSES) {
        expect(normalizeRecipeCourse(course)).toBe(course);
      }
    });

    it.each([
      undefined,
      "",
      "Main",
      " main",
      "main ",
      "breakfast",
      1,
      false,
      {},
      [],
    ])("rejects invalid course value %#", (course) => {
      try {
        normalizeRecipeCourse(course);
        throw new Error("expected validation failure");
      } catch (error) {
        expectValidation(error, "course");
      }
    });
  });

  describe("tag normalization", () => {
    it("applies NFKC first, then Unicode whitespace trim and collapse", () => {
      const normalize = vi.spyOn(String.prototype, "normalize");

      expect(normalizeRecipeTags(["\u1680ＦＯＯ\u1680bar\u1680"])).toEqual([{
        label: "FOO bar",
        normalizedLabel: "foo bar",
      }]);
      expect(normalize).toHaveBeenCalledTimes(1);
      expect(normalize).toHaveBeenCalledWith("NFKC");
    });

    it("rejects General Category C before whitespace handling", () => {
      for (const [label, value] of [
        ["tab", "quick\tmeal"],
        ["newline", "quick\nmeal"],
        ["null", "quick\u0000meal"],
        ["next-line", "quick\u0085meal"],
        ["format", "quick\u200emeal"],
        ["lone surrogate", "quick\ud800meal"],
      ] as const) {
        try {
          normalizeRecipeTags([value]);
          throw new Error(`expected ${label} validation failure`);
        } catch (error) {
          expectValidation(error, "tags.0");
        }
      }
    });

    it("rejects category C introduced by NFKC before touching whitespace", () => {
      vi.spyOn(String.prototype, "normalize").mockReturnValue("tag\u0000");

      try {
        normalizeRecipeTags(["tag"]);
        throw new Error("expected validation failure");
      } catch (error) {
        expectValidation(error, "tags.0");
      }
    });

    it("rejects empty labels after Unicode whitespace trimming", () => {
      for (const value of ["", " ", "\u00a0\u2003"]) {
        try {
          normalizeRecipeTags([value]);
          throw new Error("expected validation failure");
        } catch (error) {
          expectValidation(error, "tags.0");
        }
      }
    });

    it("counts display labels by Unicode code point through the 40-point boundary", () => {
      expect(normalizeRecipeTags(["😀".repeat(40)])).toEqual([{
        label: "😀".repeat(40),
        normalizedLabel: "😀".repeat(40),
      }]);

      try {
        normalizeRecipeTags(["😀".repeat(41)]);
        throw new Error("expected validation failure");
      } catch (error) {
        expectValidation(error, "tags.0");
      }
    });

    it("counts the NFKC-expanded display label rather than the raw input", () => {
      expect(normalizeRecipeTags(["ﬃ".repeat(13)])).toEqual([{
        label: "ffi".repeat(13),
        normalizedLabel: "ffi".repeat(13),
      }]);

      try {
        normalizeRecipeTags(["ﬃ".repeat(14)]);
        throw new Error("expected validation failure");
      } catch (error) {
        expectValidation(error, "tags.0");
      }
    });

    it("lowercases once without a second normalization pass or locale argument", () => {
      const normalize = vi.spyOn(String.prototype, "normalize");
      const toLowerCase = vi.spyOn(String.prototype, "toLowerCase");

      const result = normalizeRecipeTags(["İ"]);
      const lowercaseCalls = [...toLowerCase.mock.calls];
      toLowerCase.mockRestore();

      expect(result).toEqual([{
        label: "İ",
        normalizedLabel: "i\u0307",
      }]);
      expect(normalize).toHaveBeenCalledTimes(1);
      expect(normalize).toHaveBeenCalledWith("NFKC");
      expect(lowercaseCalls).toEqual([[]]);
    });

    it("deduplicates by normalized label while preserving the first spelling", () => {
      expect(normalizeRecipeTags([
        "  Home\u2003Style  ",
        "home style",
        "HOME STYLE",
        "① pan",
        "1 PAN",
        "Weeknight",
      ])).toEqual([
        { label: "Home Style", normalizedLabel: "home style" },
        { label: "1 pan", normalizedLabel: "1 pan" },
        { label: "Weeknight", normalizedLabel: "weeknight" },
      ]);
    });

    it("enforces at most ten unique tags after first-spelling deduplication", () => {
      const ten = Array.from({ length: 10 }, (_, index) => `Tag ${index}`);
      expect(normalizeRecipeTags([...ten, "Ｔａｇ ０"])).toHaveLength(10);

      try {
        normalizeRecipeTags([...ten, "Tag 10"]);
        throw new Error("expected validation failure");
      } catch (error) {
        expectValidation(error, "tags");
      }
    });

    it.each([
      null,
      undefined,
      "tag",
      {},
      [1],
      [null],
      [false],
    ])("rejects malformed tag collection %#", (tags) => {
      try {
        normalizeRecipeTags(tags);
        throw new Error("expected validation failure");
      } catch (error) {
        expectValidation(error, Array.isArray(tags) ? "tags.0" : "tags");
      }
    });

    it("accepts an empty tag collection", () => {
      expect(normalizeRecipeTags([])).toEqual([]);
    });
  });

  describe("authoring metadata form parsing", () => {
    it("parses the nullable course and normalized tag payload", () => {
      expect(parseRecipeAuthoringMetadataForm("side", JSON.stringify([
        " Quick ",
        "ＱＵＩＣＫ",
        "Weeknight",
      ]))).toEqual({
        course: "side",
        tags: ["Quick", "Weeknight"],
        errors: {},
      });
      expect(parseRecipeAuthoringMetadataForm(null, null)).toEqual({
        course: null,
        tags: [],
        errors: {},
      });
    });

    it("reports malformed JSON and an unsupported course independently", () => {
      expect(parseRecipeAuthoringMetadataForm("breakfast", "not-json")).toEqual({
        course: null,
        tags: [],
        errors: {
          course: "Choose a supported course",
          tags: "Tags must be valid JSON",
        },
      });
    });

    it.each([
      ["non-array JSON", JSON.stringify({ tag: "Quick" }), "Tags must be an array"],
      ["non-string member", JSON.stringify([1]), "Tags must contain only text"],
      ["control character", JSON.stringify(["bad\ttag"]), "Tags contain unsupported characters"],
      ["empty tag", JSON.stringify(["\u2003"]), "Tags cannot be empty"],
      ["overlong tag", JSON.stringify(["x".repeat(41)]), "Tags must be 40 characters or fewer"],
      [
        "too many unique tags",
        JSON.stringify(Array.from({ length: 11 }, (_, index) => `Tag ${index}`)),
        "Add no more than 10 tags",
      ],
    ])("maps the %s validation error to its field message", (_, payload, message) => {
      expect(parseRecipeAuthoringMetadataForm(null, payload)).toEqual({
        course: null,
        tags: [],
        errors: { tags: message },
      });
    });

    it("uses the generic tag message for an unmapped validation failure", () => {
      vi.spyOn(String.prototype, "normalize").mockImplementation(() => {
        throw new RecipeTagValidationError("tags.0", "unmapped tag failure");
      });

      expect(parseRecipeAuthoringMetadataForm(null, JSON.stringify(["Quick"]))).toEqual({
        course: null,
        tags: [],
        errors: { tags: "Tags are invalid" },
      });
    });

    it("rethrows unexpected course and tag normalization failures", () => {
      const courseFailure = new Error("course normalization failed");
      const courseIncludes = vi.spyOn(
        RECIPE_COURSES as unknown as { includes(value: string): boolean },
        "includes",
      ).mockImplementation(() => {
        throw courseFailure;
      });
      expect(() => parseRecipeAuthoringMetadataForm("side", null)).toThrow(courseFailure);
      courseIncludes.mockRestore();

      const tagFailure = new Error("tag normalization failed");
      vi.spyOn(String.prototype, "normalize").mockImplementation(() => {
        throw tagFailure;
      });
      expect(() => parseRecipeAuthoringMetadataForm(
        null,
        JSON.stringify(["Quick"]),
      )).toThrow(tagFailure);
    });
  });

  describe("active recipe reads", () => {
    it("returns course and tags in JavaScript UTF-16 normalized-label order", async () => {
      const owner = await createUser("tag_read_owner");
      const recipe = await createRecipe({ chefId: owner.id, course: "main" });
      await createTag({ id: "alpha", recipeId: recipe.id, label: "Alpha", normalizedLabel: "alpha" });
      await createTag({ id: "replacement", recipeId: recipe.id, label: "Replacement", normalizedLabel: "\ufffd" });
      await createTag({ id: "emoji", recipeId: recipe.id, label: "Emoji", normalizedLabel: "😀" });

      await expect(getRecipeTagMetadata(db, { recipeId: recipe.id })).resolves.toEqual({
        recipeId: recipe.id,
        course: "main",
        tags: [
          { id: "alpha", label: "Alpha", normalizedLabel: "alpha" },
          { id: "emoji", label: "Emoji", normalizedLabel: "😀" },
          { id: "replacement", label: "Replacement", normalizedLabel: "\ufffd" },
        ],
      });
    });

    it("uses a public active-recipe query without an owner predicate", async () => {
      const query = vi.fn().mockResolvedValue([{
        recipeId: "recipe_1",
        course: "side",
        tagId: "tag_1",
        label: "Quick",
        normalizedLabel: "quick",
      }]);
      const database = { $queryRawUnsafe: query } as unknown as PrismaClient;

      await expect(getRecipeTagMetadata(database, { recipeId: "recipe_1" })).resolves.toEqual({
        recipeId: "recipe_1",
        course: "side",
        tags: [{ id: "tag_1", label: "Quick", normalizedLabel: "quick" }],
      });

      expect(query).toHaveBeenCalledOnce();
      const [sql, ...values] = query.mock.calls[0]!;
      expect(normalizedSql(sql)).toContain(
        `FROM "Recipe" AS recipe LEFT JOIN "RecipeTag" AS tag ON tag."recipeId" = recipe."id" ` +
        `WHERE recipe."id" = ? AND recipe."deletedAt" IS NULL`,
      );
      expect(normalizedSql(sql)).not.toContain(`recipe."chefId"`);
      expect(values).toEqual(["recipe_1"]);
    });

    it("returns an empty tag list without confusing it with an absent recipe", async () => {
      const owner = await createUser("tag_empty_owner");
      const recipe = await createRecipe({ chefId: owner.id, course: null });

      await expect(getRecipeTagMetadata(db, { recipeId: recipe.id }))
        .resolves.toEqual({ recipeId: recipe.id, course: null, tags: [] });
    });

    it("uses one not-found error for deleted and missing recipes", async () => {
      const owner = await createUser("tag_private_owner");
      const deleted = await createRecipe({ chefId: owner.id, deletedAt: new Date() });

      for (const recipeId of [deleted.id, "missing_recipe"]) {
        await expect(getRecipeTagMetadata(db, { recipeId })).rejects.toMatchObject({
          name: "RecipeTagNotFoundError",
          recipeId,
        });
      }
    });

    it.each([
      { label: "nonarray result", rows: null },
      {
        label: "nonstring recipe ID",
        rows: [{ recipeId: 1, course: null, tagId: null, label: null, normalizedLabel: null }],
      },
      {
        label: "mismatched recipe ID",
        rows: [{ recipeId: "other", course: null, tagId: null, label: null, normalizedLabel: null }],
      },
      {
        label: "invalid course",
        rows: [{ recipeId: "recipe_1", course: "breakfast", tagId: null, label: null, normalizedLabel: null }],
      },
      {
        label: "mixed recipe IDs",
        rows: [
          { recipeId: "recipe_1", course: null, tagId: "tag_1", label: "One", normalizedLabel: "one" },
          { recipeId: "other", course: null, tagId: "tag_2", label: "Two", normalizedLabel: "two" },
        ],
      },
      {
        label: "mixed courses",
        rows: [
          { recipeId: "recipe_1", course: null, tagId: "tag_1", label: "One", normalizedLabel: "one" },
          { recipeId: "recipe_1", course: "side", tagId: "tag_2", label: "Two", normalizedLabel: "two" },
        ],
      },
      {
        label: "label without tag ID",
        rows: [{ recipeId: "recipe_1", course: null, tagId: null, label: "One", normalizedLabel: null }],
      },
      {
        label: "normalized label without tag ID",
        rows: [{ recipeId: "recipe_1", course: null, tagId: null, label: null, normalizedLabel: "one" }],
      },
      {
        label: "nonstring tag ID",
        rows: [{ recipeId: "recipe_1", course: null, tagId: 1, label: "One", normalizedLabel: "one" }],
      },
      {
        label: "nonstring label",
        rows: [{ recipeId: "recipe_1", course: null, tagId: "tag_1", label: 1, normalizedLabel: "one" }],
      },
      {
        label: "nonstring normalized label",
        rows: [{ recipeId: "recipe_1", course: null, tagId: "tag_1", label: "One", normalizedLabel: 1 }],
      },
    ])("rejects malformed $label read envelopes", async ({ rows }) => {
      const database = {
        $queryRawUnsafe: vi.fn().mockResolvedValue(rows),
      } as unknown as PrismaClient;

      await expect(getRecipeTagMetadata(database, { recipeId: "recipe_1" }))
        .rejects.toThrow();
    });

    it("uses tag IDs as the deterministic fallback for equal normalized labels", async () => {
      const query = vi.fn().mockResolvedValue([
        { recipeId: "recipe_1", course: null, tagId: "z", label: "Z", normalizedLabel: "same" },
        { recipeId: "recipe_1", course: null, tagId: "a", label: "A", normalizedLabel: "same" },
        { recipeId: "recipe_1", course: null, tagId: "a", label: "A", normalizedLabel: "same" },
      ]);
      const database = { $queryRawUnsafe: query } as unknown as PrismaClient;

      await expect(getRecipeTagMetadata(database, { recipeId: "recipe_1" }))
        .resolves.toMatchObject({
          tags: [{ id: "a" }, { id: "a" }, { id: "z" }],
        });
    });
  });

  describe("owner-authorized atomic replacement", () => {
    it("normalizes, replaces, and reads back one canonical metadata state", async () => {
      const owner = await createUser("tag_replace_owner");
      const recipe = await createRecipe({ chefId: owner.id, course: "main" });
      await createTag({ recipeId: recipe.id, label: "Old", normalizedLabel: "old" });

      const result = await replaceLocally(db, {
        userId: owner.id,
        recipeId: recipe.id,
        course: "side",
        tags: [" Weeknight ", "ＱＵＩＣＫ", "weeknight"],
      });

      expect(result).toMatchObject({
        recipeId: recipe.id,
        course: "side",
        tags: [
          { label: "QUICK", normalizedLabel: "quick" },
          { label: "Weeknight", normalizedLabel: "weeknight" },
        ],
      });
      expect(result.tags.every((tag) => typeof tag.id === "string" && tag.id.length > 0)).toBe(true);
      await expect(db.recipe.findUniqueOrThrow({ where: { id: recipe.id } }))
        .resolves.toMatchObject({ course: "side" });
      await expect(db.recipeTag.findMany({ where: { recipeId: recipe.id } }))
        .resolves.toHaveLength(2);
    });

    it("atomically clears tags and resets course to null", async () => {
      const owner = await createUser("tag_clear_owner");
      const recipe = await createRecipe({ chefId: owner.id, course: "dessert" });
      await createTag({ recipeId: recipe.id, label: "Sweet", normalizedLabel: "sweet" });

      await expect(replaceLocally(db, {
        userId: owner.id,
        recipeId: recipe.id,
        course: null,
        tags: [],
      })).resolves.toEqual({ recipeId: recipe.id, course: null, tags: [] });
      await expect(db.recipeTag.count({ where: { recipeId: recipe.id } })).resolves.toBe(0);
    });

    it("does not alter foreign, deleted, or missing recipes", async () => {
      const owner = await createUser("tag_write_owner");
      const other = await createUser("tag_write_other");
      const foreign = await createRecipe({ chefId: other.id, course: "main" });
      const deleted = await createRecipe({
        chefId: owner.id,
        course: "appetizer",
        deletedAt: new Date(),
      });
      await createTag({ recipeId: foreign.id, label: "Foreign", normalizedLabel: "foreign" });
      await createTag({ recipeId: deleted.id, label: "Deleted", normalizedLabel: "deleted" });

      for (const recipeId of [foreign.id, deleted.id, "missing_recipe"]) {
        await expect(replaceLocally(db, {
          userId: owner.id,
          recipeId,
          course: "side",
          tags: ["Changed"],
        })).rejects.toBeInstanceOf(RecipeTagNotFoundError);
      }

      await expect(db.recipe.findUniqueOrThrow({ where: { id: foreign.id } }))
        .resolves.toMatchObject({ course: "main" });
      await expect(db.recipe.findUniqueOrThrow({ where: { id: deleted.id } }))
        .resolves.toMatchObject({ course: "appetizer" });
      await expect(db.recipeTag.findMany({ orderBy: { normalizedLabel: "asc" } }))
        .resolves.toMatchObject([
          { recipeId: deleted.id, normalizedLabel: "deleted" },
          { recipeId: foreign.id, normalizedLabel: "foreign" },
        ]);
    });

    it("rolls back course, deletion, and inserts when any replacement operation fails", async () => {
      const owner = await createUser("tag_rollback_owner");
      const recipe = await createRecipe({ chefId: owner.id, course: "main" });
      const original = await createTag({
        recipeId: recipe.id,
        label: "Original",
        normalizedLabel: "original",
      });
      await db.$executeRawUnsafe(`
        CREATE TRIGGER "RecipeTag_test_abort"
        BEFORE INSERT ON "RecipeTag"
        WHEN NEW."normalizedLabel" = 'explode'
        BEGIN
          SELECT RAISE(ABORT, 'tag replacement failure');
        END
      `);

      await expect(replaceLocally(db, {
        userId: owner.id,
        recipeId: recipe.id,
        course: "side",
        tags: ["Explode"],
      })).rejects.toThrow();

      await expect(db.recipe.findUniqueOrThrow({ where: { id: recipe.id } }))
        .resolves.toMatchObject({ course: "main" });
      await expect(db.recipeTag.findMany({ where: { recipeId: recipe.id } }))
        .resolves.toEqual([original]);
    });

    it("recognizes only callable native D1 bindings", () => {
      expect(asCompatibleRecipeTagD1Database(null)).toBeNull();
      expect(asCompatibleRecipeTagD1Database({ prepare() {} })).toBeNull();
      expect(asCompatibleRecipeTagD1Database({ batch() {} })).toBeNull();
      const binding = { prepare() {}, batch() {} };
      expect(asCompatibleRecipeTagD1Database(binding)).toBe(binding);
    });

    it("prepares the exact deduplicated native D1 inventory with one bound timestamp", async () => {
      const native = captureNativeDatabase();
      const localDatabase = {
        $queryRawUnsafe: vi.fn(),
        $executeRawUnsafe: vi.fn(),
        $transaction: vi.fn(),
      } as unknown as PrismaClient;

      const prepared = prepareRecipeTagMetadataReplacement({
        database: localDatabase,
        nativeDatabase: native.database,
        userId: "owner_1",
        recipeId: "recipe_1",
        course: "side",
        tags: [" Quick ", "ＱＵＩＣＫ", "Weeknight"],
      }, {
        now: () => BOUND_NOW,
        randomId: (() => {
          const ids = ["tag_1", "tag_2"];
          return () => ids.shift() ?? "unexpected_duplicate_operation";
        })(),
      });

      expect(prepared.strategy).toBe("native-d1");
      expect(prepared.boundTimestamp).toBe(BOUND_NOW_TEXT);
      expect(prepared.operations).toEqual(native.statements);
      expect(prepared.operations).toHaveLength(4);
      expect(new Set(prepared.operations).size).toBe(4);
      expect(native.batch).not.toHaveBeenCalled();
      expect(localDatabase.$queryRawUnsafe).not.toHaveBeenCalled();
      expect(localDatabase.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(localDatabase.$transaction).not.toHaveBeenCalled();

      const update = native.statements.find((statement) =>
        normalizedSql(statement.sql).startsWith(`UPDATE "Recipe"`)
      );
      const deletion = native.statements.find((statement) =>
        normalizedSql(statement.sql).startsWith(`DELETE FROM "RecipeTag"`)
      );
      const insertion = native.statements.find((statement) =>
        normalizedSql(statement.sql).startsWith(`INSERT INTO "RecipeTag"`)
      );
      const insertions = native.statements.filter((statement) =>
        normalizedSql(statement.sql).startsWith(`INSERT INTO "RecipeTag"`)
      );
      expect(native.statements.filter((statement) =>
        normalizedSql(statement.sql).startsWith(`UPDATE "Recipe"`)
      )).toHaveLength(1);
      expect(native.statements.filter((statement) =>
        normalizedSql(statement.sql).startsWith(`DELETE FROM "RecipeTag"`)
      )).toHaveLength(1);
      expect(insertions).toHaveLength(2);
      expect(normalizedSql(update?.sql)).toContain(
        `UPDATE "Recipe" SET "course" = ?, "updatedAt" = ? ` +
        `WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL ` +
        `RETURNING "id" AS "recipeId", "course", "updatedAt"`,
      );
      expect(update?.values).toEqual([
        "side",
        BOUND_NOW_TEXT,
        "recipe_1",
        "owner_1",
      ]);
      expect(normalizedSql(deletion?.sql)).toContain(
        `DELETE FROM "RecipeTag" WHERE "recipeId" = ? AND EXISTS (` +
        `SELECT 1 FROM "Recipe" WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL)`,
      );
      expect(deletion?.values).toEqual(["recipe_1", "recipe_1", "owner_1"]);
      expect(normalizedSql(insertion?.sql)).toContain(
        `INSERT INTO "RecipeTag" (` +
        `"id", "recipeId", "label", "normalizedLabel", "createdAt", "updatedAt"` +
        `) SELECT ?, "id", ?, ?, ?, ? FROM "Recipe" ` +
        `WHERE "id" = ? AND "chefId" = ? ` +
        `AND "deletedAt" IS NULL`,
      );
      expect(insertions.map((statement) => statement.values)).toEqual([
        [
          "tag_1",
          "Quick",
          "quick",
          BOUND_NOW_TEXT,
          BOUND_NOW_TEXT,
          "recipe_1",
          "owner_1",
        ],
        [
          "tag_2",
          "Weeknight",
          "weeknight",
          BOUND_NOW_TEXT,
          BOUND_NOW_TEXT,
          "recipe_1",
          "owner_1",
        ],
      ]);
      expect(native.statements.every((statement) => (
        normalizedSql(statement.sql).includes(`"chefId" = ?`)
        && normalizedSql(statement.sql).includes(`"deletedAt" IS NULL`)
        && statement.values.includes("recipe_1")
        && statement.values.includes("owner_1")
      ))).toBe(true);
      assertMutationOnlySql(native.statements);

      const authoringUpdate = {
        boundTimestamp: prepared.boundTimestamp,
        kind: "authoring-update",
      };
      const nativeSyncUpdate = {
        boundTimestamp: prepared.boundTimestamp,
        kind: "native-sync-update",
      };
      await native.database.batch([
        authoringUpdate as never,
        ...prepared.operations,
        nativeSyncUpdate as never,
      ]);
      expect(native.batch).toHaveBeenCalledWith([
        authoringUpdate,
        ...native.statements,
        nativeSyncUpdate,
      ]);
      expect(authoringUpdate.boundTimestamp).toBe(BOUND_NOW_TEXT);
      expect(nativeSyncUpdate.boundTimestamp).toBe(BOUND_NOW_TEXT);
      expect(prepared.finalizeResults([
        nativeResult([{ kind: "authoring-update" }]),
        ...successfulNativeResults(native.statements),
        nativeResult([{ kind: "native-sync-update" }]),
      ], 1)).toEqual({
        recipeId: "recipe_1",
        course: "side",
        tags: [
          { id: "tag_1", label: "Quick", normalizedLabel: "quick" },
          { id: "tag_2", label: "Weeknight", normalizedLabel: "weeknight" },
        ],
      });
    });

    it("prepares the same exact timestamped inventory as composable local Prisma operations", async () => {
      const localOperations: Array<Promise<unknown>> = [];
      const statements: CapturedD1Statement[] = [];
      const captureOperation = (sql: unknown, values: unknown[], result: unknown) => {
        statements.push({
          sql: String(sql),
          values,
          bind: vi.fn() as never,
        });
        const operation = Promise.resolve(result);
        localOperations.push(operation);
        return operation;
      };
      const query = vi.fn((sql: unknown, ...values: unknown[]) =>
        captureOperation(sql, values, []));
      const execute = vi.fn((sql: unknown, ...values: unknown[]) =>
        captureOperation(sql, values, 0));
      const transaction = vi.fn(async (operations: Array<Promise<unknown>>) =>
        Promise.all(operations)
      );
      const database = {
        $queryRawUnsafe: query,
        $executeRawUnsafe: execute,
        $transaction: transaction,
      } as unknown as PrismaClient;

      const prepared = prepareRecipeTagMetadataReplacement({
        database,
        nativeDatabase: null,
        userId: "owner_1",
        recipeId: "recipe_1",
        course: "side",
        tags: [" Quick ", "ＱＵＩＣＫ", "Weeknight"],
      }, {
        now: () => BOUND_NOW,
        randomId: (() => {
          const ids = ["tag_1", "tag_2"];
          return () => ids.shift() ?? "unexpected_duplicate_operation";
        })(),
      });

      expect(prepared.strategy).toBe("prisma-local");
      expect(prepared.boundTimestamp).toBe(BOUND_NOW_TEXT);
      expect(prepared.operations).toEqual(localOperations);
      expect(prepared.operations).toHaveLength(4);
      expect(new Set(prepared.operations).size).toBe(4);
      expect(transaction).not.toHaveBeenCalled();
      const calls = [...query.mock.calls, ...execute.mock.calls];
      expect(calls).toHaveLength(4);
      expect(calls.every(([sql, ...values]) => (
        normalizedSql(sql).includes(`"chefId" = ?`)
        && normalizedSql(sql).includes(`"deletedAt" IS NULL`)
        && values.includes("recipe_1")
        && values.includes("owner_1")
      ))).toBe(true);
      expect(statements.filter((statement) =>
        normalizedSql(statement.sql).startsWith(`UPDATE "Recipe"`)
      )).toHaveLength(1);
      expect(statements.filter((statement) =>
        normalizedSql(statement.sql).startsWith(`DELETE FROM "RecipeTag"`)
      )).toHaveLength(1);
      expect(statements.filter((statement) =>
        normalizedSql(statement.sql).startsWith(`INSERT INTO "RecipeTag"`)
      )).toHaveLength(2);
      expect(statements.filter((statement) =>
        /UPDATE "Recipe"|INSERT INTO "RecipeTag"/.test(normalizedSql(statement.sql))
      ).every((statement) => (
        statement.values.filter((value) => value === BOUND_NOW_TEXT).length
          === (normalizedSql(statement.sql).startsWith(`UPDATE "Recipe"`) ? 1 : 2)
      ))).toBe(true);
      assertMutationOnlySql(statements);

      const authoringUpdate = Promise.resolve({
        boundTimestamp: prepared.boundTimestamp,
        kind: "authoring-update",
      });
      const nativeSyncUpdate = Promise.resolve({
        boundTimestamp: prepared.boundTimestamp,
        kind: "native-sync-update",
      });
      await database.$transaction([
        authoringUpdate as never,
        ...prepared.operations,
        nativeSyncUpdate as never,
      ]);
      expect(transaction).toHaveBeenCalledWith([
        authoringUpdate,
        ...localOperations,
        nativeSyncUpdate,
      ]);
      await expect(authoringUpdate).resolves.toMatchObject({ boundTimestamp: BOUND_NOW_TEXT });
      await expect(nativeSyncUpdate).resolves.toMatchObject({ boundTimestamp: BOUND_NOW_TEXT });
      expect(prepared.finalizeResults([
        { kind: "authoring-update" },
        ...successfulLocalResults(statements),
        { kind: "native-sync-update" },
      ], 1)).toEqual({
        recipeId: "recipe_1",
        course: "side",
        tags: [
          { id: "tag_1", label: "Quick", normalizedLabel: "quick" },
          { id: "tag_2", label: "Weeknight", normalizedLabel: "weeknight" },
        ],
      });
    });

    it("uses one native D1 batch in production and validates its returned rows", async () => {
      const native = captureNativeDatabase();
      native.batch.mockImplementation(async (statements: CapturedD1Statement[]) =>
        successfulNativeResults(statements)
      );
      const transaction = vi.fn();
      const query = vi.fn();
      const database = {
        $queryRawUnsafe: query,
        $executeRawUnsafe: vi.fn(),
        $transaction: transaction,
      } as unknown as PrismaClient;

      await expect(replaceRecipeTagMetadata({
        database,
        nativeDatabase: native.database,
        userId: "owner_1",
        recipeId: "recipe_1",
        course: "side",
        tags: ["Quick"],
      }, {
        now: () => BOUND_NOW,
        randomId: () => "tag_1",
      })).resolves.toEqual({
        recipeId: "recipe_1",
        course: "side",
        tags: [{ id: "tag_1", label: "Quick", normalizedLabel: "quick" }],
      });

      expect(native.batch).toHaveBeenCalledOnce();
      expect(native.batch).toHaveBeenCalledWith(native.statements);
      expect(transaction).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    });

    it.each(NATIVE_RESULT_CASES)(
      "rejects native $label without Prisma fallback or read-through",
      async ({ mutate }) => {
        const native = captureNativeDatabase();
        native.batch.mockImplementation(async (statements: CapturedD1Statement[]) =>
          mutate(successfulNativeResults(statements), statements)
        );
        const query = vi.fn();
        const execute = vi.fn();
        const transaction = vi.fn();
        const database = {
          $queryRawUnsafe: query,
          $executeRawUnsafe: execute,
          $transaction: transaction,
        } as unknown as PrismaClient;

        await expect(replaceRecipeTagMetadata({
          database,
          nativeDatabase: native.database,
          userId: "owner_1",
          recipeId: "recipe_1",
          course: "side",
          tags: ["Quick"],
        }, {
          now: () => BOUND_NOW,
          randomId: () => "tag_1",
        })).rejects.toThrow();

        expect(native.batch).toHaveBeenCalledOnce();
        expect(query).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
      },
    );

    it("does not fall back or retry when native D1 rejects or reports a failed statement", async () => {
      const failure = new Error("native batch failed and rolled back");
      const rejected = captureNativeDatabase();
      rejected.batch.mockRejectedValue(failure);
      const transaction = vi.fn();
      const database = {
        $queryRawUnsafe: vi.fn(),
        $executeRawUnsafe: vi.fn(),
        $transaction: transaction,
      } as unknown as PrismaClient;
      const input = {
        database,
        nativeDatabase: rejected.database,
        userId: "owner_1",
        recipeId: "recipe_1",
        course: null,
        tags: [],
      } as const;

      await expect(replaceRecipeTagMetadata(input)).rejects.toBe(failure);
      expect(rejected.batch).toHaveBeenCalledOnce();
      expect(transaction).not.toHaveBeenCalled();

      const unsuccessful = captureNativeDatabase();
      unsuccessful.batch.mockImplementation(async (statements: unknown[]) =>
        statements.map((_, index) => index === 0
          ? { success: false, results: [], meta: { changes: 0 } }
          : nativeResult([]))
      );
      await expect(replaceRecipeTagMetadata({
        ...input,
        nativeDatabase: unsuccessful.database,
      })).rejects.toThrow();
      expect(unsuccessful.batch).toHaveBeenCalledOnce();
      expect(transaction).not.toHaveBeenCalled();
    });

    it("treats a zero-row native owner guard as not found without a second write", async () => {
      const native = captureNativeDatabase();
      native.batch.mockImplementation(async (statements: CapturedD1Statement[]) =>
        statements.map(() => nativeResult([], 0))
      );
      const database = {
        $queryRawUnsafe: vi.fn(),
        $executeRawUnsafe: vi.fn(),
        $transaction: vi.fn(),
      } as unknown as PrismaClient;

      await expect(replaceRecipeTagMetadata({
        database,
        nativeDatabase: native.database,
        userId: "owner_1",
        recipeId: "recipe_1",
        course: "side",
        tags: ["Quick"],
      }, { randomId: () => "tag_1" })).rejects.toBeInstanceOf(RecipeTagNotFoundError);
      expect(native.batch).toHaveBeenCalledOnce();
      expect(database.$transaction).not.toHaveBeenCalled();
    });

    it("validates every no-op result before classifying native or local replacement as not found", async () => {
      const native = captureNativeDatabase();
      native.batch.mockImplementation(async (statements: CapturedD1Statement[]) =>
        statements.map((_, index) => nativeResult([], index === 1 ? 1 : 0))
      );
      const nativeDatabase = {
        $queryRawUnsafe: vi.fn(),
        $executeRawUnsafe: vi.fn(),
        $transaction: vi.fn(),
      } as unknown as PrismaClient;

      const nativeFailure = await replaceRecipeTagMetadata({
        database: nativeDatabase,
        nativeDatabase: native.database,
        userId: "owner_1",
        recipeId: "recipe_1",
        course: "side",
        tags: ["Quick"],
      }, { randomId: () => "tag_1" }).catch((error: unknown) => error);
      expect(nativeFailure).toBeInstanceOf(Error);
      expect(nativeFailure).not.toBeInstanceOf(RecipeTagNotFoundError);

      const localDatabase = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([]),
        $executeRawUnsafe: vi.fn().mockResolvedValue(1),
        $transaction: vi.fn(async (operations: Array<Promise<unknown>>) =>
          Promise.all(operations)),
      } as unknown as PrismaClient;
      const localFailure = await replaceLocally(localDatabase, {
        userId: "owner_1",
        recipeId: "recipe_1",
        course: "side",
        tags: ["Quick"],
      }, { randomId: () => "tag_1" }).catch((error: unknown) => error);
      expect(localFailure).toBeInstanceOf(Error);
      expect(localFailure).not.toBeInstanceOf(RecipeTagNotFoundError);
    });

    it("exposes only complete old or replacement states across concurrent native batches", async () => {
      type StoredTag = { id: string; label: string; normalizedLabel: string };
      const state: { course: MetadataSnapshot["course"]; tags: StoredTag[] } = {
        course: null,
        tags: [{ id: "old", label: "Old", normalizedLabel: "old" }],
      };
      const observed: MetadataSnapshot[] = [snapshot(state)];
      const arrive = twoPartyBarrier();
      let serial = Promise.resolve();
      const nativeDatabase = {
        prepare(sql: string) {
          const statement: CapturedD1Statement = {
            sql,
            values: [],
            bind(...values: unknown[]) {
              statement.values = values;
              return statement;
            },
          };
          return statement;
        },
        batch: vi.fn(async (statements: CapturedD1Statement[]) => {
          await arrive();
          const previous = serial;
          let unlock!: () => void;
          serial = new Promise<void>((resolve) => {
            unlock = resolve;
          });
          await previous;
          try {
            observed.push(snapshot(state));
            const update = statements.find((statement) =>
              normalizedSql(statement.sql).startsWith(`UPDATE "Recipe"`)
            );
            const insertions = statements.filter((statement) =>
              normalizedSql(statement.sql).startsWith(`INSERT INTO "RecipeTag"`)
            );
            state.course = update?.values[0] as MetadataSnapshot["course"];
            state.tags = insertions.map((statement) => ({
              id: String(statement.values[0]),
              label: String(statement.values[1]),
              normalizedLabel: String(statement.values[2]),
            }));
            observed.push(snapshot(state));

            return successfulNativeResults(statements);
          } finally {
            unlock();
          }
        }),
      };
      const query = vi.fn(async () => state.tags.map((tag) => ({
        recipeId: "recipe_1",
        course: state.course,
        tagId: tag.id,
        label: tag.label,
        normalizedLabel: tag.normalizedLabel,
      })));
      const database = { $queryRawUnsafe: query } as unknown as PrismaClient;
      let id = 0;
      const replacement = (course: "main" | "dessert", tags: string[]) =>
        replaceRecipeTagMetadata({
          database,
          nativeDatabase,
          userId: "owner_1",
          recipeId: "recipe_1",
          course,
          tags,
        }, { randomId: () => `tag_${id += 1}` });

      const outcomes = await Promise.allSettled([
        replacement("main", ["Alpha", "Shared A"]),
        replacement("dessert", ["Beta", "Shared B", "Sweet"]),
      ]);
      const successful = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
      expect(successful.length).toBeGreaterThanOrEqual(1);
      expect(rejected).toHaveLength(outcomes.length - successful.length);
      expect(rejected.every((outcome) => isDefinedConcurrentWriteConflict(outcome.reason)))
        .toBe(true);

      const finalState = await getRecipeTagMetadata(database, { recipeId: "recipe_1" });
      const visibleStates = [
        ...observed,
        ...successful.map((outcome) => snapshot(outcome.value)),
        snapshot(finalState),
      ];
      const completeStates: MetadataSnapshot[] = [
        { course: null, labels: ["old"] },
        { course: "main", labels: ["alpha", "shared a"] },
        { course: "dessert", labels: ["beta", "shared b", "sweet"] },
      ];
      for (const visible of visibleStates) {
        expect(completeStates).toContainEqual(visible);
      }
      expect(arrive).toHaveBeenCalledTimes(2);
    });

    it("validates all input before preparing or executing either atomic strategy", async () => {
      const native = captureNativeDatabase();
      const database = {
        $queryRawUnsafe: vi.fn(),
        $executeRawUnsafe: vi.fn(),
        $transaction: vi.fn(),
      } as unknown as PrismaClient;

      await expect(replaceRecipeTagMetadata({
        database,
        nativeDatabase: native.database,
        userId: "owner_1",
        recipeId: "recipe_1",
        course: "breakfast" as never,
        tags: ["Quick"],
      })).rejects.toBeInstanceOf(RecipeTagValidationError);
      await expect(replaceRecipeTagMetadata({
        database,
        nativeDatabase: native.database,
        userId: "owner_1",
        recipeId: "recipe_1",
        course: "main",
        tags: ["bad\ttag"],
      })).rejects.toBeInstanceOf(RecipeTagValidationError);

      expect(native.database.prepare).not.toHaveBeenCalled();
      expect(native.batch).not.toHaveBeenCalled();
      expect(database.$queryRawUnsafe).not.toHaveBeenCalled();
      expect(database.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(database.$transaction).not.toHaveBeenCalled();
    });

    it("propagates local transaction failures without retrying outside the batch", async () => {
      const failure = new Error("transaction failed");
      const database = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([]),
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        $transaction: vi.fn().mockRejectedValue(failure),
      } as unknown as PrismaClient;

      await expect(replaceLocally(database, {
        userId: "owner_1",
        recipeId: "recipe_1",
        course: null,
        tags: [],
      })).rejects.toBe(failure);
      expect(database.$transaction).toHaveBeenCalledOnce();
    });

    it("rejects every malformed local result and composition offset boundary", () => {
      const database = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([]),
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        $transaction: vi.fn(),
      } as unknown as PrismaClient;
      const prepared = prepareRecipeTagMetadataReplacement({
        database,
        nativeDatabase: null,
        userId: "owner_1",
        recipeId: "recipe_1",
        course: "side",
        tags: ["Quick"],
      }, {
        now: () => BOUND_NOW,
        randomId: () => "tag_1",
      });
      expect(prepared.strategy).toBe("prisma-local");
      if (prepared.strategy !== "prisma-local") throw new Error("expected local plan");

      const updateRow = {
        recipeId: "recipe_1",
        course: "side",
        updatedAt: BOUND_NOW_TEXT,
      };
      const insertRow = {
        recipeId: "recipe_1",
        tagId: "tag_1",
        label: "Quick",
        normalizedLabel: "quick",
        createdAt: BOUND_NOW_TEXT,
        updatedAt: BOUND_NOW_TEXT,
      };
      const valid = [[updateRow], 0, [insertRow]];

      for (const results of [null, {}, "invalid"]) {
        expect(() => prepared.finalizeResults(results)).toThrow();
      }
      for (const offset of [1.5, -1, 1]) {
        expect(() => prepared.finalizeResults(valid, offset)).toThrow();
      }
      for (const deleted of [null, -1, 1.5]) {
        expect(() => prepared.finalizeResults([[updateRow], deleted, [insertRow]]))
          .toThrow();
      }
      expect(() => prepared.finalizeResults([[updateRow, updateRow], 0, [insertRow]]))
        .toThrow();
      expect(() => prepared.finalizeResults([[updateRow], 0, []])).toThrow();
    });
  });

  describe("atomic authoring updates", () => {
    it("sends one exact native D1 authoring batch and validates its complete result", async () => {
      const run = runNativeAuthoring({
        tags: ["Zulu", "Alpha"],
        tagIds: ["tag_z", "tag_a"],
        cookbookReads: [["cookbook_a"]],
        returnedCookbookIds: ["cookbook_a"],
      });

      await expect(run.result).resolves.toEqual({
        recipeId: "recipe_1",
        title: "Updated recipe",
        description: "Updated description",
        servings: "4",
        course: "side",
        tags: [
          { id: "tag_a", label: "Alpha", normalizedLabel: "alpha" },
          { id: "tag_z", label: "Zulu", normalizedLabel: "zulu" },
        ],
        boundTimestamp: BOUND_NOW_TEXT,
      });

      expect(run.batch).toHaveBeenCalledOnce();
      expect(run.batch).toHaveBeenCalledWith(run.statements);
      expect(run.statements.map((statement) => normalizedSql(statement.sql))).toEqual([
        expect.stringMatching(/^UPDATE "Recipe"/),
        expect.stringMatching(/^DELETE FROM "RecipeTag"/),
        expect.stringMatching(/^INSERT INTO "RecipeTag"/),
        expect.stringMatching(/^INSERT INTO "RecipeTag"/),
        expect.stringMatching(/^UPDATE "Cookbook"/),
      ]);
      expect(run.statements[0].values).toEqual([
        "Updated recipe",
        "Updated description",
        "4",
        "side",
        BOUND_NOW_TEXT,
        "recipe_1",
        "owner_1",
      ]);
      expect(run.statements.slice(2, 4).map((statement) => statement.values)).toEqual([
        [
          "tag_z",
          "Zulu",
          "zulu",
          BOUND_NOW_TEXT,
          BOUND_NOW_TEXT,
          "recipe_1",
          "owner_1",
        ],
        [
          "tag_a",
          "Alpha",
          "alpha",
          BOUND_NOW_TEXT,
          BOUND_NOW_TEXT,
          "recipe_1",
          "owner_1",
        ],
      ]);
      expect(run.statements[4].values).toEqual([
        BOUND_NOW_TEXT,
        "recipe_1",
        "recipe_1",
        "owner_1",
      ]);
      expect(run.findMany).toHaveBeenCalledOnce();
      expect(run.database.$queryRawUnsafe).not.toHaveBeenCalled();
      expect(run.database.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(run.database.$transaction).not.toHaveBeenCalled();
      assertMutationOnlySql(run.statements);
    });

    it("builds the equivalent local transaction with an empty result slot", async () => {
      const run = runLocalAuthoring();

      await expect(run.result).resolves.toEqual({
        recipeId: "recipe_1",
        title: "Updated recipe",
        description: "Updated description",
        servings: "4",
        course: "side",
        tags: [{ id: "authoring_tag_1", label: "Quick", normalizedLabel: "quick" }],
        boundTimestamp: BOUND_NOW_TEXT,
      });

      expect(run.transaction).toHaveBeenCalledOnce();
      expect(run.transaction).toHaveBeenCalledWith(run.statements);
      expect(run.statements.map((statement) => normalizedSql(statement.sql))).toEqual([
        expect.stringMatching(/^UPDATE "Recipe"/),
        expect.stringMatching(/^DELETE FROM "RecipeTag"/),
        expect.stringMatching(/^INSERT INTO "RecipeTag"/),
        `SELECT "id" AS "recipeId" FROM "Recipe" WHERE 0`,
        expect.stringMatching(/^UPDATE "Cookbook"/),
      ]);
      expect(run.query).toHaveBeenCalledTimes(4);
      expect(run.execute).toHaveBeenCalledOnce();
      expect(run.findMany).toHaveBeenCalledOnce();
      assertMutationOnlySql(run.statements);
    });

    it("pads a native batch to five validated envelopes when no tags are present", async () => {
      const run = runNativeAuthoring({ tags: [] });

      await expect(run.result).resolves.toMatchObject({ tags: [] });
      expect(run.statements).toHaveLength(5);
      expect(run.statements.filter((statement) => (
        normalizedSql(statement.sql)
          === `SELECT "id" AS "recipeId" FROM "Recipe" WHERE 0`
      ))).toHaveLength(2);
    });

    it("propagates native and local executor failures without fallback or retry", async () => {
      const nativeFailure = new Error("native batch rolled back");
      const native = runNativeAuthoring({ executorFailure: nativeFailure });
      await expect(native.result).rejects.toBe(nativeFailure);
      expect(native.batch).toHaveBeenCalledOnce();
      expect(native.database.$transaction).not.toHaveBeenCalled();

      const localFailure = new Error("local transaction rolled back");
      const local = runLocalAuthoring({ executorFailure: localFailure });
      await expect(local.result).rejects.toBe(localFailure);
      expect(local.transaction).toHaveBeenCalledOnce();
    });

    it.each([null, {}, "invalid", []])(
      "rejects a malformed native authoring batch envelope %#",
      async (results) => {
        const run = runNativeAuthoring({ mutateResults: () => results });
        await expect(run.result).rejects.toThrow("Invalid recipe tag batch result");
      },
    );

    it("uses tag IDs as a defensive tie-break for equal normalized labels", async () => {
      const lowercase = vi.spyOn(String.prototype, "toLowerCase")
        .mockReturnValueOnce(new String("shared") as unknown as string)
        .mockReturnValueOnce(new String("shared") as unknown as string);
      const run = runNativeAuthoring({
        tags: ["Zulu", "Alpha"],
        tagIds: ["tag_z", "tag_a"],
      });
      lowercase.mockRestore();

      const result = await run.result;
      expect(result.tags.map((tag) => tag.id)).toEqual(["tag_a", "tag_z"]);
    });

    it("classifies only a completely all-zero native batch as not found", async () => {
      const allZero = runNativeAuthoring({
        mutateResults: (_, statements) => statements.map(() => nativeResult([], 0)),
      });
      await expect(allZero.result).rejects.toBeInstanceOf(RecipeTagNotFoundError);

      const partialMutations = [
        {
          label: "update row",
          mutate(statements: CapturedD1Statement[], results: unknown[]) {
            const index = statementIndex(statements, `UPDATE "Recipe"`);
            return replaceResultAt(
              results,
              index,
              nativeResult([authoringUpdateRow(statements[index])], 0),
            );
          },
        },
        {
          label: "delete change",
          mutate(statements: CapturedD1Statement[], results: unknown[]) {
            return replaceResultAt(
              results,
              statementIndex(statements, `DELETE FROM "RecipeTag"`),
              nativeResult([], 1),
            );
          },
        },
        {
          label: "delete row",
          mutate(statements: CapturedD1Statement[], results: unknown[]) {
            return replaceResultAt(
              results,
              statementIndex(statements, `DELETE FROM "RecipeTag"`),
              nativeResult([{ recipeId: "recipe_1" }], 0),
            );
          },
        },
        {
          label: "insert change",
          mutate(statements: CapturedD1Statement[], results: unknown[]) {
            const index = statementIndex(statements, `INSERT INTO "RecipeTag"`);
            return replaceResultAt(
              results,
              index,
              nativeResult([authoringInsertRow(statements[index])], 1),
            );
          },
        },
        {
          label: "insert row without a change",
          mutate(statements: CapturedD1Statement[], results: unknown[]) {
            const index = statementIndex(statements, `INSERT INTO "RecipeTag"`);
            return replaceResultAt(
              results,
              index,
              nativeResult([authoringInsertRow(statements[index])], 0),
            );
          },
        },
        {
          label: "cookbook change",
          mutate(statements: CapturedD1Statement[], results: unknown[]) {
            return replaceResultAt(
              results,
              statementIndex(statements, `UPDATE "Cookbook"`),
              nativeResult([], 1),
            );
          },
        },
        {
          label: "cookbook row without a change",
          mutate(statements: CapturedD1Statement[], results: unknown[]) {
            const index = statementIndex(statements, `UPDATE "Cookbook"`);
            return replaceResultAt(results, index, nativeResult([{
              cookbookId: "cookbook_1",
              updatedAt: statements[index].values[0],
            }], 0));
          },
        },
      ];

      for (const { label, mutate } of partialMutations) {
        const run = runNativeAuthoring({
          mutateResults(_, statements) {
            return mutate(statements, statements.map(() => nativeResult([], 0)));
          },
        });
        const error = await run.result.catch((failure: unknown) => failure);
        expect(error, label).toBeInstanceOf(Error);
        expect(error, label).not.toBeInstanceOf(RecipeTagNotFoundError);
      }
    });

    it("rejects either nonempty native padding-envelope signal", async () => {
      const cases = [
        nativeResult([], 1),
        nativeResult([{ recipeId: "unexpected" }], 0),
      ];
      for (const replacement of cases) {
        const run = runNativeAuthoring({
          mutateResults(results, statements) {
            return replaceResultAt(
              results,
              statementIndex(
                statements,
                `SELECT "id" AS "recipeId" FROM "Recipe" WHERE 0`,
              ),
              replacement,
            );
          },
        });
        await expect(run.result).rejects.toThrow("Invalid recipe authoring empty-slot result");
      }
    });

    it("rejects every mismatched native authoring update field", async () => {
      const patches = [
        { recipeId: "other_recipe" },
        { title: "Other title" },
        { description: null },
        { servings: null },
        { course: "main" },
        { updatedAt: "2026-07-23T18:19:20.124Z" },
      ];
      for (const patch of patches) {
        const run = runNativeAuthoring({
          mutateResults(results, statements) {
            return mutateReturnedRows(
              results,
              statementIndex(statements, `UPDATE "Recipe"`),
              (rows) => patchFirstRow(rows, patch),
            );
          },
        });
        await expect(run.result).rejects.toThrow("Invalid recipe authoring update result");
      }
    });

    it("rejects malformed native update, delete, insert, and cookbook result shapes", async () => {
      const cases = [
        {
          label: "update changed without a returned row",
          prefix: `UPDATE "Recipe"`,
          result: nativeResult([], 1),
          message: "Invalid recipe authoring update result",
        },
        {
          label: "delete returned a row",
          prefix: `DELETE FROM "RecipeTag"`,
          result: nativeResult([{ recipeId: "recipe_1" }], 0),
          message: "Invalid recipe authoring delete result",
        },
        {
          label: "insert returned a row without a change",
          prefix: `INSERT INTO "RecipeTag"`,
          result: "insert-row-without-change",
          message: "Invalid recipe authoring tag result",
        },
        {
          label: "insert changed without a returned row",
          prefix: `INSERT INTO "RecipeTag"`,
          result: nativeResult([], 1),
          message: "Invalid recipe authoring tag result",
        },
        {
          label: "cookbook change count disagrees with returned rows",
          prefix: `UPDATE "Cookbook"`,
          result: nativeResult([], 1),
          message: "Invalid recipe authoring cookbook result",
        },
      ];

      for (const testCase of cases) {
        const run = runNativeAuthoring({
          mutateResults(results, statements) {
            const index = statementIndex(statements, testCase.prefix);
            const replacement = testCase.result === "insert-row-without-change"
              ? nativeResult([authoringInsertRow(statements[index])], 0)
              : testCase.result;
            return replaceResultAt(results, index, replacement);
          },
        });
        await expect(run.result, testCase.label).rejects.toThrow(testCase.message);
      }
    });

    it("rejects malformed or contradictory native cookbook rows", async () => {
      const rowCases = [
        [{ cookbookId: 1, updatedAt: BOUND_NOW_TEXT }],
        [
          { cookbookId: "duplicate", updatedAt: BOUND_NOW_TEXT },
          { cookbookId: "duplicate", updatedAt: BOUND_NOW_TEXT },
        ],
        [{ cookbookId: "cookbook_1", updatedAt: "2026-07-23T18:19:20.124Z" }],
      ];

      for (const rows of rowCases) {
        const run = runNativeAuthoring({
          mutateResults(results, statements) {
            return replaceResultAt(
              results,
              statementIndex(statements, `UPDATE "Cookbook"`),
              nativeResult(rows, rows.length),
            );
          },
        });
        await expect(run.result).rejects.toThrow("Invalid recipe authoring cookbook result");
      }
    });

    it("classifies only a completely all-zero local transaction as not found", async () => {
      const zeroResults = (statements: CapturedD1Statement[]) => statements.map((statement) => (
        normalizedSql(statement.sql).startsWith(`DELETE FROM "RecipeTag"`) ? 0 : []
      ));
      const allZero = runLocalAuthoring({
        mutateResults: (_, statements) => zeroResults(statements),
      });
      await expect(allZero.result).rejects.toBeInstanceOf(RecipeTagNotFoundError);

      const partialMutations = [
        {
          label: "delete count",
          mutate(statements: CapturedD1Statement[], results: unknown[]) {
            return replaceResultAt(
              results,
              statementIndex(statements, `DELETE FROM "RecipeTag"`),
              1,
            );
          },
        },
        {
          label: "insert row",
          mutate(statements: CapturedD1Statement[], results: unknown[]) {
            const index = statementIndex(statements, `INSERT INTO "RecipeTag"`);
            return replaceResultAt(results, index, [authoringInsertRow(statements[index])]);
          },
        },
        {
          label: "cookbook row",
          mutate(statements: CapturedD1Statement[], results: unknown[]) {
            const index = statementIndex(statements, `UPDATE "Cookbook"`);
            return replaceResultAt(results, index, [{
              cookbookId: "cookbook_1",
              updatedAt: statements[index].values[0],
            }]);
          },
        },
      ];

      for (const { label, mutate } of partialMutations) {
        const run = runLocalAuthoring({
          mutateResults(_, statements) {
            return mutate(statements, zeroResults(statements));
          },
        });
        const error = await run.result.catch((failure: unknown) => failure);
        expect(error, label).toBeInstanceOf(Error);
        expect(error, label).not.toBeInstanceOf(RecipeTagNotFoundError);
      }
    });

    it.each([null, -1, 1.5])(
      "rejects malformed local delete count %#",
      async (deleted) => {
        const run = runLocalAuthoring({
          mutateResults(results, statements) {
            return replaceResultAt(
              results,
              statementIndex(statements, `DELETE FROM "RecipeTag"`),
              deleted,
            );
          },
        });
        await expect(run.result).rejects.toThrow("Invalid recipe authoring delete result");
      },
    );

    it("rejects a nonempty local padding result", async () => {
      const run = runLocalAuthoring({
        mutateResults(results, statements) {
          return replaceResultAt(
            results,
            statementIndex(
              statements,
              `SELECT "id" AS "recipeId" FROM "Recipe" WHERE 0`,
            ),
            [{ recipeId: "unexpected" }],
          );
        },
      });
      await expect(run.result).rejects.toThrow("Invalid recipe authoring empty-slot result");
    });

    it("rejects malformed local update and insertion row counts", async () => {
      const cases = [
        {
          label: "extra update row",
          prefix: `UPDATE "Recipe"`,
          mutate(rows: unknown[], statement: CapturedD1Statement) {
            return [...rows, authoringUpdateRow(statement)];
          },
          message: "Invalid recipe authoring update result",
        },
        {
          label: "missing insertion row",
          prefix: `INSERT INTO "RecipeTag"`,
          mutate: () => [],
          message: "Invalid recipe authoring tag result",
        },
        {
          label: "extra insertion row",
          prefix: `INSERT INTO "RecipeTag"`,
          mutate(rows: unknown[], statement: CapturedD1Statement) {
            return [...rows, authoringInsertRow(statement)];
          },
          message: "Invalid recipe authoring tag result",
        },
      ];

      for (const testCase of cases) {
        const run = runLocalAuthoring({
          mutateResults(results, statements) {
            const index = statementIndex(statements, testCase.prefix);
            return replaceResultAt(
              results,
              index,
              testCase.mutate(results[index] as unknown[], statements[index]),
            );
          },
        });
        await expect(run.result, testCase.label).rejects.toThrow(testCase.message);
      }
    });

    it("accepts a cookbook membership race when the diagnostic read matches the batch", async () => {
      const run = runNativeAuthoring({
        cookbookReads: [
          ["stable", "removed"],
          ["added", "stable"],
        ],
        returnedCookbookIds: ["added", "stable"],
      });

      await expect(run.result).resolves.toMatchObject({ recipeId: "recipe_1" });
      expect(run.findMany).toHaveBeenCalledTimes(2);
    });

    it("does not turn a committed authoring batch into a failure when reconciliation read fails", async () => {
      const readFailure = new Error("diagnostic read unavailable");
      const run = runNativeAuthoring({
        cookbookReads: [["removed"], readFailure],
        returnedCookbookIds: [],
      });

      await expect(run.result).resolves.toMatchObject({ recipeId: "recipe_1" });
      expect(run.findMany).toHaveBeenCalledTimes(2);
    });

    it("rejects a local result that omits a cookbook membership stable across the race", async () => {
      const run = runLocalAuthoring({
        cookbookReads: [["stable"], ["stable"]],
        returnedCookbookIds: [],
      });

      await expect(run.result).rejects.toThrow("Invalid recipe authoring cookbook result");
      expect(run.findMany).toHaveBeenCalledTimes(2);
    });

    it("accepts transient cookbook rows while retaining every stable membership", async () => {
      const run = runLocalAuthoring({
        cookbookReads: [
          ["removed", "stable"],
          ["stable"],
        ],
        returnedCookbookIds: ["added", "stable"],
      });

      await expect(run.result).resolves.toMatchObject({ recipeId: "recipe_1" });
      expect(run.findMany).toHaveBeenCalledTimes(2);
    });
  });
});
