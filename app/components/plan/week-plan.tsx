// A meal plan's week: its days with their meals, the links to the weeks around it, and the sheet a day's Add opens.
// A cook's /plan and a household's plan both show it; the page around it says whose plan it is.
import { useState } from "react";
import { Plus } from "lucide-react";
import { Form as RouterForm } from "react-router";
import { MEAL_TYPES, addDays, errorsFor, type PlanActionAnswer, type PlanDay, type PlanEntry, type PlanWeek } from "~/domains/planning";
import { weekFormKey } from "./week";
import { useFormErrors } from "~/hooks/use-form-errors";
import { useWriteToken } from "~/hooks/use-write-token";
import { Button } from "~/components/ouro/button/button";
import { Form } from "~/components/ouro/form/form";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { NativeSelect } from "~/components/ouro/select/native-select";
import { NumberField } from "~/components/ouro/number-field/number-field";
import { SegmentedControl } from "~/components/ouro/segmented-control/segmented-control";
import { Sheet } from "~/components/ouro/sheet/sheet";
import { SectionHeader } from "~/components/ouro/section-header/section-header";
import { Text } from "~/components/ouro/text/text";
import { TextField } from "~/components/ouro/text-field/text-field";

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

type DayProps = { day: PlanDay; today: string; lastMade: Record<string, string>; onAdd: ((date: string) => void) | null };

/** One day and its meals; `onAdd` is null for someone who may only read the plan, who gets no Add and no Remove. */
function DaySection({ day, today, lastMade, onAdd }: DayProps) {
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
          onAdd && day.entries.length > 0 ? (
            <Button variant="plain" size="sm" startIcon={Plus} aria-label={`Add to ${weekday}`} onClick={() => onAdd(day.date)}>
              Add
            </Button>
          ) : undefined
        }
      />
      <ItemGroup
        variant="divided"
        aria-label={`${weekday}'s meals`}
        // An empty day is itself the way to plan it, for someone who can.
        empty={
          onAdd ? (
            <Button variant="outline" tone="secondary" fullWidth startIcon={Plus} aria-label={`Plan a meal for ${weekday}`} onClick={() => onAdd(day.date)}>
              Plan a meal
            </Button>
          ) : (
            <Text tone="muted">Nothing planned</Text>
          )
        }
      >
        {day.entries.map((entry) => {
          const row = {
            title: entryTitle(entry),
            description: entryDescription(entry, entry.recipeId ? lastMade[entry.recipeId] : undefined, today),
            actions: onAdd ? <RemoveEntry entry={entry} weekday={weekday} /> : undefined,
          };
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

/**
 * What "Add this week to my list" did: how many recipes went on the list, and any that are gone, or why it couldn't.
 * The list is the cook's own shopping list unless the answer names another.
 */
export function WeekListAnswer({ answer }: { answer: PlanActionAnswer }) {
  if (answer?.intent !== "add-week-to-list") return null;
  if (!answer.added) {
    return answer.errors?.general ? <Text role="alert" tone="destructive" className="mt-3">{answer.errors.general}</Text> : null;
  }
  const { recipes, missing } = answer.added;
  const list = answer.list ?? { name: "your shopping list", href: "/shopping-list" };
  if (recipes === 0 && missing === 0) {
    return <Text role="status" tone="muted" className="mt-3">No recipes are planned this week, so nothing went on the list.</Text>;
  }
  const gone = missing === 0 ? "" : `; ${count(missing, "recipe")} ${missing === 1 ? "is" : "are"} no longer available`;
  return (
    <Text role="status" className="mt-3">
      Added {count(recipes, "recipe")} to {list.name}{gone}. <Button href={list.href} variant="plain" size="inline">Open the list</Button>
    </Text>
  );
}

/** Previous week, this week and next week, for the plan at `basePath`. */
export function WeekLinks({ basePath, start }: { basePath: string; start: string }) {
  return (
    <>
      <Button href={`${basePath}?week=${addDays(start, -7)}`} variant="outline" tone="secondary" size="sm">Previous week</Button>
      <Button href={basePath} variant="outline" tone="secondary" size="sm">This week</Button>
      <Button href={`${basePath}?week=${addDays(start, 7)}`} variant="outline" tone="secondary" size="sm">Next week</Button>
    </>
  );
}

export type WeekPlanProps = SheetProps & {
  week: Pick<PlanWeek, "today" | "start" | "days" | "lastMade">;
  /** False for someone who may only read the plan: no Add, no Remove and no sheet. */
  canEdit: boolean;
};

/** The week's days, and for someone who can change the plan, the sheet each day's Add opens. */
export function WeekPlan({ week, recipes, chosenRecipeId, answer, canEdit }: WeekPlanProps) {
  const formKey = weekFormKey(week);
  const defaultDay = week.days.some((day) => day.date === week.today) ? week.today : week.start;
  const firstKind = recipes.length > 0 ? "recipe" : "note";
  // A recipe's "Plan this meal" link opens the sheet on that recipe.
  const [adding, setAdding] = useState<Adding | null>(canEdit && chosenRecipeId ? { date: defaultDay, kind: "recipe", formKey } : null);
  const open = adding?.formKey === formKey ? adding : null;
  const onAdd = canEdit ? (date: string) => setAdding({ date, kind: firstKind, formKey }) : null;

  return (
    <>
      <div className="mt-6 grid gap-8 md:grid-cols-2 xl:grid-cols-3">
        {week.days.map((day) => (
          <DaySection key={day.date} day={day} today={week.today} lastMade={week.lastMade} onAdd={onAdd} />
        ))}
      </div>
      {canEdit ? (
        <AddSheet adding={open} onChange={setAdding} onClose={() => setAdding(null)} recipes={recipes} chosenRecipeId={chosenRecipeId} answer={answer} />
      ) : null}
    </>
  );
}
