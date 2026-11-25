// Smart cookbook use cases. They take a SmartCookbookStore port and the OrganizerStore, so the same rules run against
// D1 in the Worker and SQLite in tests. A smart cookbook is its cook's: only they make it, see it and fill it, and its
// rules only ever name their own organizers.
import { ORGANIZER_KINDS, type Organizer } from "../model/organizer";
import type { OrganizerFilters } from "../model/organizer-filter";
import {
  normalizeSmartCookbookTitle,
  planSmartCookbookRules,
  smartCookbookFilters,
  smartCookbookRepoints,
  type SmartCookbook,
  type SmartCookbookRepoint,
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
  /** Gives a cookbook a new title; "taken" when its owner already has another with that title. */
  rename(cookbookId: string, title: string): Promise<{ ok: true } | { ok: false; reason: "taken" }>;
  /** Gives a cookbook these rules, in order, in place of the ones it had; on a failure it keeps the ones it had. */
  replaceRules(cookbookId: string, rules: SmartCookbookRule[]): Promise<void>;
  /** Deletes a cookbook and its rules. */
  delete(cookbookId: string): Promise<void>;
  /** Moves one rule off an organizer: onto another in the same place, or away. */
  repoint(cookbookId: string, repoint: SmartCookbookRepoint): Promise<void>;
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

/** The owner's cookbook with this id, or null. */
async function ownedCookbook(store: SmartCookbookStore, ownerId: string, cookbookId: string): Promise<SmartCookbook | null> {
  const cookbook = await store.find(cookbookId);
  return cookbook && cookbook.ownerId === ownerId ? cookbook : null;
}

/** Gives the owner's cookbook a new title, which is trimmed like a new one's. */
export async function renameSmartCookbook(
  store: SmartCookbookStore,
  ownerId: string,
  cookbookId: string,
  title: unknown,
): Promise<{ ok: true; title: string } | { ok: false; reason: "invalid-title" | "taken" | "not-found" }> {
  if (!(await ownedCookbook(store, ownerId, cookbookId))) return { ok: false, reason: "not-found" };
  const normalized = normalizeSmartCookbookTitle(title);
  if (!normalized) return { ok: false, reason: "invalid-title" };
  const renamed = await store.rename(cookbookId, normalized);
  return renamed.ok ? { ok: true, title: normalized } : renamed;
}

/** Gives the owner's cookbook the rules they asked for, checked as a new cookbook's are. */
export async function changeSmartCookbookRules(
  store: SmartCookbookStore,
  organizers: OrganizerStore,
  ownerId: string,
  cookbookId: string,
  rules: readonly { side: unknown; organizerId: unknown }[],
): Promise<{ ok: true } | { ok: false; reason: "not-found" | Extract<SmartCookbookRulesPlan, { ok: false }>["reason"] }> {
  if (!(await ownedCookbook(store, ownerId, cookbookId))) return { ok: false, reason: "not-found" };
  const plan = planSmartCookbookRules(rules, await organizersOf(organizers, ownerId));
  if (!plan.ok) return plan;
  await store.replaceRules(cookbookId, plan.rules);
  return { ok: true };
}

/** Deletes the owner's cookbook; false when they have none with this id. Its recipes are untouched. */
export async function deleteSmartCookbook(store: SmartCookbookStore, ownerId: string, cookbookId: string): Promise<boolean> {
  if (!(await ownedCookbook(store, ownerId, cookbookId))) return false;
  await store.delete(cookbookId);
  return true;
}

/**
 * After the owner merges organizers into `keepId`, moves their cookbooks' rules on the merged ones to the kept one, so a
 * cookbook that filled with a merged tag keeps filling with the tag its recipes now have (smartCookbookRepoints).
 */
export async function repointSmartCookbooks(store: SmartCookbookStore, ownerId: string, mergedIds: readonly string[], keepId: string): Promise<void> {
  for (const cookbook of await store.listOf(ownerId)) {
    for (const repoint of smartCookbookRepoints(cookbook.rules, mergedIds, keepId)) await store.repoint(cookbook.id, repoint);
  }
}
