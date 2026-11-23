// Filters a cook narrows their recipes with: organizers a recipe must have ("with") and ones it must not ("without"),
// written in a URL as `with=tag:quick&without=tool:stand-mixer`. Pure rules, no I/O.
import { ORGANIZER_KINDS, type OrganizerKind } from "./organizer";

export type OrganizerRef = { kind: OrganizerKind; slug: string };
export type OrganizerFilters = { with: OrganizerRef[]; without: OrganizerRef[] };

/** The most of each side a search reads, so its query binds a bounded number of values. */
export const ORGANIZER_FILTER_MAX = 10;

function parseRef(value: string): OrganizerRef | null {
  const colon = value.indexOf(":");
  if (colon < 0) return null;
  const kind = value.slice(0, colon);
  const slug = value.slice(colon + 1);
  if (!(ORGANIZER_KINDS as readonly string[]).includes(kind) || !slug) return null;
  return { kind: kind as OrganizerKind, slug };
}

function parseSide(values: string[]): OrganizerRef[] {
  const seen = new Set<string>();
  const refs: OrganizerRef[] = [];
  for (const value of values) {
    const ref = parseRef(value);
    if (!ref || seen.has(value) || refs.length >= ORGANIZER_FILTER_MAX) continue;
    seen.add(value);
    refs.push(ref);
  }
  return refs;
}

export function parseOrganizerFilters(params: URLSearchParams): OrganizerFilters {
  return { with: parseSide(params.getAll("with")), without: parseSide(params.getAll("without")) };
}

export function organizerRefValue(ref: OrganizerRef): string {
  return `${ref.kind}:${ref.slug}`;
}

/** The filters as search parameters, in the order parseOrganizerFilters reads them. */
export function organizerFilterParams(filters: OrganizerFilters): [string, string][] {
  return [
    ...filters.with.map((ref) => ["with", organizerRefValue(ref)] as [string, string]),
    ...filters.without.map((ref) => ["without", organizerRefValue(ref)] as [string, string]),
  ];
}
