import { data } from "react-router";

export const PRODUCT_ACTIVATION_PENDING_CODE = "product_activation_pending";
export const PRODUCT_ACTIVATION_PENDING_MESSAGE =
  "Spoonjoy product activation is still completing. Retry shortly.";

const CUTOVER_TOKEN_PATTERN =
  /(?<![A-Za-z0-9_])saved_recipe_cutover_pending(?![A-Za-z0-9_])/;
const MAX_WRAPPER_EDGES = 8;
const WRAPPER_FIELDS = ["message", "cause", "error", "meta", "driverAdapterError"] as const;

function isInspectableWrapper(value: unknown): value is object {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  try {
    return !Array.isArray(value) && !(value instanceof Map);
  } catch {
    return false;
  }
}

export function isSavedRecipeCutoverPendingError(error: unknown): boolean {
  const queue: Array<{ value: unknown; edges: number }> = [{ value: error, edges: 0 }];
  const visited = new WeakSet<object>();

  for (let index = 0; index < queue.length; index += 1) {
    const { value, edges } = queue[index];
    if (typeof value === "string") {
      if (CUTOVER_TOKEN_PATTERN.test(value)) {
        return true;
      }
      continue;
    }

    if (edges >= MAX_WRAPPER_EDGES || !isInspectableWrapper(value) || visited.has(value)) {
      continue;
    }
    visited.add(value);

    for (const field of WRAPPER_FIELDS) {
      try {
        queue.push({
          value: (value as Record<(typeof WRAPPER_FIELDS)[number], unknown>)[field],
          edges: edges + 1,
        });
      } catch {
        // A throwing adapter getter is treated as an absent wrapper field.
      }
    }
  }

  return false;
}

export function productActivationPendingWebResponse(error: unknown) {
  if (!isSavedRecipeCutoverPendingError(error)) {
    return null;
  }

  return data(
    {
      error: {
        code: PRODUCT_ACTIVATION_PENDING_CODE,
        message: PRODUCT_ACTIVATION_PENDING_MESSAGE,
        retryable: true,
      },
    },
    {
      status: 503,
      headers: {
        "Retry-After": "1",
        "Cache-Control": "private, no-store",
      },
    },
  );
}
