// A meal plan's private calendar feed, which a calendar app subscribes to by its link. The token in the path is the only
// key: no session, so it works from any calendar app. Behind the meal-planner flag for the plan's cook.
import type { Route } from "./+types/calendar.$feed";
import { isFlagOn } from "~/domains/platform";
import { feedForToken, prismaFeedLinkStore, prismaPlanStore } from "~/domains/planning";
import { getCloudflareEnv, getRequestDb } from "~/lib/route-platform.server";
import { resolveIssuerOrigin } from "~/lib/oauth-metadata.server";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = getCloudflareEnv(context);
  const db = await getRequestDb(context);
  const url = new URL(request.url);
  const feed = await feedForToken(prismaPlanStore(db), prismaFeedLinkStore(db), {
    token: params.feed.replace(/\.ics$/, ""),
    params: url.searchParams,
    origin: resolveIssuerOrigin(request.url, env?.SPOONJOY_BASE_URL),
    now: new Date(),
  });
  if (!feed || !isFlagOn("meal-planner", env, feed.ownerId)) throw new Response("Not found", { status: 404 });
  return new Response(feed.calendar, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="meal-plan.ics"',
      // The link is a secret: no shared cache keeps it, and no search engine lists it.
      "Cache-Control": "private, max-age=900",
      "X-Robots-Tag": "noindex",
    },
  });
}
