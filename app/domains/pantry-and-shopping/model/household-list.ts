// A household's shared shopping lists, apart from each cook's own list. Everyone in the household reads them;
// members and owners change them, and view-only members don't. An item is what to buy, as someone wrote it.

export const MAX_HOUSEHOLD_LIST_NAME_LENGTH = 80;
export const MAX_HOUSEHOLD_LIST_ITEM_LENGTH = 200;

/** A refusal with `forbidden` is about who is asking (403), not about what they sent (400). */
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string; forbidden?: true };

export type HouseholdListSummary = { id: string; name: string; itemCount: number; openCount: number };

export type HouseholdListItem = { id: string; text: string; checked: boolean; addedBy: string | null };

/** A list name from input, trimmed, or the reason it can't be used. */
export function validateHouseholdListName(value: unknown): Checked<string> {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) return { ok: false, error: "Give the list a name." };
  if (name.length > MAX_HOUSEHOLD_LIST_NAME_LENGTH) return { ok: false, error: "Keep the name under 80 characters." };
  return { ok: true, value: name };
}

/** An item from input, trimmed, or the reason it can't be used. */
export function validateHouseholdListItem(value: unknown): Checked<string> {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { ok: false, error: "Write what to buy." };
  if (text.length > MAX_HOUSEHOLD_LIST_ITEM_LENGTH) return { ok: false, error: "Keep it under 200 characters." };
  return { ok: true, value: text };
}
