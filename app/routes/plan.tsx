// The meal plan: a week of recipes and notes, day by day.
import { data, Form as RouterForm, useActionData, useLoaderData } from "react-router";
import type { Route } from "./+types/plan";
import {
  addDays,
  addPlannedMealsToList,
  feedLinkMadeAt,
  feedLinkUrl,
  getWeek,
  makeFeedLink,
  parseLocalDate,
  prismaFeedLinkStore,
  prismaPlanStore,
  type PlanActionAnswer,
  plannableRecipes,
  revokeFeedLink,
} from "~/domains/planning";
import { getCloudflareEnv, getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { shoppingListRecipeAdder } from "~/lib/shopping-list.server";
import { d1UnavailableWebResponse, retryD1Write } from "~/lib/d1-write-retry.server";
import { resolveIssuerOrigin } from "~/lib/oauth-metadata.server";
import { changePlanEntry, planFieldsOf, planRefused } from "~/lib/plan-route.server";
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";
import { CookbookPage } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { AddWeekButton, WeekLinks, WeekListAnswer, WeekPlan } from "~/components/plan/week-plan";
import { CalendarFeed } from "~/components/plan/calendar-feed";
import { weekTitle, weekToList } from "~/components/plan/week";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Meal plan - Spoonjoy" },
    { name: "description", content: "Plan the week's meals: recipes and notes, day by day." },
  ];
}

async function plannerUser(request: Request, context: Route.LoaderArgs["context"]) {
  const env = getCloudflareEnv(context);
  return requireUserId(request, "/login", env);
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const userId = await plannerUser(request, context);
  const db = await getRequestDb(context);
  const params = new URL(request.url).searchParams;
  const asked = parseLocalDate(params.get("week"));
  // ?recipe=<id> opens the page to plan that recipe, any chef's the cook may read, so a recipe's page can link here.
  const store = prismaPlanStore(db);
  const [week, { recipes, chosenRecipeId }] = await Promise.all([
    getWeek(store, { cook: userId }, asked),
    plannableRecipes(store, { cook: userId }, params.get("recipe")),
  ]);
  // After the week, which makes a new cook's plan, so two lookups never both try to make it.
  const feedMadeAt = await feedLinkMadeAt(store, prismaFeedLinkStore(db), userId);
  return { week, recipes, chosenRecipeId, feedMadeAt: feedMadeAt?.toISOString() ?? null };
}

/** Reports a failure the plan can't answer to PostHog, without holding up the response. */
function reportFailure(context: Route.ActionArgs["context"], request: Request, userId: string, intent: string, error: unknown) {
  const cloudflare = (context as { cloudflare?: { ctx?: { waitUntil?: (promise: Promise<unknown>) => void } } }).cloudflare;
  // The session check already read this env, so it is there; the fallback only satisfies the type.
  /* istanbul ignore next -- @preserve */
  const config = resolvePostHogServerConfig(getCloudflareEnv(context) ?? {});
  const capture = captureException(config, {
    error,
    distinctId: userId,
    route: new URL(request.url).pathname,
    method: request.method,
    extras: { action: `plan_${intent.replaceAll("-", "_")}` },
  });
  if (cloudflare?.ctx?.waitUntil) cloudflare.ctx.waitUntil(capture);
  else void capture;
}

export async function action({ request, context }: Route.ActionArgs) {
  const userId = await plannerUser(request, context);
  const fields = planFieldsOf(await request.formData());
  const intent = fields.intent ?? "";
  const db = await getRequestDb(context);
  const store = prismaPlanStore(db);
  try {
    if (intent === "make-feed-link") {
      const links = prismaFeedLinkStore(db);
      const replaced = (await feedLinkMadeAt(store, links, userId)) !== null;
      // Each try makes a fresh token and replaces the stored hash, so the token returned is the one that works.
      const token = await retryD1Write({ scope: "calendar_feed.make" }, () => makeFeedLink(store, links, userId));
      const origin = resolveIssuerOrigin(request.url, getCloudflareEnv(context)?.SPOONJOY_BASE_URL);
      return data({ intent, feedUrl: feedLinkUrl(origin, token), replaced });
    }
    if (intent === "revoke-feed-link") {
      const revoked = await retryD1Write({ scope: "calendar_feed.revoke" }, () => revokeFeedLink(store, prismaFeedLinkStore(db), userId));
      return data({ intent, revoked });
    }
    if (intent === "add-week-to-list") {
      const day = parseLocalDate(fields.week);
      if (!day) return planRefused(intent, "Choose a week to shop for.");
      const { start } = await getWeek(store, { cook: userId }, day);
      const list = await shoppingListRecipeAdder(context, userId);
      const added = await addPlannedMealsToList(store, list, { cook: userId }, { from: start, to: addDays(start, 6) });
      return data({ intent, added });
    }
    return await changePlanEntry(store, { cook: userId }, userId, fields, "/plan");
  } catch (error) {
    const unavailable = d1UnavailableWebResponse(error, intent);
    if (unavailable) return unavailable;
    reportFailure(context, request, userId, intent, error);
    throw error;
  }
}

export default function PlanPage() {
  const { week, recipes, chosenRecipeId, feedMadeAt } = useLoaderData<typeof loader>();
  const answer = useActionData<PlanActionAnswer>();
  const { planned, left } = weekToList(week);

  return (
    <CookbookPage>
      <PageHeader eyebrow="Meal plan" title={weekTitle(week.start)} size="lg" divider description="Plan the week's meals: a recipe to cook, or a note like eating out.">
        <div className="mt-4 flex flex-wrap gap-2">
          <WeekLinks basePath="/plan" start={week.start} />
          {planned > 0 ? (
            <RouterForm method="post">
              <input type="hidden" name="intent" value="add-week-to-list" />
              <input type="hidden" name="week" value={week.start} />
              <AddWeekButton left={left} />
            </RouterForm>
          ) : null}
          <CalendarFeed madeAt={feedMadeAt} answer={answer} />
        </div>
        <WeekListAnswer answer={answer} />
      </PageHeader>
      <WeekPlan week={week} recipes={recipes} chosenRecipeId={chosenRecipeId} answer={answer} canEdit />
    </CookbookPage>
  );
}
