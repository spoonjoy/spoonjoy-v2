// Organizer use cases. They take an OrganizerStore port, so the same rules run against D1 in the Worker, SQLite in
// tests and the local adapter a self-hosted server uses. Every change is the owner's: a cook organizes their own
// recipes with their own tags, categories and tools.
import {
  mergeOrganizerLinks,
  planOrganizerAssignment,
  renameOrganizer,
  type Organizer,
  type OrganizerKind,
  type OrganizerLink,
  type RenameResult,
} from "../model/organizer";

export interface OrganizerStore {
  /** The owner's organizers of one kind. */
  organizersOf(ownerId: string, kind: OrganizerKind): Promise<Organizer[]>;
  find(organizerId: string): Promise<Organizer | null>;
  /** The cook of a live (not deleted) recipe, or null when there is none. */
  liveRecipeChefId(recipeId: string): Promise<string | null>;
  create(ownerId: string, kind: OrganizerKind, organizers: { name: string; slug: string }[]): Promise<Organizer[]>;
  /** The organizers of one kind on a recipe. */
  organizersOnRecipe(recipeId: string, kind: OrganizerKind): Promise<Organizer[]>;
  /** Every recipe link to these organizers. */
  linksTo(organizerIds: readonly string[]): Promise<OrganizerLink[]>;
  /** Adds and removes links, and deletes organizers, in one batch. */
  apply(change: { add: OrganizerLink[]; remove: OrganizerLink[]; deleteIds?: string[] }): Promise<void>;
  rename(organizer: Organizer): Promise<void>;
  /** How many live recipes carry each of these organizers; an organizer with none may be missing. */
  liveRecipeCounts(organizerIds: readonly string[]): Promise<Map<string, number>>;
  /** The live recipes carrying an organizer, most recently changed first. */
  liveRecipeIds(organizerId: string): Promise<string[]>;
}

const byName = (a: Organizer, b: Organizer) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export async function organizersOnRecipe(store: OrganizerStore, recipeId: string, kind: OrganizerKind): Promise<Organizer[]> {
  return (await store.organizersOnRecipe(recipeId, kind)).sort(byName);
}

/** The owner's organizers of one kind, by name, each with how many live recipes carry it (unused ones show 0). */
export async function listOrganizers(
  store: OrganizerStore,
  ownerId: string,
  kind: OrganizerKind,
): Promise<{ organizer: Organizer; recipeCount: number }[]> {
  const organizers = (await store.organizersOf(ownerId, kind)).sort(byName);
  const counts = await store.liveRecipeCounts(organizers.map((organizer) => organizer.id));
  return organizers.map((organizer) => ({ organizer, recipeCount: counts.get(organizer.id) ?? 0 }));
}

/**
 * Sets a recipe's organizers of one kind to exactly these names: names the cook has no organizer for are created,
 * and organizers of that kind not named are taken off the recipe (they stay in the cook's list).
 */
export async function setRecipeOrganizers(
  store: OrganizerStore,
  ownerId: string,
  recipeId: string,
  kind: OrganizerKind,
  names: readonly unknown[],
): Promise<{ ok: true; organizers: Organizer[] } | { ok: false; error: "not-found" }> {
  if ((await store.liveRecipeChefId(recipeId)) !== ownerId) return { ok: false, error: "not-found" };
  const existing = await store.organizersOf(ownerId, kind);
  const plan = planOrganizerAssignment(existing, names);
  const created = plan.create.length ? await store.create(ownerId, kind, plan.create) : [];
  const wanted = [...existing.filter((organizer) => plan.reuse.includes(organizer.id)), ...created];
  const wantedIds = new Set(wanted.map((organizer) => organizer.id));
  const current = await store.organizersOnRecipe(recipeId, kind);
  const currentIds = new Set(current.map((organizer) => organizer.id));
  await store.apply({
    add: wanted.filter((organizer) => !currentIds.has(organizer.id)).map((organizer) => ({ recipeId, organizerId: organizer.id })),
    remove: current.filter((organizer) => !wantedIds.has(organizer.id)).map((organizer) => ({ recipeId, organizerId: organizer.id })),
  });
  return { ok: true, organizers: wanted.sort(byName) };
}

async function owned(store: OrganizerStore, ownerId: string, organizerId: string): Promise<Organizer | null> {
  const organizer = await store.find(organizerId);
  return organizer && organizer.ownerId === ownerId ? organizer : null;
}

export async function renameOrganizerById(
  store: OrganizerStore,
  ownerId: string,
  organizerId: string,
  name: unknown,
): Promise<RenameResult | { ok: false; reason: "not-found" }> {
  const organizer = await owned(store, ownerId, organizerId);
  if (!organizer) return { ok: false, reason: "not-found" };
  const result = renameOrganizer(organizer, name, await store.organizersOf(ownerId, organizer.kind));
  if (result.ok) await store.rename(result.organizer);
  return result;
}

/** Merges `mergedIds` into `keepId`: their recipes move onto the kept organizer and they are deleted. Same owner, same kind. */
export async function mergeOrganizers(
  store: OrganizerStore,
  ownerId: string,
  keepId: string,
  mergedIds: readonly string[],
): Promise<{ ok: true } | { ok: false; error: "not-found" }> {
  const keep = await owned(store, ownerId, keepId);
  if (!keep) return { ok: false, error: "not-found" };
  const ids = [...new Set(mergedIds)].filter((id) => id !== keepId);
  for (const id of ids) {
    const organizer = await owned(store, ownerId, id);
    if (!organizer || organizer.kind !== keep.kind) return { ok: false, error: "not-found" };
  }
  const change = mergeOrganizerLinks(await store.linksTo([keepId, ...ids]), ids, keepId);
  await store.apply({ ...change, deleteIds: ids });
  return { ok: true };
}

/** Deletes an organizer of the owner's; its recipes stay, without it. */
export async function deleteOrganizer(store: OrganizerStore, ownerId: string, organizerId: string): Promise<boolean> {
  if (!(await owned(store, ownerId, organizerId))) return false;
  await store.apply({ add: [], remove: [], deleteIds: [organizerId] });
  return true;
}

/** An organizer's page: the organizer with this slug and its live recipes, or null when the owner has none. */
export async function organizerPage(
  store: OrganizerStore,
  ownerId: string,
  kind: OrganizerKind,
  slug: string,
): Promise<{ organizer: Organizer; recipeIds: string[] } | null> {
  const organizer = (await store.organizersOf(ownerId, kind)).find((candidate) => candidate.slug === slug);
  if (!organizer) return null;
  return { organizer, recipeIds: await store.liveRecipeIds(organizer.id) };
}
