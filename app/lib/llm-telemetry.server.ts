/**
 * Server-side telemetry for text LLM calls (OpenAI chat-completions).
 *
 * Mirrors the established image-generation telemetry pattern in
 * `image-gen-telemetry.server.ts`, but targets the text LLM call sites
 * (ingredient parsing, recipe-import extraction). Failures are captured as a
 * controlled `spoonjoy.llm_call.failed` event so out-of-credit
 * (`insufficient_quota`) failures can be told apart from `rate_limit_exceeded`
 * or `model_not_found`.
 *
 * The preserved OpenAI error code/type/status are passed through so the failure
 * cause is queryable in PostHog rather than collapsed into a generic message.
 */

import {
  captureEvent,
  resolvePostHogServerConfig,
  type PostHogServerConfig,
  type PostHogServerEnv,
} from "~/lib/analytics-server";

export type LlmCallOperation = "ingredient_parse" | "recipe_import";

export interface LlmCallFailureTelemetry {
  env?: PostHogServerEnv | null;
  postHogConfig?: PostHogServerConfig;
  fetchImpl?: typeof fetch;
  /** Distinct id for PostHog. Use a user id when known, otherwise `anon`. */
  distinctId?: string;
  operation: LlmCallOperation;
  provider: string;
  model: string;
  /** Original OpenAI error code (e.g. `insufficient_quota`), when known. */
  errorCode?: string | null;
  /** Original OpenAI error type (e.g. `insufficient_quota`), when known. */
  errorType?: string | null;
  /** Original OpenAI HTTP status, when known. */
  errorStatus?: number | null;
  /** Mapped, user-facing failure message thrown by the call site. */
  errorMessage?: string | null;
}

function resolveLlmPostHogConfig(input: LlmCallFailureTelemetry) {
  return input.postHogConfig ?? resolvePostHogServerConfig(input.env ?? {});
}

function llmCallProperties(input: LlmCallFailureTelemetry) {
  return {
    feature: "llm_call",
    operation: input.operation,
    provider: input.provider,
    model: input.model,
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    ...(input.errorType ? { errorType: input.errorType } : {}),
    ...(input.errorStatus !== undefined && input.errorStatus !== null
      ? { errorStatus: input.errorStatus }
      : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  };
}

/**
 * Fire-and-forget capture of a failed LLM call. Never throws — telemetry must
 * not turn into an app/API error. Safe to call even when PostHog is unconfigured
 * (it no-ops).
 */
export async function captureLlmCallFailure(
  input: LlmCallFailureTelemetry,
): Promise<void> {
  await captureEvent(
    resolveLlmPostHogConfig(input),
    {
      event: "spoonjoy.llm_call.failed",
      distinctId: input.distinctId ?? "anon",
      properties: llmCallProperties(input),
    },
    input.fetchImpl,
  );
}
