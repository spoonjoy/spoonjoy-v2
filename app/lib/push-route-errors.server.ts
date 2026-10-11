import {
  D1_WRITE_UNAVAILABLE_CODE,
  D1_WRITE_UNAVAILABLE_MESSAGE,
  d1UnavailableHeaders,
  isD1Unavailable,
} from "~/lib/d1-write-retry.server";

/**
 * The JSON answer of the browser's push endpoints when the database was briefly unavailable: a
 * retryable 503 with Retry-After, so the page can try again, instead of a 500. Null for any other
 * error.
 */
export function d1UnavailableJsonResponse(error: unknown): Response | null {
  if (!isD1Unavailable(error)) return null;
  return Response.json(
    { error: D1_WRITE_UNAVAILABLE_MESSAGE, errorCode: D1_WRITE_UNAVAILABLE_CODE, retryable: true },
    { status: 503, headers: d1UnavailableHeaders() },
  );
}
