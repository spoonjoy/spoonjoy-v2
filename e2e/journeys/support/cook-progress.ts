// Cook progress lives in the signed-in cook's account on QA (cook-session protocol v1), so it
// outlasts a browser context. A journey that changes progress resets its own cook's progress on
// one recipe first, through the same API the recipe page uses: start (or resume) the session, then
// write nothing checked, 1×, first step. `page.request` carries the page context's cookies, so it
// acts as the journey's signed-in cook; like the page, it names that cook in X-Spoonjoy-Cook-User
// (required from cookie callers) and sends the app's Origin. The request shapes live in
// cook-progress-requests.ts, which the Workers test lane runs against the real Worker.
import { expect, type Page } from "@playwright/test";
import { cookProgressResetRequest, cookProgressStartRequest, type CookProgressResetRequest } from "./cook-progress-requests";

function appOrigin(): string {
  const baseUrl = process.env.SPOONJOY_JOURNEYS_BASE_URL;
  if (!baseUrl) throw new Error("SPOONJOY_JOURNEYS_BASE_URL is required to reset cook progress.");
  return new URL(baseUrl).origin;
}

function send(page: Page, request: CookProgressResetRequest) {
  return page.request.fetch(request.path, { method: request.method, headers: request.headers, data: request.body });
}

/** Resets `userId`'s progress on the recipe; `page` must be signed in as that user. */
export async function resetCookProgress(page: Page, recipeId: string, userId: string): Promise<void> {
  const origin = appOrigin();
  const started = await send(page, cookProgressStartRequest(recipeId, userId, origin));
  expect(started.status(), "starting the cook session for the reset").toBeLessThan(300);
  const { state } = (await started.json()) as { state: { attemptId: string; revision: number } };

  const reset = await send(page, cookProgressResetRequest(recipeId, userId, origin, state, `journey-reset-${Date.now()}`));
  expect(reset.status(), "resetting the cook session's progress").toBe(200);
}

export interface SavedCookProgress {
  activeStepIndex: number;
  scaleFactor: number;
  checkedIngredientIds: string[];
  checkedStepOutputIds: string[];
}

// Resolves with the account's progress once a PATCH to this recipe's cook session answers 200
// with progress that `saved` accepts. Start it before the action whose save it waits for, and
// await it after: the page shows a change before it reaches the server, so this, not the status
// text, is what proves a reload or a second browser will see the change.
export async function cookProgressSaved(
  page: Page,
  recipeId: string,
  saved: (progress: SavedCookProgress) => boolean,
): Promise<SavedCookProgress> {
  const response = await page.waitForResponse(async (candidate) => {
    if (
      candidate.request().method() !== "PATCH" ||
      new URL(candidate.url()).pathname !== `/api/cook-sessions/${recipeId}` ||
      candidate.status() !== 200
    ) {
      return false;
    }
    const body = (await candidate.json()) as { state: { progress: SavedCookProgress } };
    return saved(body.state.progress);
  });
  return ((await response.json()) as { state: { progress: SavedCookProgress } }).state.progress;
}
