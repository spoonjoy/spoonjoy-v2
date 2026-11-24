// The meal plan: a week of recipes and notes, day by day. Behind the meal-planner flag until it ships.
import { data, Form as RouterForm, useActionData, useLoaderData } from "react-router";
import type { Route } from "./+types/plan";
import { isFlagOn } from "~/domains/platform";
import { addDays, addPlannedMealsToList, getWeek, parseLocalDate, prismaPlanStore, type PlanActionAnswer, plannableRecipes } from "~/domains/planning";
import { getCloudflareEnv, getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { shoppingListRecipeAdder } from "~/lib/shopping-list.server";
import { d1UnavailableWebResponse, formWriteToken } from "~/lib/d1-write-retry.server";
import { changePlanEntry, planFieldsOf, planRefused } from "~/lib/plan-route.server";
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";
import { useWriteToken } from "~/hooks/use-write-token";
import { CookbookPage } from "~/components/cookbook/page";
import { Button } from "~/components/ouro/button/button";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { WeekLinks, WeekListAnswer, WeekPlan } from "~/components/plan/week-plan";
import { weekFormKey, weekTitle } from "~/components/plan/week";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Meal plan - Spoonjoy" },
    { name: "description", content: "Plan the week's meals: recipes and notes, day by day." },
  ];
}

async function plannerUser(request: Request, context: Route.LoaderArgs["context"]) {
  const env = getCloudflareEnv(context);
  const userId = await requireUserId(request, "/login", env);
  if (!isFlagOn("meal-planner", env, userId)) throw new Response("Not found", { status: 404 });
  return userId;
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
  return { week, recipes, chosenRecipeId };
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
  const store = prismaPlanStore(await getRequestDb(context));
  try {
    if (intent === "add-week-to-list") {
      const day = parseLocalDate(fields.week);
      if (!day) return planRefused(intent, "Choose a week to shop for.");
      const { start } = await getWeek(store, { cook: userId }, day);
      const listToken = formWriteToken(fields.listToken) ?? crypto.randomUUID();
      const list = await shoppingListRecipeAdder(context, userId);
      const added = await addPlannedMealsToList(store, list, { cook: userId }, { from: start, to: addDays(start, 6) }, `plan-week:${start}:${listToken}`);
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
  const { week, recipes, chosenRecipeId } = useLoaderData<typeof loader>();
  const answer = useActionData<PlanActionAnswer>();
  const [listToken] = useWriteToken();

  return (
    <CookbookPage>
      <PageHeader eyebrow="Meal plan" title={weekTitle(week.start)} size="lg" divider description="Plan the week's meals: a recipe to cook, or a note like eating out.">
        <div className="mt-4 flex flex-wrap gap-2">
          <WeekLinks basePath="/plan" start={week.start} />
          <RouterForm method="post">
            <input type="hidden" name="intent" value="add-week-to-list" />
            <input type="hidden" name="week" value={week.start} />
            <input type="hidden" name="listToken" value={`${listToken}-${weekFormKey(week)}`} />
            <Button type="submit" size="sm">Add this week to my list</Button>
          </RouterForm>
        </div>
        <WeekListAnswer answer={answer} />
      </PageHeader>
      <WeekPlan week={week} recipes={recipes} chosenRecipeId={chosenRecipeId} answer={answer} canEdit />
    </CookbookPage>
  );
}
