// Smart cookbooks: a cookbook a cook defines by rules instead of by adding recipes, which fills itself.
//
// Each rule names one of the cook's own organizers (a tag, category or tool) and a side: "with" (a recipe must carry
// it) or "without" (it must not). A rule holds the organizer's id, not its slug, so renaming a tag keeps every smart
// cookbook that uses it. What a cookbook fills with is the cook's recipes that match every rule, the same narrowing the
// with and without filters on My recipes do (./organizer-filter.ts).
//
// This file does no I/O: adapters load cookbooks and organizers, call these rules and store what they return.
import type { Organizer } from "./organizer";
import { ORGANIZER_FILTER_MAX, type OrganizerFilters, type OrganizerRef } from "./organizer-filter";

/** The longest title a smart cookbook may have, in characters. */
export const SMART_COOKBOOK_TITLE_MAX_LENGTH = 80;

export const SMART_COOKBOOK_SIDES = ["with", "without"] as const;

export type SmartCookbookSide = (typeof SMART_COOKBOOK_SIDES)[number];

export type SmartCookbookRule = { side: SmartCookbookSide; organizerId: string };

export type SmartCookbook = { id: string; ownerId: string; title: string; rules: SmartCookbookRule[] };

export type SmartCookbookRulesPlan =
  | { ok: true; rules: SmartCookbookRule[] }
  | { ok: false; reason: "no-rules" | "unknown-organizer" | "both-sides" | "too-many" };

/** A title as stored: trimmed, with runs of spaces made one. Null when it is empty, too long or not text. */
export function normalizeSmartCookbookTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim().replace(/\s+/g, " ");
  if (!title || title.length > SMART_COOKBOOK_TITLE_MAX_LENGTH) return null;
  return title;
}

function isSide(value: unknown): value is SmartCookbookSide {
  return (SMART_COOKBOOK_SIDES as readonly unknown[]).includes(value);
}

/**
 * The rules a cook asked for, checked against the organizers they own: each organizer once per side, in the order
 * first asked, at least one rule, no organizer on both sides, and no more on a side than a search reads.
 */
export function planSmartCookbookRules(
  requested: readonly { side: unknown; organizerId: unknown }[],
  owned: readonly Organizer[],
): SmartCookbookRulesPlan {
  const ownedIds = new Set(owned.map((organizer) => organizer.id));
  const rules: SmartCookbookRule[] = [];
  const seen = new Set<string>();
  for (const { side, organizerId } of requested) {
    if (!isSide(side) || typeof organizerId !== "string" || !ownedIds.has(organizerId)) return { ok: false, reason: "unknown-organizer" };
    const key = `${side}:${organizerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push({ side, organizerId });
  }
  if (!rules.length) return { ok: false, reason: "no-rules" };
  const withIds = new Set(rules.filter((rule) => rule.side === "with").map((rule) => rule.organizerId));
  if (rules.some((rule) => rule.side === "without" && withIds.has(rule.organizerId))) return { ok: false, reason: "both-sides" };
  for (const side of SMART_COOKBOOK_SIDES) {
    if (rules.filter((rule) => rule.side === side).length > ORGANIZER_FILTER_MAX) return { ok: false, reason: "too-many" };
  }
  return { ok: true, rules };
}

/**
 * The filters a smart cookbook narrows the cook's recipes by, from each organizer's current kind and slug. A "with"
 * rule whose organizer is gone (deleted, or merged away before its rules moved) matches no recipe, so the cookbook
 * fills with nothing (null) rather than widening to every recipe; a "without" rule whose organizer is gone is dropped,
 * since no recipe carries it.
 */
export function smartCookbookFilters(rules: readonly SmartCookbookRule[], organizers: readonly Organizer[]): OrganizerFilters | null {
  const byId = new Map(organizers.map((organizer) => [organizer.id, organizer]));
  const filters: OrganizerFilters = { with: [], without: [] };
  for (const rule of rules) {
    const organizer = byId.get(rule.organizerId);
    if (!organizer) {
      if (rule.side === "with") return null;
      continue;
    }
    const ref: OrganizerRef = { kind: organizer.kind, slug: organizer.slug };
    filters[rule.side].push(ref);
  }
  return filters;
}

/** One of a cookbook's rules moving off a merged organizer: onto the one it merged into, or dropped (`to` null). */
export type SmartCookbookRepoint = { side: SmartCookbookSide; from: string; to: string | null };

/**
 * How a cookbook's rules change when organizers merge into `keepId`: each rule on a merged organizer moves to the kept
 * one on the same side, unless the cookbook already has the kept one on either side, in which case it is dropped. The
 * cookbook keeps the rule the cook gave the kept organizer, so one organizer never ends up on both sides.
 */
export function smartCookbookRepoints(rules: readonly SmartCookbookRule[], mergedIds: readonly string[], keepId: string): SmartCookbookRepoint[] {
  const merged = new Set(mergedIds);
  let keptOn = rules.find((rule) => rule.organizerId === keepId)?.side ?? null;
  const repoints: SmartCookbookRepoint[] = [];
  for (const rule of rules) {
    if (!merged.has(rule.organizerId)) continue;
    repoints.push({ side: rule.side, from: rule.organizerId, to: keptOn ? null : keepId });
    keptOn ??= rule.side;
  }
  return repoints;
}
