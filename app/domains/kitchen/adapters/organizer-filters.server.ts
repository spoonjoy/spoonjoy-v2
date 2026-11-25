// The organizer filters on a cook's recipe list: what the address asks for and the cook's own organizers to choose
// from, both only while the organizers flag is on for them (off, the list ignores the address's filters).
import type { AppLoadContext } from "react-router";
import { isFlagOn } from "~/domains/platform";
import { d1ReadBatch, requestD1, type D1ReadDatabase } from "~/lib/d1-read.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { ORGANIZER_KINDS, type OrganizerKind } from "../model/organizer";
import { organizerFilterParams, organizerRefValue, parseOrganizerFilters, type OrganizerFilters } from "../model/organizer-filter";
import { prismaOrganizerStore } from "./prisma-organizer-store";

/** The cook's organizers of each kind, by name, each with the value a filter sends for it ("tag:quick"). */
export type OrganizerChoices = Record<OrganizerKind, { name: string; value: string }[]>;

type NamedOrganizer = { name: string; slug: string };

// On the Worker the choices come from D1 in one query, so the page builds no Prisma client: on merge-group run
// 45528383350 a wedged Prisma engine failed every Prisma page in its isolate, /my-recipes among them.
async function organizersByKindOnD1(d1: D1ReadDatabase, userId: string): Promise<NamedOrganizer[][]> {
  const [rows] = await d1ReadBatch(d1, [[`SELECT "kind", "name", "slug" FROM "Organizer" WHERE "ownerId" = ?`, userId]]);
  return ORGANIZER_KINDS.map((kind) => rows!
    .filter((row) => row.kind === kind)
    .map((row) => ({ name: String(row.name), slug: String(row.slug) })));
}

async function organizersByKindOnPrisma(context: AppLoadContext, userId: string): Promise<NamedOrganizer[][]> {
  const store = prismaOrganizerStore(await getRequestDb(context));
  return Promise.all(ORGANIZER_KINDS.map((kind) => store.organizersOf(userId, kind)));
}

export async function organizerFiltersFor(
  request: Request,
  context: AppLoadContext,
  userId: string,
): Promise<{
  /** What the search narrows by. */
  filters: OrganizerFilters;
  /** The same filters as search parameters, for the page's form and links. */
  filterParams: [string, string][];
  organizerChoices: OrganizerChoices | null;
}> {
  if (!isFlagOn("organizers", context.cloudflare?.env, userId)) {
    return { filters: { with: [], without: [] }, filterParams: [], organizerChoices: null };
  }
  const d1 = requestD1(context);
  const byKind = d1 ? await organizersByKindOnD1(d1, userId) : await organizersByKindOnPrisma(context, userId);
  const organizerChoices = Object.fromEntries(ORGANIZER_KINDS.map((kind, index) => [
    kind,
    byKind[index]!
      .map(({ name, slug }) => ({ name, value: organizerRefValue({ kind, slug }) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ])) as OrganizerChoices;
  // A filter for an organizer the cook no longer has (a stale bookmark) is dropped, so every filter has a box to untick.
  const known = new Set(Object.values(organizerChoices).flat().map((choice) => choice.value));
  const parsed = parseOrganizerFilters(new URL(request.url).searchParams);
  const filters = {
    with: parsed.with.filter((ref) => known.has(organizerRefValue(ref))),
    without: parsed.without.filter((ref) => known.has(organizerRefValue(ref))),
  };
  return { filters, filterParams: organizerFilterParams(filters), organizerChoices };
}
