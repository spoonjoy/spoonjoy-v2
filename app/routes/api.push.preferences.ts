import type { Route } from "./+types/api.push.preferences";
import { getRequestDb } from "~/lib/route-platform.server";
import { getUserId } from "~/lib/session.server";

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
  const pref = await db.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...patch },
    update: patch,
  });

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
