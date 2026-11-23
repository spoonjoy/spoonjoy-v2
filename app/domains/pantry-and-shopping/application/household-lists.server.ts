// Household shopping lists: everyone in the household reads them, and members and owners change them
// (can(membership, "edit-shared") in households-and-identity). A list is only ever reached through its household.

import { can, type HouseholdRole } from "~/domains/households-and-identity";
import {
  validateHouseholdListItem,
  validateHouseholdListName,
  type Checked,
  type HouseholdListItem,
  type HouseholdListSummary,
} from "../model/household-list";
import type { HouseholdListStore } from "./household-list-store";

const NOT_YOURS = "That household isn't one of yours.";
const VIEW_ONLY = "View-only members can't change shared lists.";
const NOT_HERE = "That list isn't in this household.";

type InHousehold = { householdId: string; userId: string };
type OnList = InHousehold & { listId: string };

const allows = (householdId: string, userId: string, role: HouseholdRole) => can({ householdId, userId, role }, "edit-shared");

async function editable(store: HouseholdListStore, { householdId, userId }: InHousehold): Promise<Checked<null>> {
  const role = await store.roleIn(householdId, userId);
  if (!role) return { ok: false, error: NOT_YOURS };
  if (!allows(householdId, userId, role)) return { ok: false, error: VIEW_ONLY };
  return { ok: true, value: null };
}

async function editableList(store: HouseholdListStore, input: OnList): Promise<Checked<null>> {
  const allowed = await editable(store, input);
  if (!allowed.ok) return allowed;
  return (await store.list(input.householdId, input.listId)) ? allowed : { ok: false, error: NOT_HERE };
}

/** The household's lists as `userId` sees them, or null when they aren't in it. */
export async function listHouseholdLists(
  store: HouseholdListStore,
  { householdId, userId }: InHousehold,
): Promise<{ canEdit: boolean; lists: HouseholdListSummary[] } | null> {
  const role = await store.roleIn(householdId, userId);
  if (!role) return null;
  return { canEdit: allows(householdId, userId, role), lists: await store.lists(householdId) };
}

export async function createHouseholdList(
  store: HouseholdListStore,
  input: InHousehold & { name: unknown; now: Date },
): Promise<Checked<{ id: string; name: string }>> {
  const allowed = await editable(store, input);
  if (!allowed.ok) return allowed;
  const name = validateHouseholdListName(input.name);
  if (!name.ok) return name;
  const id = crypto.randomUUID();
  await store.insertList({ id, householdId: input.householdId, name: name.value, createdById: input.userId, now: input.now });
  return { ok: true, value: { id, name: name.value } };
}

/** The list and its items as `userId` sees them, or null when it isn't in a household of theirs. */
export async function getHouseholdList(
  store: HouseholdListStore,
  { householdId, listId, userId }: OnList,
): Promise<{ id: string; name: string; canEdit: boolean; items: HouseholdListItem[] } | null> {
  const [role, list] = await Promise.all([store.roleIn(householdId, userId), store.list(householdId, listId)]);
  if (!role || !list) return null;
  return { ...list, canEdit: allows(householdId, userId, role), items: await store.items(listId) };
}

export async function addHouseholdListItem(
  store: HouseholdListStore,
  input: OnList & { text: unknown; now: Date },
): Promise<Checked<{ id: string }>> {
  const allowed = await editableList(store, input);
  if (!allowed.ok) return allowed;
  const text = validateHouseholdListItem(input.text);
  if (!text.ok) return text;
  const id = crypto.randomUUID();
  await store.insertItem({ id, listId: input.listId, text: text.value, addedById: input.userId, now: input.now });
  return { ok: true, value: { id } };
}

export async function setHouseholdListItemChecked(
  store: HouseholdListStore,
  input: OnList & { itemId: string; checked: boolean; now: Date },
): Promise<Checked<null>> {
  const allowed = await editableList(store, input);
  if (allowed.ok) await store.setChecked(input.listId, input.itemId, input.checked, input.now);
  return allowed;
}

export async function removeHouseholdListItem(store: HouseholdListStore, input: OnList & { itemId: string }): Promise<Checked<null>> {
  const allowed = await editableList(store, input);
  if (allowed.ok) await store.deleteItem(input.listId, input.itemId);
  return allowed;
}

export async function deleteHouseholdList(store: HouseholdListStore, input: OnList): Promise<Checked<null>> {
  const allowed = await editableList(store, input);
  if (allowed.ok) await store.deleteList(input.listId);
  return allowed;
}
