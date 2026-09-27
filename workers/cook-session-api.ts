// Worker side of cook-session protocol v1 for the operations this slice implements: read one
// session (`GET /api/cook-sessions/:recipeId`), start or resume it (`POST .../start`), and write
// revision-checked progress (`PATCH /api/cook-sessions/:recipeId`). workers/app.ts has already
// authenticated the caller and applied the scope and Origin checks before calling in here.
//
// One CookSession Durable Object per (user, recipe) is the server of record. The Worker checks
// the recipe in D1 (it exists, is not deleted, and every submitted id belongs to it) so the
// object never has to trust client-supplied recipe content.
import {
  COOK_INTERNAL_ORIGIN,
  COOK_PROTOCOL_HEADER,
  COOK_SESSION_PREFIX,
  MAX_COOK_PATCH_BYTES,
  cookErrorResponse,
  cookProtocolUnavailableResponse,
  isCookRecipeId,
  parseCookPatchBody,
  type CookPatchBody,
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
  stepCount: number;
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
    db.prepare('SELECT COUNT(*) AS stepCount FROM "RecipeStep" WHERE recipeId = ?').bind(recipeId).first<{ stepCount: number }>(),
    db.prepare('SELECT id FROM "Ingredient" WHERE recipeId = ?').bind(recipeId).all<{ id: string }>(),
    db.prepare('SELECT id FROM "StepOutputUse" WHERE recipeId = ?').bind(recipeId).all<{ id: string }>(),
  ]);
  return {
    stepCount: steps!.stepCount,
    ingredientIds: new Set(ingredients.results.map(({ id }) => id)),
    stepOutputIds: new Set(stepOutputs.results.map(({ id }) => id)),
  };
}

/** True when every submitted id and the step index exist in the recipe as it is now. */
export function changesFitRecipe({ changes }: CookPatchBody, bounds: CookRecipeBounds): boolean {
  const lastStepIndex = Math.max(bounds.stepCount - 1, 0);
  return (changes.activeStepIndex === undefined || changes.activeStepIndex <= lastStepIndex) &&
    (changes.checkedIngredientIds ?? []).every((id) => bounds.ingredientIds.has(id)) &&
    (changes.checkedStepOutputIds ?? []).every((id) => bounds.stepOutputIds.has(id));
}

async function readBoundedText(request: Request): Promise<string | null> {
  const text = await request.text();
  return new TextEncoder().encode(text).byteLength > MAX_COOK_PATCH_BYTES ? null : text;
}

async function forwardToCookSession(
  namespace: NonNullable<CloudflareEnvironment["COOK_SESSIONS"]>,
  userId: string,
  recipeId: string,
  method: string,
  suffix: string,
  body?: string,
): Promise<Response> {
  const stub = namespace.get(namespace.idFromName(cookSessionObjectName(userId, recipeId)));
  const headers = new Headers({ [COOK_PROTOCOL_HEADER]: "1" });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const response = await stub.fetch(new Request(
    `${COOK_INTERNAL_ORIGIN}${COOK_SESSION_PREFIX}/${recipeId}${suffix}`,
    { method, headers, body },
  ));
  // Copy into a fresh Response so the Worker can add its security and version headers.
  return new Response(response.body, { status: response.status, headers: response.headers });
}

export async function handleCookSessionProtocolRequest(
  request: Request,
  env: CloudflareEnvironment,
  userId: string,
  operation: CookProtocolOperation,
): Promise<Response> {
  const recipeId = new URL(request.url).pathname.split("/")[3];
  if (!isCookRecipeId(recipeId)) return recipeNotFound();
  if (!env.COOK_SESSIONS) return cookProtocolUnavailableResponse();
  // Authentication already read D1, so the binding is present here.
  const db = env.DB as unknown as CookD1Database;

  if (operation === "detail") {
    return forwardToCookSession(env.COOK_SESSIONS, userId, recipeId, "GET", "");
  }

  const text = await readBoundedText(request);
  if (operation === "start") {
    if (text !== "" && text !== "{}") return invalidRequest();
    if (!await recipeExists(db, recipeId)) return recipeNotFound();
    return forwardToCookSession(env.COOK_SESSIONS, userId, recipeId, "POST", "/start");
  }

  const body = text === null ? null : parseCookPatchBody(text);
  if (!body) return invalidRequest();
  if (!await recipeExists(db, recipeId)) return recipeNotFound();
  if (!changesFitRecipe(body, await recipeBounds(db, recipeId))) return invalidRequest();
  return forwardToCookSession(env.COOK_SESSIONS, userId, recipeId, "PATCH", "", JSON.stringify(body));
}
