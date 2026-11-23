// Planning use cases. They take a PlanStore port, so the same rules run against D1 in the Worker, SQLite in tests
// and the local adapter a self-hosted server uses.
import { startOfWeek, todayIn, type LocalDate } from "../model/local-date";
import { planWeek, validateEntryInput, type PlanDay, type PlanEntry, type PlanEntryInput, type Validated } from "../model/plan-entry";

export type PlanSettings = { id: string; firstDayOfWeek: number; timeZone: string };

export type StoredEntry = { entry: PlanEntry; planId: string; removed: boolean };

export interface PlanStore {
  /** The cook's plan, made on first use. */
  planFor(ownerId: string): Promise<PlanSettings>;
  /** The plan's live entries from `from` to `to`, both days included. */
  entriesBetween(planId: string, from: LocalDate, to: LocalDate): Promise<PlanEntry[]>;
  /** The title of a recipe the cook may plan, or null when there is none. */
  plannableRecipeTitle(ownerId: string, recipeId: string): Promise<string | null>;
  /** The entry with this id in any plan, removed ones included. */
  findEntry(entryId: string): Promise<StoredEntry | null>;
  insertEntry(planId: string, addedById: string, entry: PlanEntry): Promise<void>;
  /** Marks a live entry of this plan removed; false when there was none. */
  removeEntry(planId: string, entryId: string): Promise<boolean>;
}

export type PlanWeek = { today: LocalDate; start: LocalDate; firstDayOfWeek: number; timeZone: string; days: PlanDay[] };

/** The week holding `date`, or this week where the plan lives when `date` is null. */
export async function getWeek(store: PlanStore, ownerId: string, date: LocalDate | null, now: Date = new Date()): Promise<PlanWeek> {
  const plan = await store.planFor(ownerId);
  const today = todayIn(plan.timeZone, now);
  const start = startOfWeek(date ?? today, plan.firstDayOfWeek);
  const days = planWeek(await store.entriesBetween(plan.id, start, planWeek([], start)[6].date), start);
  return { today, start, firstDayOfWeek: plan.firstDayOfWeek, timeZone: plan.timeZone, days };
}

function nextPosition(entries: readonly PlanEntry[], input: PlanEntryInput): number {
  return entries.filter((planned) => planned.mealType === input.mealType).reduce((max, planned) => Math.max(max, planned.position + 1), 0);
}

/**
 * Plans a recipe or a note. `entryId` comes from the caller (a form token, an idempotency key), so sending the same
 * add again returns the entry the first one made instead of planning the meal twice.
 */
export async function addEntry(store: PlanStore, ownerId: string, entryId: string, raw: Record<string, unknown>): Promise<Validated<PlanEntry>> {
  const plan = await store.planFor(ownerId);
  const existing = await store.findEntry(entryId);
  if (existing && existing.planId === plan.id) {
    return existing.removed ? { ok: false, error: "That meal was removed from the plan." } : { ok: true, value: existing.entry };
  }
  const input = validateEntryInput(raw);
  if (!input.ok) return input;
  const recipeTitle = input.value.recipeId ? await store.plannableRecipeTitle(ownerId, input.value.recipeId) : null;
  if (input.value.recipeId && recipeTitle === null) return { ok: false, error: "That recipe isn't available to plan." };
  const sameDay = await store.entriesBetween(plan.id, input.value.date, input.value.date);
  const entry: PlanEntry = { id: entryId, ...input.value, position: nextPosition(sameDay, input.value), recipeTitle };
  await store.insertEntry(plan.id, ownerId, entry);
  return { ok: true, value: entry };
}

export async function removeEntry(store: PlanStore, ownerId: string, entryId: string): Promise<boolean> {
  const plan = await store.planFor(ownerId);
  return store.removeEntry(plan.id, entryId);
}
