// What a meal plan page's action does with a form, for a cook's /plan and a household's plan alike: plan a recipe or a
// note, or remove a meal. Each page reports a failure it can't answer to PostHog itself.
import { data, redirect } from "react-router";
import { addEntry, removeEntry, type PlanScope, type PlanStore } from "~/domains/planning";
import { formWriteToken, idForWriteToken, retryD1Write } from "~/lib/d1-write-retry.server";
import { containsObjectionableContent, OBJECTIONABLE_CONTENT_MESSAGE } from "~/lib/objectionable-terms";

export type PlanFields = Record<string, string>;

export function planFieldsOf(form: FormData): PlanFields {
  const fields: PlanFields = {};
  // The plan's forms send text only; a file sent anyway reads as text and fails validation like any bad value.
  for (const [key, value] of form) fields[key] = String(value);
  return fields;
}

export function planRefused(intent: string | undefined, general: string, status = 400) {
  return data({ ...(intent ? { intent } : {}), errors: { general } }, { status });
}

/**
 * Plans a recipe or a note, or removes a meal, on the scope's plan; any other intent is refused. A new meal sends the
 * page back to its week at `planPath`.
 */
export async function changePlanEntry(store: PlanStore, scope: PlanScope, userId: string, fields: PlanFields, planPath: string) {
  const intent = fields.intent ?? "";
  if (intent === "remove") {
    const removed = await retryD1Write({ scope: "plan_entry.remove" }, () => removeEntry(store, scope, fields.entryId ?? ""));
    return data({ intent, removed });
  }
  if (intent !== "add-recipe" && intent !== "add-note") return planRefused(intent, "That isn't something the plan can do.");
  if (containsObjectionableContent(fields.title) || containsObjectionableContent(fields.note)) return planRefused(intent, OBJECTIONABLE_CONTENT_MESSAGE);
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
  const added = await retryD1Write({ scope: "plan_entry.add" }, () => addEntry(store, scope, entryId, input));
  if (!added.ok) return planRefused(intent, added.error);
  return redirect(`${planPath}?week=${added.value.date}`);
}
