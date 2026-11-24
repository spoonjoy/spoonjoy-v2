// The meal plan: a week of recipes and notes, day by day. Behind the meal-planner flag until it ships.
import { data, Form as RouterForm, redirect, useActionData, useLoaderData } from "react-router";
import type { Route } from "./+types/plan";
import { isFlagOn } from "~/domains/platform";
import {
  MEAL_TYPES,
  addDays,
  addEntry,
  getWeek,
  parseLocalDate,
  prismaPlanStore,
  removeEntry,
  errorsFor,
  type PlanActionAnswer,
  type PlanDay,
  type PlanEntry,
  plannableRecipes,
} from "~/domains/planning";
import { getCloudflareEnv, getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";
import { d1UnavailableWebResponse, formWriteToken, idForWriteToken, retryD1Write } from "~/lib/d1-write-retry.server";
import { containsObjectionableContent, OBJECTIONABLE_CONTENT_MESSAGE } from "~/lib/objectionable-terms";
import { useFormErrors } from "~/hooks/use-form-errors";
import { useWriteToken } from "~/hooks/use-write-token";
import { CookbookPage } from "~/components/cookbook/page";
import { Button } from "~/components/ouro/button/button";
import { Form } from "~/components/ouro/form/form";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { NativeSelect } from "~/components/ouro/select/native-select";
import { NumberField } from "~/components/ouro/number-field/number-field";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { SectionHeader } from "~/components/ouro/section-header/section-header";
import { Text } from "~/components/ouro/text/text";
import { TextField } from "~/components/ouro/text-field/text-field";

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
    getWeek(store, userId, asked),
    plannableRecipes(store, userId, params.get("recipe")),
  ]);
  return { week, recipes, chosenRecipeId };
}

type Fields = Record<string, string>;

function fieldsOf(form: FormData): Fields {
  const fields: Fields = {};
  // The plan's forms send text only; a file sent anyway reads as text and fails validation like any bad value.
  for (const [key, value] of form) fields[key] = String(value);
  return fields;
}

/** Reports a failure the plan can't answer to PostHog, without holding up the response. */
function reportFailure(context: Route.ActionArgs["context"], request: Request, userId: string, intent: string, error: unknown) {
  const cloudflare = (context as { cloudflare?: { ctx?: { waitUntil?: (promise: Promise<unknown>) => void } } }).cloudflare;
  // The flag check already read this env, so it is there; the fallback only satisfies the type.
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

function refused(intent: string | undefined, general: string) {
  return data({ ...(intent ? { intent } : {}), errors: { general } }, { status: 400 });
}

export async function action({ request, context }: Route.ActionArgs) {
  const userId = await plannerUser(request, context);
  const fields = fieldsOf(await request.formData());
  const intent = fields.intent ?? "";
  const store = prismaPlanStore(await getRequestDb(context));
  try {
    if (intent === "remove") {
      const removed = await retryD1Write({ scope: "plan_entry.remove" }, () => removeEntry(store, userId, fields.entryId ?? ""));
      return data({ intent, removed });
    }
    if (intent !== "add-recipe" && intent !== "add-note") return refused(intent, "That isn't something the plan can do.");
    if (containsObjectionableContent(fields.title) || containsObjectionableContent(fields.note)) return refused(intent, OBJECTIONABLE_CONTENT_MESSAGE);
    const token = formWriteToken(fields.entryToken);
    const entryId = token ? await idForWriteToken("plan-entry", userId, token) : crypto.randomUUID();
    const input = {
      kind: intent === "add-recipe" ? "recipe" : "note",
      date: fields.date,
      mealType: fields.mealType,
      recipeId: fields.recipeId,
      title: fields.title,
      note: fields.note,
      scaleFactor: intent === "add-recipe" ? Number(fields.scaleFactor) : 1,
    };
    // addEntry finds an entry its id already made, so running it again after a transient error plans the meal once.
    const added = await retryD1Write({ scope: "plan_entry.add" }, () => addEntry(store, userId, entryId, input));
    if (!added.ok) return refused(intent, added.error);
    return redirect(`/plan?week=${added.value.date}`);
  } catch (error) {
    const unavailable = d1UnavailableWebResponse(error, intent);
    if (unavailable) return unavailable;
    reportFailure(context, request, userId, intent, error);
    throw error;
  }
}

const dayHeading = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const weekdayName = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function utc(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

const MEAL_LABEL = new Map<string, string>(MEAL_TYPES.map((type) => [type.id, type.label]));

function entryTitle(entry: PlanEntry) {
  return entry.recipeTitle || entry.title;
}

function entryDescription(entry: PlanEntry) {
  const parts = [MEAL_LABEL.get(entry.mealType)];
  if (entry.kind === "recipe" && entry.scaleFactor !== 1) parts.push(`${entry.scaleFactor}× the recipe`);
  if (entry.note) parts.push(entry.note);
  return parts.join(" · ");
}

function RemoveEntry({ entry, weekday }: { entry: PlanEntry; weekday: string }) {
  return (
    <RouterForm method="post">
      <input type="hidden" name="intent" value="remove" />
      <input type="hidden" name="entryId" value={entry.id} />
      <Button type="submit" variant="plain" tone="secondary" size="sm" aria-label={`Remove ${entryTitle(entry)} from ${weekday}`}>
        Remove
      </Button>
    </RouterForm>
  );
}

function DaySection({ day, today }: { day: PlanDay; today: string }) {
  const heading = dayHeading.format(utc(day.date));
  const weekday = weekdayName.format(utc(day.date));
  return (
    <section aria-label={heading}>
      <SectionHeader title={heading} meta={day.date === today ? "Today" : undefined} />
      <ItemGroup variant="divided" aria-label={`${weekday}'s meals`} empty={<Text tone="muted">Nothing planned yet.</Text>}>
        {day.entries.map((entry) => {
          const row = { title: entryTitle(entry), description: entryDescription(entry), actions: <RemoveEntry entry={entry} weekday={weekday} /> };
          return entry.recipeId ? <Item key={entry.id} href={`/recipes/${entry.recipeId}`} {...row} /> : <Item key={entry.id} {...row} />;
        })}
      </ItemGroup>
    </section>
  );
}

function DayAndMeal({ days, defaultDay }: { days: PlanDay[]; defaultDay: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <NativeSelect
        label="Day"
        name="date"
        defaultValue={defaultDay}
        options={days.map((day) => ({ value: day.date, label: dayHeading.format(utc(day.date)) }))}
      />
      <NativeSelect label="Meal" name="mealType" defaultValue="dinner" options={MEAL_TYPES.map((type) => ({ value: type.id, label: type.label }))} />
    </div>
  );
}

export default function PlanPage() {
  const { week, recipes, chosenRecipeId } = useLoaderData<typeof loader>();
  const answer = useActionData<PlanActionAnswer>();
  const recipeErrors = useFormErrors(errorsFor(answer, "add-recipe"), undefined, answer);
  const noteErrors = useFormErrors(errorsFor(answer, "add-note"), undefined, answer);
  const [recipeToken] = useWriteToken();
  const [noteToken] = useWriteToken();
  const entryCount = week.days.reduce((count, day) => count + day.entries.length, 0);
  const formKey = `${week.start}-${entryCount}`;
  const defaultDay = week.days.some((day) => day.date === week.today) ? week.today : week.start;

  return (
    <CookbookPage>
      <PageHeader
        eyebrow="Meal plan"
        title={`Week of ${shortDate.format(utc(week.start))}`}
        size="lg"
        divider
        description="Plan the week's meals: a recipe to cook, or a note like eating out."
      >
        <div className="mt-4 flex flex-wrap gap-2">
          <Button href={`/plan?week=${addDays(week.start, -7)}`} variant="outline" tone="secondary" size="sm">Previous week</Button>
          <Button href="/plan" variant="outline" tone="secondary" size="sm">This week</Button>
          <Button href={`/plan?week=${addDays(week.start, 7)}`} variant="outline" tone="secondary" size="sm">Next week</Button>
        </div>
      </PageHeader>

      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid gap-8 md:grid-cols-2">
          {week.days.map((day) => (
            <DaySection key={day.date} day={day} today={week.today} />
          ))}
        </div>

        <div className="grid content-start gap-10">
          <section aria-label="Plan a recipe">
            <SectionHeader title="Plan a recipe" />
            {recipes.length > 0 ? (
              <Form key={`recipe-${formKey}`} method="post" errors={recipeErrors} render={<RouterForm />} className="gap-4">
                <input type="hidden" name="intent" value="add-recipe" />
                <input type="hidden" name="entryToken" value={`${recipeToken}-${formKey}`} />
                <DayAndMeal days={week.days} defaultDay={defaultDay} />
                <NativeSelect label="Recipe" name="recipeId" defaultValue={chosenRecipeId ?? undefined} options={recipes.map((recipe) => ({ value: recipe.id, label: recipe.title }))} />
                <NumberField label="Scale" name="scaleFactor" defaultValue={1} min={0.25} max={50} step={0.25} description="1 cooks the recipe as written; 2 doubles it." />
                <Button type="submit">Add to plan</Button>
              </Form>
            ) : (
              <Text tone="muted">
                Your recipes and the ones you save to a cookbook show up here to plan. <Button href="/recipes/new" variant="plain" size="inline">Write a recipe</Button>
              </Text>
            )}
          </section>

          <section aria-label="Add a note">
            <SectionHeader title="Add a note" />
            <Form key={`note-${formKey}`} method="post" errors={noteErrors} render={<RouterForm />} className="gap-4">
              <input type="hidden" name="intent" value="add-note" />
              <input type="hidden" name="entryToken" value={`${noteToken}-${formKey}`} />
              <DayAndMeal days={week.days} defaultDay={defaultDay} />
              <TextField label="Title" name="title" required placeholder="Eat out, leftovers, pizza night" />
              <TextField label="Note" name="note" placeholder="Optional" />
              <Button type="submit">Add note</Button>
            </Form>
          </section>
        </div>
      </div>
    </CookbookPage>
  );
}
