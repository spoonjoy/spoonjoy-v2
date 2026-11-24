// Writes one moved-in recipe into the kitchen: the recipe, its steps, its ingredients on the steps
// that use them, and its SourceRecord, all in one D1 batch, so a crash never leaves a recipe the
// next run would not recognise. writeMovedInRecipes does the same for a chunk's new recipes with one
// read and one write between them, and leaves any other recipe to writeMovedInRecipe.
//
// Moving a kitchen in again adds nothing twice. A recipe is found by its id in the same kitchen,
// or, from another copy of the kitchen whose ids differ, by its name and content. The SourceRecord
// keeps a hash of what Spoonjoy wrote, so a recipe the backup changed is changed in place unless
// the cook changed it here too, when their version stays. A recipe the cook deleted stays deleted.
import { d1ReadBatch, type D1Query, type D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Guard, d1WriteBatch, isD1GuardFailure, retryOnD1GuardFailure } from "~/lib/d1-write.server";
import { parseIngredientLine, WHOLE_UNIT } from "~/lib/ingredient-text-parser";
import {
  activeRecipeTitleFreeGuard,
  cookbooksForRecipeTouchStatement,
  nameUpsertStatements,
  namedIngredientInsertStatement,
  recipeActiveGuard,
  recipeInsertStatement,
  recipeStepsReplaceStatements,
  recipeUpdateStatement,
  stepInsertStatement,
} from "~/lib/recipe-d1-writes.server";
import { stepForIngredient } from "~/lib/recipe-import.server";
import type { IngredientDraft, RecipeDraft } from "../../model/recipe-draft";
import type { RecipeVisibility } from "~/domains/kitchen";

const MOVED_IN_VISIBILITY: RecipeVisibility = "private";

export const RECIPE_TABLE = "recipes";
const GATHER_STEP = "Gather the ingredients.";

export interface WriteMovedInRecipeInput {
  db: D1ReadDatabase;
  sourceId: string;
  jobId: string;
  chefId: string;
  draft: RecipeDraft;
  now: Date;
}

export type WriteMovedInRecipeResult =
  /** `renamedFrom` is the backup's name when the cook already had a recipe by that name. */
  | { outcome: "created"; recipeId: string; title: string; renamedFrom?: string; warnings: string[] }
  /** `jobId` is the job that first brought the recipe in. */
  | { outcome: "unchanged"; recipeId: string; jobId: string }
  | { outcome: "updated"; recipeId: string }
  /** The backup changed it, and so did the cook: their version stays. */
  | { outcome: "kept"; recipeId: string; reason: string }
  | { outcome: "skipped"; recipeId: string; reason: string };

interface SpoonjoyIngredient {
  quantity: number;
  unitName: string;
  ingredientName: string;
}

function lower(value: string): string {
  return value.trim().toLowerCase();
}

/** One source line in Spoonjoy's shape (an amount, a unit and a name), or null when it has no name. */
function spoonjoyIngredient(line: IngredientDraft): SpoonjoyIngredient | null {
  if (line.plainText) {
    const parsed = parseIngredientLine((line.note ?? line.originalText) as string);
    return parsed ? { quantity: parsed.quantity, unitName: lower(parsed.unit), ingredientName: lower(parsed.ingredientName) } : null;
  }
  return {
    quantity: line.quantity ?? 1,
    unitName: lower(line.unit ?? WHOLE_UNIT),
    ingredientName: lower(line.note ? `${line.food}, ${line.note}` : (line.food as string)),
  };
}

function description(draft: RecipeDraft): string | null {
  const parts = [draft.description, ...draft.notes.map((note) => (note.title ? `${note.title}: ${note.text}` : note.text))];
  const kept = parts.filter((part): part is string => Boolean(part));
  return kept.length ? kept.join("\n\n") : null;
}

/** A recipe as Spoonjoy holds it, in a fixed order, to tell whether two are the same. */
interface WrittenForm {
  title: string;
  description: string | null;
  servings: string | null;
  sourceUrl: string | null;
  steps: Array<{ title: string | null; text: string; duration: number | null }>;
  ingredients: Array<SpoonjoyIngredient & { stepNum: number }>;
  /** Steps that use another step's output, as [output step, step using it]. Only a cook adds these. */
  links: Array<[number, number]>;
  /** When the recipe was last written, for a recipe read from Spoonjoy; a write checks it is still the same. */
  updatedAt?: string;
}

/** The title without the number a move-in adds when the name is taken: "Pancakes (2)" is "Pancakes". */
function baseTitle(title: string): string {
  return title.replace(/ \(\d+\)$/, "");
}

async function contentHash(form: WrittenForm): Promise<string> {
  const ingredients = form.ingredients
    .map((line) => [line.stepNum, line.ingredientName, line.unitName, line.quantity] as const)
    .map((line) => JSON.stringify(line))
    // The default sort is by code unit, not the locale's order, so a hash never changes with the runtime.
    .sort();
  const steps = form.steps.map((step) => [step.title, step.text, step.duration]);
  const text = JSON.stringify([baseTitle(form.title), form.description, form.servings, form.sourceUrl, steps, ingredients, form.links]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** What Spoonjoy writes for the draft, and the warnings about what it left out. */
function writtenForm(draft: RecipeDraft): { form: WrittenForm; warnings: string[] } {
  const warnings = [...draft.warnings];
  const stepTexts = draft.steps.map((step) => step.text);
  const steps = draft.steps.length || !draft.ingredients.length
    ? draft.steps.map((step) => ({ title: step.title, text: step.text, duration: null }))
    : [{ title: null, text: GATHER_STEP, duration: null }];
  const ingredients = draft.ingredients.flatMap((line) => {
    const written = spoonjoyIngredient(line);
    if (!written) {
      warnings.push(`"${line.note ?? line.originalText}" has no ingredient name after its amount, so it was left out.`);
      return [];
    }
    const linked = draft.steps.findIndex((step) => step.ingredientKeys.includes(line.sourceKey));
    const stepNum = linked >= 0 ? linked + 1 : stepForIngredient(written.ingredientName, stepTexts);
    return [{ ...written, stepNum }];
  });
  const form = { title: draft.title, description: description(draft), servings: draft.servings, sourceUrl: draft.sourceUrl, steps, ingredients, links: [] };
  return { form, warnings };
}

/** Each recipe as Spoonjoy holds it now. */
async function readForms(db: D1ReadDatabase, recipeIds: string[]): Promise<Map<string, WrittenForm>> {
  const forms = new Map<string, WrittenForm>();
  for (const recipeId of recipeIds) {
    const [[recipe], steps, links, ingredients] = await d1ReadBatch(db, [
      [`SELECT "title", "description", "servings", "sourceUrl", "updatedAt" FROM "Recipe" WHERE "id" = ?`, recipeId],
      [`SELECT "stepTitle", "description", "duration" FROM "RecipeStep" WHERE "recipeId" = ? ORDER BY "stepNum"`, recipeId],
      [`SELECT "outputStepNum", "inputStepNum" FROM "StepOutputUse" WHERE "recipeId" = ? ORDER BY "outputStepNum", "inputStepNum"`, recipeId],
      [
        `SELECT "Ingredient"."stepNum", "Ingredient"."quantity", "Unit"."name" AS "unitName", "IngredientRef"."name" AS "ingredientName" FROM "Ingredient"
         JOIN "Unit" ON "Unit"."id" = "Ingredient"."unitId" JOIN "IngredientRef" ON "IngredientRef"."id" = "Ingredient"."ingredientRefId"
         WHERE "Ingredient"."recipeId" = ?`,
        recipeId,
      ],
    ]);
    forms.set(recipeId, {
      title: String(recipe.title),
      description: recipe.description as string | null,
      servings: recipe.servings as string | null,
      sourceUrl: recipe.sourceUrl as string | null,
      steps: steps.map((step) => ({ title: step.stepTitle as string | null, text: String(step.description), duration: step.duration as number | null })),
      links: links.map((link) => [Number(link.outputStepNum), Number(link.inputStepNum)]),
      updatedAt: String(recipe.updatedAt),
      ingredients: ingredients.map((line) => ({
        stepNum: Number(line.stepNum),
        quantity: Number(line.quantity),
        unitName: String(line.unitName),
        ingredientName: String(line.ingredientName),
      })),
    });
  }
  return forms;
}

/**
 * Matches `title` and every title that starts "title (", as a range rather than LIKE: D1 refuses a LIKE pattern over 50
 * bytes, so a long name stopped its recipe on every try. Its values bind after the SQL's own.
 */
function titleOrNumbered(column: string, title: string): [string, string, string, string] {
  return [`(${column} = ? OR (${column} >= ? AND ${column} < ?))`, title, `${title} (`, `${title} )`];
}

/** The chef's other live recipes called `title` or a numbered `title (n)`, as freeTitle reads them. */
function takenTitlesQuery(chefId: string, title: string, recipeId = ""): D1Query {
  const [match, ...values] = titleOrNumbered(`"title"`, title);
  return [`SELECT "title" FROM "Recipe" WHERE "chefId" = ? AND "id" != ? AND "deletedAt" IS NULL AND ${match}`, chefId, recipeId, ...values];
}

/** `title`, unless it is taken, when the first "title (n)" that isn't. */
function firstFreeTitle(title: string, taken: ReadonlySet<string>): string {
  if (!taken.has(title)) return title;
  let n = 2;
  while (taken.has(`${title} (${n})`)) n += 1;
  return `${title} (${n})`;
}

/** The title to use: `title` if the chef has no other recipe called that, otherwise the first free "title (n)". */
async function freeTitle(db: D1ReadDatabase, chefId: string, title: string, recipeId = ""): Promise<string> {
  const [rows] = await d1ReadBatch(db, [takenTitlesQuery(chefId, title, recipeId)]);
  return firstFreeTitle(title, new Set(rows.map((row) => String(row.title))));
}

interface Found {
  recordId: string;
  recipeId: string;
  jobId: string;
  live: boolean;
  contentHash: string | null;
}

/** The recipe this kitchen's row brought in before, if any. */
function recordedQuery(sourceId: string, sourceKey: string): D1Query {
  return [
    `SELECT "SourceRecord"."id" AS "recordId", "SourceRecord"."targetId" AS "recipeId", "SourceRecord"."lastJobId" AS "jobId",
       "SourceRecord"."contentHash", "Recipe"."id" AS "liveId" FROM "SourceRecord"
     LEFT JOIN "Recipe" ON "Recipe"."id" = "SourceRecord"."targetId" AND "Recipe"."deletedAt" IS NULL
     WHERE "SourceRecord"."sourceId" = ? AND "SourceRecord"."sourceTable" = ? AND "SourceRecord"."sourceKey" = ?`,
    sourceId,
    RECIPE_TABLE,
    sourceKey,
  ];
}

/** The recipe this kitchen's row brought in before, if any. */
async function recorded(db: D1ReadDatabase, sourceId: string, sourceKey: string): Promise<Found | null> {
  const [[record]] = await d1ReadBatch(db, [recordedQuery(sourceId, sourceKey)]);
  if (!record) return null;
  return {
    recordId: String(record.recordId),
    recipeId: String(record.recipeId),
    jobId: String(record.jobId),
    live: Boolean(record.liveId),
    contentHash: record.contentHash as string | null,
  };
}

/**
 * A recipe that moved in from another copy of this kitchen (another server, or another version of it, whose ids
 * differ) with the same name and content, and that no row of this kitchen has claimed yet.
 */
async function sameRecipeFromACopy(
  db: D1ReadDatabase,
  { sourceId, chefId, title, hash }: { sourceId: string; chefId: string; title: string; hash: string },
): Promise<{ recipeId: string; jobId: string; updatedAt: string } | null> {
  const [candidates] = await d1ReadBatch(db, [copyCandidatesQuery(sourceId, chefId, title)]);
  const forms = await readForms(db, candidates.map((row) => String(row.recipeId)));
  for (const candidate of candidates) {
    const form = forms.get(String(candidate.recipeId)) as WrittenForm;
    // Compared by base name both ways, so a backup's own "Soup (2)" still finds the "Soup (2)" it brought before.
    if (baseTitle(form.title) === baseTitle(title) && (await contentHash(form)) === hash) {
      return { recipeId: String(candidate.recipeId), jobId: String(candidate.jobId), updatedAt: form.updatedAt as string };
    }
  }
  return null;
}

/** Recipes by this name that moved in from another copy of the kitchen, which sameRecipeFromACopy compares. */
function copyCandidatesQuery(sourceId: string, chefId: string, title: string): D1Query {
  const [match, ...values] = titleOrNumbered(`"Recipe"."title"`, title);
  return [
    `SELECT "Recipe"."id" AS "recipeId", MIN("SourceRecord"."lastJobId") AS "jobId" FROM "Recipe"
     JOIN "SourceRecord" ON "SourceRecord"."targetType" = 'Recipe' AND "SourceRecord"."targetId" = "Recipe"."id" AND "SourceRecord"."sourceId" != ?
     WHERE "Recipe"."chefId" = ? AND "Recipe"."deletedAt" IS NULL AND ${match}
       AND NOT EXISTS (SELECT 1 FROM "SourceRecord" AS "mine" WHERE "mine"."sourceId" = ? AND "mine"."targetId" = "Recipe"."id")
     GROUP BY "Recipe"."id" ORDER BY "Recipe"."createdAt", "Recipe"."id"`,
    sourceId,
    chefId,
    ...values,
    sourceId,
  ];
}

function sourceRecordInsert(input: WriteMovedInRecipeInput, recipeId: string, hash: string, jobId: string): D1Query {
  return [
    `INSERT INTO "SourceRecord" ("id", "sourceId", "sourceTable", "sourceKey", "targetType", "targetId", "sourceUpdatedAt", "contentHash", "lastJobId")
     VALUES (?, ?, ?, ?, 'Recipe', ?, ?, ?, ?)`,
    crypto.randomUUID(),
    input.sourceId,
    RECIPE_TABLE,
    input.draft.sourceKey,
    recipeId,
    input.draft.sourceUpdatedAt,
    hash,
    jobId,
  ];
}

function sourceRecordFreeGuard({ sourceId, draft }: WriteMovedInRecipeInput): D1Query {
  return d1Guard(
    `NOT EXISTS (SELECT 1 FROM "SourceRecord" WHERE "sourceId" = ? AND "sourceTable" = ? AND "sourceKey" = ?)`,
    sourceId,
    RECIPE_TABLE,
    draft.sourceKey,
  );
}

function recipeUnchangedGuard(recipeId: string, updatedAt: string): D1Query {
  return d1Guard(`EXISTS (SELECT 1 FROM "Recipe" WHERE "id" = ? AND "updatedAt" = ?)`, recipeId, updatedAt);
}

/** Changes a recipe that moved in before to the backup's version. */
async function update(input: WriteMovedInRecipeInput, found: Found, current: WrittenForm, form: WrittenForm, hash: string) {
  const { db, chefId, draft, now } = input;
  // A number the move-in added stays while the backup keeps the name.
  const title = baseTitle(current.title) === form.title ? current.title : await freeTitle(db, chefId, form.title, found.recipeId);
  await d1WriteBatch(db, [
    recipeActiveGuard(found.recipeId),
    // Unchanged since it was read: neither the cook nor another move-in has written it in between.
    recipeUnchangedGuard(found.recipeId, current.updatedAt as string),
    d1Guard(`EXISTS (SELECT 1 FROM "SourceRecord" WHERE "id" = ? AND "contentHash" = ?)`, found.recordId, found.contentHash),
    activeRecipeTitleFreeGuard(chefId, title, found.recipeId),
    recipeUpdateStatement(found.recipeId, { title, description: form.description, servings: form.servings, sourceUrl: form.sourceUrl }, now),
    ...recipeStepsReplaceStatements(
      found.recipeId,
      form.steps.map((step, index) => ({
        title: step.title,
        description: step.text,
        ingredients: form.ingredients
          .filter((line) => line.stepNum === index + 1)
          .map((line) => ({ name: line.ingredientName, quantity: line.quantity, unit: line.unitName })),
      })),
      now,
    ),
    cookbooksForRecipeTouchStatement(found.recipeId, now),
    [`UPDATE "SourceRecord" SET "contentHash" = ?, "sourceUpdatedAt" = ? WHERE "id" = ?`, hash, draft.sourceUpdatedAt, found.recordId],
  ]);
}

/** What to do with a recipe this kitchen brought in before. */
async function again(input: WriteMovedInRecipeInput, found: Found, form: WrittenForm, hash: string): Promise<WriteMovedInRecipeResult> {
  if (!found.live) return { outcome: "skipped", recipeId: found.recipeId, reason: "You deleted this recipe in Spoonjoy after it moved in." };
  const unchanged = { outcome: "unchanged", recipeId: found.recipeId, jobId: found.jobId } as const;
  // A record from before hashes were kept can't show whether the cook changed the recipe, so it is left as it is.
  if (found.contentHash === null || found.contentHash === hash) return unchanged;
  const current = (await readForms(input.db, [found.recipeId])).get(found.recipeId) as WrittenForm;
  const now = await contentHash(current);
  if (now === hash) return unchanged;
  if (now !== found.contentHash) {
    return { outcome: "kept", recipeId: found.recipeId, reason: `${baseTitle(current.title)} changed in the backup, but you've changed it in Spoonjoy too, so your version stays.` };
  }
  await update(input, found, current, form, hash);
  return { outcome: "updated", recipeId: found.recipeId };
}

/** The statements that add a new recipe under `title`, and what to answer once they have run. */
function creation(input: WriteMovedInRecipeInput, form: WrittenForm, warnings: string[], hash: string, title: string) {
  const { chefId, draft, jobId, now } = input;
  const recipeId = `recipe_movein_${crypto.randomUUID()}`;
  const statements: D1Query[] = [
    sourceRecordFreeGuard(input),
    activeRecipeTitleFreeGuard(chefId, title),
    recipeInsertStatement({ id: recipeId, title, description: form.description, servings: form.servings, sourceUrl: form.sourceUrl, chefId, now }),
    // A kitchen moves in private, whatever the cook's default: they choose what to share once it is here.
    [`UPDATE "Recipe" SET "visibility" = ? WHERE "id" = ?`, MOVED_IN_VISIBILITY, recipeId],
    ...form.steps.map((step, index) =>
      stepInsertStatement({ recipeId, stepNum: index + 1, stepTitle: step.title, description: step.text, duration: null, now })),
    ...nameUpsertStatements(form.ingredients, now),
    ...form.ingredients.map((ingredient) => namedIngredientInsertStatement({ recipeId, now, ...ingredient })),
    sourceRecordInsert(input, recipeId, hash, jobId),
  ];
  const result: WriteMovedInRecipeResult = { outcome: "created", recipeId, title, ...(title !== draft.title ? { renamedFrom: draft.title } : {}), warnings };
  return { statements, result };
}

export async function writeMovedInRecipe(input: WriteMovedInRecipeInput): Promise<WriteMovedInRecipeResult> {
  const { db, sourceId, chefId, draft } = input;
  return retryOnD1GuardFailure(
    async () => {
      const { form, warnings } = writtenForm(draft);
      const hash = await contentHash(form);
      const found = await recorded(db, sourceId, draft.sourceKey);
      if (found) return again(input, found, form, hash);

      const copy = await sameRecipeFromACopy(db, { sourceId, chefId, title: draft.title, hash });
      if (copy) {
        // A job that brought it in before stays its job, so this move-in counts it as "already here".
        await d1WriteBatch(db, [
          sourceRecordFreeGuard(input),
          recipeActiveGuard(copy.recipeId),
          recipeUnchangedGuard(copy.recipeId, copy.updatedAt),
          // No other row of this kitchen has claimed it since it was read, so two rows never share one recipe.
          d1Guard(`NOT EXISTS (SELECT 1 FROM "SourceRecord" WHERE "sourceId" = ? AND "targetType" = 'Recipe' AND "targetId" = ?)`, sourceId, copy.recipeId),
          sourceRecordInsert(input, copy.recipeId, hash, copy.jobId),
        ]);
        return { outcome: "unchanged", recipeId: copy.recipeId, jobId: copy.jobId };
      }

      const title = await freeTitle(db, chefId, draft.title);
      const { statements, result } = creation(input, form, warnings, hash, title);
      await d1WriteBatch(db, statements);
      return result;
    },
    () => {
      throw new Error(`Moving in recipe ${draft.sourceKey} lost a race three times.`);
    },
  );
}

/**
 * Writes a chunk's new recipes with one read and one write: each answer in the inputs' order, or null for a recipe
 * this kitchen brought in before, or one that may have come from another copy of it, which writeMovedInRecipe handles
 * alone. A chunk whose write lost a race to another write answers null for all of them, and nothing of it is written.
 */
export async function writeMovedInRecipes(inputs: WriteMovedInRecipeInput[]): Promise<Array<WriteMovedInRecipeResult | null>> {
  if (!inputs.length) return [];
  const { db } = inputs[0];
  const written = await Promise.all(inputs.map(async (input) => {
    const { form, warnings } = writtenForm(input.draft);
    return { input, form, warnings, hash: await contentHash(form) };
  }));
  // Three reads a recipe, in one round trip: whether it moved in before, any copies of it, and the names it would take.
  const reads = await d1ReadBatch(db, inputs.flatMap(({ sourceId, chefId, draft }) => [
    recordedQuery(sourceId, draft.sourceKey),
    copyCandidatesQuery(sourceId, chefId, draft.title),
    takenTitlesQuery(chefId, draft.title),
  ]));
  const taken = new Set<string>();
  for (let i = 0; i < inputs.length; i++) for (const row of reads[i * 3 + 2]) taken.add(String(row.title));
  const statements: D1Query[] = [];
  const answers = written.map(({ input, form, warnings, hash }, i) => {
    if (reads[i * 3].length || reads[i * 3 + 1].length) return null;
    // A name this chunk gives one recipe is taken for the next.
    const title = firstFreeTitle(input.draft.title, taken);
    taken.add(title);
    const made = creation(input, form, warnings, hash, title);
    statements.push(...made.statements);
    return made.result;
  });
  if (!statements.length) return answers;
  try {
    await d1WriteBatch(db, statements);
  } catch (error) {
    if (!isD1GuardFailure(error)) throw error;
    return inputs.map(() => null);
  }
  return answers;
}
