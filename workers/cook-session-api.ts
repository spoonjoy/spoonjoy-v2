// Worker side of cook-session protocol v1 for the operations this slice implements: read one
// session (`GET /api/cook-sessions/:recipeId`), start or resume it (`POST .../start`), and write
// revision-checked progress (`PATCH /api/cook-sessions/:recipeId`). workers/app.ts has already
// authenticated the caller and applied the scope and Origin checks before calling in here.
//
// One CookSession Durable Object per (user, recipe) is the server of record. The Worker checks
// the recipe in D1 (it exists, is not deleted, the submitted step is one of its steps, and only
// ids that belong to it are passed on) so the object never has to trust client-supplied recipe
// content.
import { recordCookingNow } from "../app/lib/cooking-now.server";
import { d1Binding } from "../app/lib/d1-read.server";
import { isD1Unavailable } from "../app/lib/d1-write-retry.server";
import { qaErrorLogsEnabled } from "../app/lib/qa-error-logs.server";
import { consoleSlowCallReporter, watchSlowCall, type SlowCallReporter } from "../app/lib/slow-call.server";
import {
  COOK_EXPECTED_USER_HEADER,
  COOK_INTERNAL_ORIGIN,
  COOK_PROTOCOL_HEADER,
  COOK_SESSION_PREFIX,
  MAX_COOK_PATCH_BYTES,
  cookErrorResponse,
  cookProtocolUnavailableResponse,
  isCookRecipeId,
  parseCookPatchBody,
  type CookPatchBody,
  type CookState,
} from "./cook-session-protocol";

export type CookProtocolOperation = "detail" | "start" | "patch";

interface CookD1Statement {
  bind(...values: unknown[]): CookD1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}

interface CookD1Database {
  prepare(query: string): CookD1Statement;
}

interface CookRecipeBounds {
  /** The recipe's step ids in step order. */
  stepIds: readonly string[];
  ingredientIds: ReadonlySet<string>;
  stepOutputIds: ReadonlySet<string>;
}

export function cookSessionObjectName(userId: string, recipeId: string): string {
  return `cook-session:v1:${userId}:${recipeId}`;
}

function invalidRequest(): Response {
  return cookErrorResponse(400, "invalid_request", "Cook session request is invalid.");
}

function recipeNotFound(): Response {
  return cookErrorResponse(404, "not_found", "Recipe not found.");
}

async function recipeExists(db: CookD1Database, recipeId: string): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM "Recipe" WHERE id = ? AND deletedAt IS NULL')
    .bind(recipeId)
    .first<{ id: string }>();
  return row !== null;
}

async function recipeBounds(db: CookD1Database, recipeId: string): Promise<CookRecipeBounds> {
  const [steps, ingredients, stepOutputs] = await Promise.all([
    db.prepare('SELECT id FROM "RecipeStep" WHERE recipeId = ? ORDER BY stepNum').bind(recipeId).all<{ id: string }>(),
    db.prepare('SELECT id FROM "Ingredient" WHERE recipeId = ?').bind(recipeId).all<{ id: string }>(),
    db.prepare('SELECT id FROM "StepOutputUse" WHERE recipeId = ?').bind(recipeId).all<{ id: string }>(),
  ]);
  return {
    stepIds: steps.results.map(({ id }) => id),
    ingredientIds: new Set(ingredients.results.map(({ id }) => id)),
    stepOutputIds: new Set(stepOutputs.results.map(({ id }) => id)),
  };
}

/**
 * True when the submitted step exists in the recipe as it is now. A step named by id is checked by
 * id; its index is worked out again (see `fitChangesToRecipe`).
 */
export function changesFitRecipe({ changes }: CookPatchBody, bounds: CookRecipeBounds): boolean {
  const lastStepIndex = Math.max(bounds.stepIds.length - 1, 0);
  return typeof changes.activeStepId === "string"
    ? bounds.stepIds.includes(changes.activeStepId)
    : changes.activeStepIndex === undefined || changes.activeStepIndex <= lastStepIndex;
}

/**
 * Fits the changes to the recipe as it is now. The caller has already checked the step fits.
 *
 * - Checked ids the recipe no longer has are dropped rather than refused. A client keeps checks
 *   it cannot show (another device made them on another version of the recipe) and sends them
 *   back with its own; refusing the whole list for one id an edit removed would make the client
 *   fall back to trimming the list to its own recipe, and erase the other device's checks.
 * - The step is stored as an id and an index that agree: a step named by id gets that step's
 *   current index (it may have moved since the client loaded the recipe), and a step named only
 *   by index (the native app, older pages) gets the id of the step there.
 */
export function fitChangesToRecipe(body: CookPatchBody, bounds: CookRecipeBounds): CookPatchBody {
  const changes = { ...body.changes };
  if (changes.checkedIngredientIds) {
    changes.checkedIngredientIds = changes.checkedIngredientIds.filter((id) => bounds.ingredientIds.has(id));
  }
  if (changes.checkedStepOutputIds) {
    changes.checkedStepOutputIds = changes.checkedStepOutputIds.filter((id) => bounds.stepOutputIds.has(id));
  }
  if (typeof changes.activeStepId === "string") {
    changes.activeStepIndex = bounds.stepIds.indexOf(changes.activeStepId);
  } else if (changes.activeStepIndex !== undefined) {
    changes.activeStepId = bounds.stepIds[changes.activeStepIndex] ?? null;
  }
  return { ...body, changes };
}

// Reads the body with a running byte cap, so an oversized body is refused without buffering it.
async function readBoundedText(request: Request): Promise<string | null> {
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_COOK_PATCH_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_COOK_PATCH_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// The Workers runtime's message for a failure inside Cloudflare, which names no cause of ours.
const CLOUDFLARE_INTERNAL_ERROR = /^internal error; reference = \S+/;

function isCloudflareInternalError(error: Error): boolean {
  return CLOUDFLARE_INTERNAL_ERROR.test(error.message);
}

async function forwardToCookSession(
  namespace: NonNullable<CloudflareEnvironment["COOK_SESSIONS"]>,
  userId: string,
  recipeId: string,
  method: string,
  suffix: string,
  body: string | undefined,
  onSlowCall: SlowCallReporter | undefined,
): Promise<Response> {
  const id = namespace.idFromName(cookSessionObjectName(userId, recipeId));
  const headers = new Headers({ [COOK_PROTOCOL_HEADER]: "1" });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  // A per-run QA Worker reports a call to the object that waits over a second (slow-call.server.ts).
  const send = (attempt: number) => watchSlowCall<Response>(
    { call: "cook_session.fetch", operation: method === "GET" ? "read" : "write", attempt },
    () => namespace.get(id).fetch(new Request(
      `${COOK_INTERNAL_ORIGIN}${COOK_SESSION_PREFIX}/${recipeId}${suffix}`,
      { method, headers, body },
    )),
    onSlowCall,
  );
  // A read, and a start, which resumes the session it finds (startCookSession): a start that
  // already committed answers the same session again. A progress write is never replayed, because
  // it may already have committed and its revision would then be stale.
  const replayable = method === "GET" || suffix === "/start";
  let response: Response;
  try {
    response = await send(1);
  } catch (error) {
    const failure = error as Error & { retryable?: boolean; overloaded?: boolean };
    const marked = error instanceof Error && failure.retryable === true;
    if (!replayable || !(error instanceof Error) || failure.overloaded === true || (!marked && !isCloudflareInternalError(error))) {
      throw error;
    }
    // A reset can leave the old stub broken, so the replay, once, uses a fresh stub. Overloaded
    // objects need less traffic, not more. Cloudflare's own "internal error; reference = …" is
    // replayed whether or not it is marked retryable (Journeys run 40566824130 answered a start
    // 503 on one, and Cloudflare documents no marking for it); `marked` records which it was.
    console.warn(JSON.stringify({ event: "platform_retry", call: method === "GET" ? "cook_session.read" : "cook_session.start", attempt: 2, marked }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    response = await send(2);
  }
  // Copy into a fresh Response so the Worker can add its security and version headers.
  return new Response(response.body, { status: response.status, headers: response.headers });
}

function isCookState(value: unknown): value is CookState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Partial<CookState>;
  return typeof state.attemptId === "string" &&
    typeof state.revision === "number" &&
    typeof state.progress === "object" && state.progress !== null &&
    Array.isArray(state.progress.checkedIngredientIds) &&
    Array.isArray(state.progress.checkedStepOutputIds);
}

/**
 * After a start or a progress write the object accepted, records the session's state in the
 * cook's Cooking now list (app/lib/cooking-now.server.ts). The write is already in the object, so
 * the answer never depends on this: when D1 stays unavailable or the row cannot be written, the
 * list misses this one write and the next write puts it right.
 */
async function recordCookingNowAfter(
  response: Response,
  env: CloudflareEnvironment,
  userId: string,
  recipeId: string,
): Promise<Response> {
  if (!response.ok) return response;
  const text = await response.text();
  const answer = new Response(text, { status: response.status, headers: response.headers });
  const d1 = d1Binding(env.DB);
  let state: unknown;
  try {
    state = (JSON.parse(text) as { state?: unknown }).state;
  } catch {
    return answer;
  }
  if (!d1 || !isCookState(state)) return answer;
  try {
    await recordCookingNow(d1, {
      userId,
      recipeId,
      attemptId: state.attemptId,
      revision: state.revision,
      activeStepId: state.progress.activeStepId ?? null,
      activeStepIndex: state.progress.activeStepIndex,
      checkedCount: state.progress.checkedIngredientIds.length + state.progress.checkedStepOutputIds.length,
      touchedAt: Date.now(),
    });
  } catch (error) {
    console.warn(JSON.stringify({ event: "cooking_now_record_skipped", unavailable: isD1Unavailable(error) }));
  }
  return answer;
}

export async function handleCookSessionProtocolRequest(
  request: Request,
  env: CloudflareEnvironment,
  userId: string,
  operation: CookProtocolOperation,
  options: { requireExpectedUser: boolean },
): Promise<Response> {
  const expectedUser = request.headers.get(COOK_EXPECTED_USER_HEADER);
  if (expectedUser === null && options.requireExpectedUser) {
    return cookErrorResponse(428, "user_header_required", "Reload the page to keep syncing cook progress.");
  }
  if (expectedUser !== null && expectedUser !== userId) {
    return cookErrorResponse(412, "user_mismatch", "This request was made for a different signed-in user.");
  }
  const recipeId = new URL(request.url).pathname.split("/")[3];
  if (!isCookRecipeId(recipeId)) return recipeNotFound();
  if (!env.COOK_SESSIONS) return cookProtocolUnavailableResponse();
  // Authentication already read D1, so the binding is present here.
  const db = env.DB as unknown as CookD1Database;
  const onSlowCall = qaErrorLogsEnabled(env) ? consoleSlowCallReporter() : undefined;

  if (operation === "detail") {
    return forwardToCookSession(env.COOK_SESSIONS, userId, recipeId, "GET", "", undefined, onSlowCall);
  }

  const text = await readBoundedText(request);
  if (operation === "start") {
    if (text !== "" && text !== "{}") return invalidRequest();
    if (!await recipeExists(db, recipeId)) return recipeNotFound();
    return recordCookingNowAfter(
      await forwardToCookSession(env.COOK_SESSIONS, userId, recipeId, "POST", "/start", undefined, onSlowCall),
      env,
      userId,
      recipeId,
    );
  }

  const body = text === null ? null : parseCookPatchBody(text);
  if (!body) return invalidRequest();
  if (!await recipeExists(db, recipeId)) return recipeNotFound();
  const bounds = await recipeBounds(db, recipeId);
  if (!changesFitRecipe(body, bounds)) return invalidRequest();
  return recordCookingNowAfter(
    await forwardToCookSession(
      env.COOK_SESSIONS, userId, recipeId, "PATCH", "", JSON.stringify(fitChangesToRecipe(body, bounds)), onSlowCall,
    ),
    env,
    userId,
    recipeId,
  );
}
