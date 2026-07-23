import type { Prisma, PrismaClient } from "@prisma/client";

export const RECIPE_COURSES = ["main", "side", "appetizer", "dessert"] as const;

export type RecipeCourse = (typeof RECIPE_COURSES)[number];

export interface NormalizedRecipeTag {
  label: string;
  normalizedLabel: string;
}

export interface RecipeTagMetadata {
  recipeId: string;
  course: RecipeCourse | null;
  tags: Array<NormalizedRecipeTag & { id: string }>;
}

export interface CompatibleRecipeTagD1PreparedStatement {
  bind(...values: unknown[]): CompatibleRecipeTagD1PreparedStatement;
}

export interface CompatibleRecipeTagD1Database {
  prepare(query: string): CompatibleRecipeTagD1PreparedStatement;
  batch(statements: CompatibleRecipeTagD1PreparedStatement[]): Promise<unknown>;
}

interface RecipeTagReplacementInput {
  database: PrismaClient;
  nativeDatabase: CompatibleRecipeTagD1Database | null;
  userId: string;
  recipeId: string;
  course: RecipeCourse | null;
  tags: string[];
}

interface RecipeTagReplacementDependencies {
  now?: () => Date;
  randomId?: () => string;
}

interface ReplacementTag extends NormalizedRecipeTag {
  id: string;
}

interface NativeReplacementPlan {
  strategy: "native-d1";
  boundTimestamp: string;
  operations: CompatibleRecipeTagD1PreparedStatement[];
  nativeDatabase: CompatibleRecipeTagD1Database;
  recipeId: string;
  course: RecipeCourse | null;
  tags: ReplacementTag[];
  finalizeResults(results: unknown, offset?: number): RecipeTagMetadata;
}

interface LocalReplacementPlan {
  strategy: "prisma-local";
  boundTimestamp: string;
  operations: Prisma.PrismaPromise<unknown>[];
  recipeId: string;
  course: RecipeCourse | null;
  tags: ReplacementTag[];
  finalizeResults(results: unknown, offset?: number): RecipeTagMetadata;
}

type ReplacementPlan = NativeReplacementPlan | LocalReplacementPlan;

export type PreparedRecipeTagMetadataReplacement =
  | Pick<NativeReplacementPlan, "strategy" | "boundTimestamp" | "operations" | "finalizeResults">
  | Pick<LocalReplacementPlan, "strategy" | "boundTimestamp" | "operations" | "finalizeResults">;

interface RawMetadataRow {
  recipeId: unknown;
  course: unknown;
  tagId: unknown;
  label: unknown;
  normalizedLabel: unknown;
}

const CATEGORY_C = /\p{C}/u;
const UNICODE_WHITESPACE = /\p{White_Space}+/gu;
const MAX_TAG_CODE_POINTS = 40;
const MAX_UNIQUE_TAGS = 10;

const READ_METADATA_SQL = `
  SELECT
    recipe."id" AS "recipeId",
    recipe."course" AS "course",
    tag."id" AS "tagId",
    tag."label" AS "label",
    tag."normalizedLabel" AS "normalizedLabel"
  FROM "Recipe" AS recipe
  LEFT JOIN "RecipeTag" AS tag ON tag."recipeId" = recipe."id"
  WHERE recipe."id" = ? AND recipe."deletedAt" IS NULL
`;

const UPDATE_RECIPE_SQL = `
  UPDATE "Recipe"
  SET "course" = ?, "updatedAt" = ?
  WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL
  RETURNING "id" AS "recipeId", "course", "updatedAt"
`;

const DELETE_RECIPE_TAGS_SQL = `
  DELETE FROM "RecipeTag"
  WHERE "recipeId" = ? AND EXISTS (SELECT 1 FROM "Recipe"
    WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL)
`;

const INSERT_RECIPE_TAG_SQL = `
  INSERT INTO "RecipeTag" ("id", "recipeId", "label", "normalizedLabel", "createdAt", "updatedAt")
  SELECT ?, "id", ?, ?, ?, ? FROM "Recipe"
  WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL
  RETURNING
    "recipeId" AS "recipeId",
    "id" AS "tagId",
    "label" AS "label",
    "normalizedLabel" AS "normalizedLabel",
    "createdAt" AS "createdAt",
    "updatedAt" AS "updatedAt"
`;

export class RecipeTagValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "RecipeTagValidationError";
    this.field = field;
  }
}

export class RecipeTagNotFoundError extends Error {
  readonly recipeId: string;

  constructor(recipeId: string) {
    super("Recipe not found");
    this.name = "RecipeTagNotFoundError";
    this.recipeId = recipeId;
  }
}

function validationError(field: string, message: string): never {
  throw new RecipeTagValidationError(field, message);
}

export function normalizeRecipeCourse(value: unknown): RecipeCourse | null {
  if (value === null) return null;
  if (typeof value === "string" && (RECIPE_COURSES as readonly string[]).includes(value)) {
    return value as RecipeCourse;
  }
  return validationError("course", "course must be null or a supported value");
}

export function normalizeRecipeTags(value: unknown): NormalizedRecipeTag[] {
  if (!Array.isArray(value)) {
    return validationError("tags", "tags must be an array");
  }

  const unique = new Map<string, NormalizedRecipeTag>();
  for (let index = 0; index < value.length; index += 1) {
    const rawTag = value[index];
    const field = `tags.${index}`;
    if (typeof rawTag !== "string") {
      validationError(field, "tag must be a string");
    }

    const compatibleTag = rawTag.normalize("NFKC");
    if (CATEGORY_C.test(compatibleTag)) {
      validationError(field, "tag contains unsupported control characters");
    }
    const label = compatibleTag.replace(UNICODE_WHITESPACE, " ").replace(/^ | $/g, "");
    if (!label) {
      validationError(field, "tag must not be empty");
    }
    if (Array.from(label).length > MAX_TAG_CODE_POINTS) {
      validationError(field, "tag must contain at most 40 code points");
    }

    const normalizedLabel = label.toLowerCase();
    if (!unique.has(normalizedLabel)) {
      unique.set(normalizedLabel, { label, normalizedLabel });
    }
  }

  if (unique.size > MAX_UNIQUE_TAGS) {
    validationError("tags", "tags must contain at most 10 unique values");
  }
  return [...unique.values()];
}

export function asCompatibleRecipeTagD1Database(
  value: unknown,
): CompatibleRecipeTagD1Database | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CompatibleRecipeTagD1Database>;
  return typeof candidate.prepare === "function" && typeof candidate.batch === "function"
    ? candidate as CompatibleRecipeTagD1Database
    : null;
}

function compareUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function requiredString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid recipe tag ${context}`);
  }
  return value;
}

function nullableCourse(value: unknown, context: string): RecipeCourse | null {
  if (value === null) return null;
  if (typeof value === "string" && (RECIPE_COURSES as readonly string[]).includes(value)) {
    return value as RecipeCourse;
  }
  throw new Error(`Invalid recipe tag ${context}`);
}

export async function getRecipeTagMetadata(
  database: PrismaClient,
  input: { recipeId: string },
): Promise<RecipeTagMetadata> {
  const rows = await database.$queryRawUnsafe<RawMetadataRow[]>(
    READ_METADATA_SQL,
    input.recipeId,
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new RecipeTagNotFoundError(input.recipeId);
  }

  const recipeId = requiredString(rows[0]?.recipeId, "read result");
  if (recipeId !== input.recipeId) throw new Error("Invalid recipe tag read result");
  const course = nullableCourse(rows[0]?.course, "read result");
  const tags = rows.flatMap((row) => {
    if (requiredString(row.recipeId, "read result") !== recipeId || row.course !== course) {
      throw new Error("Invalid recipe tag read result");
    }
    if (row.tagId === null) {
      if (row.label !== null || row.normalizedLabel !== null) {
        throw new Error("Invalid recipe tag read result");
      }
      return [];
    }
    return [{
      id: requiredString(row.tagId, "read result"),
      label: requiredString(row.label, "read result"),
      normalizedLabel: requiredString(row.normalizedLabel, "read result"),
    }];
  }).sort((left, right) => (
    compareUtf16(left.normalizedLabel, right.normalizedLabel)
      || compareUtf16(left.id, right.id)
  ));

  return { recipeId, course, tags };
}

function bindNative(
  database: CompatibleRecipeTagD1Database,
  query: string,
  values: unknown[],
) {
  return database.prepare(query).bind(...values);
}

function replacementValues(input: {
  userId: string;
  recipeId: string;
  course: RecipeCourse | null;
  tags: ReplacementTag[];
  boundTimestamp: string;
}) {
  return {
    update: [input.course, input.boundTimestamp, input.recipeId, input.userId],
    deletion: [input.recipeId, input.recipeId, input.userId],
    insertions: input.tags.map((tag) => [
      tag.id,
      tag.label,
      tag.normalizedLabel,
      input.boundTimestamp,
      input.boundTimestamp,
      input.recipeId,
      input.userId,
    ]),
  };
}

function buildReplacementPlan(
  input: RecipeTagReplacementInput,
  dependencies: RecipeTagReplacementDependencies = {},
): ReplacementPlan {
  const course = normalizeRecipeCourse(input.course);
  const normalizedTags = normalizeRecipeTags(input.tags);
  const boundTimestamp = (dependencies.now?.() ?? new Date()).toISOString();
  const randomId = dependencies.randomId ?? (() => crypto.randomUUID());
  const tags = normalizedTags.map((tag) => ({ ...tag, id: randomId() }));
  const values = replacementValues({
    userId: input.userId,
    recipeId: input.recipeId,
    course,
    tags,
    boundTimestamp,
  });
  const nativeDatabase = asCompatibleRecipeTagD1Database(input.nativeDatabase);

  if (nativeDatabase) {
    const operations = [
      bindNative(nativeDatabase, UPDATE_RECIPE_SQL, values.update),
      bindNative(nativeDatabase, DELETE_RECIPE_TAGS_SQL, values.deletion),
      ...values.insertions.map((insertion) =>
        bindNative(nativeDatabase, INSERT_RECIPE_TAG_SQL, insertion)),
    ];
    const plan: NativeReplacementPlan = {
      strategy: "native-d1",
      boundTimestamp,
      nativeDatabase,
      recipeId: input.recipeId,
      course,
      tags,
      operations,
      finalizeResults(results, offset) {
        return finalizeNativeResults(results, plan, offset);
      },
    };
    return plan;
  }

  const operations = [
    input.database.$queryRawUnsafe(UPDATE_RECIPE_SQL, ...values.update),
    input.database.$executeRawUnsafe(DELETE_RECIPE_TAGS_SQL, ...values.deletion),
    ...values.insertions.map((insertion) =>
      input.database.$queryRawUnsafe(INSERT_RECIPE_TAG_SQL, ...insertion)),
  ];
  const plan: LocalReplacementPlan = {
    strategy: "prisma-local",
    boundTimestamp,
    recipeId: input.recipeId,
    course,
    tags,
    operations,
    finalizeResults(results, offset) {
      return finalizeLocalResults(results, plan, offset);
    },
  };
  return plan;
}

export function prepareRecipeTagMetadataReplacement(
  input: RecipeTagReplacementInput,
  dependencies?: RecipeTagReplacementDependencies,
): PreparedRecipeTagMetadataReplacement {
  const plan = buildReplacementPlan(input, dependencies);
  if (plan.strategy === "native-d1") {
    return {
      strategy: plan.strategy,
      boundTimestamp: plan.boundTimestamp,
      operations: plan.operations,
      finalizeResults: plan.finalizeResults,
    };
  }
  return {
    strategy: plan.strategy,
    boundTimestamp: plan.boundTimestamp,
    operations: plan.operations,
    finalizeResults: plan.finalizeResults,
  };
}

function resultRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid recipe tag batch result");
  }
  return value as Record<string, unknown>;
}

function resultRows(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid recipe tag batch result");
  return value;
}

function nativeResult(value: unknown, changes: "zero-or-one" | "nonnegative") {
  const result = resultRecord(value);
  if (result.success !== true) throw new Error("Recipe tag batch statement failed");
  const meta = resultRecord(result.meta);
  const count = meta.changes;
  if (
    typeof count !== "number"
    || !Number.isFinite(count)
    || !Number.isInteger(count)
    || count < 0
    || (changes === "zero-or-one" && count > 1)
  ) {
    throw new Error("Invalid recipe tag batch result");
  }
  return { rows: resultRows(result.results), changes: count };
}

function matchingTimestamp(value: unknown, expected: string): boolean {
  if (value === expected) return true;
  return value instanceof Date
    && Number.isFinite(value.getTime())
    && value.toISOString() === expected;
}

function validateUpdateRow(
  value: unknown,
  plan: ReplacementPlan,
) {
  const row = resultRecord(value);
  if (
    row.recipeId !== plan.recipeId
    || row.course !== plan.course
    || !matchingTimestamp(row.updatedAt, plan.boundTimestamp)
  ) {
    throw new Error("Invalid recipe tag update result");
  }
}

function validateInsertRow(
  value: unknown,
  plan: ReplacementPlan,
  tag: ReplacementTag,
) {
  const row = resultRecord(value);
  if (
    row.recipeId !== plan.recipeId
    || row.tagId !== tag.id
    || row.label !== tag.label
    || row.normalizedLabel !== tag.normalizedLabel
    || !matchingTimestamp(row.createdAt, plan.boundTimestamp)
    || !matchingTimestamp(row.updatedAt, plan.boundTimestamp)
  ) {
    throw new Error("Invalid recipe tag insert result");
  }
}

function replacementMetadata(plan: ReplacementPlan): RecipeTagMetadata {
  return {
    recipeId: plan.recipeId,
    course: plan.course,
    tags: [...plan.tags].sort((left, right) => (
      compareUtf16(left.normalizedLabel, right.normalizedLabel)
        || compareUtf16(left.id, right.id)
    )),
  };
}

function resultSlice(
  results: unknown,
  operationCount: number,
  offset: number | undefined,
) {
  if (!Array.isArray(results)) {
    throw new Error("Invalid recipe tag batch result");
  }
  if (offset === undefined) {
    if (results.length !== operationCount) {
      throw new Error("Invalid recipe tag batch result");
    }
    return results;
  }
  if (
    !Number.isInteger(offset)
    || offset < 0
    || results.length < offset + operationCount
  ) {
    throw new Error("Invalid recipe tag batch result offset");
  }
  return results.slice(offset, offset + operationCount);
}

function finalizeNativeResults(
  results: unknown,
  plan: NativeReplacementPlan,
  offset?: number,
) {
  const slice = resultSlice(results, plan.operations.length, offset);

  const update = nativeResult(slice[0], "zero-or-one");
  const deletion = nativeResult(slice[1], "nonnegative");
  const insertions = plan.tags.map((_, index) =>
    nativeResult(slice[index + 2], "zero-or-one"));

  if (update.changes === 0) {
    if (
      update.rows.length !== 0
      || deletion.changes !== 0
      || deletion.rows.length !== 0
      || insertions.some((insertion) => (
        insertion.changes !== 0 || insertion.rows.length !== 0
      ))
    ) {
      throw new Error("Invalid recipe tag no-op result");
    }
    throw new RecipeTagNotFoundError(plan.recipeId);
  }

  if (update.rows.length !== 1) throw new Error("Invalid recipe tag update result");
  validateUpdateRow(update.rows[0], plan);

  if (deletion.rows.length !== 0) throw new Error("Invalid recipe tag delete result");

  for (let index = 0; index < plan.tags.length; index += 1) {
    const insertion = insertions[index];
    if (insertion.changes !== 1) throw new Error("Invalid recipe tag insert result");
    if (insertion.rows.length !== 1) throw new Error("Invalid recipe tag insert result");
    validateInsertRow(insertion.rows[0], plan, plan.tags[index]);
  }
  return replacementMetadata(plan);
}

function finalizeLocalResults(
  results: unknown,
  plan: LocalReplacementPlan,
  offset?: number,
) {
  const slice = resultSlice(results, plan.operations.length, offset);
  const updateRows = resultRows(slice[0]);
  const deleted = slice[1];
  if (typeof deleted !== "number" || !Number.isInteger(deleted) || deleted < 0) {
    throw new Error("Invalid recipe tag delete result");
  }
  const insertionRows = plan.tags.map((_, index) => resultRows(slice[index + 2]));

  if (updateRows.length === 0) {
    if (deleted !== 0 || insertionRows.some((rows) => rows.length !== 0)) {
      throw new Error("Invalid recipe tag no-op result");
    }
    throw new RecipeTagNotFoundError(plan.recipeId);
  }
  if (updateRows.length !== 1) throw new Error("Invalid recipe tag update result");
  validateUpdateRow(updateRows[0], plan);

  for (let index = 0; index < plan.tags.length; index += 1) {
    const rows = insertionRows[index];
    if (rows.length !== 1) throw new Error("Invalid recipe tag insert result");
    validateInsertRow(rows[0], plan, plan.tags[index]);
  }
  return replacementMetadata(plan);
}

export async function replaceRecipeTagMetadata(
  input: RecipeTagReplacementInput,
  dependencies?: RecipeTagReplacementDependencies,
): Promise<RecipeTagMetadata> {
  const plan = buildReplacementPlan(input, dependencies);
  if (plan.strategy === "native-d1") {
    const results = await plan.nativeDatabase.batch(plan.operations);
    return plan.finalizeResults(results);
  }

  const results = await input.database.$transaction(plan.operations);
  return plan.finalizeResults(results);
}
