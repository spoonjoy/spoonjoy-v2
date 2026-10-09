// QA is a shared Worker in front of D1 and R2, and now and then it answers one request with a
// gateway error or drops the connection (a 502, 503 or 504 response, ECONNRESET, a reset
// connection). That says nothing about the app under test, so a navigation that hits one is tried
// once more. Nothing else is retried: an assertion failure, a timeout, a 404 or a 500 is a real
// result and fails the test on the first attempt.

const TRANSIENT_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_ERROR = /ECONNRESET|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|NS_ERROR_NET_RESET|NS_ERROR_NET_INTERRUPT|socket hang up/i;

export function isTransientQaStatus(status: number): boolean {
  return TRANSIENT_STATUSES.has(status);
}

export function isTransientQaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_ERROR.test(message);
}

/**
 * Runs `attempt`; if it threw a transient connection error or returned a response with a
 * transient status, runs it once more and returns that second outcome (result or error).
 */
export async function retryOnceOnQaNoise<T extends { status(): number } | null>(attempt: () => Promise<T>): Promise<T> {
  try {
    const response = await attempt();
    if (response && isTransientQaStatus(response.status())) return await attempt();
    return response;
  } catch (error) {
    if (!isTransientQaError(error)) throw error;
    return attempt();
  }
}
