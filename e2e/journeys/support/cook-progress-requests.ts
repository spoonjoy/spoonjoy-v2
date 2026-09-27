// The HTTP requests the journeys' cook-progress reset sends, kept free of Playwright so the
// Workers test lane can run exactly these against the real Worker
// (test/workers/cook-session-protocol.test.ts): a change to the cook-session request rules
// that would lock the reset out fails there, not first in CI's journeys.
//
// A browser (cookie) caller must name its user in X-Spoonjoy-Cook-User and send the app's
// Origin on writes, exactly as the recipe page does.

export interface CookProgressResetRequest {
  method: "POST" | "PATCH";
  path: string;
  headers: Record<string, string>;
  body?: string;
}

function headers(userId: string, origin: string, json: boolean): Record<string, string> {
  return {
    Origin: origin,
    "X-Spoonjoy-Cook-User": userId,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

/** Starts (or resumes) the cook's session for the recipe. */
export function cookProgressStartRequest(recipeId: string, userId: string, origin: string): CookProgressResetRequest {
  return { method: "POST", path: `/api/cook-sessions/${recipeId}/start`, headers: headers(userId, origin, false) };
}

/** Writes nothing checked, 1×, first step over the session `start` returned. */
export function cookProgressResetRequest(
  recipeId: string,
  userId: string,
  origin: string,
  session: { attemptId: string; revision: number },
  mutationId: string,
): CookProgressResetRequest {
  return {
    method: "PATCH",
    path: `/api/cook-sessions/${recipeId}`,
    headers: headers(userId, origin, true),
    body: JSON.stringify({
      attemptId: session.attemptId,
      expectedRevision: session.revision,
      mutationId,
      changes: { activeStepIndex: 0, scaleFactor: 1, checkedIngredientIds: [], checkedStepOutputIds: [] },
    }),
  };
}
