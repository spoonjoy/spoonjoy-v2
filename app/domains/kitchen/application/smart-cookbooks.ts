// Smart cookbook use cases. They take a SmartCookbookStore port and the OrganizerStore, so the same rules run against
// D1 in the Worker and SQLite in tests. A smart cookbook is its cook's: only they make it, see it and fill it, and its
// rules only ever name their own organizers.
import { ORGANIZER_KINDS, type Organizer } from "../model/organizer";
import type { OrganizerFilters } from "../model/organizer-filter";
import {
  normalizeSmartCookbookTitle,
  planSmartCookbookRules,
  smartCookbookFilters,
  type SmartCookbook,
  type SmartCookbookRule,
  type SmartCookbookRulesPlan,
} from "../model/smart-cookbook";
import type { OrganizerStore } from "./organizers";

export interface SmartCookbookStore {
  /** The owner's smart cookbooks. */
  listOf(ownerId: string): Promise<SmartCookbook[]>;
  find(cookbookId: string): Promise<SmartCookbook | null>;
  /** Stores a new cookbook with its rules in order; "taken" when the owner already has one with this title. */
  create(ownerId: string, title: string, rules: SmartCookbookRule[]): Promise<{ ok: true; cookbook: SmartCookbook } | { ok: false; reason: "taken" }>;
}

export type CreateSmartCookbookResult =
  | { ok: true; cookbook: SmartCookbook }
  | { ok: false; reason: "invalid-title" | "taken" | Extract<SmartCookbookRulesPlan, { ok: false }>["reason"] };

const byTitle = (a: SmartCookbook, b: SmartCookbook) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

/** Every organizer the owner has, of every kind. */
async function organizersOf(organizers: OrganizerStore, ownerId: string): Promise<Organizer[]> {
  return (await Promise.all(ORGANIZER_KINDS.map((kind) => organizers.organizersOf(ownerId, kind)))).flat();
}

/** The owner's smart cookbooks, in title order. */
export async function listSmartCookbooks(store: SmartCookbookStore, ownerId: string): Promise<SmartCookbook[]> {
  return (await store.listOf(ownerId)).sort(byTitle);
}

/** Makes a smart cookbook from a title and rules the cook asked for, each rule one of their own organizers. */
export async function createSmartCookbook(
  store: SmartCookbookStore,
  organizers: OrganizerStore,
  ownerId: string,
  request: { title: unknown; rules: readonly { side: unknown; organizerId: unknown }[] },
): Promise<CreateSmartCookbookResult> {
  const title = normalizeSmartCookbookTitle(request.title);
  if (!title) return { ok: false, reason: "invalid-title" };
  const plan = planSmartCookbookRules(request.rules, await organizersOf(organizers, ownerId));
  if (!plan.ok) return plan;
  return store.create(ownerId, title, plan.rules);
}

/**
 * A smart cookbook of the owner's and the filters it fills with (null: an organizer it needs is gone, so nothing
 * matches), or null when the owner has no cookbook with this id.
 */
export async function smartCookbookFill(
  store: SmartCookbookStore,
  organizers: OrganizerStore,
  ownerId: string,
  cookbookId: string,
): Promise<{ cookbook: SmartCookbook; filters: OrganizerFilters | null } | null> {
  const cookbook = await store.find(cookbookId);
  if (!cookbook || cookbook.ownerId !== ownerId) return null;
  return { cookbook, filters: smartCookbookFilters(cookbook.rules, await organizersOf(organizers, ownerId)) };
}
