// The meal plan: a week of recipes and notes, day by day.
import { useState } from "react";
import { Plus } from "lucide-react";
import { data, Form as RouterForm, redirect, useActionData, useLoaderData } from "react-router";
import type { Route } from "./+types/plan";
import {
  MEAL_TYPES,
  addDays,
  addEntry,
  addPlannedMealsToList,
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
import { shoppingListRecipeAdder } from "~/lib/shopping-list.server";
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
import { SegmentedControl } from "~/components/ouro/segmented-control/segmented-control";
import { Sheet } from "~/components/ouro/sheet/sheet";
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
      const removed = await retryD1Write({ scope: "plan_entry.remove" }, () => removeEntry(store, { cook: userId }, fields.entryId ?? ""));
      return data({ intent, removed });
    }
    if (intent === "add-week-to-list") {
      const day = parseLocalDate(fields.week);
      if (!day) return refused(intent, "Choose a week to shop for.");
      const { start } = await getWeek(store, { cook: userId }, day);
      const listToken = formWriteToken(fields.listToken) ?? crypto.randomUUID();
      const list = await shoppingListRecipeAdder(context, userId);
      const added = await addPlannedMealsToList(store, list, { cook: userId }, { from: start, to: addDays(start, 6) }, `plan-week:${start}:${listToken}`);
      return data({ intent, added });
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
    const added = await retryD1Write({ scope: "plan_entry.add" }, () => addEntry(store, { cook: userId }, entryId, input));
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
const longDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "Nov 2", or "Jun 9, 2025" when the day falls in another year than today. */
function madeOn(date: string, today: string) {
  return (date.slice(0, 4) === today.slice(0, 4) ? shortDate : longDate).format(utc(date));
}

function utc(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

const MEAL_LABEL = new Map<string, string>(MEAL_TYPES.map((type) => [type.id, type.label]));

/** The recipe at the servings the meal was planned for; the recipe page opens at that scale. */
function recipeHref(recipeId: string, scaleFactor: number) {
  return scaleFactor === 1 ? `/recipes/${recipeId}` : `/recipes/${recipeId}?scale=${scaleFactor}`;
}

function entryTitle(entry: PlanEntry) {
  return entry.recipeTitle || entry.title;
}

function entryDescription(entry: PlanEntry, lastMade: string | undefined, today: string) {
  const parts = [MEAL_LABEL.get(entry.mealType)];
  if (entry.kind === "recipe" && entry.scaleFactor !== 1) parts.push(`${entry.scaleFactor}× the recipe`);
  if (lastMade) parts.push(`Last made ${madeOn(lastMade, today)}`);
  if (entry.note) parts.push(entry.note);
  return parts.join(" · ");
}

// Every day's header is one small button tall, whether or not its Add shows, with the heading centred in it, so the
// headings and rules of the days in one grid row line up. The height is HX Button's size="sm" height at each width.
const DAY_HEADER_CLASS =
  "box-content min-h-[max(calc(var(--spacing)*9),var(--ouro-size-6))] items-center sm:min-h-[max(calc(var(--spacing)*8),var(--ouro-size-6))]";

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

function DaySection({ day, today, lastMade, onAdd }: { day: PlanDay; today: string; lastMade: Record<string, string>; onAdd: (date: string) => void }) {
  const heading = dayHeading.format(utc(day.date));
  const weekday = weekdayName.format(utc(day.date));
  return (
    <section aria-label={heading}>
      <SectionHeader
        className={DAY_HEADER_CLASS}
        title={heading}
        meta={day.date === today ? "Today" : undefined}
        // An empty day's own button plans it, so the header's Add shows only once the day has meals.
        actions={
          day.entries.length > 0 ? (
            <Button variant="plain" size="sm" startIcon={Plus} aria-label={`Add to ${weekday}`} onClick={() => onAdd(day.date)}>
              Add
            </Button>
          ) : undefined
        }
      />
      <ItemGroup
        variant="divided"
        aria-label={`${weekday}'s meals`}
        // An empty day is itself the way to plan it.
        empty={
          <Button variant="outline" tone="secondary" fullWidth startIcon={Plus} aria-label={`Plan a meal for ${weekday}`} onClick={() => onAdd(day.date)}>
            Plan a meal
          </Button>
        }
      >
        {day.entries.map((entry) => {
          const row = { title: entryTitle(entry), description: entryDescription(entry, entry.recipeId ? lastMade[entry.recipeId] : undefined, today), actions: <RemoveEntry entry={entry} weekday={weekday} /> };
          return entry.recipeId ? <Item key={entry.id} href={recipeHref(entry.recipeId, entry.scaleFactor)} {...row} /> : <Item key={entry.id} {...row} />;
        })}
      </ItemGroup>
    </section>
  );
}

type Adding = { date: string; kind: "recipe" | "note"; formKey: string };

const ADD_KINDS = [
  { value: "recipe", label: "Recipe" },
  { value: "note", label: "Note" },
] as const;

type SheetProps = {
  recipes: ReadonlyArray<{ id: string; title: string }>;
  chosenRecipeId: string | null;
  answer: PlanActionAnswer | undefined;
};

/** The sheet a day's Add opens: a recipe or a note for that day, on one form or the other. */
function AddSheet({ adding, onChange, onClose, ...forms }: SheetProps & { adding: Adding | null; onChange: (adding: Adding) => void; onClose: () => void }) {
  return (
    <Sheet open={adding !== null} onOpenChange={onClose} title={adding ? `Add to ${dayHeading.format(utc(adding.date))}` : "Add a meal"} className="mx-auto max-w-lg">
      {adding ? <AddForms adding={adding} onChange={onChange} {...forms} /> : null}
    </Sheet>
  );
}

function AddForms({ adding, onChange, recipes, chosenRecipeId, answer }: SheetProps & { adding: Adding; onChange: (adding: Adding) => void }) {
  const recipeErrors = useFormErrors(errorsFor(answer, "add-recipe"), undefined, answer);
  const noteErrors = useFormErrors(errorsFor(answer, "add-note"), undefined, answer);
  const [recipeToken] = useWriteToken();
  const [noteToken] = useWriteToken();
  const { date, formKey } = adding;
  const mealType = <NativeSelect label="Meal" name="mealType" defaultValue="dinner" options={MEAL_TYPES.map((type) => ({ value: type.id, label: type.label }))} />;

  return (
    <div className="grid gap-6">
      <SegmentedControl label="Add" hideLabel fullWidth items={ADD_KINDS} value={adding.kind} onValueChange={(kind) => onChange({ ...adding, kind: kind as Adding["kind"] })} />
      {adding.kind === "note" ? (
        <Form key={`note-${date}-${formKey}`} method="post" errors={noteErrors} render={<RouterForm />} className="gap-4">
          <input type="hidden" name="intent" value="add-note" />
          <input type="hidden" name="entryToken" value={`${noteToken}-${formKey}`} />
          <input type="hidden" name="date" value={date} />
          {mealType}
          <TextField label="Title" name="title" required placeholder="Eat out, leftovers, pizza night" />
          <TextField label="Note" name="note" placeholder="Optional" />
          <Button type="submit">Add note</Button>
        </Form>
      ) : recipes.length > 0 ? (
        <Form key={`recipe-${date}-${formKey}`} method="post" errors={recipeErrors} render={<RouterForm />} className="gap-4">
          <input type="hidden" name="intent" value="add-recipe" />
          <input type="hidden" name="entryToken" value={`${recipeToken}-${formKey}`} />
          <input type="hidden" name="date" value={date} />
          {mealType}
          <NativeSelect label="Recipe" name="recipeId" defaultValue={chosenRecipeId ?? undefined} options={recipes.map((recipe) => ({ value: recipe.id, label: recipe.title }))} />
          <NumberField label="Scale" name="scaleFactor" defaultValue={1} min={0.25} max={50} step={0.25} description="1 cooks the recipe as written; 2 doubles it." />
          <Button type="submit">Add to plan</Button>
        </Form>
      ) : (
        <Text tone="muted">
          Your recipes and the ones you save to a cookbook show up here to plan. <Button href="/recipes/new" variant="plain" size="inline">Write a recipe</Button>
        </Text>
      )}
    </div>
  );
}

function count(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** What "Add this week to my list" did: how many recipes went on the list, and any that are gone. */
export function WeekListAnswer({ answer }: { answer: PlanActionAnswer }) {
  if (answer?.intent !== "add-week-to-list" || !answer.added) return null;
  const { recipes, missing } = answer.added;
  if (recipes === 0 && missing === 0) {
    return <Text role="status" tone="muted" className="mt-3">No recipes are planned this week, so nothing went on the list.</Text>;
  }
  const gone = missing === 0 ? "" : `; ${count(missing, "recipe")} ${missing === 1 ? "is" : "are"} no longer available`;
  return (
    <Text role="status" className="mt-3">
      Added {count(recipes, "recipe")} to your shopping list{gone}. <Button href="/shopping-list" variant="plain" size="inline">Open the list</Button>
    </Text>
  );
}

export default function PlanPage() {
  const { week, recipes, chosenRecipeId } = useLoaderData<typeof loader>();
  const answer = useActionData<PlanActionAnswer>();
  const [listToken] = useWriteToken();
  const entryCount = week.days.reduce((count, day) => count + day.entries.length, 0);
  // A new key after each add or remove, so a sheet left from the last add closes and its form starts fresh.
  const formKey = `${week.start}-${entryCount}`;
  const defaultDay = week.days.some((day) => day.date === week.today) ? week.today : week.start;
  const firstKind = recipes.length > 0 ? "recipe" : "note";
  // A recipe's "Plan this meal" link opens the sheet on that recipe.
  const [adding, setAdding] = useState<Adding | null>(chosenRecipeId ? { date: defaultDay, kind: "recipe", formKey } : null);
  const open = adding?.formKey === formKey ? adding : null;

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
          <RouterForm method="post">
            <input type="hidden" name="intent" value="add-week-to-list" />
            <input type="hidden" name="week" value={week.start} />
            <input type="hidden" name="listToken" value={`${listToken}-${formKey}`} />
            <Button type="submit" size="sm">Add this week to my list</Button>
          </RouterForm>
        </div>
        <WeekListAnswer answer={answer} />
      </PageHeader>

      <div className="mt-6 grid gap-8 md:grid-cols-2 xl:grid-cols-3">
        {week.days.map((day) => (
          <DaySection key={day.date} day={day} today={week.today} lastMade={week.lastMade} onAdd={(date) => setAdding({ date, kind: firstKind, formKey })} />
        ))}
      </div>

      <AddSheet
        adding={open}
        onChange={setAdding}
        onClose={() => setAdding(null)}
        recipes={recipes}
        chosenRecipeId={chosenRecipeId}
        answer={answer}
      />
    </CookbookPage>
  );
}
