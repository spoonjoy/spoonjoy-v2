// A household's meal plan: the same week as a cook's /plan, kept for the whole household. Owners and members plan and
// remove meals, acting as themselves; view-only members read it. Its recipes are the acting cook's, the ones saved in
// their cookbooks and their household's (householdChefIds), so a household recipe is plannable by everyone in it.
import type { Route } from "./+types/households.$id.plan";
import { data, Form as RouterForm, useActionData, useLoaderData } from "react-router";
import { can, getHousehold, householdChefIdsFor, householdsRequest } from "~/domains/households-and-identity";
import {
  addDays,
  addPlannedMealsToList,
  getWeek,
  parseLocalDate,
  plannableRecipes,
  prismaPlanStore,
  type PlanActionAnswer,
  type PlanScope,
} from "~/domains/planning";
import { d1HouseholdListRecipes, d1HouseholdListStore, getHouseholdList, listHouseholdLists } from "~/domains/pantry-and-shopping";
import { requestD1, type D1ReadDatabase } from "~/lib/d1-read.server";
import { getCloudflareEnv, getRequestDb } from "~/lib/route-platform.server";
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";
import { d1UnavailableWebResponse } from "~/lib/d1-write-retry.server";
import { changePlanEntry, planFieldsOf, planRefused } from "~/lib/plan-route.server";
import { CookbookPage } from "~/components/cookbook/page";
import { Link } from "~/components/ouro/link/link";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { Text } from "~/components/ouro/text/text";
import { Button } from "~/components/ouro/button/button";
import { NativeSelect } from "~/components/ouro/select/native-select";
import { AddWeekButton, WeekLinks, WeekListAnswer, WeekPlan } from "~/components/plan/week-plan";
import { weekTitle, weekToList } from "~/components/plan/week";

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

function householdLists(context: Route.LoaderArgs["context"]) {
  return d1HouseholdListStore(requestD1(context) as D1ReadDatabase);
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { household, scope, plans } = await householdPlan(request, context, params.id);
  const search = new URL(request.url).searchParams;
  const canEdit = can(household.me, "edit-shared");
  const [week, { recipes, chosenRecipeId }, shared] = await Promise.all([
    getWeek(plans, scope, parseLocalDate(search.get("week"))),
    plannableRecipes(plans, scope, search.get("recipe")),
    // Only someone who can change the lists is offered one to shop the week onto.
    canEdit ? listHouseholdLists(householdLists(context), { householdId: household.id, userId: household.me.userId }) : null,
  ]);
  const lists = shared?.lists.map(({ id, name }) => ({ id, name })) ?? [];
  return { household: { id: household.id, name: household.name }, canEdit, week, recipes, chosenRecipeId, lists };
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
    if (intent === "add-week-to-list") {
      const day = parseLocalDate(fields.week);
      if (!day) return planRefused(intent, "Choose a week to shop for.");
      const list = await getHouseholdList(householdLists(context), { householdId: household.id, listId: fields.listId ?? "", userId });
      if (!list) return planRefused(intent, "Choose one of the household's shopping lists.");
      const { start } = await getWeek(plans, scope, day);
      const onList = d1HouseholdListRecipes(requestD1(context) as D1ReadDatabase, { listId: list.id, userId, now: new Date() });
      const week = { from: start, to: addDays(start, 6) };
      // The list writes the new meals together, so chicken stock in two of them is one line.
      const added = await addPlannedMealsToList(plans, onList, scope, week);
      return data({ intent, added, list: { name: list.name, href: `/households/${household.id}/lists/${list.id}` } });
    }
    return await changePlanEntry(plans, scope, userId, fields, `/households/${household.id}/plan`);
  } catch (error) {
    const unavailable = d1UnavailableWebResponse(error, intent);
    if (unavailable) return unavailable;
    reportFailure(context, request, userId, intent, error);
    throw error;
  }
}

export default function HouseholdPlanPage() {
  const { household, canEdit, week, recipes, chosenRecipeId, lists } = useLoaderData<typeof loader>();
  const answer = useActionData<PlanActionAnswer>();
  const { planned, left } = weekToList(week);
  const basePath = `/households/${household.id}/plan`;
  return (
    <CookbookPage>
      <PageHeader eyebrow={<Link href={`/households/${household.id}`}>{household.name}</Link>} title={weekTitle(week.start)} size="lg" divider description="The household's meals for the week: recipes to cook, or notes like eating out.">
        <div className="mt-4 flex flex-wrap gap-2">
          <WeekLinks basePath={basePath} start={week.start} />
        </div>
        {canEdit && lists.length > 0 && planned > 0 ? (
          <RouterForm method="post" className="mt-4 flex flex-wrap items-end gap-2">
            <input type="hidden" name="intent" value="add-week-to-list" />
            <input type="hidden" name="week" value={week.start} />
            <NativeSelect label="Shopping list" name="listId" options={lists.map((list) => ({ value: list.id, label: list.name }))} />
            <AddWeekButton left={left} />
          </RouterForm>
        ) : null}
        {canEdit && lists.length === 0 ? (
          <Text tone="muted" className="mt-3">
            Make a shopping list to shop for the week. <Button href={`/households/${household.id}/lists`} variant="plain" size="inline">Shopping lists</Button>
          </Text>
        ) : null}
        <WeekListAnswer answer={answer} />
        {canEdit ? null : <Text tone="muted" className="mt-3">View-only: you can read this plan.</Text>}
      </PageHeader>
      <WeekPlan week={week} recipes={recipes} chosenRecipeId={chosenRecipeId} answer={answer} canEdit={canEdit} />
    </CookbookPage>
  );
}
