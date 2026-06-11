import type { PrismaClient } from "@prisma/client";
import {
  createGeminiImageRunner,
  createOpenAIImageRunner,
  DEFAULT_GEMINI_IMAGE_MODEL,
  DEFAULT_GEMINI_IMAGE_TIMEOUT_MS,
  generatePlaceholderImage,
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

const OPENAI_PLACEHOLDER_MODEL = "dall-e-3";

type ImageGenerationSchedulerEnv = ImageGenEnv & PostHogServerEnv;
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
  env?: ImageGenerationSchedulerEnv | null;
  bucket?: R2Bucket;
  runner?: ImageGenRunner;
  createRunner?: ImageGenRunnerFactory;
  fetchImpl?: typeof fetch;
  postHogConfig?: PostHogServerConfig;
  analyticsFetchImpl?: typeof fetch;
  now?: () => number;
  logger?: Pick<Console, "error">;
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

async function markPlaceholderFailed(
  input: SchedulePlaceholderInput,
  reason: string,
  logger: Pick<Console, "error">,
): Promise<void> {
  try {
    await input.db.recipeCover.update({
      where: { id: input.coverId },
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
  await input.db.recipe.updateMany({
    where: {
      id: input.recipeId,
      coverMode: "auto",
      activeCoverId: null,
    },
    data: {
      activeCoverId: input.coverId,
      activeCoverVariant: "image",
      coverMode: "auto",
    },
  });
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
      input.now ? { now: () => new Date(input.now!()) } : {},
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
    });

    await input.db.recipeCover.update({
      where: { id: input.coverId },
      data: {
        imageUrl: url,
        status: "ready",
        generationStatus: "succeeded",
        failureReason: null,
      },
    });
    await activatePlaceholderIfStillAutomatic(input);
  } catch (error) {
    await captureGenerationException(input, error, model);
    await markPlaceholderFailed(input, failureReasonFor(error), logger);
    logger.error("ai-placeholder cover generation failed", error);
  }
}
