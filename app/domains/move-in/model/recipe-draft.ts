// A recipe as a source adapter hands it to move-in: the other app's recipe in Spoonjoy's words,
// with the source keys that make a second move-in find it again. Nothing here is written yet.

export interface IngredientDraft {
  sourceKey: string;
  /** The section heading this ingredient starts, if any. */
  section: string | null;
  /** The amount; null when the source had none (or 0, which means none). */
  quantity: number | null;
  unit: string | null;
  food: string | null;
  note: string | null;
  /** The line as the source first saw it, before any parsing. */
  originalText: string | null;
  /** True when the source holds only text (no food), so Spoonjoy reads the line itself. */
  plainText: boolean;
}

export interface StepDraft {
  sourceKey: string;
  title: string | null;
  text: string;
  /** The ingredients the source links to this step, by their source keys. */
  ingredientKeys: string[];
}

export interface RecipeDraft {
  sourceKey: string;
  /** The source user who owns the recipe. */
  ownerKey: string | null;
  /** When the source last changed the recipe; a re-run rewrites a recipe only when this moved on. */
  sourceUpdatedAt: string | null;
  title: string;
  description: string | null;
  servings: string | null;
  sourceUrl: string | null;
  /** Where the recipe's photo would sit in the source archive, relative to its root. */
  photoPath: string;
  steps: StepDraft[];
  ingredients: IngredientDraft[];
  notes: Array<{ title: string | null; text: string }>;
  tags: string[];
  categories: string[];
  tools: string[];
  /** Plain-language notes for the move-in report about what could not come across as it was. */
  warnings: string[];
}

export const UNTITLED_RECIPE = "Untitled recipe";
