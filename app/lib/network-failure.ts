import type { ShouldRevalidateFunctionArgs } from "react-router";

// A form submission whose request never got an answer (the connection dropped or was refused, as
// in Journeys run 39838941793, where a TLS handshake to the server was reset). Without this, React
// Router renders the root error boundary and the cook loses the page and what they typed.
export const NETWORK_FAILURE_MESSAGE = "Spoonjoy couldn't be reached. Check your connection and try again.";

export interface NetworkFailureResult {
  intent: string | null;
  error: string;
  errorCode: "network_failure";
  retryable: true;
}

// fetch rejects with a TypeError only when no response arrived. A server error reaches the client
// as a plain Error (React Router sanitizes it) or an error response, never as a TypeError.
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

export function isNetworkFailureResult(value: unknown): value is NetworkFailureResult {
  return typeof value === "object" && value !== null && (value as { errorCode?: unknown }).errorCode === "network_failure";
}

export const NETWORK_RETRY_DELAY_MS = 300;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs a route's server action from its clientAction. A submission that got no answer is sent once
 * more when `retry` says the intent is idempotent (the same request applied twice leaves the same
 * result). If that fails too, or the intent is not idempotent, it returns a NetworkFailureResult
 * the page shows where the cook acted, instead of throwing to the error boundary.
 */
export async function submitWithNetworkRetry<T>(
  serverAction: () => Promise<T>,
  { intent, retry, sleep = defaultSleep }: { intent: string | null; retry: boolean; sleep?: (ms: number) => Promise<void> },
): Promise<T | NetworkFailureResult> {
  try {
    return await serverAction();
  } catch (error) {
    if (!isNetworkFailure(error)) throw error;
    if (retry) {
      await sleep(NETWORK_RETRY_DELAY_MS);
      try {
        return await serverAction();
      } catch (retryError) {
        if (!isNetworkFailure(retryError)) throw retryError;
      }
    }
    return { intent, error: NETWORK_FAILURE_MESSAGE, errorCode: "network_failure", retryable: true };
  }
}

// After a submission that got no answer, reloading the page's data would most likely fail the same
// way and replace the page with the error boundary, so the data stays as it is.
export function revalidateUnlessNetworkFailure(
  { actionResult }: Pick<ShouldRevalidateFunctionArgs, "actionResult">,
  otherwise: boolean,
): boolean {
  return isNetworkFailureResult(actionResult) ? false : otherwise;
}
