import type { PrismaClient } from "@prisma/client";
import {
  createOpenAIImageRunner,
  stylizeSpoonPhoto,
  type ImageGenRunner,
} from "~/lib/image-gen.server";
import { tryConsumeImageGenQuota } from "~/lib/image-gen-ledger.server";
import {
  captureImageGenerationException,
  captureImageGenerationSkipped,
  type ImageGenerationSkipReason,
  type ImageGenerationSourceType,
} from "~/lib/image-gen-telemetry.server";
import { createOpenAIClient } from "~/lib/openai-client.server";
import type { PostHogServerConfig, PostHogServerEnv } from "~/lib/analytics-server";

const STYLIZATION_MODEL = "gpt-image-1";

type ImageGenerationSchedulerEnv = { OPENAI_API_KEY?: string } & PostHogServerEnv;
type OpenAIImageGenerationEnv = ImageGenerationSchedulerEnv & { OPENAI_API_KEY: string };
type ImageGenRunnerFactory = (env: OpenAIImageGenerationEnv) => ImageGenRunner | null;

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
  fetchImpl?: typeof fetch;
  allowLocalImageFallback?: boolean;
  sourceType?: Extract<ImageGenerationSourceType, "chef-upload" | "spoon">;
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

function sourceTypeFor(input: ScheduleSpoonStylizationInput) {
  return input.sourceType ?? "spoon";
}

function resolveRunner(
  input: ScheduleSpoonStylizationInput,
): { runner: ImageGenRunner } | { reason: ImageGenerationSkipReason } {
  if (input.runner) return { runner: input.runner };
  if (!hasOpenAIKey(input.env)) return { reason: "missing_openai_key" };

  const createRunner = input.createRunner ?? createDefaultRunner;
  const runner = createRunner(input.env);
  return runner ? { runner } : { reason: "missing_runner" };
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

async function captureGenerationException(
  input: ScheduleSpoonStylizationInput,
  error: unknown,
): Promise<void> {
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
    model: STYLIZATION_MODEL,
    error,
  });
}

/**
 * Background task: consumes one stylization quota unit, runs gpt-image-1 against
 * `rawPhotoUrl`, and writes the resulting URL to the cover row's `stylizedImageUrl`.
 * Failures leave `stylizedImageUrl` null and are logged. This function never throws.
 */
export async function scheduleSpoonCoverStylization(
  input: ScheduleSpoonStylizationInput,
): Promise<void> {
  const logger = input.logger ?? console;
  try {
    const runnerResolution = resolveRunner(input);
    if ("reason" in runnerResolution) {
      await captureSkipped(input, runnerResolution.reason);
      return;
    }

    const consumed = await tryConsumeImageGenQuota(
      input.db,
      input.userId,
      "stylization",
      input.now ? { now: () => new Date(input.now!()) } : {},
    );
    if (!consumed) {
      await captureSkipped(input, "quota_exhausted");
      return;
    }

    const result = await stylizeSpoonPhoto(input.rawPhotoUrl, input.recipeTitle, {
      env: input.env ?? {},
      runner: runnerResolution.runner,
      fetchImpl: input.fetchImpl,
      bucket: input.bucket,
      now: input.now,
      allowLocalImageFallback: input.allowLocalImageFallback,
    });

    await input.db.recipeCover.update({
      where: { id: input.coverId },
      data: { stylizedImageUrl: result.url },
    });
  } catch (error) {
    await captureGenerationException(input, error);
    logger.error("spoon cover stylization failed", error);
  }
}
