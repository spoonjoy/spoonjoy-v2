// Writes one moved-in recipe into the kitchen: the recipe, its steps, its ingredients on the steps
// that use them, and its SourceRecord, all in one D1 batch, so a crash never leaves a recipe the
// next run would not recognise. A recipe that already moved in is left alone, and so is one the
// person deleted after it arrived.
import { d1ReadBatch, type D1Query, type D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Guard, d1WriteBatch, retryOnD1GuardFailure } from "~/lib/d1-write.server";
import { parseIngredientLine, WHOLE_UNIT } from "~/lib/ingredient-text-parser";
import {
  activeRecipeTitleFreeGuard,
  nameUpsertStatements,
  namedIngredientInsertStatement,
  recipeInsertStatement,
  stepInsertStatement,
} from "~/lib/recipe-d1-writes.server";
import { stepForIngredient } from "~/lib/recipe-import.server";
import type { IngredientDraft, RecipeDraft } from "../../model/recipe-draft";

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
  | { outcome: "created"; recipeId: string; title: string; warnings: string[] }
  | { outcome: "unchanged"; recipeId: string; jobId: string }
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

async function freeTitle(db: D1ReadDatabase, chefId: string, title: string): Promise<string> {
  const [rows] = await d1ReadBatch(db, [[
    `SELECT "title" FROM "Recipe" WHERE "chefId" = ? AND "deletedAt" IS NULL AND ("title" = ? OR "title" LIKE ?)`,
    chefId,
    title,
    `${title} (%)`,
  ]]);
  const taken = new Set(rows.map((row) => String(row.title)));
  if (!taken.has(title)) return title;
  let n = 2;
  while (taken.has(`${title} (${n})`)) n += 1;
  return `${title} (${n})`;
}

async function existing(db: D1ReadDatabase, sourceId: string, sourceKey: string): Promise<WriteMovedInRecipeResult | null> {
  const [[record]] = await d1ReadBatch(db, [[
    `SELECT "SourceRecord"."targetId" AS "recipeId", "SourceRecord"."lastJobId" AS "jobId", "Recipe"."id" AS "liveId" FROM "SourceRecord"
     LEFT JOIN "Recipe" ON "Recipe"."id" = "SourceRecord"."targetId" AND "Recipe"."deletedAt" IS NULL
     WHERE "SourceRecord"."sourceId" = ? AND "SourceRecord"."sourceTable" = ? AND "SourceRecord"."sourceKey" = ?`,
    sourceId,
    RECIPE_TABLE,
    sourceKey,
  ]]);
  if (!record) return null;
  const recipeId = String(record.recipeId);
  return record.liveId
    ? { outcome: "unchanged", recipeId, jobId: String(record.jobId) }
    : { outcome: "skipped", recipeId, reason: "You deleted this recipe in Spoonjoy after it moved in." };
}

export async function writeMovedInRecipe(input: WriteMovedInRecipeInput): Promise<WriteMovedInRecipeResult> {
  const { db, sourceId, jobId, chefId, draft, now } = input;
  return retryOnD1GuardFailure(
    async () => {
      const found = await existing(db, sourceId, draft.sourceKey);
      if (found) return found;
      const warnings = [...draft.warnings];
      const title = await freeTitle(db, chefId, draft.title);
      if (title !== draft.title) warnings.push(`You already had a recipe called "${draft.title}", so this one is "${title}".`);

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

      const recipeId = `recipe_movein_${crypto.randomUUID()}`;
      const statements: D1Query[] = [
        d1Guard(
          `NOT EXISTS (SELECT 1 FROM "SourceRecord" WHERE "sourceId" = ? AND "sourceTable" = ? AND "sourceKey" = ?)`,
          sourceId,
          RECIPE_TABLE,
          draft.sourceKey,
        ),
        activeRecipeTitleFreeGuard(chefId, title),
        recipeInsertStatement({ id: recipeId, title, description: description(draft), servings: draft.servings, sourceUrl: draft.sourceUrl, chefId, now }),
        ...steps.map((step, index) =>
          stepInsertStatement({ recipeId, stepNum: index + 1, stepTitle: step.title, description: step.text, duration: null, now })),
        ...nameUpsertStatements(ingredients, now),
        ...ingredients.map((ingredient) => namedIngredientInsertStatement({ recipeId, now, ...ingredient })),
        [
          `INSERT INTO "SourceRecord" ("id", "sourceId", "sourceTable", "sourceKey", "targetType", "targetId", "sourceUpdatedAt", "lastJobId")
           VALUES (?, ?, ?, ?, 'Recipe', ?, ?, ?)`,
          crypto.randomUUID(),
          sourceId,
          RECIPE_TABLE,
          draft.sourceKey,
          recipeId,
          draft.sourceUpdatedAt,
          jobId,
        ],
      ];
      await d1WriteBatch(db, statements);
      return { outcome: "created", recipeId, title, warnings };
    },
    () => {
      throw new Error(`Moving in recipe ${draft.sourceKey} lost a race three times.`);
    },
  );
}
