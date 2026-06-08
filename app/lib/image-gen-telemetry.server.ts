import {
  captureEvent,
  captureException,
  resolvePostHogServerConfig,
  type PostHogServerConfig,
  type PostHogServerEnv,
} from "~/lib/analytics-server";

export type ImageGenerationOperation = "placeholder_generate" | "cover_stylize";
export type ImageGenerationSourceType = "ai-placeholder" | "chef-upload" | "spoon";
export type ImageGenerationQuotaKind = "placeholder" | "stylization";
export type ImageGenerationSkipReason =
  | "missing_openai_key"
  | "missing_runner"
  | "quota_exhausted";

export interface ImageGenerationTelemetryBase {
  env?: PostHogServerEnv | null;
  postHogConfig?: PostHogServerConfig;
  fetchImpl?: typeof fetch;
  userId: string;
  recipeId: string;
  coverId: string;
  operation: ImageGenerationOperation;
  sourceType: ImageGenerationSourceType;
  quotaKind: ImageGenerationQuotaKind;
  model: string;
}

function resolveImageGenerationPostHogConfig(input: ImageGenerationTelemetryBase) {
  return input.postHogConfig ?? resolvePostHogServerConfig(input.env ?? {});
}

function imageGenerationProperties(input: ImageGenerationTelemetryBase) {
  return {
    feature: "recipe_image_generation",
    operation: input.operation,
    recipeId: input.recipeId,
    coverId: input.coverId,
    sourceType: input.sourceType,
    quotaKind: input.quotaKind,
    model: input.model,
  };
}

export async function captureImageGenerationSkipped(
  input: ImageGenerationTelemetryBase & { reason: ImageGenerationSkipReason },
): Promise<void> {
  await captureEvent(
    resolveImageGenerationPostHogConfig(input),
    {
      event: "spoonjoy.image_generation.skipped",
      distinctId: input.userId,
      properties: {
        ...imageGenerationProperties(input),
        reason: input.reason,
      },
    },
    input.fetchImpl,
  );
}

export async function captureImageGenerationException(
  input: ImageGenerationTelemetryBase & { error: unknown },
): Promise<void> {
  await captureException(
    resolveImageGenerationPostHogConfig(input),
    {
      error: input.error,
      distinctId: input.userId,
      extras: imageGenerationProperties(input),
    },
    input.fetchImpl,
  );
}
