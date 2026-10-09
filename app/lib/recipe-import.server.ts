/**
 * Recipe import orchestrator.
 *
 * Owns the full pipeline:
 *   1. Quota check (ImageGenLedger kind="import").
 *   2. Safe-fetch HTML.
 *   3. JSON-LD extract; if missing or partial, fall through / gap-fill via LLM.
 *   4. Existing-URL hint (per-chef, non-deleted).
 *   5. Dry-run shortcut.
 *   6. Title-collision retry (Unit 4d).
 *   7. Persist Recipe + RecipeStep + Ingredient rows.
 *   8. Schedule cover upload (Unit 4d).
 *
 * Cover scheduling and title-collision retry are extended in Unit 4d.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  fetchRecipeHtml,
  SafeFetchError,
  type SafeFetchCode,
} from "~/lib/recipe-import-fetch.server";
import {
  extractRecipeJsonLd,
  type JsonLdRecipeDraft,
} from "~/lib/recipe-import-jsonld.server";
import {
  createOpenAIRecipeLlmRunner,
  htmlToPlainText,
  RECIPE_LLM_PROVIDER,
  RecipeLlmError,
  type RecipeLlmEnv,
  type RecipeLlmRunner,
} from "~/lib/recipe-import-llm.server";
import {
  parseIngredients,
  type ParsedIngredient,
} from "~/lib/ingredient-parse.server";
import {
  captureLlmCallFailure,
  captureLlmCallSucceeded,
} from "~/lib/llm-telemetry.server";
import { tryConsumeImageGenQuota, type ImageGenBudgetEnv } from "~/lib/image-gen-ledger.server";
import { validateActiveRecipeTitleUnique } from "~/lib/recipe-title-uniqueness.server";
import { d1Binding } from "~/lib/d1-read.server";
import { d1WriteBatch, isD1GuardFailure } from "~/lib/d1-write.server";
import {
  activeRecipeTitleFreeGuard,
  ingredientInsertStatement,
  recipeInsertStatement,
  stepInsertStatement,
} from "~/lib/recipe-d1-writes.server";
import { createCover } from "~/lib/recipe-cover.server";
import { captureImageGenerationException } from "~/lib/image-gen-telemetry.server";
import {
  captureEvent,
  captureException,
  resolvePostHogServerConfig,
  type PostHogServerConfig,
  type PostHogServerEnv,
} from "~/lib/analytics-server";
import {
  generatePlaceholderImage,
  type ImageGenRunner,
} from "~/lib/image-gen.server";
import {
  detectImportSource,
  extractVideoRecipe,
  fetchOEmbedMetadata,
  OEmbedError,
  type OEmbedMetadata,
} from "~/lib/recipe-import-video.server";
import { fetchSafeImageBytes } from "~/lib/safe-image-fetch.server";
import { normalizeRecipeSourceUrl, recipeSourceUrlCandidates } from "~/lib/recipe-source-url.server";

type Database = PrismaClient | Prisma.TransactionClient;

export type ImportRecipeCode =
  | "bad-url"
  | "fetch-blocked"
  | "fetch-timeout"
  | "fetch-too-large"
  | "fetch-failed"
  | "not-html"
  | "no-content"
  | "llm-failed"
  | "rate-limited"
  | "title-conflict"
  | "oembed-failed"
  | "video-unavailable"
  | "bad-image";

export class ImportRecipeError extends Error {
  readonly code: ImportRecipeCode;
  readonly status: number;
  constructor(
    code: ImportRecipeCode,
    status: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ImportRecipeError";
    this.code = code;
    this.status = status;
  }
}

const SAFE_FETCH_TO_IMPORT: Record<
  SafeFetchCode,
  { code: ImportRecipeCode; status: number }
> = {
  "bad-scheme": { code: "bad-url", status: 400 },
  "blocked-host": { code: "fetch-blocked", status: 400 },
  timeout: { code: "fetch-timeout", status: 504 },
  "too-large": { code: "fetch-too-large", status: 413 },
  "non-2xx": { code: "fetch-failed", status: 502 },
  "not-html": { code: "not-html", status: 415 },
};

export interface ImportRecipeOptions {
  url: string;
  chefId: string;
  dryRun?: boolean;
  recipeId?: string;
}

export type NativeRecipeImportCapture =
  | { source: "camera"; assetIdentifier?: string | null }
  | { source: "photo-library"; assetIdentifier?: string | null };

export type NativeRecipeImportSource =
  | { type: "url"; url: string }
  | { type: "video-url"; url: string }
  | {
      type: "text";
      text: string;
      sourceUrl?: string | null;
      capture?: NativeRecipeImportCapture | null;
    }
  | { type: "json-ld"; jsonLd: unknown; sourceUrl?: string | null }
  | { type: "photo"; photo: Uint8Array; contentType: string };

/** Photo types the vision model reads. */
export const RECIPE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
/** The largest photo an import accepts: a phone camera's full-size JPEG fits well under it. */
export const RECIPE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export interface ImportRecipeFromSourceOptions {
  chefId: string;
  source: NativeRecipeImportSource;
  dryRun?: boolean;
  recipeId?: string;
}

export interface ImportRecipeDeps {
  db: PrismaClient;
  /** The Worker environment; with a D1 binding in `DB` the recipe is written as one atomic batch. */
  env?: (RecipeLlmEnv & PostHogServerEnv & ImageGenBudgetEnv & { DB?: unknown }) | null;
  bucket?: R2Bucket;
  waitUntil?: (promise: Promise<unknown>) => void;
  fetchImpl?: typeof fetch;
  llmRunner?: RecipeLlmRunner;
  createLlmRunner?: (env: RecipeLlmEnv) => RecipeLlmRunner;
  imageGenRunner?: ImageGenRunner;
  ingredientParser?: (
    text: string,
    env?: { OPENAI_API_KEY?: string } | null,
  ) => Promise<ParsedIngredient[]>;
  logger?: Pick<Console, "error">;
  now?: () => Date;
  /** PostHog distinct id for LLM-failure telemetry. Defaults to the chef id. */
  analyticsDistinctId?: string;
  /** Pre-resolved PostHog config; falls back to resolving from `env`. */
  postHogConfig?: PostHogServerConfig;
  /** fetch used for analytics posts; separate so app fetch can be mocked apart. */
  analyticsFetchImpl?: typeof fetch;
}

export type ImportRecipeConfidence = "high" | "medium" | "low";
export type ImportRecipeSource =
  | "json-ld"
  | "llm"
  | "mixed"
  | "video-oembed-llm";

export interface ImportRecipeDraftView {
  title: string;
  description: string | null;
  servings: string | null;
  ingredients: string[];
  steps: string[];
  imageUrl: string | null;
  sourceUrl: string | null;
}

export interface ImportRecipeResult {
  recipeId: string | null;
  recipe: unknown;
  confidence: ImportRecipeConfidence;
  source: ImportRecipeSource;
  existingRecipeId: string | null;
  coverPending: boolean;
}

const recipeInclude = {
  chef: { select: { id: true, email: true, username: true } },
  covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
  steps: {
    include: { ingredients: { include: { unit: true, ingredientRef: true } } },
  },
} satisfies Prisma.RecipeInclude;

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

async function getOrCreateUnit(db: Database, name: string) {
  const normalized = normalizeName(name);
  const existing = await db.unit.findUnique({ where: { name: normalized } });
  if (existing) return existing;
  return db.unit.create({ data: { name: normalized } });
}

async function getOrCreateIngredientRef(db: Database, name: string) {
  const normalized = normalizeName(name);
  const existing = await db.ingredientRef.findUnique({
    where: { name: normalized },
  });
  if (existing) return existing;
  return db.ingredientRef.create({ data: { name: normalized } });
}

function jsonLdPartial(draft: JsonLdRecipeDraft): boolean {
  return draft.ingredients.length === 0 || draft.steps.length === 0;
}

function mapSafeFetchError(err: SafeFetchError): ImportRecipeError {
  const mapped = SAFE_FETCH_TO_IMPORT[err.code];
  return new ImportRecipeError(mapped.code, mapped.status, err.message);
}

function mapOEmbedError(err: OEmbedError): ImportRecipeError {
  // Preserve the original OEmbedError (carrying upstreamStatus / network cause)
  // as `cause` so the discarded oEmbed failure detail survives onto the error
  // captured at the API boundary.
  return new ImportRecipeError(err.code, err.status, err.message, { cause: err });
}

function ensureNonblankText(value: string, field: string): string {
  if (value.trim() === "") {
    throw new ImportRecipeError("no-content", 422, `${field} must not be blank`);
  }
  return value;
}

function photoDataUrl(photo: Uint8Array, contentType: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < photo.length; i += chunk) {
    binary += String.fromCharCode(...photo.subarray(i, i + chunk));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

function ensureRecipePhoto(photo: Uint8Array, contentType: string): void {
  if (!(RECIPE_PHOTO_TYPES as readonly string[]).includes(contentType)) {
    throw new ImportRecipeError("bad-image", 415, `Unsupported photo type: ${contentType}`);
  }
  if (photo.length === 0 || photo.length > RECIPE_PHOTO_MAX_BYTES) {
    throw new ImportRecipeError("bad-image", 413, `Photo must be 1 to ${RECIPE_PHOTO_MAX_BYTES} bytes`);
  }
}

function getLlmRunner(deps: ImportRecipeDeps): RecipeLlmRunner | null {
  if (deps.llmRunner) return deps.llmRunner;
  const env = deps.env ?? {};
  if (!env.OPENAI_API_KEY?.trim()) return null;
  const createLlmRunner = deps.createLlmRunner ?? createOpenAIRecipeLlmRunner;
  return createLlmRunner(env);
}

/**
 * Capture a successful recipe-import LLM call to PostHog with privacy-safe
 * metadata only (operation/provider/model/durationMs — never the page text or
 * extracted recipe). Never throws — telemetry must not turn a successful
 * extraction into a failure.
 */
async function captureRecipeLlmSuccess(
  deps: ImportRecipeDeps,
  chefId: string,
  runner: RecipeLlmRunner,
  durationMs: number,
): Promise<void> {
  await captureLlmCallSucceeded({
    env: deps.env,
    postHogConfig: deps.postHogConfig,
    fetchImpl: deps.analyticsFetchImpl,
    distinctId: deps.analyticsDistinctId ?? chefId,
    operation: "recipe_import",
    provider: runner.provider ?? RECIPE_LLM_PROVIDER,
    model: runner.model ?? "unknown",
    durationMs,
  });
}

/**
 * Capture a recipe-import LLM-call failure to PostHog with the preserved OpenAI
 * error code/type/status. Never throws — telemetry must not mask the mapped
 * `ImportRecipeError` the caller re-throws.
 */
async function captureRecipeLlmFailure(
  deps: ImportRecipeDeps,
  chefId: string,
  runner: RecipeLlmRunner,
  error: RecipeLlmError,
): Promise<void> {
  await captureLlmCallFailure({
    env: deps.env,
    postHogConfig: deps.postHogConfig,
    fetchImpl: deps.analyticsFetchImpl,
    distinctId: deps.analyticsDistinctId ?? chefId,
    operation: "recipe_import",
    provider: runner.provider ?? RECIPE_LLM_PROVIDER,
    model: runner.model ?? "unknown",
    errorCode: error.code,
    errorType: error.type,
    errorStatus: error.status,
    errorMessage: error.message,
  });
}

/**
 * Emit a low-severity event when a page carried `application/ld+json` blocks
 * that ALL failed to parse, so no usable Recipe draft came back and the import
 * is about to fall through to the costly LLM path. Never throws — telemetry
 * must not affect the import.
 */
async function captureMalformedJsonLd(
  deps: ImportRecipeDeps,
  chefId: string,
  malformedBlocks: number,
  sourceUrl: string,
): Promise<void> {
  const config =
    deps.postHogConfig ?? resolvePostHogServerConfig(deps.env ?? {});
  // `sourceUrl` is the import URL, already validated by `new URL(url)` at the
  // top of `importRecipeFromUrl`, so parsing it again here cannot throw.
  await captureEvent(
    config,
    {
      event: "spoonjoy.recipe_import.jsonld_malformed",
      distinctId: deps.analyticsDistinctId ?? chefId,
      properties: {
        feature: "recipe_import",
        malformedBlocks,
        sourceHost: new URL(sourceUrl).hostname.toLowerCase(),
      },
    },
    deps.analyticsFetchImpl,
  );
}

interface ExtractionOutput {
  draft: ImportRecipeDraftView;
  source: ImportRecipeSource;
  confidence: ImportRecipeConfidence;
}

async function runExtraction(
  sourceUrl: string | null,
  html: string,
  ogImageUrl: string | null,
  chefId: string,
  deps: ImportRecipeDeps,
): Promise<ExtractionOutput> {
  const jsonLd = extractRecipeJsonLd(html);
  if (jsonLd.draft) {
    const draft = jsonLd.draft;
    if (!jsonLdPartial(draft)) {
      return {
        draft: {
          title: draft.title,
          description: draft.description,
          servings: draft.servings,
          ingredients: draft.ingredients,
          steps: draft.steps,
          imageUrl: draft.imageUrl ?? ogImageUrl,
          sourceUrl,
        },
        source: "json-ld",
        confidence: jsonLd.multipleRecipes ? "medium" : "high",
      };
    }
    // Partial JSON-LD → gap-fill via LLM
    const llm = await runLlm(html, chefId, deps);
    return {
      draft: {
        title: draft.title,
        description: draft.description ?? llm.description,
        servings: draft.servings ?? llm.servings,
        ingredients:
          draft.ingredients.length > 0 ? draft.ingredients : llm.ingredients,
        steps: draft.steps.length > 0 ? draft.steps : llm.steps,
        imageUrl: draft.imageUrl ?? ogImageUrl,
        sourceUrl,
      },
      source: "mixed",
      confidence: "medium",
    };
  }
  // No usable JSON-LD → full LLM. If structured data was present but every
  // block was malformed, surface that low-severity signal before the LLM spend.
  if (jsonLd.malformedBlocks > 0 && sourceUrl) {
    await captureMalformedJsonLd(deps, chefId, jsonLd.malformedBlocks, sourceUrl);
  }
  const llm = await runLlm(html, chefId, deps);
  if (!llm.title || !llm.title.trim()) {
    throw new ImportRecipeError(
      "no-content",
      422,
      "Could not extract a recipe from the page",
    );
  }
  return {
    draft: {
      title: llm.title,
      description: llm.description,
      servings: llm.servings,
      ingredients: llm.ingredients,
      steps: llm.steps,
      imageUrl: ogImageUrl,
      sourceUrl,
    },
    source: "llm",
    confidence: "low",
  };
}

async function runLlm(
  html: string,
  chefId: string,
  deps: ImportRecipeDeps,
): Promise<{
  title: string;
  description: string | null;
  servings: string | null;
  ingredients: string[];
  steps: string[];
}> {
  const llmRunner = getLlmRunner(deps);
  if (!llmRunner) {
    throw new ImportRecipeError(
      "llm-failed",
      502,
      "LLM runner is not configured",
    );
  }
  const text = htmlToPlainText(html);
  const startedAt = Date.now();
  try {
    const extracted = await llmRunner.extract(text);
    await captureRecipeLlmSuccess(deps, chefId, llmRunner, Date.now() - startedAt);
    return extracted;
  } catch (err) {
    if (err instanceof RecipeLlmError) {
      await captureRecipeLlmFailure(deps, chefId, llmRunner, err);
      throw new ImportRecipeError("llm-failed", 502, err.message);
    }
    throw err;
  }
}

async function runTextExtraction(
  text: string,
  sourceUrl: string | null,
  chefId: string,
  deps: ImportRecipeDeps,
): Promise<ExtractionOutput> {
  const llmRunner = getLlmRunner(deps);
  if (!llmRunner) {
    throw new ImportRecipeError(
      "llm-failed",
      502,
      "LLM runner is not configured",
    );
  }
  let extracted: {
    title: string;
    description: string | null;
    servings: string | null;
    ingredients: string[];
    steps: string[];
  };
  const startedAt = Date.now();
  try {
    extracted = await llmRunner.extract(text);
  } catch (err) {
    if (err instanceof RecipeLlmError) {
      await captureRecipeLlmFailure(deps, chefId, llmRunner, err);
      throw new ImportRecipeError("llm-failed", 502, err.message);
    }
    throw err;
  }
  await captureRecipeLlmSuccess(deps, chefId, llmRunner, Date.now() - startedAt);
  if (!extracted.title || !extracted.title.trim()) {
    throw new ImportRecipeError(
      "no-content",
      422,
      "Could not extract a recipe from the captured text",
    );
  }
  return {
    draft: {
      title: extracted.title,
      description: extracted.description,
      servings: extracted.servings,
      ingredients: extracted.ingredients,
      steps: extracted.steps,
      imageUrl: null,
      sourceUrl,
    },
    source: "llm",
    confidence: "low",
  };
}

async function runPhotoExtraction(
  photo: Uint8Array,
  contentType: string,
  chefId: string,
  deps: ImportRecipeDeps,
): Promise<ExtractionOutput> {
  const llmRunner = getLlmRunner(deps);
  if (!llmRunner?.extractFromPhoto) {
    throw new ImportRecipeError("llm-failed", 502, "Photo reading is not configured");
  }
  let extracted;
  const startedAt = Date.now();
  try {
    extracted = await llmRunner.extractFromPhoto({ dataUrl: photoDataUrl(photo, contentType) });
  } catch (err) {
    if (err instanceof RecipeLlmError) {
      await captureRecipeLlmFailure(deps, chefId, llmRunner, err);
      throw new ImportRecipeError("llm-failed", 502, err.message);
    }
    throw err;
  }
  await captureRecipeLlmSuccess(deps, chefId, llmRunner, Date.now() - startedAt);
  if (!extracted.title.trim()) {
    throw new ImportRecipeError("no-content", 422, "Could not read a recipe in the photo");
  }
  return {
    draft: {
      title: extracted.title,
      description: extracted.description,
      servings: extracted.servings,
      ingredients: extracted.ingredients,
      steps: extracted.steps,
      imageUrl: null,
      sourceUrl: null,
    },
    source: "llm",
    confidence: "low",
  };
}

function jsonLdHtml(jsonLd: unknown): string {
  return `<html><head><script type="application/ld+json">${
    JSON.stringify(jsonLd).replace(/</g, "\\u003c")
  }</script></head><body></body></html>`;
}

async function runVideoExtraction(
  parsedUrl: URL,
  sourceKind: "youtube" | "tiktok",
  chefId: string,
  deps: ImportRecipeDeps,
): Promise<ExtractionOutput> {
  const llmRunner = getLlmRunner(deps);
  if (!llmRunner) {
    throw new ImportRecipeError(
      "llm-failed",
      502,
      "LLM runner is not configured",
    );
  }
  let metadata: OEmbedMetadata;
  try {
    metadata = await fetchOEmbedMetadata(parsedUrl.toString(), sourceKind, {
      fetchImpl: deps.fetchImpl,
    });
  } catch (err) {
    // fetchOEmbedMetadata only throws OEmbedError (it wraps every internal
    // failure mode itself), so the cast is safe.
    throw mapOEmbedError(err as OEmbedError);
  }
  let extracted;
  const startedAt = Date.now();
  try {
    extracted = await extractVideoRecipe(metadata, {
      llmRunner,
    });
  } catch (err) {
    if (err instanceof RecipeLlmError) {
      await captureRecipeLlmFailure(deps, chefId, llmRunner, err);
      throw new ImportRecipeError("llm-failed", 502, err.message);
    }
    throw err;
  }
  await captureRecipeLlmSuccess(deps, chefId, llmRunner, Date.now() - startedAt);
  if (!extracted.title || !extracted.title.trim()) {
    throw new ImportRecipeError(
      "no-content",
      422,
      "Could not extract a recipe from the video metadata",
    );
  }
  return {
    draft: {
      title: extracted.title,
      description: extracted.description,
      servings: extracted.servings,
      ingredients: extracted.ingredients,
      steps: extracted.steps,
      imageUrl: metadata.thumbnailUrl,
      sourceUrl: parsedUrl.toString(),
    },
    source: "video-oembed-llm",
    confidence: "low",
  };
}

async function findExistingRecipeId(
  db: PrismaClient,
  chefId: string,
  sourceUrl: string | null,
): Promise<string | null> {
  const candidates = recipeSourceUrlCandidates(sourceUrl);
  if (candidates.length === 0) return null;
  const existing = await db.recipe.findFirst({
    where: { chefId, sourceUrl: { in: candidates }, deletedAt: null },
    select: { id: true },
  });
  return existing?.id ?? null;
}

// Every import spends one unit, dry runs included: a dry run still runs the extraction model,
// so it counts against the chef's daily import cap and the global AI budget like a real import.
async function consumeImportQuota(
  deps: ImportRecipeDeps,
  chefId: string,
  kind: "import" | "import-photo" = "import",
): Promise<void> {
  const ok = await tryConsumeImageGenQuota(deps.db, chefId, kind, {
    now: deps.now,
    d1: d1Binding(deps.env?.DB),
    env: deps.env,
  });
  if (!ok) {
    throw new ImportRecipeError(
      "rate-limited",
      429,
      "Daily import quota exhausted",
    );
  }
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

async function resolveTitleWithRetry(
  db: PrismaClient,
  chefId: string,
  baseTitle: string,
  now: () => Date,
): Promise<string> {
  const trimmed = baseTitle.trim();
  const attempts = [
    trimmed,
    `${trimmed} (imported)`,
    (() => {
      const d = now();
      return `${trimmed} (imported ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())})`;
    })(),
  ];
  for (const candidate of attempts) {
    const result = await validateActiveRecipeTitleUnique(db, {
      chefId,
      title: candidate,
    });
    if (result.valid) return candidate;
  }
  throw new ImportRecipeError(
    "title-conflict",
    409,
    "Title already in use after retry suffixes",
  );
}

// On D1 the import re-checks its title as it writes; a recipe that takes the title in
// between sends it back to pick the next free one, this many times at most.
const D1_TITLE_RACE_ATTEMPTS = 3;

function ingredientWordForms(word: string): string[] {
  if (word.endsWith("ies")) return [word, `${word.slice(0, -3)}y`];
  if (word.endsWith("es")) return [word, word.slice(0, -2), word.slice(0, -1)];
  if (word.endsWith("s")) return [word, word.slice(0, -1)];
  return [word, `${word}s`, `${word}es`];
}

// The phrase is already lower-case letters, hyphens and single spaces, so it is safe to
// place in a pattern as it is.
function mentions(stepText: string, phrase: string): boolean {
  const words = phrase.split(" ");
  const last = words.pop() as string;
  const head = words.map((word) => `${word}\\s+`).join("");
  return ingredientWordForms(last).some((form) =>
    new RegExp(`(^|[^a-z])${head}${form}([^a-z]|$)`).test(stepText));
}

/**
 * The step an imported ingredient belongs on: the first step whose text names it, by its
 * full name, its last two words or (when longer than three letters) its last word, allowing
 * a plural. Ingredients no step names stay on step 1.
 */
export function stepForIngredient(ingredientName: string, steps: string[]): number {
  const name = ingredientName.split(",")[0].toLowerCase().replace(/[^a-z\s-]/g, " ").trim().replace(/\s+/g, " ");
  if (!name) return 1;
  const words = name.split(" ");
  const phrases = [name];
  if (words.length > 2) phrases.push(words.slice(-2).join(" "));
  const lastWord = words[words.length - 1];
  if (words.length > 1 && lastWord.length > 3) phrases.push(lastWord);
  for (const phrase of phrases) {
    const index = steps.findIndex((step) => mentions(step.toLowerCase(), phrase));
    if (index >= 0) return index + 1;
  }
  return 1;
}

async function persistRecipe(
  db: PrismaClient,
  chefId: string,
  draft: ImportRecipeDraftView,
  ingredientParser: NonNullable<ImportRecipeDeps["ingredientParser"]>,
  env: ImportRecipeDeps["env"],
  now: () => Date,
  recipeId?: string,
): Promise<{ id: string; recipe: unknown; title: string }> {
  let title = await resolveTitleWithRetry(db, chefId, draft.title, now);

  // Parse every ingredient line in one call, outside the transaction.
  const allIngredients = draft.ingredients.length === 0
    ? []
    : await ingredientParser(
      draft.ingredients.map((line) => line.replace(/\s*\n\s*/g, " ")).join("\n"),
      env,
    );

  const id = recipeId ?? `recipe_import_${crypto.randomUUID()}`;
  const ingredientRows = [];
  for (const ingredient of allIngredients) {
    const unit = await getOrCreateUnit(db, ingredient.unit);
    const ref = await getOrCreateIngredientRef(db, ingredient.ingredientName);
    ingredientRows.push({
      recipeId: id,
      stepNum: stepForIngredient(ingredient.ingredientName, draft.steps),
      quantity: ingredient.quantity,
      unitId: unit.id,
      ingredientRefId: ref.id,
    });
  }

  const d1 = d1Binding(env?.DB);
  if (d1) {
    // One atomic batch: the recipe, its steps and its ingredients apply together, and the
    // title is re-checked as they are written.
    for (let attempt = 1; ; attempt++) {
      const at = now();
      try {
        await d1WriteBatch(d1, [
          activeRecipeTitleFreeGuard(chefId, title),
          recipeInsertStatement({
            id,
            title,
            description: draft.description,
            servings: draft.servings,
            sourceUrl: draft.sourceUrl,
            chefId,
            now: at,
          }),
          ...draft.steps.map((step, index) => stepInsertStatement({
            recipeId: id,
            stepNum: index + 1,
            stepTitle: null,
            description: step,
            duration: null,
            now: at,
          })),
          ...ingredientRows.map((ingredient) => ingredientInsertStatement({ ...ingredient, now: at })),
        ]);
        break;
      } catch (error) {
        if (!isD1GuardFailure(error)) throw error;
        if (attempt === D1_TITLE_RACE_ATTEMPTS) {
          throw new ImportRecipeError("title-conflict", 409, "Title already in use after retry suffixes");
        }
        title = await resolveTitleWithRetry(db, chefId, draft.title, now);
      }
    }
  } else {
    await db.$transaction([
      db.recipe.create({
        data: {
          id,
          title,
          description: draft.description,
          servings: draft.servings,
          sourceUrl: draft.sourceUrl,
          chefId,
        },
      }),
      ...draft.steps.map((step, index) => db.recipeStep.create({
        data: {
          recipeId: id,
          stepNum: index + 1,
          description: step,
        },
      })),
      ...ingredientRows.map((ingredient) => db.ingredient.create({ data: ingredient })),
    ]);
  }

  const full = await db.recipe.findUniqueOrThrow({
    where: { id },
    include: recipeInclude,
  });
  return { id, recipe: full, title };
}

async function uploadImportCover(
  db: PrismaClient,
  bucket: R2Bucket,
  fetchImpl: typeof fetch,
  recipeId: string,
  chefId: string,
  coverSourceUrl: string,
  logger: Pick<Console, "error">,
  now: () => Date,
  postHogConfig: PostHogServerConfig,
  analyticsFetchImpl?: typeof fetch,
): Promise<void> {
  try {
    const { bytes, contentType, extension } = await fetchSafeImageBytes(coverSourceUrl, { fetchImpl });
    const stamp = now().getTime();
    const key = `covers/import/${stamp}-${crypto.randomUUID()}.${extension}`;
    await bucket.put(key, bytes, {
      httpMetadata: { contentType },
    });
    await createCover(db, {
      recipeId,
      imageUrl: `/photos/${key}`,
      sourceType: "import",
      status: "ready",
      createdById: chefId,
      sourceImageUrl: coverSourceUrl,
      generationStatus: "none",
    }).then((cover) => activateImportedCoverIfStillAutomatic(db, recipeId, cover.id));
  } catch (err) {
    // The cover silently never appears. Keep the log, but also capture so the
    // failure is observable. This path downloads an existing image (not image
    // generation), so it uses the generic exception capture rather than the
    // image-generation telemetry helper.
    logger.error("recipe-import cover upload failed", err);
    await captureImportCoverException(
      postHogConfig,
      err,
      { recipeId, chefId, coverSourceType: "import", phase: "uploadImportCover" },
      analyticsFetchImpl,
    );
  }
}

/** Capture a silent import-cover (image download) failure. Never throws. */
async function captureImportCoverException(
  config: PostHogServerConfig,
  error: unknown,
  extras: {
    recipeId: string;
    chefId: string;
    coverSourceType: string;
    phase: string;
  },
  fetchImpl?: typeof fetch,
): Promise<void> {
  await captureException(
    config,
    {
      error,
      distinctId: extras.chefId,
      extras: {
        feature: "recipe_import_cover",
        recipeId: extras.recipeId,
        sourceType: extras.coverSourceType,
        phase: extras.phase,
      },
    },
    fetchImpl,
  );
}

const OPENAI_IMPORT_PLACEHOLDER_MODEL = "gpt-image-1";

async function uploadPlaceholderCover(
  db: PrismaClient,
  recipeId: string,
  chefId: string,
  title: string,
  description: string | null,
  deps: {
    env: { OPENAI_API_KEY?: string };
    runner: ImageGenRunner;
    bucket: R2Bucket;
    fetchImpl: typeof fetch;
    logger: Pick<Console, "error">;
    postHogConfig: PostHogServerConfig;
    analyticsFetchImpl?: typeof fetch;
  },
): Promise<void> {
  try {
    const imageUrl = await generatePlaceholderImage(title, description, {
      env: deps.env,
      runner: deps.runner,
      bucket: deps.bucket,
      fetchImpl: deps.fetchImpl,
    });
    await createCover(db, {
      recipeId,
      imageUrl,
      sourceType: "ai-placeholder",
      status: "ready",
      createdById: chefId,
      generationStatus: "succeeded",
    }).then((cover) => activateImportedCoverIfStillAutomatic(db, recipeId, cover.id));
  } catch (err) {
    // The AI placeholder cover silently never appears. Keep the log and also
    // capture via the image-generation telemetry helper (mirrors
    // ai-placeholder-cover.server.ts). No cover row exists yet on this path,
    // so coverId is reported as "none".
    deps.logger.error("recipe-import placeholder cover failed", err);
    await captureImageGenerationException({
      postHogConfig: deps.postHogConfig,
      fetchImpl: deps.analyticsFetchImpl,
      userId: chefId,
      recipeId,
      coverId: "none",
      operation: "placeholder_generate",
      sourceType: "ai-placeholder",
      quotaKind: "placeholder",
      model: OPENAI_IMPORT_PLACEHOLDER_MODEL,
      error: err,
    });
  }
}

async function activateImportedCoverIfStillAutomatic(
  db: PrismaClient,
  recipeId: string,
  coverId: string,
): Promise<void> {
  await db.recipe.updateMany({
    where: {
      id: recipeId,
      coverMode: "auto",
      activeCoverId: null,
    },
    data: {
      activeCoverId: coverId,
      activeCoverVariant: "image",
      coverMode: "auto",
    },
  });
}

async function completeImportFromExtraction(input: {
  chefId: string;
  sourceUrl: string | null;
  dryRun: boolean;
  recipeId?: string;
  extraction: ExtractionOutput;
  deps: ImportRecipeDeps;
}): Promise<ImportRecipeResult> {
  const { chefId, dryRun, recipeId, deps } = input;
  // One stored form per link, so every writer's duplicate check sees every other writer's recipes.
  const extraction: ExtractionOutput = {
    ...input.extraction,
    draft: { ...input.extraction.draft, sourceUrl: normalizeRecipeSourceUrl(input.extraction.draft.sourceUrl) },
  };
  const existingRecipeId = await findExistingRecipeId(deps.db, chefId, input.sourceUrl);

  if (dryRun) {
    return {
      recipeId: null,
      recipe: extraction.draft,
      confidence: extraction.confidence,
      source: extraction.source,
      existingRecipeId,
      coverPending: false,
    };
  }

  const ingredientParser: NonNullable<ImportRecipeDeps["ingredientParser"]> =
    deps.ingredientParser ??
    ((text, env) =>
      parseIngredients(text, env ?? undefined, {
        postHogConfig: deps.postHogConfig,
        fetchImpl: deps.analyticsFetchImpl,
        distinctId: deps.analyticsDistinctId ?? chefId,
      }));
  const persisted = await persistRecipe(
    deps.db,
    chefId,
    extraction.draft,
    ingredientParser,
    deps.env,
    deps.now ?? (() => new Date()),
    recipeId,
  );

  const coverPending = await scheduleCover({
    db: deps.db,
    bucket: deps.bucket,
    waitUntil: deps.waitUntil,
    fetchImpl: deps.fetchImpl ?? fetch,
    imageGenRunner: deps.imageGenRunner,
    env: deps.env ?? {},
    logger: deps.logger ?? console,
    now: deps.now ?? (() => new Date()),
    recipeId: persisted.id,
    chefId,
    title: persisted.title,
    description: extraction.draft.description,
    coverSourceUrl: extraction.draft.imageUrl,
  });

  return {
    recipeId: persisted.id,
    recipe: persisted.recipe,
    confidence: extraction.confidence,
    source: extraction.source,
    existingRecipeId,
    coverPending,
  };
}

export async function importRecipeFromUrl(
  options: ImportRecipeOptions,
  deps: ImportRecipeDeps,
): Promise<ImportRecipeResult> {
  const { url, chefId, dryRun = false, recipeId } = options;

  // 0. Parse URL up front so malformed URLs fail BEFORE quota consume.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new ImportRecipeError("bad-url", 400, `Cannot parse URL: ${url}`);
  }
  const sourceKind = detectImportSource(parsedUrl);

  // 1. Quota, dry runs included.
  await consumeImportQuota(deps, chefId);

  // 2. Fetch + extract — web vs. video pipeline by hostname.
  let extraction: ExtractionOutput;
  if (sourceKind === "web") {
    let fetched;
    try {
      fetched = await fetchRecipeHtml(url, { fetchImpl: deps.fetchImpl });
    } catch (err) {
      if (err instanceof SafeFetchError) {
        throw mapSafeFetchError(err);
      }
      throw err;
    }
    extraction = await runExtraction(
      url,
      fetched.html,
      fetched.ogImageUrl,
      chefId,
      deps,
    );
  } else {
    extraction = await runVideoExtraction(parsedUrl, sourceKind, chefId, deps);
  }

  return completeImportFromExtraction({
    chefId,
    sourceUrl: url,
    dryRun,
    recipeId,
    extraction,
    deps,
  });
}

export async function importRecipeFromSource(
  options: ImportRecipeFromSourceOptions,
  deps: ImportRecipeDeps,
): Promise<ImportRecipeResult> {
  const { chefId, dryRun = false, recipeId } = options;
  switch (options.source.type) {
    case "url":
    case "video-url":
      return importRecipeFromUrl({ url: options.source.url, chefId, dryRun, recipeId }, deps);
    case "text": {
      const text = ensureNonblankText(options.source.text, "source.text");
      await consumeImportQuota(deps, chefId);
      const sourceUrl = options.source.sourceUrl ?? null;
      const extraction = await runTextExtraction(text, sourceUrl, chefId, deps);
      return completeImportFromExtraction({
        chefId,
        sourceUrl,
        dryRun,
        recipeId,
        extraction,
        deps,
      });
    }
    case "photo": {
      // Validate before spending quota, so a wrong file costs nothing.
      ensureRecipePhoto(options.source.photo, options.source.contentType);
      // A dry run still makes the vision call, so it spends a photo import too.
      await consumeImportQuota(deps, chefId, "import-photo");
      const extraction = await runPhotoExtraction(
        options.source.photo,
        options.source.contentType,
        chefId,
        deps,
      );
      return completeImportFromExtraction({
        chefId,
        sourceUrl: null,
        dryRun,
        recipeId,
        extraction,
        deps,
      });
    }
    case "json-ld": {
      await consumeImportQuota(deps, chefId);
      const sourceUrl = options.source.sourceUrl ?? null;
      const extraction = await runExtraction(
        sourceUrl,
        jsonLdHtml(options.source.jsonLd),
        null,
        chefId,
        deps,
      );
      return completeImportFromExtraction({
        chefId,
        sourceUrl,
        dryRun,
        recipeId,
        extraction,
        deps,
      });
    }
  }
}

interface ScheduleCoverArgs {
  db: PrismaClient;
  bucket: R2Bucket | undefined;
  waitUntil: ((p: Promise<unknown>) => void) | undefined;
  fetchImpl: typeof fetch;
  imageGenRunner: ImageGenRunner | undefined;
  env: { OPENAI_API_KEY?: string } & PostHogServerEnv;
  logger: Pick<Console, "error">;
  now: () => Date;
  recipeId: string;
  chefId: string;
  title: string;
  description: string | null;
  coverSourceUrl: string | null;
}

async function scheduleCover(args: ScheduleCoverArgs): Promise<boolean> {
  const { bucket } = args;
  if (!bucket) return false;
  const postHogConfig = resolvePostHogServerConfig(args.env);
  let task: Promise<void> | null = null;
  if (args.coverSourceUrl) {
    task = uploadImportCover(
      args.db,
      bucket,
      args.fetchImpl,
      args.recipeId,
      args.chefId,
      args.coverSourceUrl,
      args.logger,
      args.now,
      postHogConfig,
      args.fetchImpl,
    );
  } else if (args.imageGenRunner) {
    task = uploadPlaceholderCover(args.db, args.recipeId, args.chefId, args.title, args.description, {
      env: args.env,
      runner: args.imageGenRunner,
      bucket,
      fetchImpl: args.fetchImpl,
      logger: args.logger,
      postHogConfig,
      analyticsFetchImpl: args.fetchImpl,
    });
  }
  if (!task) return false;
  if (args.waitUntil) {
    args.waitUntil(task);
  } else {
    await task;
  }
  return true;
}
