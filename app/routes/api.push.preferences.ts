import type { Route } from "./+types/api.push.preferences";
import { getRequestDb } from "~/lib/route-platform.server";
import { getUserId } from "~/lib/session.server";
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";

const PREFERENCE_KEYS = [
  "notifySpoonOnMyRecipe",
  "notifyForkOfMyRecipe",
  "notifyCookbookSaveOfMine",
  "notifyFellowChefOriginCook",
] as const;

type PreferenceKey = (typeof PREFERENCE_KEYS)[number];

function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

async function parseJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (!text.trim()) return {};
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const userId = await getUserId(request, context.cloudflare?.env);
  if (!userId) return jsonError(401, "Authentication required");

  if (request.method !== "PATCH") {
    return jsonError(405, `Method ${request.method} not allowed`);
  }

  const body = await parseJson(request);
  if (!body) return jsonError(400, "Invalid JSON body");

  const patch: Partial<Record<PreferenceKey, boolean>> = {};
  for (const key of PREFERENCE_KEYS) {
    if (key in body) {
      const value = body[key];
      if (typeof value !== "boolean") {
        return jsonError(400, `${key} must be a boolean`);
      }
      patch[key] = value;
    }
  }

  const db = await getRequestDb(context);
  let pref;
  try {
    pref = await db.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...patch },
      update: patch,
    });
  } catch (error) {
    // The body validated but the preference upsert failed (DB/infra fault). This
    // was previously uncaught — capture it (fire-and-forget, no-op without
    // PostHog) before flattening to a 500 the user sees as a generic failure.
    capturePreferencesFailure(request, context, userId, error);
    return jsonError(500, "Failed to update notification preferences");
  }

  return Response.json(
    {
      notifySpoonOnMyRecipe: pref.notifySpoonOnMyRecipe,
      notifyForkOfMyRecipe: pref.notifyForkOfMyRecipe,
      notifyCookbookSaveOfMine: pref.notifyCookbookSaveOfMine,
      notifyFellowChefOriginCook: pref.notifyFellowChefOriginCook,
    },
    { status: 200 },
  );
}

function capturePreferencesFailure(
  request: Request,
  context: Route.ActionArgs["context"],
  userId: string,
  error: unknown,
): void {
  const postHogConfig = resolvePostHogServerConfig(context.cloudflare?.env ?? {});
  if (!postHogConfig.enabled) return;
  const capture = captureException(postHogConfig, {
    error,
    distinctId: userId,
    route: new URL(request.url).pathname,
    method: request.method,
    extras: { action: "update_push_preferences" },
  });
  const waitUntil = context.cloudflare?.ctx?.waitUntil;
  if (waitUntil) {
    waitUntil.call(context.cloudflare!.ctx!, capture);
  } else {
    void capture;
  }
}
