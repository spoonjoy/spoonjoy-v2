// Last made: when the cook last cooked each recipe, from their cook logs and the plan entries they marked cooked.
// The meal planner shows it beside a recipe, and random picks prefer recipes that haven't been made lately.

export type CookedAt = { recipeId: string; at: Date };

export interface LastMadeStore {
  /** Sets or clears `cookedAt` on a live entry of the cook's plan; false when there is no such entry. */
  setEntryCooked(ownerId: string, entryId: string, at: Date | null): Promise<boolean>;
  /** The cook's own live cook logs of these recipes. */
  loggedCooks(ownerId: string, recipeIds: readonly string[]): Promise<CookedAt[]>;
  /** The live entries of the cook's plan for these recipes that are marked cooked. */
  cookedEntries(ownerId: string, recipeIds: readonly string[]): Promise<CookedAt[]>;
}

/** Marks a planned meal cooked at `now`, or clears the mark when `cooked` is false. */
export function markCooked(store: LastMadeStore, ownerId: string, entryId: string, cooked: boolean, now: Date): Promise<boolean> {
  return store.setEntryCooked(ownerId, entryId, cooked ? now : null);
}

/** Each recipe's latest cook. Recipes the cook never made are left out. */
export async function lastMade(store: LastMadeStore, ownerId: string, recipeIds: readonly string[]): Promise<Map<string, Date>> {
  const ids = [...new Set(recipeIds)];
  const latest = new Map<string, Date>();
  if (ids.length === 0) return latest;
  const [logged, planned] = await Promise.all([store.loggedCooks(ownerId, ids), store.cookedEntries(ownerId, ids)]);
  for (const { recipeId, at } of [...logged, ...planned]) {
    const seen = latest.get(recipeId);
    if (!seen || at > seen) latest.set(recipeId, at);
  }
  return latest;
}
