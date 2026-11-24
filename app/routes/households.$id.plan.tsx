// A household's meal plan: the same week as a cook's /plan, kept for the whole household. Owners and members plan and
// remove meals, acting as themselves; view-only members read it. Its recipes are the acting cook's, the ones saved in
// their cookbooks and their household's (householdChefIds), so a household recipe is plannable by everyone in it.
import type { Route } from "./+types/households.$id.plan";
import { useActionData, useLoaderData } from "react-router";
import { can, getHousehold, householdChefIdsFor, householdsRequest } from "~/domains/households-and-identity";
import { getWeek, parseLocalDate, plannableRecipes, prismaPlanStore, type PlanActionAnswer, type PlanScope } from "~/domains/planning";
import { getCloudflareEnv, getRequestDb } from "~/lib/route-platform.server";
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";
import { d1UnavailableWebResponse } from "~/lib/d1-write-retry.server";
import { changePlanEntry, planFieldsOf, planRefused } from "~/lib/plan-route.server";
import { CookbookPage } from "~/components/cookbook/page";
import { Link } from "~/components/ouro/link/link";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { Text } from "~/components/ouro/text/text";
import { WeekLinks, WeekPlan } from "~/components/plan/week-plan";
import { weekTitle } from "~/components/plan/week";

export function meta({ data: loaded }: Route.MetaArgs) {
  return [{ title: loaded ? `Meal plan - ${loaded.household.name} - Spoonjoy` : "Meal plan - Spoonjoy" }];
}

/** The signed-in cook, the household as they see it and the plan scope they act in, or a 404 outside it. */
async function householdPlan(request: Request, context: Route.LoaderArgs["context"], householdId: string) {
  const { userId, store } = await householdsRequest(request, context);
  const [household, householdChefIds] = await Promise.all([getHousehold(store, householdId, userId), householdChefIdsFor(store, userId)]);
  if (!household) throw new Response("Household not found", { status: 404 });
  const scope: PlanScope = { household: household.id, actingCook: userId, householdChefIds };
  return { userId, household, scope, plans: prismaPlanStore(await getRequestDb(context)) };
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { household, scope, plans } = await householdPlan(request, context, params.id);
  const search = new URL(request.url).searchParams;
  const [week, { recipes, chosenRecipeId }] = await Promise.all([
    getWeek(plans, scope, parseLocalDate(search.get("week"))),
    plannableRecipes(plans, scope, search.get("recipe")),
  ]);
  return { household: { id: household.id, name: household.name }, canEdit: can(household.me, "edit-shared"), week, recipes, chosenRecipeId };
}

/** Reports a failure the plan can't answer to PostHog, without holding up the response. */
function reportFailure(context: Route.ActionArgs["context"], request: Request, userId: string, intent: string, error: unknown) {
  const cloudflare = (context as { cloudflare: { ctx?: { waitUntil?: (promise: Promise<unknown>) => void } } }).cloudflare;
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
  if (cloudflare.ctx?.waitUntil) cloudflare.ctx.waitUntil(capture);
  else void capture;
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { userId, household, scope, plans } = await householdPlan(request, context, params.id);
  const fields = planFieldsOf(await request.formData());
  const intent = fields.intent ?? "";
  if (!can(household.me, "edit-shared")) return planRefused(intent, "View-only members read the household's plan but can't change it.", 403);
  try {
    return await changePlanEntry(plans, scope, userId, fields, `/households/${household.id}/plan`);
  } catch (error) {
    const unavailable = d1UnavailableWebResponse(error, intent);
    if (unavailable) return unavailable;
    reportFailure(context, request, userId, intent, error);
    throw error;
  }
}

export default function HouseholdPlanPage() {
  const { household, canEdit, week, recipes, chosenRecipeId } = useLoaderData<typeof loader>();
  const answer = useActionData<PlanActionAnswer>();
  const basePath = `/households/${household.id}/plan`;
  return (
    <CookbookPage>
      <PageHeader eyebrow={<Link href={`/households/${household.id}`}>{household.name}</Link>} title={weekTitle(week.start)} size="lg" divider description="The household's meals for the week: recipes to cook, or notes like eating out.">
        <div className="mt-4 flex flex-wrap gap-2">
          <WeekLinks basePath={basePath} start={week.start} />
        </div>
        {canEdit ? null : <Text tone="muted" className="mt-3">View-only: you can read this plan.</Text>}
      </PageHeader>
      <WeekPlan week={week} recipes={recipes} chosenRecipeId={chosenRecipeId} answer={answer} canEdit={canEdit} />
    </CookbookPage>
  );
}
