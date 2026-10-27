/**
 * Writes an object to R2, trying again when R2 answers with its own transient failure.
 *
 * R2 sometimes refuses a put with an error that says nothing about the object: "We encountered an
 * internal error. Please try again. (10001)" (Journeys run 40562451574: a chef's account photo
 * upload answered 500), or "(10043)", service unavailable. R2's error codes
 * (developers.cloudflare.com/r2/api/error-codes/) mark both as R2's own failures, to retry. A put
 * of the same body to the same key is idempotent, and every caller here writes a new random key,
 * so a second try can only store the object the first was meant to. Any other error, and the last
 * try's error, reaches the caller unchanged.
 *
 * The body must be one R2 can send twice: bytes or a Blob, never a stream.
 */

const TRANSIENT_R2_CODE = /\((?:10001|10043)\)\s*$/;

export const DEFAULT_R2_PUT_RETRY_DELAYS_MS: readonly number[] = [100, 400];

export interface R2PutRetryOptions {
  /** Delays before each further try, in milliseconds. Its length is the number of further tries. */
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

/** True when R2 refused the call with its own internal error or unavailability. */
export function isTransientR2Error(error: unknown): boolean {
  return error instanceof Error && TRANSIENT_R2_CODE.test(error.message);
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function putWithTransientRetry(
  bucket: Pick<R2Bucket, "put">,
  key: string,
  value: Blob | ArrayBuffer | ArrayBufferView,
  options: Parameters<R2Bucket["put"]>[2],
  { delaysMs = DEFAULT_R2_PUT_RETRY_DELAYS_MS, sleep = realSleep }: R2PutRetryOptions = {},
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await bucket.put(key, value, options);
      return;
    } catch (error) {
      if (attempt >= delaysMs.length || !isTransientR2Error(error)) throw error;
      await sleep(delaysMs[attempt]);
    }
  }
}
