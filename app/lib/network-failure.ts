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
  // The submitted fields, when the intent is idempotent (the same request applied twice leaves the
  // same result), for the page to send once more as a new request (useResendLostSubmission).
  resend: Record<string, string> | null;
}

// fetch rejects with a TypeError when no response arrived, with one of these messages: Chrome's,
// Safari's, Firefox's, and the reason WebKit on Linux gave in Journeys run 39838941793. A TypeError
// alone is not enough: under `react-router dev` a server error keeps its class and message, so a
// TypeError thrown by the action reaches the client as a TypeError, and that is an answer.
const FETCH_FAILURE_MESSAGES = new Set([
  "Failed to fetch",
  "Load failed",
  "NetworkError when attempting to fetch resource.",
]);
const WEBKIT_LINUX_TLS_FAILURE = "Peer failed to perform TLS handshake";

export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError &&
    (FETCH_FAILURE_MESSAGES.has(error.message) || error.message.startsWith(WEBKIT_LINUX_TLS_FAILURE));
}

export function isNetworkFailureResult(value: unknown): value is NetworkFailureResult {
  return typeof value === "object" && value !== null && (value as { errorCode?: unknown }).errorCode === "network_failure";
}

export const NETWORK_RESEND_DELAY_MS = 300;

/**
 * Runs a route's server action from its clientAction. A submission that got no answer returns a
 * NetworkFailureResult the page shows where the cook acted, instead of throwing to the error
 * boundary. It is not sent again here: React Router's serverAction reads the submission's request
 * body, so a second call on the same request finds it used. The page sends `resend` again instead.
 */
export async function submitOrReportLostRequest<T>(
  serverAction: () => Promise<T>,
  { intent, resend }: { intent: string | null; resend: Record<string, string> | null },
): Promise<T | NetworkFailureResult> {
  try {
    return await serverAction();
  } catch (error) {
    if (!isNetworkFailure(error)) throw error;
    return { intent, error: NETWORK_FAILURE_MESSAGE, errorCode: "network_failure", retryable: true, resend };
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
