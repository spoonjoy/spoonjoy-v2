// Writes one moved-in recipe into the kitchen: the recipe, its steps, its ingredients on the steps
// that use them, and its SourceRecord, all in one D1 batch, so a crash never leaves a recipe the
// next run would not recognise.
//
// Moving a kitchen in again adds nothing twice. A recipe is found by its id in the same kitchen,
// or, from another copy of the kitchen whose ids differ, by its name and content. The SourceRecord
// keeps a hash of what Spoonjoy wrote, so a recipe the backup changed is changed in place unless
// the cook changed it here too, when their version stays. A recipe the cook deleted stays deleted.
import { d1ReadBatch, type D1Query, type D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Guard, d1WriteBatch, retryOnD1GuardFailure } from "~/lib/d1-write.server";
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
  steps: Array<{ title: string | null; text: string }>;
  ingredients: Array<SpoonjoyIngredient & { stepNum: number }>;
}

/** The title without the number a move-in adds when the name is taken: "Pancakes (2)" is "Pancakes". */
function baseTitle(title: string): string {
  return title.replace(/ \(\d+\)$/, "");
}

async function contentHash(form: WrittenForm): Promise<string> {
  const ingredients = form.ingredients
    .map((line) => [line.stepNum, line.ingredientName, line.unitName, line.quantity] as const)
    .sort((a, b) => a.join("\u0000").localeCompare(b.join("\u0000")));
  const text = JSON.stringify([baseTitle(form.title), form.description, form.servings, form.sourceUrl, form.steps.map((step) => [step.title, step.text]), ingredients]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** What Spoonjoy writes for the draft, and the warnings about what it left out. */
function writtenForm(draft: RecipeDraft): { form: WrittenForm; warnings: string[] } {
  const warnings = [...draft.warnings];
  const stepTexts = draft.steps.map((step) => step.text);
  const steps = draft.steps.length || !draft.ingredients.length
    ? draft.steps.map((step) => ({ title: step.title, text: step.text }))
    : [{ title: null, text: GATHER_STEP }];
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
  const form = { title: draft.title, description: description(draft), servings: draft.servings, sourceUrl: draft.sourceUrl, steps, ingredients };
  return { form, warnings };
}

/** Each recipe as Spoonjoy holds it now. */
async function readForms(db: D1ReadDatabase, recipeIds: string[]): Promise<Map<string, WrittenForm>> {
  const forms = new Map<string, WrittenForm>();
  for (const recipeId of recipeIds) {
    const [[recipe], steps, ingredients] = await d1ReadBatch(db, [
      [`SELECT "title", "description", "servings", "sourceUrl" FROM "Recipe" WHERE "id" = ?`, recipeId],
      [`SELECT "stepTitle", "description" FROM "RecipeStep" WHERE "recipeId" = ? ORDER BY "stepNum"`, recipeId],
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
      steps: steps.map((step) => ({ title: step.stepTitle as string | null, text: String(step.description) })),
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

/** The title to use: `title` if the chef has no other recipe called that, otherwise the first free "title (n)". */
async function freeTitle(db: D1ReadDatabase, chefId: string, title: string, recipeId = ""): Promise<string> {
  const [rows] = await d1ReadBatch(db, [[
    `SELECT "title" FROM "Recipe" WHERE "chefId" = ? AND "id" != ? AND "deletedAt" IS NULL AND ("title" = ? OR "title" LIKE ?)`,
    chefId,
    recipeId,
    title,
    `${title} (%)`,
  ]]);
  const taken = new Set(rows.map((row) => String(row.title)));
  if (!taken.has(title)) return title;
  let n = 2;
  while (taken.has(`${title} (${n})`)) n += 1;
  return `${title} (${n})`;
}

interface Found {
  recordId: string;
  recipeId: string;
  jobId: string;
  live: boolean;
  contentHash: string | null;
}

/** The recipe this kitchen's row brought in before, if any. */
async function recorded(db: D1ReadDatabase, sourceId: string, sourceKey: string): Promise<Found | null> {
  const [[record]] = await d1ReadBatch(db, [[
    `SELECT "SourceRecord"."id" AS "recordId", "SourceRecord"."targetId" AS "recipeId", "SourceRecord"."lastJobId" AS "jobId",
       "SourceRecord"."contentHash", "Recipe"."id" AS "liveId" FROM "SourceRecord"
     LEFT JOIN "Recipe" ON "Recipe"."id" = "SourceRecord"."targetId" AND "Recipe"."deletedAt" IS NULL
     WHERE "SourceRecord"."sourceId" = ? AND "SourceRecord"."sourceTable" = ? AND "SourceRecord"."sourceKey" = ?`,
    sourceId,
    RECIPE_TABLE,
    sourceKey,
  ]]);
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
): Promise<{ recipeId: string; jobId: string } | null> {
  const [candidates] = await d1ReadBatch(db, [[
    `SELECT "Recipe"."id" AS "recipeId", MIN("SourceRecord"."lastJobId") AS "jobId" FROM "Recipe"
     JOIN "SourceRecord" ON "SourceRecord"."targetType" = 'Recipe' AND "SourceRecord"."targetId" = "Recipe"."id" AND "SourceRecord"."sourceId" != ?
     WHERE "Recipe"."chefId" = ? AND "Recipe"."deletedAt" IS NULL AND ("Recipe"."title" = ? OR "Recipe"."title" LIKE ?)
       AND NOT EXISTS (SELECT 1 FROM "SourceRecord" AS "mine" WHERE "mine"."sourceId" = ? AND "mine"."targetId" = "Recipe"."id")
     GROUP BY "Recipe"."id" ORDER BY "Recipe"."createdAt", "Recipe"."id"`,
    sourceId,
    chefId,
    title,
    `${title} (%)`,
    sourceId,
  ]]);
  const forms = await readForms(db, candidates.map((row) => String(row.recipeId)));
  for (const candidate of candidates) {
    const form = forms.get(String(candidate.recipeId)) as WrittenForm;
    if (baseTitle(form.title) === title && (await contentHash(form)) === hash) {
      return { recipeId: String(candidate.recipeId), jobId: String(candidate.jobId) };
    }
  }
  return null;
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

/** Changes a recipe that moved in before to the backup's version. */
async function update(input: WriteMovedInRecipeInput, found: Found, current: WrittenForm, form: WrittenForm, hash: string) {
  const { db, chefId, draft, now } = input;
  // A number the move-in added stays while the backup keeps the name.
  const title = baseTitle(current.title) === form.title ? current.title : await freeTitle(db, chefId, form.title, found.recipeId);
  await d1WriteBatch(db, [
    recipeActiveGuard(found.recipeId),
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

export async function writeMovedInRecipe(input: WriteMovedInRecipeInput): Promise<WriteMovedInRecipeResult> {
  const { db, sourceId, jobId, chefId, draft, now } = input;
  return retryOnD1GuardFailure(
    async () => {
      const { form, warnings } = writtenForm(draft);
      const hash = await contentHash(form);
      const found = await recorded(db, sourceId, draft.sourceKey);
      if (found) return again(input, found, form, hash);

      const copy = await sameRecipeFromACopy(db, { sourceId, chefId, title: draft.title, hash });
      if (copy) {
        // The job that first brought it in stays its job, so a later count calls it "already here".
        await d1WriteBatch(db, [sourceRecordFreeGuard(input), recipeActiveGuard(copy.recipeId), sourceRecordInsert(input, copy.recipeId, hash, copy.jobId)]);
        return { outcome: "unchanged", recipeId: copy.recipeId, jobId: copy.jobId };
      }

      const title = await freeTitle(db, chefId, draft.title);
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
      await d1WriteBatch(db, statements);
      return { outcome: "created", recipeId, title, ...(title !== draft.title ? { renamedFrom: draft.title } : {}), warnings };
    },
    () => {
      throw new Error(`Moving in recipe ${draft.sourceKey} lost a race three times.`);
    },
  );
}
