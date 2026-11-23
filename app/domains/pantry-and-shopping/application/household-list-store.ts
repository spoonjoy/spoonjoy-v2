// The port the household list use cases store through. adapters/d1-household-list-store.server.ts is the D1 adapter.

import type { HouseholdRole } from "~/domains/households-and-identity";
import type { HouseholdListItem, HouseholdListSummary } from "../model/household-list";

export interface HouseholdListStore {
  /** The person's role in the household, or null when they aren't in it. */
  roleIn(householdId: string, userId: string): Promise<HouseholdRole | null>;
  /** Oldest first. */
  lists(householdId: string): Promise<HouseholdListSummary[]>;
  /** The list when it belongs to this household, otherwise null. `createdById` is null once its maker's account is gone. */
  list(householdId: string, listId: string): Promise<{ id: string; name: string; createdById: string | null } | null>;
  /** In the order they were added. */
  items(listId: string): Promise<HouseholdListItem[]>;
  insertList(row: { id: string; householdId: string; name: string; createdById: string; now: Date }): Promise<void>;
  /** Adds the item at the end of the list. */
  insertItem(row: { id: string; listId: string; text: string; addedById: string; now: Date }): Promise<void>;
  setChecked(listId: string, itemId: string, checked: boolean, now: Date): Promise<void>;
  deleteItem(listId: string, itemId: string): Promise<void>;
  deleteList(listId: string): Promise<void>;
}
