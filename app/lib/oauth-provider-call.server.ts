export const OAUTH_PROVIDER_TIMEOUT_MS = 8_000;

export type OAuthProviderCallPhase = "token_exchange" | "userinfo";
export type OAuthProviderFailureKind = "client" | "timeout" | "network" | "upstream" | "missing_email";
export type OAuthProviderFailureCode = "provider_timeout" | "network_error" | "upstream_error";

export class OAuthProviderCallError extends Error {
  constructor(
    readonly code: OAuthProviderFailureCode,
    readonly failureKind: Exclude<OAuthProviderFailureKind, "client" | "missing_email">,
    readonly retryable: boolean,
    readonly phase: OAuthProviderCallPhase,
    message: string,
    readonly httpStatus?: number,
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "OAuthProviderCallError";
  }
}

export function isRetryableProviderStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function upstreamProviderError(
  phase: OAuthProviderCallPhase,
  provider: string,
  status?: number,
  originalError?: unknown,
  retryableOverride?: boolean,
): OAuthProviderCallError {
  return new OAuthProviderCallError(
    "upstream_error",
    "upstream",
    retryableOverride ?? (status === undefined || isRetryableProviderStatus(status)),
    phase,
    status === undefined
      ? `${provider} returned an invalid response`
      : `${provider} responded ${status}`,
    status,
    originalError,
  );
}

export async function withOAuthProviderTimeout<T>(
  operation: Promise<T>,
  phase: OAuthProviderCallPhase,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = new OAuthProviderCallError(
    "provider_timeout",
    "timeout",
    true,
    phase,
    `OAuth provider ${phase} timed out after ${OAUTH_PROVIDER_TIMEOUT_MS}ms`,
  );
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(timeoutError);
      onTimeout?.();
    }, OAUTH_PROVIDER_TIMEOUT_MS);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchOAuthProviderJson<T>(
  url: string,
  init: RequestInit,
  phase: OAuthProviderCallPhase,
  provider: string,
): Promise<T> {
  const controller = new AbortController();
  const operation = async (): Promise<T> => {
    const response = await fetch(url, { ...init, signal: controller.signal });

    if (!response.ok) {
      throw upstreamProviderError(phase, provider, response.status);
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      throw upstreamProviderError(
        phase,
        provider,
        response.status,
        error,
        true,
      );
    }
  };

  try {
    return await withOAuthProviderTimeout(
      operation(),
      phase,
      () => controller.abort(),
    );
  } catch (error) {
    if (error instanceof OAuthProviderCallError) throw error;
    throw new OAuthProviderCallError(
      "network_error",
      "network",
      true,
      phase,
      `OAuth provider ${phase} network failure`,
      undefined,
      error,
    );
  }
}
