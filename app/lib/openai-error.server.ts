/**
 * Shared extraction of the *original* OpenAI error code / type / status.
 *
 * The OpenAI SDK surfaces a machine-readable `code` (e.g. `insufficient_quota`,
 * `rate_limit_exceeded`, `model_not_found`) and `type` alongside the HTTP
 * `status`. Call sites map these to friendly messages, but historically threw
 * the original away — which made an out-of-credit failure (`insufficient_quota`)
 * indistinguishable from a transient `rate_limit_exceeded`. This helper pulls
 * those fields back out so they can be preserved on the thrown error and in
 * captured telemetry.
 *
 * Errors may carry the fields at the top level (SDK `APIError`) or nested under
 * an `error` object (raw JSON body), so both shapes are probed.
 */

export interface OpenAIErrorFields {
  code: string | null;
  type: string | null;
  status: number | null;
}

function stringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nestedError(error: unknown): Record<string, unknown> | null {
  if (typeof error !== "object" || error === null || !("error" in error)) {
    return null;
  }
  const nested = (error as { error?: unknown }).error;
  if (typeof nested !== "object" || nested === null) return null;
  return nested as Record<string, unknown>;
}

export function openAIErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const top = stringField(error as Record<string, unknown>, "code");
  if (top !== null) return top;
  const nested = nestedError(error);
  return nested ? stringField(nested, "code") : null;
}

export function openAIErrorType(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const top = stringField(error as Record<string, unknown>, "type");
  if (top !== null) return top;
  const nested = nestedError(error);
  return nested ? stringField(nested, "type") : null;
}

export function openAIErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/**
 * Extract the preserved OpenAI error code, type, and status from an arbitrary
 * thrown value. Any field that cannot be read is returned as `null`.
 */
export function extractOpenAIErrorFields(error: unknown): OpenAIErrorFields {
  return {
    code: openAIErrorCode(error),
    type: openAIErrorType(error),
    status: openAIErrorStatus(error),
  };
}
