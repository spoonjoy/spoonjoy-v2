// What the Move in page and its upload endpoints share: the gate (signed in, with the move_in flag
// on, on a Worker that has the database and photo storage), the same-origin rule for the endpoints,
// and starting a move-in once its job exists: on the jobs queue where there is one, otherwise in the
// request's waitUntil.
import type { AppLoadContext } from "react-router";
import {
  MOVE_IN_ERROR_MESSAGES,
  UPLOAD_REFUSAL_MESSAGES,
  moveInEnv,
  moveInPorts,
  runForAWhile,
  startMoveInJob,
  type MoveInEnv,
  type MoveInErrorCode,
  type UploadRefusal,
} from "~/domains/move-in";
import { isFlagOn } from "~/domains/platform";
import { cloudflarePlatform } from "~/domains/platform/index.server";
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";
import { resolveIssuerOrigin } from "~/lib/oauth-metadata.server";
import { getCloudflareEnv } from "~/lib/route-platform.server";
import { getUserId, requireUserId } from "~/lib/session.server";

/** How long one request keeps a move-in running after it answers; a Worker allows about 30 seconds. */
const RUN_BUDGET_MS = 20_000;

export interface MoveInGate {
  userId: string;
  env: MoveInEnv;
  workerEnv: Env;
  /** The jobs port, or null where the Worker has no queue and the page keeps the move-in running. */
  jobs: ReturnType<typeof cloudflarePlatform>["jobs"] | null;
}

/**
 * Lets in a signed-in person with the move_in flag on. The page sends a signed-out visitor to sign in; an endpoint
 * (`signedOut: "401"`) answers 401, since the page's script can't follow a sign-in page.
 */
export async function signedInWithFlag(request: Request, context: AppLoadContext, { signedOut = "redirect" }: { signedOut?: "redirect" | "401" } = {}): Promise<MoveInGate> {
  const env = getCloudflareEnv(context);
  const userId = signedOut === "redirect" ? await requireUserId(request, "/login", env) : await getUserId(request, env);
  if (!userId) throw Response.json({ error: "Sign in to move in." }, { status: 401 });
  if (!isFlagOn("move_in", env, userId)) throw new Response("Not found", { status: 404 });
  const moveIn = moveInEnv(env);
  if (!env || !moveIn) throw new Response("Move-in needs its database and photo storage, and this server has neither.", { status: 503 });
  // The jobs port is always there and only refuses on enqueue, so without a queue the page runs the move-in itself.
  const jobs = env.JOBS ? cloudflarePlatform(env).jobs : null;
  return { userId, env: moveIn, workerEnv: env, jobs };
}

/**
 * Whether a request to an upload endpoint names another site as its origin (or the opaque "null" one), which
 * is refused. Browsers send Origin with every POST, PUT and DELETE. Spoonjoy's own origin is the configured public
 * site (SPOONJOY_BASE_URL), as for sign-out (app/routes/logout.tsx), and the request's own origin also counts, for QA
 * and local hosts. The session cookie is SameSite=Lax and the endpoints take JSON, PUT and DELETE, none of which a
 * page elsewhere can send without asking first; this check makes the rule explicit.
 */
export function isCrossOrigin(request: Request, baseUrl: string | undefined): boolean {
  const origin = request.headers.get("Origin");
  if (origin === null || origin === new URL(request.url).origin) return false;
  if (baseUrl && !URL.canParse(baseUrl)) return true;
  return origin !== resolveIssuerOrigin(request.url, baseUrl);
}

/** Reports a move-in that couldn't run or be queued; the page's next poll tries again. */
export async function reportMoveIn(workerEnv: Env, userId: string, phase: "run" | "queue", error: unknown) {
  await captureException(resolvePostHogServerConfig(workerEnv), {
    error,
    distinctId: userId,
    route: "/move-in",
    extras: { phase },
  });
}

/** Keeps the move-in running after the response, inside the request's waitUntil. */
export function keepRunning(context: AppLoadContext, { env, workerEnv }: Pick<MoveInGate, "env" | "workerEnv">, jobId: string, userId: string) {
  const ctx = context.cloudflare?.ctx;
  if (!ctx) return;
  // The page's next poll resumes the move-in; the report says how often runs stop, and why.
  const run = runForAWhile(jobId, moveInPorts(env, () => new Date()), { budgetMs: RUN_BUDGET_MS }).catch((error: unknown) => reportMoveIn(workerEnv, userId, "run", error));
  ctx.waitUntil(run);
}

/** Starts a new move-in's job. One that couldn't be queued waits for the page, which queues it once it has been quiet a while. */
export async function startQueuedMoveIn(context: AppLoadContext, gate: MoveInGate, jobId: string) {
  if (gate.jobs) await startMoveInJob(gate.jobs, jobId).catch((error: unknown) => reportMoveIn(gate.workerEnv, gate.userId, "queue", error));
  else keepRunning(context, gate, jobId, gate.userId);
}

const NO_STORE = { "Cache-Control": "no-store" };

/** A JSON answer from an upload endpoint, never cached. */
export function uploadAnswer(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

const REFUSAL_STATUS: Partial<Record<MoveInErrorCode | UploadRefusal, number>> = {
  "backup-too-large": 413,
  "upload-gone": 404,
  "missing-parts": 409,
  finished: 409,
};

/** An upload step that was turned away, with its plain message, its code for the page, and the parts still missing. */
export function uploadRefused({ code, missing }: { code: MoveInErrorCode | UploadRefusal; missing?: number[] }): Response {
  const error = code in UPLOAD_REFUSAL_MESSAGES ? UPLOAD_REFUSAL_MESSAGES[code as UploadRefusal] : MOVE_IN_ERROR_MESSAGES[code as MoveInErrorCode];
  return uploadAnswer({ error, code, ...(missing ? { missing } : {}) }, REFUSAL_STATUS[code] ?? 400);
}

/**
 * Runs an upload endpoint for one of the methods it takes: refuses another site's request, then lets in only who
 * the Move in page lets in.
 */
export async function uploadEndpoint(
  { request, context }: { request: Request; context: AppLoadContext },
  methods: readonly string[],
  handle: (gate: MoveInGate) => Promise<Response>,
): Promise<Response> {
  if (!methods.includes(request.method)) return new Response(null, { status: 405, headers: { ...NO_STORE, Allow: methods.join(", ") } });
  if (isCrossOrigin(request, getCloudflareEnv(context)?.SPOONJOY_BASE_URL)) return uploadAnswer({ error: "Uploads must come from Spoonjoy's own Move in page." }, 403);
  return handle(await signedInWithFlag(request, context, { signedOut: "401" }));
}

/** The JSON object a request sends, or null when it sends none: a request that isn't JSON is refused before it is read. */
export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return null;
  const body: unknown = await request.json().catch(() => null);
  return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
