// Organizers: the tags, categories and tools a cook sorts recipes by.
//
// An organizer belongs to one owner (a cook, or a household once households land) and has a kind. Its slug is unique per
// owner and kind, so "Quick", "quick" and "quick!" are one tag. Assigning a name the owner has no organizer for creates
// one. Renaming onto a name that is taken is refused with the organizer to merge into; merging moves every recipe from
// the merged organizers onto the one kept.
//
// This file does no I/O: adapters load organizers and recipe links, call these rules and store what they return.

export const ORGANIZER_KINDS = ["tag", "category", "tool"] as const;

export type OrganizerKind = (typeof ORGANIZER_KINDS)[number];

/** The longest name an organizer may have, in characters. */
export const ORGANIZER_NAME_MAX_LENGTH = 60;

/** The hidden field that names each kind the Organize form shows, so a kind with every chip removed still clears. */
export const ORGANIZE_MARKER = "organize";

export type Organizer = { id: string; ownerId: string; kind: OrganizerKind; name: string; slug: string };

/** A recipe carrying an organizer. */
export type OrganizerLink = { recipeId: string; organizerId: string };

/** An organizer kind from user or API input, or null when it is not one. */
export function parseOrganizerKind(value: unknown): OrganizerKind | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (ORGANIZER_KINDS as readonly string[]).includes(normalized) ? (normalized as OrganizerKind) : null;
}

/** A name as stored: trimmed, with runs of spaces made one. Null when it is empty, too long or not text. */
export function normalizeOrganizerName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > ORGANIZER_NAME_MAX_LENGTH) return null;
  return name;
}

/**
 * The slug of a name: lowercase letters and digits from any script, joined by dashes, with accents dropped from Latin
 * letters. A name with no letters or digits (an emoji) is spelled out by its code points, so it still has its own slug.
 */
export function organizerSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (/[\p{L}\p{N}]/u.test(slug)) return slug;
  const codePoints = [...name.replace(/\s+/g, "")].map((char) => char.codePointAt(0)!.toString(16));
  return `u${codePoints.join("-")}`;
}

export type OrganizerAssignmentPlan = {
  /** Ids of the owner's organizers the names reach, once each, in the order first named. */
  reuse: string[];
  /** Organizers to create, once each, in the order first named. */
  create: { name: string; slug: string }[];
};

/** What assigning these names means, given the organizers of one owner and kind that already exist. */
export function planOrganizerAssignment(existing: readonly Organizer[], names: readonly unknown[]): OrganizerAssignmentPlan {
  const bySlug = new Map(existing.map((organizer) => [organizer.slug, organizer.id]));
  const seen = new Set<string>();
  const plan: OrganizerAssignmentPlan = { reuse: [], create: [] };
  for (const raw of names) {
    const name = normalizeOrganizerName(raw);
    if (!name) continue;
    const slug = organizerSlug(name);
    if (seen.has(slug)) continue;
    seen.add(slug);
    const id = bySlug.get(slug);
    if (id) plan.reuse.push(id);
    else plan.create.push({ name, slug });
  }
  return plan;
}

export type RenameResult =
  | { ok: true; organizer: Organizer }
  | { ok: false; reason: "invalid-name" }
  | { ok: false; reason: "taken"; conflictId: string };

/** Rename an organizer, given its siblings (the owner's organizers of the same kind, itself included). */
export function renameOrganizer(organizer: Organizer, newName: unknown, siblings: readonly Organizer[]): RenameResult {
  const name = normalizeOrganizerName(newName);
  if (!name) return { ok: false, reason: "invalid-name" };
  const slug = organizerSlug(name);
  const conflict = siblings.find((sibling) => sibling.id !== organizer.id && sibling.slug === slug);
  if (conflict) return { ok: false, reason: "taken", conflictId: conflict.id };
  return { ok: true, organizer: { ...organizer, name, slug } };
}

/**
 * The link changes that merge `mergedIds` into `keepId`: every link to a merged organizer goes, and each of their
 * recipes gains the kept organizer unless it already has it. The merged organizers themselves are deleted by the caller.
 */
export function mergeOrganizerLinks(
  links: readonly OrganizerLink[],
  mergedIds: readonly string[],
  keepId: string,
): { remove: OrganizerLink[]; add: OrganizerLink[] } {
  const merged = new Set(mergedIds.filter((id) => id !== keepId));
  const hasKept = new Set(links.filter((link) => link.organizerId === keepId).map((link) => link.recipeId));
  const remove: OrganizerLink[] = [];
  const add: OrganizerLink[] = [];
  for (const link of links) {
    if (!merged.has(link.organizerId)) continue;
    remove.push(link);
    if (hasKept.has(link.recipeId)) continue;
    hasKept.add(link.recipeId);
    add.push({ recipeId: link.recipeId, organizerId: keepId });
  }
  return { remove, add };
}
