// Shared cook-session protocol v1 pieces used by both the Worker (public HTTP surface) and the
// CookSession Durable Object (server of record): the internal request header, the progress
// shape and its validation, and the JSON/error envelopes. Kept free of Cloudflare bindings so it
// can be imported from either side.

export const COOK_INTERNAL_ORIGIN = "https://cook-session.internal";
export const COOK_PROTOCOL_HEADER = "X-Spoonjoy-Cook-Protocol";
export const COOK_SESSION_PREFIX = "/api/cook-sessions";
/**
 * Optional request header naming the user the caller believes it is acting for. The web client
 * always sends it: tabs share one session cookie, so a tab opened as one account can outlive a
 * sign-in as another in a different tab. A mismatch answers 412 `user_mismatch`.
 */
export const COOK_EXPECTED_USER_HEADER = "X-Spoonjoy-Cook-User";

export const MIN_COOK_SCALE = 0.25;
export const MAX_COOK_SCALE = 50;
export const MAX_COOK_STEP_INDEX = 10_000;
export const MAX_CHECKED_IDS = 500;
export const MAX_COOK_ID_LENGTH = 128;
/** Upper bound on a PATCH body; 500 ids of 128 characters each fit comfortably. */
export const MAX_COOK_PATCH_BYTES = 128 * 1024;

const RECIPE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ATTEMPT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MUTATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const PATCH_KEYS = ["attemptId", "changes", "expectedRevision", "mutationId"];
const CHANGE_KEYS = new Set(["activeStepIndex", "scaleFactor", "checkedIngredientIds", "checkedStepOutputIds"]);

export interface CookProgress {
  activeStepIndex: number;
  scaleFactor: number;
  checkedIngredientIds: string[];
  checkedStepOutputIds: string[];
}

export type CookProgressChanges = Partial<CookProgress>;

export interface CookPatchBody {
  attemptId: string;
  expectedRevision: number;
  mutationId: string;
  changes: CookProgressChanges;
}

export interface CookState {
  version: 1;
  recipeId: string;
  attemptId: string;
  status: "active";
  revision: number;
  progress: CookProgress;
  startedAt: string;
  updatedAt: string;
  terminalAt: null;
}

export function isCookRecipeId(value: string): boolean {
  return RECIPE_ID_PATTERN.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length <= MAX_CHECKED_IDS &&
    value.every((id) => typeof id === "string" && id.length > 0 && id.length <= MAX_COOK_ID_LENGTH) &&
    new Set(value).size === value.length;
}

function parseChanges(value: unknown): CookProgressChanges | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => !CHANGE_KEYS.has(key))) return null;

  const changes: CookProgressChanges = {};
  if ("activeStepIndex" in value) {
    const index = value.activeStepIndex;
    if (!Number.isSafeInteger(index) || (index as number) < 0 || (index as number) > MAX_COOK_STEP_INDEX) return null;
    changes.activeStepIndex = index as number;
  }
  if ("scaleFactor" in value) {
    const scale = value.scaleFactor;
    if (typeof scale !== "number" || !Number.isFinite(scale) || scale < MIN_COOK_SCALE || scale > MAX_COOK_SCALE) {
      return null;
    }
    changes.scaleFactor = scale;
  }
  if ("checkedIngredientIds" in value) {
    if (!isIdList(value.checkedIngredientIds)) return null;
    changes.checkedIngredientIds = [...value.checkedIngredientIds];
  }
  if ("checkedStepOutputIds" in value) {
    if (!isIdList(value.checkedStepOutputIds)) return null;
    changes.checkedStepOutputIds = [...value.checkedStepOutputIds];
  }
  return changes;
}

/**
 * Parses a PATCH body. It must contain exactly `attemptId`, `expectedRevision`, `mutationId`, and
 * a nonempty `changes` object drawn from the four progress fields; anything else is rejected.
 */
export function parseCookPatchBody(text: string): CookPatchBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const keys = Object.keys(parsed).sort();
  if (keys.length !== PATCH_KEYS.length || keys.some((key, index) => key !== PATCH_KEYS[index])) return null;

  const { attemptId, expectedRevision, mutationId } = parsed;
  if (typeof attemptId !== "string" || !ATTEMPT_ID_PATTERN.test(attemptId)) return null;
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) return null;
  if (typeof mutationId !== "string" || !MUTATION_ID_PATTERN.test(mutationId)) return null;
  const changes = parseChanges(parsed.changes);
  if (!changes) return null;

  return { attemptId, expectedRevision: expectedRevision as number, mutationId, changes };
}

export function cookJsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export function cookErrorResponse(
  status: number,
  code: string,
  message: string,
  options: { retryable?: boolean; state?: CookState } = {},
): Response {
  const error: Record<string, unknown> = { code, message, retryable: options.retryable ?? false };
  if (options.state) error.state = options.state;
  return cookJsonResponse({ error }, status);
}

export function cookProtocolUnavailableResponse(): Response {
  const response = cookErrorResponse(
    503,
    "cook_session_protocol_unavailable",
    "Cook session protocol is temporarily unavailable.",
    { retryable: true },
  );
  response.headers.set("Retry-After", "1");
  return response;
}
