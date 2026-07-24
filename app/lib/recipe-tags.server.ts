import type { Prisma, PrismaClient } from "@prisma/client";
import { MAX_RECIPE_TAG_CODE_POINTS, MAX_RECIPE_TAGS } from "~/lib/recipe-tags";

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

export interface RecipeAuthoringMetadataFormResult {
  course: RecipeCourse | null;
  tags: string[];
  errors: {
    course?: string;
    tags?: string;
  };
}

export interface RecipeAuthoringUpdateInput {
  database: PrismaClient;
  nativeDatabase: CompatibleRecipeTagD1Database | null;
  userId: string;
  recipeId: string;
  title: string;
  description: string | null;
  servings: string | null;
  course: RecipeCourse | null;
  tags: string[];
}

export interface RecipeAuthoringUpdateResult {
  recipeId: string;
  title: string;
  description: string | null;
  servings: string | null;
  course: RecipeCourse | null;
  tags: Array<NormalizedRecipeTag & { id: string }>;
  boundTimestamp: string;
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

const UPDATE_RECIPE_AUTHORING_SQL = `
  UPDATE "Recipe"
  SET "title" = ?, "description" = ?, "servings" = ?, "course" = ?, "updatedAt" = ?
  WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL
  RETURNING
    "id" AS "recipeId", "title", "description", "servings", "course", "updatedAt"
`;

const UPDATE_RECIPE_COOKBOOKS_SQL = `
  UPDATE "Cookbook"
  SET "updatedAt" = ?
  WHERE "id" IN (SELECT "cookbookId" FROM "RecipeInCookbook"
    WHERE "recipeId" = ? AND EXISTS (SELECT 1 FROM "Recipe"
      WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL))
  RETURNING "id" AS "cookbookId", "updatedAt" AS "updatedAt"
`;

const EMPTY_AUTHORING_SLOT_SQL = `
  SELECT "id" AS "recipeId" FROM "Recipe" WHERE 0
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
    if (Array.from(label).length > MAX_RECIPE_TAG_CODE_POINTS) {
      validationError(field, "tag must contain at most 40 code points");
    }

    const normalizedLabel = label.toLowerCase();
    if (!unique.has(normalizedLabel)) {
      unique.set(normalizedLabel, { label, normalizedLabel });
    }
  }

  if (unique.size > MAX_RECIPE_TAGS) {
    validationError("tags", "tags must contain at most 10 unique values");
  }
  return [...unique.values()];
}

function tagFormError(error: RecipeTagValidationError): string {
  if (error.message.includes("at most 10")) return "Add no more than 10 tags";
  if (error.message.includes("must be an array")) return "Tags must be an array";
  if (error.message.includes("must be a string")) return "Tags must contain only text";
  if (error.message.includes("control characters")) return "Tags contain unsupported characters";
  if (error.message.includes("must not be empty")) return "Tags cannot be empty";
  if (error.message.includes("at most 40")) return "Tags must be 40 characters or fewer";
  return "Tags are invalid";
}

export function parseRecipeAuthoringMetadataForm(
  courseValue: string | null,
  tagsValue: string | null,
): RecipeAuthoringMetadataFormResult {
  let course: RecipeCourse | null = null;
  let tags: string[] = [];
  const errors: RecipeAuthoringMetadataFormResult["errors"] = {};

  try {
    course = normalizeRecipeCourse(courseValue ? courseValue : null);
  } catch (error) {
    if (!(error instanceof RecipeTagValidationError)) throw error;
    errors.course = "Choose a supported course";
  }

  let parsedTags: unknown = [];
  if (tagsValue) {
    try {
      parsedTags = JSON.parse(tagsValue);
    } catch {
      errors.tags = "Tags must be valid JSON";
    }
  }

  if (!errors.tags) {
    try {
      tags = normalizeRecipeTags(parsedTags).map((tag) => tag.label);
    } catch (error) {
      if (!(error instanceof RecipeTagValidationError)) throw error;
      errors.tags = tagFormError(error);
    }
  }

  return { course, tags, errors };
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
  plan: Pick<ReplacementPlan, "recipeId" | "boundTimestamp">,
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
    tags: [...plan.tags].sort((left, right) =>
      compareUtf16(left.normalizedLabel, right.normalizedLabel)),
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

function validateAuthoringUpdateRow(
  value: unknown,
  input: RecipeAuthoringUpdateInput,
  course: RecipeCourse | null,
  boundTimestamp: string,
) {
  const row = resultRecord(value);
  if (
    row.recipeId !== input.recipeId
    || row.title !== input.title
    || row.description !== input.description
    || row.servings !== input.servings
    || row.course !== course
    || !matchingTimestamp(row.updatedAt, boundTimestamp)
  ) {
    throw new Error("Invalid recipe authoring update result");
  }
}

function validateAuthoringCookbookRows(
  rows: unknown[],
  boundTimestamp: string,
): Set<string> {
  const returnedIds = new Set<string>();
  for (const value of rows) {
    const row = resultRecord(value);
    if (
      typeof row.cookbookId !== "string"
      || returnedIds.has(row.cookbookId)
      || !matchingTimestamp(row.updatedAt, boundTimestamp)
    ) {
      throw new Error("Invalid recipe authoring cookbook result");
    }
    returnedIds.add(row.cookbookId);
  }
  return returnedIds;
}

async function recipeCookbookIds(database: PrismaClient, recipeId: string): Promise<Set<string>> {
  const memberships = await database.recipeInCookbook.findMany({
    where: { recipeId },
    select: { cookbookId: true },
    orderBy: { cookbookId: "asc" },
  });
  return new Set(memberships.map(({ cookbookId }) => cookbookId));
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

async function validateAuthoringCookbookIdentity(
  database: PrismaClient,
  recipeId: string,
  before: Set<string>,
  returned: Set<string>,
): Promise<void> {
  if (setsEqual(before, returned)) return;

  let after: Set<string>;
  try {
    after = await recipeCookbookIds(database, recipeId);
  } catch {
    // The mutation is already committed. A diagnostic read outage must not
    // turn a successful atomic batch into a false 500.
    return;
  }
  if (setsEqual(after, returned)) return;

  const stableIds = [...before].filter((cookbookId) => after.has(cookbookId));
  if (stableIds.some((cookbookId) => !returned.has(cookbookId))) {
    throw new Error("Invalid recipe authoring cookbook result");
  }
}

function authoringResult(
  input: RecipeAuthoringUpdateInput,
  course: RecipeCourse | null,
  tags: ReplacementTag[],
  boundTimestamp: string,
): RecipeAuthoringUpdateResult {
  return {
    recipeId: input.recipeId,
    title: input.title,
    description: input.description,
    servings: input.servings,
    course,
    tags: [...tags].sort((left, right) => (
      compareUtf16(left.normalizedLabel, right.normalizedLabel)
        || compareUtf16(left.id, right.id)
    )),
    boundTimestamp,
  };
}

async function finalizeNativeAuthoringResults(
  results: unknown,
  operationCount: number,
  input: RecipeAuthoringUpdateInput,
  course: RecipeCourse | null,
  tags: ReplacementTag[],
  boundTimestamp: string,
  cookbookIdsBefore: Set<string>,
): Promise<RecipeAuthoringUpdateResult> {
  const slice = resultSlice(results, operationCount, undefined);
  const update = nativeResult(slice[0], "zero-or-one");
  const deletion = nativeResult(slice[1], "nonnegative");
  const insertions = tags.map((_, index) => nativeResult(slice[index + 2], "zero-or-one"));
  const emptySlotCount = Math.max(0, 2 - tags.length);
  const emptySlots = Array.from({ length: emptySlotCount }, (_, index) => (
    nativeResult(slice[index + 2 + tags.length], "nonnegative")
  ));
  const cookbook = nativeResult(slice[slice.length - 1], "nonnegative");
  if (emptySlots.some((slot) => slot.changes !== 0 || slot.rows.length !== 0)) {
    throw new Error("Invalid recipe authoring empty-slot result");
  }
  const allZero = update.changes === 0
    && update.rows.length === 0
    && deletion.changes === 0
    && deletion.rows.length === 0
    && insertions.every((insertion) => insertion.changes === 0 && insertion.rows.length === 0)
    && cookbook.changes === 0
    && cookbook.rows.length === 0;
  if (allZero) throw new RecipeTagNotFoundError(input.recipeId);

  if (update.changes !== 1 || update.rows.length !== 1) {
    throw new Error("Invalid recipe authoring update result");
  }
  validateAuthoringUpdateRow(update.rows[0], input, course, boundTimestamp);
  if (deletion.rows.length !== 0) throw new Error("Invalid recipe authoring delete result");

  tags.forEach((tag, index) => {
    const insertion = insertions[index];
    if (insertion.changes !== 1 || insertion.rows.length !== 1) {
      throw new Error("Invalid recipe authoring tag result");
    }
    validateInsertRow(insertion.rows[0], {
      boundTimestamp,
      recipeId: input.recipeId,
    }, tag);
  });

  if (cookbook.changes !== cookbook.rows.length) {
    throw new Error("Invalid recipe authoring cookbook result");
  }
  const returnedCookbookIds = validateAuthoringCookbookRows(cookbook.rows, boundTimestamp);
  await validateAuthoringCookbookIdentity(
    input.database,
    input.recipeId,
    cookbookIdsBefore,
    returnedCookbookIds,
  );
  return authoringResult(input, course, tags, boundTimestamp);
}

async function finalizeLocalAuthoringResults(
  results: unknown,
  operationCount: number,
  input: RecipeAuthoringUpdateInput,
  course: RecipeCourse | null,
  tags: ReplacementTag[],
  boundTimestamp: string,
  cookbookIdsBefore: Set<string>,
): Promise<RecipeAuthoringUpdateResult> {
  const slice = resultSlice(results, operationCount, undefined);
  const updateRows = resultRows(slice[0]);
  const deleted = slice[1];
  if (typeof deleted !== "number" || !Number.isInteger(deleted) || deleted < 0) {
    throw new Error("Invalid recipe authoring delete result");
  }
  const insertionRows = tags.map((_, index) => resultRows(slice[index + 2]));
  const emptySlotCount = Math.max(0, 2 - tags.length);
  const emptySlotRows = Array.from({ length: emptySlotCount }, (_, index) => (
    resultRows(slice[index + 2 + tags.length])
  ));
  const cookbookRows = resultRows(slice[slice.length - 1]);
  if (emptySlotRows.some((rows) => rows.length !== 0)) {
    throw new Error("Invalid recipe authoring empty-slot result");
  }
  const allZero = updateRows.length === 0
    && deleted === 0
    && insertionRows.every((rows) => rows.length === 0)
    && cookbookRows.length === 0;
  if (allZero) throw new RecipeTagNotFoundError(input.recipeId);

  if (updateRows.length !== 1) throw new Error("Invalid recipe authoring update result");
  validateAuthoringUpdateRow(updateRows[0], input, course, boundTimestamp);
  tags.forEach((tag, index) => {
    const rows = insertionRows[index];
    if (rows.length !== 1) throw new Error("Invalid recipe authoring tag result");
    validateInsertRow(rows[0], {
      boundTimestamp,
      recipeId: input.recipeId,
    }, tag);
  });
  const returnedCookbookIds = validateAuthoringCookbookRows(cookbookRows, boundTimestamp);
  await validateAuthoringCookbookIdentity(
    input.database,
    input.recipeId,
    cookbookIdsBefore,
    returnedCookbookIds,
  );
  return authoringResult(input, course, tags, boundTimestamp);
}

export async function updateRecipeAuthoringMetadata(
  input: RecipeAuthoringUpdateInput,
  dependencies: RecipeTagReplacementDependencies = {},
): Promise<RecipeAuthoringUpdateResult> {
  const course = normalizeRecipeCourse(input.course);
  const normalizedTags = normalizeRecipeTags(input.tags);
  const boundTimestamp = (dependencies.now?.() ?? new Date()).toISOString();
  const randomId = dependencies.randomId ?? (() => crypto.randomUUID());
  const tags = normalizedTags.map((tag) => ({ ...tag, id: randomId() }));
  const cookbookIdsBefore = await recipeCookbookIds(input.database, input.recipeId);
  const updateValues = [
    input.title,
    input.description,
    input.servings,
    course,
    boundTimestamp,
    input.recipeId,
    input.userId,
  ];
  const deleteValues = [input.recipeId, input.recipeId, input.userId];
  const insertionValues = tags.map((tag) => [
    tag.id,
    tag.label,
    tag.normalizedLabel,
    boundTimestamp,
    boundTimestamp,
    input.recipeId,
    input.userId,
  ]);
  const cookbookValues = [
    boundTimestamp,
    input.recipeId,
    input.recipeId,
    input.userId,
  ];
  const nativeDatabase = asCompatibleRecipeTagD1Database(input.nativeDatabase);
  const emptySlotCount = Math.max(0, 2 - tags.length);

  if (nativeDatabase) {
    const operations = [
      bindNative(nativeDatabase, UPDATE_RECIPE_AUTHORING_SQL, updateValues),
      bindNative(nativeDatabase, DELETE_RECIPE_TAGS_SQL, deleteValues),
      ...insertionValues.map((values) => bindNative(nativeDatabase, INSERT_RECIPE_TAG_SQL, values)),
      ...Array.from({ length: emptySlotCount }, () => (
        bindNative(nativeDatabase, EMPTY_AUTHORING_SLOT_SQL, [])
      )),
      bindNative(nativeDatabase, UPDATE_RECIPE_COOKBOOKS_SQL, cookbookValues),
    ];
    const results = await nativeDatabase.batch(operations);
    return await finalizeNativeAuthoringResults(
      results,
      operations.length,
      { ...input, nativeDatabase },
      course,
      tags,
      boundTimestamp,
      cookbookIdsBefore,
    );
  }

  const operations = [
    input.database.$queryRawUnsafe(UPDATE_RECIPE_AUTHORING_SQL, ...updateValues),
    input.database.$executeRawUnsafe(DELETE_RECIPE_TAGS_SQL, ...deleteValues),
    ...insertionValues.map((values) => (
      input.database.$queryRawUnsafe(INSERT_RECIPE_TAG_SQL, ...values)
    )),
    ...Array.from({ length: emptySlotCount }, () => (
      input.database.$queryRawUnsafe(EMPTY_AUTHORING_SLOT_SQL)
    )),
    input.database.$queryRawUnsafe(UPDATE_RECIPE_COOKBOOKS_SQL, ...cookbookValues),
  ];
  const results = await input.database.$transaction(operations);
  return await finalizeLocalAuthoringResults(
    results,
    operations.length,
    input,
    course,
    tags,
    boundTimestamp,
    cookbookIdsBefore,
  );
}
