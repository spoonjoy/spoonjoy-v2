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
  | "missing_image_provider_config"
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
  provider?: string;
  errorStatus?: number | null;
  errorCode?: string | null;
  errorType?: string | null;
  requestId?: string | null;
  retryable?: boolean;
  fallbackAttempted?: boolean;
  fallbackProvider?: string;
  fallbackModel?: string;
  primaryProvider?: string;
  primaryModel?: string;
  primaryErrorStatus?: number | null;
  primaryErrorCode?: string | null;
  primaryErrorType?: string | null;
  primaryRequestId?: string | null;
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
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.errorStatus !== undefined && input.errorStatus !== null ? { errorStatus: input.errorStatus } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    ...(input.errorType ? { errorType: input.errorType } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.retryable !== undefined ? { retryable: input.retryable } : {}),
    ...(input.fallbackAttempted !== undefined ? { fallbackAttempted: input.fallbackAttempted } : {}),
    ...(input.fallbackProvider ? { fallbackProvider: input.fallbackProvider } : {}),
    ...(input.fallbackModel ? { fallbackModel: input.fallbackModel } : {}),
    ...(input.primaryProvider ? { primaryProvider: input.primaryProvider } : {}),
    ...(input.primaryModel ? { primaryModel: input.primaryModel } : {}),
    ...(input.primaryErrorStatus !== undefined && input.primaryErrorStatus !== null
      ? { primaryErrorStatus: input.primaryErrorStatus }
      : {}),
    ...(input.primaryErrorCode ? { primaryErrorCode: input.primaryErrorCode } : {}),
    ...(input.primaryErrorType ? { primaryErrorType: input.primaryErrorType } : {}),
    ...(input.primaryRequestId ? { primaryRequestId: input.primaryRequestId } : {}),
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
  input: ImageGenerationTelemetryBase & { error: unknown; errorDetails?: string },
): Promise<void> {
  await captureException(
    resolveImageGenerationPostHogConfig(input),
    {
      error: input.error,
      distinctId: input.userId,
      extras: {
        ...imageGenerationProperties(input),
        ...(input.errorDetails ? { errorDetails: input.errorDetails } : {}),
      },
    },
    input.fetchImpl,
  );
}

export async function captureImageGenerationProviderFallback(
  input: ImageGenerationTelemetryBase,
): Promise<void> {
  await captureEvent(
    resolveImageGenerationPostHogConfig(input),
    {
      event: "spoonjoy.image_generation.provider_fallback",
      distinctId: input.userId,
      properties: imageGenerationProperties(input),
    },
    input.fetchImpl,
  );
}
