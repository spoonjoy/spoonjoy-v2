import type { PrismaClient } from "@prisma/client";
import {
  createOpenAIImageRunner,
  generatePlaceholderImage,
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

const PLACEHOLDER_MODEL = "dall-e-3";

type ImageGenerationSchedulerEnv = { OPENAI_API_KEY?: string } & PostHogServerEnv;
type OpenAIImageGenerationEnv = ImageGenerationSchedulerEnv & { OPENAI_API_KEY: string };
type ImageGenRunnerFactory = (env: OpenAIImageGenerationEnv) => ImageGenRunner | null;

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

function hasOpenAIKey(
  env: ImageGenerationSchedulerEnv | null | undefined,
): env is OpenAIImageGenerationEnv {
  return Boolean(env?.OPENAI_API_KEY);
}

function createDefaultRunner(env: OpenAIImageGenerationEnv): ImageGenRunner {
  const client = createOpenAIClient({ apiKey: env.OPENAI_API_KEY });
  return createOpenAIImageRunner(client as never);
}

function resolveRunner(
  input: SchedulePlaceholderInput,
): { runner: ImageGenRunner } | { reason: ImageGenerationSkipReason } {
  if (input.runner) return { runner: input.runner };
  if (!hasOpenAIKey(input.env)) return { reason: "missing_openai_key" };

  const createRunner = input.createRunner ?? createDefaultRunner;
  const runner = createRunner(input.env);
  return runner ? { runner } : { reason: "missing_runner" };
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
    model: PLACEHOLDER_MODEL,
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
  try {
    const runnerResolution = resolveRunner(input);
    if ("reason" in runnerResolution) {
      await captureSkipped(input, runnerResolution.reason);
      await markPlaceholderFailed(input, runnerResolution.reason, logger);
      return;
    }

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
    await captureGenerationException(input, error);
    await markPlaceholderFailed(input, failureReasonFor(error), logger);
    logger.error("ai-placeholder cover generation failed", error);
  }
}
