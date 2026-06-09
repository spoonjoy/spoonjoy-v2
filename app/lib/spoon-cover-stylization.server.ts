import type { Prisma, PrismaClient } from "@prisma/client";
import {
  createGeminiImageRunner,
  createOpenAIImageRunner,
  DEFAULT_GEMINI_IMAGE_MODEL,
  DEFAULT_GEMINI_IMAGE_TIMEOUT_MS,
  ImageProviderAttemptError,
  OPENAI_IMAGE_EDIT_MODELS,
  stylizeSpoonPhoto,
  type ImageEditAttempt,
  type ImageGenEnv,
  type ImageGenRunner,
  type StylizationResult,
} from "~/lib/image-gen.server";
import { tryConsumeImageGenQuota } from "~/lib/image-gen-ledger.server";
import {
  captureImageGenerationException,
  captureImageGenerationProviderFallback,
  captureImageGenerationSkipped,
  type ImageGenerationSkipReason,
  type ImageGenerationSourceType,
} from "~/lib/image-gen-telemetry.server";
import { createOpenAIClient } from "~/lib/openai-client.server";
import type { PostHogServerConfig, PostHogServerEnv } from "~/lib/analytics-server";

const STYLIZATION_MODEL = "configured";
const STYLIZATION_PROMPT_VERSION = "spoon-photo-editorial-v1";
const STYLIZATION_STYLE_VERSION = "mendelow-phone-to-editorial-v1";

type ImageGenerationSchedulerEnv = ImageGenEnv & PostHogServerEnv;
type ImageGenRunnerFactory = (env: ImageGenerationSchedulerEnv) => ImageGenRunner | null;
type ImageEditAttemptsFactory = (
  env: ImageGenerationSchedulerEnv,
  fetchImpl?: typeof fetch,
) => ImageEditAttempt[] | null;
type SupportedImageProvider = "openai" | "gemini";

export interface ScheduleSpoonStylizationInput {
  db: PrismaClient;
  userId: string;
  recipeId: string;
  coverId: string;
  rawPhotoUrl: string;
  recipeTitle: string;
  env?: ImageGenerationSchedulerEnv | null;
  bucket?: R2Bucket;
  runner?: ImageGenRunner;
  createRunner?: ImageGenRunnerFactory;
  createImageEditAttempts?: ImageEditAttemptsFactory;
  fetchImpl?: typeof fetch;
  allowLocalImageFallback?: boolean;
  sourceType?: Extract<ImageGenerationSourceType, "chef-upload" | "spoon">;
  activateWhenReady?: boolean;
  suppressAutoActivation?: boolean;
  activationGuard?: {
    activeCoverId: string | null;
    activeCoverVariant: string | null;
    coverMode: string;
  };
  postHogConfig?: PostHogServerConfig;
  analyticsFetchImpl?: typeof fetch;
  now?: () => number;
  logger?: Pick<Console, "error">;
}

function sourceTypeFor(input: ScheduleSpoonStylizationInput) {
  return input.sourceType ?? "spoon";
}

function hasNonEmptyUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function failureStatusFor(cover: { imageUrl: string | null }): "ready" | "failed" {
  return hasNonEmptyUrl(cover.imageUrl) ? "ready" : "failed";
}

function serializeError(error: unknown, depth = 0): Record<string, unknown> {
  if (depth > 4) return { truncated: true };
  if (!(error instanceof Error)) {
    return { value: String(error) };
  }

  const withDetails = error as Error & {
    cause?: unknown;
    code?: unknown;
    status?: unknown;
    type?: unknown;
    param?: unknown;
    request_id?: unknown;
    requestID?: unknown;
    body?: unknown;
    error?: unknown;
    errors?: unknown;
    provider?: unknown;
    model?: unknown;
    retryable?: unknown;
  };
  const details: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };

  for (const key of ["code", "status", "type", "param", "request_id", "requestID"] as const) {
    if (withDetails[key] !== undefined) details[key] = withDetails[key];
  }
  for (const key of ["provider", "model", "retryable"] as const) {
    if (withDetails[key] !== undefined) details[key] = withDetails[key];
  }
  if (withDetails.body !== undefined) details.body = withDetails.body;
  if (withDetails.error !== undefined) details.error = withDetails.error;
  if (withDetails.cause !== undefined) details.cause = serializeError(withDetails.cause, depth + 1);
  if (Array.isArray(withDetails.errors)) {
    details.errors = withDetails.errors.map((item) => serializeError(item, depth + 1));
  }
  return details;
}

function trimmed(value: string | undefined): string {
  return value?.trim() ?? "";
}

function positiveInteger(value: string | undefined): number | undefined {
  const parsed = Number(trimmed(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function normalizeProvider(value: string): SupportedImageProvider | null {
  const normalized = value.trim().toLowerCase();
  return normalized === "openai" || normalized === "gemini" ? normalized : null;
}

export function resolveImageProviderOrder(
  env: ImageGenerationSchedulerEnv | null | undefined,
): SupportedImageProvider[] {
  const configured = [
    trimmed(env?.IMAGE_PROVIDER_PRIMARY),
    ...trimmed(env?.IMAGE_PROVIDER_FALLBACKS).split(","),
  ].map((value) => value.trim()).filter(Boolean);
  const rawOrder = configured.length > 0 ? configured : ["openai", "gemini"];
  const order: SupportedImageProvider[] = [];
  for (const item of rawOrder) {
    const provider = normalizeProvider(item);
    if (provider && !order.includes(provider)) order.push(provider);
  }
  return order;
}

function createDefaultImageEditAttempts(
  env: ImageGenerationSchedulerEnv,
  fetchImpl?: typeof fetch,
): ImageEditAttempt[] {
  const attempts: ImageEditAttempt[] = [];
  for (const provider of resolveImageProviderOrder(env)) {
    if (provider === "openai") {
      const apiKey = trimmed(env.OPENAI_API_KEY);
      if (!apiKey) continue;
      const runner = createOpenAIImageRunner(createOpenAIClient({ apiKey }) as never);
      for (const model of OPENAI_IMAGE_EDIT_MODELS) {
        attempts.push({ provider, model, runner });
      }
    }
    if (provider === "gemini") {
      const apiKey = trimmed(env.GEMINI_API_KEY) || trimmed(env.GOOGLE_API_KEY);
      if (!apiKey) continue;
      attempts.push({
        provider,
        model: trimmed(env.GEMINI_IMAGE_MODEL) || DEFAULT_GEMINI_IMAGE_MODEL,
        runner: createGeminiImageRunner({
          apiKey,
          fetchImpl,
          timeoutMs: positiveInteger(env.GEMINI_IMAGE_TIMEOUT_MS) ?? DEFAULT_GEMINI_IMAGE_TIMEOUT_MS,
        }),
      });
    }
  }
  return attempts;
}

function resolveProviderAttempts(
  input: ScheduleSpoonStylizationInput,
): { runner: ImageGenRunner } | { imageEditAttempts: ImageEditAttempt[] } | { reason: ImageGenerationSkipReason } {
  if (input.runner) return { runner: input.runner };
  if (!input.env) return { reason: "missing_image_provider_config" };

  if (input.createRunner) {
    const runner = input.createRunner(input.env);
    return runner ? { runner } : { reason: "missing_runner" };
  }

  const createAttempts = input.createImageEditAttempts ?? createDefaultImageEditAttempts;
  const attempts = createAttempts(input.env, input.fetchImpl) ?? [];
  return attempts.length > 0 ? { imageEditAttempts: attempts } : { reason: "missing_image_provider_config" };
}

async function captureSkipped(
  input: ScheduleSpoonStylizationInput,
  reason: ImageGenerationSkipReason,
): Promise<void> {
  await captureImageGenerationSkipped({
    env: input.env,
    postHogConfig: input.postHogConfig,
    fetchImpl: input.analyticsFetchImpl,
    userId: input.userId,
    recipeId: input.recipeId,
    coverId: input.coverId,
    operation: "cover_stylize",
    sourceType: sourceTypeFor(input),
    quotaKind: "stylization",
    model: "none",
    reason,
  });
}

async function currentCoverForLifecycle(input: ScheduleSpoonStylizationInput) {
  return input.db.recipeCover.findFirst({
    where: { id: input.coverId, recipeId: input.recipeId },
    select: {
      id: true,
      imageUrl: true,
      status: true,
      generationStatus: true,
      archivedAt: true,
    },
  });
}

async function markStylizationProcessing(input: ScheduleSpoonStylizationInput): Promise<boolean> {
  const result = await input.db.recipeCover.updateMany({
    where: {
      id: input.coverId,
      recipeId: input.recipeId,
      status: { not: "archived" },
      archivedAt: null,
    },
    data: {
      status: "processing",
      generationStatus: "processing",
      failureReason: null,
      promptVersion: STYLIZATION_PROMPT_VERSION,
      styleVersion: STYLIZATION_STYLE_VERSION,
    },
  });
  return result.count > 0;
}

async function markStylizationSucceeded(
  input: ScheduleSpoonStylizationInput,
  stylizedImageUrl: string,
): Promise<boolean> {
  const result = await input.db.recipeCover.updateMany({
    where: {
      id: input.coverId,
      recipeId: input.recipeId,
      status: { not: "archived" },
      archivedAt: null,
    },
    data: {
      stylizedImageUrl,
      status: "ready",
      generationStatus: "succeeded",
      failureReason: null,
      promptVersion: STYLIZATION_PROMPT_VERSION,
      styleVersion: STYLIZATION_STYLE_VERSION,
    },
  });
  return result.count > 0;
}

async function markStylizationFailed(
  input: ScheduleSpoonStylizationInput,
  failureReason: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const cover = await currentCoverForLifecycle(input);
  if (!cover || cover.status === "archived" || cover.archivedAt) return;
  const wasRequested = cover.status === "processing" || cover.generationStatus === "processing";
  if (!options.force && !wasRequested) return;

  await input.db.recipeCover.update({
    where: { id: cover.id },
    data: {
      status: failureStatusFor(cover),
      generationStatus: "failed",
      failureReason,
      promptVersion: STYLIZATION_PROMPT_VERSION,
      styleVersion: STYLIZATION_STYLE_VERSION,
    },
  });
}

function hasActiveVariantUrl(cover: {
  imageUrl: string | null;
  stylizedImageUrl: string | null;
}, variant: string | null): boolean {
  if (variant === "stylized") return hasNonEmptyUrl(cover.stylizedImageUrl);
  if (variant === "image") return hasNonEmptyUrl(cover.imageUrl);
  return hasNonEmptyUrl(cover.stylizedImageUrl) || hasNonEmptyUrl(cover.imageUrl);
}

function hasRealActiveCover(recipe: {
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  activeCover: {
    id: string;
    recipeId: string;
    imageUrl: string | null;
    stylizedImageUrl: string | null;
    sourceType: string;
    status: string;
    archivedAt: Date | null;
  } | null;
}, candidateCoverId: string, recipeId: string): boolean {
  const cover = recipe.activeCover;
  if (!recipe.activeCoverId || recipe.activeCoverId === candidateCoverId) return false;
  if (!cover || cover.id !== recipe.activeCoverId || cover.recipeId !== recipeId) return false;
  if (cover.status !== "ready" || cover.archivedAt) return false;
  if (cover.sourceType === "ai-placeholder") return false;
  return hasActiveVariantUrl(cover, recipe.activeCoverVariant);
}

async function autoActivateStylizedCoverIfSafe(input: ScheduleSpoonStylizationInput): Promise<void> {
  const recipe = await input.db.recipe.findUnique({
    where: { id: input.recipeId },
    select: {
      coverMode: true,
      activeCoverId: true,
      activeCoverVariant: true,
      activeCover: {
        select: {
          id: true,
          recipeId: true,
          imageUrl: true,
          stylizedImageUrl: true,
          sourceType: true,
          status: true,
          archivedAt: true,
        },
      },
    },
  });
  if (!recipe || recipe.coverMode !== "auto") return;
  if (hasRealActiveCover(recipe, input.coverId, input.recipeId)) return;

  const noRealActiveCover: Prisma.RecipeWhereInput = {
    OR: [
      { activeCoverId: null },
      { activeCoverId: input.coverId },
      { activeCover: null },
      { activeCover: { is: { recipeId: { not: input.recipeId } } } },
      { activeCover: { is: { status: { not: "ready" } } } },
      { activeCover: { is: { archivedAt: { not: null } } } },
      { activeCover: { is: { sourceType: "ai-placeholder" } } },
      {
        AND: [
          { activeCoverVariant: "image" },
          { activeCover: { is: { imageUrl: "" } } },
        ],
      },
      {
        AND: [
          { activeCoverVariant: "stylized" },
          {
            activeCover: {
              is: {
                OR: [{ stylizedImageUrl: null }, { stylizedImageUrl: "" }],
              },
            },
          },
        ],
      },
      {
        AND: [
          { activeCoverVariant: null },
          { activeCover: { is: { imageUrl: "" } } },
          {
            activeCover: {
              is: {
                OR: [{ stylizedImageUrl: null }, { stylizedImageUrl: "" }],
              },
            },
          },
        ],
      },
    ],
  };

  await input.db.recipe.updateMany({
    where: {
      id: input.recipeId,
      coverMode: "auto",
      activeCoverId: recipe.activeCoverId,
      ...noRealActiveCover,
    },
    data: {
      activeCoverId: input.coverId,
      activeCoverVariant: "stylized",
    },
  });
}

async function activateStylizedCoverIfStillRequested(input: ScheduleSpoonStylizationInput): Promise<void> {
  if (!input.activateWhenReady || !input.activationGuard) return;
  await input.db.recipe.updateMany({
    where: {
      id: input.recipeId,
      activeCoverId: input.activationGuard.activeCoverId,
      activeCoverVariant: input.activationGuard.activeCoverVariant,
      coverMode: input.activationGuard.coverMode,
    },
    data: {
      activeCoverId: input.coverId,
      activeCoverVariant: "stylized",
      coverMode: "manual",
    },
  });
}

async function captureGenerationException(
  input: ScheduleSpoonStylizationInput,
  error: unknown,
  serializedError: Record<string, unknown>,
): Promise<void> {
  const details = imageGenerationFailureDetails(error);
  await captureImageGenerationException({
    env: input.env,
    postHogConfig: input.postHogConfig,
    fetchImpl: input.analyticsFetchImpl,
    userId: input.userId,
    recipeId: input.recipeId,
    coverId: input.coverId,
    operation: "cover_stylize",
    sourceType: sourceTypeFor(input),
    quotaKind: "stylization",
    model: details.model ?? STYLIZATION_MODEL,
    provider: details.provider,
    errorStatus: details.status,
    errorCode: details.code,
    errorType: details.type,
    requestId: details.requestID,
    retryable: details.retryable,
    fallbackAttempted: details.fallbackAttempted,
    fallbackProvider: details.fallbackProvider,
    fallbackModel: details.fallbackModel,
    primaryProvider: details.primaryProvider,
    primaryModel: details.primaryModel,
    primaryErrorStatus: details.primaryStatus,
    primaryErrorCode: details.primaryCode,
    primaryErrorType: details.primaryType,
    primaryRequestId: details.primaryRequestID,
    error,
    errorDetails: JSON.stringify(serializedError),
  });
}

async function captureRecoveredProviderFallback(
  input: ScheduleSpoonStylizationInput,
  result: StylizationResult,
): Promise<void> {
  const details = imageGenerationRecoveredDetails(result);
  if (!details) return;
  await captureImageGenerationProviderFallback({
    env: input.env,
    postHogConfig: input.postHogConfig,
    fetchImpl: input.analyticsFetchImpl,
    userId: input.userId,
    recipeId: input.recipeId,
    coverId: input.coverId,
    operation: "cover_stylize",
    sourceType: sourceTypeFor(input),
    quotaKind: "stylization",
    model: details.model,
    provider: details.provider,
    errorStatus: details.status,
    errorCode: details.code,
    errorType: details.type,
    requestId: details.requestID,
    retryable: details.retryable,
    fallbackAttempted: true,
    fallbackProvider: result.usedProvider,
    fallbackModel: result.usedModel,
    primaryProvider: details.primaryProvider,
    primaryModel: details.primaryModel,
    primaryErrorStatus: details.primaryStatus,
    primaryErrorCode: details.primaryCode,
    primaryErrorType: details.primaryType,
    primaryRequestId: details.primaryRequestID,
  });
}

function collectAttemptErrors(error: unknown, output: ImageProviderAttemptError[] = []): ImageProviderAttemptError[] {
  if (error instanceof ImageProviderAttemptError) {
    output.push(error);
  }
  if (error instanceof AggregateError) {
    for (const child of error.errors) collectAttemptErrors(child, output);
  }
  if (error instanceof Error && "cause" in error) {
    collectAttemptErrors((error as Error & { cause?: unknown }).cause, output);
  }
  return output;
}

function imageGenerationFailureDetails(error: unknown): {
  provider?: string;
  model?: string;
  status?: number | null;
  code?: string | null;
  type?: string | null;
  requestID?: string | null;
  retryable?: boolean;
  fallbackAttempted?: boolean;
  fallbackProvider?: string;
  fallbackModel?: string;
  primaryProvider?: string;
  primaryModel?: string;
  primaryStatus?: number | null;
  primaryCode?: string | null;
  primaryType?: string | null;
  primaryRequestID?: string | null;
} {
  const attempts = collectAttemptErrors(error);
  const primary = attempts[0];
  const final = attempts.at(-1);
  const distinctProviders = attempts
    .map((attempt) => attempt.provider)
    .filter((provider, index, providers) => providers.indexOf(provider) === index);
  return {
    provider: final?.provider,
    model: final?.model,
    status: final?.status,
    code: final?.code,
    type: final?.type,
    requestID: final?.requestID,
    retryable: final?.retryable,
    fallbackAttempted: attempts.length > 1,
    fallbackProvider: distinctProviders[1],
    fallbackModel: attempts.length > 1 ? final?.model : undefined,
    primaryProvider: primary?.provider,
    primaryModel: primary?.model,
    primaryStatus: primary?.status,
    primaryCode: primary?.code,
    primaryType: primary?.type,
    primaryRequestID: primary?.requestID,
  };
}

function imageGenerationRecoveredDetails(result: StylizationResult): {
  provider: string;
  model: string;
  status: number | null;
  code: string | null;
  type: string | null;
  requestID: string | null;
  retryable: boolean;
  fallbackAttempted: true;
  fallbackProvider: string;
  fallbackModel: string;
  primaryProvider: string;
  primaryModel: string;
  primaryStatus: number | null;
  primaryCode: string | null;
  primaryType: string | null;
  primaryRequestID: string | null;
} | null {
  const failures = result.attemptFailures ?? [];
  if (failures.length === 0) return null;
  const primary = failures[0];
  return {
    provider: primary.provider,
    model: primary.model,
    status: primary.status,
    code: primary.code,
    type: primary.type,
    requestID: primary.requestID,
    retryable: primary.retryable,
    fallbackAttempted: true,
    fallbackProvider: result.usedProvider,
    fallbackModel: result.usedModel,
    primaryProvider: primary.provider,
    primaryModel: primary.model,
    primaryStatus: primary.status,
    primaryCode: primary.code,
    primaryType: primary.type,
    primaryRequestID: primary.requestID,
  };
}

/**
 * Background task: consumes one stylization quota unit, runs image edits against
 * `rawPhotoUrl`, and records durable generation state on the cover row.
 * Failures keep a usable raw image ready when one exists. This function never throws.
 */
export async function scheduleSpoonCoverStylization(
  input: ScheduleSpoonStylizationInput,
): Promise<void> {
  const logger = input.logger ?? console;
  try {
    if (!input.rawPhotoUrl.trim()) {
      await markStylizationFailed(input, "missing_source_image", { force: true });
      await captureSkipped(input, "missing_source_image");
      return;
    }

    const coverUpdated = await markStylizationProcessing(input);
    if (!coverUpdated) return;

    const providerResolution = resolveProviderAttempts(input);
    if ("reason" in providerResolution) {
      await markStylizationFailed(input, providerResolution.reason);
      await captureSkipped(input, providerResolution.reason);
      return;
    }

    const consumed = await tryConsumeImageGenQuota(
      input.db,
      input.userId,
      "stylization",
      input.now ? { now: () => new Date(input.now!()) } : {},
    );
    if (!consumed) {
      await markStylizationFailed(input, "quota_exhausted");
      await captureSkipped(input, "quota_exhausted");
      return;
    }

    const result = await stylizeSpoonPhoto(input.rawPhotoUrl, input.recipeTitle, {
      env: input.env ?? {},
      ...("runner" in providerResolution
        ? { runner: providerResolution.runner }
        : { imageEditAttempts: providerResolution.imageEditAttempts }),
      fetchImpl: input.fetchImpl,
      bucket: input.bucket,
      now: input.now,
      allowLocalImageFallback: input.allowLocalImageFallback,
    });

    const coverUpdatedAfterGeneration = await markStylizationSucceeded(input, result.url);
    if (coverUpdatedAfterGeneration) {
      if (input.activateWhenReady) {
        await activateStylizedCoverIfStillRequested(input);
      } else if (!input.suppressAutoActivation) {
        await autoActivateStylizedCoverIfSafe(input);
      }
    }

    await captureRecoveredProviderFallback(input, result);
  } catch (error) {
    const serializedError = serializeError(error);
    await markStylizationFailed(input, error instanceof Error ? error.message : String(error), { force: true });
    await captureGenerationException(input, error, serializedError);
    logger.error("spoon cover stylization failed", serializedError);
  }
}
