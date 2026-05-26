import type { Route } from "./+types/api.push.subscriptions";
import { getRequestDb } from "~/lib/route-platform.server";
import { getUserId } from "~/lib/session.server";

function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

interface SubscribeBody {
  endpoint: unknown;
  keys?: { p256dh?: unknown; auth?: unknown } | unknown;
  userAgent?: unknown;
}

interface UnsubscribeBody {
  endpoint: unknown;
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

  if (request.method === "POST") {
    const body = (await parseJson(request)) as SubscribeBody | null;
    if (!body) return jsonError(400, "Invalid JSON body");
    const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
    if (!endpoint) return jsonError(400, "endpoint is required");
    const keys = (body.keys ?? null) as { p256dh?: unknown; auth?: unknown } | null;
    const p256dh = keys && typeof keys.p256dh === "string" ? keys.p256dh : "";
    const auth = keys && typeof keys.auth === "string" ? keys.auth : "";
    if (!p256dh || !auth) return jsonError(400, "keys.p256dh and keys.auth are required");
    const userAgent = typeof body.userAgent === "string" ? body.userAgent : null;

    const db = await getRequestDb(context);
    const existing = await db.pushSubscription.findUnique({
      where: { endpoint },
      select: { id: true, userId: true },
    });
    if (existing && existing.userId === userId) {
      await db.pushSubscription.update({
        where: { id: existing.id },
        data: { p256dh, authSecret: auth, userAgent, lastSeenAt: new Date() },
      });
      return Response.json({ ok: true, created: false }, { status: 200 });
    }
    if (existing && existing.userId !== userId) {
      // Endpoint owned by someone else (e.g. user switched accounts on the same device).
      // Re-assign to the current user — endpoints are device-scoped, not user-scoped.
      await db.pushSubscription.update({
        where: { id: existing.id },
        data: { userId, p256dh, authSecret: auth, userAgent, lastSeenAt: new Date() },
      });
      return Response.json({ ok: true, created: false }, { status: 200 });
    }
    await db.pushSubscription.create({
      data: { userId, endpoint, p256dh, authSecret: auth, userAgent },
    });
    return Response.json({ ok: true, created: true }, { status: 201 });
  }

  if (request.method === "DELETE") {
    const body = (await parseJson(request)) as UnsubscribeBody | null;
    if (!body) return jsonError(400, "Invalid JSON body");
    const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
    if (!endpoint) return jsonError(400, "endpoint is required");
    const db = await getRequestDb(context);
    const row = await db.pushSubscription.findUnique({
      where: { endpoint },
      select: { id: true, userId: true },
    });
    if (!row || row.userId !== userId) return jsonError(404, "Subscription not found");
    await db.pushSubscription.delete({ where: { id: row.id } });
    return new Response(null, { status: 204 });
  }

  return jsonError(405, `Method ${request.method} not allowed`);
}
