import { d1Binding, type D1Query, type D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";
import type { PrismaClient } from "@prisma/client";
import {
  createGeminiImageRunner,
  createOpenAIImageRunner,
  DEFAULT_GEMINI_IMAGE_MODEL,
  DEFAULT_GEMINI_IMAGE_TIMEOUT_MS,
  generatePlaceholderImage,
  sanitizeImagePromptAddition,
  type ImageGenEnv,
  type ImageGenRunner,
} from "~/lib/image-gen.server";
import { tryConsumeImageGenQuota } from "~/lib/image-gen-ledger.server";
import {
  captureImageGenerationException,
  captureImageGenerationSkipped,
  type ImageGenerationSkipReason,
} from "~/lib/image-gen-telemetry.server";
import { createOpenAIClient } from "~/lib/openai-client.server";
import type { PostHogServerConfig, PostHogServerEnv } from "~/lib/analytics-server";
import { touchNativeSyncCookbooksForRecipeOperation } from "~/lib/native-sync-invalidation.server";

const OPENAI_PLACEHOLDER_MODEL = "dall-e-3";

type ImageGenerationSchedulerEnv = ImageGenEnv & PostHogServerEnv & { DB?: unknown };
type ImageGenRunnerFactory = (env: ImageGenerationSchedulerEnv) => ImageGenRunner | null;
type PlaceholderProvider = "openai" | "gemini";
interface ResolvedPlaceholderRunner {
  runner: ImageGenRunner;
  model: string;
  provider: PlaceholderProvider;
}

export interface SchedulePlaceholderInput {
  db: PrismaClient;
  userId: string;
  recipeId: string;
  coverId: string;
  title: string;
  description: string | null;
  promptAddition?: string | null;
  env?: ImageGenerationSchedulerEnv | null;
  bucket?: R2Bucket;
  runner?: ImageGenRunner;
  createRunner?: ImageGenRunnerFactory;
  fetchImpl?: typeof fetch;
  postHogConfig?: PostHogServerConfig;
  analyticsFetchImpl?: typeof fetch;
  now?: () => number;
  logger?: Pick<Console, "error">;
  activateWhenReady?: boolean;
  suppressAutoActivation?: boolean;
  activationGuard?: {
    activeCoverId: string | null;
    activeCoverVariant: string | null;
    coverMode: string;
  };
}

function trimmed(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value: string | undefined): number | null {
  const normalized = trimmed(value);
  if (normalized === "") return null;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeProvider(value: string): PlaceholderProvider | null {
  const normalized = value.trim().toLowerCase();
  return normalized === "openai" || normalized === "gemini" ? normalized : null;
}

function resolvePlaceholderProviderOrder(env: ImageGenerationSchedulerEnv): PlaceholderProvider[] {
  const configured = [
    trimmed(env.IMAGE_PROVIDER_PRIMARY),
    ...trimmed(env.IMAGE_PROVIDER_FALLBACKS).split(","),
  ].map((value) => value.trim()).filter(Boolean);
  const rawOrder = configured.length > 0 ? configured : ["openai", "gemini"];
  const order: PlaceholderProvider[] = [];
  for (const item of rawOrder) {
    const provider = normalizeProvider(item);
    if (provider && !order.includes(provider)) order.push(provider);
  }
  return order;
}

function createDefaultRunner(
  env: ImageGenerationSchedulerEnv,
  fetchImpl?: typeof fetch,
): ResolvedPlaceholderRunner | null {
  for (const provider of resolvePlaceholderProviderOrder(env)) {
    if (provider === "openai") {
      const apiKey = trimmed(env.OPENAI_API_KEY);
      if (!apiKey) continue;
      const client = createOpenAIClient({ apiKey });
      return {
        provider,
        model: OPENAI_PLACEHOLDER_MODEL,
        runner: createOpenAIImageRunner(client as never),
      };
    }
    const apiKey = trimmed(env.GEMINI_API_KEY) || trimmed(env.GOOGLE_API_KEY);
    if (!apiKey) continue;
    return {
      provider,
      model: trimmed(env.GEMINI_IMAGE_MODEL) || DEFAULT_GEMINI_IMAGE_MODEL,
      runner: createGeminiImageRunner({
        apiKey,
        fetchImpl,
        timeoutMs: positiveInteger(env.GEMINI_IMAGE_TIMEOUT_MS) ?? DEFAULT_GEMINI_IMAGE_TIMEOUT_MS,
      }),
    };
  }
  return null;
}

function resolveRunner(
  input: SchedulePlaceholderInput,
): ResolvedPlaceholderRunner | { reason: ImageGenerationSkipReason } {
  if (input.runner) {
    return {
      runner: input.runner,
      model: OPENAI_PLACEHOLDER_MODEL,
      provider: "openai",
    };
  }
  if (!input.env) return { reason: "missing_image_provider_config" };

  if (input.createRunner) {
    const runner = input.createRunner(input.env);
    return runner
      ? { runner, model: OPENAI_PLACEHOLDER_MODEL, provider: "openai" }
      : { reason: "missing_runner" };
  }

  const runner = createDefaultRunner(input.env, input.fetchImpl);
  return runner ?? { reason: "missing_image_provider_config" };
}

async function captureSkipped(
  input: SchedulePlaceholderInput,
  reason: ImageGenerationSkipReason,
): Promise<void> {
  await captureImageGenerationSkipped({
    env: input.env,
    postHogConfig: input.postHogConfig,
    fetchImpl: input.analyticsFetchImpl,
    userId: input.userId,
    recipeId: input.recipeId,
    coverId: input.coverId,
    operation: "placeholder_generate",
    sourceType: "ai-placeholder",
    quotaKind: "placeholder",
    model: "none",
    reason,
  });
}

async function captureGenerationException(
  input: SchedulePlaceholderInput,
  error: unknown,
  model: string,
): Promise<void> {
  await captureImageGenerationException({
    env: input.env,
    postHogConfig: input.postHogConfig,
    fetchImpl: input.analyticsFetchImpl,
    userId: input.userId,
    recipeId: input.recipeId,
    coverId: input.coverId,
    operation: "placeholder_generate",
    sourceType: "ai-placeholder",
    quotaKind: "placeholder",
    model,
    error,
  });
}

// A placeholder the chef archived while it was generating stays archived: finishing or failing
// never rewrites its status (which would bring it back), and it is never made the recipe's cover.
function unarchivedCover(coverId: string) {
  return { id: coverId, status: { not: "archived" }, archivedAt: null };
}

// The same condition in SQL, for the D1 writes: this recipe's cover, not archived.
const UNARCHIVED_COVER_SQL = `"id" = ? AND "recipeId" = ? AND "status" <> 'archived' AND "archivedAt" IS NULL`;

/**
 * The request's D1 binding. With it, each placeholder write goes to D1 as one batch, never
 * through Prisma's multi-row writes, which on D1 run as separate statements outside any
 * transaction.
 */
function placeholderD1(input: SchedulePlaceholderInput): D1ReadDatabase | null {
  return d1Binding(input.env?.DB);
}

async function markPlaceholderFailed(
  input: SchedulePlaceholderInput,
  reason: string,
  logger: Pick<Console, "error">,
): Promise<void> {
  try {
    const d1 = placeholderD1(input);
    if (d1) {
      await d1WriteBatch(d1, [[
        `UPDATE "RecipeCover" SET "status" = 'failed', "generationStatus" = 'failed', "failureReason" = ?
         WHERE ${UNARCHIVED_COVER_SQL}`,
        reason,
        input.coverId,
        input.recipeId,
      ]]);
      return;
    }
    await input.db.recipeCover.updateMany({
      where: unarchivedCover(input.coverId),
      data: {
        status: "failed",
        generationStatus: "failed",
        failureReason: reason,
      },
    });
  } catch (error) {
    logger.error("ai-placeholder cover failure state update failed", error);
  }
}

async function activatePlaceholderIfStillAutomatic(
  input: SchedulePlaceholderInput,
): Promise<void> {
  if (input.suppressAutoActivation) return;
  await input.db.recipe.updateMany({
    where: {
      id: input.recipeId,
      coverMode: "auto",
      activeCoverId: null,
      covers: { some: unarchivedCover(input.coverId) },
    },
    data: {
      activeCoverId: input.coverId,
      activeCoverVariant: "image",
      coverMode: "auto",
    },
  });
}

async function activatePlaceholderIfStillRequested(
  input: SchedulePlaceholderInput,
): Promise<void> {
  if (!input.activateWhenReady || !input.activationGuard) return;
  const updatedAt = new Date();
  const result = await input.db.recipe.updateMany({
    where: {
      id: input.recipeId,
      activeCoverId: input.activationGuard.activeCoverId,
      activeCoverVariant: input.activationGuard.activeCoverVariant,
      coverMode: input.activationGuard.coverMode,
      covers: { some: unarchivedCover(input.coverId) },
    },
    data: {
      activeCoverId: input.coverId,
      activeCoverVariant: "image",
      coverMode: "manual",
      updatedAt,
    },
  });
  if (result.count > 0) {
    await touchNativeSyncCookbooksForRecipeOperation(input.db, input.recipeId, updatedAt);
  }
}

/**
 * Marks the generated placeholder ready and, when the recipe still wants it, makes it the
 * recipe's cover, as one D1 batch: all of it applies or none does. Each activation only
 * matches while the cover is still this recipe's and not archived, with the same recipe
 * conditions as the Prisma path, and the cookbooks are touched only when the requested
 * activation applied.
 */
async function finishPlaceholderOnD1(
  input: SchedulePlaceholderInput,
  d1: D1ReadDatabase,
  url: string,
): Promise<void> {
  const touchedAt = d1Timestamp(new Date());
  const coverStillUnarchived = `EXISTS (SELECT 1 FROM "RecipeCover" WHERE ${UNARCHIVED_COVER_SQL})`;
  const statements: D1Query[] = [[
    `UPDATE "RecipeCover"
     SET "imageUrl" = ?, "status" = 'ready', "generationStatus" = 'succeeded', "failureReason" = NULL, "promptAddition" = ?
     WHERE ${UNARCHIVED_COVER_SQL}`,
    url,
    sanitizeImagePromptAddition(input.promptAddition),
    input.coverId,
    input.recipeId,
  ]];
  if (input.activateWhenReady && input.activationGuard) {
    const guard = input.activationGuard;
    statements.push(
      [
        `UPDATE "Recipe" SET "activeCoverId" = ?, "activeCoverVariant" = 'image', "coverMode" = 'manual', "updatedAt" = ?
         WHERE "id" = ? AND "activeCoverId" IS ? AND "activeCoverVariant" IS ? AND "coverMode" = ? AND ${coverStillUnarchived}`,
        input.coverId,
        touchedAt,
        input.recipeId,
        guard.activeCoverId,
        guard.activeCoverVariant,
        guard.coverMode,
        input.coverId,
        input.recipeId,
      ],
      [
        `UPDATE "Cookbook" SET "updatedAt" = ?
         WHERE "id" IN (SELECT "cookbookId" FROM "RecipeInCookbook" WHERE "recipeId" = ?)
           AND EXISTS (SELECT 1 FROM "Recipe" WHERE "id" = ? AND "activeCoverId" = ? AND "updatedAt" = ?)`,
        touchedAt,
        input.recipeId,
        input.recipeId,
        input.coverId,
        touchedAt,
      ],
    );
  } else if (!input.activateWhenReady && !input.suppressAutoActivation) {
    statements.push([
      `UPDATE "Recipe" SET "activeCoverId" = ?, "activeCoverVariant" = 'image', "coverMode" = 'auto', "updatedAt" = ?
       WHERE "id" = ? AND "coverMode" = 'auto' AND "activeCoverId" IS NULL AND ${coverStillUnarchived}`,
      input.coverId,
      touchedAt,
      input.recipeId,
      input.coverId,
      input.recipeId,
    ]);
  }
  await d1WriteBatch(d1, statements);
}

function failureReasonFor(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = typeof error === "object" && error !== null && "cause" in error
    ? (error as { cause?: unknown }).cause
    : undefined;
  if (cause === undefined) return message;

  const causeMessage = failureReasonFor(cause);
  return causeMessage === message ? message : `${message}: ${causeMessage}`;
}

/**
 * Background task: spends a per-user image-gen quota unit, generates the AI placeholder
 * cover for `coverId`, and replaces its `imageUrl` with the resulting R2 URL. Failures
 * leave the SVG fallback in place and are logged. This function never throws.
 */
export async function scheduleAiPlaceholderCover(
  input: SchedulePlaceholderInput,
): Promise<void> {
  const logger = input.logger ?? console;
  let model = OPENAI_PLACEHOLDER_MODEL;
  try {
    const runnerResolution = resolveRunner(input);
    if ("reason" in runnerResolution) {
      await captureSkipped(input, runnerResolution.reason);
      await markPlaceholderFailed(input, runnerResolution.reason, logger);
      return;
    }
    model = runnerResolution.model;

    const consumed = await tryConsumeImageGenQuota(
      input.db,
      input.userId,
      "placeholder",
      {
        ...(input.now ? { now: () => new Date(input.now!()) } : {}),
        d1: placeholderD1(input),
        env: input.env,
      },
    );
    if (!consumed) {
      await captureSkipped(input, "quota_exhausted");
      await markPlaceholderFailed(input, "quota_exhausted", logger);
      return;
    }

    const url = await generatePlaceholderImage(input.title, input.description, {
      env: input.env ?? {},
      runner: runnerResolution.runner,
      model: runnerResolution.model,
      fetchImpl: input.fetchImpl,
      bucket: input.bucket,
      now: input.now,
    }, {
      promptAddition: input.promptAddition,
    });

    const d1 = placeholderD1(input);
    if (d1) {
      await finishPlaceholderOnD1(input, d1, url);
      return;
    }
    const marked = await input.db.recipeCover.updateMany({
      where: unarchivedCover(input.coverId),
      data: {
        imageUrl: url,
        status: "ready",
        generationStatus: "succeeded",
        failureReason: null,
        promptAddition: sanitizeImagePromptAddition(input.promptAddition),
      },
    });
    if (marked.count === 0) return;
    if (input.activateWhenReady) {
      await activatePlaceholderIfStillRequested(input);
    } else {
      await activatePlaceholderIfStillAutomatic(input);
    }
  } catch (error) {
    await captureGenerationException(input, error, model);
    await markPlaceholderFailed(input, failureReasonFor(error), logger);
    logger.error("ai-placeholder cover generation failed", error);
  }
}
