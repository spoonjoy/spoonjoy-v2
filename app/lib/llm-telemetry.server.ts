/**
 * Server-side telemetry for text LLM calls (OpenAI chat-completions).
 *
 * Mirrors the established image-generation telemetry pattern in
 * `image-gen-telemetry.server.ts`, but targets the text LLM call sites
 * (ingredient parsing, recipe-import extraction). Each call emits exactly one
 * outcome event:
 *
 *   - `spoonjoy.llm_call.succeeded` — the call returned a usable result.
 *   - `spoonjoy.llm_call.failed` — the call (or its response validation) failed.
 *
 * The success event lets PostHog show positive successes rather than only the
 * absence of failures (e.g. to verify an OpenAI outage is resolved). On the
 * failure side, the preserved OpenAI error code/type/status are passed through
 * so the cause is queryable in PostHog — out-of-credit (`insufficient_quota`)
 * failures can be told apart from `rate_limit_exceeded` or `model_not_found` —
 * rather than collapsed into a generic message.
 *
 * Both events carry only privacy-safe metadata (operation, provider, model,
 * and on success an optional `durationMs`). No prompt or response content is
 * ever attached.
 */

import {
  captureEvent,
  resolvePostHogServerConfig,
  type PostHogServerConfig,
  type PostHogServerEnv,
} from "~/lib/analytics-server";

export type LlmCallOperation = "ingredient_parse" | "recipe_import";

interface LlmCallTelemetryBase {
  env?: PostHogServerEnv | null;
  postHogConfig?: PostHogServerConfig;
  fetchImpl?: typeof fetch;
  /** Distinct id for PostHog. Use a user id when known, otherwise `anon`. */
  distinctId?: string;
  operation: LlmCallOperation;
  provider: string;
  model: string;
}

export interface LlmCallSuccessTelemetry extends LlmCallTelemetryBase {
  /** Wall-clock duration of the LLM call in milliseconds, when measured. */
  durationMs?: number | null;
}

export interface LlmCallFailureTelemetry extends LlmCallTelemetryBase {
  /** Original OpenAI error code (e.g. `insufficient_quota`), when known. */
  errorCode?: string | null;
  /** Original OpenAI error type (e.g. `insufficient_quota`), when known. */
  errorType?: string | null;
  /** Original OpenAI HTTP status, when known. */
  errorStatus?: number | null;
  /** Mapped, user-facing failure message thrown by the call site. */
  errorMessage?: string | null;
}

function resolveLlmPostHogConfig(input: LlmCallTelemetryBase) {
  return input.postHogConfig ?? resolvePostHogServerConfig(input.env ?? {});
}

function llmCallBaseProperties(input: LlmCallTelemetryBase) {
  return {
    feature: "llm_call",
    operation: input.operation,
    provider: input.provider,
    model: input.model,
  };
}

function llmCallSuccessProperties(input: LlmCallSuccessTelemetry) {
  return {
    ...llmCallBaseProperties(input),
    ...(input.durationMs !== undefined && input.durationMs !== null
      ? { durationMs: input.durationMs }
      : {}),
  };
}

function llmCallFailureProperties(input: LlmCallFailureTelemetry) {
  return {
    ...llmCallBaseProperties(input),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    ...(input.errorType ? { errorType: input.errorType } : {}),
    ...(input.errorStatus !== undefined && input.errorStatus !== null
      ? { errorStatus: input.errorStatus }
      : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  };
}

/**
 * Fire-and-forget capture of a successful LLM call. Never throws — telemetry
 * must not turn into an app/API error. Safe to call even when PostHog is
 * unconfigured (it no-ops). Carries only privacy-safe metadata: never any
 * prompt or response content.
 */
export async function captureLlmCallSucceeded(
  input: LlmCallSuccessTelemetry,
): Promise<void> {
  await captureEvent(
    resolveLlmPostHogConfig(input),
    {
      event: "spoonjoy.llm_call.succeeded",
      distinctId: input.distinctId ?? "anon",
      properties: llmCallSuccessProperties(input),
    },
    input.fetchImpl,
  );
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
      properties: llmCallFailureProperties(input),
    },
    input.fetchImpl,
  );
}
