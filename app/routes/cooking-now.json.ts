import type { Route } from "./+types/cooking-now.json";
import { readCookingNowEntries } from "~/lib/cooking-now-entries.server";
import { getUserId } from "~/lib/session.server";

const HEADERS = { "Cache-Control": "private, no-store" };

// The signed-in cook's Cooking now list for the web's navbar pill and tab badge. Native apps and
// agents use GET /api/v1/cooking-now; this first-party route reads the session cookie the way
// pages do, without the API's token authentication.
export async function loader({ request, context }: Route.LoaderArgs) {
  const userId = await getUserId(request, context.cloudflare?.env);
  if (!userId) return Response.json({ ok: false }, { status: 401, headers: HEADERS });
  return Response.json({ ok: true, data: { recipes: await readCookingNowEntries(context, userId) } }, { headers: HEADERS });
}
